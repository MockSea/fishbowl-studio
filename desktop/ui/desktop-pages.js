// Desktop-only pages and cards: Brand kit, the API key, the schedule (runs while the app is
// open), and run progress. Loaded after the shared board scripts; uses window.Board for every
// control so it looks like the rest of the board. Text from files and the server only reaches
// the DOM through textContent.
(function () {
  const S = window.Studio;
  const B = window.Board;
  const { h, icon, page, card, empty, plural, ago, since } = B;
  let prefs = { autorun: false };
  let keyState = { has: true };

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
    const r = files ? await S.kit.add(files) : await S.kit.pick();
    if (!r) return;
    if (files && !r.results.length) return B.flash('Those files couldn\'t be read. Try Choose files instead.', 'bad');
    const ok = r.results.filter((x) => x.ok), bad = r.results.filter((x) => !x.ok);
    if (bad.length) B.flash(bad.map((x) => `${x.name}: ${x.reason}`).join(' '), 'bad');
    else if (ok.length) B.flash(`Added ${plural(ok.length, 'file')}.`, 'good');
    B.load({ view: 'brandkit' });
  }

  window.BoardPages.brandkit = (d) => {
    const kit = d.kit;
    const brand = (d.header && d.header.brand) || 'the brand';
    const accept = kit.accept.join(', ');
    const drop = h('div', { class: 'drop', role: 'group', 'aria-label': 'Drop files here' },
      h('span', { class: 'ico' }, icon('plus')),
      h('b', { text: 'Drop brand files here' }),
      h('span', { class: 'small', text: `${accept}. Up to ${size(kit.limits.file_bytes)} a file (images ${size(kit.limits.image_bytes)}), ${kit.limits.files} files.` }),
      h('button', { class: 'btn sm', onclick: () => addFiles(null) }, 'Choose files'));
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    drop.addEventListener('dragenter', (e) => { stop(e); drop.classList.add('over'); });
    drop.addEventListener('dragover', (e) => { stop(e); drop.classList.add('over'); });
    drop.addEventListener('dragleave', (e) => { stop(e); drop.classList.remove('over'); });
    drop.addEventListener('drop', (e) => { stop(e); drop.classList.remove('over'); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

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

  // ---------- API key ----------
  window.BoardPages.apikey = (d) => {
    const k = d.key;
    const input = h('input', { type: 'password', placeholder: 'sk-ant-…', 'aria-label': 'Anthropic API key', autocomplete: 'off', spellcheck: 'false' });
    const save = h('button', { class: 'btn primary', onclick: async () => {
      save.disabled = true;
      const r = await S.key.set(input.value);
      input.value = '';
      save.disabled = false;
      if (!r.ok) return B.flash(r.reason, 'bad');
      keyState = r;
      B.flash('Saved. Pick a brand and add a source to get drafts.', 'good');
      B.load({ view: k.has ? 'apikey' : 'drafts' });
    } }, k.has ? 'Replace key' : 'Save key');
    const remove = k.has ? h('button', { class: 'btn ghost', onclick: async () => { keyState = await S.key.clear(); B.flash('Removed the key.', 'good'); B.load({ view: 'apikey' }); } }, 'Remove key') : null;
    const main = card({ icon: 'settings', title: 'Anthropic API key', sub: k.has ? `A key ending ${k.hint || ''} is saved.` : 'The app drafts with Claude through your own Anthropic account. Paste an API key to start.' },
      h('div', { class: 'field key-field' }, input, save, remove),
      !k.encryption ? h('p', { class: 'hint', text: 'This computer can\'t encrypt the key right now, so it can\'t be saved.' }) : null,
      h('p', { class: 'hint', text: `Drafts use ${d.model}. Usage is billed to that account.` }));
    const where = card({ icon: 'bulb', title: 'Where it\'s kept', cls: 'soft' },
      h('ul', { class: 'list small' },
        h('li', { text: 'Encrypted with your system keychain and kept in the app\'s own folder, never in the studio folder or in a log.' }),
        h('li', { text: 'Only the app\'s main process reads it, to call the Anthropic API.' })));
    return page('Claude', 'Connect the app to Claude.', null, h('div', { class: 'cols' }, h('div', { class: 'stack' }, main), h('aside', { class: 'rail' }, where)));
  };

  // ---------- hooks into shared pages ----------
  const autorunSwitch = () => B.switchCtl(prefs.autorun, 'Run while the app is open', async (on) => { prefs = await S.prefs.set({ autorun: on }); B.flash(on ? 'It will run on its own while the app is open.' : 'Automatic runs are off.', 'good'); B.render(); });
  const autorunRow = () => h('div', { class: 'setting' }, h('div', { class: 'lbl' }, h('b', { text: 'Run on its own' }),
    h('span', { text: 'While the app is open it reads the news on your schedule and drafts what\'s worth it. Each run uses your API key.' })), autorunSwitch());

  window.BoardHooks = {
    scheduleCard: () => card({ icon: 'bulb', title: 'Runs in the app', sub: 'The app releases batches at your times whenever it is open. Drafting can run on its own too.' },
      autorunRow(),
      h('p', { class: 'hint', text: 'Close the app and nothing runs. A missed batch is released the next time you open it.' })),
    settingsRail: () => [
      card({ icon: 'settings', title: 'Claude', cls: 'soft', sub: keyState.has ? `API key saved (${keyState.hint || 'hidden'}).` : 'No API key yet.' },
        h('button', { class: 'btn sm', onclick: () => B.load({ view: 'apikey' }) }, keyState.has ? 'Change key' : 'Add key')),
      card({ icon: 'briefcase', title: 'Brand kit', cls: 'soft', sub: 'Guideline files every draft is written with.' },
        h('button', { class: 'btn sm', onclick: () => B.load({ view: 'brandkit' }) }, 'Open the brand kit')),
    ],
    noPosting: () => true,
    finishBody: () => ({ sub: 'The app runs it while it is open. Turn this on to have it read and draft by itself.', body: [autorunRow()] }),
  };

  // ---------- runs ----------
  const KIND = { daily: 'the daily run', jobs: 'the rewrite queue', wizard: 'the setup drafts' };
  S.onRun((ev) => {
    if (ev.state === 'start') B.flash(`Working on ${KIND[ev.kind] || 'it'}…`, 'info');
    else if (ev.state === 'done') { B.flash(ev.message || 'Done.', 'good'); B.load(); }
    else if (ev.state === 'error') B.flash(ev.message || 'That run failed.', 'bad');
  });

  // ---------- boot: no key yet, start on the key page ----------
  S.prefs.get().then((p) => { prefs = p; });
  S.key.status().then((k) => { keyState = k; if (!k.has) { B.state.view = 'apikey'; B.load({ view: 'apikey' }); } });
})();
