const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    validateZapretPath: (path) => ipcRenderer.invoke('validate-zapret-path', path),
    discoverStrategies: (path) => ipcRenderer.invoke('discover-strategies', path),
    parseStrategy: (path, filename) => ipcRenderer.invoke('parse-strategy', path, filename),
    checkUpdates: (zapretVersion, appVersion) => ipcRenderer.invoke('check-updates', zapretVersion, appVersion),
    startStandalone: (path, args) => ipcRenderer.invoke('start-standalone', path, args),
    stopAll: () => ipcRenderer.invoke('stop-all'),
    installService: (path, args, name) => ipcRenderer.invoke('install-service', path, args, name),
    removeService: () => ipcRenderer.invoke('remove-service'),
    getStatus: () => ipcRenderer.invoke('get-status'),
    smartCheck: () => ipcRenderer.invoke('smart-check'),
    getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
    runDiagnostics: (measurements) => ipcRenderer.invoke('run-diagnostics', measurements),
    readSettings: () => ipcRenderer.invoke('read-settings'),
    writeSettings: (settings) => ipcRenderer.invoke('write-settings', settings),
    readScores: () => ipcRenderer.invoke('read-scores'),
    writeScores: (scores) => ipcRenderer.invoke('write-scores', scores),
    readLog: () => ipcRenderer.invoke('read-log'),
    readList: (path) => ipcRenderer.invoke('read-list', path),
    writeList: (path, content) => ipcRenderer.invoke('write-list', path, content),
    minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
    downloadAndExtractZapret: (path) => ipcRenderer.invoke('download-and-extract-zapret', path)
});
