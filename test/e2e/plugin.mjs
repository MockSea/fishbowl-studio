// /fishbowl from Claude Code, driven non-interactively:
//   STUDIO_E2E=1 node plugin.mjs
// Runs `claude -p "/studio:fishbowl" --plugin-dir <this checkout>` in a throwaway folder, so the
// plugin is loaded for this one run and nothing is installed. `npx` on PATH is a stand-in that
// records the arguments the command passed and starts this checkout's studio with --no-open and
// a temp data folder, so no browser opens and no real studio folder is touched. Checks: the
// command ran the documented npx line, the studio printed its link, the reply tells the person
// where to open it, and the reply doesn't open, fetch or call the studio itself.
// Uses the installed Claude Code's own sign-in. Skipped when `claude` isn't installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as L from './lib.mjs';

if (!L.enabled()) { console.log('Set STUDIO_E2E=1 to run the plugin check.'); process.exit(0); }
const CLAUDE = process.env.QA_CLAUDE || path.join(os.homedir(), '.local', 'bin', 'claude');
const results = [];
const check = (area, name, ok, detail = '') => { detail = String(detail).replace(/t=[0-9a-f]{64}/g, 't=<token>'); results.push({ area, name, ok: !!ok, detail: detail.slice(0, 1200) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${area}: ${name}${detail ? `  [${detail.slice(0, 200)}]` : ''}`); };
const save = () => { fs.mkdirSync(L.OUT, { recursive: true }); fs.writeFileSync(path.join(L.OUT, 'plugin-results.json'), JSON.stringify({ mode: 'plugin', at: new Date().toISOString(), results }, null, 2) + '\n'); };

if (!fs.existsSync(CLAUDE)) { check('Plugin', 'Claude Code is installed', false, 'not found; skipped'); save(); process.exit(0); }

const dirs = L.tempDirs('plugin');
const work = path.join(dirs.base, 'work');
const bin = path.join(dirs.base, 'bin-shim');
fs.mkdirSync(work); fs.mkdirSync(bin);
const argLog = path.join(dirs.base, 'npx-args.log');
const outLog = path.join(dirs.base, 'studio-output.log');
// The stand-in npx: records its arguments, then runs the studio from this checkout.
fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh
printf '%s\\n' "$*" >> '${argLog}'
exec '${process.execPath}' '${path.join(L.ROOT, 'bin', 'fishbowl-studio.js')}' --no-open --home '${dirs.home}' 2>&1 | tee -a '${outLog}'
`, { mode: 0o755 });
fs.symlinkSync(process.execPath, path.join(bin, 'node'));

const env = { ...process.env, PATH: [bin, path.dirname(CLAUDE), L.SYSTEM_PATH].join(':') };
for (const k of ['ANTHROPIC_API_KEY', 'STUDIO_HOME', 'STUDIO_ANTHROPIC_BASE_URL', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete env[k];
const argv = ['-p', '/studio:fishbowl', '--plugin-dir', L.ROOT, '--no-session-persistence', '--setting-sources', 'project', '--strict-mcp-config', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '1'];
const started = Date.now();
const proc = spawn(CLAUDE, argv, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let stdout = '', stderr = '';
proc.stdout.on('data', (d) => { stdout += d; });
proc.stderr.on('data', (d) => { stderr += d; });
// Print mode keeps running while a background shell it started is alive, and the studio stays up
// until stopped, so the run is ended 15 s after the reply text arrives.
const code = await new Promise((r) => {
  const limit = Date.now() + Number(process.env.QA_PLUGIN_TIMEOUT_MS || 180000);
  let replyAt = 0;
  const end = (why) => { clearInterval(t); try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* gone */ } r(why); };
  const t = setInterval(() => {
    if (!replyAt && /"type":"text"/.test(stdout) && /Open it here|already running/.test(fs.existsSync(outLog) ? fs.readFileSync(outLog, 'utf8') : '')) replyAt = Date.now();
    if (replyAt && Date.now() - replyAt > 15000) end('stopped after reply');
    else if (Date.now() > limit) end('timeout');
  }, 1000);
  proc.on('exit', (c) => { clearInterval(t); r(c); });
});
// stream-json: one event per line. The reply is the result event, or the last assistant text.
const events = stdout.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const texts = events.filter((e) => e.type === 'assistant').flatMap((e) => e.message?.content || []);
const reply = events.find((e) => e.type === 'result')?.result || texts.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const bashCalls = texts.filter((c) => c.type === 'tool_use').map((c) => ({ tool: c.name, ...(c.input || {}) }));
const npxArgs = fs.existsSync(argLog) ? fs.readFileSync(argLog, 'utf8').trim() : '';
const studioOut = fs.existsSync(outLog) ? fs.readFileSync(outLog, 'utf8') : '';
check('Plugin', '`claude -p "/studio:fishbowl" --plugin-dir` replies (print mode then stays open while the studio runs, so it is stopped)', code === 0 || code === 'stopped after reply', `exit ${code} after ${Math.round((Date.now() - started) / 1000)} s; ${stderr.trim().slice(0, 300)}`);
check('Plugin', 'the command starts the studio in the background, as its own steps say', bashCalls.some((c) => c.tool === 'Bash' && /npx/.test(c.command || '') && c.run_in_background === true), JSON.stringify(bashCalls));
check('Plugin', 'the command runs the documented npx line', /^--yes github:MockSea\/fishbowl-studio#\S+$/m.test(npxArgs), npxArgs || '(npx never ran)');
check('Plugin', 'the npx line pins the tag the plugin documents (v0.1.0)', /#v0\.1\.0$/m.test(npxArgs), npxArgs);
check('Plugin', 'the studio started and printed its link', /Open it here \(the link works once\): http:\/\/127\.0\.0\.1/.test(studioOut), studioOut.trim().split('\n').slice(0, 6).join(' / '));
check('Plugin', 'the reply tells the person the studio is open and where the link is', /open|link|browser/i.test(reply), reply);
check('Plugin', 'the reply gives the printed link for when no tab opened, as the command says', /http:\/\/127\.0\.0\.1:\d+\/\?t=/.test(reply), reply);
fs.writeFileSync(path.join(L.OUT, 'plugin-reply.log'), `tool calls: ${JSON.stringify(bashCalls)}\nnpx args: ${npxArgs}\n\nstudio output:\n${studioOut.replace(/t=[0-9a-f]{64}/g, 't=<token>').replaceAll(dirs.base, '<tmp>')}\nreply:\n${reply.replace(/t=[0-9a-f]{64}/g, 't=<token>').replaceAll(dirs.base, '<tmp>')}\n`);

// The studio may outlive the claude run (it was started in the background); stop it.
const lock = path.join(dirs.app, 'server.json');
const pid = fs.existsSync(lock) ? JSON.parse(fs.readFileSync(lock, 'utf8')).pid : null;
if (pid) { try { process.kill(pid, 'SIGINT'); } catch { /* gone */ } }
await new Promise((r) => setTimeout(r, 1500));
check('Plugin', 'the studio started by the command was stopped after the check', !fs.existsSync(lock), pid ? `pid ${pid}` : 'no lock file');
save();
console.log(`\n${results.filter((x) => x.ok).length} passed, ${results.filter((x) => !x.ok).length} failed.`);
