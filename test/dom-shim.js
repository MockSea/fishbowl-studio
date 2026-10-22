// A tiny DOM, just enough to run the board scripts in Node for tests (no dependencies).
export function makeDom() {
  class Text { constructor(t) { this.nodeType = 3; this.data = String(t); } get textContent() { return this.data; } }
  class El {
    constructor(tag) {
      this.nodeType = 1; this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {};
      this.dataset = {}; this.style = { setProperty() {} }; this.hidden = false; this.value = ''; this.className = ''; this.parent = null; this.checked = false; this.disabled = false; this.html = '';
      const self = this;
      this.classList = {
        add: (c) => { if (!self.classList.contains(c)) self.className = `${self.className} ${c}`.trim(); },
        remove: (c) => { self.className = self.className.split(/\s+/).filter((x) => x !== c).join(' '); },
        toggle: (c, on) => { (on ?? !self.classList.contains(c)) ? self.classList.add(c) : self.classList.remove(c); },
        contains: (c) => self.className.split(/\s+/).includes(c),
      };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; if (k === 'id') this.id = v; if (k === 'value') this.value = String(v); if (k === 'checked') this.checked = true; if (k === 'disabled') this.disabled = true; if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    append(...ns) { for (const n of ns) { const node = typeof n === 'string' ? new Text(n) : n; node.parent = this; this.children.push(node); } }
    prepend(...ns) { for (const n of ns) n.parent = this; this.children.unshift(...ns); }
    replaceChildren(...ns) { this.children = []; this.append(...ns); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
    get textContent() { return this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = [new Text(v)]; }
    set innerHTML(v) { this.html = String(v); this.children = []; }
    get innerHTML() { return this.html; }
    addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
    async fire(t, ev = {}) { for (const f of this.listeners[t] || []) await f({ target: this, ...ev }); }
    async click() { if (!this.disabled) await this.fire('click'); }
    focus() {}
    select() {}
    getBoundingClientRect() { return { height: 500, width: 640 }; }
    *walk() { yield this; for (const c of this.children) if (c.nodeType === 1) yield* c.walk(); }
    querySelectorAll(sel) { const cls = sel.replace(/^\./, ''); return [...this.walk()].filter((e) => e.classList.contains(cls)); }
    find(pred) { return [...this.walk()].find(pred); }
    findAll(pred) { return [...this.walk()].filter(pred); }
  }
  const body = new El('body'), head = new El('head'), html = new El('html');
  html.append(head, body);
  const mk = (tag, props = {}, kids = []) => { const e = new El(tag); Object.assign(e, props); if (props.id) e.attrs.id = props.id; if (props.className) e.className = props.className; e.append(...kids); return e; };
  const ids = ['app', 'mark', 'persona', 'side-foot', 'menu-btn', 'counter', 'brand', 'badge-drafts', 'badge-playbook', 'stale', 'flash', 'jobs', 'view', 'scrim'];
  for (const id of ids) body.append(mk('div', { id }));
  body.append(mk('button', { id: 'full-btn' }, [mk('span', { id: 'full-lbl' })]));
  for (const v of ['drafts', 'sources', 'topics', 'schedule', 'settings', 'reads', 'playbook']) { const b = mk('button', { className: 'navbtn' }); b.dataset.view = v; b.dataset.icon = v; body.append(b); }
  const docListeners = {};
  const document = {
    documentElement: html, body, head,
    createElement: (t) => new El(t), createTextNode: (t) => new Text(t),
    getElementById: (id) => html.find((e) => e.id === id || e.attrs.id === id) || null,
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener: (t, f) => { (docListeners[t] ??= []).push(f); },
    execCommand: () => true,
  };
  return { document, El };
}
