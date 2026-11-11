// Small, real brand-kit files built in memory for tests: a one-page PDF with text, a DOCX,
// a PNG and a JPEG header. Written to a temp folder by writeKitFiles().
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { zip, crc32 } from '../scripts/pack.mjs';

export function pdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export function docx(paragraphs) {
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  const f = (name, s) => ({ name, data: Buffer.from(s) });
  return zip([
    f('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    f('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    f('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${ns}"><w:body>${body}</w:body></w:document>`),
  ]);
}

// A 1x1 PNG.
export function png() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0x2f, 0x6b, 0x5c]))), chunk('IEND', Buffer.alloc(0))]);
}

export function writeKitFiles(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    'guidelines.pdf': pdf('Northwind says ride more, worry less.'),
    'tone.docx': docx(['Tone of voice: warm and practical.', 'Never say synergy.']),
    'logo.png': png(),
    'notes.md': Buffer.from('# Words we use\nWe say "fix", never "service event".\n'),
  };
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), b);
  return Object.fromEntries(Object.keys(files).map((n) => [n, path.join(dir, n)]));
}
