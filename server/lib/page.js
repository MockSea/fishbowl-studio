// The board page: one self-contained HTML document assembled from the files in server/ui
// (no build step). Every skin in server/ui/skins is included; light is the default, others
// apply by data-skin. The web bridge gives the board `window.Studio`; web-pages adds the
// app's own pages (engine and key, brand kit, schedule).
import { readOwn, listOwn } from './files.js';

export const BOARD_SCRIPTS = ['board-icons.js', 'board-views.js', 'board-drafts.js', 'board-pages.js', 'board-wizard.js'];
export const WEB_SCRIPTS = ['web-pages.js'];
const built = new Map();

// bridge and extra are file names in server/ui. A test can pass its own bridge source as text.
export function boardHtml({ bridge = 'web-bridge.js', extra = WEB_SCRIPTS, bridgeSource = null } = {}) {
  const key = JSON.stringify([bridge, extra, bridgeSource]);
  if (built.has(key)) return built.get(key);
  const ui = (f) => readOwn(`server/ui/${f}`);
  const skins = listOwn('server/ui/skins').filter((f) => f.endsWith('.css'))
    .sort((a, b) => (a === 'light.css' ? -1 : b === 'light.css' ? 1 : a.localeCompare(b)));
  const html = ui('board.html')
    .replace('/*__SKINS__*/', () => skins.map((f) => ui(`skins/${f}`)).join('\n'))
    .replace('/*__CSS__*/', () => ui('board.css'))
    .replace('//__BRIDGE__', () => `window.STUDIO_SKINS = ${JSON.stringify(skins.map((f) => f.replace(/\.css$/, '')))};\n` + (bridgeSource ?? ui(bridge)))
    .replace('//__VIEWS__', () => [...BOARD_SCRIPTS, ...extra].map(ui).join('\n'));
  built.set(key, html);
  return html;
}
