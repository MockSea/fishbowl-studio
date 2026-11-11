import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.js';
import { writeKitFiles, png } from './kit-files.js';
import { openKit, LIMITS, sniff } from '../desktop/brandkit.js';

const setup = () => {
  const home = tempHome();
  return { kit: openKit(path.join(home, 'kit')), files: writeKitFiles(path.join(home, 'in')), home };
};

test('PDF, DOCX, Markdown and PNG go in; text is read and the image is kept as an image', async () => {
  const { kit, files } = setup();
  for (const p of Object.values(files)) {
    const r = await kit.add(p);
    assert.equal(r.ok, true, `${p}: ${r.reason}`);
  }
  const l = kit.list();
  assert.deepEqual(l.files.map((f) => f.name), ['guidelines.pdf', 'tone.docx', 'logo.png', 'notes.md']);
  const by = Object.fromEntries(l.files.map((f) => [f.name, f]));
  assert.match(by['guidelines.pdf'].preview, /ride more, worry less/);
  assert.match(by['tone.docx'].preview, /warm and practical[\s\S]*Never say synergy/);
  assert.match(by['notes.md'].preview, /never "service event"/);
  assert.equal(by['logo.png'].preview, null);
  assert.equal(by['logo.png'].chars, null);
  assert.equal(l.total_bytes, Object.values(files).reduce((n, p) => n + fs.statSync(p).size, 0));

  const c = kit.content();
  assert.deepEqual(c.docs.map((d) => d.name), ['guidelines.pdf', 'tone.docx', 'notes.md']);
  assert.equal(c.images.length, 1);
  assert.equal(c.images[0].media_type, 'image/png');
  assert.deepEqual(Buffer.from(c.images[0].data, 'base64'), png());
});

test('files are copied into the kit folder, and removing one deletes its copies', async () => {
  const { kit, files } = setup();
  const r = await kit.add(files['tone.docx']);
  fs.rmSync(files['tone.docx']);
  assert.match(kit.content().docs[0].text, /Never say synergy/, 'the kit does not depend on the original file');
  const before = fs.readdirSync(kit.dir).sort();
  assert.equal(before.length, 3, 'manifest, the copy and its text');
  assert.deepEqual(kit.remove(r.file.id), { ok: true, name: 'tone.docx' });
  assert.deepEqual(fs.readdirSync(kit.dir), ['manifest.json']);
  assert.equal(kit.list().files.length, 0);
  assert.equal(kit.remove(r.file.id).ok, false);
  assert.equal(kit.remove('../manifest').ok, false);
});

test('wrong types, renamed files, empty and oversized files are refused', async () => {
  const { kit, home } = setup();
  const w = (n, b) => { const p = path.join(home, n); fs.writeFileSync(p, b); return p; };
  const reason = async (p) => (await kit.add(p)).reason;
  assert.match(await reason(w('script.exe', 'MZ')), /Only \.pdf/);
  assert.match(await reason(w('fake.pdf', 'just text')), /doesn't look like a real PDF/);
  assert.match(await reason(w('fake.png', 'GIF89a')), /real Image/);
  assert.match(await reason(w('fake.docx', 'PK\u0003\u0004 not a docx')), /No text could be read|real Word/);
  assert.match(await reason(w('binary.md', Buffer.from([0x23, 0, 0xff]))), /real Text/);
  assert.match(await reason(w('empty.txt', '')), /empty/);
  assert.match(await reason(w('big.png', Buffer.concat([png(), Buffer.alloc(LIMITS.image_bytes)]))), /Too big/);
  assert.match(await reason(path.join(home, 'missing.md')), /could not be read/);
  assert.match(await reason(home + path.sep + '.'), /Only|not a file/);
  assert.equal(kit.list().files.length, 0);
});

test('the kit holds a set number of files', async () => {
  const { kit, home } = setup();
  for (let i = 0; i < LIMITS.files; i++) {
    const p = path.join(home, `n${i}.txt`);
    fs.writeFileSync(p, `note ${i}`);
    assert.equal((await kit.add(p)).ok, true);
  }
  const p = path.join(home, 'one-more.txt');
  fs.writeFileSync(p, 'x');
  assert.match((await kit.add(p)).reason, /up to 20 files/);
});

test('long text is cut to the per-file cap and the prompt cap', async () => {
  const { kit, home } = setup();
  for (const n of ['a', 'b', 'c', 'd']) {
    const p = path.join(home, `${n}.txt`);
    fs.writeFileSync(p, n.repeat(LIMITS.text_chars + 500));
    await kit.add(p);
  }
  const l = kit.list();
  assert.ok(l.files.every((f) => f.truncated));
  const c = kit.content();
  assert.equal(c.docs.reduce((n, d) => n + d.text.length, 0), LIMITS.prompt_text_chars);
  assert.equal(c.docs[0].text.length, LIMITS.text_chars);
});

test('sniff checks magic bytes', () => {
  assert.equal(sniff(png(), 'png'), true);
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'jpeg'), true);
  assert.equal(sniff(png(), 'jpeg'), false);
});
