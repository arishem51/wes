/* eslint-disable */
// @ts-nocheck
/**
 * Steady-state throughput for saturation (lambda_sat) analysis.
 *
 *   node scripts/analyze-steady.js --prefix P1
 *   node scripts/analyze-steady.js --prefix P1 --trim 0.2 --csv out.csv
 *
 * Throughput over a run's TOTAL duration understates capacity, because the run
 * starts with an empty fleet ramping up and ends draining the last few tasks.
 * With a fixed cargo count those two phases are a large share of a short run,
 * so the measured rate never reaches the fleet's real capacity and the
 * saturation curve never plateaus.
 *
 * This computes two estimators per run instead:
 *
 *   trimmed  — drop the first and last `trim` fraction of deliveries and divide
 *              the remaining count by the time between them. A standard trimmed
 *              steady-state estimator; works for burst and paced arrivals alike.
 *   backlog  — throughput measured only while work was actually queued
 *              (arrivals so far > deliveries so far), i.e. while the fleet
 *              could not have been starved of work.
 *
 * A run's batch is the cargo created inside its [started_at, ended_at] window,
 * matching EVAL-RUNBOOK §3.
 *
 * Env: DATABASE_URL (required; read from ./.env when present).
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

function parseLabel(label) {
  const [exp, ...rest] = String(label).split('|');
  const kv = { exp };
  for (const part of rest) {
    const i = part.indexOf('=');
    if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1);
  }
  return kv;
}

function trimmedThroughput(deliveries, trim) {
  if (deliveries.length < 5) return null;
  const lo = Math.floor(deliveries.length * trim);
  const hi = Math.ceil(deliveries.length * (1 - trim)) - 1;
  if (hi <= lo) return null;
  const seconds = (deliveries[hi] - deliveries[lo]) / 1000;
  if (seconds <= 0) return null;
  return ((hi - lo) / seconds) * 3600;
}

/** Throughput counted only over intervals where undelivered work existed. */
function backlogThroughput(arrivals, deliveries) {
  if (deliveries.length === 0) return null;
  const events = [
    ...arrivals.map((t) => ({ t, kind: 'a' })),
    ...deliveries.map((t) => ({ t, kind: 'd' })),
  ].sort((x, y) => x.t - y.t || (x.kind === 'a' ? -1 : 1));

  let backlog = 0;
  let busyMs = 0;
  let deliveredWhileBusy = 0;
  let last = events[0].t;

  for (const e of events) {
    if (backlog > 0) busyMs += e.t - last;
    last = e.t;
    if (e.kind === 'a') backlog++;
    else {
      if (backlog > 0) deliveredWhileBusy++;
      backlog = Math.max(0, backlog - 1);
    }
  }
  if (busyMs <= 0) return null;
  return (deliveredWhileBusy / (busyMs / 1000)) * 3600;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const prefix = args.prefix ?? '';
  const trim = Number(args.trim ?? 0.2);
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const runs = await db.query(
    'SELECT id, label, started_at, ended_at FROM runs WHERE label LIKE $1 AND ended_at IS NOT NULL ORDER BY id',
    [`${prefix}%`],
  );

  const records = [];
  for (const run of runs.rows) {
    const { rows } = await db.query(
      `SELECT c.created_at AS arrival, t.occurred_at AS delivered
         FROM cargos c
         JOIN transport_requests tr ON tr.cargo_id = c.id
         LEFT JOIN task_status_transitions t
           ON t.task_id = tr.id AND t.to_status = 'DELIVERY_COMPLETED'
        WHERE c.created_at >= $1 AND c.created_at <= $2`,
      [run.started_at, run.ended_at],
    );
    const arrivals = rows.map((r) => new Date(r.arrival).getTime()).sort((a, b) => a - b);
    const deliveries = rows
      .filter((r) => r.delivered)
      .map((r) => new Date(r.delivered).getTime())
      .sort((a, b) => a - b);

    const durationS = (new Date(run.ended_at) - new Date(run.started_at)) / 1000;
    records.push({
      ...parseLabel(run.label),
      runId: run.id,
      arrivals: arrivals.length,
      delivered: deliveries.length,
      total_per_h: durationS > 0 ? (deliveries.length / durationS) * 3600 : null,
      trimmed_per_h: trimmedThroughput(deliveries, trim),
      backlog_per_h: backlogThroughput(arrivals, deliveries),
    });
  }
  await db.end();

  if (records.length === 0) {
    console.error('no completed runs match that prefix');
    process.exit(3);
  }

  const groups = new Map();
  for (const r of records) {
    const key = `${r.exp}|cond=${r.cond}|n=${r.n}|lam=${r.lam}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const avg = (list, f) => {
    const vals = list.map(f).filter((v) => typeof v === 'number' && Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const fmt = (v) => (v === null ? '     -' : v.toFixed(1).padStart(6));

  console.log(`trim = ${trim} (dropping the first and last ${(trim * 100).toFixed(0)}% of deliveries)\n`);
  console.log('  lambda  offered/h    total/h  trimmed/h  backlog/h   runs');
  console.log('  ' + '-'.repeat(60));
  const sorted = [...groups.entries()].sort((a, b) => Number(a[1][0].lam) - Number(b[1][0].lam));
  for (const [, list] of sorted) {
    const lam = Number(list[0].lam);
    const offered = lam > 0 ? lam * 60 : Infinity;
    console.log(
      `  ${String(lam).padStart(6)}  ${(lam > 0 ? offered.toFixed(0) : 'burst').padStart(9)}` +
        `  ${fmt(avg(list, (r) => r.total_per_h))}   ${fmt(avg(list, (r) => r.trimmed_per_h))}` +
        `   ${fmt(avg(list, (r) => r.backlog_per_h))}  ${String(list.length).padStart(5)}`,
    );
  }

  if (args.csv) {
    const head = ['exp', 'cond', 'n', 'lam', 'seed', 'runId', 'arrivals', 'delivered', 'total_per_h', 'trimmed_per_h', 'backlog_per_h'];
    const lines = [head.join(',')];
    for (const r of records) lines.push(head.map((h) => (r[h] === null || r[h] === undefined ? '' : r[h])).join(','));
    fs.writeFileSync(path.resolve(args.csv), lines.join('\n') + '\n');
    console.log(`\nwrote ${args.csv}: ${records.length} runs`);
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
