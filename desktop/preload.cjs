// 桌面端 preload：向页面暴露最小桥（CommonJS —— 沙箱化 preload 只允许 require('electron')）
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  // 只读消息查询（主进程白名单代理到本机 QQ Reader 服务）
  qqFetch: path => ipcRenderer.invoke('qq:fetch', path),
  qqStatus: () => ipcRenderer.invoke('qq:status'),
  // 桌面工具：'clh'（课件助手窗口）| 'clock'（悬浮时钟显隐）；返回 {ok, error}
  openTool: name => ipcRenderer.invoke('tool:open', name),
  // 把板子侧算好的「下节课」交给主进程（转发给悬浮时钟）
  setScheduleInfo: info => ipcRenderer.invoke('schedule:info', info)
})
