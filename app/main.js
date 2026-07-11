const { app, BrowserWindow, ipcMain, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const LIVE_URL = 'https://raull292.github.io/pdhelperdosare/';
const OVERLAY_URL = 'https://raull292.github.io/pdhelperdosare/overlay.html';
const MDT_OVERLAY_URL = LIVE_URL + '?view=overlay';
let mainWin = null;
let overlayWin = null;
let mdtWin = null;
let mdtClickThrough = false;

// ---- window controls (fereastra principala) ----
ipcMain.on('win-minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('win-maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.on('win-close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

// ---- overlay transparent peste joc ----
function createOverlay(cfg) {
  cfg = cfg || {};
  overlayWin = new BrowserWindow({
    width: 340,
    height: 520,
    x: (cfg.x == null ? 60 : cfg.x),
    y: (cfg.y == null ? 200 : cfg.y),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWin.setIgnoreMouseEvents(cfg.locked !== false, { forward: true });
  overlayWin.webContents.on('did-finish-load', () => overlayWin.webContents.send('overlay-config', cfg));
  overlayWin.on('moved', () => {
    if (mainWin && overlayWin) {
      const b = overlayWin.getBounds();
      mainWin.webContents.send('overlay-moved', { x: b.x, y: b.y });
    }
  });
  overlayWin.on('closed', () => {
    overlayWin = null;
    if (mainWin) mainWin.webContents.send('overlay-closed');
  });
}
ipcMain.on('overlay-toggle', (e, cfg) => { if (overlayWin) overlayWin.close(); else createOverlay(cfg); });
ipcMain.on('overlay-config', (e, cfg) => { if (overlayWin) overlayWin.webContents.send('overlay-config', cfg); });
ipcMain.on('overlay-lock', (e, locked) => { if (overlayWin) overlayWin.setIgnoreMouseEvents(!!locked, { forward: true }); });
ipcMain.on('overlay-setpos', (e, p) => { if (overlayWin) overlayWin.setPosition(Math.round(p.x), Math.round(p.y)); });

// ---- MDT overlay interactiv (poti scrie in el peste joc) ----
function createMdtOverlay() {
  mdtWin = new BrowserWindow({
    width: 470,
    height: 780,
    x: 80,
    y: 80,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    minWidth: 340,
    minHeight: 360,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'mdt-overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mdtWin.setAlwaysOnTop(true, 'screen-saver');
  mdtWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mdtClickThrough = false;
  mdtWin.setIgnoreMouseEvents(false);
  mdtWin.loadURL(MDT_OVERLAY_URL);
  mdtWin.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) mdtWin.loadFile(path.join(__dirname, 'index.html'), { query: { view: 'overlay' } });
  });
  mdtWin.on('closed', () => { mdtWin = null; });
}
function toggleMdtOverlay() {
  if (mdtWin) {
    if (mdtWin.isVisible()) mdtWin.hide();
    else { mdtWin.show(); mdtWin.focus(); }
  } else createMdtOverlay();
}
function setMdtClickThrough(on) {
  mdtClickThrough = !!on;
  if (mdtWin) {
    mdtWin.setIgnoreMouseEvents(mdtClickThrough, { forward: true });
    mdtWin.webContents.send('mdt-ct-state', mdtClickThrough);
  }
}
ipcMain.on('mdt-overlay-toggle', () => toggleMdtOverlay());
ipcMain.on('mdt-overlay-hide', () => { if (mdtWin) mdtWin.hide(); });
ipcMain.on('mdt-overlay-close', () => { if (mdtWin) mdtWin.close(); });
ipcMain.on('mdt-overlay-clickthrough', (e, on) => setMdtClickThrough(on));
ipcMain.on('mdt-overlay-opacity', (e, v) => { if (mdtWin) mdtWin.setOpacity(Math.max(0.2, Math.min(1, Number(v) || 1))); });

// ---- taste configurabile (alese de utilizator din pagina Overlays) ----
const DEFAULT_HOTKEYS = { toggle: 'Control+Shift+D', clickthrough: 'Control+Shift+E' };
let hotkeys = Object.assign({}, DEFAULT_HOTKEYS);
function hotkeysFile() { return path.join(app.getPath('userData'), 'hotkeys.json'); }
function loadHotkeys() {
  try { return Object.assign({}, DEFAULT_HOTKEYS, JSON.parse(fs.readFileSync(hotkeysFile(), 'utf8'))); }
  catch (err) { return Object.assign({}, DEFAULT_HOTKEYS); }
}
function saveHotkeys() {
  try { fs.writeFileSync(hotkeysFile(), JSON.stringify(hotkeys)); } catch (err) {}
}
// (re)inregistreaza scurtaturile; sir gol = tasta dezactivata; intoarce ce s-a putut inregistra
function applyHotkeys(hk) {
  hk = hk || {};
  const next = {
    toggle: (typeof hk.toggle === 'string') ? hk.toggle : DEFAULT_HOTKEYS.toggle,
    clickthrough: (typeof hk.clickthrough === 'string') ? hk.clickthrough : DEFAULT_HOTKEYS.clickthrough
  };
  globalShortcut.unregisterAll();
  const res = { toggle: true, clickthrough: true };
  if (next.toggle) {
    try { res.toggle = !!globalShortcut.register(next.toggle, () => toggleMdtOverlay()); }
    catch (err) { res.toggle = false; }
  }
  if (next.clickthrough) {
    try { res.clickthrough = !!globalShortcut.register(next.clickthrough, () => setMdtClickThrough(!mdtClickThrough)); }
    catch (err) { res.clickthrough = false; }
  }
  hotkeys = next;
  saveHotkeys();
  return res;
}
ipcMain.handle('mdt-hotkeys', (e, hk) => applyHotkeys(hk));

// ---- auto-update din GitHub Releases (electron-updater) ----
ipcMain.handle('app-version', () => app.getVersion());
function initUpdater() {
  if (!app.isPackaged) return; // in dev (npm start) nu exista update feed
  let autoUpdater;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch (err) { return; }
  const send = (st) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('update-status', st); };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // daca nu apesi "Reporneste", se instaleaza singur la inchidere
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => send({ state: 'downloading', version: i && i.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'uptodate' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', version: i && i.version }));
  autoUpdater.on('error', (e) => send({ state: 'error', message: String((e && e.message) || e) }));
  const check = () => { autoUpdater.checkForUpdates().catch(() => {}); };
  ipcMain.handle('update-check', () => { check(); return true; });
  ipcMain.on('update-install', () => autoUpdater.quitAndInstall());
  setTimeout(check, 5000);              // la pornire
  setInterval(check, 30 * 60 * 1000);   // apoi la fiecare 30 min
}

// ---- fereastra principala ----
function createWindow() {
  mainWin = new BrowserWindow({
    width: 1240,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    center: true,
    backgroundColor: '#080f1e',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWin.loadURL(LIVE_URL);
  mainWin.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) mainWin.loadFile(path.join(__dirname, 'index.html'));
  });

  mainWin.on('maximize', () => mainWin.webContents.send('win-state', true));
  mainWin.on('unmaximize', () => mainWin.webContents.send('win-state', false));
  mainWin.on('closed', () => { mainWin = null; if (overlayWin) overlayWin.close(); if (mdtWin) mdtWin.close(); });

  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  initUpdater();
  // scurtaturi globale (merg si cand esti in joc) — tastele salvate de utilizator, altfel implicitele
  applyHotkeys(loadHotkeys());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
