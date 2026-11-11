// The drafting engine through Claude Code: `claude -p`, on the person's own Claude plan. This
// file is the only place that knows the call shape. One call per step, same as the API engine:
// the brief (and the brand kit) go in on stdin as one stream-json user message, the answer
// comes back as structured output matching the schema.
//
// The call runs with no tools, no MCP servers, no user or local settings, no saved session,
// from an empty temporary folder, so Claude Code only writes the answer.
// --bare is not used: it skips the person's Claude login and needs an API key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SYSTEM, ModelError, kitBlocks } from './api.js';

// The structured answer takes Claude Code one turn plus the turn that returns it.
export const MAX_TURNS = 4;
export const TIMEOUT_MS = 10 * 60 * 1000;

export function cliArgs({ schema, model = process.env.STUDIO_MODEL || null }) {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--json-schema', JSON.stringify(schema),
    '--tools', '',
    '--system-prompt', SYSTEM,
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns', String(MAX_TURNS),
    ...(model ? ['--model', model] : []),
  ];
}

// One stream-json line: the brand kit blocks, then the brief. No cache markers.
export function cliInput({ task, kit }) {
  const content = [...kitBlocks(kit), { type: 'text', text: task }].map(({ cache_control, ...b }) => b);
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}

// The last `result` event carries the answer.
export function parseCliOutput(stdout) {
  let result = null;
  for (const line of String(stdout).split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try { const ev = JSON.parse(line); if (ev && ev.type === 'result') result = ev; } catch { /* not an event */ }
  }
  if (!result) throw new ModelError('Claude Code gave no answer.', 'cli');
  if (result.is_error || result.subtype !== 'success') {
    const why = String(result.result || result.subtype || '').replace(/\s+/g, ' ').slice(0, 200);
    throw new ModelError(`Claude Code couldn't finish this one${why ? ` (${why})` : ''}.`, 'cli');
  }
  if (result.structured_output && typeof result.structured_output === 'object') return { value: result.structured_output, cost: result.total_cost_usd ?? null };
  try { return { value: JSON.parse(result.result), cost: result.total_cost_usd ?? null }; }
  catch { throw new ModelError('Claude\'s answer wasn\'t valid JSON.', 'parse'); }
}

// bin: the claude executable. spawnImpl for tests.
export function makeCliModel({ bin, spawnImpl = spawn, timeoutMs = TIMEOUT_MS, onCost = () => {} }) {
  return {
    ask({ task, schema, kit }) {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fishbowl-claude-'));
      return new Promise((resolve, reject) => {
        let out = '', err = '', done = false;
        const finish = (fn, v) => {
          if (done) return; done = true; clearTimeout(timer);
          fs.rmSync(cwd, { recursive: true, force: true });
          fn(v);
        };
        let child;
        try { child = spawnImpl(bin, cliArgs({ schema }), { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
        catch (e) { return finish(reject, new ModelError(`Couldn't start Claude Code (${e.code || e.message}).`, 'cli')); }
        const timer = setTimeout(() => { child.kill('SIGKILL'); finish(reject, new ModelError('Claude Code took too long.', 'cli')); }, timeoutMs);
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
        child.on('error', (e) => finish(reject, new ModelError(`Couldn't start Claude Code (${e.code || e.message}).`, 'cli')));
        child.on('close', (code) => {
          try {
            const r = parseCliOutput(out);
            onCost(r.cost);
            finish(resolve, r.value);
          } catch (e) {
            if (e.kind === 'cli' && code !== 0 && !out.trim()) {
              const why = err.replace(/\s+/g, ' ').trim().slice(0, 200);
              return finish(reject, new ModelError(`Claude Code stopped (exit ${code}${why ? `: ${why}` : ''}).`, 'cli'));
            }
            finish(reject, e);
          }
        });
        child.stdin.on('error', () => {});
        child.stdin.end(cliInput({ task, kit }));
      });
    },
  };
}
