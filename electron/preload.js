const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  getActiveWindowSource: () => ipcRenderer.invoke('get-active-window-source'),

  registerShortcuts: (mapping) => ipcRenderer.invoke('register-global-shortcuts', mapping),

  onHotkeyPressed: (callback) => {
    const handler = (_event, action, data) => callback(action, data);
    ipcRenderer.on('hotkey-pressed', handler);
    return () => ipcRenderer.removeListener('hotkey-pressed', handler);
  },
});
