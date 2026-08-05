/* eslint-disable */
const { Client } = require('pg');
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const K = 'http://localhost:55200';
const STALL_S = 180;
const MAX_MIN = 65;
const FLEET_N = Number(process.env.WATCH_FLEET_N ?? 15);
const LABEL_LIKE = process.env.WATCH_LABEL ?? `E1|cond=S1|n=${FLEET_N}%`;
const FLEET_RE = new RegExp(`^Vehicle-\\d{4}$`);
const WATCH_CONDITION = process.env.WATCH_CONDITION ?? null;

const { spawnSync } = require('child_process');
function kernelJvmCondition() {
  const script = [
    "$p = Get-NetTCPConnection -LocalPort 55200 -State Listen -ErrorAction SilentlyContinue |",
    'Select-Object -First 1 -ExpandProperty OwningProcess;',
    'if (-not $p) { exit 1 };',
    '$c = (Get-CimInstance Win32_Process -Filter "ProcessId=$p").CommandLine;',
    "if ($c -match '-Dfms\\.condition=(\\S+)') { $Matches[1] } else { 'S1' }",
  ].join(' ');
  const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  if (res.status !== 0) return null;
  const value = String(res.stdout ?? '').trim().toUpperCase();
  return /^[A-Z0-9_]+$/.test(value) ? value : null;
}

function assertConditionOrDie() {
  if (!WATCH_CONDITION) return;
  const found = kernelJvmCondition();
  if (found !== null && found !== WATCH_CONDITION) {
    console.log(
      `WATCHDOG ALARM: kernel condition is ${found}, expected ${WATCH_CONDITION} — ` +
        'the kernel was swapped mid-campaign; runs since the swap are invalid. Exiting loudly.',
    );
    process.exit(3);
  }
}

async function doneCount(db, since) {
  return Number((await db.query(
    "SELECT count(*) FROM task_status_transitions WHERE occurred_at >= $1 AND to_status = 'DELIVERY_COMPLETED'",
    [since])).rows[0].count);
}
async function fleet() {
  try {
    const v = await fetch(`${K}/v1/vehicles`).then((r) => r.json());
    const f = v
      .filter((x) => FLEET_RE.test(x.name))
      .filter((x) => x.integrationLevel === 'TO_BE_UTILIZED');
    return {
      idle: f.filter((x) => x.state === 'IDLE' && x.procState === 'IDLE').length,
      minE: Math.min(...f.map((x) => x.energyLevel ?? 0)),
      charging: f.filter((x) => String(x.transportOrder ?? '').includes('CHARGE')).length,
      withdrawn: f.filter((x) => x.procState !== 'IDLE' && x.state === 'IDLE').length,
    };
  } catch { return { idle: -1, minE: -1, charging: -1, withdrawn: -1 }; }
}

// Bug #7 auto-heal: a vehicle left holding a withdrawn PARK order (state IDLE,
// procState PROCESSING_ORDER, its PARK-* order no longer live in the kernel)
// never releases, so its real pickup sits DISPATCHABLE forever. Kick it free.
const parkLimbo = new Map();
async function unstickParkLimbo() {
  try {
    const [v, orders] = await Promise.all([
      fetch(`${K}/v1/vehicles`).then((r) => r.json()),
      fetch(`${K}/v1/transportOrders`).then((r) => r.json()),
    ]);
    const live = new Set(
      orders
        .filter((o) => ['BEING_PROCESSED', 'DISPATCHABLE', 'ACTIVE', 'RAW'].includes(o.state))
        .map((o) => o.name),
    );
    for (const x of v.filter((y) => /^Vehicle-\d+$/.test(y.name))) {
      const order = x.transportOrder ?? '';
      const limbo =
        x.state === 'IDLE' &&
        x.procState === 'PROCESSING_ORDER' &&
        order.startsWith('PARK-') &&
        !live.has(order);
      if (!limbo) { parkLimbo.delete(x.name); continue; }
      const since = parkLimbo.get(x.name) ?? Date.now();
      parkLimbo.set(x.name, since);
      if (Date.now() - since >= 45_000) {
        // Solo withdrawal ONLY. Chasing it with a forced reroute races the
        // dispatcher's immediate re-assignment and can leave the controller
        // catatonic (claims registered, never allocates — needs kernel restart).
        await fetch(`${K}/v1/vehicles/${encodeURIComponent(x.name)}/withdrawal?immediate=true`, { method: 'POST' });
        console.log(`  AUTO-HEAL: released ${x.name} from withdrawn ${order.slice(0, 30)}… (solo withdrawal)`);
        parkLimbo.delete(x.name);
      }
    }
  } catch {}
}

async function watchRun(db, run) {
  const t0 = Date.now();
  let lastDone = -1, lastProgress = Date.now(), recoveries = 0;
  while (Date.now() - t0 < MAX_MIN * 60000) {
    const closed = (await db.query('SELECT ended_at FROM runs WHERE id=$1', [run.id])).rows[0].ended_at;
    if (closed) { console.log(`WATCHDOG: run #${run.id} CLOSED at done=${lastDone}/80, self-recoveries=${recoveries}`); return 'closed'; }
    const done = await doneCount(db, run.started_at);
    if (done > lastDone) {
      if (lastDone >= 0 && Date.now() - lastProgress > 45000) recoveries++;
      lastDone = done; lastProgress = Date.now();
    }
    const stalledS = Math.round((Date.now() - lastProgress) / 1000);
    const f = await fleet();
    const warmingUp = done === 0 && f.idle === 0;
    if (stalledS >= STALL_S && !warmingUp) {
      const cause = f.minE >= 0 && f.minE <= 20 ? 'BATTERY (min energy ' + f.minE + '%)' : 'WEDGE';
      console.log(`WATCHDOG: STALL run #${run.id} — done=${done}/80, ${stalledS}s no progress, idle=${f.idle}/${FLEET_N}, minE=${f.minE}% => ${cause}`);
      return 'stall';
    }
    console.log(`  ${new Date().toISOString().slice(11, 19)}  #${run.id}  done=${done}/80  stalled=${stalledS}s  idle=${f.idle}/${FLEET_N}  minE=${f.minE}%`);
    assertConditionOrDie();
    await unstickParkLimbo();
    await new Promise((r) => setTimeout(r, 30000));
  }
  console.log(`WATCHDOG: run #${run.id} watch window expired`);
  return 'expired';
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const seen = new Set();
  let emptySince = null;
  console.log(`WATCHDOG campaign mode: auto-heal on, following every open run matching ${LABEL_LIKE}`);
  for (;;) {
    const run = (await db.query(
      'SELECT id, started_at FROM runs WHERE label LIKE $1 AND ended_at IS NULL AND id > $2 ORDER BY id DESC LIMIT 1',
      [LABEL_LIKE, Number(process.env.WATCH_MIN_RUN_ID ?? 77)],
    )).rows[0];
    if (!run) {
      emptySince = emptySince ?? Date.now();
      if (Date.now() - emptySince > 10 * 60000) { console.log('WATCHDOG: no open run for 10 min — campaign over'); break; }
      assertConditionOrDie();
      await unstickParkLimbo();
      await new Promise((r) => setTimeout(r, 10000));
      continue;
    }
    emptySince = null;
    if (!seen.has(run.id)) { seen.add(run.id); console.log(`WATCHDOG → run #${run.id}`); }
    const outcome = await watchRun(db, run);
    if (outcome === 'stall') {
      await new Promise((r) => setTimeout(r, 60000));
    }
  }
  await db.end();
})().catch((e) => { console.error('WATCHDOG ERR', e.message); process.exit(1); });
