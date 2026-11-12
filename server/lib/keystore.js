// The Anthropic API key. It goes to the operating system's own secret store when there is one
// this app can reach without native modules:
//   macOS    the login Keychain, through /usr/bin/security
//   Linux    the Secret Service (GNOME Keyring, KWallet), through secret-tool, if installed
//   Windows  DPAPI (encrypted for this Windows user), through PowerShell; the ciphertext is
//            kept in the app folder
// Otherwise it goes to a file only this user can read (mode 0600) in the app folder. The key is
// handed to those tools on stdin, never in a command line. It is never logged and never sent to
// the browser: only has(), where it is kept and a masked hint leave this module.
//
// ANTHROPIC_API_KEY in the environment is used when nothing is stored, read-only.
//
// key.json in the app folder records which store holds the key and its last four characters.
//
// Each studio folder has its own entry in the Keychain and the Secret Service: the account name
// ends in a short hash of the app folder's real path (keyAccount), so two studios started with
// different --home folders never read, replace or delete each other's key.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';

export const KEY_FILE = 'anthropic-key';
export const DPAPI_FILE = 'anthropic-key.dpapi';
export const MARK_FILE = 'key.json';
const SERVICE = 'Fishbowl Studio';
const ACCOUNT = 'anthropic-api-key';

// The account name this app folder's key is stored under.
export function keyAccount(dir) {
  if (!dir) throw new Error('The key store needs the app folder.');
  let real;
  try { real = fs.realpathSync(dir); } catch { real = path.resolve(dir); }
  return `${ACCOUNT}-${createHash('sha256').update(real).digest('hex').slice(0, 16)}`;
}

export const STORE_LABELS = {
  keychain: 'the macOS Keychain',
  'secret-service': 'your desktop keyring (Secret Service)',
  dpapi: 'Windows data protection (DPAPI)',
  file: 'a file only your user account can read',
  env: 'the ANTHROPIC_API_KEY environment variable',
};

export function checkKey(raw) {
  const key = String(raw ?? '').trim();
  if (!key) return { ok: false, reason: 'Paste your Anthropic API key.' };
  if (/\s/.test(key) || key.length < 20 || key.length > 400) return { ok: false, reason: 'That does not look like an API key.' };
  if (!/^[A-Za-z0-9_\-]+$/.test(key)) return { ok: false, reason: 'That does not look like an API key.' };
  return { ok: true, key };
}

// Run a program with input on stdin. Resolves {code, stdout}; never rejects, never logs.
export function runTool(cmd, args, input = '') {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || '') });
    });
    child.on('error', () => {});
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

const onPath = (name, env = process.env) => (env.PATH || '').split(path.delimiter).filter(Boolean)
  .some((d) => { try { return fs.statSync(path.join(d, name)).isFile(); } catch { return false; } });

