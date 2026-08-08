/* eslint-disable */
// @ts-nocheck
/**
 * E-series matrix driver — the WP-B harness loop.
 *
 *   node scripts/run-matrix.js --matrix scripts/matrices/e1.json
 *   node scripts/run-matrix.js --matrix scripts/matrices/e1.json --dry-run
 *   node scripts/run-matrix.js --aggregate --prefix E1 --out e1.csv
 *
 * Expands a matrix spec into cells (condition x n x lambda x seed), and for
 * each cell: verifies preconditions, cleans the previous batch, generates a
 * seeded scenario against the LIVE topology, and runs it under a structured
 * `runs.label` so the cells can be aggregated afterwards.
 *
 * Label grammar (parsed back by --aggregate):
 *   <exp>|cond=<C>|n=<int>|lam=<num>|seed=<int>|map=<name>
 *
 * DATA INTEGRITY IS THE POINT. A run recorded under the wrong condition is
 * worse than no run, so the driver refuses to proceed unless the kernel it is
 * talking to was actually booted in the cell's condition. It reads that back
 * from the -Dfms.condition flag on the JVM owning the kernel port, falling back
 * to the boot line FMSInjection writes to the log. Because bindings
 * are fixed at boot, changing condition requires a kernel restart; cells are
 * therefore ordered so each condition runs consecutively and the driver halts
 * once per condition boundary with the exact command to run.
 *
 * Env: DATABASE_URL (required), WES_PASS (required), WES_BASE_URL, KERNEL_URL,
 *      KERNEL_LOG, TIMEOUT_MS.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { Client } = require('pg');

const DEFAULT_KERNEL_LOG =
  'D:/WES/opentcs-integration-FMS/opentcs-FMS-kernel/build/install/opentcs-FMS-kernel/log/opentcs-kernel.0.log';

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
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      out[a.slice(2)] = next && !next.startsWith('--') ? argv[++i] : true;
    } else out._.push(a);
  }
  return out;
}

function labelFor(cell) {
  const base = `${cell.exp}|cond=${cell.cond}|n=${cell.n}|lam=${cell.lam}|seed=${cell.seed}|map=${cell.map}`;
  return cell.disturb ? `${base}|d=${cell.disturb}` : base;
}

function parseLabel(label) {
  const [exp, ...rest] = String(label).split('|');
  const kv = {};
  for (const part of rest) {
    const i = part.indexOf('=');
    if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1);
  }
  return { exp, ...kv };
}

function expand(spec) {
  const cells = [];
  for (const cond of spec.conditions) {
    for (const n of spec.n) {
      for (const lam of spec.lambda) {
        for (const seed of spec.seeds) {
          cells.push({
            exp: spec.exp,
            map: spec.map ?? 'v7',
            cond,
            n,
            lam,
            seed,
            count: spec.count ?? 80,
            timeoutMs: spec.timeoutMs ?? 1200000,
            disturb: spec.disturb ?? null,
          });
        }
      }
    }
  }
  return cells;
}

/**
 * Reads -Dfms.condition off the JVM that owns the kernel port. This is the boot
 * parameter itself rather than a report of it, so it cannot go stale, and an
 * absent property means S1 exactly as ExperimentCondition.parse(null) does.
 */
function conditionFromKernelProcess(kernelUrl) {
  const port = Number(new URL(kernelUrl).port || 55200);
  const script = [
    `$p = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue |`,
    'Select-Object -First 1 -ExpandProperty OwningProcess;',
    'if (-not $p) { exit 1 };',
    '$c = (Get-CimInstance Win32_Process -Filter "ProcessId=$p").CommandLine;',
    "if ($c -notmatch 'opentcs-FMS-kernel') { exit 2 };",
    "if ($c -match '-Dfms\\.condition=(\\S+)') { $Matches[1] } else { 'S1' }",
  ].join(' ');
  const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  if (res.status !== 0) return null;
  const value = String(res.stdout ?? '').trim().toUpperCase();
  return /^[A-Z0-9_]+$/.test(value) ? value : null;
}

