import test from 'node:test';
import assert from 'node:assert/strict';
import { formOf, opener, overuse, collapsed, compileCrutches, crutchesIn } from '../server/lib/forms.js';

test('observed forms', () => {
  assert.equal(formOf('THIS IS ALL SHOUTING TEXT'), 'caps');
  assert.equal(formOf('Rider: where is the lane\nCouncil: coming soon'), 'script');
  assert.equal(formOf('New saddle design: 7/10'), 'rating');
  assert.equal(formOf('Unpopular opinion: mudguards are beautiful'), 'hot-take-opener');
  assert.equal(formOf('- one\n- two\n- three'), 'list');
  assert.equal(formOf('Finally.'), 'one-word');
  assert.equal(formOf('Setup line here.\nTurn line there.'), 'two-line');
  assert.equal(formOf('Para one.\n\nPara two.\n\nPara three.'), 'paragraphs');
  assert.equal(formOf('Who checks the tyre pressure on a rental fleet?'), 'question');
  assert.equal(formOf('Commuting by bike is mostly about where you park.'), 'one-liner');
});

test('3-word opener', () => {
  assert.equal(opener("Here's what we learned"), "here's what we");
  assert.equal(opener('Too short'), null);
});

test('template cap: share over the full 50-draft window, strictly above 10%', () => {
  const t = 'Unpopular opinion: x';
  const five = [...Array(5)].map(() => ({ text: t }));
  assert.equal(overuse(five).forms.length, 0, '5/50 = 10% is not above the cap');
  const six = [...Array(6)].map(() => ({ text: t }));
  assert.deepEqual(overuse(six).forms, [{ form: 'hot-take-opener', k: 6 }]);
});

test('opener cap: above 5% of 50 means 3 or more', () => {
  const h = (n) => [...Array(n)].map((_, i) => ({ text: `We tested this ${i}` }));
  assert.equal(overuse(h(2)).openers.length, 0);
  assert.deepEqual(overuse(h(3)).openers, [{ opener: 'we tested this', k: 3 }]);
});

test('crutch families, including their own overused phrases', () => {
  const fams = compileCrutches({ overused_phrases: ['at the end of the day'], variety: { phrase_cap: 0.04 } });
  assert.deepEqual(crutchesIn('This is a game-changer, at the end of the day', fams), ['hype', 'phrases']);
  const h = [...Array(4)].map(() => ({ text: 'a real game-changer' }));
  const o = overuse(h, { crutches: fams });
  assert.equal(o.crutches[0].name, 'hype');
  assert.match(o.crutches[0].note, /^4 of the last 4 drafts/);
});

test('variance collapse needs >=3 and >60% in one form', () => {
  assert.equal(collapsed(['a', 'a']), null);
  assert.equal(collapsed(['a', 'a', 'b']), 'a');
  assert.equal(collapsed(['a', 'a', 'b', 'b', 'c']), null);
  assert.equal(collapsed(['a', 'a', 'a', 'b', 'c']), null, '60% exactly is not above');
});
