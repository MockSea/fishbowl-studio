// Drafts: today's drafts as a feed of posts. Approve, edit or skip each one; pick one take from
// a set; copy what's approved. Lint flags show as friendly chips under the post.
(function () {
  const S = window.Studio;
  const B = window.Board;
  const { h, icon, state, act, ago } = B;

  const TABS = [['waiting', 'To review'], ['passed', 'Approved'], ['killed', 'Skipped'], ['scrapped', 'Expired']];
  const CHIP_LABEL = { all: 'Everything', sets: 'Pick one', singles: 'Single drafts', experiments: 'Experiments', flagged: 'Needs a look', rewritten: 'Rewritten', 'to post': 'Not posted yet', posted: 'Posted', killed: 'Skipped', 'passed over': 'None of these', unpicked: 'Not picked', stale: 'Went stale', 'over cap': 'Over the daily cap' };
  const STATUS = { pending: ['To review', ''], option: ['Pick one', 'warn'], passed: ['Approved · not posted', 'ok'], edited: ['Approved (edited) · not posted', 'ok'], posted: ['Posted', 'ok'], killed: ['Skipped', 'bad'], passed_over: ['None of these', 'bad'], unpicked: ['Not picked', ''], scrapped: ['Expired', ''] };
  const NOTE_CHIPS = ['Too long', 'Too salesy', 'Not like us', 'Make it punchier', 'Too formal'];
  const SET_REASONS = ['Too generic', 'Wrong tone', 'Misses the point', 'Too long', 'Not our story'];
  const RESTORE_CHIPS = ['It grew on me', 'Right after all', 'Wrong button'];
  // Why they skipped: one optional tap. Same keys as the server's KILL_REASONS.
  const WHY = [['off_brand', 'Off-brand'], ['wrong_topic', 'Wrong topic'], ['too_salesy', 'Too salesy'], ['boring', 'Boring'], ['factually_off', 'Factually off'], ['other', 'Other']];

  // After a skip: ask why, once, without getting in the way. Ignoring it is fine.
  async function skip(args) {
    const r = await act(args);
    if (r && r.ok && r.ask_reason) { state.why = args.set_id != null ? { set_id: args.set_id } : { id: args.id }; B.render(); }
  }
  function whyAsk() {
    const w = state.why;
    if (!w) return null;
    const pick = (reason) => async () => { state.why = null; await act({ action: 'kill_reason', ...w, reason }, { quiet: true }); B.flash('Thanks. It learns from that.', 'good'); };
    return h('div', { class: 'card soft why-ask', role: 'group', 'aria-label': 'Why did you skip it?' },
      h('div', { class: 'row' }, h('b', { text: w.set_id != null ? 'Why none of these?' : 'Why skip it?' }), h('span', { class: 'hint', text: 'Optional. One tap helps it learn.' }), h('span', { class: 'grow' }),
        h('button', { class: 'btn sm icon ghost', 'aria-label': 'No reason', onclick: () => { state.why = null; B.render(); } }, icon('x'))),
      h('div', { class: 'chips' }, WHY.map(([k, l]) => h('button', { class: 'chip', onclick: pick(k) }, l))));
  }
  function reasonLine(c) {
    if (!['killed', 'passed_over'].includes(c.status)) return null;
    if (c.kill_reason_label) return h('div', { class: 'post-ctx' }, icon('flag'), `Skipped as: ${c.kill_reason_label}`);
    if (state.open.why !== c.id) return null;
    return h('div', { class: 'panel' }, h('div', { class: 'chips' }, WHY.map(([k, l]) => h('button', { class: 'chip', onclick: () => act({ action: 'kill_reason', id: c.id, reason: k }) }, l))));
  }

  // Lint flags in their words.
  function friendly(f) {
    const inParens = (f.label.match(/\(([^)]*)\)/) || [])[1];
    switch (f.code) {
      case 'number': return `Check the number${inParens && inParens.includes(',') ? 's' : ''}: ${inParens || ''} isn't in the story`;
      case 'quote': return "Check the quote: it isn't in the story";
      case 'person': return `Check the name: ${(f.label.match(/^names (.+?),/) || [])[1] || 'someone'} isn't in the story`;
      case 'hashtag': return 'Has a hashtag';
      case 'url': return 'Has a link in it';
      case 'long': return `Long for the platform${inParens ? ` (${inParens})` : ''}`;
      case 'tie-back': return 'Mentions an earlier post';
      case 'news-voice': return 'Sounds like a news report';
      case 'handle': return 'Mentions an @handle';
      case 'stat-uncited': return 'A statistic with no source';
      case 'quote-uncited': return 'A quotation with no source';
      case 'name-uncited': return 'Names someone with no source';
      default: return f.label;
    }
  }
  const flagChips = (c) => (c.lint && c.lint.length ? h('div', { class: 'flags' }, c.lint.map((f) => h('span', { class: 'tag warn', title: f.label }, icon('flag'), friendly(f)))) : null);

  // The character count ring, like a post composer: fills as the post grows, amber near the
  // limit, red over it. The SVG is built from numbers only.
  function ring(chars, max) {
    const r = 9, C = 2 * Math.PI * r, pct = max ? Math.min(chars / max, 1) : 0;
    const cls = max && chars > max ? 'over' : max && chars > max * 0.9 ? 'near' : '';
    const wrap = h('span', { class: `counter ${cls === 'over' ? 'over' : ''}`, 'aria-label': `${chars} of ${max} characters` });
    const svg = h('span', { class: 'ic', 'aria-hidden': 'true' });
    svg.innerHTML = `<svg class="ring ${cls}" viewBox="0 0 22 22"><circle class="track" cx="11" cy="11" r="${r}"/><circle class="fill" cx="11" cy="11" r="${r}" stroke-dasharray="${(C * pct).toFixed(2)} ${C.toFixed(2)}"/></svg>`;
    wrap.append(svg, h('span', { text: `${chars}/${max}` }));
    return wrap;
  }

  const me = () => (state.head && state.head.persona) || { slug: 'studio', name: 'Fishbowl Studio' };
  // "Post for me" is on for this draft's account: their Approve here is their OK to post it.
  const posts = (c) => ((state.head && state.head.posting && state.head.posting.on) || []).includes(c.platform);
  const approve = (c, text) => (posts(c)
    ? B.call('studio_post_schedule', { id: c.id, hash: c.hash, ...(text != null ? { text } : {}) })
    : act(text != null ? { action: 'edit', id: c.id, hash: c.hash, text, and_pass: true } : { action: 'pass', id: c.id, hash: c.hash }));

  function postHead(c, extra) {
    const [label, kind] = STATUS[c.status] || [c.status, ''];
    return h('div', { class: 'post-head' },
      h('span', { class: 'identity' }, h('span', { class: 'nm', text: me().name }), h('span', { class: 'meta', text: `@${me().slug}` }),
      h('span', { class: 'meta', text: `· ${ago(c.released_at || c.created_at) || 'new'}` })),
      h('span', { class: 'tag' }, c.platform_name),
      h('span', { class: 'end' }, extra || null, h('span', { class: `tag ${kind}` }, label)));
  }

  function context(c) {
    const t = c.kind === 'evergreen' ? 'Evergreen post, not tied to a story' : c.origin === 'draft_thought' ? 'Drafted from a thought you liked' : c.origin === 'redo' ? 'A second try at this story' : c.origin === 'owner_item' || c.origin === 'draft_item' ? 'You asked for this story' : null;
    const r = c.rewriting ? 'Being rewritten from your note…' : c.revised ? 'Rewritten from your note' : null;
    return t || r || c.scrap_reason ? h('div', { class: 'post-ctx' }, icon(r ? 'redo' : 'spark'), [t, r, c.scrap_reason ? (c.scrap_reason === 'stale' ? 'Went stale before you saw it' : 'Over the daily cap') : null].filter(Boolean).join(' · ')) : null;
  }

  function quote(item) {
    if (!item) return null;
    return h('button', { class: 'quote', title: 'Open the story', onclick: async () => { if (!(await S.openLink(item.url))) B.flash(item.url); } },
      h('span', { class: 'src' }, icon('reads'), h('span', { text: `${item.source || 'Story'}${item.published ? ` · ${ago(item.published)}` : ''}` }), icon('external')),
      h('span', { class: 'ttl', text: item.title }));
  }

  function why(c) {
    if (!c.thinking) return null;
    return h('details', { class: 'why' }, h('summary', {}, icon('bulb'), 'Why it wrote this'),
      h('div', { class: 'thinking', text: c.thinking }),
      h('div', { class: 'post-actions' }, heart(c, 'thinking', c.thinking_hearted, 'Love this thought'), h('button', { class: 'btn sm', onclick: () => act({ action: 'draft_this', id: c.id }) }, 'Draft a post from this')));
  }

  const heart = (c, target = 'draft', on = c.hearted, label = 'Love it') => h('button', { class: `btn sm icon ghost heart ${on ? 'on' : ''}`, 'aria-label': on ? 'Remove heart' : label, 'aria-pressed': String(!!on), title: label, onclick: () => act({ action: 'heart', target, id: c.id }) }, icon('heart'));
  const btn = (label, cls, ic, fn, extra = {}) => h('button', { class: `btn sm ${cls}`, onclick: fn, ...extra }, ic ? icon(ic) : null, h('span', { class: 'lbl', text: label }));
  const toggle = (k, c) => () => { state.open = state.open[k] === c.id ? {} : { [k]: c.id }; B.render(); };
  const close = () => { state.open = {}; B.render(); };

  function copyButton(c) {
    const label = `Copy · ${c.platform_name} · ${c.chars}/${c.max_chars}`;
    return h('button', { class: 'btn sm primary', onclick: async (e) => {
      const ok = await S.copy(c.text);
      const b = e.target;
      if (ok) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = label; }, 2500); }
      else B.flash('Your browser blocked copying. Select the text and copy it by hand.', 'warn');
    } }, label);
  }

  function actions(c) {
    const row = [];
    if (c.status === 'pending') row.push(
      btn(posts(c) ? 'Approve & post' : 'Approve', 'approve', 'check', () => approve(c), posts(c) ? { title: `Claude posts it to ${c.platform_name} at the next release time` } : {}),
      btn('Edit', '', 'edit', toggle('edit', c)),
      btn('Skip', 'skip', 'x', () => skip({ action: 'kill', id: c.id }), { title: 'Not this one. It learns from that; you can bring it back.' }));
    if (['passed', 'edited'].includes(c.status)) {
      const p = c.post;
      const live = p && ['scheduled', 'posting'].includes(p.status);
      row.push(copyButton(c));
      if (posts(c) && !live && (!p || ['cancelled'].includes(p.status) || p.seen)) row.push(btn('Post it for me', '', 'at', () => B.call('studio_post_schedule', { id: c.id, hash: c.hash })));
      row.push(btn('Mark as posted', '', 'check', toggle('posted', c)), btn('Skip', 'skip', 'x', () => skip({ action: 'kill', id: c.id })));
    }
    if (c.status === 'posted') row.push(copyButton(c), btn('Add numbers', '', 'up', toggle('metrics', c)), c.post_url ? btn('Open post', 'ghost', 'external', () => S.openLink(c.post_url)) : null);
    if (c.status === 'killed') row.push(btn('Bring back', '', 'redo', toggle('restore', c)));
    if (['killed', 'passed_over'].includes(c.status) && !c.kill_reason) row.push(btn('Say why', 'ghost', 'flag', toggle('why', c), { title: 'Optional: what was wrong with it' }));
    if (c.status === 'scrapped') row.push(btn('Bring back', '', 'redo', () => act({ action: 'resurrect', id: c.id })));
    row.push(h('span', { class: 'grow' }), heart(c));
    if (!['posted'].includes(c.status)) row.push(btn('Rewrite', 'ghost', 'note', toggle('note', c), { title: 'Leave a note and Claude rewrites it' }));
    row.push(ring(c.chars, c.max_chars));
    return h('div', { class: 'post-actions' }, row);
  }

  function chipsInto(ta, list) {
    return h('div', { class: 'chips' }, list.map((r) => h('button', { class: 'chip', onclick: () => { ta.value = ta.value ? `${ta.value}; ${r.toLowerCase()}` : r.toLowerCase(); } }, r)));
  }

  function panels(c) {
    const o = state.open;
    if (o.note === c.id) {
      const ta = h('textarea', { placeholder: "What's off about it? Claude rewrites it with this in mind.", 'aria-label': 'Note for the rewrite' });
      return h('div', { class: 'panel' }, chipsInto(ta, NOTE_CHIPS), ta, h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: () => act({ action: 'note', id: c.id, text: ta.value }) }, 'Ask for a rewrite'), h('button', { class: 'btn sm ghost', onclick: close }, 'Cancel')));
    }
    if (o.restore === c.id) {
      const ta = h('textarea', { placeholder: 'What changed your mind? It learns from this.', 'aria-label': 'Why bring it back' });
      return h('div', { class: 'panel' }, chipsInto(ta, RESTORE_CHIPS), ta, h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: () => act({ action: 'restore', id: c.id, reason: ta.value }) }, 'Bring it back'), h('button', { class: 'btn sm ghost', onclick: close }, 'Cancel')));
    }
    if (o.posted === c.id) {
      const inp = h('input', { type: 'url', placeholder: 'Link to the live post (optional)', 'aria-label': 'Post link' });
      return h('div', { class: 'panel' }, inp, h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: () => act({ action: 'mark_posted', id: c.id, url: inp.value.trim() || undefined }) }, 'Mark as posted'), h('button', { class: 'btn sm ghost', onclick: close }, 'Cancel')));
    }
    if (o.metrics === c.id) {
      const f = {}; const m = c.metrics || {};
      const fields = ['views', 'likes', 'replies', 'reposts', 'quotes'].map((k) => { f[k] = h('input', { type: 'number', min: '0', inputmode: 'numeric', 'aria-label': k, value: m[k] ?? '' }); return h('label', { class: 'metric' }, h('span', { text: k }), f[k]); });
      return h('div', { class: 'panel' }, h('div', { class: 'metrics' }, fields), h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: () => {
        const args = { action: 'add', draft_id: c.id }; for (const k in f) args[k] = Number(f[k].value) || 0;
        B.call('studio_metrics', args);
      } }, 'Save numbers'), h('span', { class: 'hint', text: 'Or paste a CSV export into the chat and ask Claude to import it.' })));
    }
    return null;
  }

  // The post text, or the editor in its place.
  function body(c) {
    if (state.open.edit !== c.id) return h('div', { class: 'post-text', text: c.text });
    const ta = h('textarea', { 'aria-label': 'Edit the post' }); ta.value = c.text;
    const count = h('span', {});
    const upd = () => count.replaceChildren(ring(ta.value.length, c.max_chars));
    ta.addEventListener('input', upd); upd();
    setTimeout(() => ta.focus && ta.focus(), 0);
    return h('div', { class: 'panel' }, ta, h('div', { class: 'row' },
      h('button', { class: 'btn sm approve', onclick: () => approve(c, ta.value) }, icon('check'), posts(c) ? 'Save & approve to post' : 'Save & approve'),
      h('button', { class: 'btn sm', onclick: () => act({ action: 'edit', id: c.id, hash: c.hash, text: ta.value }) }, 'Save edit'),
      h('button', { class: 'btn sm ghost', onclick: close }, 'Cancel'), h('span', { class: 'grow' }), count));
  }

  // Where an approved post stands when Claude posts it: scheduled, posted, or why it didn't go
  // out. A missed or failed post stays here until they pick what to do; nothing retries by itself.
  function postLine(c) {
    const p = c.post;
    if (!p || (p.seen && !['scheduled', 'posting', 'posted'].includes(p.status))) return c.posted_by === 'claude' ? h('div', { class: 'post-ctx' }, icon('check'), 'Posted by Claude') : null;
    const at = p.slot ? `${B.hm(p.slot)}${new Date(p.slot).toDateString() !== new Date().toDateString() ? ` on ${new Date(p.slot).toLocaleDateString([], { weekday: 'long' })}` : ''}` : '';
    if (p.status === 'scheduled') return h('div', { class: 'post-ctx' }, icon('schedule'), `Claude posts this to ${p.platform} at ${at}, if your computer is awake.`);
    if (p.status === 'posting') return h('div', { class: 'post-ctx' }, icon('at'), `Claude is posting this to ${p.platform} now.`);
    if (p.status === 'posted') return h('div', { class: 'post-ctx' }, icon('check'), `Posted to ${p.platform} by Claude ${B.ago(p.done_at)} ago.`, p.unchecked ? h('span', { class: 'tag warn' }, 'text not checked') : null);
    if (p.status === 'cancelled') return h('div', { class: 'post-ctx' }, icon('x'), `Not posted: ${p.reason}`);
    const label = { missed: `Missed the ${B.hm(p.slot)} slot`, failed: 'Didn’t post', blocked: 'Held back' }[p.status] || p.status;
    return h('div', { class: 'post-problem', role: 'status' }, h('div', { class: 'row' }, icon('flag'), h('b', { text: label }), h('span', { text: p.reason || '' })),
      h('div', { class: 'chips' }, p.status !== 'blocked' ? h('button', { class: 'btn sm', onclick: () => B.call('studio_post_schedule', { id: c.id, hash: c.hash, again: true }) }, 'Try the next slot') : null,
        h('button', { class: 'btn sm ghost', onclick: () => B.call('studio_post_schedule', { dismiss: p.id }) }, 'I’ll copy it myself')));
  }

  function draftCard(c) {
    return h('article', { class: 'post', id: `d${c.id}` }, B.avatar(me()),
      h('div', { class: 'post-main' }, postHead(c), context(c), postLine(c), body(c),
        c.original ? h('div', { class: 'post-original', text: `Before your edit: ${c.original}` }) : null,
        flagChips(c), quote(c.item),
        c.restore_trail.map((r) => h('div', { class: 'restore-trail', text: `Skipped, then brought back: ${r.reason}` })), reasonLine(c),
        why(c), state.open.edit === c.id ? null : actions(c), panels(c)));
  }

  function setCard(u) {
    const o = state.open;
    const takes = h('div', { class: 'takes' }, u.takes.map((c) => h('div', { class: `take ${c.id === u.our_pick ? 'pick' : ''}` },
      h('div', { class: 'take-head' }, h('b', { text: `Take ${c.take_n}` }), c.id === u.our_pick ? h('span', { class: 'tag accent', title: 'Ranked best of the set' }, icon('spark'), 'Best bet') : null, c.experiment ? h('span', { class: 'tag warn', title: c.experiment }, 'Experiment') : null),
      h('div', { class: 'post-text', text: c.text }), flagChips(c), why(c),
      h('div', { class: 'post-actions' }, h('button', { class: 'btn sm primary', onclick: () => act({ action: 'pick', id: c.id, hash: c.hash }) }, icon('check'), 'Use this one'), h('span', { class: 'grow' }), heart(c), ring(c.chars, c.max_chars)))));
    let none;
    if (o.none === u.set_id) {
      const ta = h('textarea', { placeholder: 'What was wrong with all of them? (optional, helps the next try)', 'aria-label': 'Note on the set' });
      none = h('div', { class: 'panel' }, chipsInto(ta, SET_REASONS), ta,
        h('div', { class: 'row' }, h('button', { class: 'btn sm skip', onclick: () => skip({ action: 'none', set_id: u.set_id, note: ta.value.trim() || undefined }) }, 'None of these'),
          h('button', { class: 'btn sm', onclick: () => act({ action: 'redo', set_id: u.set_id, note: ta.value.trim() || undefined }) }, icon('redo'), 'None, try again'),
          h('button', { class: 'btn sm ghost', onclick: close }, 'Cancel')));
    } else none = h('div', { class: 'post-actions' }, h('button', { class: 'btn sm ghost', onclick: () => { state.open = { none: u.set_id }; B.render(); } }, 'None of these…'));
    const first = u.takes[0];
    return h('article', { class: 'post set', id: `s${u.set_id}` }, B.avatar(me()),
      h('div', { class: 'post-main' }, postHead({ ...first, status: 'option', released_at: u.released_at }),
        h('div', { class: 'set-intro' }, icon('spark'), `${u.takes.length} takes on this story. Pick the one you'd post.`), context(first), quote(u.item), takes, none));
  }

  function emptyFor(d) {
    const next = state.head && state.head.counter && state.head.counter.next;
    if (d.chip !== 'all' || d.platform !== 'all') return B.empty({ icon: 'drafts', title: 'Nothing matches', text: 'Try another filter.', action: h('button', { class: 'btn sm', onclick: () => B.load({ chip: 'all', platform: 'all' }) }, 'Show everything') });
    return {
      waiting: B.empty({ icon: 'check', title: "You're all caught up", text: next ? `New drafts arrive at ${B.hm(next)}.` : 'New drafts arrive with tomorrow\'s first batch.' }),
      passed: B.empty({ icon: 'check', title: 'Nothing approved yet', text: 'Drafts you approve wait here, ready to copy and post.' }),
      killed: B.empty({ icon: 'x', title: 'Nothing skipped', text: 'Drafts you skip land here. You can always bring one back.' }),
      scrapped: B.empty({ icon: 'schedule', title: 'Nothing expired', text: 'Drafts that sat too long or went over the daily cap land here. You can bring them back.' }),
    }[d.tab];
  }

  function drafts(d) {
    const head = state.head || {};
    const fr = B.firstRunCard(head);
    const filters = h('div', { class: 'filters' },
      B.seg(TABS.map(([v, l]) => ({ value: v, label: l, n: d.counts[v] || 0 })), d.tab, (t) => B.load({ tab: t, chip: 'all' }), 'Which drafts'),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' },
        [{ id: 'all', name: 'All platforms' }, ...(d.platforms || [])].map((p) => h('button', { class: `chip ${p.id === d.platform ? 'on' : ''}`, 'aria-pressed': String(p.id === d.platform), onclick: () => B.load({ platform: p.id }) }, p.name)),
        d.chips.filter((c) => c !== 'all').map((c) => h('button', { class: `chip ${c === d.chip ? 'on' : ''}`, 'aria-pressed': String(c === d.chip), onclick: () => B.load({ chip: c === d.chip ? 'all' : c }) }, CHIP_LABEL[c] || c))));
    const list = d.units.length ? h('div', { class: 'feed' }, d.units.map((u) => (u.type === 'set' ? setCard(u) : draftCard(u))))
      : fr && d.tab === 'waiting' ? null : h('div', { class: 'feed' }, emptyFor(d));
    const more = d.total > d.units.length ? h('p', { class: 'hint', text: `Showing ${d.units.length} of ${d.total}.` }) : null;
    return B.page('Drafts', `Today's drafts for ${head.brand || 'your brand'}. Approve the good ones, fix the nearly-good ones.`, null,
      h('div', { class: 'cols' }, h('div', { class: 'stack' }, fr, whyAsk(), filters, list, more), h('aside', { class: 'rail', 'aria-label': 'Today and your brands' }, B.todayCard(head), B.profilesCard(head))));
  }

  window.BoardPages.drafts = drafts;
})();
