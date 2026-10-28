const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spreadsheetDesktop', {
  takeLaunchFile: () => ipcRenderer.invoke('desktop-take-launch'),
  onOpenFile: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('desktop-open-file', listener);
    return () => ipcRenderer.removeListener('desktop-open-file', listener);
  },
});
