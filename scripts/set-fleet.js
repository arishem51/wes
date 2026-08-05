/* eslint-disable */
// @ts-nocheck
/**
 * Fleet-size control for the E-series (fleet size n is an independent variable).
 *
 *   node scripts/set-fleet.js --n 10
 *   node scripts/set-fleet.js --n 15 --verify-only
 *
 * Brings exactly `n` vehicles to a dispatchable state (TO_BE_UTILIZED with a
 * position) and pushes every other vehicle out of the fleet (TO_BE_IGNORED via
 * the WES disconnect endpoint), then verifies the count and exits non-zero if
 * it could not be reached — the matrix driver depends on that guarantee.
 *
 * SAFETY: a vehicle that already holds a position is never re-positioned.
 * Teleporting a vehicle that is mid-order is what produces openTCS's
 * "located at unexpected position" state, which wedges the fleet.
 *
 * Env: WES_PASS (required), WES_BASE_URL, KERNEL_URL, WES_USER.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      out[a.slice(2)] = next && !next.startsWith('--') ? argv[++i] : true;
    }
  }
  return out;
}

const PREFERRED_PARK_POINTS = [
  '1001', '1002', '1003', '1004', '1005',
  '0210', '0220', '0230', '0240', '0250',
  '1006', '1007', '1008', '1009', '1010',
];

const RESERVED_POINT = /^(01[0-7]\d|3\d{3})$/;

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const want = Number(args.n);
  if (!Number.isInteger(want) || want < 0) {
    console.error('usage: set-fleet.js --n <count> [--verify-only]');
    process.exit(2);
  }
  if (!process.env.WES_PASS) {
    console.error('WES_PASS is required');
    process.exit(2);
  }

  const base = (process.env.WES_BASE_URL ?? 'http://localhost:3000/api').replace(/\/$/, '');
  const kernel = (process.env.KERNEL_URL ?? 'http://localhost:55200').replace(/\/$/, '');
  const user = process.env.WES_USER ?? 'quan.tran';

  const vehicles = await fetch(`${kernel}/v1/vehicles`).then((r) => r.json());
  const fleet = vehicles.filter((v) => /^Vehicle-\d+$/.test(v.name)).sort((a, b) => a.name.localeCompare(b.name));

  const positionName = (v) => (v.currentPosition ? v.currentPosition.name ?? v.currentPosition : null);
  const dispatchable = (v) =>
    v.integrationLevel === 'TO_BE_UTILIZED' &&
    positionName(v) != null &&
    (v.energyLevel ?? 0) > 10;

  if (args['verify-only']) {
    const have = fleet.filter(dispatchable).length;
    console.log(`dispatchable ${have}/${fleet.length} (wanted ${want})`);
    process.exit(have === want ? 0 : 1);
  }

  if (want > fleet.length) {
    console.error(`BLOCKED: asked for ${want} vehicles but the kernel only knows ${fleet.length}`);
    process.exit(3);
  }

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: process.env.WES_PASS }),
  });
  if (!login.ok) {
    console.error(`BLOCKED: WES login ${login.status}`);
    process.exit(4);
  }
  const token = (await login.json()).token;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const agvList = await fetch(`${base}/agvs?limit=200`, { headers }).then((r) => r.json());
  const idByName = {};
  for (const a of agvList.agvs ?? agvList) idByName[a.name] = a.id;

  const active = fleet.slice(0, want);
  const inactive = fleet.slice(want);

  const occupied = new Set(fleet.map(positionName).filter(Boolean));
  const freePool = PREFERRED_PARK_POINTS.filter((p) => !occupied.has(p) && !RESERVED_POINT.test(p));

  for (const v of active) {
    const id = idByName[v.name];
    if (!id) {
      console.error(`BLOCKED: ${v.name} is not registered in WES`);
      process.exit(5);
    }
    const connect = await fetch(`${base}/agvs/${id}/connect`, { method: 'POST', headers });
    let placed = positionName(v);
    if (placed) {
      console.log(`${v.name} connect=${connect.status} position kept at ${placed}`);
      continue;
    }
    const point = freePool.shift();
    if (!point) {
      console.error(`BLOCKED: no free park point left for ${v.name}; extend PREFERRED_PARK_POINTS`);
      process.exit(6);
    }
    const position = await fetch(`${base}/agvs/${id}/position`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pointName: point }),
    });
    if (!position.ok) {
      console.error(`BLOCKED: positioning ${v.name} at ${point} returned ${position.status}`);
      process.exit(7);
    }
    occupied.add(point);
    console.log(`${v.name} connect=${connect.status} position(${point})=${position.status}`);
  }

  for (const v of inactive) {
    const id = idByName[v.name];
    if (!id) continue;
    let res = await fetch(`${base}/agvs/${id}/disconnect`, { method: 'POST', headers });
    if (res.status >= 400) {
      await fetch(`${kernel}/v1/vehicles/${encodeURIComponent(v.name)}/withdrawal?immediate=false`, {
        method: 'POST',
      });
      await new Promise((r) => setTimeout(r, 4000));
      res = await fetch(`${base}/agvs/${id}/disconnect`, { method: 'POST', headers });
    }
    console.log(`${v.name} disconnect=${res.status} (removed from fleet)`);
  }

  const settleMs = Number(process.env.FLEET_SETTLE_MS ?? 30000);
  const deadline = Date.now() + settleMs;
  let have = -1;
  while (Date.now() < deadline) {
    const after = await fetch(`${kernel}/v1/vehicles`).then((r) => r.json());
    have = after.filter((v) => /^Vehicle-\d+$/.test(v.name)).filter(dispatchable).length;
    if (have === want) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`\ndispatchable now ${have}, wanted ${want}`);
  if (have !== want) {
    console.error(
      `BLOCKED: fleet size did not settle at ${want} within ${settleMs}ms;` +
        ' do not run the matrix against this state',
    );
    process.exit(8);
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
