// The checks the command runs before it starts the studio, and the repairs it makes when one fails:
//   packages   each dependency is loaded in a separate Node process; any that don't load are
//              reinstalled once with npm, then checked again
//   processes  a studio from an earlier start that is stuck (alive but not answering) is stopped
//   port       a port held by our own stuck studio is freed; one held by anything else is left alone
// Every failure that can't be repaired ends in one plain sentence for the person, not a stack trace.
// Built-in modules only: the launcher loads this before it knows the packages are there.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The app's own folder. Asked for only outside the standalone build, which has no folder of its own.
export const pkgDir = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Loads each package in a fresh Node process (so a broken one can't leave this process holding a
// half-loaded copy) and returns the names that are missing or fail to load.
export function brokenPackages(names, { cwd = pkgDir(), node = process.execPath } = {}) {
  if (!names.length) return [];
  const script = `const out=[];for (const n of ${JSON.stringify(names)}) { try { await import(n); } catch { out.push(n); } } process.stdout.write(JSON.stringify(out));`;
  const r = spawnSync(node, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(r.stdout); } catch { return names; }
}

// npm as the running npx found it, or from PATH.
export function npmCommand(env = process.env, platform = process.platform) {
  if (env.npm_execpath && /\.c?js$/.test(env.npm_execpath)) return [process.execPath, [env.npm_execpath]];
  return [platform === 'win32' ? 'npm.cmd' : 'npm', []];
}

export const INSTALL_ARGS = ['install', '--omit=dev', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error'];

// Checks the dependencies in package.json and reinstalls them once if any are missing.
// Returns the names it repaired; throws a plain error when it can't repair them.
export function ensurePackages({ dir = pkgDir(), say = (s) => process.stderr.write(`${s}\n`), check = brokenPackages, install = runInstall } = {}) {
  let names;
  try { names = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies || {}); }
  catch { return []; }
  const broken = check(names, { cwd: dir });
  if (!broken.length) return [];
  say(`Fishbowl Studio is missing some of its files (${broken.join(', ')}). Repairing them now; this needs the internet and can take a minute.`);
  const ok = install(dir);
  const still = ok ? check(names, { cwd: dir }) : broken;
  if (still.length) {
    throw new Error(`Fishbowl Studio couldn't repair its files (${still.join(', ')} still missing). Check that this computer is online, then run the same command again.`);
  }
  say('Repaired.');
  return broken;
}

function runInstall(dir) {
  const [cmd, pre] = npmCommand();
  const r = spawnSync(cmd, [...pre, ...INSTALL_ARGS], { cwd: dir, stdio: ['ignore', 2, 2], timeout: 300000, shell: process.platform === 'win32' });
  return r.status === 0;
}

// Only a process this user owns counts: signalling someone else's fails with EPERM.
export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// The command line of a process, or null where ps isn't available.
export function commandOf(pid) {
  if (process.platform === 'win32') return null;
  try { return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; }
  catch { return null; }
}

// A process is ours when it is alive, isn't this one, and was started as fishbowl-studio.
export function isStudio(pid, { command = commandOf, isAlive = alive } = {}) {
  return Number.isInteger(pid) && pid > 0 && pid !== process.pid && isAlive(pid) && /fishbowl-studio/i.test(command(pid) || '');
}

// The process listening on 127.0.0.1:<port>, or null where lsof isn't available or nothing listens.
export function portHolder(port) {
  if (process.platform === 'win32') return null;
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP@127.0.0.1:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pid = Number(out.split('\n')[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

// True when something on the port answers an HTTP request within the time limit.
export async function answers(port, ms = 3000) {
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(ms), redirect: 'manual' }); return true; }
  catch { return false; }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Stops a process: asks first (SIGTERM, and SIGCONT in case it was paused), then forces it.
// Returns true once it is gone.
export async function stopProcess(pid, { isAlive = alive, graceMs = 5000, killMs = 2000 } = {}) {
  const send = (sig) => { try { process.kill(pid, sig); } catch { /* gone or not ours */ } };
  send('SIGTERM');
  if (process.platform !== 'win32') send('SIGCONT');
  for (let t = 0; t < graceMs; t += 100) { if (!isAlive(pid)) return true; await wait(100); }
  send('SIGKILL');
  for (let t = 0; t < killMs; t += 100) { if (!isAlive(pid)) return true; await wait(100); }
  return !isAlive(pid);
}
