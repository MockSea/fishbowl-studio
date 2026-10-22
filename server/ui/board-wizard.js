// The setup wizard: the brand, a few questions, Claude's drafts to keep, edit or drop, and
// "Post for me" per account; then one click to make it run on its own. Their answers are saved as
// they go (studio_wizard), so they can close the board and pick up where they left off. Claude's
// drafts arrive as proposals and suggested sources; nothing changes until they keep one.
(function () {
  const S = window.Studio;
  const B = window.Board;
  const { h, icon, state, call, card } = B;

  const STEPS = [['brand', 'Brand'], ['questions', 'Questions'], ['review', 'Drafts'], ['posting', 'Posting']];
  const ORDER = { brand: 0, questions: 1, drafting: 2, review: 2, posting: 3, finish: 4, done: 4 };
  const SECTIONS = [
    ['voice', 'Voice', 'How the brand sounds. Every draft is written from this.'],
    ['playbook', 'Playbook', 'How it writes. The weekly coach refines these with you.'],
    ['topic:add', 'Topics', 'What it reads and writes about.'],
    ['topic:avoid', 'Off limits', 'What it never posts about.'],
    ['audience', 'Who it’s for', 'Who the posts are written for.'],
  ];
  let poll = null, polls = 0;

  const stop = () => { clearTimeout(poll); poll = null; };
  const go = async (step, server) => {
    state.wstep = step;
    if (server) await call('studio_wizard', { action: 'step', step: server }, { reload: false, quiet: true });
    await B.load();
  };

  function progress(cur) {
    const at = ORDER[cur] ?? 0;
    return h('ol', { class: 'wsteps', 'aria-label': 'Setup steps' }, STEPS.map(([k, l], i) => h('li', { class: `${i < at ? 'done' : ''} ${i === at ? 'on' : ''}`, 'aria-current': i === at ? 'step' : null },
      h('span', { class: 'num' }, i < at ? icon('check') : String(i + 1)), h('span', { class: 'lbl', text: l }))));
  }

  // Step 1: the brand, and an optional link.
  function brandStep(d, w) {
    const name = h('input', { type: 'text', 'aria-label': 'Brand name', placeholder: 'e.g. Northwind Bicycles', maxlength: '60', value: state.wnew ? '' : w.brand || '' });
    const link = h('input', { type: 'url', inputmode: 'url', 'aria-label': 'Website or LinkedIn page', placeholder: 'https://… (optional)', value: state.wnew ? '' : w.link || '' });
    const next = h('button', { class: 'btn primary' }, 'Next');
    next.addEventListener('click', async () => {
      if (!name.value.trim()) { B.flash('Give the brand a name first.', 'warn'); return name.focus && name.focus(); }
      next.disabled = true;
      const args = { name: name.value.trim(), link: link.value.trim() };
      const r = state.wnew ? await call('studio_wizard', { action: 'create', ...args }, { reload: false, quiet: true }) : await call('studio_wizard', { action: 'start', ...args }, { reload: false, quiet: true });
      next.disabled = false;
      if (r && r.ok) { state.wnew = false; await go('questions'); }
    });
    return card({ icon: 'user', title: 'What’s the brand called?', sub: 'You can run several brands; each gets its own drafts, sources and voice.' },
      h('label', { class: 'q' }, h('b', { text: 'Brand name' }), name),
      h('label', { class: 'q' }, h('b', { text: 'Website or LinkedIn page' }), h('span', { class: 'hint', text: 'Optional. Claude reads the public page to learn about the brand. What it says is treated as outside text: it can’t change your settings or add sources.' }), link),
      h('div', { class: 'chips card-foot' }, next, state.wnew ? h('button', { class: 'btn ghost', onclick: () => { state.wnew = false; state.wstep = null; B.load({ view: 'drafts' }); } }, 'Cancel') : null));
  }

  // Step 2: a few short questions (the last asks for example posts), each with an example, each skippable. Saved as they go.
  function questionsStep(d, w) {
    const boxes = {};
    const save = () => call('studio_wizard', { action: 'answer', answers: Object.fromEntries(Object.entries(boxes).map(([k, t]) => [k, t.value])) }, { reload: false, quiet: true });
    const qs = w.questions.map((q) => {
      const ta = h('textarea', { 'aria-label': q.label, placeholder: q.example, rows: q.long ? '5' : '2' });
      ta.value = w.answers[q.key] || '';
      ta.addEventListener('change', save);
      boxes[q.key] = ta;
      return h('div', { class: 'q' }, h('b', { text: q.label }), h('span', { class: 'hint', text: q.example }), ta,
        h('button', { class: 'btn sm ghost skip-q', onclick: () => { ta.value = ''; save(); } }, 'Skip this one'));
    });
    const draft = h('button', { class: 'btn primary' }, icon('spark'), 'Draft it for me');
    draft.addEventListener('click', async () => {
      draft.disabled = true;
      await save();
      const r = await call('studio_wizard', { action: 'draft' }, { reload: false, quiet: true });
      draft.disabled = false;
      if (!r || !r.ok) return;
      const sent = await S.askClaude(r.prompt);
      if (!sent) B.flash(`Ask Claude in the chat: "${r.prompt}"`, 'warn');
      polls = 0; state.wstep = null; await B.load();
    });
    return card({ icon: 'note', title: `A few questions about ${w.brand}`, sub: 'Plain answers are best. Skip anything you’re not sure about; Claude makes a sensible guess and you can change it after.' },
      h('div', { class: 'qs' }, qs),
      h('div', { class: 'chips card-foot' }, h('button', { class: 'btn ghost', onclick: async () => { await save(); go('brand', 'brand'); } }, 'Back'), draft));
  }

  // Step 3a: waiting for Claude in the chat. Checks every few seconds for five minutes.
  function draftingStep(d, w) {
    stop();
    if (polls < 75) poll = setTimeout(() => { polls++; if (state.view === 'wizard') B.load(); }, 4000);
    const prompt = `Draft the Fishbowl Studio setup for ${w.brand}.`;
    return card({ icon: 'spark', title: `Claude is drafting ${w.brand}`, sub: 'The voice, a starting playbook, topics, what’s off limits, who it’s for and a few starter sources. It shows up here when it’s ready, usually in a minute or two.', cls: 'waiting' },
      h('div', { class: 'wait-line', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'dots-wait', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { text: polls >= 75 ? 'Still nothing. Is the chat open?' : 'Waiting for Claude in the chat…' })),
      h('p', { class: 'hint' }, 'Nothing happening? In the chat, say: ', h('b', { text: `“${prompt}”` })),
      h('div', { class: 'chips card-foot' }, h('button', { class: 'btn ghost', onclick: () => { stop(); go('questions', 'questions'); } }, 'Back to the questions'),
        h('button', { class: 'btn', onclick: () => { polls = 0; B.load(); } }, 'Check now'), B.askClaudeButton('Ask Claude again', prompt, 'btn ghost')));
  }

  // Step 3b: each draft, editable in place; Keep applies their version, Drop discards it.
  function reviewStep(d, w) {
    const fields = {};
    const decided = (x) => h('span', { class: `tag ${x.status === 'accepted' ? 'ok' : ''}` }, x.status === 'accepted' ? (x.edited ? 'Kept your version' : 'Kept') : x.status === 'rejected' ? 'Dropped' : 'Replaced');
    const keep = (x) => call('studio_proposal_decide', { id: x.id, decision: 'accept', ...(fields[x.id] && fields[x.id].value.trim() !== x.text ? { text: fields[x.id].value } : {}) });
    const row = (x) => {
      const open = x.status === 'open';
      const field = x.kind === 'voice' ? h('textarea', { 'aria-label': 'Voice', rows: '9', class: 'voice-edit' }) : h('input', { type: 'text', 'aria-label': `${B.KIND_LABEL[x.kind]}: ${x.text}` });
      field.value = x.text;
      if (!open) field.disabled = true;
      fields[x.id] = field;
      return h('div', { class: `draft-row ${open ? '' : 'decided'}` }, field,
        h('div', { class: 'chips' }, open ? [h('button', { class: 'btn sm approve', onclick: () => keep(x) }, icon('check'), 'Keep'), h('button', { class: 'btn sm ghost', onclick: () => call('studio_proposal_decide', { id: x.id, decision: 'reject' }) }, 'Drop')] : decided(x)));
    };
    const groups = SECTIONS.map(([key, title, sub]) => {
      const [kind, op] = key.split(':');
      const xs = w.drafts.filter((x) => x.kind === kind && (!op || x.op === op) && x.status !== 'superseded');
      return xs.length ? card({ icon: { voice: 'note', playbook: 'playbook', topic: op === 'avoid' ? 'flag' : 'topics', audience: 'user' }[kind], title, sub }, h('div', { class: 'draft-rows' }, xs.map(row))) : null;
    }).filter(Boolean);
    const srcs = w.sources.filter((x) => x.status !== 'superseded');
    const sources = srcs.length ? card({ icon: 'sources', title: 'Starter sources', sub: 'Suggestions only: nothing is read until you add it. Each one is tested when you do.' },
      h('div', { class: 'rows' }, srcs.map((x) => h('div', { class: 'row-item' }, h('span', { class: 'who' }, h('span', { class: 'nm', text: x.label }), x.why ? h('span', { class: 'sub', text: x.why }) : null, x.error ? h('span', { class: 'sub warn-text', text: `Last try: ${x.error}` }) : null),
        h('span', { class: 'ctl' }, x.status === 'open' ? [h('button', { class: 'btn sm approve', onclick: () => call('studio_proposal_decide', { id: x.id, decision: 'accept' }) }, icon('plus'), 'Add'), h('button', { class: 'btn sm ghost', onclick: () => call('studio_proposal_decide', { id: x.id, decision: 'reject' }) }, 'Dismiss')] : h('span', { class: `tag ${x.status === 'accepted' ? 'ok' : ''}` }, x.status === 'accepted' ? 'Added' : 'Dismissed')))))) : null;
    const open = w.drafts.filter((x) => x.status === 'open');
    const keepAll = async () => { for (const x of open) await call('studio_proposal_decide', { id: x.id, decision: 'accept', ...(fields[x.id] && fields[x.id].value.trim() !== x.text ? { text: fields[x.id].value } : {}) }, { reload: false, quiet: true }); await B.load(); B.flash('Kept them. Change any of it later in Settings, Topics and Playbook.', 'good'); };
    const again = async () => { const r = await call('studio_wizard', { action: 'draft' }, { reload: false, quiet: true }); if (r && r.ok) { const sent = await S.askClaude(r.prompt); if (!sent) B.flash(`Ask Claude in the chat: "${r.prompt}"`, 'warn'); polls = 0; state.wstep = null; await B.load(); } };
    const site = w.site && w.site.error ? h('p', { class: 'hint', text: `Your link wasn’t read (${w.site.error}), so these come from your answers.` }) : null;
    return [card({ icon: 'spark', title: `Here’s a first draft of ${w.brand}`, sub: 'Change any line, then Keep it, or Drop what’s wrong. Nothing changes until you keep it.', end: open.length > 1 ? h('button', { class: 'btn sm', onclick: keepAll }, 'Keep everything') : null }, site,
      !groups.length && !srcs.length ? B.empty({ icon: 'spark', title: 'Nothing drafted', text: 'Ask Claude to draft it again.' }) : null),
    ...groups, sources,
    h('div', { class: 'chips' }, h('button', { class: 'btn ghost', onclick: () => go('questions', 'questions') }, 'Back'), h('button', { class: 'btn ghost', onclick: again }, icon('redo'), 'Draft it again'), h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: () => go('posting', 'posting') }, open.length ? `Next (${open.length} still open)` : 'Next'))];
  }

  // Step 4: "Post for me", per account, off unless they turn it on.
  function postingStep(d, w) {
    const accts = d.accounts.filter((a) => a.capabilities.post === true);
    return card({ icon: 'at', title: 'Should Claude post for you?', sub: 'Off unless you turn it on, one account at a time. When it’s on, a draft you approve on the board is posted at the next release time through your own signed-in browser. When it’s off, you copy and post as usual.' },
      h('div', { class: 'rows' }, accts.map((a) => h('div', { class: 'row-item acct' },
        h('span', { class: 'letter' }, a.icon && window.StudioIcons.has(a.icon) ? icon(a.icon) : a.label[0]),
        h('span', { class: 'who' }, h('span', { class: 'nm', text: a.label }), h('span', { class: 'sub', text: a.connected ? 'Connected' : 'Not connected' })),
        h('span', { class: 'ctl' }, a.connected ? null : h('button', { class: 'btn sm', onclick: async () => {
          const r = await call('studio_account_set', { action: 'connect', type: a.id });
          if (r && r.ok && r.prompt) { const sent = await S.askClaude(r.prompt); if (!sent) B.flash(`Ask Claude in the chat: "${r.prompt}"`, 'warn'); }
        } }, icon('plus'), 'Connect')),
        h('div', { class: 'full' }, B.postingControl(a))))),
      h('div', { class: 'chips card-foot' }, h('button', { class: 'btn ghost', onclick: () => go('review', w.drafted_at ? 'review' : 'questions') }, 'Back'), h('button', { class: 'btn primary', onclick: () => go('finish') }, 'Next')));
  }

  // Finish: make it run on its own (one click asks Claude to create the scheduled tasks).
  function finishStep(d, w) {
    const sch = d.schedule;
    return card({ icon: 'schedule', title: 'Make it run on its own', sub: 'A plugin can’t start itself. Claude can make the scheduled task in Cowork for you; you approve it once.' },
      h('ul', { class: 'list small' }, sch.tasks.map((t) => h('li', {}, h('b', { text: t.name }), ` · ${t.repeat}${t.time ? ` at ${t.time}` : ''}`))),
      h('div', { class: 'chips card-foot' }, B.askClaudeButton('Set it up for me', sch.setup_prompt, 'btn primary'), h('button', { class: 'btn ghost', onclick: () => { state.wstep = null; B.load({ view: 'schedule' }); } }, 'I’ll do it by hand')),
      h('p', { class: 'hint', text: 'Your computer needs to be awake with Claude open at those times. A missed run happens the next time you open Claude.' }),
      h('div', { class: 'chips card-foot' }, h('button', { class: 'btn ghost', onclick: () => go('posting', 'posting') }, 'Back'), h('span', { class: 'grow' }),
        h('button', { class: 'btn approve', onclick: async () => { const r = await call('studio_wizard', { action: 'finish' }, { reload: false }); if (r && r.ok) { state.wstep = null; B.load({ view: 'drafts', tab: 'waiting', chip: 'all' }); } } }, icon('check'), w.finished_at ? 'Done' : 'Finish setup')));
  }

  function wizard(d) {
    const w = d.wizard;
    let step = state.wnew ? 'brand' : state.wstep || w.step || 'brand';
    if (w.step === 'drafting' && !state.wstep) step = 'drafting';
    if (step === 'done') step = 'finish';
    if (step !== 'drafting') stop();
    const body = { brand: brandStep, questions: questionsStep, drafting: draftingStep, review: reviewStep, posting: postingStep, finish: finishStep }[step](d, w);
    return B.page(state.wnew ? 'Add a brand' : `Set up ${w.brand}`, 'One setup for each brand. Close it any time: your answers are kept.', null,
      h('div', { class: 'wizard' }, progress(step), h('div', { class: 'stack' }, body)));
  }

  window.BoardPages.wizard = wizard;
})();
