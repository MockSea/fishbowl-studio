// Fishbowl Studio desktop app (Electron main process). One window showing the studio board,
// served from a private studio:// scheme with no network access of its own. The board talks to
// host.js through preload.cjs; links open in the default browser.
import { app, BrowserWindow, ipcMain, clipboard, shell, dialog, protocol, safeStorage, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardHtml } from '../server/lib/rpc.js';
import { resolveHome } from '../server/lib/store.js';
import { makeHost } from './host.js';
import { ACCEPT } from './brandkit.js';
import { safeHttpsUrl } from '../server/lib/urls.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'studio://app';
const TICK_MS = 5 * 60 * 1000;
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true } }]);
app.setName('Fishbowl Studio');
// STUDIO_APP_DIR keeps the key and preferences somewhere else (for trying the app out).
if (process.env.STUDIO_APP_DIR) app.setPath('userData', path.resolve(process.env.STUDIO_APP_DIR));

let win = null;
let host = null;

function page() {
  return boardHtml({
    bridge: path.join(HERE, 'ui', 'desktop-bridge.js'),
    extra: [path.join(HERE, 'ui', 'desktop-pages.js')],
  });
}

// Every IPC call must come from our own page in our own window.
const fromBoard = (e) => !!win && e.sender === win.webContents && String(e.senderFrame?.url || '').startsWith(`${ORIGIN}/`);
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!fromBoard(e)) throw new Error('Not allowed.');
    return fn(...args);
  });
}

function wire() {
  handle('studio:call', async (name, args) => {
    try { return await host.call(name, args); } catch (e) { return { error: e.message }; }
  });
  handle('studio:ask', (text) => { const r = host.ask(text); return { ok: r.ok, kind: r.kind, message: r.message }; });
  handle('studio:copy', (text) => { clipboard.writeText(String(text)); return true; });
  handle('studio:open-link', async (url) => {
    const u = safeHttpsUrl(String(url));
    if (!u.ok) return false;
    await shell.openExternal(u.url);
    return true;
  });
  handle('key:status', () => host.keyStatus());
  handle('key:set', (k) => host.keySet(k));
  handle('key:clear', () => host.keyClear());
  handle('kit:list', () => host.kitList());
  handle('kit:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add to the brand kit', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Brand files', extensions: ACCEPT.map((x) => x.slice(1)) }] });
    return r.canceled ? { results: [], kit: host.kitList() } : host.kitAdd(r.filePaths);
  });
  handle('kit:add', (paths) => host.kitAdd(paths));
  handle('kit:remove', (id) => host.kitRemove(id));
  handle('prefs:get', () => host.prefsGet());
  handle('prefs:set', (p) => host.prefsSet(p));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: 'Fishbowl Studio', backgroundColor: '#ffffff', show: false,
    webPreferences: { preload: path.join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const u = safeHttpsUrl(url);
    if (u.ok) shell.openExternal(u.url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault(); });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.loadURL(`${ORIGIN}/index.html`);
}

app.whenReady().then(() => {
  const home = resolveHome();
  host = makeHost({ home, appDir: app.getPath('userData'), safeStorage, emit: (ev) => { if (win) win.webContents.send('studio:run', ev); } });
  protocol.handle('studio', (req) => {
    const u = new URL(req.url);
    if (u.host !== 'app' || (u.pathname !== '/' && u.pathname !== '/index.html')) return new Response('Not found', { status: 404 });
    return new Response(page(), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
  });
  // The page never needs the network; the main process does the fetching and the API calls.
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith('studio:') && !d.url.startsWith('devtools:') && !d.url.startsWith('data:') }));
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
  wire();
  createWindow();
  const timer = setInterval(() => { host.tick().catch(() => {}); }, TICK_MS);
  host.tick().catch(() => {});
  app.on('before-quit', () => clearInterval(timer));
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
