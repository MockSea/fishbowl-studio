// Shared test helpers: a temp STUDIO_HOME per test, a fixed clock and a fake fetch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeContext } from '../server/lib/state.js';
import { validateConfig } from '../server/lib/config.js';

export function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
}

// Local-time clock helper: at(2026, 10, 21, 9, 30)
export const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

export function testContext({ now = at(2026, 10, 21, 7, 0), seed = 42, feeds = {} } = {}) {
  const home = tempHome();
  const clock = { t: now };
  const fetchImpl = async (url) => {
    if (!(url in feeds)) return { ok: false, status: 404, headers: new Map(), text: async () => '' };
    return { ok: true, status: 200, url, headers: new Map(), text: async () => feeds[url] };
  };
  const ctx = makeContext({ home, now: () => clock.t, seed, fetchImpl });
  return { ctx, home, clock };
}

export function rss(items, title = 'Example Feed') {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items.map((i) =>
    `<item><title>${i.title}</title><link>${i.link}</link><description>${i.desc || ''}</description>${i.date ? `<pubDate>${i.date}</pubDate>` : ''}</item>`).join('')}</channel></rss>`;
}

// Fixture sources, written as her own file (validated). Claude can't add sources through
// studio_config; she adds them on the board.
export function setSources(ctx, content) {
  ctx.store.writeFile('sources.json', JSON.stringify(validateConfig('sources.json', content), null, 2) + '\n');
}
