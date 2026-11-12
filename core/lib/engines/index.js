// Which engine writes the drafts. Two, behind one cost guard: the runner's budget and the daily
// cap count budgeted drafting steps (each ask() here), whichever engine answers. One step can be
// more than one request underneath (SDK retries, several Claude Code turns, or a Claude Code
// failure followed by the API), so the caps don't bound requests or charges exactly.
//   claude  `claude -p` on the person's Claude plan, when the claude command is installed
//   api     the Anthropic API with their own key
// The engine preference is auto (Claude Code when it is installed, else the key), claude or api.
// In auto, if Claude Code can't start or can't finish a call (a ModelError of kind 'cli': not
// installed right, signed out, crashed, timed out) and a key is saved, that call and later ones go
// to the API until restart or reset() (an engine or key change), and notify() says so once. An
// answer that isn't valid JSON (kind 'parse') or a refusal is not a reason to switch.
import fs from 'node:fs';
import path from 'node:path';
import { ModelError, makeClient, makeModel } from './api.js';

export const ENGINES = ['auto', 'claude', 'api'];
// A key was saved but its store no longer has it (deleted in Keychain Access, say).
export const MISSING_KEY = 'Your saved Anthropic API key can\'t be found any more. Add it again in Settings, on the Claude page.';

// The full path of a command on PATH, or null. On Windows only .exe counts: a .cmd shim would
// have to go through cmd.exe, which re-parses the arguments.
export function findOnPath(name, { env = process.env, platform = process.platform } = {}) {
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const names = platform === 'win32' ? [`${name}.exe`] : [name];
  for (const d of dirs) for (const n of names) {
    const p = path.join(d, n);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && (platform === 'win32' || (st.mode & 0o111))) return p;
    } catch { /* not here */ }
  }
  return null;
}

// keys: the keystore. mode(): the preference. claudePath(): path or null. createCli(bin): the
// Claude Code engine (host.js gives it the studio's own work folder).
export function makeEngine({
  keys, mode = () => 'auto', claudePath = () => findOnPath('claude'),
  createApi = (apiKey) => makeModel({ client: makeClient({ apiKey }) }),
  createCli,
  notify = () => {},
}) {
  let api = null, apiFor = null, cli = null, cliFor = null, cliBroken = null;

  const apiModel = async () => {
    const k = await keys.get();
    if (!k) return null;
    if (!api || apiFor !== k) { api = createApi(k); apiFor = k; }
    return api;
  };
  const cliModel = () => {
    const bin = claudePath();
    if (!bin) return null;
    if (!cli || cliFor !== bin) { cli = createCli(bin); cliFor = bin; }
    return cli;
  };

  // Which engine the next call goes to, and why, without making it.
  function pick() {
    const m = ENGINES.includes(mode()) ? mode() : 'auto';
    const bin = claudePath();
    if (m === 'api') return keys.has() ? 'api' : null;
    if (m === 'claude') return bin ? 'claude' : null;
    if (bin && !cliBroken) return 'claude';
    return keys.has() ? 'api' : null;
  }

  return {
    pick,
    status() {
      const bin = claudePath();
      return { mode: ENGINES.includes(mode()) ? mode() : 'auto', engine: pick(), claude: { found: !!bin }, claude_failed: cliBroken, key: keys.has() };
    },
    ready: () => !!pick(),
    // A preference change or a new key gives Claude Code another go.
    reset() { cliBroken = null; api = null; apiFor = null; },
    async ask(opts) {
      const which = pick();
      if (!which) {
        throw new ModelError(mode() === 'claude'
          ? 'Claude Code isn\'t installed on this computer. Install it, or switch the engine to your API key in Settings.'
          : 'Add your Anthropic API key in Settings, or install Claude Code, first.', 'auth');
      }
      if (which === 'api') {
        const m = await apiModel();
        if (!m) throw new ModelError(MISSING_KEY, 'auth');
        return m.ask(opts);
      }
      try { return await cliModel().ask(opts); }
      catch (e) {
        if (!(e instanceof ModelError) || e.kind !== 'cli' || mode() === 'claude') throw e;
        const backup = await apiModel();
        if (!backup) throw e;
        cliBroken = e.message;
        notify(`${e.message} Using your Anthropic API key instead until you restart the studio or change the engine or key.`);
        return backup.ask(opts);
      }
    },
  };
}
