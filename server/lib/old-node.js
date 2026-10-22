// What the server says when this computer's Node.js is too old to run it: a working MCP
// handshake and one tool, whose every answer is the same plain sentence and one fix. Written in
// plain, old syntax on purpose, so an old Node can parse it.
import readline from 'node:readline';

export const fixText = (have, min) => 'Fishbowl Studio needs a newer Node.js (version ' + min + ' or later; this computer has ' + have + '). ' +
  'To fix it: download the LTS installer from nodejs.org, run it, then quit and reopen Claude.';

export function tooOld(have, min, input, output) {
  const msg = fixText(have, min);
  const out = output || process.stdout;
  const rl = readline.createInterface({ input: input || process.stdin, crlfDelay: Infinity });
  const send = (o) => out.write(JSON.stringify(o) + '\n');
  rl.on('line', function (line) {
    let m;
    try { m = JSON.parse(line); } catch (e) { return; }
    if (!m || !('id' in m)) return;
    if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fishbowl-studio', version: '0.0.1' }, instructions: msg } });
    if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'studio_status', title: 'Studio status', description: msg, inputSchema: { type: 'object', additionalProperties: true } }] } });
    if (m.method === 'tools/call') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: msg }], isError: true } });
    if (m.method === 'ping') return send({ jsonrpc: '2.0', id: m.id, result: {} });
    send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
  });
  process.stderr.write(msg + '\n');
}