/** Last boot line across the whole rotation set, oldest generation first. */
function conditionFromLogs(logPath) {
  const dir = path.dirname(logPath);
  const generation = path.basename(logPath).match(/^(.*)\.(\d+)(\.log)$/);
  const candidates = generation
    ? Array.from({ length: 10 }, (_, i) => path.join(dir, `${generation[1]}.${9 - i}${generation[3]}`))
    : [logPath];
  let found = null;
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const matches = [...fs.readFileSync(file, 'utf8').matchAll(/evaluation condition ([A-Z0-9_]+)/g)];
    if (matches.length > 0) found = matches[matches.length - 1][1];
  }
  return found;
}

/** The condition the running kernel was booted in. */
function kernelCondition(logPath, kernelUrl) {
  const fromProcess = conditionFromKernelProcess(kernelUrl);
  if (fromProcess) return { ok: true, condition: fromProcess, source: 'kernel JVM command line' };

  const fromLogs = conditionFromLogs(logPath);
  if (fromLogs) return { ok: true, condition: fromLogs, source: 'kernel log' };

  return {
    ok: false,
    reason:
      `could not determine the kernel condition: no JVM is listening on ${kernelUrl}, and no ` +
      `"evaluation condition" line survives in the ${path.dirname(logPath)} rotation set. ` +
      'Restart the kernel with scripts/restart-kernel.js before running the matrix',
  };
}

async function fetchJson(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchableCount(kernelUrl) {
  const vehicles = await fetchJson(`${kernelUrl}/v1/vehicles`);
  if (!vehicles) return null;
  return vehicles.filter(
    (v) =>
      /^Vehicle-\d+$/.test(v.name) &&
      v.integrationLevel === 'TO_BE_UTILIZED' &&
      v.currentPosition &&
      (v.energyLevel ?? 0) > 10,
  ).length;
}

const MOSQUITTO_PUB =
  process.env.MOSQUITTO_PUB ?? 'C:/Program Files/mosquitto/mosquitto_pub.exe';
const VDA_MANUFACTURER = process.env.VDA_MANUFACTURER ?? 'AUBOT';

/**
 * Clears the paused state on both sides.
 *
 * `paused` lives in two places: the kernel's vehicle model and the vehicle
 * itself. A kernel restart resets only the former, and the kernel suppresses a
 * write that matches what it already believes, so REST alone cannot resume a
 * vehicle whose simulator is still paused. A vehicle stuck that way never moves
 * and never releases its allocated resources, which stalls everything routed
 * behind it. The VDA5050 stopPause action is therefore sent unconditionally.
 */
async function unpauseAll(fleetSize) {
  const kernel = (process.env.KERNEL_URL ?? 'http://localhost:55200').replace(/\/$/, '');
  const broker = process.env.MQTT_HOST ?? 'localhost';
  for (let i = 1; i <= fleetSize; i++) {
    const kernelName = `Vehicle-${String(i).padStart(4, '0')}`;
    await fetch(`${kernel}/v1/vehicles/${kernelName}/paused?newValue=false`, { method: 'PUT' })
      .catch(() => {});

    const vehicleName = `V${String(i).padStart(2, '0')}`;
    const payload = JSON.stringify({
      headerId: Date.now() % 1000000,
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      manufacturer: VDA_MANUFACTURER,
      serialNumber: vehicleName,
      actions: [
        {
          actionType: 'stopPause',
          actionId: `harness-resume-${vehicleName}-${Date.now()}`,
          blockingType: 'NONE',
        },
      ],
    });
    spawnSync(MOSQUITTO_PUB, [
      '-h', broker,
      '-t', `aubotagv/v2/${VDA_MANUFACTURER}/${vehicleName}/instantActions`,
      '-m', payload,
    ], { encoding: 'utf8' });
  }
}

const RECHARGE_FLOOR_PCT = Number(process.env.RECHARGE_FLOOR_PCT ?? 0);
const RECHARGE_TARGET_PCT = Number(process.env.RECHARGE_TARGET_PCT ?? 85);
const RECHARGE_TIMEOUT_MS = Number(process.env.RECHARGE_TIMEOUT_MS ?? 1500000);

async function fleetEnergy(fleetSize) {
  const kernel = (process.env.KERNEL_URL ?? 'http://localhost:55200').replace(/\/$/, '');
  const all = await fetch(`${kernel}/v1/vehicles`).then((r) => r.json()).catch(() => []);
  const fleet = all
    .filter((v) => /^Vehicle-\d+$/.test(v.name))
    .slice(0, fleetSize);
  return fleet.map((v) => ({ name: v.name, energy: v.energyLevel ?? 0 }));
}

async function setCriticalThreshold(fleetSize, critical) {
  const kernel = (process.env.KERNEL_URL ?? 'http://localhost:55200').replace(/\/$/, '');
  for (let i = 1; i <= fleetSize; i++) {
    const name = `Vehicle-${String(i).padStart(4, '0')}`;
    await fetch(`${kernel}/v1/vehicles/${name}/energyLevelThresholdSet`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        energyLevelCritical: critical,
        energyLevelGood: 60,
        energyLevelSufficientlyRecharged: 60,
        energyLevelFullyRecharged: 90,
      }),
    }).catch(() => {});
  }
}

