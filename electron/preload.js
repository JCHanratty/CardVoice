const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.on('update-available', (_e, info) => callback(info));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.on('update-downloaded', (_e, info) => callback(info));
  },
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onMenuAction: (callback) => {
    ipcRenderer.removeAllListeners('menu-action');
    ipcRenderer.on('menu-action', (_e, data) => callback(data));
  },
});
