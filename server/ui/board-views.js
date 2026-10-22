// Board core and the Drafts view: tabs, chips, draft cards, takes cards and every action.
// All text from the server is untrusted; it only ever reaches the DOM through textContent.
(function () {
  const S = window.Studio;
  const state = { view: 'drafts', tab: 'waiting', chip: 'all', platform: 'all', data: null, head: null, open: {}, busy: false };

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
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  const meter = (n, of = 5) => h('span', { class: 'meter', 'aria-label': `${n} of ${of}` }, [...Array(of)].map((_, i) => h('i', { class: i < n ? 'on' : '' })));

  let flashTimer;
  function flash(msg, kind = '') {
    const el = document.getElementById('flash');
    el.textContent = msg; el.className = `banner ${kind}`; el.hidden = !msg;
    clearTimeout(flashTimer);
    if (msg) flashTimer = setTimeout(() => { el.hidden = true; S.reportSize(); }, 6000);
    S.reportSize();
  }

  function askClaudeButton(label, prompt) {
    return h('button', { class: 'ghost', onclick: async () => {
      const ok = await S.askClaude(prompt);
      flash(ok ? 'Sent to Claude.' : `Ask Claude in the chat: "${prompt}"`, ok ? 'good' : 'warn');
    } }, label);
  }

  function setHeader(head) {
    if (!head) return;
    state.head = head;
    document.getElementById('brand').textContent = head.brand || 'Fishbowl Studio';
    document.getElementById('counter').textContent = head.counter_text || '';
    document.getElementById('badge-playbook').textContent = head.proposals || '';
    const jobs = document.getElementById('jobs');
    jobs.replaceChildren();
    jobs.hidden = !head.jobs;
    if (head.jobs) jobs.append(h('span', { text: `${head.jobs} rewrite/redo job(s) waiting for Claude.` }), askClaudeButton('Ask Claude now', 'Run my Fishbowl Studio rewrites and redos now.'));
  }

  async function load(params) {
    Object.assign(state, params || {});
    const args = { view: state.view };
    if (state.view === 'drafts') Object.assign(args, { tab: state.tab, chip: state.chip, platform: state.platform });
    try {
      const res = await S.callTool('studio_view', args);
      if (res.isError) throw new Error(res.content && res.content[0] && res.content[0].text);
      show(res.structuredContent);
    } catch (e) { flash(`Couldn't load: ${e.message || e}`, 'bad'); }
  }

  function show(sc) {
    if (!sc) return;
    state.data = sc;
    if (sc.view) state.view = sc.view;
    if (sc.tab) state.tab = sc.tab;
    setHeader(sc.header);
    if (sc.counts) document.getElementById('badge-drafts').textContent = sc.counts.waiting || '';
    render();
  }

  async function act(args, { reload = true } = {}) {
    if (S.isSuperseded()) { flash('This board is out of date. Use the newest one in the chat.', 'warn'); return null; }
    try {
      const res = await S.callTool('studio_act', args);
      const sc = res.structuredContent || {};
      const msg = sc.message || (res.content && res.content[0] && res.content[0].text) || '';
      flash(msg, sc.ok ? 'good' : 'bad');
      if (sc.ok) state.open = {};
      if (reload) await load();
      return sc;
    } catch (e) { flash(`That didn't work: ${e.message || e}`, 'bad'); return null; }
  }

  function render() {
    document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    const root = document.getElementById('view');
    const pages = window.BoardPages || {};
    const fn = state.view === 'drafts' ? renderDrafts : pages[state.view];
    root.replaceChildren(fn ? fn(state.data) : h('p', { class: 'muted' }, 'Loading…'));
    S.reportSize();
  }

  // ---------- Drafts ----------
  const TAB_LABEL = { waiting: 'Waiting', passed: 'Passed', killed: 'Killed', scrapped: 'Scrapped' };

  function renderDrafts(d) {
    if (!d || d.view !== 'drafts') return h('p', { class: 'muted' }, 'Loading…');
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, Object.keys(TAB_LABEL).map((t) =>
      h('button', { class: `tab ${t === d.tab ? 'active' : ''}`, onclick: () => load({ tab: t, chip: 'all' }) }, `${TAB_LABEL[t]} ${d.counts[t] || 0}`)));
    const chips = h('div', { class: 'chips' },
      d.chips.map((c) => h('button', { class: `chip ${c === d.chip ? 'active' : ''}`, onclick: () => load({ chip: c }) }, c)),
      ['all', 'linkedin', 'x'].map((p) => h('button', { class: `chip ${p === d.platform ? 'active' : ''}`, onclick: () => load({ platform: p }) }, p === 'all' ? 'all platforms' : p === 'x' ? 'X' : 'LinkedIn')));
    const cards = d.units.length ? d.units.map((u) => (u.type === 'set' ? setCard(u) : draftCard(u, d.tab))) : [h('div', { class: 'empty' }, emptyText(d.tab))];
    return h('div', {}, tabs, chips, cards, d.total > d.units.length ? h('p', { class: 'muted small' }, `Showing ${d.units.length} of ${d.total}.`) : null);
  }

  function emptyText(tab) {
    return { waiting: 'Nothing waiting. New drafts arrive at the next batch time.', passed: 'Nothing passed yet.', killed: 'Nothing killed.', scrapped: 'Nothing scrapped.' }[tab];
  }

  function sourceBlock(item) {
    if (!item) return null;
    return h('button', { class: 'source', title: 'Open the story', onclick: async () => { if (!(await S.openLink(item.url))) flash(item.url); } },
      h('span', { class: 't', text: item.title }), h('span', { class: 's', text: `${item.source || ''}${item.published ? ' · ' + ago(item.published) : ''} · open ↗` }));
  }

  function rankMarks(r) {
    if (!r) return [];
    const out = [];
    if (r.pos) out.push(`#${r.pos} of ${r.of}`);
    if (r.score != null) out.push(`rank ${r.score.toFixed(2)}`);
    if (r.signals) out.push(Object.entries(r.signals).map(([k, v]) => `${k} ${v}`).join(' · '));
    if (r.explore) out.push('novelty pick');
    return out.map((t) => h('span', { text: t }));
  }

  function marks(c) {
    return h('div', { class: 'marks' },
      c.experiment ? h('span', { class: 'pill warn', title: c.experiment }, 'experiment') : null,
      c.shapes.map((s) => h('span', { class: 'pill' }, (c.hybrid ? '× ' : '') + s)),
      c.flags.map((f) => h('span', { class: 'flag', text: `⚠ ${f}` })),
      rankMarks(c.rank),
      c.decided_at ? h('span', { text: `decided ${ago(c.decided_at)}` }) : null,
      c.rewriting ? h('span', { text: '✎ rewriting…' }) : c.revised ? h('span', { text: '✎ revised from your note' }) : null,
      c.notes ? h('span', { text: `${c.notes} note${c.notes > 1 ? 's' : ''}` }) : null,
      c.resurrected ? h('span', { text: 'resurrected' }) : null);
  }

  const STATUS = { pending: ['waiting', ''], option: ['pick one', 'warn'], passed: ['passed · not posted yet', 'ok'], edited: ['passed (edited) · not posted yet', 'ok'], posted: ['posted', 'ok'], killed: ['killed', 'bad'], passed_over: ['passed over', 'bad'], unpicked: ['not picked', ''], scrapped: ['scrapped', ''] };

  function head(c) {
    const [label, kind] = STATUS[c.status] || [c.status, ''];
    return h('div', { class: 'meta' }, h('span', { class: 'pill platform' }, c.platform_name), h('span', { text: ago(c.released_at || c.created_at) }), h('span', { class: `pill ${kind}` }, label),
      c.scrap_reason ? h('span', { text: c.scrap_reason === 'stale' ? 'went stale' : 'over the daily cap' }) : null);
  }

  function context(c) {
    const t = c.kind === 'evergreen' ? 'evergreen post' : c.origin === 'draft_thought' ? 'drafted from a thought you liked' : c.origin === 'redo' ? 'redo' : c.origin === 'owner_item' || c.origin === 'draft_item' ? 'you asked for this story' : null;
    return t ? h('div', { class: 'context', text: t }) : null;
  }

  const heart = (c, target = 'draft', on = c.hearted) => h('button', { class: `heart ${on ? 'on' : ''}`, 'aria-label': on ? 'Remove heart' : 'Heart', 'aria-pressed': String(!!on), onclick: () => act({ action: 'heart', target, id: c.id }) }, on ? '♥' : '♡');

  function draftCard(c, tab) {
    const card = h('article', { class: 'card', id: `d${c.id}` },
      head(c), context(c), h('div', { class: 'text', text: c.text }),
      c.original ? h('div', { class: 'original', text: `original: ${c.original}` }) : null,
      sourceBlock(c.item), marks(c),
      c.restore_trail.map((r) => h('div', { class: 'trail', text: `killed → restored: ${r.reason}` })),
      c.thinking ? h('details', {}, h('summary', {}, 'Thinking'), h('div', { class: 'thinking', text: c.thinking }),
        h('div', { class: 'actions' }, heart(c, 'thinking', c.thinking_hearted), h('button', { onclick: () => act({ action: 'draft_this', id: c.id }) }, 'Draft this'),
          h('span', { class: 'small muted', text: [c.topic, c.form].filter(Boolean).join(' · ') }))) : null,
      actions(c), panels(c));
    return card;
  }

  function actions(c) {
    const o = state.open;
    const btn = (label, cls, fn) => h('button', { class: cls, onclick: fn }, label);
    const toggle = (k) => () => { state.open = o[k] === c.id ? {} : { [k]: c.id }; render(); };
    const row = [heart(c)];
    if (c.status === 'pending') row.push(btn('Edit', '', toggle('edit')), btn('Pass', 'pass', () => act({ action: 'pass', id: c.id, hash: c.hash })), btn('Kill', 'kill', () => act({ action: 'kill', id: c.id })));
    if (['passed', 'edited'].includes(c.status)) row.push(copyButton(c), btn('Mark posted', '', toggle('posted')), btn('Kill', 'kill', () => act({ action: 'kill', id: c.id })));
    if (c.status === 'posted') row.push(copyButton(c), btn('Numbers', '', toggle('metrics')), c.post_url ? btn('Open post ↗', 'ghost', () => S.openLink(c.post_url)) : null);
    if (c.status === 'killed') row.push(btn('Restore', '', toggle('restore')));
    if (c.status === 'scrapped') row.push(btn('Resurrect', '', () => act({ action: 'resurrect', id: c.id })));
    row.push(h('span', { class: 'spacer' }), btn('Note', 'ghost', toggle('note')));
    return h('div', { class: 'actions' }, row);
  }

  function copyButton(c) {
    return h('button', { class: 'primary', onclick: async (e) => {
      const ok = await S.copy(c.text);
      e.target.textContent = ok ? 'Copied ✓' : 'Copy failed';
      if (!ok) flash('Your browser blocked copying. Select the text and copy it by hand.', 'warn');
    } }, `Copy · ${c.platform_name} · ${c.chars}/${c.max_chars}`);
  }

  function counted(ta, c) {
    const n = h('span', { class: 'count' });
    const upd = () => { n.textContent = `${ta.value.length}/${c.max_chars}`; n.classList.toggle('over', ta.value.length > c.max_chars); };
    ta.addEventListener('input', upd); upd();
    return n;
  }

  function panels(c) {
    const o = state.open;
    if (o.edit === c.id) {
      const ta = h('textarea', { 'aria-label': 'Edit the post' }); ta.value = c.text;
      return h('div', { class: 'panel' }, ta, h('div', { class: 'row' }, counted(ta, c),
        h('button', { onclick: () => act({ action: 'edit', id: c.id, hash: c.hash, text: ta.value }) }, 'Save edit'),
        h('button', { class: 'pass', onclick: () => act({ action: 'edit', id: c.id, hash: c.hash, text: ta.value, and_pass: true }) }, 'Save & pass'),
        h('button', { class: 'ghost', onclick: () => { state.open = {}; render(); } }, 'Cancel')));
    }
    if (o.note === c.id) {
      const ta = h('textarea', { placeholder: "What's off about it? Claude rewrites it with this in mind.", 'aria-label': 'Note' });
      return h('div', { class: 'panel' }, ta, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => act({ action: 'note', id: c.id, text: ta.value }) }, 'Save note'), h('button', { class: 'ghost', onclick: () => { state.open = {}; render(); } }, 'Cancel')));
    }
    if (o.restore === c.id) {
      const ta = h('textarea', { placeholder: 'Why bring it back? (required; the drafter learns from it)', 'aria-label': 'Restore reason' });
      return h('div', { class: 'panel' }, ta, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => act({ action: 'restore', id: c.id, reason: ta.value }) }, 'Restore')));
    }
    if (o.posted === c.id) {
      const inp = h('input', { type: 'url', placeholder: 'Link to the live post (optional)', 'aria-label': 'Post link' });
      return h('div', { class: 'panel' }, inp, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => act({ action: 'mark_posted', id: c.id, url: inp.value.trim() || undefined }) }, 'Mark as posted')));
    }
    if (o.metrics === c.id) {
      const f = {}; const m = c.metrics || {};
      const fields = ['views', 'likes', 'replies', 'reposts', 'quotes'].map((k) => { f[k] = h('input', { type: 'number', min: '0', 'aria-label': k, value: m[k] ?? '' }); return [h('label', { text: k }), f[k]]; });
      return h('div', { class: 'panel' }, h('div', { class: 'kv' }, fields), h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => {
        const args = { action: 'add', draft_id: c.id }; for (const k in f) args[k] = Number(f[k].value) || 0;
        try { const r = await S.callTool('studio_metrics', args); flash(r.content[0].text, r.isError ? 'bad' : 'good'); state.open = {}; load(); } catch (e) { flash(String(e.message || e), 'bad'); }
      } }, 'Save numbers'), h('span', { class: 'small muted', text: 'Or paste a CSV export into the chat and ask Claude to import it.' })));
    }
    return null;
  }

  const REASONS = ['too generic', 'wrong tone', 'misses the point', 'too long', 'not our story'];

  function setCard(u) {
    const o = state.open;
    const takes = h('div', { class: 'takes' }, u.takes.map((c) => h('div', { class: `take ${c.id === u.our_pick ? 'pick' : ''}` },
      h('div', { class: 'meta' }, h('span', { text: `${c.take_n}/${u.takes.length}` }), c.id === u.our_pick ? h('span', { class: 'pill', title: 'Ranked best of the set' }, 'our pick') : null, c.experiment ? h('span', { class: 'pill warn' }, 'experiment') : null, c.shapes.map((s) => h('span', { class: 'pill' }, s))),
      h('div', { class: 'text', text: c.text }), h('span', { class: 'count', text: `${c.chars}/${c.max_chars}` }),
      c.flags.map((f) => h('span', { class: 'flag small', text: `⚠ ${f}` })),
      c.thinking ? h('details', {}, h('summary', {}, 'Thinking'), h('div', { class: 'thinking', text: c.thinking })) : null,
      h('div', { class: 'actions' }, heart(c), h('button', { class: 'primary', onclick: () => act({ action: 'pick', id: c.id, hash: c.hash }) }, 'Pick this one')))));
    let none = null;
    if (o.none === u.set_id) {
      const ta = h('textarea', { placeholder: 'What was wrong with all of them? (optional, helps the redo)', 'aria-label': 'Note on the set' });
      none = h('div', { class: 'panel' }, h('div', { class: 'chips' }, REASONS.map((r) => h('button', { class: 'chip', onclick: () => { ta.value = ta.value ? `${ta.value}; ${r}` : r; } }, r))), ta,
        h('div', { class: 'row' }, h('button', { class: 'kill', onclick: () => act({ action: 'none', set_id: u.set_id, note: ta.value.trim() || undefined }) }, 'None of these'),
          h('button', { onclick: () => act({ action: 'redo', set_id: u.set_id, note: ta.value.trim() || undefined }) }, 'None, redo these'),
          h('button', { class: 'ghost', onclick: () => { state.open = {}; render(); } }, 'Cancel')));
    }
    return h('article', { class: 'card set', id: `s${u.set_id}` },
      h('div', { class: 'meta' }, h('span', { class: 'pill platform' }, u.platform_name), h('span', { text: ago(u.released_at) }), h('span', { class: 'pill warn' }, 'pick one'), h('span', { text: `${u.takes.length} takes` })),
      context(u.takes[0]), sourceBlock(u.item), h('div', { class: 'marks' }, rankMarks(u.rank)), takes,
      none || h('div', { class: 'actions' }, h('button', { class: 'ghost', onclick: () => { state.open = { none: u.set_id }; render(); } }, 'None of these…')));
  }

  window.Board = { state, h, load, act, flash, render, ago, meter, sourceBlock, askClaudeButton };

  // ---------- boot ----------
  document.querySelectorAll('.navbtn').forEach((b) => b.addEventListener('click', () => { state.open = {}; load({ view: b.dataset.view }); }));
  let got = false;
  S.onResult((r) => { if (r && r.structuredContent && r.structuredContent.view) { got = true; S.setStamp(r.structuredContent.stamp); show(r.structuredContent); } });
  S.connect().then(() => setTimeout(() => { if (!got) load(); }, 800)).catch((e) => {
    document.getElementById('view').replaceChildren(h('p', { class: 'muted', text: `The board couldn't connect to Claude (${e.message || e}). Ask Claude to "review my drafts in chat" instead.` }));
  });
})();
