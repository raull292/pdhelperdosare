const { contextBridge, ipcRenderer } = require('electron');

// API pentru fereastra MDT overlay (index.html?view=overlay)
contextBridge.exposeInMainWorld('mdtOverlayApi', {
  hide: () => ipcRenderer.send('mdt-overlay-hide'),
  close: () => ipcRenderer.send('mdt-overlay-close'),
  setClickThrough: (on) => ipcRenderer.send('mdt-overlay-clickthrough', !!on),
  setOpacity: (v) => ipcRenderer.send('mdt-overlay-opacity', v),
  onClickThrough: (cb) => ipcRenderer.on('mdt-ct-state', (e, on) => cb(!!on))
});
