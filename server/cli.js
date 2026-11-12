// The fishbowl-studio command: starts the studio on this computer and opens it in the browser.
// It runs until the window it was started from is closed or Ctrl+C. If the studio is already
// running, it opens a new link to that one instead of starting a second.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveHome } from '#core/store.js';
import { makeHost } from './lib/host.js';
import { makeServer } from './lib/web.js';
import { setExtractArgs } from '#core/brandkit.js';
import { STORE_LABELS } from './lib/keystore.js';
import { controlRequest, answerValid } from './lib/control.js';

export const TICK_MS = 5 * 60 * 1000;
export const LOCK_FILE = 'server.json';

export const HELP = `Fishbowl Studio: drafts social posts from the news, on your computer.

  fishbowl-studio              start the studio and open it in your browser
  fishbowl-studio --no-open    start it and only print the link
  fishbowl-studio --port 4100  use this port instead of a free one
  fishbowl-studio --home DIR   keep the studio's files in DIR
                               (default: Documents/Fishbowl Studio in your home folder)
  fishbowl-studio --version    print the version

It runs while this window is open. Press Ctrl+C to stop it.
`;

export function parseArgs(argv) {
  const o = { open: true, port: 0, home: null, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') o.open = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--port' || a === '--home') {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value.`);
      if (a === '--port') {
        o.port = Number(v);
        if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error('--port needs a number from 1 to 65535.');
      } else o.home = path.resolve(v);
    } else throw new Error(`Unknown option ${a}. Run fishbowl-studio --help to see the options.`);
  }
  return o;
}

// Opens a URL in the default browser. Failing is fine: the link is printed too.
export function browserCommand(url, platform = process.platform) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}
export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const [cmd, args] = browserCommand(url, platform);
  try {
    const child = spawnImpl(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* the printed link still works */ }
}

// Only a process this user owns counts: EPERM means the pid now belongs to someone else.
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

// Another copy already running for this folder: ask it for a fresh launch link. Its answer is
// trusted only with a proof made from the lock file's control secret (control.js), so a stale
// lock file can't send the browser to whatever else now listens on that port.
export async function askRunning(lockFile, { isAlive = alive } = {}) {
  let lock;
  try { lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch { return null; }
  if (!lock || !Number.isInteger(lock.pid) || !Number.isInteger(lock.port) || typeof lock.control !== 'string' || !isAlive(lock.pid)) return null;
  try {
    const { nonce, headers } = controlRequest(lock.control);
    const r = await fetch(`http://127.0.0.1:${lock.port}/control/launch`, { method: 'POST', headers, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const { url, proof } = await r.json();
    if (typeof url !== 'string' || !url.startsWith(`http://127.0.0.1:${lock.port}/`)) return null;
    return answerValid(lock.control, nonce, url, proof) ? url : null;
  } catch { return null; }
}

function writePrivate(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// The old desktop app kept its run-on-its-own preference in its own folder; carry it over once.
function carryOverPrefs(appDir, env = process.env) {
  const target = path.join(appDir, 'prefs.json');
  if (fs.existsSync(target)) return;
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? env.APPDATA : (env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  if (!base) return;
  try {
    const old = JSON.parse(fs.readFileSync(path.join(base, 'Fishbowl Studio', 'prefs.json'), 'utf8'));
    if (typeof old.autorun === 'boolean') writePrivate(target, JSON.stringify({ autorun: old.autorun, engine: 'auto' }, null, 2) + '\n');
  } catch { /* nothing to carry over */ }
}

function engineLine(status) {
  if (status.engine === 'claude') return 'Drafting with Claude Code, on your Claude plan.';
  if (status.engine === 'api') return 'Drafting with your Anthropic API key.';
  return 'Not connected to Claude yet: the studio will walk you through it.';
}

// Starts the studio. Returns { origin, launchUrl, close } (or { reused: url } when another copy
// is running), for tests and for the signal handlers.
export async function main(argv = process.argv.slice(2), { env = process.env, out = process.stdout, open = openBrowser, makeHostImpl = makeHost, signals = true } = {}) {
  const say = (s) => out.write(`${s}\n`);
  const o = parseArgs(argv);
  if (o.help) { out.write(HELP); return null; }
  if (o.version) {
    const { readOwn } = await import('./lib/files.js');
    say(JSON.parse(readOwn('package.json')).version);
    return null;
  }
  if (globalThis.__FISHBOWL_FILES__) setExtractArgs(['--extract-child']);

  const home = o.home || resolveHome(env);
  const appDir = path.join(home, 'app');
  try { fs.mkdirSync(appDir, { recursive: true }); fs.accessSync(appDir, fs.constants.W_OK); }
  catch (e) {
    const mac = process.platform === 'darwin' ? ' On a Mac, allow your terminal to use the Documents folder (System Settings, Privacy & Security, Files and Folders).' : '';
    throw new Error(`Fishbowl Studio can't write to ${home} (${e.code || e.message}).${mac} Or choose another folder: fishbowl-studio --home <folder>`);
  }
  const lockFile = path.join(appDir, LOCK_FILE);

  const running = await askRunning(lockFile);
  if (running) {
    say(`Fishbowl Studio is already running. Opening it: ${running}`);
    if (o.open) open(running);
    return { reused: running };
  }

  carryOverPrefs(appDir, env);
  let srv = null;
  const host = makeHostImpl({ home, appDir, emit: (ev) => srv && srv.emit(ev) });
  srv = makeServer({ host, port: o.port });
  try { await srv.listen(); }
  catch (e) {
    if (e.code === 'EADDRINUSE') throw new Error(`Port ${o.port} is in use. Run it without --port to pick a free one.`);
    throw e;
  }
  writePrivate(lockFile, JSON.stringify({ pid: process.pid, port: Number(new URL(srv.origin).port), control: srv.control }) + '\n');

  const { batches, drafts } = host.catchUp();
  const url = srv.launchUrl();
  say('Fishbowl Studio is running.');
  say(`Studio folder: ${home}`);
  say(engineLine(host.engine.status()));
  const where = host.keys.where();
  if (where) say(`Your API key is kept in: ${STORE_LABELS[where]}.`);
  if (batches) {
    const msg = `${drafts} draft${drafts === 1 ? '' : 's'} came due while the studio was closed (${batches} batch${batches === 1 ? '' : 'es'}); they're waiting for review now.`;
    say(msg);
    srv.emit({ kind: 'notice', state: 'notice', message: msg });
  }
  say('');
  say(`Open it here (the link works once): ${url}`);
  say('Keep this window open while you use it. Press Ctrl+C to stop.');
  if (o.open) open(url);

  const tick = () => host.tick().catch(() => {});
  const timer = setInterval(tick, TICK_MS);
  tick();

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    try { if (JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === process.pid) fs.rmSync(lockFile, { force: true }); } catch { /* already gone */ }
    await srv.close();
  }
  if (signals) {
    const stop = () => { say('\nStopped. Run the command again to start it.'); close().finally(() => process.exit(0)); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    if (process.platform !== 'win32') process.once('SIGHUP', stop);
  }
  return { origin: srv.origin, launchUrl: srv.launchUrl, close, host, home };
}
