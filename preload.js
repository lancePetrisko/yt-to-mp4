const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  addDownload: (item) =>
    fetch('http://localhost:3131/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    }).then((r) => r.json()),

  startDownload: (id) =>
    fetch('http://localhost:3131/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then((r) => r.json()),

  cancelDownload: (id) =>
    fetch('http://localhost:3131/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then((r) => r.json()),

  getLogs: (id) =>
    fetch(`http://localhost:3131/logs/${id}`).then((r) => r.json()),

  onProgress: (callback) => {
    ipcRenderer.on('progress', (_event, data) => callback(data));
  },

  removeProgressListener: () => {
    ipcRenderer.removeAllListeners('progress');
  },
});
