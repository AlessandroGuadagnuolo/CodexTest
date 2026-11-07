const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('calendarApp', {
  getState: () => ipcRenderer.invoke('state:get'),
  sync: () => ipcRenderer.invoke('sync:start'),
  addAccount: (provider) => ipcRenderer.invoke('account:add', provider),
  removeAccount: (accountId) => ipcRenderer.invoke('account:remove', accountId),
  setCalendarEnabled: (calendarKey, enabled) => ipcRenderer.invoke('calendar:toggle', calendarKey, enabled),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  copyFeedUrl: () => ipcRenderer.invoke('feed:copy-url'),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  }
});