/**
 * Sets the WES-side threshold that decides when a vehicle is sent to charge.
 *
 * The kernel's energyLevelCritical only governs whether an assignment is
 * *allowed*; the charge trip itself is dispatched by the WES charge engine at
 * `energyLevel <= criticalBatteryThreshold`. Raising the kernel value alone
 * therefore lets an idle fleet sit and drain, which is what it did.
 */
async function setWesChargeThreshold(threshold) {
  const base = (process.env.WES_BASE_URL ?? 'http://localhost:3000/api').replace(/\/$/, '');
  const user = process.env.WES_USER ?? 'quan.tran';
  const pass = process.env.WES_PASS;
  if (!pass) return false;
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  }).catch(() => null);
  if (!login || !login.ok) return false;
  const token = (await login.json()).token;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const list = await fetch(`${base}/agvs?limit=200`, { headers })
    .then((r) => r.json())
    .catch(() => null);
  if (!list) return false;
  for (const agv of list.agvs ?? list) {
    await fetch(`${base}/agvs/${agv.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ criticalBatteryThreshold: threshold }),
    }).catch(() => {});
  }
  return true;
}

/**
 * Holds the next cell until the fleet is charged.
 *
 * A cell that starts on a half-empty fleet spends itself driving to chargers,
 * and under disturbance a vehicle routinely falls through the kernel's
 * energyLevelCritical floor, below which openTCS refuses every assignment
 * including the charge order that would save it: the vehicle stops for good
 * while still holding its resources and the fleet queues behind it. The floor
 * is dropped only while this gate runs, never inside a measured cell, so the
 * runs themselves see the deployed thresholds.
 */
const DEPLOYED_KERNEL_CRITICAL = 10;
const DEPLOYED_WES_CHARGE_THRESHOLD = 20;

async function rechargeGate(fleetSize) {
  // Asserted, not assumed: a gate that died mid-run in an earlier campaign can
  // leave these raised, and a raised WES threshold sends the whole fleet to
  // charge instead of to work, which looks like a stalled fleet.
  await setCriticalThreshold(fleetSize, DEPLOYED_KERNEL_CRITICAL);
  await setWesChargeThreshold(DEPLOYED_WES_CHARGE_THRESHOLD);

  // Math.min of an empty list is Infinity, and an unreachable kernel returns an
  // empty list: without this guard a dead kernel reads as a fully charged fleet.
  const before = await fleetEnergy(fleetSize);
  if (before.length < fleetSize) {
    console.error(
      `  recharge gate: kernel reported ${before.length}/${fleetSize} vehicles — treating as not ready`,
    );
    return false;
  }
  const worst = Math.min(...before.map((v) => v.energy));
  if (worst >= RECHARGE_TARGET_PCT) return true;

  // Waiting for the fleet to charge itself does not terminate: the plant model
  // makes every charge point a park point, so a vehicle that finishes charging
  // is already "parked" and never vacates, and the vehicles that need the
  // charger cannot reach one. The battery is simulator state, so each cell is
  // instead given the same defined starting charge.
  console.log(`  recharge gate: lowest battery ${worst}%, setting the fleet to ${RECHARGE_TARGET_PCT}%`);
  const broker = process.env.MQTT_HOST ?? 'localhost';
  for (let i = 1; i <= fleetSize; i++) {
    const vehicleName = `V${String(i).padStart(2, '0')}`;
    const payload = JSON.stringify({
      headerId: Date.now() % 1000000,
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      manufacturer: VDA_MANUFACTURER,
      serialNumber: vehicleName,
      actions: [
        {
          actionType: 'setPinLevel',
          actionId: `harness-charge-${vehicleName}-${Date.now()}`,
          blockingType: 'NONE',
          actionParameters: [{ key: 'pinLevel', value: RECHARGE_TARGET_PCT }],
        },
      ],
    });
    spawnSync(MOSQUITTO_PUB, [
      '-h', broker,
      '-t', `aubotagv/v2/${VDA_MANUFACTURER}/${vehicleName}/instantActions`,
      '-m', payload,
    ], { encoding: 'utf8' });
  }

  const deadline = Date.now() + 120000;
  let now = worst;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const levels = await fleetEnergy(fleetSize);
    if (levels.length < fleetSize) continue;
    now = Math.min(...levels.map((v) => v.energy));
    if (now >= RECHARGE_TARGET_PCT - 5) break;
  }
  if (now < RECHARGE_TARGET_PCT - 5) {
    console.error(`  recharge gate: fleet still at ${now}% after the battery reset`);
    return false;
  }
  console.log(`  recharge gate: fleet at ${now}%`);
  return true;
}

function runNode(scriptRelPath, argv, env) {
  const res = spawnSync(process.execPath, [path.resolve(scriptRelPath), ...argv], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return res.status === 0;
}

async function completedLabels(db, prefix) {
  const { rows } = await db.query(
    'SELECT label FROM runs WHERE label LIKE $1 AND ended_at IS NOT NULL',
    [`${prefix}%`],
  );
  return new Set(rows.map((r) => r.label));
}

async function connectDb() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
  } catch (err) {
    const why = err && err.message ? err.message : `${err && err.code ? err.code : 'connection refused'}`;
    throw new Error(
      `cannot reach Postgres (${why}). Start the database before running the matrix.`,
    );
  }
  return db;
}

async function drive(args) {
  const spec = JSON.parse(fs.readFileSync(path.resolve(args.matrix), 'utf8'));
  const cells = expand(spec);
  const kernelUrl = (process.env.KERNEL_URL ?? 'http://localhost:55200').replace(/\/$/, '');
  const kernelLog = process.env.KERNEL_LOG ?? DEFAULT_KERNEL_LOG;

  if (args['dry-run']) {
    console.log(`matrix ${spec.exp}: ${cells.length} cells (dry run — resume state not checked)`);
    for (const c of cells) console.log('  ', labelFor(c));
    const hours = ((cells.length * (spec.timeoutMs ?? 1200000)) / 3600000).toFixed(1);
    console.log(
      `\nworst-case wall clock if every cell runs to its ${(spec.timeoutMs ?? 1200000) / 60000}-min timeout: ${hours} h`,
    );
    return;
  }

  const db = await connectDb();
  const done = await completedLabels(db, spec.exp);

  const pending = cells.filter((c) => !done.has(labelFor(c)));
  console.log(
    `matrix ${spec.exp}: ${cells.length} cells, ${cells.length - pending.length} already complete, ${pending.length} pending`,
  );
  if (pending.length === 0) {
    await db.end();
    return;
  }

  const target = pending[0].cond;
  const batch = pending.filter((c) => c.cond === target);
  const readback = kernelCondition(kernelLog, kernelUrl);

  if (!readback.ok) {
    console.error(`HALT: ${readback.reason}`);
    await db.end();
    process.exit(4);
  }
  if (readback.condition !== target) {
    console.error(
      `HALT: kernel is running condition ${readback.condition}, next pending cells need ${target}.\n` +
        `  Restart the kernel with -Dfms.condition=${target}, re-trigger the fleet, then re-run this command.\n` +
        `  ${batch.length} cell(s) are waiting on that restart.`,
    );
    await db.end();
    process.exit(5);
  }

  console.log(
    `kernel condition ${readback.condition} confirmed via ${readback.source}; running ${batch.length} cell(s)`,
  );

  for (const cell of batch) {
    const label = labelFor(cell);
    const cellCondition = kernelCondition(kernelLog, kernelUrl);
    if (!cellCondition.ok || cellCondition.condition !== target) {
      console.error(
        `HALT before ${label}: kernel condition is now ` +
          `${cellCondition.ok ? cellCondition.condition : 'UNKNOWN'}, expected ${target}.` +
          ' The kernel was restarted mid-campaign — restart it with' +
          ` -Dfms.condition=${target} (scripts/restart-kernel.js) and re-run.`,
      );
      await db.end();
      process.exit(5);
    }
    // Before the fleet check, not after: a vehicle drained below the kernel's
    // critical level is not dispatchable, so set-fleet would fail on exactly
    // the vehicles the gate exists to recover.
    if (cell.disturb) {
      await unpauseAll(cell.n);
      if (!(await rechargeGate(cell.n))) {
        console.error(`HALT at ${label}: fleet could not be recharged before the cell`);
        await db.end();
        process.exit(12);
      }
    }

    const have = await dispatchableCount(kernelUrl);
    if (have === null) {
      console.error('HALT: kernel unreachable');
      await db.end();
      process.exit(6);
    }
    if (have !== cell.n) {
      console.log(`  fleet is ${have}, cell needs ${cell.n} — adjusting`);
      if (!runNode('scripts/set-fleet.js', ['--n', String(cell.n)], {})) {
        console.error(
          `HALT at ${label}: could not set the fleet to ${cell.n} vehicles.\n` +
            '  Fix the fleet manually, then re-run (completed cells are skipped).',
        );
        await db.end();
        process.exit(7);
      }
    }

    console.log(`\n=== ${label} ===`);
    if (!runNode('scripts/cleanup-batch.js', [], {})) {
      console.error(`HALT at ${label}: cleanup failed`);
      await db.end();
      process.exit(8);
    }

    const tmp = path.join(os.tmpdir(), `scenario-${cell.seed}-${Date.now()}.json`);
    const genOk = runNode(
      'scripts/gen-scenario.js',
      ['--lambda', String(cell.lam), '--seed', String(cell.seed), '--count', String(cell.count), '--out', tmp],
      {},
    );
    if (!genOk) {
      console.error(`HALT at ${label}: scenario generation failed (topology precondition unmet)`);
      await db.end();
      process.exit(9);
    }

    let injector = null;
    if (cell.disturb) {
      injector = spawn(
        process.execPath,
        [
          path.resolve('scripts/disturb.js'),
          '--level', cell.disturb,
          '--seed', String(cell.seed),
          '--n', String(cell.n),
          '--duration-min', String(Math.ceil(cell.timeoutMs / 60000)),
        ],
        { stdio: 'ignore', detached: false },
      );
      console.log(`  disturbance injector started (level=${cell.disturb} seed=${cell.seed})`);
    }

    const runOk = runNode('scripts/run-scenario.js', [tmp, '--label', label], {
      TIMEOUT_MS: String(cell.timeoutMs),
    });

    if (injector) {
      injector.kill('SIGINT');
      await new Promise((r) => setTimeout(r, 3000));
      injector.kill('SIGKILL');
      await unpauseAll(cell.n);
      console.log('  disturbance injector stopped; all vehicles unpaused');
    }
    fs.rmSync(tmp, { force: true });
    if (!runOk) {
      console.error(`HALT at ${label}: run-scenario failed`);
      await db.end();
      process.exit(10);
    }

    const { rows } = await db.query(
      'SELECT id, ended_at FROM runs WHERE label = $1 ORDER BY id DESC LIMIT 1',
      [label],
    );
    if (rows.length === 0 || !rows[0].ended_at) {
      console.error(`HALT at ${label}: run row missing or left open`);
      await db.end();
      process.exit(11);
    }
    console.log(`  recorded run #${rows[0].id}`);
  }

  const stillPending = pending.length - batch.length;
  console.log(
    `\ncondition ${target} complete. ${stillPending} cell(s) remain under other conditions` +
      (stillPending > 0 ? ' — restart the kernel in the next condition and re-run.' : '.'),
  );
  await db.end();
}

