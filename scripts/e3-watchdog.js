/* eslint-disable */
// @ts-nocheck
/**
 * Keeps the E3 sweep alive while it runs unattended.
 *
 *   node scripts/e3-watchdog.js
 *
 * The sweep restarts the kernel once per arm and then trusts it for the arm's
 * five cells. A kernel that dies mid-arm therefore costs the rest of that arm:
 * run-matrix halts, and the sweep moves on. This watchdog cannot rescue the
 * cell that was in flight, but it does the two things that keep the night from
 * being wasted — it voids the run the dead kernel left open, so no half-run is
 * ever aggregated, and it brings the kernel back with the flags the current arm
 * needs, so the remaining cells and arms still have something to run against.
 *
 * The arm is read from the most recent E3 run label rather than from the sweep
 * script, so the two stay decoupled and the watchdog can be started or
 * restarted at any point.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const ARM_FLAGS = {
  E3w5: 'fms.mapf.window=5',
  E3w10: '',
  E3w20: 'fms.mapf.window=20',
  E3wfull: 'fms.mapf.window=0',
  E3noany: 'fms.mapf.anytime=false',
};

const KERNEL_URL = (process.env.KERNEL_URL ?? 'http://localhost:55200').replace(/\/$/, '');
const CHECK_MS = 60000;

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

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function kernelAlive() {
  try {
    const res = await fetch(`${KERNEL_URL}/v1/vehicles`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const all = await res.json();
    return Array.isArray(all) && all.length > 0;
  } catch {
    return false;
  }
}

async function currentArm(db) {
  const { rows } = await db.query(
    "SELECT label FROM runs WHERE label LIKE 'E3%' ORDER BY id DESC LIMIT 1",
  );
  if (rows.length === 0) return null;
  return String(rows[0].label).split('|')[0];
}

async function voidOpenRuns(db) {
  const { rows } = await db.query(
    "UPDATE runs SET ended_at = NULL," +
      " notes = coalesce(notes,'') || ' | VOIDED: kernel died mid-cell (e3 watchdog)'" +
      " WHERE label LIKE 'E3%' AND ended_at IS NULL RETURNING id",
  );
  return rows.map((r) => r.id);
}

function restartKernel(flags) {
  const argv = ['scripts/restart-kernel.js', '--condition', 'S1', '--fleet', '15'];
  if (flags) argv.push('--flags', flags);
  const res = spawnSync(process.execPath, argv, { encoding: 'utf8', stdio: 'inherit' });
  return res.status === 0;
}

async function main() {
  loadEnv();
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  log('e3 watchdog armed');

  let downStreak = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, CHECK_MS));
    const alive = await kernelAlive();
    if (alive) {
      downStreak = 0;
      continue;
    }
    downStreak++;
    // one missed check can be a restart the sweep itself is performing between
    // arms; two in a row means nobody is bringing it back
    if (downStreak < 2) {
      log('kernel not answering — waiting one more cycle before acting');
      continue;
    }

    const arm = await currentArm(db);
    const flags = arm && arm in ARM_FLAGS ? ARM_FLAGS[arm] : '';
    const voided = await voidOpenRuns(db);
    log(`kernel down; arm=${arm ?? 'unknown'} flags=${flags || '(defaults)'} voided=[${voided.join(',')}]`);

    if (restartKernel(flags)) {
      log('kernel restored');
    } else {
      log('restart-kernel reported a failure; will retry next cycle');
    }
    downStreak = 0;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
