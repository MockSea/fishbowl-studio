// Brand kit: the brand's own guideline files, per persona. Files are copied into
// <persona folder>/brand-kit/ under generated names, with a manifest. PDF, DOCX, Markdown and
// plain text are turned into text once, on add; PNG and JPEG stay images and go to the model as
// image blocks. Every drafting call includes the kit (see kitContent).
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const LIMITS = {
  file_bytes: 10 * 1024 * 1024, // per file on disk
  image_bytes: 5 * 1024 * 1024, // the API's per-image limit
  files: 20, // per persona
  total_bytes: 60 * 1024 * 1024, // per persona
  text_chars: 20000, // extracted text kept per file
  prompt_text_chars: 60000, // kit text sent with one call
  prompt_images: 6, // kit images sent with one call
};

const KINDS = {
  pdf: { exts: ['.pdf'], media: 'application/pdf', label: 'PDF' },
  docx: { exts: ['.docx'], media: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word' },
  text: { exts: ['.md', '.markdown', '.txt'], media: 'text/plain', label: 'Text' },
  png: { exts: ['.png'], media: 'image/png', label: 'Image', image: true },
  jpeg: { exts: ['.jpg', '.jpeg'], media: 'image/jpeg', label: 'Image', image: true },
};
export const ACCEPT = Object.values(KINDS).flatMap((k) => k.exts);

const kindOfExt = (ext) => Object.keys(KINDS).find((k) => KINDS[k].exts.includes(ext)) || null;
const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);

// The bytes have to match the extension; a renamed file is refused.
export function sniff(buf, kind) {
  if (kind === 'pdf') return startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (kind === 'png') return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (kind === 'jpeg') return startsWith(buf, [0xff, 0xd8, 0xff]);
  if (kind === 'docx') return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
  if (kind === 'text') {
    if (buf.includes(0)) return false;
    try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; }
  }
  return false;
}

const clean = (s) => String(s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();

export async function extractText(buf, kind) {
  if (kind === 'text') return clean(buf.toString('utf8'));
  if (kind === 'pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(doc, { mergePages: true });
    return clean(Array.isArray(text) ? text.join('\n\n') : text);
  }
  if (kind === 'docx') {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return clean(value);
  }
  return '';
}

const displayName = (p) => path.basename(String(p)).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'file';

export function openKit(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  const read = () => {
    try { const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); return Array.isArray(m.files) ? m.files : []; } catch { return []; }
  };
  const write = (files) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${manifestPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ files }, null, 2) + '\n');
    fs.renameSync(tmp, manifestPath);
  };
  const textOf = (f) => (f.text_file ? fs.readFileSync(path.join(dir, f.text_file), 'utf8') : '');

  // What the Brand kit page shows. No file contents, only what was ingested.
  function list() {
    const files = read();
    return {
      files: files.map((f) => ({ id: f.id, name: f.name, kind: f.kind, label: KINDS[f.kind]?.label || f.kind, bytes: f.bytes, added_at: f.added_at,
        chars: f.chars ?? null, truncated: !!f.truncated, preview: f.text_file ? textOf(f).slice(0, 280) : null })),
      total_bytes: files.reduce((n, f) => n + f.bytes, 0),
      limits: LIMITS, accept: ACCEPT,
    };
  }

  // Add one file by path. Returns {ok, file} or {ok:false, name, reason}.
  async function add(src, { now = () => Date.now() } = {}) {
    const name = displayName(src);
    const kind = kindOfExt(path.extname(name).toLowerCase());
    if (!kind) return { ok: false, name, reason: `Only ${ACCEPT.join(', ')} files.` };
    let st;
    try { st = fs.statSync(src); } catch { return { ok: false, name, reason: 'The file could not be read.' }; }
    if (!st.isFile()) return { ok: false, name, reason: 'That is not a file.' };
    const cap = KINDS[kind].image ? LIMITS.image_bytes : LIMITS.file_bytes;
    if (st.size > cap) return { ok: false, name, reason: `Too big: ${KINDS[kind].image ? 'images' : 'files'} can be up to ${Math.round(cap / 1048576)} MB.` };
    if (st.size === 0) return { ok: false, name, reason: 'The file is empty.' };
    const files = read();
    if (files.length >= LIMITS.files) return { ok: false, name, reason: `A brand kit holds up to ${LIMITS.files} files. Remove one first.` };
    if (files.reduce((n, f) => n + f.bytes, 0) + st.size > LIMITS.total_bytes) return { ok: false, name, reason: `The brand kit is full (${Math.round(LIMITS.total_bytes / 1048576)} MB in all).` };
    const buf = fs.readFileSync(src);
    if (!sniff(buf, kind)) return { ok: false, name, reason: `It doesn't look like a real ${KINDS[kind].label} file.` };
    let text = null;
    if (!KINDS[kind].image) {
      try { text = await extractText(buf, kind); } catch { return { ok: false, name, reason: `No text could be read from this ${KINDS[kind].label} file.` }; }
      if (!text) return { ok: false, name, reason: 'There is no text in it to read (a scanned PDF needs to be added as images).' };
    }
    const id = randomBytes(6).toString('hex');
    const ext = KINDS[kind].exts[0];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}${ext}`), buf);
    const f = { id, name, kind, media_type: KINDS[kind].media, file: `${id}${ext}`, bytes: st.size, added_at: new Date(now()).toISOString() };
    if (text != null) {
      f.chars = text.length;
      f.truncated = text.length > LIMITS.text_chars;
      f.text_file = `${id}.txt`;
      fs.writeFileSync(path.join(dir, f.text_file), text.slice(0, LIMITS.text_chars));
    }
    write([...read(), f]);
    return { ok: true, file: { id, name, kind } };
  }

  function remove(id) {
    const files = read();
    const f = files.find((x) => x.id === id);
    if (!f) return { ok: false, reason: 'That file is not in the brand kit.' };
    write(files.filter((x) => x.id !== id));
    for (const p of [f.file, f.text_file].filter(Boolean)) fs.rmSync(path.join(dir, path.basename(p)), { force: true });
    return { ok: true, name: f.name };
  }

  // What every model call gets: the text of each document (within the prompt cap) and the images.
  function content() {
    const docs = [], images = [];
    let left = LIMITS.prompt_text_chars;
    for (const f of read()) {
      if (f.text_file && left > 0) {
        const t = textOf(f).slice(0, left);
        left -= t.length;
        docs.push({ name: f.name, text: t });
      } else if (KINDS[f.kind]?.image && images.length < LIMITS.prompt_images) {
        images.push({ name: f.name, media_type: f.media_type, data: fs.readFileSync(path.join(dir, path.basename(f.file))).toString('base64') });
      }
    }
    return { docs, images };
  }

  return { dir, list, add, remove, content };
}

export const kitDir = (ctx, slug) => path.join(ctx.personas.dir(slug), 'brand-kit');
export const kitFor = (ctx, slug) => openKit(kitDir(ctx, slug));
