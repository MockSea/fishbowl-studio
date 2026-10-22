// MCP Apps bridge: raw JSON-RPC over window.parent.postMessage. Handshake, host theme,
// size reporting, tool calls, chat messages, links, clipboard, and supersession of old boards.
(function () {
  let nextId = 1;
  const pending = new Map();
  const listeners = { result: [], context: [] };
  const post = (m) => window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, m), '*');
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('The host did not answer.')); } }, 30000);
    pending.set(id, { resolve, reject, timer });
    post({ id, method, params });
  });
  const notify = (method, params) => post(params === undefined ? { method } : { method, params });

  function applyHostContext(c) {
    if (!c) return;
    const root = document.documentElement;
    if (c.theme) { root.dataset.theme = c.theme; root.style.colorScheme = c.theme; }
    const vars = c.styles && c.styles.variables;
    if (vars) for (const k in vars) if (vars[k] != null) root.style.setProperty(k, vars[k]);
    const fonts = c.styles && c.styles.css && c.styles.css.fonts;
    if (fonts && !document.getElementById('host-fonts')) {
      const s = document.createElement('style'); s.id = 'host-fonts'; s.textContent = fonts; document.head.appendChild(s);
    }
    const i = c.safeAreaInsets;
    if (i) document.body.style.padding = `${8 + i.top}px ${8 + i.right}px ${8 + i.bottom}px ${8 + i.left}px`;
    listeners.context.forEach((f) => f(c));
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window.parent) return;
    const m = ev.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.method === undefined && 'id' in m) {
      const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer);
      return m.error ? p.reject(Object.assign(new Error(m.error.message || 'Error'), m.error)) : p.resolve(m.result);
    }
    if ('id' in m) {
      if (m.method === 'ping' || m.method === 'ui/resource-teardown') return post({ id: m.id, result: {} });
      return post({ id: m.id, error: { code: -32601, message: 'Method not found' } });
    }
    if (m.method === 'ui/notifications/tool-result') listeners.result.forEach((f) => f(m.params || {}));
    else if (m.method === 'ui/notifications/host-context-changed') applyHostContext(m.params || {});
  });

  let lastW = 0, lastH = 0, queued = false;
  function reportSize() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const html = document.documentElement, prev = html.style.height;
      html.style.height = 'max-content';
      const h = Math.ceil(html.getBoundingClientRect().height);
      html.style.height = prev;
      const w = Math.ceil(window.innerWidth);
      if (w !== lastW || h !== lastH) { lastW = w; lastH = h; notify('ui/notifications/size-changed', { width: w, height: h }); }
    });
  }

  // Every tool call mounts a new board; older ones hear about newer ones and go quiet.
  let stamp = null, superseded = false;
  let channel = null;
  try { channel = new BroadcastChannel('fishbowl-studio-board'); } catch { channel = null; }
  function setStamp(s) {
    if (!s || (stamp && stamp.createdAt >= s.createdAt)) return;
    stamp = s;
    if (channel) channel.postMessage(s);
  }
  if (channel) channel.onmessage = (e) => {
    const s = e.data;
    if (stamp && s && s.createdAt > stamp.createdAt && !superseded) {
      superseded = true;
      const b = document.getElementById('stale'); if (b) b.hidden = false;
      reportSize();
    }
  };

  async function callTool(name, args) {
    const res = await request('tools/call', { name, arguments: args || {} });
    const sc = res && res.structuredContent;
    if (sc && sc.stamp) setStamp(sc.stamp);
    return res;
  }

  async function askClaude(text) {
    try {
      const r = await request('ui/message', { role: 'user', content: [{ type: 'text', text }] });
      return !(r && r.isError);
    } catch { return false; }
  }

  async function openLink(url) {
    try { await request('ui/open-link', { url }); return true; } catch { return false; }
  }

  async function copy(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }

  async function connect() {
    const res = await request('ui/initialize', {
      protocolVersion: '2026-01-26',
      appInfo: { name: 'fishbowl-studio-board', version: '0.1.0' },
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    });
    applyHostContext(res && res.hostContext);
    notify('ui/notifications/initialized');
    const ro = new ResizeObserver(reportSize); ro.observe(document.documentElement); ro.observe(document.body);
    reportSize();
    return res;
  }

  window.Studio = {
    connect, callTool, askClaude, openLink, copy, reportSize, setStamp,
    onResult: (f) => listeners.result.push(f),
    isSuperseded: () => superseded,
    fullscreen: () => request('ui/request-display-mode', { mode: 'fullscreen' }).catch(() => null),
  };
})();
