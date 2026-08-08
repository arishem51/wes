/* eslint-disable */
// @ts-nocheck
/**
 * Turns the E3 kernel telemetry into the two CSVs the paper's planner-mode
 * table is computed from.
 *
 *   node scripts/parse-e3.js [--dir <logs>] [--out <data dir>]
 *
 * Reads one `<arm>.log` per arm — the lines the sweep collected from the kernel
 * log — and writes:
 *
 *   e3-solves.csv    one row per solve: arm, time, kind, window, agents,
 *                    immobile, loops, budget, nodes, solverMs, resolveMs
 *   e3-summary.csv   one row per arm: latency percentiles over the joint
 *                    solves, the share that hit the wall clock, and the
 *                    non-fallback share
 *
 * Joint and solo solves are kept apart. A solo solve plans one vehicle to one
 * goal and is not what the planner-mode arms vary, so mixing the two would
 * dilute every statistic with work the arm does not touch. They are told apart
 * by the shape of the instance — one agent and nothing masked — rather than by
 * the window, because the WINDOW_FULL arm gives its joint solves the same
 * unbounded window a solo solve always uses.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TS = /^\[(\d{8})-(\d{2}):(\d{2}):(\d{2})-(\d{3})\]/;
const E2E = /\[MAPF e2e\] resolveMs=(\d+) agents=(\d+) cached=(\d+)/;
const SOLVED = /\[MAPF solve\] method=lacam2-windowed window=(\d+) agents=(\d+) immobile=(\d+) .*?loops=(\d+)\/(\d+).*?nodes=(\d+) in (\d+)ms/;
const REFUSED = /\[MAPF solve\] lacam2 returned NO plan \(agents=(\d+) window=(\d+) loops=(\d+)\/(\d+)/;
const WINDOW_FULL = 2147483647;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}

function stamp(line) {
  const m = line.match(TS);
  return m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]}.${m[5]}` : '';
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir ?? 'D:/WES/paper/stage7-icacr/data/e3';
  const outDir = args.out ?? 'D:/WES/paper/stage7-icacr/data';

  const arms = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.log'))
    .map((f) => path.basename(f, '.log'));
  if (arms.length === 0) {
    console.error(`no arm logs in ${dir}`);
    process.exit(2);
  }

  const solveRows = [];
  const summary = [];

  for (const arm of arms) {
    const lines = fs.readFileSync(path.join(dir, `${arm}.log`), 'utf8').split('\n');
    const resolveMs = [];
    let joint = 0;
    let solo = 0;
    let refusedJoint = 0;
    let refusedSolo = 0;
    let deadlineHits = 0;
    let budgetHits = 0;

    for (const line of lines) {
      const e2e = line.match(E2E);
      if (e2e) {
        const ms = Number(e2e[1]);
        resolveMs.push(ms);
        solveRows.push([arm, stamp(line), 'resolve', '', e2e[2], '', '', '', '', '', ms]);
        continue;
      }
      const ok = line.match(SOLVED);
      if (ok) {
        const window = Number(ok[1]);
        const kind = Number(ok[2]) === 1 && Number(ok[3]) === 0 ? 'solo' : 'joint';
        if (kind === 'joint') joint++;
        else solo++;
        const loops = Number(ok[4]);
        const budget = Number(ok[5]);
        const solverMs = Number(ok[7]);
        if (kind === 'joint') {
          if (solverMs >= 1000) deadlineHits++;
          if (loops >= budget) budgetHits++;
        }
        solveRows.push([
          arm, stamp(line), kind, window === WINDOW_FULL ? 'full' : window,
          ok[2], ok[3], loops, budget, ok[6], solverMs, '',
        ]);
        continue;
      }
      const no = line.match(REFUSED);
      if (no) {
        const window = Number(no[2]);
        const kind = Number(no[1]) === 1 ? 'solo' : 'joint';
        if (kind === 'joint') refusedJoint++;
        else refusedSolo++;
        solveRows.push([
          arm, stamp(line), `${kind}-refused`, window === WINDOW_FULL ? 'full' : window,
          no[1], '', no[3], no[4], '', '', '',
        ]);
      }
    }

    const sorted = resolveMs.slice().sort((a, b) => a - b);
    const jointTotal = joint + refusedJoint;
    summary.push({
      arm,
      resolves: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: sorted.length ? sorted[sorted.length - 1] : null,
      deadline_hit_pct: jointTotal ? +((100 * deadlineHits) / jointTotal).toFixed(2) : null,
      budget_hit_pct: jointTotal ? +((100 * budgetHits) / jointTotal).toFixed(2) : null,
      joint_solves: joint,
      joint_refused: refusedJoint,
      nonfallback_pct: jointTotal ? +((100 * joint) / jointTotal).toFixed(2) : null,
      solo_solves: solo,
      solo_refused: refusedSolo,
    });
  }

  const solveHeader = [
    'arm', 'time', 'kind', 'window', 'agents', 'immobile',
    'loops', 'budget', 'nodes', 'solverMs', 'resolveMs',
  ];
  fs.writeFileSync(
    path.join(outDir, 'e3-solves.csv'),
    [solveHeader.join(','), ...solveRows.map((r) => r.join(','))].join('\n') + '\n',
  );

  const sumHeader = Object.keys(summary[0]);
  fs.writeFileSync(
    path.join(outDir, 'e3-summary.csv'),
    [sumHeader.join(','), ...summary.map((s) => sumHeader.map((k) => s[k] ?? '').join(','))].join('\n') + '\n',
  );

  console.log(`e3-solves.csv: ${solveRows.length} rows`);
  console.log(`e3-summary.csv: ${summary.length} arms`);
  for (const s of summary) {
    console.log(
      `  ${s.arm.padEnd(6)} resolves=${String(s.resolves).padStart(5)}` +
        ` p50=${String(s.p50).padStart(4)} p95=${String(s.p95).padStart(4)} p99=${String(s.p99).padStart(4)} max=${String(s.max).padStart(4)}` +
        ` | deadline=${s.deadline_hit_pct}% budget=${s.budget_hit_pct}%` +
        ` | joint=${s.joint_solves} refused=${s.joint_refused} nonfallback=${s.nonfallback_pct}%`,
    );
  }
}

main();
