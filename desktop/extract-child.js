// Runs in its own process (see isolatedExtract in brandkit.js): reads the text out of one PDF or
// DOCX and sends it back. A hostile file can only exhaust this process, never the app.
import { extractText } from './brandkit.js';

const MAX_CHARS = 2_000_000;

process.once('message', async ({ kind, data }) => {
  try {
    const text = await extractText(Buffer.from(data), kind);
    process.send({ ok: true, chars: text.length, text: text.slice(0, MAX_CHARS) }, () => process.exit(0));
  } catch (e) {
    process.send({ ok: false, error: String(e?.message || e) }, () => process.exit(0));
  }
});
