const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('coursebridge', {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  settings: value => ipcRenderer.invoke('settings', value),
  control: action => ipcRenderer.invoke('control', action),
  copyToken: () => ipcRenderer.invoke('copy-token'),
  openExtension: () => ipcRenderer.invoke('open-extension'),
  openLearning: () => ipcRenderer.invoke('open-learning'),
  importBank: () => ipcRenderer.invoke('import-bank'),
  listBank: query => ipcRenderer.invoke('bank-list', query),
  saveQuestion: input => ipcRenderer.invoke('bank-save', input),
  exportBank: () => ipcRenderer.invoke('bank-export'),
  offlineReference: question => ipcRenderer.invoke('offline-reference', question),
  searchOffline: query => ipcRenderer.invoke('offline-search', query),
  configureEnncy: input => ipcRenderer.invoke('enncy-config', input),
  refreshEnncy: () => ipcRenderer.invoke('enncy-refresh'),
  retryEnncy: () => ipcRenderer.invoke('enncy-retry'),
  openEnncy: page => ipcRenderer.invoke('open-enncy', page),
  configureDeepSeek: input => ipcRenderer.invoke('deepseek-config', input),
  refreshDeepSeek: () => ipcRenderer.invoke('deepseek-refresh'),
  retryDeepSeek: () => ipcRenderer.invoke('deepseek-retry'),
  openDeepSeek: page => ipcRenderer.invoke('open-deepseek', page)
});
