// The skill (skills/fishbowl-studio/SKILL.md) tells Claude how to install and start the web app.
// Its frontmatter is what Claude reads to decide when to use it, and every option it passes must
// be one the command accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from '../server/lib/files.js';
import { parseArgs } from '../server/cli.js';

const skill = fs.readFileSync(path.join(APP_DIR, 'skills', 'fishbowl-studio', 'SKILL.md'), 'utf8');

test('the skill has the frontmatter Claude needs: a name matching its folder and a description', () => {
  const fm = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm, 'frontmatter at the top');
  const field = (k) => (fm[1].match(new RegExp(`^${k}: (.+)$`, 'm')) || [])[1];
  assert.equal(field('name'), 'fishbowl-studio');
  assert.ok(field('description')?.length > 40 && field('description').length <= 1024, 'a description of a useful length');
});

test('every option the skill passes to the command is one the command accepts', () => {
  const runs = skill.match(/^(?:npx --yes github:\S+|~\/\.local\/bin\/fishbowl-studio)[^\n]*$/gm) || [];
  assert.ok(runs.length, 'the skill has the start command');
  for (const line of runs) {
    const args = line.replace(/"[^"]*"/g, '/tmp/folder').replace(/\s*>.*$/, '').split(/\s+/).slice(line.startsWith('npx') ? 3 : 1);
    assert.doesNotThrow(() => parseArgs(args), line);
  }
  assert.match(skill, /--no-open/, 'Claude gives the person the link; it does not open a browser in its own sandbox');
});
