// Runs in its own process (see isolatedExtract in brandkit.js): reads the text out of one PDF or
// DOCX and sends it back. It is resource-limited, not sandboxed: the parent caps its memory and
// time and kills it when either runs out, so a file that blows up the parser takes down this
// process rather than the studio. It runs as the same user with the same file access.
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
