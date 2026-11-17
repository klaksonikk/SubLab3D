const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  saveJsonFile: (defaultName, content) =>
    ipcRenderer.invoke('save-json-file', { defaultName, content }),
});
