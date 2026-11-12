// Builds docs/qa/electron-0.1.0/index.html from two sources:
//   findings.json (written by hand: bugs, what was not tested, UX notes) and
//   shots/<mode>-results.json (written by walk.mjs and finder.mjs).
// Screenshots stay in shots/ beside the page. Run on its own with `node report.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './lib.mjs';

const DIR = path.dirname(OUT);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const MODES = { source: 'From source (npm run desktop)', built: 'Built .app, launched with Finder\'s PATH', finder: 'Built .app, opened by LaunchServices (open)' };

export default async function report() {
  const f = JSON.parse(fs.readFileSync(path.join(DIR, 'findings.json'), 'utf8'));
  const runs = Object.keys(MODES).map((m) => {
    const p = path.join(OUT, `${m}-results.json`);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { mode: m, results: null };
  });
  const img = (s) => fs.existsSync(path.join(OUT, s)) ? `<a href="shots/${esc(s)}"><img loading="lazy" src="shots/${esc(s)}" alt="${esc(s)}"></a>` : `<p class="miss">Screenshot ${esc(s)} was not produced in this run.</p>`;
  const sev = { high: 0, medium: 1, low: 2 };
  const bugs = [...f.bugs].sort((a, b) => sev[a.severity] - sev[b.severity]);

  const counts = runs.map((r) => r.results
    ? `<tr><td>${esc(MODES[r.mode])}</td><td>${r.results.filter((x) => x.ok).length}</td><td>${r.results.filter((x) => !x.ok).length}</td><td>${esc((r.at || '').slice(0, 16).replace('T', ' '))} UTC</td></tr>`
    : `<tr><td>${esc(MODES[r.mode])}</td><td colspan="3">Not run. ${esc(f.not_run?.[r.mode] || '')}</td></tr>`).join('');

  const bugHtml = bugs.map((b) => `
<article class="bug" id="${esc(b.id)}">
  <header><span class="sev ${esc(b.severity)}">${esc(b.severity)}</span><h3>${esc(b.id)}. ${esc(b.title)}</h3><span class="area">${esc(b.area)}</span></header>
  <div class="cols">
    <div>
      <h4>Steps</h4><ol>${b.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <h4>Expected</h4><p>${esc(b.expected)}</p>
      <h4>Actual</h4><p>${esc(b.actual)}</p>
      ${b.where ? `<h4>Where</h4><p><code>${esc(b.where)}</code></p>` : ''}
      <p class="seen">Seen in: ${esc(b.seen_in.map((m) => MODES[m] || m).join('; '))}</p>
    </div>
    <div class="shots">${b.shots.map(img).join('')}</div>
  </div>
</article>`).join('');

  const passHtml = runs.filter((r) => r.results).map((r) => {
    const areas = [...new Set(r.results.map((x) => x.area))];
    return `<details${r.mode === 'source' ? ' open' : ''}><summary>${esc(MODES[r.mode])}: ${r.results.filter((x) => x.ok).length} of ${r.results.length} checks passed</summary>
${areas.map((a) => `<h4>${esc(a)}</h4><ul class="checks">${r.results.filter((x) => x.area === a).map((x) => `<li class="${x.ok ? 'ok' : 'no'}"><span>${x.ok ? 'Pass' : 'Fail'}</span> ${esc(x.name)}${x.detail ? `<div class="detail">${esc(x.detail)}</div>` : ''}${x.shot && fs.existsSync(path.join(OUT, x.shot)) ? ` <a href="shots/${esc(x.shot)}">screenshot</a>` : ''}</li>`).join('')}</ul>`).join('')}
</details>`;
  }).join('');

  const gallery = fs.readdirSync(OUT).filter((n) => n.endsWith('.png')).sort();
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desktop app QA 0.1.0</title>
<style>
:root { --bg:#f7f7f5; --card:#fff; --ink:#1d1d1b; --ink2:#5d5d58; --line:#e3e2dd; --high:#b42318; --med:#b54708; --low:#475467; --ok:#067647; --no:#b42318; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#161615; --card:#1f1f1d; --ink:#ecebe6; --ink2:#a5a49e; --line:#33332f; --high:#f97066; --med:#fdb022; --low:#98a2b3; --ok:#47cd89; --no:#f97066; } }
:root[data-theme="dark"] { --bg:#161615; --card:#1f1f1d; --ink:#ecebe6; --ink2:#a5a49e; --line:#33332f; --high:#f97066; --med:#fdb022; --low:#98a2b3; --ok:#47cd89; --no:#f97066; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width:1100px; margin:0 auto; padding:32px 16px 64px; }
h1 { font-size:28px; margin:0 0 4px; } h2 { margin:40px 0 12px; font-size:20px; } h3 { margin:0; font-size:16px; } h4 { margin:14px 0 4px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--ink2); }
p, li { max-width:70ch; } .lead { color:var(--ink2); }
table { border-collapse:collapse; width:100%; background:var(--card); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
td, th { text-align:left; padding:8px 12px; border-bottom:1px solid var(--line); vertical-align:top; } th { font-size:13px; color:var(--ink2); }
.bug { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin:0 0 16px; }
.bug header { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; } .area { color:var(--ink2); font-size:13px; margin-left:auto; }
.sev { font-size:12px; font-weight:600; text-transform:uppercase; padding:2px 8px; border-radius:99px; border:1px solid currentColor; }
.sev.high { color:var(--high); } .sev.medium { color:var(--med); } .sev.low { color:var(--low); }
.cols { display:grid; grid-template-columns:1fr 1fr; gap:16px; } @media (max-width:760px) { .cols { grid-template-columns:1fr; } }
.shots img { width:100%; border:1px solid var(--line); border-radius:6px; margin-bottom:8px; display:block; }
.seen { font-size:13px; color:var(--ink2); } code { font-size:13px; overflow-wrap:anywhere; }
details { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 16px; margin-bottom:12px; } summary { cursor:pointer; font-weight:600; }
.checks { list-style:none; padding:0; margin:0; } .checks li { padding:4px 0; border-bottom:1px solid var(--line); max-width:none; }
.checks span { display:inline-block; width:3.2em; font-weight:600; font-size:13px; } .checks .ok span { color:var(--ok); } .checks .no span { color:var(--no); }
.detail { color:var(--ink2); font-size:13px; margin-left:3.2em; white-space:pre-wrap; overflow-wrap:anywhere; }
.gallery { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px; }
.gallery figure { margin:0; } .gallery img { width:100%; border:1px solid var(--line); border-radius:6px; } .gallery figcaption { font-size:12px; color:var(--ink2); overflow-wrap:anywhere; }
.miss { color:var(--ink2); font-style:italic; } .note { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:4px 16px; }
</style></head><body><main>
<h1>Fishbowl Studio desktop app 0.1.0: QA</h1>
<p class="lead">${esc(f.summary)}</p>
<table><tr><th>Run</th><th>Passed</th><th>Failed</th><th>When</th></tr>${counts}</table>
<p class="lead">${esc(f.method)}</p>

<h2>Bugs (${bugs.length})</h2>
${bugHtml}

<h2>What passed</h2>
<ul>${f.passed.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
${passHtml}

<h2>Not tested</h2>
<ul>${f.not_tested.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>

<h2>How to rerun</h2>
<p>${esc(f.rerun)}</p>

<h2>Every screenshot</h2>
<div class="gallery">${gallery.map((n) => `<figure><a href="shots/${esc(n)}"><img loading="lazy" src="shots/${esc(n)}" alt="${esc(n)}"></a><figcaption>${esc(n)}</figcaption></figure>`).join('')}</div>

<hr>
<h2>Notes</h2>
<div class="note">${f.ux_notes.length ? `<p>${esc(f.ux_notes_intro)}</p><ul>${f.ux_notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : `<p>${esc(f.ux_notes_intro)}</p>`}</div>
</main></body></html>
`;
  fs.writeFileSync(path.join(DIR, 'index.html'), html);
  console.log(`Wrote ${path.join(DIR, 'index.html')}`);
}

if (process.env.STUDIO_E2E === "1" && import.meta.url === `file://${process.argv[1]}`) await report();
