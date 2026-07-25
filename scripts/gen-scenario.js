/* eslint-disable */
// @ts-nocheck
/**
 * Deterministic scenario generator for the E-series.
 *
 *   node scripts/gen-scenario.js --lambda 4 --seed 3 --count 80 --out /tmp/s.json
 *
 * Emits a run-scenario.js-compatible scenario whose cargo arrivals follow a
 * Poisson process of rate `lambda` (cargo per minute), drawn from a seeded
 * PRNG so that (lambda, seed, count) always reproduces the same schedule.
 *
 * Two failure modes of hand-written scenarios are removed by construction:
 *   - Destination zones are resolved LIVE from the database, so a scenario can
 *     never point at a deleted zone (the stale-UUID failure).
 *   - Source points are drawn WITHOUT replacement, so no two cargo ever wait on
 *     the same pickup point (WES rejects the second).
 *
 * Config via env: DATABASE_URL (required; read from ./.env when present).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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

/** mulberry32 — the same deterministic PRNG the kernel engine uses. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

async function liveTopology(db) {
  const zones = await db.query(
    `SELECT z.id, z.name,
            (SELECT count(*) FROM zone_members m WHERE m.zone_id = z.id) AS slots
       FROM zones z
      WHERE z.type = 'DROPOFF' AND z.status = 'ACTIVE' AND z.deleted_at IS NULL
      ORDER BY z.created_at`,
  );
  const points = await db.query(
    `SELECT DISTINCT m.location_name
       FROM zone_members m
       JOIN zones z ON z.id = m.zone_id
      WHERE z.type = 'PICKUP' AND z.status = 'ACTIVE' AND z.deleted_at IS NULL
      ORDER BY m.location_name`,
  );
  return {
    zones: zones.rows.map((r) => ({ id: r.id, name: r.name, slots: Number(r.slots) })),
    sourcePoints: points.rows.map((r) => String(r.location_name).replace(/^location_/, '')),
  };
}

/** Fisher-Yates over a seeded stream, so the point selection is reproducible. */
function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const lambda = Number(args.lambda ?? 0);
  const seed = Number(args.seed ?? 0);
  const count = Number(args.count ?? 80);
  const out = args.out;

  if (!out) {
    console.error('usage: gen-scenario.js --lambda <cargo/min> --seed <int> --count <n> --out <file.json>');
    console.error('       --lambda 0 emits a burst (every cargo at t=0)');
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const topo = await liveTopology(db);
  await db.end();

  if (topo.zones.length === 0) {
    console.error('BLOCKED: no ACTIVE DROPOFF zone exists — create drop-off zones before generating.');
    process.exit(3);
  }
  if (topo.sourcePoints.length < count) {
    console.error(
      `BLOCKED: need ${count} distinct pickup points but only ${topo.sourcePoints.length} are available.` +
        ' Lower --count (a point may hold only one waiting cargo).',
    );
    process.exit(3);
  }

  const capacity = topo.zones.reduce((a, z) => a + z.slots, 0);
  if (count > capacity) {
    console.error(`BLOCKED: ${count} cargo exceeds total drop-off capacity ${capacity}.`);
    process.exit(3);
  }

  const rng = makeRng(seed);
  const sources = shuffled(topo.sourcePoints, rng).slice(0, count);

  const cargos = [];
  let tMs = 0;
  for (let i = 0; i < count; i++) {
    if (lambda > 0) {
      const u = Math.max(rng(), Number.EPSILON);
      tMs += (-Math.log(u) / lambda) * 60000;
    }
    cargos.push({
      atMs: Math.round(tMs),
      sourcePointName: sources[i],
      destinationZoneId: topo.zones[i % topo.zones.length].id,
    });
  }

  const perZone = {};
  for (const c of cargos) perZone[c.destinationZoneId] = (perZone[c.destinationZoneId] ?? 0) + 1;
  const over = topo.zones.filter((z) => (perZone[z.id] ?? 0) > z.slots);
  if (over.length > 0) {
    console.error(
      'BLOCKED: zone capacity exceeded: ' +
        over.map((z) => `${z.name} needs ${perZone[z.id]} > ${z.slots}`).join('; '),
    );
    process.exit(3);
  }

  const scenario = {
    label: args.label || `gen_lam${lambda}_seed${seed}_n${count}`,
    notes: `generated lambda=${lambda}/min seed=${seed} count=${count} zones=${topo.zones.length}`,
    cargos,
  };
  fs.writeFileSync(path.resolve(out), JSON.stringify(scenario, null, 2) + '\n');

  const span = cargos.length ? cargos[cargos.length - 1].atMs : 0;
  console.log(
    `wrote ${out}: ${cargos.length} cargo over ${(span / 60000).toFixed(1)} min ` +
      `(lambda=${lambda}/min, seed=${seed}), ${topo.zones.length} zones, ` +
      Object.entries(perZone)
        .map(([id, n]) => `${id.slice(0, 8)}=${n}`)
        .join(' '),
  );
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
