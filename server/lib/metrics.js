// Manual metrics entry and CSV import of platform analytics. Numbers feed the results
// multiplier on shapes, the "entertaining" signal and the engagement half of weight tuning.
import { outcomeOf } from './tune.js';
import { normaliseUrl } from './urls.js';
import { normSpace } from './text.js';

const FIELDS = ['views', 'likes', 'replies', 'reposts', 'quotes'];
const ALIASES = {
  views: ['views', 'impressions', 'impression', 'reach'],
  likes: ['likes', 'reactions', 'like', 'favorites', 'favourites'],
  replies: ['replies', 'comments', 'reply', 'comment'],
  reposts: ['reposts', 'shares', 'retweets', 'repost', 'share'],
  quotes: ['quotes', 'quote', 'quote posts'],
  url: ['url', 'link', 'post link', 'post url', 'permalink'],
  text: ['text', 'post text', 'post', 'content', 'commentary', 'tweet text'],
  date: ['date', 'created', 'posted', 'published', 'time'],
};

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text).replace(/^\uFEFF/, '');
  const first = s.split(/\r?\n/)[0];
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const num = (v) => { const n = Number(String(v ?? '').replace(/[,\s%]/g, '')); return Number.isFinite(n) ? n : 0; };

export function mapColumns(header) {
  const h = header.map((x) => x.trim().toLowerCase());
  const col = {}, used = new Set();
  const claim = (test) => {
    for (const [k, names] of Object.entries(ALIASES)) {
      if (k in col) continue;
      const i = h.findIndex((x, j) => !used.has(j) && names.some((n) => test(x, n)));
      if (i >= 0) { col[k] = i; used.add(i); }
    }
  };
  claim((x, n) => x === n);
  claim((x, n) => x.startsWith(n + ' ') || x.endsWith(' ' + n));
  return col;
}

function matchDraft(posted, row, col) {
  if (col.url != null && row[col.url]) {
    const u = normaliseUrl(row[col.url].trim());
    const d = posted.find((p) => p.post_url && normaliseUrl(p.post_url) === u);
    if (d) return d;
  }
  if (col.text != null && row[col.text]) {
    const t = normSpace(row[col.text]).toLowerCase().slice(0, 60);
    if (t.length >= 20) return posted.find((p) => normSpace(p.final_text || p.text).toLowerCase().startsWith(t)) || null;
  }
  return null;
}

export function addSnapshot(d, m, at) {
  const snap = { at };
  for (const f of FIELDS) snap[f] = Math.max(0, Math.round(num(m[f])));
  d.metrics_snapshots = [...(d.metrics_snapshots || []), snap];
  d.metrics = snap;
  d.outcome = outcomeOf(d);
  return snap;
}

export function metricsTool(ctx, args) {
  const iso = ctx.iso();
  return ctx.tx((db) => {
    if (args.action === 'add') {
      const d = db.drafts.find((x) => x.id === Number(args.draft_id));
      if (!d) throw new Error(`No draft ${args.draft_id}.`);
      if (d.status !== 'posted') throw new Error('Mark the draft as posted first (it needs to be on the Passed tab, marked posted).');
      const snap = addSnapshot(d, args, iso);
      return { ok: true, text: `Saved numbers for draft ${d.id}: ${FIELDS.map((f) => `${f} ${snap[f]}`).join(', ')}.` };
    }
    if (args.action === 'import_csv') {
      const rows = parseCsv(args.csv || '');
      if (rows.length < 2) throw new Error('The CSV needs a header row and at least one data row.');
      const col = mapColumns(rows[0]);
      if (col.url == null && col.text == null) throw new Error('The CSV needs a column with the post link (url) or the post text, to match rows to posts.');
      const posted = db.drafts.filter((d) => d.status === 'posted' && (!args.platform || d.platform === args.platform));
      let matched = 0; const unmatched = [];
      rows.slice(1).forEach((r, i) => {
        const d = matchDraft(posted, r, col);
        if (!d) { unmatched.push(i + 2); return; }
        const m = Object.fromEntries(FIELDS.map((f) => [f, col[f] != null ? r[col[f]] : 0]));
        addSnapshot(d, m, iso);
        matched++;
      });
      return { ok: true, matched, unmatched_rows: unmatched.slice(0, 50), text: `Matched ${matched} row(s) to posted drafts; ${unmatched.length} row(s) didn't match a post the studio knows.` };
    }
    throw new Error('action must be "add" or "import_csv"');
  });
}
