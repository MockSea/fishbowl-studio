#!/usr/bin/env node
// A stand-in for the Anthropic Messages API, for running the studio with no API key:
//   node dev/mock-anthropic.mjs [port]          (default 8787)
//   STUDIO_ANTHROPIC_BASE_URL=http://127.0.0.1:8787 node bin/fishbowl-studio.js --home DIR   (any key works)
// It answers each studio brief with canned JSON in the shape the request's schema asks for,
// and prints one line per request: the schema, and what brand kit came with it.
import http from 'node:http';

const port = Number(process.argv[2] || 8787);
let n = 0;

function answer(schema, task) {
  const keys = Object.keys(schema.properties || {});
  if (keys.includes('reactions')) {
    const count = Number((task.match(/# Triage \((\d+) items?\)/) || [])[1] || 0);
    return { reactions: [...Array(count)].map((_, i) => ({ item: i + 1, thought: 'Worth a look for the shop.', interest: i < 3 ? 8 : 3, topic: 'other' })) };
  }
  if (keys.includes('takes')) {
    n++;
    const want = Number((task.match(/exactly (\d+) takes?/) || [])[1] || 3);
    return { takes: [
      { text: `Paint is not a plan. Draft ${n}, written with the brand kit open.`, thinking: 'first reaction', topic: 'other', cites: [] },
      { text: `Every fix starts with a look at the chain. Draft ${n}.`, thinking: 'shop angle', topic: 'other', cites: [] },
      { text: `Ride more, worry less. Draft ${n}.`, thinking: 'the line from the kit', topic: 'other', cites: [] },
    ].slice(0, want) };
  }
  if (keys.includes('voice')) {
    return {
      voice: '# Voice\nWarm, practical, a little dry. Says what it sees at the workbench.',
      playbook: '# Playbook\n- Lead with what a rider would notice.\n- One idea per post.',
      topics: ['repair', 'city riding'], off_limits: ['politics'], audience: 'People who ride to work and fix their own bikes.',
      sources: [{ kind: 'site', url: process.env.MOCK_FEED || 'https://feeds.example.com/cycling.xml', sub: '', q: '', topic: 'city riding', reason: 'What riders are talking about.' }],
    };
  }
  return {};
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404); return res.end(); }
    const p = JSON.parse(body);
    const content = p.messages[0].content;
    const task = content.at(-1).text;
    const schema = p.output_config.format.schema;
    const kitDocs = content.length > 1 ? (content[0].text?.match(/^file: /gm) || []).length : 0;
    const kitImages = content.filter((b) => b.type === 'image').length;
    console.log(`${new Date().toISOString()} ${p.model} ${Object.keys(schema.properties).join(',')} kit: ${kitDocs} docs, ${kitImages} images; first block: ${JSON.stringify(content[0].text?.slice(0, 80) ?? content[0].type)}`);
    const out = answer(schema, task);
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_mock_${Date.now()}` });
    res.end(JSON.stringify({ id: `msg_mock_${Date.now()}`, type: 'message', role: 'assistant', model: p.model, stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 1, output_tokens: 1 } }));
  });
}).listen(port, '127.0.0.1', () => console.log(`mock Anthropic API on http://127.0.0.1:${port}`));
