// Runs every desktop QA script in turn: the walk from source, the walk against the built
// .app, and the LaunchServices launch. `npm run qa` here sets STUDIO_E2E=1.
// QA_ONLY=source,built,finder picks a subset. QA_REAL_API=0 skips the one call to the real API.
if (process.env.STUDIO_E2E !== '1') process.exit(0);
const { spawnSync } = await import('node:child_process');
const { HERE } = await import('./lib.mjs');
const only = (process.env.QA_ONLY || 'source,built,finder').split(',');
const steps = [['source', ['walk.mjs', 'source']], ['built', ['walk.mjs', 'built']], ['finder', ['finder.mjs']]];
let failed = 0;
for (const [name, args] of steps) {
  if (!only.includes(name)) continue;
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(process.execPath, args, { cwd: HERE, stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed++;
}
const { default: report } = await import('./report.mjs');
await report();
process.exit(failed ? 1 : 0);
