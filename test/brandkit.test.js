import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.js';
import { writeKitFiles, png, docx, pdf } from './kit-files.js';
import { openKit, LIMITS, sniff, zipTooBig, isolatedExtract } from '../server/lib/brandkit.js';

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

// A DOCX whose one paragraph unpacks to 80 MB but deflates to well under the 10 MB file cap.
const bomb = () => docx(['a'.repeat(80 * 1024 * 1024)]);

test('a DOCX that claims to unpack past the limit is refused before it is opened', async () => {
  const b = bomb();
  assert.ok(b.length < LIMITS.file_bytes);
  assert.match(zipTooBig(b), /unpacks to more than 64 MB/);
  assert.equal(zipTooBig(docx(['Fine.'])), null);
  const { kit, home } = setup();
  const p = path.join(home, 'bomb.docx');
  fs.writeFileSync(p, b);
  const r = await kit.add(p);
  assert.equal(r.ok, false);
  assert.match(r.reason, /unpacks to more than/);
  assert.equal(kit.list().files.length, 0);
});

test('a file that unpacks past the memory limit only stops the reader process, not the app', async () => {
  // 200 MB unpacked, read with no zip check: the watchdog stops the reader at 150 MB.
  const big = docx(['a'.repeat(200 * 1024 * 1024)]);
  const heapBefore = process.memoryUsage().heapUsed;
  await assert.rejects(isolatedExtract(big, 'docx', { rssMb: 150 }), /too big to read/);
  assert.ok(process.memoryUsage().heapUsed - heapBefore < 64 * 1024 * 1024, 'the unpacking happened elsewhere');
  // The app carries on: the next file reads normally.
  assert.match(await isolatedExtract(pdf('Still here.'), 'pdf'), /Still here/);
});

test('reading a document is time-limited', async () => {
  await assert.rejects(isolatedExtract(pdf('Slow.'), 'pdf', { timeoutMs: 1 }), /too long/);
});

test('an upload keeps the name the person gave it for display only', async () => {
  const { kit, files } = setup();
  const r = await kit.add(files['notes.md'], { name: '../../etc/evil\u0007.md' });
  assert.equal(r.ok, true);
  const f = kit.list().files[0];
  assert.equal(f.name, 'evil.md');
  assert.deepEqual(fs.readdirSync(kit.dir).filter((n) => !n.startsWith('manifest')).every((n) => /^[0-9a-f]{12}\.(md|txt)$/.test(n)), true);
});

test('Windows tasklist output parses to MB', async () => {
  const { parseTasklist } = await import('../server/lib/brandkit.js');
  assert.equal(parseTasklist('"node.exe","4242","Console","1","51,200 K"\r\n'), 50);
  assert.equal(parseTasklist('INFO: No tasks are running'), null);
});
