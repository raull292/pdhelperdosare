const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overlayApi', {
  onConfig: (cb) => ipcRenderer.on('overlay-config', (e, cfg) => cb(cfg))
});