const SKIP_METRIC_KEYS = new Set(['runId', 'label']);

/**
 * Flattens analyze.js's nested report into dotted keys, keeping numbers and the
 * reliability booleans (a run analyze.js flagged UNRELIABLE must stay visible
 * rather than being averaged in silently).
 */
function flattenInto(node, prefix, out) {
  for (const [k, v] of Object.entries(node)) {
    const key = `${prefix}${k}`;
    if (SKIP_METRIC_KEYS.has(key)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenInto(v, `${key}.`, out);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[key] = v;
    } else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      out[key] = Number(v);
    }
  }
}

async function aggregate(args) {
  const db = await connectDb();
  const { rows } = await db.query(
    'SELECT id, label, started_at, ended_at, notes FROM runs WHERE label LIKE $1 AND ended_at IS NOT NULL ORDER BY id',
    [`${args.prefix ?? ''}%`],
  );
  await db.end();

  if (rows.length === 0) {
    console.error('no completed runs match that prefix');
    process.exit(3);
  }

  const records = [];
  const metricKeys = new Set();
  for (const r of rows) {
    const res = spawnSync(process.execPath, [path.resolve('scripts/analyze.js'), '--run', String(r.id), '--json'], {
      encoding: 'utf8',
    });
    let metrics = {};
    try {
      const parsed = JSON.parse(res.stdout);
      const one = Array.isArray(parsed) ? parsed[0] : parsed;
      flattenInto(one ?? {}, '', metrics);
      const done = metrics['task.n_done'];
      const seconds = metrics.durationS;
      if (typeof done === 'number' && typeof seconds === 'number' && seconds > 0) {
        metrics.throughput_per_h = Number(((done / seconds) * 3600).toFixed(3));
      }
      for (const k of Object.keys(metrics)) metricKeys.add(k);
    } catch {
      metrics = {};
    }
    records.push({ ...parseLabel(r.label), runId: r.id, notes: r.notes ?? '', ...metrics });
  }

  // Label factors are read off the labels themselves: a matrix that adds one
  // (E6's d=low/d=high) must not have it silently dropped, which would leave
  // its arms indistinguishable in the same file.
  const CANONICAL_LABEL_KEYS = ['exp', 'cond', 'n', 'lam', 'seed', 'map'];
  const extraLabelKeys = [];
  for (const r of rows) {
    for (const k of Object.keys(parseLabel(r.label))) {
      if (!CANONICAL_LABEL_KEYS.includes(k) && !extraLabelKeys.includes(k)) extraLabelKeys.push(k);
    }
  }
  const head = [
    ...CANONICAL_LABEL_KEYS,
    ...extraLabelKeys,
    'runId',
    ...[...metricKeys].sort(),
  ];
  const lines = [head.join(',')];
  for (const rec of records) {
    lines.push(head.map((h) => (rec[h] === undefined ? '' : String(rec[h]))).join(','));
  }
  const csv = lines.join('\n') + '\n';

  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), csv);
    console.log(`wrote ${args.out}: ${records.length} runs x ${head.length} columns`);
  } else {
    process.stdout.write(csv);
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  if (args.aggregate) return aggregate(args);

  if (!args.matrix) {
    console.error('usage: run-matrix.js --matrix <spec.json> [--dry-run]');
    console.error('       run-matrix.js --aggregate --prefix E1 [--out e1.csv]');
    process.exit(2);
  }
  if (!args['dry-run'] && !process.env.WES_PASS) {
    console.error('WES_PASS is required (run-scenario.js authenticates with it)');
    process.exit(2);
  }
  return drive(args);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
