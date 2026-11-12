// Runs every web QA script in turn, then rebuilds index.html. `npm run qa` here sets STUDIO_E2E=1.
// One at a time: the runs share the mock's ports and the login Keychain entry.
// QA_ONLY=source,npx,standalone,launch,plugin picks a subset. QA_REAL_API=0 skips the one call to
// the real API; QA_REAL_CLAUDE=0 skips drafting through the installed Claude Code.
if (process.env.STUDIO_E2E !== '1') process.exit(0);
const { spawnSync } = await import('node:child_process');
const { HERE } = await import('./lib.mjs');
const only = (process.env.QA_ONLY || 'source,npx,standalone,launch,plugin').split(',');
const steps = [
  ['source', ['walk.mjs', 'source']],
  ['npx', ['walk.mjs', 'npx']],
  ['standalone', ['walk.mjs', 'standalone']],
  ['launch', ['launch.mjs', 'source']],
  ['launch', ['launch.mjs', 'standalone']],
  ['plugin', ['plugin.mjs']],
];
let failed = 0;
for (const [name, args] of steps) {
  if (!only.includes(name)) continue;
  console.log(`\n=== ${args.join(' ')} ===`);
  const r = spawnSync(process.execPath, args, { cwd: HERE, stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed++;
}
const { default: report } = await import('./report.mjs');
await report();
process.exit(failed ? 1 : 0);