// The OS stores. Each has set(key) -> bool, get() -> key|null, clear(). run is runTool or a fake.
export function osStore({ platform = process.platform, run = runTool, dir, env = process.env } = {}) {
  if (platform === 'darwin') {
    const sec = '/usr/bin/security';
    const account = keyAccount(dir);
    return {
      name: 'keychain',
      // `security -i` reads its command from stdin, so the key is not in any process's argv.
      async set(key) {
        const r = await run(sec, ['-i'], `add-generic-password -U -s "${SERVICE}" -a ${account} -w ${key}\n`);
        return r.code === 0 && (await this.get()) === key;
      },
      async get() {
        const r = await run(sec, ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
        return r.code === 0 ? r.stdout.trim() || null : null;
      },
      async clear() { await run(sec, ['delete-generic-password', '-s', SERVICE, '-a', account]); },
    };
  }
  if (platform === 'linux') {
    if (!onPath('secret-tool', env)) return null;
    const attrs = ['service', 'fishbowl-studio', 'account', keyAccount(dir)];
    return {
      name: 'secret-service',
      // secret-tool store reads the secret from stdin.
      async set(key) {
        const r = await run('secret-tool', ['store', `--label=${SERVICE} API key`, ...attrs], key);
        return r.code === 0 && (await this.get()) === key;
      },
      async get() {
        const r = await run('secret-tool', ['lookup', ...attrs]);
        return r.code === 0 ? r.stdout.trim() || null : null;
      },
      async clear() { await run('secret-tool', ['clear', ...attrs]); },
    };
  }
  if (platform === 'win32') {
    const file = path.join(dir, DPAPI_FILE);
    const ps = (body) => ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $in=[Console]::In.ReadToEnd().Trim(); ${body}`];
    const S = '[Security.Cryptography.ProtectedData]';
    const SCOPE = '[Security.Cryptography.DataProtectionScope]::CurrentUser';
    return {
      name: 'dpapi',
      async set(key) {
        const r = await run('powershell.exe', ps(`[Convert]::ToBase64String(${S}::Protect([Text.Encoding]::UTF8.GetBytes($in), $null, ${SCOPE}))`), key);
        const cipher = r.stdout.trim();
        if (r.code !== 0 || !/^[A-Za-z0-9+/=]{20,}$/.test(cipher)) return false;
        writePrivate(file, cipher);
        return (await this.get()) === key;
      },
      async get() {
        let cipher;
        try { cipher = fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
        const r = await run('powershell.exe', ps(`[Text.Encoding]::UTF8.GetString(${S}::Unprotect([Convert]::FromBase64String($in), $null, ${SCOPE}))`), cipher);
        return r.code === 0 ? r.stdout.trim() || null : null;
      },
      async clear() { fs.rmSync(file, { force: true }); },
    };
  }
  return null;
}

// Write a file readable only by this user: created 0600 under a temp name, then renamed.
function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.rmSync(tmp, { force: true });
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

const fileStore = (dir) => {
  const file = path.join(dir, KEY_FILE);
  return {
    name: 'file',
    async set(key) { writePrivate(file, key); return true; },
    async get() { try { return fs.readFileSync(file, 'utf8').trim() || null; } catch { return null; } },
    async clear() { fs.rmSync(file, { force: true }); },
  };
};

// dir: the app folder. os: an OS store, null for none (tests pass a fake).
export function makeKeystore({ dir, os = osStore({ dir }), env = process.env }) {
  const markFile = path.join(dir, MARK_FILE);
  const files = fileStore(dir);
  const stores = { [files.name]: files, ...(os ? { [os.name]: os } : {}) };
  const mark = () => { try { const m = JSON.parse(fs.readFileSync(markFile, 'utf8')); return stores[m.store] ? m : null; } catch { return null; } };
  const envKey = () => { const c = checkKey(env.ANTHROPIC_API_KEY); return c.ok ? c.key : null; };

  return {
    // Where a new key would go.
    target: () => (os ? os.name : 'file'),
    has: () => !!mark() || !!envKey(),
    where: () => mark()?.store || (envKey() ? 'env' : null),
    hint: async () => { const m = mark(); if (m) return m.hint; const e = envKey(); return e ? `…${e.slice(-4)}` : null; },
    async get() {
      const m = mark();
      if (m) return stores[m.store].get();
      return envKey();
    },
    // The store a saved key was recorded in but can't be read from now (deleted in Keychain
    // Access, or the keyring is locked), or null. The record is kept: saving a key again replaces it.
    async missing() {
      const m = mark();
      if (!m) return null;
      let k = null;
      try { k = await stores[m.store].get(); } catch { /* unreadable */ }
      return k ? null : m.store;
    },
    async set(raw) {
      const c = checkKey(raw);
      if (!c.ok) return c;
      await this.clear();
      let store = 'file';
      if (os) {
        try { if (await os.set(c.key)) store = os.name; } catch { /* fall through to the file */ }
      }
      if (store === 'file') await files.set(c.key);
      writePrivate(markFile, JSON.stringify({ store, hint: `…${c.key.slice(-4)}` }) + '\n');
      return { ok: true, store, fellBack: !!os && store === 'file' };
    },
    async clear() {
      const m = mark();
      if (m) { try { await stores[m.store].clear(); } catch { /* gone already */ } }
      await files.clear();
      fs.rmSync(markFile, { force: true });
      return { ok: true };
    },
  };
}
