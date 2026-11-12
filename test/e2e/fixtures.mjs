// Brand kit test files, made fresh into a folder on each run. Everything is fictional (a made-up
// bike shop). Uses macOS textutil for the DOCX, sips for the JPEG and zip for the oversized DOCX.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const BRAND = 'Spoke and Chain is a neighbourhood bike repair shop. Voice: warm, practical, a little dry. We say "ride" not "cycle". We never talk politics.';

// A one-page PDF. With text, it shows the given line; without, it draws only a box (a "scan").
export function pdf(text) {
  const stream = text ? `BT /F1 14 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET` : '72 600 200 100 re f';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };

// A solid-colour PNG, w by h.
export function png(w = 96, h = 96, rgb = [17, 110, 99]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill(rgb).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

export function makeFixtures(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const p = (n) => path.join(dir, n);
  const w = (n, b) => { fs.writeFileSync(p(n), b); return p(n); };
  const f = {};
  f.pdf = w('brand-guidelines.pdf', pdf(BRAND));
  fs.writeFileSync(p('tone.txt'), `Tone of voice\n\n${BRAND}\nShort sentences. One idea per post.`);
  execFileSync('textutil', ['-convert', 'docx', p('tone.txt'), '-output', p('tone-of-voice.docx')]);
  f.docx = p('tone-of-voice.docx');
  f.md = w('words-we-use.md', '# Words we use\n\n- ride, not cycle\n- tune-up, not service\n');
  f.png = w('logo.png', png());
  execFileSync('sips', ['-s', 'format', 'jpeg', f.png, '--out', p('shopfront.jpg')], { stdio: 'ignore' });
  f.jpg = p('shopfront.jpg');
  // Too big: a real PDF header padded past 10 MB; a PNG header padded past 5 MB.
  f.bigPdf = w('huge-guidelines.pdf', Buffer.concat([pdf(BRAND), Buffer.alloc(11 * 1024 * 1024, 0x20)]));
  f.bigPng = w('huge-photo.png', Buffer.concat([png(), Buffer.alloc(6 * 1024 * 1024)]));
  // Bad files.
  f.fakePdf = w('not-really.pdf', 'This is plain text with a .pdf name.');
  f.fakePng = w('not-really.png', 'Plain text with a .png name.');
  f.corruptDocx = w('broken.docx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2048, 7)]));
  f.scanPdf = w('scanned.pdf', pdf(null));
  f.empty = w('empty.txt', '');
  f.gif = w('animation.gif', Buffer.from('GIF89a'));
  f.exe = w('installer.exe', Buffer.from('MZ'));
  // A DOCX that unpacks to 70 MB of zeros (a few hundred KB on disk).
  fs.mkdirSync(p('bomb'), { recursive: true });
  fs.writeFileSync(path.join(p('bomb'), 'document.xml'), Buffer.alloc(70 * 1024 * 1024));
  execFileSync('zip', ['-q', '-9', '../zip-bomb.docx', 'document.xml'], { cwd: p('bomb') });
  fs.rmSync(p('bomb'), { recursive: true });
  f.bombDocx = p('zip-bomb.docx');
  return f;
}
