const { app, BrowserWindow, ipcMain, shell, globalShortcut, session, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// cache pe disc plafonat la 50 MB — aplicatia nu acumuleaza resurse
app.commandLine.appendSwitch('disk-cache-size', String(50 * 1024 * 1024));

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

// ---- autorizare Discord prin browserul de sistem (loopback pe 127.0.0.1) ----
// Browserul utilizatorului (unde e deja logat pe Discord) face autorizarea;
// pagina de retur trimite tokenul catre acest mini-server local, care il
// livreaza ferestrei aplicatiei. Nu se face niciun login in aplicatie.
let dAuthSrv = null;
function closeAuthSrv() { if (dAuthSrv) { try { dAuthSrv.close(); } catch (_) {} dAuthSrv = null; } }
ipcMain.on('discord-auth-start', (e, authUrl) => {
  const send = (data) => { try { e.sender.send('discord-token', data); } catch (_) {} };
  if (typeof authUrl !== 'string' || !authUrl.startsWith('https://discord.com/oauth2/authorize')) return;
  try {
    if (!dAuthSrv) {
      dAuthSrv = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1:53682');
        if (u.pathname === '/cb') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><meta charset="utf-8"><title>Police Helper</title>'
            + '<body style="font-family:sans-serif;background:#0b1730;color:#eaf1fb;display:grid;place-items:center;height:100vh;margin:0">'
            + '<div id="m" style="text-align:center;font-size:18px">Se transmite autorizarea…</div>'
            + '<script>fetch("/tok?"+location.hash.slice(1)).then(function(){document.getElementById("m").innerHTML="✅ Autorizat!<br><small style=\\"color:#8ba0c4\\">Poți închide tab-ul și te poți întoarce în Police Helper.</small>";}).catch(function(){document.getElementById("m").textContent="Eroare — încearcă din nou din aplicație.";});</script>');
        } else if (u.pathname === '/tok') {
          send({
            token: u.searchParams.get('access_token') || '',
            expiresIn: +(u.searchParams.get('expires_in') || 0),
            state: u.searchParams.get('state') || ''
          });
          res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok');
          setTimeout(closeAuthSrv, 1500);
        } else { res.writeHead(404); res.end(); }
      });
      dAuthSrv.on('error', () => { send({ error: 'port' }); closeAuthSrv(); });
      dAuthSrv.listen(53682, '127.0.0.1');
      setTimeout(closeAuthSrv, 5 * 60 * 1000); // nu lasa portul deschis la nesfarsit
    }
  } catch (_) { send({ error: 'port' }); }
  shell.openExternal(authUrl);
});

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
    icon: path.join(__dirname, 'icon.ico'),
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
    icon: path.join(__dirname, 'icon.ico'),
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

// ---- copiere din joc: shell-ul cere piesa (titlu/sentinta/descriere) ferestrei
//      principale, care o calculeaza cu guard-urile ei; raspunsul intra in
//      clipboard si se confirma printr-o notificare Windows ----
function requestPiece(kind) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('copy-piece', kind);
}
function notifyCopy(title, body) {
  try { new Notification({ title, body, silent: true, icon: path.join(__dirname, 'icon.ico') }).show(); } catch (err) {}
}
ipcMain.on('copy-piece-result', (e, r) => {
  r = r || {};
  if (r.ok && typeof r.text === 'string') {
    clipboard.writeText(r.text);
    const p = String(r.text).replace(/\s+/g, ' ').trim();
    notifyCopy('📋 ' + (r.label || 'Copiat') + ' — lipește cu CTRL+V', p.length > 80 ? p.slice(0, 77) + '…' : p);
  } else {
    notifyCopy('⛔ Nu copiez', String(r.err || 'Eroare'));
  }
});

// ---- taste configurabile (alese de utilizator din pagina Overlays) ----
const DEFAULT_HOTKEYS = {
  toggle: 'Control+Shift+D',
  clickthrough: 'Control+Shift+E',
  copyTitle: 'Control+Shift+1',
  copySent: 'Control+Shift+2',
  copyDesc: 'Control+Shift+3'
};
const HOTKEY_ACTIONS = {
  toggle: () => toggleMdtOverlay(),
  clickthrough: () => setMdtClickThrough(!mdtClickThrough),
  copyTitle: () => requestPiece('title'),
  copySent: () => requestPiece('sent'),
  copyDesc: () => requestPiece('desc')
};
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
  const next = {};
  for (const k of Object.keys(DEFAULT_HOTKEYS)) {
    next[k] = (typeof hk[k] === 'string') ? hk[k] : DEFAULT_HOTKEYS[k];
  }
  globalShortcut.unregisterAll();
  const res = {};
  for (const k of Object.keys(DEFAULT_HOTKEYS)) {
    res[k] = true;
    if (next[k]) {
      try { res[k] = !!globalShortcut.register(next[k], HOTKEY_ACTIONS[k]); }
      catch (err) { res[k] = false; }
    }
  }
  hotkeys = next;
  saveHotkeys();
  return res;
}
ipcMain.handle('mdt-hotkeys', (e, hk) => applyHotkeys(hk));

// ---- cache: dimensiune & golire manuala (din Setari) ----
ipcMain.handle('cache-size', async () => {
  try { return await session.defaultSession.getCacheSize(); } catch (err) { return -1; }
});
ipcMain.handle('cache-clear', async () => {
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearCodeCaches({});
    return true;
  } catch (err) { return false; }
});

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
  // (true, true) = instalare silentioasa in acelasi folder + repornire automata;
  // fara parametri ar deschide wizard-ul complet de instalare la fiecare update
  ipcMain.on('update-install', () => autoUpdater.quitAndInstall(true, true));
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

  // cache-ul se goleste la fiecare pornire: incarci mereu ultima versiune si nu se aduna date
  const load = () => { if (mainWin) mainWin.loadURL(LIVE_URL); };
  session.defaultSession.clearCache().then(load, load);
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
