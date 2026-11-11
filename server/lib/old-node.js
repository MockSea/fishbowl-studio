// What the command prints when this computer's Node.js is too old. Written in plain, old
// syntax on purpose, so an old Node can parse it.
export const fixText = (have, min) => 'Fishbowl Studio needs a newer Node.js (version ' + min + ' or later; this computer has ' + have + '). ' +
  'To fix it: download the LTS installer from nodejs.org, run it, then run this command again. ' +
  'Or download the standalone app, which needs no Node.js: see the README.';

export function tooOld(have, min, err) {
  (err || process.stderr).write(fixText(have, min) + '\n');
  process.exitCode = 1;
}
