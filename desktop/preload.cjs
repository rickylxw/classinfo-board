// 桌面端 preload：向页面暴露最小桥（CommonJS —— 沙箱化 preload 只允许 require('electron')）
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  // 只读消息查询（主进程白名单代理到本机 QQ Reader 服务）
  qqFetch: path => ipcRenderer.invoke('qq:fetch', path),
  qqStatus: () => ipcRenderer.invoke('qq:status')
})
