#!/usr/bin/env node
// Fishbowl Studio MCP server: zero dependencies, stdio, state in STUDIO_HOME.
// The version check comes first and the server is loaded only after it, so a Node that is too
// old answers every call with one plain sentence and one fix instead of a stack trace. (With no
// Node at all this file never runs; the skills and the setup command say what to do then.)
const MIN_NODE = 20;
const major = Number(String(process.versions.node).split('.')[0]);

if (major >= MIN_NODE) {
  const { makeContext } = await import('./lib/state.js');
  const { serveStdio } = await import('./lib/rpc.js');
  const { resolveHome } = await import('./lib/store.js');
  const ctx = makeContext({ home: resolveHome(), seed: process.env.STUDIO_SEED ? Number(process.env.STUDIO_SEED) : undefined });
  serveStdio(ctx);
} else {
  const { tooOld } = await import('./lib/old-node.js');
  tooOld(process.versions.node, MIN_NODE);
}
