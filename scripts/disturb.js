/* eslint-disable */
// @ts-nocheck
/**
 * Seeded execution-disturbance injector for E6.
 *
 *   node scripts/disturb.js --level low --seed 3 --n 15 [--duration-min 30]
 *
 * Pauses random vehicles through the kernel's stock paused endpoint on a
 * schedule derived deterministically from (level, seed, vehicle index), so a
 * disturbance trace is exactly reproducible. The system under test is not
 * modified in any way — the injector is an external client.
 *
 *   level low  : per vehicle, a pause every 120 +/- 60 s lasting 5-15 s
 *   level high : per vehicle, a pause every  60 +/- 30 s lasting 15-45 s
 *
 * SIGINT or duration expiry unpauses every vehicle before exiting.
 * Env: KERNEL_URL (default http://localhost:55200).
 */

'use strict';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

const LEVELS = {
  low: { gapMeanS: 120, gapJitterS: 60, holdMinS: 5, holdMaxS: 15 },
  high: { gapMeanS: 60, gapJitterS: 30, holdMinS: 15, holdMaxS: 45 },
};

async function setPaused(kernel, vehicle, value) {
  const res = await fetch(
    `${kernel}/v1/vehicles/${encodeURIComponent(vehicle)}/paused?newValue=${value}`,
    { method: 'PUT' },
  );
  return res.status;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const level = LEVELS[args.level];
  const seed = Number(args.seed);
  const n = Number(args.n);
  if (!level || !Number.isInteger(seed) || !Number.isInteger(n) || n < 1) {
    console.error('usage: disturb.js --level <low|high> --seed <int> --n <fleet size> [--duration-min M]');
    process.exit(2);
  }
  const durationMs = Number(args['duration-min'] ?? 40) * 60000;
  const kernel = (process.env.KERNEL_URL ?? 'http://localhost:55200').replace(/\/$/, '');
  const vehicles = Array.from({ length: n }, (_, i) => `Vehicle-${String(i + 1).padStart(4, '0')}`);

  const paused = new Set();
  let stopping = false;
  async function unpauseAll() {
    for (const v of [...paused]) {
      const st = await setPaused(kernel, v, false).catch(() => 'ERR');
      console.log(`  unpause ${v}: ${st}`);
      paused.delete(v);
    }
  }
  process.on('SIGINT', async () => {
    if (stopping) return;
    stopping = true;
    console.log('\nSIGINT — unpausing everything');
    await unpauseAll();
    process.exit(130);
  });

  console.log(`disturb: level=${args.level} seed=${seed} fleet=${n} duration=${durationMs / 60000}min`);
  const t0 = Date.now();
  const workers = vehicles.map(async (v, idx) => {
    const rng = mulberry32((seed * 1000003 + idx * 7919) | 0);
    while (!stopping && Date.now() - t0 < durationMs) {
      const gapS = level.gapMeanS + (rng() * 2 - 1) * level.gapJitterS;
      await sleep(Math.max(5, gapS) * 1000);
      if (stopping || Date.now() - t0 >= durationMs) break;
      const holdS = level.holdMinS + rng() * (level.holdMaxS - level.holdMinS);
      const st = await setPaused(kernel, v, true).catch(() => 'ERR');
      if (st === 200) paused.add(v);
      console.log(`  +${((Date.now() - t0) / 1000).toFixed(0)}s pause ${v} for ${holdS.toFixed(1)}s (${st})`);
      await sleep(holdS * 1000);
      const st2 = await setPaused(kernel, v, false).catch(() => 'ERR');
      if (st2 === 200) paused.delete(v);
      console.log(`  +${((Date.now() - t0) / 1000).toFixed(0)}s resume ${v} (${st2})`);
    }
  });
  await Promise.all(workers);
  stopping = true;
  await unpauseAll();
  console.log('disturb: done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
