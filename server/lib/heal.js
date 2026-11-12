// The checks the command runs before it starts the studio, and what it does when one fails:
//   packages   each dependency is loaded in a separate Node process; when any don't load, the
//              command stops with one sentence naming the folder to delete (npm's copy of the app)
//              so the next run downloads the release again from its lock file. It never installs
//              packages itself.
//   processes  a studio from an earlier start that is stuck (alive but not answering) is stopped,
//              but only when it is provably ours (isStudio)
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
// half-loaded copy). Returns the names that are missing or fail to load, or null when the check
// itself didn't finish cleanly (timed out, crashed, or printed something other than a list of
// those names): an unclear answer is not taken as "everything is broken".
export function brokenPackages(names, { cwd = pkgDir(), node = process.execPath } = {}) {
  if (!names.length) return [];
  const script = `const out=[];for (const n of ${JSON.stringify(names)}) { try { await import(n); } catch { out.push(n); } } process.stdout.write(JSON.stringify(out));`;
  const r = spawnSync(node, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8', timeout: 60000 });
  if (r.error || r.status !== 0) return null;
  let out;
  try { out = JSON.parse(r.stdout); } catch { return null; }
  return Array.isArray(out) && out.every((n) => names.includes(n)) ? out : null;
}

// npx keeps the app at <cache>/_npx/<hash>/node_modules/fishbowl-studio. Returns <cache>/_npx/<hash>,
// the folder that holds only npm's copy of this app, or null when the app isn't running from there.
export function npxEntry(dir) {
  const parts = path.resolve(dir).split(path.sep);
  const n = parts.length;
  if (n < 5 || parts[n - 1] !== 'fishbowl-studio' || parts[n - 2] !== 'node_modules' || !/^[0-9a-f]{8,}$/.test(parts[n - 3]) || parts[n - 4] !== '_npx') return null;
  return parts.slice(0, n - 2).join(path.sep);
}

// The sentence for a copy of the app with packages missing.
export function repairSentence(broken, dir) {
  const entry = npxEntry(dir);
  const what = `Fishbowl Studio is missing some of its files (${broken.join(', ')}).`;
  if (entry) return `${what} Delete the folder ${entry} (npm's downloaded copy of the app; your brands aren't in it), then run the same command again: it downloads a fresh copy.`;
  return `${what} Run npm ci in ${dir}, then run the command again.`;
}

// Checks the dependencies in package.json. Returns quietly when they all load or when the check
// can't tell; throws the repair sentence when any are missing.
export function ensurePackages({ dir = pkgDir(), check = brokenPackages } = {}) {
  let names;
  try { names = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies || {}); }
  catch { return; }
  const broken = check(names, { cwd: dir });
  if (broken && broken.length) throw new Error(repairSentence(broken, dir));
}

// Only a process this user owns counts: signalling someone else's fails with EPERM.
export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function ps(field, pid) {
  if (process.platform === 'win32') return null;
  try {
    return execFileSync('ps', ['-ww', '-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

// The command line of a process, or null where ps isn't available.
export const commandOf = (pid) => ps('command', pid);

// When a process started, as ps prints it (to the second), or null. Recorded in the lock file so a
// later start can tell the studio that wrote it from another process that reused its pid.
export const startedAt = (pid) => ps('lstart', pid);

// This process's parent, its parent's parent and so on: npx and the shell that started us carry
// "fishbowl-studio" in their command lines too, and are never ours to stop.
export function lineage(pid = process.pid, parentOf = (p) => Number(ps('ppid', p))) {
  const seen = new Set();
  for (let p = parentOf(pid), i = 0; Number.isInteger(p) && p > 1 && !seen.has(p) && i < 64; p = parentOf(p), i++) seen.add(p);
  return seen;
}

// The command line of a running studio, whole: node running the app's bin/fishbowl-studio.js (or
// the node_modules/.bin link npx runs), or the standalone build, followed by nothing but options.
// A command line that merely mentions fishbowl-studio (an editor, grep, npm exec) doesn't match.
export const STUDIO_COMMAND = /^(?:(?:\S*\/)?node(?:\.exe)? +\S*\/(?:bin\/fishbowl-studio\.js|\.bin\/fishbowl-studio)|(?:\S*\/)?fishbowl-studio)(?: +--.*)?$/;

// A process is ours when it is alive, isn't this one or one of its ancestors, and its whole command
// line is a studio's. Given `started` (from a lock file), its start time must match too; a lock
// without one never matches.
export function isStudio(pid, { started, command = commandOf, startedOf = startedAt, isAlive = alive, ancestors = lineage } = {}) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;
  if (started !== undefined && (typeof started !== 'string' || !started)) return false;
  if (!isAlive(pid) || ancestors().has(pid)) return false;
  if (!STUDIO_COMMAND.test(command(pid) || '')) return false;
  return started === undefined || startedOf(pid) === started;
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
