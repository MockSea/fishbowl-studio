#!/usr/bin/env node
// The fishbowl-studio command (npx github:MockSea/fishbowl-studio#v0.1.0, or the standalone build).
// Written in plain, old syntax with no static imports, so a Node that is too old still gets as
// far as the version check and prints one plain fix instead of a stack trace.
// Before it loads the app it checks the app's packages and reinstalls any that are missing
// (server/lib/heal.js); the standalone build has them inside and skips that.
// --extract-child is internal: the brand kit reads a PDF or Word file in a separate process
// started with it (see isolatedExtract in core/lib/brandkit.js).
var MIN_NODE = 20;
var major = Number(String(process.versions.node).split('.')[0]);

function fail(e) {
  process.stderr.write((e && e.message ? e.message : String(e)) + '\n');
  process.exitCode = 1;
}

if (process.argv[2] === '--extract-child') {
  import('../core/lib/extract-child.js').catch(fail);
} else if (major >= MIN_NODE) {
  import('../server/lib/heal.js')
    .then(function (h) { if (!globalThis.__FISHBOWL_FILES__) h.ensurePackages(); })
    .then(function () { return import('../server/cli.js'); })
    .then(function (m) { return m.main(process.argv.slice(2)); })
    .catch(fail);
} else {
  import('../server/lib/old-node.js').then(function (m) { m.tooOld(process.versions.node, MIN_NODE); }).catch(fail);
}
