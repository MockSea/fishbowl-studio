// The only door between the board page and the app. The page gets these calls and nothing else
// (no Node, no file system). File paths for dropped files come from webUtils.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('studioDesktop', {
  call: invoke('studio:call'),
  ask: invoke('studio:ask'),
  copy: invoke('studio:copy'),
  openLink: invoke('studio:open-link'),
  keyStatus: invoke('key:status'),
  keySet: invoke('key:set'),
  keyClear: invoke('key:clear'),
  kitList: invoke('kit:list'),
  kitPick: invoke('kit:pick'),
  kitAdd: invoke('kit:add'),
  kitRemove: invoke('kit:remove'),
  prefsGet: invoke('prefs:get'),
  prefsSet: invoke('prefs:set'),
  pathsFor: (files) => Array.from(files || []).map((f) => webUtils.getPathForFile(f)).filter(Boolean),
  onRun: (f) => { ipcRenderer.on('studio:run', (_e, ev) => f(ev)); },
});
