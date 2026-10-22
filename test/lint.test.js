import test from 'node:test';
import assert from 'node:assert/strict';
import { lint, numbersIn, quotesIn, nameCandidates, unknownNames, copiesExample } from '../server/lib/lint.js';

const x = { name: 'X', long_over: 220, hashtags_max: 0 };
const codes = (fl) => fl.map((f) => f.code).sort();
const src = 'Riverside City adds 12 km of protected lanes. Mayor Dana Okafor said "this is only the start" at the launch.';

test('number not in source', () => {
  assert.deepEqual(codes(lint('12 km is a start.', { sourceText: src, platform: x })), []);
  assert.deepEqual(codes(lint('40 km would be better.', { sourceText: src, platform: x })), ['number']);
  assert.deepEqual(numbersIn('1. one\n2. two\nwe sold 1,200 bikes'), ['1200']);
});

test('quote not in source', () => {
  assert.deepEqual(codes(lint('"This is only the start", they said.', { sourceText: src, platform: x })), []);
  assert.deepEqual(codes(lint('"We will build a thousand lanes", they said.', { sourceText: src, platform: x })), ['quote']);
  assert.deepEqual(quotesIn('a "two words" b'), []);
});

test('news voice, handle, hashtag, url, tie-back, long', () => {
  assert.deepEqual(codes(lint('BREAKING: lanes reportedly confirmed', { sourceText: src, platform: x })), ['news-voice']);
  assert.deepEqual(codes(lint('thanks @someone', { platform: x })), ['handle']);
  assert.deepEqual(codes(lint('lanes #cycling', { platform: x })), ['hashtag']);
  assert.deepEqual(codes(lint('read https://example.com', { platform: x })), ['url']);
  assert.deepEqual(codes(lint('like i said, lanes', { platform: x })), ['tie-back']);
  assert.deepEqual(codes(lint('a'.repeat(221), { platform: x })), ['long']);
});

test('names a person not in source or allowlist', () => {
  assert.deepEqual(codes(lint('Dana Okafor gets it.', { sourceText: src, platform: x })), []);
  const fl = lint('Our mechanic Sam Patel disagrees.', { sourceText: src, platform: x });
  assert.deepEqual(codes(fl), ['person']);
  assert.match(fl[0].label, /Sam Patel/);
  assert.deepEqual(unknownNames('Sam Patel agrees', { allowNames: ['Sam Patel'] }), []);
  assert.deepEqual(unknownNames('Northwind Bicycles says hi', { brand: 'Northwind Bicycles' }), []);
  assert.deepEqual(nameCandidates('The Riverside plan. Today We ride. Dr. Mendes agrees.'), ['Dr. Mendes']);
  assert.ok(nameCandidates('Dr. Mendes agrees.').includes('Dr. Mendes'));
  assert.deepEqual(nameCandidates('The Monday Ride is back'), []);
});

test('evergreen posts with nothing cited cannot use stats, quotes or names', () => {
  const fl = lint('Jo Bloggs said "fix your chain first" and 80% agree.', { cited: false, platform: x });
  assert.deepEqual(codes(fl), ['name-uncited', 'quote-uncited', 'stat-uncited']);
});

test('copy check finds a shared 5-word run', () => {
  assert.equal(copiesExample('we never sell a bike we would not ride', ['Honestly we never sell a bike we hate']), 'we never sell a bike');
  assert.equal(copiesExample('totally different words here today friend', ['we never sell a bike']), null);
});
