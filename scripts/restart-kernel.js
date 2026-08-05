/* eslint-disable */
// @ts-nocheck
/**
 * Restarts the openTCS FMS kernel in a chosen evaluation condition.
 *
 *   node scripts/restart-kernel.js --condition B1 --fleet 15
 *   node scripts/restart-kernel.js --condition S1 --dry-run
 *
 * Guice bindings are fixed at boot, so switching between B0/B1/S1/S2/S3 means
 * restarting the kernel. This stops the running kernel JVM (and the Gradle
 * wrapper that launched it), starts a fresh one with -Dfms.condition, waits
 * until it answers AND its log confirms the requested condition, then restores
 * the fleet to `--fleet` vehicles.
 *
 * Process selection is deliberately narrow: only a JVM whose command line has
 * BOTH `opentcs.base` and `opentcs-FMS-kernel`, and which is not a Gradle
 * wrapper, is considered the kernel. Operations Desk and the other openTCS apps
 * are never matched. Use --dry-run to see what would be killed.
 *
 * Env: WES_PASS (for the fleet restore), KERNEL_URL, KERNEL_LOG, KERNEL_DIR.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_KERNEL_DIR = 'D:/WES/opentcs-integration-FMS';
const DEFAULT_KERNEL_LOG =
  'D:/WES/opentcs-integration-FMS/opentcs-FMS-kernel/build/install/opentcs-FMS-kernel/log/opentcs-kernel.0.log';
const VALID = new Set(['B0', 'B0_PRIME', 'B1', 'S1', 'S2', 'S3']);

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

function powershell(script) {
  const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  return (res.stdout ?? '').trim();
}

function findKernelProcesses() {
  const out = powershell(
    "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | " +
      'Where-Object { $_.CommandLine -match \'opentcs-FMS-kernel\' } | ' +
      'ForEach-Object { $_.ProcessId.ToString() + \'|\' + ($_.CommandLine -replace \'\\s+\', \' \') }',
  );
  const app = [];
  const wrapper = [];
  for (const line of out.split('\n')) {
    const i = line.indexOf('|');
    if (i < 0) continue;
    const pid = Number(line.slice(0, i).trim());
    const cmd = line.slice(i + 1);
    if (!Number.isInteger(pid)) continue;
    const isWrapper = /org\.gradle\.appname|gradle-wrapper/.test(cmd);
    if (isWrapper) wrapper.push({ pid, cmd });
    else if (/opentcs\.base/.test(cmd)) app.push({ pid, cmd });
  }
  return { app, wrapper };
}

async function kernelUp(kernelUrl) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${kernelUrl}/v1/vehicles`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function loggedCondition(logPath) {
  if (!fs.existsSync(logPath)) return null;
  const matches = [...fs.readFileSync(logPath, 'utf8').matchAll(/evaluation condition ([A-Z0-9_]+)/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, timeoutMs, everyMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(everyMs);
  }
  console.error(`TIMEOUT waiting for ${what} after ${timeoutMs}ms`);
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const condition = String(args.condition ?? '').toUpperCase().replace(/['′-]/g, '_').replace('B0_PRIME', 'B0_PRIME');
  if (!VALID.has(condition)) {
    console.error(`usage: restart-kernel.js --condition <${[...VALID].join('|')}> [--fleet N] [--dry-run]`);
    process.exit(2);
  }

  const kernelUrl = (process.env.KERNEL_URL ?? 'http://localhost:55200').replace(/\/$/, '');
  const kernelDir = process.env.KERNEL_DIR ?? DEFAULT_KERNEL_DIR;
  const kernelLog = process.env.KERNEL_LOG ?? DEFAULT_KERNEL_LOG;

  const { app, wrapper } = findKernelProcesses();
  console.log(`kernel JVM(s): ${app.map((p) => p.pid).join(', ') || 'none'}`);
  console.log(`gradle wrapper(s): ${wrapper.map((p) => p.pid).join(', ') || 'none'}`);

  if (args['dry-run']) {
    for (const p of [...app, ...wrapper]) console.log(`  would kill ${p.pid}: ${p.cmd.slice(0, 150)}`);
    console.log(`  would start: gradlew :opentcs-FMS-kernel:run -Pcondition=${condition} (cwd ${kernelDir})`);
    return;
  }

  for (const p of [...app, ...wrapper]) {
    spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { encoding: 'utf8' });
    console.log(`killed ${p.pid}`);
  }

  if (!(await waitFor(async () => !(await kernelUp(kernelUrl)), 60000, 1000, 'kernel to go down'))) {
    process.exit(3);
  }
  console.log('kernel down');

  const restartEpochMs = Date.now();
  const child = spawn(
    `start "FMS kernel ${condition}" /D "${kernelDir}" gradlew.bat :opentcs-FMS-kernel:run -Pcondition=${condition}`,
    { shell: true, detached: true, stdio: 'ignore' },
  );
  child.unref();
  console.log(`starting kernel in condition ${condition} (gradle pid ${child.pid})`);

  if (!(await waitFor(() => kernelUp(kernelUrl), 300000, 3000, 'kernel to answer'))) process.exit(4);
  console.log('kernel is up');

  const confirmed = await waitFor(
    async () => {
      if (!fs.existsSync(kernelLog)) return false;
      const freshSinceRestart = fs.statSync(kernelLog).mtimeMs >= restartEpochMs;
      return freshSinceRestart && loggedCondition(kernelLog) === condition;
    },
    60000,
    2000,
    `log to confirm condition ${condition}`,
  );
  if (!confirmed) {
    console.error(`BLOCKED: kernel is up but its log does not confirm condition ${condition}` +
      ` (last seen: ${loggedCondition(kernelLog)}). Do not run the matrix against this kernel.`);
    process.exit(5);
  }
  console.log(`condition ${condition} confirmed in kernel log`);

  if (args.fleet !== undefined) {
    const n = Number(args.fleet);
    const res = spawnSync(process.execPath, [path.resolve('scripts/set-fleet.js'), '--n', String(n)], {
      stdio: 'inherit',
    });
    if (res.status !== 0) {
      console.error('BLOCKED: fleet could not be restored after restart');
      process.exit(6);
    }
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
