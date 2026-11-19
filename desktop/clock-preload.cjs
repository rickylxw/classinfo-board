// 悬浮时钟窗 preload：数据/窗口控制都走主进程（本地文件页，无 node 集成）
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('clockBridge', {
  loadData: () => ipcRenderer.invoke('clock:load'),
  saveData: data => ipcRenderer.invoke('clock:save', data),
  getIdleSeconds: () => ipcRenderer.invoke('clock:idle'),
  setClickThrough: on => ipcRenderer.invoke('clock:click-through', on),
  setSize: (w, h) => ipcRenderer.invoke('clock:set-size', w, h),
  hide: () => ipcRenderer.invoke('clock:hide'),
  // 板子页面推来的「下节课」
  onSchedule: fn => ipcRenderer.on('schedule:info', (_e, info) => fn(info))
})
