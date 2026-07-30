const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  isApp: true,
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close'),
  onState: (cb) => ipcRenderer.on('win-state', (e, isMax) => cb(isMax)),
  overlay: {
    toggle: (cfg) => ipcRenderer.send('overlay-toggle', cfg),
    setConfig: (cfg) => ipcRenderer.send('overlay-config', cfg),
    lock: (locked) => ipcRenderer.send('overlay-lock', locked),
    setPos: (x, y) => ipcRenderer.send('overlay-setpos', { x, y }),
    onMoved: (cb) => ipcRenderer.on('overlay-moved', (e, b) => cb(b)),
    onClosed: (cb) => ipcRenderer.on('overlay-closed', () => cb())
  },
  mdtOverlay: {
    toggle: () => ipcRenderer.send('mdt-overlay-toggle'),
    setHotkeys: (hk) => ipcRenderer.invoke('mdt-hotkeys', hk)
  },
  updates: {
    version: () => ipcRenderer.invoke('app-version').catch(() => null),
    check: () => ipcRenderer.invoke('update-check').catch(() => false),
    install: () => ipcRenderer.send('update-install'),
    onStatus: (cb) => ipcRenderer.on('update-status', (e, s) => cb(s))
  },
  cache: {
    size: () => ipcRenderer.invoke('cache-size').catch(() => -1),
    clear: () => ipcRenderer.invoke('cache-clear').catch(() => false)
  },
  discord: {
    auth: (url) => ipcRenderer.send('discord-auth-start', url),
    onToken: (cb) => ipcRenderer.on('discord-token', (e, d) => cb(d))
  }
});
