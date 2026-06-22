const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('portfolioShell', {
  appName: 'Portfolio Demo'
});
