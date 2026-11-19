// 首次运行配置窗 preload
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('configApi', {
  save: url => ipcRenderer.invoke('config:save', url)
})
