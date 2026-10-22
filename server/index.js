#!/usr/bin/env node
// Fishbowl Studio MCP server: zero dependencies, stdio, state in STUDIO_HOME.
import { makeContext } from './lib/state.js';
import { serveStdio } from './lib/rpc.js';
import { resolveHome } from './lib/store.js';

const ctx = makeContext({ home: resolveHome(), seed: process.env.STUDIO_SEED ? Number(process.env.STUDIO_SEED) : undefined });
serveStdio(ctx);
