// Desktop bridge: the same window.Studio the board uses inside Claude, over Electron IPC
// (window.studioDesktop, from preload.cjs). Tool calls run in the app's main process. Asking
// Claude starts a run in the app (setup drafts, the daily run, the rewrite queue); anything
// else returns a message saying it isn't in the desktop app.
(function () {
  const D = window.studioDesktop;
  const listeners = { result: [], context: [] };
  document.documentElement.dataset.host = 'desktop';

  async function callTool(name, args) {
    const res = await D.call(name, args || {});
    if (res && res.error) throw new Error(res.error);
    return res;
  }

  // Resolves true when a run started, or a sentence to show when it didn't.
  async function askClaude(text) {
    const r = await D.ask(text);
    return r && r.ok ? true : (r && r.message) || 'That isn\'t in the desktop app yet.';
  }

  async function copy(text) {
    try { await D.copy(String(text)); return true; } catch { return false; }
  }

  window.Studio = {
    desktop: true,
    connect: async () => ({}),
    callTool, askClaude, copy,
    openLink: async (url) => { try { return await D.openLink(String(url)); } catch { return false; } },
    reportSize: () => {}, setStamp: () => {},
    onResult: (f) => listeners.result.push(f),
    onContext: (f) => listeners.context.push(f),
    isSuperseded: () => false,
    fullscreen: async () => null,
    displayMode: async () => null,
    // Desktop-only: the key, the brand kit, run progress and app preferences.
    // A FileList doesn't cross the context bridge; an array of File objects does.
    key: { status: () => D.keyStatus(), set: (k) => D.keySet(k), clear: () => D.keyClear() },
    kit: { list: () => D.kitList(), pick: () => D.kitPick(), add: (files) => D.kitAdd(D.pathsFor(Array.from(files || []))), remove: (id) => D.kitRemove(id) },
    prefs: { get: () => D.prefsGet(), set: (p) => D.prefsSet(p) },
    onRun: (f) => D.onRun(f),
  };
})();
