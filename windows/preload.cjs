const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('labBridge', {
  copy: { postMessage: text => ipcRenderer.invoke('lab:copy', text) },
  save: { postMessage: text => ipcRenderer.invoke('lab:save', text) },
});
