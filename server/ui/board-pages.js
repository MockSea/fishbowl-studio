// Reads, Playbook and Settings views.
(function () {
  const S = window.Studio;
  const B = window.Board;
  const { h } = B;

  function reads(d) {
    if (!d || d.view !== 'reads') return h('p', { class: 'muted' }, 'Loading…');
    const cards = d.reads.map((r) => h('article', { class: 'card' },
      h('div', { class: 'meta' }, h('span', { text: `read · ${B.ago(r.triaged_at)}` }), h('span', { class: `pill ${r.interest >= 6 ? 'ok' : ''}` }, `interest ${r.interest}/10`), r.topic ? h('span', { class: 'pill' }, r.topic) : null, r.also ? h('span', { text: `+${r.also} other outlet${r.also > 1 ? 's' : ''}` }) : null),
      h('div', { class: 'text', text: r.note || '(no reaction)' }), B.sourceBlock(r),
      h('div', { class: 'actions' },
        h('button', { class: `heart ${r.hearted ? 'on' : ''}`, 'aria-label': 'Heart', onclick: () => B.act({ action: 'heart', target: 'read', id: r.id }) }, r.hearted ? '♥' : '♡'),
        r.drafted ? h('span', { class: 'small muted', text: 'drafted' }) : r.queued ? h('span', { class: 'small muted', text: 'queued for Claude' }) :
          h('button', { onclick: async () => { const sc = await B.act({ action: 'draft_this', item_id: r.id }); if (sc && sc.ok) offerAsk(); } }, 'Draft this'))));
    const wander = d.wander.length ? [h('div', { class: 'section' }, 'From wandering'), d.wander.map((w) => h('article', { class: 'card' },
      h('div', { class: 'meta' }, h('span', { class: 'pill' }, w.topic || 'other'), h('span', { text: `interest ${w.interest}/10` })),
      h('div', { class: 'text', text: w.finding }), w.question ? h('div', { class: 'context', text: `open question: ${w.question}` }) : null, B.sourceBlock(w)))] : [];
    return h('div', {}, d.reads.length ? cards : h('div', { class: 'empty' }, 'Nothing read yet. Reads appear after the daily run.'), wander);
  }

  function offerAsk() {
    B.flash('Queued. Claude drafts it on the next run.', 'good');
  }

  function playbook(d) {
    if (!d || d.view !== 'playbook') return h('p', { class: 'muted' }, 'Loading…');
    const decide = (id, action) => async () => {
      try { const r = await S.callTool('studio_proposals', { action, id }); B.flash(r.content[0].text, r.isError ? 'bad' : 'good'); B.load(); } catch (e) { B.flash(String(e.message || e), 'bad'); }
    };
    const props = d.proposals.length ? d.proposals.map((p) => h('article', { class: 'card' },
      h('div', { class: 'meta' }, h('span', { class: 'pill' }, p.kind), h('span', { class: 'pill warn' }, p.op), p.section ? h('span', { text: p.section }) : null, h('span', { text: B.ago(p.created_at) })),
      p.old ? h('div', { class: 'original', text: `now: ${p.old}` }) : null,
      p.text ? h('div', { class: 'text', text: p.kind === 'shape' ? `${p.name}: ${p.text}` : p.text }) : null,
      p.reason ? h('div', { class: 'context', text: `why: ${p.reason}` }) : null,
      h('div', { class: 'actions' }, h('button', { class: 'pass', onclick: decide(p.id, 'accept') }, 'Accept'), h('button', { class: 'kill', onclick: decide(p.id, 'reject') }, 'Reject'))))
      : [h('div', { class: 'empty' }, 'No proposals waiting. The weekly report suggests changes here.')];
    const rows = (list, key) => list.length ? h('ul', { class: 'list' }, list.map((x) => h('li', {}, B.meter(x[key]), ' ', x.text))) : h('p', { class: 'muted' }, '(none yet)');
    return h('div', {},
      h('div', { class: 'section' }, `Proposed changes (${d.proposals.length})`), props,
      h('div', { class: 'section' }, 'Playbook'), d.playbook.length ? h('ul', { class: 'list' }, d.playbook.map((b) => h('li', { text: b }))) : h('p', { class: 'muted' }, '(empty)'),
      h('div', { class: 'section' }, 'Positions (yours; Claude only suggests)'), rows(d.positions, 'strength'),
      h('div', { class: 'section' }, 'Who we write for'), rows(d.audience.who, 'confidence'),
      h('div', { class: 'section' }, 'Buttons (topics that get a rise)'), rows(d.audience.buttons, 'confidence'),
      h('details', {}, h('summary', {}, `Shape library (${d.shapes.length})`), h('ul', { class: 'list' }, d.shapes.map((s) =>
        h('li', {}, h('strong', { text: s.name }), s.home ? ' (home)' : '', ` · weight ${s.weight} · ${s.up}↑ ${s.down}↓ · ${s.platforms.join(', ')}`, h('div', { class: 'small muted', text: s.mechanism }))))),
      h('div', { class: 'actions' }, B.askClaudeButton('Ask Claude to change positions or audience', 'I want to change my Fishbowl Studio positions or audience.')));
  }

  function settings(d) {
    if (!d || d.view !== 'settings') return h('p', { class: 'muted' }, 'Loading…');
    const s = d.settings;
    const plat = {};
    const platRows = d.platforms.map((p) => { plat[p.id] = h('input', { type: 'checkbox', id: `p-${p.id}`, checked: p.enabled }); return h('label', { class: 'row', for: `p-${p.id}` }, plat[p.id], ` ${p.name} (up to ${p.max_chars} characters)`); });
    const hours = h('input', { type: 'text', value: s.release_hours.join(', '), 'aria-label': 'Release times', inputmode: 'numeric' });
    const cap = h('input', { type: 'number', min: '1', max: '50', value: s.daily_cap, 'aria-label': 'Drafts per day' });
    const takes = h('select', { 'aria-label': 'Takes per story' }, [1, 2, 3].map((n) => h('option', { value: n, selected: n === s.takes_per_item }, String(n))));
    const ever = h('input', { type: 'number', min: '0', max: '6', value: s.evergreen_per_day, 'aria-label': 'Evergreen posts per day' });
    const phrases = h('textarea', { 'aria-label': 'Phrases we overuse', placeholder: 'one per line' }); phrases.value = (s.overused_phrases || []).join('\n');
    const save = async () => {
      const patch = {
        platforms: Object.fromEntries(Object.entries(plat).map(([id, el]) => [id, { ...(s.platforms[id] || {}), enabled: el.checked }])),
        release_hours: hours.value.split(/[,\s]+/).filter(Boolean).map(Number),
        daily_cap: Number(cap.value), takes_per_item: Number(takes.value), evergreen_per_day: Number(ever.value),
        overused_phrases: phrases.value.split('\n').map((x) => x.trim()).filter(Boolean),
      };
      if (!Object.values(patch.platforms).some((p) => p.enabled)) return B.flash('Keep at least one platform on.', 'warn');
      try { const r = await S.callTool('studio_config', { action: 'patch', patch }); B.flash(r.content[0].text, r.isError ? 'bad' : 'good'); if (!r.isError) B.load(); } catch (e) { B.flash(String(e.message || e), 'bad'); }
    };
    const srcList = (list) => list.length ? h('ul', { class: 'list' }, list.map((f) => h('li', {}, h('strong', { text: f.name }), ` · ${f.topic} · `, h('span', { class: 'small muted', text: f.url })))) : h('p', { class: 'muted' }, '(none)');
    return h('div', {},
      h('div', { class: 'section' }, 'Platforms'), platRows,
      h('div', { class: 'section' }, 'Schedule'),
      h('div', { class: 'kv' }, h('label', { text: 'Release times (24h)' }), hours, h('label', { text: 'Drafts to review per day' }), cap, h('label', { text: 'Takes per story' }), takes, h('label', { text: 'Evergreen posts per day' }), ever),
      h('div', { class: 'section' }, 'Phrases we overuse'), phrases,
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: save }, 'Save settings')),
      h('div', { class: 'section' }, `News feeds (${d.feeds.length})`), srcList(d.feeds),
      h('div', { class: 'section' }, `Reading list for wandering (${d.reading.length})`), srcList(d.reading),
      h('div', { class: 'actions' }, B.askClaudeButton('Ask Claude to change sources', 'I want to change my Fishbowl Studio news sources.')),
      h('p', { class: 'small muted', text: `Everything lives in: ${d.home}` }));
  }

  window.BoardPages = { reads, playbook, settings };
})();
