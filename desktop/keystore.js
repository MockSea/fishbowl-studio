// The Anthropic API key, encrypted with Electron's safeStorage (the macOS Keychain on a Mac) and
// kept as ciphertext in the app's own folder, outside the studio data folder. If the system
// can't encrypt, the key is refused rather than stored in the clear. The key never goes to the
// renderer and is never logged; only has() and a masked hint leave this module.
import fs from 'node:fs';
import path from 'node:path';

export const KEY_FILE = 'anthropic-key.bin';

export function checkKey(raw) {
  const key = String(raw ?? '').trim();
  if (!key) return { ok: false, reason: 'Paste your Anthropic API key.' };
  if (/\s/.test(key) || key.length < 20 || key.length > 400) return { ok: false, reason: 'That does not look like an API key.' };
  if (!/^[A-Za-z0-9_\-]+$/.test(key)) return { ok: false, reason: 'That does not look like an API key.' };
  return { ok: true, key };
}

// Uses the async safeStorage calls (the sync ones are deprecated in current Electron).
export function makeKeystore({ dir, safeStorage }) {
  const file = path.join(dir, KEY_FILE);
  const write = async (key) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, await safeStorage.encryptStringAsync(key), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  return {
    file,
    available: async () => !!(await safeStorage.isAsyncEncryptionAvailable()),
    has: () => fs.existsSync(file),
    async hint() {
      const k = await this.get();
      return k ? `…${k.slice(-4)}` : null;
    },
    async get() {
      if (!fs.existsSync(file)) return null;
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(fs.readFileSync(file));
        if (shouldReEncrypt) await write(result).catch(() => {});
        return result;
      } catch { return null; }
    },
    async set(raw) {
      const c = checkKey(raw);
      if (!c.ok) return c;
      if (!(await safeStorage.isAsyncEncryptionAvailable())) return { ok: false, reason: 'This computer can\'t encrypt the key, so it wasn\'t saved.' };
      await write(c.key);
      return { ok: true };
    },
    clear() { fs.rmSync(file, { force: true }); return { ok: true }; },
  };
}
