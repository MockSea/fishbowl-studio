// The app's own pages and cards: Brand kit, Claude (which engine drafts, and the API key), the
// schedule (runs while the studio is open, the weekly coach report on Fridays), and run progress
// and notices. Loaded after the shared board scripts; uses window.Board for every
// control so it looks like the rest of the board. Text from files and the server only reaches
// the DOM through textContent.
(function () {
  const S = window.Studio;
  const B = window.Board;
  const { h, icon, page, card, empty, plural, ago, since } = B;
  let prefs = { autorun: false, engine: 'auto' };
  let keyState = { has: true, engine: { engine: 'claude' } };

  S.sentText = 'Started. New drafts show up here when it finishes.';

  const css = document.createElement('style');
  css.textContent = `
.drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--s-2); padding: var(--s-6); border: var(--border) dashed var(--line-strong); border-radius: var(--r-lg); background: var(--surface-2); text-align: center; color: var(--ink-2); }
.drop.over { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-text); }
.kit-file .preview { color: var(--ink-3); font-size: var(--t-sm); white-space: pre-wrap; overflow: hidden; max-height: 4.5em; }
.key-field input { font-family: var(--mono, ui-monospace, monospace); }
`;
  document.head.appendChild(css);

  // ---------- nav ----------
  const topics = document.querySelector('.navbtn[data-view="topics"]');
  const kitBtn = h('button', { class: 'navbtn', 'data-view': 'brandkit', 'data-icon': 'briefcase' }, icon('briefcase'), h('span', { class: 'lbl' }, 'Brand kit'));
  kitBtn.addEventListener('click', () => { Object.assign(B.state, { open: {}, why: null, menu: false, wnew: false, wstep: null, arming: null }); B.setDrawer(false); B.load({ view: 'brandkit' }); });
  topics.after(kitBtn);

  const size = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

  // ---------- Brand kit ----------
  async function addFiles(files) {
    if (!files || !files.length) return;
    B.flash(`Adding ${plural(files.length, 'file')}…`, 'info');
    const r = await S.kit.add(files);
    const ok = r.results.filter((x) => x.ok), bad = r.results.filter((x) => !x.ok);
    if (bad.length) B.flash(bad.map((x) => `${x.name}: ${x.reason}`).join(' '), 'bad');
    else if (ok.length) B.flash(`Added ${plural(ok.length, 'file')}.`, 'good');
    B.load({ view: 'brandkit' });
  }

  window.BoardPages.brandkit = (d) => {
    const kit = d.kit;
    const brand = (d.header && d.header.brand) || 'the brand';
    const accept = kit.accept.join(', ');
    const picker = h('input', { type: 'file', multiple: true, accept: kit.accept.join(','), hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
    picker.addEventListener('change', () => { const f = Array.from(picker.files || []); picker.value = ''; addFiles(f); });
    const drop = h('div', { class: 'drop', role: 'group', 'aria-label': 'Drop files here' },
      h('span', { class: 'ico' }, icon('plus')),
      h('b', { text: 'Drop brand files here' }),
      h('span', { class: 'small', text: `${accept}. Up to ${size(kit.limits.file_bytes)} a file (images ${size(kit.limits.image_bytes)}), ${kit.limits.files} files.` }),
      h('button', { class: 'btn sm', onclick: () => picker.click() }, 'Choose files'), picker);
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    drop.addEventListener('dragenter', (e) => { stop(e); drop.classList.add('over'); });
    drop.addEventListener('dragover', (e) => { stop(e); drop.classList.add('over'); });
    drop.addEventListener('dragleave', (e) => { stop(e); drop.classList.remove('over'); });
    drop.addEventListener('drop', (e) => { stop(e); drop.classList.remove('over'); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files)); });

    const rows = kit.files.map((f) => h('div', { class: 'row-item kit-file' },
      h('span', { class: 'who' },
        h('span', { class: 'nm', text: f.name }),
        h('span', { class: 'sub' }, h('span', { class: 'tag' }, f.label), ` ${size(f.bytes)} · added ${since(f.added_at)}`,
          f.chars != null ? ` · ${f.chars.toLocaleString()} characters read${f.truncated ? ' (the first part is used)' : ''}` : ' · sent as an image'),
        f.preview ? h('span', { class: 'preview', text: f.preview.replace(/\n\s*\n+/g, '\n') }) : null),
      h('span', { class: 'ctl' }, B.confirmButton(`Remove ${f.name}`, 'Remove?', async () => {
        const r = await S.kit.remove(f.id);
        B.flash(r.ok ? `Removed ${r.name}.` : r.reason, r.ok ? 'good' : 'bad');
        B.load({ view: 'brandkit' });
      }))));
    const files = card({ icon: 'note', title: 'In the kit', sub: kit.files.length ? `${plural(kit.files.length, 'file')}, ${size(kit.total_bytes)}` : null },
      kit.files.length ? rows : empty({ icon: 'briefcase', title: 'Nothing here yet', text: 'Add the brand guidelines, a tone-of-voice doc, a logo or a few on-brand images.' }));
    const how = card({ icon: 'bulb', title: 'How it\'s used', cls: 'soft' },
      h('ul', { class: 'list small' },
        h('li', { text: `Every draft for ${brand} is written with these files in view: the text of each document, and the images as images.` }),
        h('li', { text: 'Files are copied into the brand\'s folder on this computer. Their contents go to Claude with each drafting request, and nowhere else.' }),
        h('li', { text: 'Scanned PDFs have no text to read. Add the pages as images instead.' })));
    return page('Brand kit', `Guideline files for ${brand}. Each brand has its own kit.`, null,
      h('div', { class: 'cols' }, h('div', { class: 'stack' }, card({}, drop), files), h('aside', { class: 'rail' }, how)));
  };

  // ---------- Claude: which engine drafts, and the API key ----------
  const CONSOLE = 'https://console.anthropic.com/settings/keys';
  const ENGINE_NOW = { claude: 'Drafting with Claude Code, on your Claude plan.', api: 'Drafting with your Anthropic API key.' };

  window.BoardPages.apikey = (d) => {
    const k = d.key;
    const e = k.engine;
    const setEngine = async (v) => { prefs = await S.prefs.set({ engine: v }); B.flash('Saved.', 'good'); B.load({ view: 'apikey' }); };
    const status = e.engine ? ENGINE_NOW[e.engine]
      : e.mode === 'claude' ? 'Claude Code isn\'t installed on this computer, so nothing can draft yet.'
      : 'Not connected yet. Add an API key below, or install Claude Code.';
    const engineCard = card({ icon: 'spark', title: 'How it drafts', sub: status },
      B.seg([{ value: 'auto', label: 'Automatic' }, { value: 'claude', label: 'Claude Code' }, { value: 'api', label: 'API key' }], e.mode, setEngine, 'Which engine drafts'),
      h('ul', { class: 'list small' },
        h('li', { text: e.claude.found ? 'Claude Code is installed on this computer. Drafts made with it count toward your Claude plan\'s usage.' : 'Claude Code isn\'t installed on this computer.' }),
        h('li', { text: 'Automatic uses Claude Code when it\'s installed and your API key otherwise. If Claude Code stops working, it switches to the key and tells you.' }),
        e.claude_failed ? h('li', { text: `Claude Code failed earlier: ${e.claude_failed}` }) : null),
      h('p', { class: 'hint', text: `Today: ${k.calls_today} of ${k.calls_per_day} model calls. Each run is capped too, whichever engine answers.` }));

    const input = h('input', { type: 'password', placeholder: 'sk-ant-…', 'aria-label': 'Anthropic API key', autocomplete: 'off', spellcheck: 'false' });
    const save = h('button', { class: 'btn primary', onclick: async () => {
      save.disabled = true;
      let r;
      try { r = await S.key.set(input.value); } catch (err) { r = { ok: false, reason: err.message }; }
      input.value = '';
      save.disabled = false;
      if (!r.ok) return B.flash(r.reason, 'bad');
      keyState = r;
      B.flash(r.fell_back ? `Saved in ${r.where_label}: this computer's keychain wasn't available.` : 'Saved. Pick a brand and add a source to get drafts.', 'good');
      B.load({ view: k.has ? 'apikey' : 'drafts' });
    } }, k.has ? 'Replace key' : 'Save key');
    const remove = k.has && k.where !== 'env' ? h('button', { class: 'btn ghost', onclick: async () => { keyState = await S.key.clear(); B.flash('Removed the key.', 'good'); B.load({ view: 'apikey' }); } }, 'Remove key') : null;
    const keyCard = card({ icon: 'settings', title: 'Anthropic API key', sub: k.has ? `A key ending ${k.hint || ''} is saved.` : 'Optional when Claude Code is installed. Usage is billed to your Anthropic account.' },
      h('div', { class: 'field key-field' }, input, save, remove),
      h('p', { class: 'hint', text: k.has ? `Kept in ${k.where_label}. Drafts use ${d.model}.` : `It will be kept in ${k.target_label}. Drafts use ${d.model}.` }));

    const steps = card({ icon: 'bulb', title: 'Getting an API key', cls: 'soft' },
      h('ol', { class: 'list small' },
        h('li', {}, 'Open the Anthropic Console and sign in, or create an account. ', h('button', { class: 'btn sm', onclick: async () => { if (!(await S.openLink(CONSOLE))) B.flash(CONSOLE); } }, icon('external'), 'Open the Console')),
        h('li', { text: 'Under Billing, add a payment method and some credit. The studio\'s use is billed there.' }),
        h('li', { text: 'Under API keys, choose Create key. Name it Fishbowl Studio and copy it. It starts with sk-ant-.' }),
        h('li', { text: 'Paste it in the box here and choose Save key.' })));
    const where = card({ icon: 'bulb', title: 'Where it\'s kept', cls: 'soft' },
      h('ul', { class: 'list small' },
        h('li', { text: `In ${k.has ? k.where_label : k.target_label}. Never in a log, a brand's files, or this page.` }),
        h('li', { text: 'Only the studio\'s own process reads it, to call the Anthropic API.' })));
    return page('Claude', 'Choose how the studio drafts.', null, h('div', { class: 'cols' }, h('div', { class: 'stack' }, engineCard, keyCard), h('aside', { class: 'rail' }, steps, where)));
  };

  // ---------- hooks into shared pages ----------
  const autorunSwitch = () => B.switchCtl(prefs.autorun, 'Run while the studio is open', async (on) => { prefs = await S.prefs.set({ autorun: on }); B.flash(on ? 'It will run on its own while the studio is open.' : 'Automatic runs are off.', 'good'); B.render(); });
  const autorunRow = () => h('div', { class: 'setting' }, h('div', { class: 'lbl' }, h('b', { text: 'Run on its own' }),
    h('span', { text: 'While the studio is open it reads the news on your schedule and drafts what\'s worth it.' })), autorunSwitch());

  window.BoardHooks = {
    scheduleCard: () => card({ icon: 'bulb', title: 'Runs while the studio is open', sub: 'It releases batches at your times while the studio is running. Drafting can run on its own too.' },
      autorunRow(),
      h('p', { class: 'hint', text: 'Closing the browser tab keeps it running. Stop the command (Ctrl+C, or close its window) and nothing runs; batches that came due are released the next time you start it.' })),
    settingsRail: () => [
      card({ icon: 'settings', title: 'Claude', cls: 'soft', sub: keyState.engine && keyState.engine.engine ? ENGINE_NOW[keyState.engine.engine] : 'Not connected yet.' },
        h('button', { class: 'btn sm', onclick: () => B.load({ view: 'apikey' }) }, 'Engine and API key')),
      card({ icon: 'briefcase', title: 'Brand kit', cls: 'soft', sub: 'Guideline files every draft is written with.' },
        h('button', { class: 'btn sm', onclick: () => B.load({ view: 'brandkit' }) }, 'Open the brand kit')),
    ],
    noPosting: () => true,
    sourceKinds: () => ['site', 'reddit'],
    finishBody: () => ({ sub: 'The studio runs it while it is open. Turn this on to have it read and draft by itself.', body: [autorunRow()] }),
  };

  // ---------- runs ----------
  const KIND = { daily: 'the daily run', jobs: 'the rewrite queue', wizard: 'the setup drafts', weekly: 'the weekly report' };
  S.onRun((ev) => {
    if (ev.state === 'start') B.flash(`Working on ${KIND[ev.kind] || 'it'}…`, 'info');
    else if (ev.state === 'done') { B.flash(ev.message || 'Done.', 'good'); B.load(); }
    else if (ev.state === 'error') B.flash(ev.message || 'That run failed.', 'bad');
    else if (ev.state === 'notice') B.flash(ev.message, 'info');
  });

  // ---------- boot: nothing to draft with yet, start on the Claude page ----------
  S.prefs.get().then((p) => { prefs = p; });
  S.key.status().then((k) => { keyState = k; if (!k.engine.engine) { B.state.view = 'apikey'; B.load({ view: 'apikey' }); } });
})();
