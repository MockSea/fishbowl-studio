// Which engine writes the drafts. Two, behind one cost guard (the runner's call budget and the
// daily cap count every call the same way, whichever engine answers):
//   claude  `claude -p` on the person's Claude plan, when the claude command is installed
//   api     the Anthropic API with their own key
// The engine preference is auto (Claude Code when it is installed, else the key), claude or api.
// In auto, if Claude Code fails to run a call (not installed right, signed out, crashed) and a
// key is saved, that call and the rest of the session go to the API, and notify() says so once.
import fs from 'node:fs';
import path from 'node:path';
import { ModelError, makeClient, makeModel } from './api.js';
import { makeCliModel } from './claude-cli.js';

export const ENGINES = ['auto', 'claude', 'api'];

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

// keys: the keystore. mode(): the preference. claudePath(): path or null.
export function makeEngine({
  keys, mode = () => 'auto', claudePath = () => findOnPath('claude'),
  createApi = (apiKey) => makeModel({ client: makeClient({ apiKey }) }),
  createCli = (bin) => makeCliModel({ bin }),
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
      if (which === 'api') return (await apiModel()).ask(opts);
      try { return await cliModel().ask(opts); }
      catch (e) {
        if (!(e instanceof ModelError) || e.kind !== 'cli' || mode() === 'claude') throw e;
        const backup = await apiModel();
        if (!backup) throw e;
        cliBroken = e.message;
        notify(`${e.message} Using your Anthropic API key instead for the rest of this session.`);
        return backup.ask(opts);
      }
    },
  };
}
