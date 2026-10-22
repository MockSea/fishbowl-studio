// Board core: state, loading, the shell (sidebar, persona switcher, top bar, drawer) and the
// small controls every page uses (segmented, switch, stepper, cards, empty states).
// All text from the server is untrusted; it only ever reaches the DOM through textContent.
(function () {
  const S = window.Studio;
  const { icon } = window.StudioIcons;
  // why: the draft or set just skipped, for the optional one-tap reason. wnew: the wizard is
  // setting up a brand-new persona (nothing is created until step 1 is sent). wstep: the wizard
  // step on screen. arming: the account whose "Post for me" warning is showing.
  const state = { view: 'drafts', tab: 'waiting', chip: 'all', platform: 'all', data: null, head: null, open: {}, why: null, menu: false, adding: false, drawer: false, display: 'inline', wnew: false, wstep: null, arming: null };
  const $ = (id) => document.getElementById(id);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  function ago(iso) {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }
  const hm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const meter = (n, of = 5) => h('span', { class: 'meter', 'aria-label': `${n} of ${of}` }, [...Array(of)].map((_, i) => h('i', { class: i < n ? 'on' : '' })));

  // ---------- feedback ----------
  let flashTimer;
  function flash(msg, kind = '') {
    const el = $('flash');
    el.textContent = msg; el.className = `banner ${kind}`; el.hidden = !msg;
    clearTimeout(flashTimer);
    if (msg) flashTimer = setTimeout(() => { el.hidden = true; S.reportSize(); }, 6000);
    S.reportSize();
  }

  function askClaudeButton(label, prompt, cls = 'btn ghost') {
    return h('button', { class: cls, onclick: async () => {
      const ok = await S.askClaude(prompt);
      flash(ok ? 'Sent to Claude.' : `Ask Claude in the chat: "${prompt}"`, ok ? 'good' : 'warn');
    } }, label);
  }

  // ---------- server calls ----------
  async function load(params) {
    Object.assign(state, params || {});
    const args = { view: state.view };
    if (state.view === 'drafts') Object.assign(args, { tab: state.tab, chip: state.chip, platform: state.platform });
    if (state.view === 'wizard' && state.wnew) args.new_persona = true;
    try {
      const res = await S.callTool('studio_view', args);
      if (res.isError) throw new Error(res.content && res.content[0] && res.content[0].text);
      show(res.structuredContent);
    } catch (e) { flash(`Couldn't load: ${e.message || e}`, 'bad'); }
  }

  // Call a tool, show its message, reload the view. Returns the structured result (with ok).
  async function call(name, args, { reload = true, quiet = false } = {}) {
    if (S.isSuperseded()) { flash('This board is out of date. Use the newest one in the chat.', 'warn'); return null; }
    try {
      const res = await S.callTool(name, args);
      const sc = res.structuredContent || {};
      const ok = !res.isError && sc.ok !== false;
      const msg = sc.message || (res.content && res.content[0] && res.content[0].text) || '';
      if (!quiet || !ok) flash(msg, ok ? 'good' : 'bad');
      if (ok) state.open = {};
      if (reload) await load();
      return { ...sc, ok, message: msg };
    } catch (e) { flash(`That didn't work: ${e.message || e}`, 'bad'); return null; }
  }
  const act = (args, opts) => call('studio_act', args, opts);
  const setting = (patch, opts) => call('studio_config', { action: 'patch', patch }, opts);

  function show(sc) {
    if (!sc) return;
    state.data = sc;
    if (sc.view) state.view = sc.view;
    if (sc.tab) state.tab = sc.tab;
    if (sc.view === 'wizard') { if (sc.fresh) state.wnew = true; if (sc.step) state.wstep = sc.step; }
    setHeader(sc.header);
    if (sc.counts) $('badge-drafts').textContent = sc.counts.waiting || '';
    render();
  }

  // ---------- shell ----------
  const avatarClass = (slug) => { let n = 0; for (const ch of String(slug || '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return `c${(n % 6) + 1}`; };
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const avatar = (p, size = '') => h('span', { class: `avatar ${size} ${avatarClass(p.slug)}`, 'aria-hidden': 'true', text: initials(p.name) });
  const personaStatus = (p) => !p.setup_complete && !p.feeds ? h('span', { class: 'tag warn' }, 'Needs setup') : p.waiting ? h('span', { class: 'tag accent' }, `${p.waiting} to review`) : h('span', { class: 'tag ok' }, icon('check'), 'All clear');

  function setHeader(head) {
    if (!head) return;
    state.head = head;
    $('brand').textContent = head.brand || 'Fishbowl Studio';
    const c = head.counter || {};
    const next = c.next ? `next batch ${hm(c.next)}` : 'no more batches today';
    $('counter').replaceChildren(icon('schedule'), h('span', {}, h('b', { text: String(c.released ?? 0) }), ` of ${c.cap ?? 0} today`), h('span', { class: 'long', text: ` · ${c.held ?? 0} held · ${next}` }));
    $('badge-coach').textContent = head.proposals || '';
    $('badge-sources').textContent = head.suggestions || '';
    const jobs = $('jobs');
    jobs.replaceChildren();
    jobs.hidden = !head.jobs;
    if (head.jobs) jobs.append(h('span', { text: `${plural(head.jobs, 'job')} waiting for Claude (rewrites, redos and links to draft).` }), askClaudeButton('Ask Claude now', 'Run my Fishbowl Studio rewrites and redos now.', 'btn sm primary'));
    $('side-foot').textContent = head.home ? `Everything for ${head.brand} lives in ${head.home}` : '';
    // Posts that didn't go out: never silent. One line, and a way to see them.
    const ps = head.posting || {};
    const posting = $('posting');
    posting.replaceChildren();
    const bad = (ps.missed || 0) + (ps.failed || 0) + (ps.blocked || 0);
    posting.hidden = !bad;
    if (bad) posting.append(h('span', { text: `${plural(bad, 'approved post')} didn’t go out (${[ps.missed ? `${ps.missed} missed` : '', ps.failed ? `${ps.failed} failed` : '', ps.blocked ? `${ps.blocked} changed after you approved` : ''].filter(Boolean).join(', ')}). Nothing is retried by itself.` }),
      h('button', { class: 'btn sm', onclick: () => { setDrawer(false); load({ view: 'drafts', tab: 'passed', chip: 'all', platform: 'all' }); } }, 'See which'));
    renderPersona();
  }

  function renderPersona() {
    const head = state.head;
    const box = $('persona');
    if (!head || !head.persona) return box.replaceChildren();
    const me = head.persona;
    const btn = h('button', { class: 'persona-btn', 'aria-haspopup': 'true', 'aria-expanded': String(state.menu), title: me.name, onclick: () => { state.menu = !state.menu; state.adding = false; renderPersona(); S.reportSize(); } },
      avatar(me, 'sm'), h('span', { class: 'who' }, h('span', { class: 'nm', text: me.name }), h('span', { class: 'hd', text: `@${me.slug}` })), h('span', { class: 'chev' }, icon('chevron')));
    let menu = null;
    if (state.menu) {
      const items = (head.personas || []).map((p) => h('button', { class: 'item', role: 'menuitem', onclick: () => switchTo(p.slug) },
        avatar(p, 'sm'), h('span', { class: 'nm', text: p.name }), p.active ? icon('check') : personaStatus(p)));
      // Add persona opens the setup wizard; the persona is made when they send step 1.
      const add = h('button', { class: 'item add', onclick: () => openWizard({ fresh: true }) }, icon('plus'), h('span', { class: 'nm' }, 'Add persona'));
      menu = h('div', { class: 'menu', role: 'menu' }, items, h('hr'), add);
    }
    box.replaceChildren(...[btn, menu].filter(Boolean));
  }

  function openWizard({ fresh = false } = {}) {
    state.menu = false; state.adding = false; state.wnew = fresh; state.wstep = fresh ? 'brand' : null; state.open = {};
    setDrawer(false); renderPersona();
    return load({ view: 'wizard' });
  }

  async function switchTo(slug) {
    state.menu = false; setDrawer(false);
    if (state.head && state.head.persona && state.head.persona.slug === slug) return renderPersona();
    const r = await call('studio_personas', { action: 'switch', slug }, { reload: false });
    if (r && r.ok) await load({ view: 'drafts', tab: 'waiting', chip: 'all', platform: 'all' });
  }

  function setDrawer(open) {
    state.drawer = open;
    $('app').classList.toggle('drawer-open', open);
    $('scrim').hidden = !open;
    $('menu-btn').setAttribute('aria-expanded', String(open));
    S.reportSize();
  }

  function render() {
    document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    const pages = window.BoardPages || {};
    const fn = pages[state.view];
    $('view').replaceChildren(fn && state.data && state.data.view === state.view ? fn(state.data) : h('p', { class: 'muted' }, 'Loading…'));
    S.reportSize();
  }

  // ---------- page building blocks ----------
  const page = (title, sub, actions, ...body) => h('section', { class: 'page' }, h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: title }), sub ? h('p', { text: sub }) : null), actions || null), body);
  const card = ({ icon: ic, title, sub, end, cls = '' }, ...body) => h('section', { class: `card ${cls}` },
    title ? h('div', { class: 'card-head' }, ic ? h('span', { class: 'ico' }, icon(ic)) : null, h('div', {}, h('h2', { text: title }), sub ? h('p', { text: sub }) : null), end ? h('div', { class: 'end' }, end) : null) : null, body);
  const empty = ({ icon: ic = 'spark', title, text, action }) => h('div', { class: 'empty' }, h('span', { class: 'ico' }, icon(ic)), h('h3', { text: title }), text ? h('p', { text }) : null, action || null);

  // seg([{value, label, n}], current, onpick, ariaLabel)
  const seg = (opts, cur, onpick, label) => h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
    opts.map((o) => h('button', { class: o.value === cur ? 'on' : '', role: 'radio', 'aria-checked': String(o.value === cur), onclick: () => { if (o.value !== cur) onpick(o.value); } }, o.label, o.n != null ? h('span', { class: 'n', text: String(o.n) }) : null)));
  const switchCtl = (on, label, onchange) => h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: () => onchange(!on) });
  function stepper(value, min, max, onchange, label) {
    const set = (v) => { if (v >= min && v <= max && v !== value) onchange(v); };
    return h('div', { class: 'stepper', role: 'group', 'aria-label': label },
      h('button', { class: 'btn ghost', 'aria-label': `Fewer: ${label}`, disabled: value <= min, onclick: () => set(value - 1) }, '−'),
      h('output', { 'aria-live': 'polite', text: String(value) }),
      h('button', { class: 'btn ghost', 'aria-label': `More: ${label}`, disabled: value >= max, onclick: () => set(value + 1) }, '+'));
  }
  // A destructive button that asks once: the first click arms it, the second does it.
  function confirmButton(label, armed, fn, cls = 'btn sm danger') {
    const b = h('button', { class: cls, 'aria-label': label }, icon('trash'), h('span', { class: 'sr', text: label }));
    b.addEventListener('click', () => {
      if (b.classList.contains('armed')) return fn();
      b.classList.add('armed'); b.replaceChildren(h('span', { text: armed }));
      setTimeout(() => { if (b.classList.contains('armed')) { b.classList.remove('armed'); b.replaceChildren(icon('trash'), h('span', { class: 'sr', text: label })); } }, 4000);
    });
    return b;
  }
  function copyButton(text, label, cls = 'btn primary') {
    return h('button', { class: cls, onclick: async (e) => {
      const ok = await S.copy(text);
      const b = e.target;
      if (ok) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = label; }, 2000); }
      else flash('Your browser blocked copying. Select the text and copy it by hand.', 'warn');
    } }, label);
  }

  // A proposal they decide with one tap: what would change, and why it's suggested.
  const KIND_LABEL = { playbook: 'Playbook', position: 'Position', audience: 'Audience', shape: 'Shape', phrase: 'Overused phrase', voice: 'Voice', topic: 'Topic' };
  const OP_LABEL = { add: 'Add', remove: 'Remove', replace: 'Replace', strengthen: 'Stronger', weaken: 'Weaker', drop: 'Drop', raise: 'Raise', lower: 'Lower', set: 'New version', avoid: 'Off limits' };
  function proposalRow(p) {
    const decide = (decision) => () => call('studio_proposal_decide', { id: p.id, decision });
    const text = p.kind === 'shape' ? `${p.name}: ${p.text}` : p.kind === 'phrase' ? `“${p.text}”: keep it rare` : p.text;
    return h('div', { class: 'row-item' },
      h('span', { class: 'who' }, h('span', { class: 'sub' }, h('span', { class: 'tag' }, KIND_LABEL[p.kind] || p.kind), ' ', h('span', { class: 'tag warn' }, OP_LABEL[p.op] || p.op), p.section ? ` ${p.section}` : '', p.source === 'edits' ? h('span', { class: 'tag accent' }, 'From your edits') : p.source === 'wizard' ? h('span', { class: 'tag accent' }, 'From setup') : null),
        p.old ? h('span', { class: 'sub', text: `Now: ${p.old}` }) : null, text ? h('span', { class: `nm ${p.kind === 'voice' ? 'pre' : ''}`, text }) : null, p.reason ? h('span', { class: 'sub', text: `Why: ${p.reason}` }) : null),
      h('span', { class: 'ctl' }, h('button', { class: 'btn sm approve', onclick: decide('accept') }, icon('check'), 'Accept'), h('button', { class: 'btn sm skip', onclick: decide('reject') }, 'Reject')));
  }

  // ---------- rail and onboarding, shared by Drafts ----------
  function todayCard(head) {
    const c = head.counter || {};
    return card({ icon: 'schedule', title: 'Today', sub: c.next ? `Next batch at ${hm(c.next)}` : 'No more batches today', cls: 'today-card' },
      h('div', { class: 'nums' },
        h('div', { class: 'num' }, h('b', { text: String(c.released ?? 0) }), h('span', { text: `of ${c.cap} released` })),
        h('div', { class: 'num' }, h('b', { text: String(c.held ?? 0) }), h('span', { text: 'held for later' })),
        h('div', { class: 'num' }, h('b', { text: String(c.scrapped ?? 0) }), h('span', { text: 'expired' }))));
  }

  // "Post for me" on one account: off by default; turning it on shows the plain warning first and
  // only their second tap (Turn it on) sends it. Used in Settings and in the setup wizard.
  function postingControl(a) {
    if (!a.capabilities || a.capabilities.post !== true) return null;
    const on = a.posting && a.posting.on;
    const sw = switchCtl(on, `Post for me on ${a.label}`, (want) => {
      if (!a.connected) return flash(`Connect ${a.label} first.`, 'warn');
      if (want) { state.arming = a.id; render(); } else { state.arming = null; call('studio_account_posting', { type: a.id, on: false }); }
    });
    if (!a.connected) sw.disabled = true;
    const since = a.posting && a.posting.since ? `${on ? 'On' : 'Off'} since ${new Date(a.posting.since).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : 'Off';
    const row = h('div', { class: 'setting post-for-me' }, h('div', { class: 'lbl' }, h('b', { text: 'Post for me' }),
      h('span', { text: a.connected ? `${since}. Approving a draft on the board means Claude posts it at the next release time.` : 'Connect the account first. Off until you turn it on.' })), sw);
    if (state.arming !== a.id) return row;
    return h('div', {}, row, h('div', { class: 'warn-box', role: 'group', 'aria-label': `Before you turn on posting for ${a.label}` },
      h('b', { text: 'Before you turn this on' }),
      h('p', { text: `${a.post_warning} Claude posts through your own signed-in browser, which is automation, so this is your call.` }),
      h('ul', { class: 'list small' }, h('li', { text: 'Only drafts you approve on the board are posted, exactly as you approved them.' }), h('li', { text: 'Your computer has to be awake at the release time. A missed or failed post shows here with the reason; nothing is retried by itself.' }), h('li', { text: 'You can turn it off any time.' })),
      h('div', { class: 'chips' }, h('button', { class: 'btn sm primary', onclick: async () => { state.arming = null; await call('studio_account_posting', { type: a.id, on: true, confirmed: true }); } }, 'Turn it on'),
        h('button', { class: 'btn sm ghost', onclick: () => { state.arming = null; render(); } }, 'Keep it off'))));
  }

  function profilesCard(head) {
    return card({ icon: 'user', title: 'Your brands', sub: 'Each one has its own drafts, sources and voice.' },
      h('div', { class: 'profiles' }, (head.personas || []).map((p) => h('button', { class: `profile ${p.active ? 'active' : ''}`, onclick: () => switchTo(p.slug) },
        avatar(p), h('span', { class: 'who' }, h('span', { class: 'nm', text: p.name }), h('span', { class: 'sub', text: `${plural(p.feeds, 'source')}` })), personaStatus(p)))),
      h('div', { class: 'chips card-foot' }, h('button', { class: 'btn sm ghost', onclick: () => openWizard({ fresh: true }) }, icon('plus'), 'Add persona')));
  }

  // The first-run card: the setup wizard (the one setup flow), then sources and the first run.
  const STEPS = {
    setup: { title: 'Set up the brand', text: 'Four short steps: the brand, a few questions, Claude’s drafts for you to keep or change, and whether it posts for you.', cta: 'Start setup' },
    sources: { title: 'Add your sources', text: 'Add the sources Claude suggested, or paste sites you read for work.', go: 'sources', cta: 'Add sources' },
    schedule: { title: 'Set it to run', text: 'One click asks Claude to make the scheduled task. Drafts arrive here after its first run.', go: 'schedule', cta: 'Set the schedule' },
  };
  const WIZ_STEP_N = { brand: 1, questions: 2, drafting: 3, review: 3, posting: 4 };
  function firstRunCard(head) {
    const fr = head.first_run;
    const w = head.wizard;
    // A half-finished setup is offered again, wherever they left it.
    if (w && (!fr || !fr.show || fr.setup)) return card({ icon: 'spark', title: `Finish setting up ${head.brand}`, sub: `You stopped at step ${WIZ_STEP_N[w.step] || 1} of 4. Everything you answered is saved.` },
      h('div', { class: 'chips' }, h('button', { class: 'btn sm primary', onclick: () => openWizard() }, 'Pick up where you left off')));
    if (!fr || !fr.show) return null;
    return card({ icon: 'spark', title: `Here's how this works`, sub: `Three steps and ${head.brand} gets drafts every day. You approve the good ones.` },
      h('ol', { class: 'steps' }, fr.steps.map((s, i) => { const d = STEPS[s.key]; const go = s.key === 'setup' ? () => openWizard() : () => load({ view: d.go });
        const cta = s.key === 'setup' && !s.done && s.step ? `Continue (step ${WIZ_STEP_N[s.step] || 1} of 4)` : d.cta;
        return h('li', { class: `step ${s.done ? 'done' : ''}` },
          h('span', { class: 'num' }, s.done ? icon('check') : String(i + 1)), h('h3', { text: d.title }), h('p', { text: d.text }),
          h('button', { class: `btn sm ${s.done ? 'ghost' : 'primary'}`, onclick: go }, s.done ? 'Done · change' : cta)); })));
  }

  window.Board = { state, h, icon, load, call, act, setting, flash, render, ago, hm, plural, meter, page, card, empty, seg, switchCtl, stepper, confirmButton, copyButton, askClaudeButton, avatar, todayCard, profilesCard, firstRunCard, switchTo, proposalRow, postingControl, openWizard, setDrawer, KIND_LABEL, OP_LABEL };
  window.BoardPages = window.BoardPages || {};

  // ---------- boot ----------
  $('mark').append(icon('fish'));
  $('menu-btn').append(icon('menu'));
  $('menu-btn').addEventListener('click', () => setDrawer(!state.drawer));
  $('scrim').addEventListener('click', () => setDrawer(false));
  // Full screen shows only when the host says it can do it, and hides for good if a request fails.
  $('full-btn').prepend(icon('expand'));
  S.onContext((c) => { if (Array.isArray(c.availableDisplayModes)) $('full-btn').hidden = !c.availableDisplayModes.includes('fullscreen'); });
  $('full-btn').addEventListener('click', async () => {
    const want = state.display === 'fullscreen' ? 'inline' : 'fullscreen';
    const r = await S.displayMode(want);
    if (!r || !r.mode) { $('full-btn').hidden = true; return; }
    state.display = r.mode;
    $('full-lbl').textContent = state.display === 'fullscreen' ? 'Exit full screen' : 'Full screen';
  });
  document.querySelectorAll('.navbtn').forEach((b) => {
    b.prepend(icon(b.dataset.icon || 'drafts'));
    b.addEventListener('click', () => { state.open = {}; state.why = null; state.menu = false; state.wnew = false; state.wstep = null; state.arming = null; setDrawer(false); load({ view: b.dataset.view }); });
  });
  if (document.addEventListener) document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (state.menu || state.drawer)) { state.menu = false; setDrawer(false); renderPersona(); } });
  let got = false;
  S.onResult((r) => { if (r && r.structuredContent && r.structuredContent.view) { got = true; S.setStamp(r.structuredContent.stamp); show(r.structuredContent); } });
  S.connect().then(() => setTimeout(() => { if (!got) load(); }, 800)).catch((e) => {
    $('view').replaceChildren(h('p', { class: 'muted', text: `The board couldn't connect to Claude (${e.message || e}). Ask Claude to "review my drafts in chat" instead.` }));
  });
})();
