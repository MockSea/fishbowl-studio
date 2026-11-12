// The bridge to the local server: window.Studio, which the board uses for everything it asks of
// the app. Calls are same-origin POSTs with JSON bodies (the session cookie rides along); run
// progress and notices arrive on an event stream. Asking Claude starts a run in the app (setup
// drafts, the daily run, the rewrite queue).
(function () {
  const listeners = { result: [], context: [], run: [] };
  document.documentElement.dataset.host = 'web';

  async function post(name, body) {
    const r = await fetch(`/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), credentials: 'same-origin' });
    const data = await r.json().catch(() => null);
    if (r.status === 403) throw new Error('The studio link has expired. Run the command again to open it.');
    if (!r.ok) throw new Error((data && data.error) || `The studio answered ${r.status}.`);
    return data;
  }

  async function callTool(name, args) {
    const res = await post('call', { name, args: args || {} });
    if (res && res.error) throw new Error(res.error);
    return res;
  }

  // Resolves true when a run started, or a sentence to show when it didn't.
  async function askClaude(text) {
    try {
      const r = await post('ask', { text });
      return r && r.ok ? true : (r && r.message) || 'That didn\'t start.';
    } catch (e) { return e.message; }
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(String(text)); return true; } catch { /* try the old way */ }
    const t = document.createElement('textarea');
    t.value = String(text);
    t.setAttribute('readonly', '');
    t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    t.remove();
    return ok;
  }

  // Only https links, in a new tab that can't reach back into this one.
  async function openLink(url) {
    let u;
    try { u = new URL(String(url)); } catch { return false; }
    if (u.protocol !== 'https:') return false;
    const w = window.open(u.href, '_blank', 'noopener,noreferrer');
    return w !== undefined;
  }

  // One file per request, as raw bytes; the server never uses the name as a path.
  async function upload(file) {
    try {
      const r = await fetch('/api/kit/add', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) }, body: file, credentials: 'same-origin' });
      const data = await r.json().catch(() => null);
      if (data && Array.isArray(data.results)) return data;
      return { results: [{ ok: false, name: file.name, reason: (data && data.error) || 'The upload didn\'t arrive.' }] };
    } catch { return { results: [{ ok: false, name: file.name, reason: 'The upload didn\'t arrive.' }] }; }
  }
  async function kitAdd(files) {
    const results = [];
    let kit = null;
    for (const f of Array.from(files || [])) {
      const r = await upload(f);
      results.push(...r.results);
      if (r.kit) kit = r.kit;
    }
    return { results, kit };
  }

  function listen() {
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      let ev;
      try { ev = JSON.parse(m.data); } catch { return; }
      for (const f of listeners.run) f(ev);
    };
  }

  window.Studio = {
    web: true,
    connect: async () => { listen(); return {}; },
    callTool, askClaude, copy, openLink,
    reportSize: () => {}, setStamp: () => {},
    onResult: (f) => listeners.result.push(f),
    onContext: (f) => listeners.context.push(f),
    isSuperseded: () => false,
    fullscreen: async () => null,
    displayMode: async () => null,
    // The app's own: the engine and key, the brand kit, run progress and preferences.
    key: { status: () => post('key/status'), set: (k) => post('key/set', { key: k }), clear: () => post('key/clear') },
    kit: { list: () => post('kit/list'), add: kitAdd, remove: (id) => post('kit/remove', { id }) },
    prefs: { get: () => post('prefs/get'), set: (p) => post('prefs/set', p) },
    onRun: (f) => listeners.run.push(f),
  };
})();
