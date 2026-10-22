// Sources, Topics, Schedule, Settings, Reads and Playbook. Every setting is one click: a switch,
// a stepper, a segmented choice or a chip, saved as soon as it changes. Text fields only where
// there is text to type (a web address, a name, an example post).
(function () {
  const S = window.Studio;
  const B = window.Board;
  const { h, icon, page, card, call, setting, plural, ago } = B;
  const label = (slug) => String(slug || 'other').replace(/-/g, ' ');

  // A text field with one button; the button shows it's working while the call runs.
  function inline({ placeholder, aria, button, type = 'text', onsubmit, extra }) {
    const inp = h('input', { type, placeholder, 'aria-label': aria, inputmode: type === 'url' ? 'url' : null, autocomplete: 'off' });
    const go = h('button', { class: 'btn primary' }, button);
    const submit = async () => {
      if (!inp.value.trim()) return inp.focus && inp.focus();
      go.disabled = true; go.textContent = type === 'url' ? 'Checking…' : 'Saving…';
      try { await onsubmit(inp.value.trim()); } finally { go.disabled = false; go.textContent = button; }
    };
    go.addEventListener('click', submit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    return h('div', { class: 'field' }, inp, extra || null, go);
  }

  // ---------- Sources ----------
  const STATUS = { active: ['Active', 'ok'], paused: ['Paused', ''], failing: ['Not responding', 'bad'] };

  function sourceRow(f, topics) {
    const [st, kind] = STATUS[f.status] || ['Active', 'ok'];
    const topicSel = h('select', { 'aria-label': `Topic for ${f.name}`, onchange: (e) => call('studio_sources', { action: 'topic', url: f.url, list: f.list, topic: e.target.value }) },
      [...new Set([...topics, 'other'])].map((t) => h('option', { value: t, selected: t === f.topic }, label(t))));
    const sub = f.status === 'failing' ? `${f.host} · last try: ${f.error}` : `${f.host} · ${f.week ? `${plural(f.week, 'story', 'stories')} this week` : 'nothing new this week'}`;
    return h('div', { class: `row-item ${f.paused ? 'paused' : ''}` },
      h('span', { class: 'letter', text: (f.name.match(/[A-Za-z0-9]/) || ['?'])[0] }),
      h('span', { class: 'who' }, h('span', { class: 'nm', text: f.name }), h('span', { class: 'sub', text: sub })),
      h('span', { class: 'ctl' }, topicSel, h('span', { class: `tag ${kind}` }, st),
        B.switchCtl(!f.paused, f.paused ? `Turn ${f.name} back on` : `Pause ${f.name}`, (on) => call('studio_sources', { action: on ? 'resume' : 'pause', url: f.url, list: f.list })),
        B.confirmButton(`Remove ${f.name}`, 'Remove?', () => call('studio_sources', { action: 'remove', url: f.url, list: f.list }))));
  }

  let addList = 'feeds', linkWhen = 'next';
  function sources(d) {
    const add = card({ icon: 'sources', title: 'Add a news source', sub: 'Paste a website or feed address. It checks the source works before adding it.' },
      B.seg([{ value: 'feeds', label: 'Daily news' }, { value: 'reading', label: 'Slow reading' }], addList, (v) => { addList = v; B.render(); }, 'Add to which list'),
      h('div', { class: 'card-foot' }, inline({ type: 'url', placeholder: 'https://example.com/news', aria: 'Source address', button: 'Add', onsubmit: (url) => call('studio_sources', { action: 'add', url, list: addList }) })),
      h('p', { class: 'hint', text: addList === 'feeds' ? 'Daily news is read on every run and drafted from.' : 'Slow reading is browsed now and then for ideas. It never becomes a draft directly.' }));
    const link = card({ icon: 'link', title: 'Draft from a link', sub: 'Paste one article and it becomes a draft, even if it isn’t from your sources.' },
      B.seg([{ value: 'next', label: 'With the next run' }, { value: 'now', label: 'Ask Claude now' }], linkWhen, (v) => { linkWhen = v; B.render(); }, 'When to draft it'),
      h('div', { class: 'card-foot' }, inline({ type: 'url', placeholder: 'https://example.com/article', aria: 'Article address', button: 'Draft it', onsubmit: async (url) => {
        const r = await call('studio_draft_link', { url });
        if (r && r.ok && linkWhen === 'now') { const sent = await S.askClaude('Draft the link I just sent to Fishbowl Studio (do my studio rewrites).'); if (!sent) B.flash('Queued. Ask Claude in the chat: "do my studio rewrites".', 'good'); }
      } })),
      d.links.length ? h('div', { class: 'rows card-foot' }, d.links.map((l) => h('div', { class: 'row-item' },
        h('span', { class: 'who' }, h('span', { class: 'nm', text: l.title || l.url }), h('span', { class: 'sub', text: `${l.host} · ${ago(l.at)} ago` })),
        h('span', { class: `tag ${l.status === 'drafted' ? 'ok' : 'accent'}` }, l.status === 'drafted' ? 'Drafted' : l.status === 'queued' ? 'Queued' : l.status)))) : null);
    const list = (rows, title, sub, emptyText) => card({ icon: rows === d.feeds ? 'drafts' : 'reads', title: `${title} (${rows.length})`, sub },
      rows.length ? h('div', { class: 'rows' }, rows.map((f) => sourceRow(f, d.topics))) : B.empty({ icon: 'sources', title: 'Nothing here yet', text: emptyText }));
    return page('Sources', `Where it reads the news${d.last_fetch ? `. Last read ${ago(d.last_fetch)} ago` : ''}.`, null,
      h('div', { class: 'stack' }, h('div', { class: 'duo' }, add, link),
        list(d.feeds, 'Daily news', 'Read on every run. Pause one to skip it for a while.', 'Add a site you read for work, and drafts start from its stories.'),
        list(d.reading, 'Slow reading', 'Browsed a little each day for ideas and evergreen posts.', 'Optional: blogs or journals worth a slow read.')));
  }

  // ---------- Topics ----------
  const WEIGHTS = [{ value: 1, label: 'Less' }, { value: 2, label: 'Normal' }, { value: 3, label: 'More' }];

  function topics(d) {
    const rows = d.topics.map((t) => h('div', { class: 'row-item' },
      h('span', { class: 'letter', text: '#' }),
      h('span', { class: 'who' }, h('span', { class: 'nm', text: t.label }), h('span', { class: 'sub', text: [plural(t.sources, 'source'), t.read ? `${t.read} read lately` : null, t.approved || t.skipped ? `${t.approved} approved, ${t.skipped} skipped` : null].filter(Boolean).join(' · ') })),
      h('span', { class: 'ctl' }, B.seg(WEIGHTS, t.weight, (w) => call('studio_topics', { action: 'weight', topic: t.slug, weight: w }), `How much ${t.label}`),
        B.confirmButton(`Remove ${t.label}`, 'Remove?', () => call('studio_topics', { action: 'remove', topic: t.slug })))));
    const list = card({ icon: 'topics', title: 'Your topics', sub: '“More” lets a slightly less exciting story through; “Less” raises the bar.' },
      inline({ placeholder: 'Add a topic, like “cargo bikes”', aria: 'New topic', button: 'Add', onsubmit: (topic) => call('studio_topics', { action: 'add', topic }) }),
      h('div', { class: 'rows card-foot' }, rows.length ? rows : B.empty({ icon: 'topics', title: 'No topics yet', text: 'Add two or three things your brand talks about. Stories that fit nowhere count as “other”.' })));
    const learned = card({ icon: 'spark', title: 'Learned from your verdicts', sub: `From the last three weeks: ${plural(d.verdicts, 'approve or skip', 'approves and skips')}${d.hearts ? `, ${plural(d.hearts, 'heart')}` : ''}.` },
      d.learned.length ? h('div', { class: 'learned' }, d.learned.map((l) => h('div', { class: `learn ${l.direction}` },
        h('span', { class: 'dir' }, icon(l.direction === 'up' ? 'up' : 'down')),
        h('div', {}, h('div', {}, h('span', { class: 'nm', text: l.label }), h('span', { class: 'dots', 'aria-label': `strength ${l.strength} of 3` }, [1, 2, 3].map((i) => h('i', { class: i <= l.strength ? 'on' : '' })))),
          h('div', { class: 'why', text: `${l.direction === 'up' ? 'Writing more of these.' : 'Writing fewer of these.'} ${l.why}` })))))
        : B.empty({ icon: 'spark', title: 'Nothing learned yet', text: 'It starts noticing patterns once you have approved or skipped a few drafts.' }));
    const ranking = d.ranking.length ? card({ icon: 'settings', title: 'How it picks your drafts', sub: 'What counts most when it chooses which drafts reach you. It adjusts a little each day.' },
      h('div', { class: 'bars' }, d.ranking.map((r) => h('div', { class: 'bar-row' },
        h('span', {}, h('span', { text: `${r.label[0].toUpperCase()}${r.label.slice(1)}` }), r.change ? h('span', { class: `delta ${r.change > 0 ? 'up' : 'down'}`, text: ` ${r.change > 0 ? '+' : ''}${r.change} this week` }) : null),
        h('span', { class: 'pct', text: `${r.weight}%` }), h('span', { class: 'track' }, h('span', { style: `width: ${Math.max(2, Math.min(100, r.weight * 1.6))}%` })))))) : null;
    return page('Topics', 'What it pays attention to, and what it has learned from you.', null,
      h('div', { class: 'cols' }, h('div', { class: 'stack' }, list, learned), h('aside', { class: 'rail' }, ranking,
        card({ icon: 'bulb', title: 'How learning works', cls: 'soft' }, h('ul', { class: 'list small muted' },
          h('li', { text: 'Every approve, skip and edit is a vote.' }), h('li', { text: 'Hearts count double: “more like this”.' }), h('li', { text: 'Big changes to the playbook always wait for your yes on the Playbook page.' }))))));
  }

  // ---------- Schedule ----------
  function schedule(d) {
    const presets = card({ icon: 'sources', title: 'How often to read the news', sub: 'If Claude runs sooner than this, it skips the news and just drafts and releases.' },
      h('div', { class: 'presets', role: 'radiogroup', 'aria-label': 'News frequency' }, d.presets.map((p) => h('button', { class: `preset ${p.key === d.fetch_every ? 'on' : ''}`, role: 'radio', 'aria-checked': String(p.key === d.fetch_every), onclick: () => { if (p.key !== d.fetch_every) setting({ fetch_every: p.key }); } }, h('b', { text: p.label }), h('span', { text: p.blurb })))),
      (d.presets.find((p) => p.key === d.fetch_every) || {}).note ? h('p', { class: 'hint', text: d.presets.find((p) => p.key === d.fetch_every).note }) : null);
    const on = new Set(d.release_hours);
    const toggleHour = (hr) => {
      const next = on.has(hr) ? d.release_hours.filter((x) => x !== hr) : [...d.release_hours, hr];
      if (!next.length) return B.flash('Keep at least one time.', 'warn');
      if (next.length > 8) return B.flash('Eight times a day is the most.', 'warn');
      setting({ release_hours: next.sort((a, b) => a - b) });
    };
    const hours = card({ icon: 'schedule', title: 'When drafts reach you', sub: `Up to ${d.daily_cap} a day, shared across these times. Tap to add or remove one.` },
      h('div', { class: 'hours', role: 'group', 'aria-label': 'Release times' }, [...Array(24)].map((_, hr) => h('button', { class: `hour ${on.has(hr) ? 'on' : ''}`, 'aria-pressed': String(on.has(hr)), onclick: () => toggleHour(hr) }, `${hr}:00`))));
    const rows = (t) => {
      const kv = [['Name', t.name], ['Repeat', t.repeat], t.time ? ['Time', t.time] : null, ['Prompt', t.prompt], ['Folder', d.home]].filter(Boolean);
      return h('div', { class: 'task' }, h('div', { class: 'kv' }, kv.map(([k, v]) => [h('span', { class: 'k', text: k }), h('span', { class: 'v' }, k === 'Prompt' || k === 'Folder' ? h('code', { text: v }) : v), h('span', { class: 'copy' }, B.copyButton(v, 'Copy', 'btn sm ghost'))])));
    };
    const all = d.tasks.map((t) => `${t.text}\nFolder: ${d.home}`).join('\n\n');
    const cowork = card({ icon: 'bulb', title: 'Set it up in Claude', sub: d.tasks.length > 1 ? 'The studio can’t start itself. Claude runs it from scheduled tasks in Cowork. Make these two once:' : 'The studio can’t start itself. Claude runs it from a scheduled task in Cowork. Make this once:', end: B.copyButton(all, 'Copy all', 'btn sm') },
      d.tasks.map(rows),
      h('ol', { class: 'howto' }, h('li', { text: 'In Claude, open Cowork and choose Scheduled.' }), h('li', { text: 'Click New task and fill it in from above.' }), h('li', { text: 'Save. Your computer needs to be on with Claude open; a missed run happens the next time you open Claude.' })));
    const status = card({ icon: 'schedule', title: 'Right now', cls: 'soft' },
      h('p', { class: 'small muted', text: d.last_fetch ? `Last read the news ${ago(d.last_fetch)} ago.` : 'Hasn’t read the news yet. That happens on the first run.' }),
      h('p', { class: 'small muted', text: `Next read: ${new Date(d.next_fetch) <= new Date() ? 'on the next run' : `from ${B.hm(d.next_fetch)}${new Date(d.next_fetch).toDateString() !== new Date().toDateString() ? ` on ${new Date(d.next_fetch).toLocaleDateString([], { weekday: 'long' })}` : ''}`}.` }),
      B.askClaudeButton('Run it now', 'Run the Fishbowl Studio daily run now.', 'btn sm'));
    return page('Schedule', 'How often it reads the news, and when drafts reach you.', null,
      h('div', { class: 'cols' }, h('div', { class: 'stack' }, presets, hours, cowork), h('aside', { class: 'rail' }, status)));
  }

  // ---------- Settings ----------
  function settings(d) {
    const s = d.settings;
    const head = B.state.head || {};
    const name = h('input', { type: 'text', value: head.brand || s.brand || '', 'aria-label': 'Brand name', maxlength: '60' });
    const brand = card({ icon: 'user', title: 'Brand', sub: 'The name on your drafts and in the persona switcher.' },
      h('div', { class: 'field' }, name, h('button', { class: 'btn', onclick: () => call('studio_personas', { action: 'rename', slug: head.persona && head.persona.slug, name: name.value }) }, 'Rename')),
      h('p', { class: 'hint', text: `Files: ${d.home}` }));
    const enabled = d.platforms.filter((p) => p.enabled).length;
    const platforms = card({ icon: 'drafts', title: 'Platforms', sub: 'Where you post. Drafts are written to fit each one.' },
      d.platforms.map((p) => h('div', { class: 'setting' }, h('div', { class: 'lbl' }, h('b', { text: p.name }), h('span', { text: `Up to ${p.max_chars.toLocaleString()} characters` })),
        B.switchCtl(p.enabled, `${p.name} drafts`, (on) => {
          if (!on && enabled <= 1) return B.flash('Keep at least one platform on.', 'warn');
          setting({ platforms: { ...s.platforms, [p.id]: { ...(s.platforms[p.id] || {}), enabled: on } } });
        }))));
    const amounts = card({ icon: 'settings', title: 'How many drafts', sub: 'Changes save as you click.' },
      h('div', { class: 'setting' }, h('div', { class: 'lbl' }, h('b', { text: 'Drafts a day' }), h('span', { text: 'The most that reach you in one day' })), B.stepper(s.daily_cap, 1, 50, (v) => setting({ daily_cap: v }), 'Drafts a day')),
      h('div', { class: 'setting' }, h('div', { class: 'lbl' }, h('b', { text: 'Takes per story' }), h('span', { text: 'Different ways to write the same story' })), B.seg([1, 2, 3].map((n) => ({ value: n, label: String(n) })), s.takes_per_item, (v) => setting({ takes_per_item: v }), 'Takes per story')),
      h('div', { class: 'setting' }, h('div', { class: 'lbl' }, h('b', { text: 'Evergreen posts a day' }), h('span', { text: 'Posts not tied to the news' })), B.stepper(s.evergreen_per_day, 0, 6, (v) => setting({ evergreen_per_day: v }), 'Evergreen posts a day')));
    const samples = d.samples;
    const saveSamples = (list) => call('studio_config', { action: 'set', file: 'voice-samples.json', content: { samples: list } });
    let plat = null;
    const ta = h('textarea', { placeholder: 'Paste a post that sounds like the brand…', 'aria-label': 'Example post' });
    const platSeg = h('span', {});
    const drawSeg = () => platSeg.replaceChildren(B.seg([{ value: null, label: 'Any' }, { value: 'linkedin', label: 'LinkedIn' }, { value: 'x', label: 'X' }], plat, (v) => { plat = v; drawSeg(); }, 'Which platform'));
    drawSeg();
    const voice = card({ icon: 'note', title: 'Voice examples', sub: 'Posts that sound like the brand. It borrows the voice, never the words.', end: B.askClaudeButton('Learn my voice', 'Learn my Fishbowl Studio brand voice from my examples (/studio:voice).', 'btn sm') },
      samples.length ? h('div', { class: 'samples' }, samples.map((x, i) => h('div', { class: 'sample' }, h('div', { class: 'post-text', text: x.text }),
        h('div', { class: 'row' }, h('span', { class: 'tag' }, x.platform === 'x' ? 'X' : x.platform === 'linkedin' ? 'LinkedIn' : 'Any platform'), h('span', { class: 'grow' }),
          B.confirmButton('Remove this example', 'Remove?', () => saveSamples(samples.filter((_, j) => j !== i))))))) : B.empty({ icon: 'note', title: 'No examples yet', text: 'Paste two or three posts you love. They steer the voice more than any description.' }),
      h('div', { class: 'panel' }, ta, h('div', { class: 'row' }, platSeg, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: () => { if (ta.value.trim()) saveSamples([...samples, { text: ta.value.trim(), platform: plat }]); } }, 'Add example'))),
      samples.length >= 20 ? h('p', { class: 'hint', text: 'Twenty is the most; remove one to add another.' }) : null);
    const phrases = s.overused_phrases || [];
    const phraseCard = card({ icon: 'flag', title: 'Phrases we overuse', sub: 'It keeps these rare. Tap one to remove it.' },
      phrases.length ? h('div', { class: 'chips' }, phrases.map((p) => h('button', { class: 'chip', 'aria-label': `Remove ${p}`, onclick: () => setting({ overused_phrases: phrases.filter((x) => x !== p) }) }, p, h('span', { class: 'x' }, icon('x'))))) : h('p', { class: 'hint', text: 'None yet.' }),
      h('div', { class: 'card-foot' }, inline({ placeholder: 'A phrase, like “game-changer”', aria: 'New phrase', button: 'Add', onsubmit: (p) => setting({ overused_phrases: [...phrases, p] }) })));
    return page('Settings', `How ${head.brand || 'the brand'}'s studio works. Changes save as you click.`, null,
      h('div', { class: 'cols' }, h('div', { class: 'stack' }, platforms, amounts, voice, phraseCard, brand),
        h('aside', { class: 'rail' }, card({ icon: 'bulb', title: 'Rather just say it?', cls: 'soft', sub: 'Anything here can also be changed by asking Claude in the chat.' },
          B.askClaudeButton('Change the brand voice', 'I want to change my Fishbowl Studio brand voice.', 'btn sm'), ' ', B.askClaudeButton('Change positions', 'I want to change my Fishbowl Studio positions or audience.', 'btn sm ghost')))));
  }

  // ---------- Reads ----------
  function reads(d) {
    const cards = d.reads.map((r) => h('article', { class: 'post read' }, h('span', { class: 'letter', text: (r.source || '?')[0] }),
      h('div', { class: 'post-main' },
        h('div', { class: 'meta-line' }, h('span', { text: `${r.source || 'A story'} · read ${ago(r.triaged_at)} ago` }), Number.isFinite(r.interest) ? h('span', { class: `tag ${r.interest >= 6 ? 'ok' : ''}` }, `interest ${r.interest}/10`) : h('span', { class: 'tag accent' }, 'You sent this'), r.topic ? h('span', { class: 'tag' }, label(r.topic)) : null, r.also ? h('span', { text: `+${r.also} other outlet${r.also > 1 ? 's' : ''}` }) : null),
        h('div', { class: 'post-text', text: r.note || r.title }),
        r.note ? h('button', { class: 'quote', onclick: async () => { if (!(await S.openLink(r.url))) B.flash(r.url); } }, h('span', { class: 'src' }, icon('external'), h('span', { text: 'Open the story' })), h('span', { class: 'ttl', text: r.title })) : null,
        h('div', { class: 'post-actions' },
          r.drafted ? h('span', { class: 'tag ok' }, 'Drafted') : r.queued ? h('span', { class: 'tag accent' }, 'Queued for Claude') : h('button', { class: 'btn sm', onclick: () => B.act({ action: 'draft_this', item_id: r.id }) }, 'Draft this'),
          h('span', { class: 'grow' }), h('button', { class: `btn sm icon ghost heart ${r.hearted ? 'on' : ''}`, 'aria-label': 'Heart', 'aria-pressed': String(!!r.hearted), onclick: () => B.act({ action: 'heart', target: 'read', id: r.id }) }, icon('heart'))))));
    const wander = d.wander.length ? card({ icon: 'bulb', title: 'From wandering', sub: 'Ideas from slow reading. They feed evergreen posts.' }, h('div', { class: 'rows' }, d.wander.map((w) => h('div', { class: 'row-item' },
      h('span', { class: 'who' }, h('span', { class: 'nm', text: w.finding }), w.question ? h('span', { class: 'sub', text: `Open question: ${w.question}` }) : null, h('span', { class: 'sub', text: `${w.source || ''} · ${label(w.topic)} · interest ${w.interest}/10` })))))) : null;
    return page('Reads', 'Every story it read, with its first reaction. Draft anything it passed on.', null,
      h('div', { class: 'stack' }, d.reads.length ? h('div', { class: 'feed' }, cards) : card({}, B.empty({ icon: 'reads', title: 'Nothing read yet', text: 'Stories appear here after the first run.' })), wander));
  }

  // ---------- Playbook ----------
  function playbook(d) {
    const decide = (id, decision) => () => call('studio_proposal_decide', { id, decision });
    const props = d.proposals.length ? h('div', { class: 'rows' }, d.proposals.map((p) => h('div', { class: 'row-item' },
      h('span', { class: 'who' }, h('span', { class: 'sub' }, h('span', { class: 'tag' }, p.kind), ' ', h('span', { class: 'tag warn' }, p.op), p.section ? ` ${p.section}` : ''),
        p.old ? h('span', { class: 'sub', text: `Now: ${p.old}` }) : null, p.text ? h('span', { class: 'nm', text: p.kind === 'shape' ? `${p.name}: ${p.text}` : p.text }) : null, p.reason ? h('span', { class: 'sub', text: `Why: ${p.reason}` }) : null),
      h('span', { class: 'ctl' }, h('button', { class: 'btn sm approve', onclick: decide(p.id, 'accept') }, icon('check'), 'Accept'), h('button', { class: 'btn sm skip', onclick: decide(p.id, 'reject') }, 'Reject')))))
      : B.empty({ icon: 'playbook', title: 'No proposals waiting', text: 'The weekly report suggests changes here. Nothing changes until you accept it.' });
    const rows = (list, key) => (list.length ? h('ul', { class: 'list' }, list.map((x) => h('li', {}, B.meter(x[key]), x.text))) : h('p', { class: 'hint', text: 'None yet.' }));
    return page('Playbook', 'The rules it has learned and what the brand believes. Only you can change them.', null,
      h('div', { class: 'stack' },
        card({ icon: 'spark', title: `Proposed changes (${d.proposals.length})`, sub: 'Suggested by the weekly report.' }, props),
        card({ icon: 'playbook', title: 'Playbook' }, d.playbook.length ? h('ul', { class: 'list' }, d.playbook.map((b) => h('li', { text: b }))) : h('p', { class: 'hint', text: 'Empty.' })),
        h('div', { class: 'duo' }, card({ icon: 'flag', title: 'Positions', sub: 'Yours; Claude only suggests.' }, rows(d.positions, 'strength')),
          card({ icon: 'user', title: 'Who we write for' }, rows(d.audience.who, 'confidence'), h('p', { class: 'section-title', text: 'Buttons' }), rows(d.audience.buttons, 'confidence'))),
        card({ icon: 'drafts', title: `Shape library (${d.shapes.length})`, sub: 'The structures it writes with, weighted by your verdicts.' }, h('details', {}, h('summary', { class: 'small muted' }, 'Show shapes'), h('ul', { class: 'list' }, d.shapes.map((s) =>
          h('li', {}, h('strong', { text: s.name }), s.home ? ' (home)' : '', ` · weight ${s.weight} · ${s.up}↑ ${s.down}↓ · ${s.platforms.join(', ')}`, h('div', { class: 'small muted', text: s.mechanism })))))),
        h('div', {}, B.askClaudeButton('Ask Claude to change positions or audience', 'I want to change my Fishbowl Studio positions or audience.', 'btn'))));
  }

  Object.assign(window.BoardPages, { sources, topics, schedule, settings, reads, playbook });
})();
