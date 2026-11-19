/* Electron 桌面端主进程：课表板外壳 + 三工具（QQ Reader 消息 / CLH 课件助手 / 悬浮时钟）
 *
 * 与 APK 同思路：主窗口加载板子服务器（远端），前端改动部署即生效、无需重发包。
 * 配置（gitignored，不入库）：.desktop-server-url（http://<域名或IP>[:端口]）、
 * .desktop-qqreader-path（QQ Reader 目录）、.desktop-clh-path（CLH ppt2mindmap 目录）。
 * 打包版从 exe 同目录（PORTABLE_EXECUTABLE_DIR）读，开发版从仓库根读。
 *
 * 本地服务均为「探活复用、缺失拉起、退出不杀」：
 *  - QQ Reader server.mjs（127.0.0.1:3210 只读消息，三源）
 *  - CLH server.mjs（127.0.0.1:8777，BOARD_ORIGIN 指向板子）
 * 悬浮时钟 = 透明置顶无边框小窗（desktop/clock/index.html），托盘常驻。
 */
import { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, globalShortcut, powerMonitor, session, nativeImage, screen, net } from 'electron'
import { readFileSync, writeFile, rename, appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '..')
const QQ_BASE = 'http://127.0.0.1:3210'
const CLH_BASE = 'http://127.0.0.1:8777'
const PARTITION = 'persist:classinfo' // 主窗/CLH 窗共用：同源 localStorage（登录态）+ SSO iframe 通道

// 配置读取：打包后优先 exe 所在目录（portable 运行时给 PORTABLE_EXECUTABLE_DIR），
// 其次仓库根（开发），最后应用数据目录（首次运行引导写入）
function configDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR
  if (app.isPackaged) return path.dirname(app.getPath('exe'))
  return ROOT
}
function readConfig(name) {
  for (const dir of [configDir(), ROOT, app.getPath('userData')]) {
    try {
      const v = readFileSync(path.join(dir, name), 'utf8').trim()
      if (v) return v
    } catch { /* 试下一个位置 */ }
  }
  return ''
}

const serverUrl = readConfig('.desktop-server-url')
const configValid = /^https?:\/\/[^\s/]+(:\d+)?$/.test(serverUrl)

// 主进程兜底：未捕获异常记日志并继续运行，不弹 Error 对话框、不退出
// （此前 undici 的 assert(this.paused) 崩溃会直接杀掉打包版——网络栈已换 net.fetch，这里再加保险）
function logMainError(kind, e) {
  try {
    appendFileSync(path.join(app.getPath('userData'), 'main-errors.log'),
      `${new Date().toISOString()} [${kind}] ${e?.stack || e}\n`)
  } catch { /* 日志失败忽略 */ }
}
process.on('uncaughtException', e => logMainError('uncaught', e))
process.on('unhandledRejection', e => logMainError('rejection', e))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else if (!configValid) {
  // 首次运行（exe 被放到任意目录、无配置文件）：弹出引导窗口，保存到应用数据目录后自动重启
  app.whenReady().then(showConfigWindow)
} else {
  main()
}

function showConfigWindow() {
  const win = new BrowserWindow({
    width: 440,
    height: 220,
    resizable: false,
    title: '课程信息板 · 初始配置',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(DIR, 'config-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(DIR, 'config', 'index.html'))
}

ipcMain.handle('config:save', (_e, url) => {
  const u = String(url || '').trim()
  if (!/^https?:\/\/[^\s/]+(:\d+)?$/.test(u)) {
    return { ok: false, error: '格式不对：应为 http:// 或 https:// 开头的完整地址（可带端口，不带路径）' }
  }
  try {
    writeFile(path.join(app.getPath('userData'), '.desktop-server-url'), u + '\n', () => {
      app.relaunch()
      app.exit(0)
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || '写入失败' }
  }
})

function main() {
  // ---------- 本地服务（QQ Reader / CLH）：探活复用、缺失拉起、退出不杀 ----------
  const qqPath = readConfig('.desktop-qqreader-path')
  const clhPath = readConfig('.desktop-clh-path')
  const qq = { available: false, reason: 'starting' }
  const clh = { available: false, reason: 'starting' }
  let qqReadyResolve, clhReadyResolve
  const qqReadyPromise = new Promise(r => { qqReadyResolve = r })
  const clhReadyPromise = new Promise(r => { clhReadyResolve = r })

  async function probe(url, timeoutMs = 800) {
    try {
      // net.fetch 走 Electron/Chromium 网络栈：彻底避开 Node undici 的
      // assert(this.paused) 断言崩溃（探活响应不消费时曾把打包版炸退出）
      const res = await net.fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      await res.arrayBuffer()
      return res.ok
    } catch { return false }
  }

  // 两服务的 server.mjs 都是 cwd+默认文件名，仅端口/探活路径/额外 env 不同
  function ensureLocalService(name, svc, base, probePath, cwd, extraEnv = {}, readyResolve) {
    return (async () => {
      if (!cwd) { svc.reason = 'unconfigured'; readyResolve(); return }
      if (await probe(base + probePath)) { svc.available = true; svc.reason = ''; readyResolve(); return }
      try {
        const child = spawn('node', ['server.mjs'], { cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...extraEnv } })
        // stderr 落盘（截断式覆盖）：服务起不来/运行报错时有据可查
        const errLog = path.join(app.getPath('userData'), `${name}-stderr.log`)
        try { writeFile(errLog, '') } catch { /* 忽略 */ }
        child.stderr?.on('data', d => { try { appendFileSync(errLog, d) } catch { /* 忽略 */ } })
        child.on('error', () => { if (!svc.available) { svc.reason = 'spawn-failed'; readyResolve() } })
        child.on('exit', () => { if (!svc.available) { svc.reason = 'spawn-failed'; readyResolve() } })
      } catch {
        svc.reason = 'spawn-failed'; readyResolve(); return
      }
      for (let i = 0; i < 10 && !svc.available; i++) {
        await new Promise(r => setTimeout(r, 1000))
        if (await probe(base + probePath)) { svc.available = true; svc.reason = '' }
      }
      if (!svc.available) svc.reason = 'unreachable'
      readyResolve()
    })()
  }

  const servicesTask = Promise.all([
    ensureLocalService('qq-reader', qq, QQ_BASE, '/api/stats', qqPath, {}, qqReadyResolve),
    // CLH：BOARD_ORIGIN 指向板子，其 /board-api、令牌校验、云同步全部走线上
    ensureLocalService('clh', clh, CLH_BASE, '/', clhPath, { BOARD_ORIGIN: serverUrl }, clhReadyResolve)
  ])

  // ---------- IPC：QQ Reader 只读桥 ----------
  const QQ_API_RE = /^\/api\/(chats|messages|search|stats)(\?.*)?$/
  ipcMain.handle('qq:status', async () => {
    await qqReadyPromise
    return { available: qq.available, reason: qq.reason, endpoint: QQ_BASE }
  })
  ipcMain.handle('qq:fetch', async (_e, p) => {
    await qqReadyPromise
    if (typeof p !== 'string' || !QQ_API_RE.test(p)) return { ok: false, error: '不支持的端点' }
    if (!qq.available) return { ok: false, error: '消息服务不可用' }
    try {
      // 同 probe：走 net.fetch，避开 undici 断言崩溃
      const res = await net.fetch(QQ_BASE + p, { signal: AbortSignal.timeout(15000) })
      const data = await res.json()
      if (data && data.error) return { ok: false, error: data.error }
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: e?.message || '请求失败' }
    }
  })

  // ---------- IPC：工具窗口 ----------
  async function openClh() {
    await clhReadyPromise
    if (!clh.available) {
      const hint = clh.reason === 'unconfigured'
        ? '未配置课件助手路径：在桌面端 exe 同目录放置 .desktop-clh-path（内容一行：CLH 的 ppt2mindmap 目录）'
        : '课件助手服务不可用（127.0.0.1:8777）：确认 CLH 的 server.mjs 可运行（Node ≥ 18）且 .desktop-clh-path 指向其目录'
      dialog.showMessageBox({ type: 'info', title: '课件助手', message: hint })
      return { ok: false, error: hint }
    }
    showClh()
    return { ok: true }
  }
  ipcMain.handle('tool:open', async (_e, name) => {
    if (name === 'clock') { toggleClock(); return { ok: true } }
    if (name === 'clh') return openClh()
    return { ok: false, error: '未知工具' }
  })

  // 板子页面 → 时钟窗的「下节课」
  ipcMain.handle('schedule:info', (_e, info) => {
    if (clockWin && !clockWin.isDestroyed()) clockWin.webContents.send('schedule:info', info)
  })

  // ---------- IPC：悬浮时钟 ----------
  const clockDataFile = () => path.join(app.getPath('userData'), 'clock-data.json')
  const CLOCK_DEFAULT = { daily: {}, settings: { goals: { 工作: 120, 学习: 240, 游戏: 60 }, pomodoro: false, idlePause: true }, todos: {} }
  const atomicWrite = (file, text) => {
    const tmp = file + '.tmp'
    writeFile(tmp, text, e => {
      if (e) return
      rename(tmp, file, () => {})
    })
  }
  ipcMain.handle('clock:load', async () => {
    try {
      return JSON.parse(await readFile(clockDataFile(), 'utf8'))
    } catch { return CLOCK_DEFAULT }
  })
  ipcMain.handle('clock:save', (_e, data) => {
    if (!data || typeof data !== 'object') return false
    atomicWrite(clockDataFile(), JSON.stringify(data))
    return true
  })
  ipcMain.handle('clock:idle', () => powerMonitor.getSystemIdleTime())
  ipcMain.handle('clock:click-through', (_e, on) => {
    if (!clockWin || clockWin.isDestroyed()) return false
    clockClickThrough = !!on
    clockWin.setIgnoreMouseEvents(clockClickThrough, { forward: true })
    refreshTrayMenu()
    return clockClickThrough
  })
  ipcMain.handle('clock:set-size', (_e, w, h) => {
    if (!clockWin || clockWin.isDestroyed()) return false
    const bw = Math.round(Math.min(Math.max(+w || 0, 60), 600))
    const bh = Math.round(Math.min(Math.max(+h || 0, 24), 400))
    const [x, y] = clockWin.getPosition()
    clockWin.setSize(bw, bh)
    clockWin.setPosition(x, y)
    return true
  })
  ipcMain.handle('clock:hide', () => { if (clockWin && !clockWin.isDestroyed()) clockWin.hide() })

  // ---------- 窗口 ----------
  let mainWin = null
  let clhWin = null
  let clockWin = null
  let tray = null
  let clockClickThrough = false
  let quitting = false

  function attachCommon(win) {
    // F12 开发者工具（排障用）
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
    // 外链走系统默认浏览器
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
  }

  function createMainWindow() {
    mainWin = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 640,
      title: '课程信息板',
      autoHideMenuBar: true,
      backgroundColor: '#eef0f5',
      webPreferences: {
        preload: path.join(DIR, 'preload.cjs'),
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    })
    mainWin.setMenuBarVisibility(false)
    attachCommon(mainWin)
    // 关主窗口 = 隐藏（时钟/托盘常驻），托盘「退出」才真退出
    mainWin.on('close', e => {
      if (!quitting) { e.preventDefault(); mainWin.hide() }
    })
    mainWin.loadURL(serverUrl)
    return mainWin
  }

  function showMainWindow() {
    if (!mainWin || mainWin.isDestroyed()) { createMainWindow(); return }
    mainWin.show()
    mainWin.focus()
  }

  function createClhWindow() {
    clhWin = new BrowserWindow({
      width: 1280,
      height: 820,
      title: '课件助手 · Class Learning Helper',
      autoHideMenuBar: true,
      backgroundColor: '#0f1420',
      webPreferences: {
        partition: PARTITION, // 与主窗同分区：CLH 的 SSO iframe 能读到板子登录态
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    })
    clhWin.setMenuBarVisibility(false)
    attachCommon(clhWin)
    clhWin.on('close', e => {
      if (!quitting) { e.preventDefault(); clhWin.hide() }
    })
    clhWin.loadURL(CLH_BASE)
  }

  function showClh() {
    if (!clhWin || clhWin.isDestroyed()) { createClhWindow(); return }
    clhWin.show()
    clhWin.focus()
  }

  const clockPosFile = () => path.join(app.getPath('userData'), 'clock-pos.json')

  function createClockWindow() {
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
    clockWin = new BrowserWindow({
      width: 420,
      height: 76,
      x: Math.round(sw * 0.62),
      y: Math.round(sh * 0.08),
      minWidth: 120,
      minHeight: 24,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(DIR, 'clock-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    })
    clockWin.setAlwaysOnTop(true, 'screen-saver')
    try {
      const pos = JSON.parse(readFileSync(clockPosFile(), 'utf8'))
      if ([pos.x, pos.y].every(n => Number.isFinite(n) && n > -32000 && n < 32000)) clockWin.setPosition(pos.x, pos.y)
    } catch { /* 首次无位置记录 */ }
    clockWin.on('moved', () => {
      try {
        const [x, y] = clockWin.getPosition()
        writeFile(clockPosFile(), JSON.stringify({ x, y }), () => {})
      } catch { /* 忽略 */ }
    })
    clockWin.loadFile(path.join(DIR, 'clock', 'index.html'))
  }

  function toggleClock() {
    if (!clockWin || clockWin.isDestroyed()) { createClockWindow(); return }
    if (clockWin.isVisible()) clockWin.hide()
    else { clockWin.show(); clockWin.focus() }
    refreshTrayMenu()
  }

  // ---------- 托盘 ----------
  function trayIcon() {
    for (const p of [path.join(ROOT, 'public', 'icons', 'icon-192.png'), path.join(configDir(), 'icon-192.png'), path.join(process.resourcesPath || '', 'icon-192.png')]) {
      try {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) return img
      } catch { /* 下一个 */ }
    }
    return nativeImage.createEmpty()
  }

  function refreshTrayMenu() {
    if (!tray) return
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示课表板', click: showMainWindow },
      { label: '🎓 课件助手（CLH）', click: openClh },
      { label: '⏱ 悬浮时钟', click: toggleClock },
      { type: 'separator' },
      { label: '时钟穿透锁定 (Ctrl+Alt+L)', type: 'checkbox', checked: clockClickThrough, click: item => { toggleClickThrough(item.checked) } },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit() } }
    ]))
  }

  function toggleClickThrough(on) {
    if (!clockWin || clockWin.isDestroyed()) return
    clockClickThrough = on
    clockWin.setIgnoreMouseEvents(on, { forward: true })
    refreshTrayMenu()
  }

  function createTray() {
    tray = new Tray(trayIcon())
    tray.setToolTip('课程信息板')
    tray.on('click', showMainWindow)
    refreshTrayMenu()
  }

  // ---------- 快捷键 ----------
  function registerShortcuts() {
    globalShortcut.register('Control+Alt+L', () => toggleClickThrough(!clockClickThrough))
  }

  // ---------- 生命周期 ----------
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(async () => {
    servicesTask // 后台拉起本地服务，不阻塞窗口
    createMainWindow()
    createTray()
    registerShortcuts()
    // 下载处理挂在共享分区 session 上（主窗/CLH 窗都可能触发）
    session.fromPartition(PARTITION).on('will-download', (_e, item) => {
      const saveTo = dialog.showSaveDialogSync({ defaultPath: item.getFilename() })
      if (!saveTo) { item.cancel(); return }
      item.setSavePath(saveTo)
    })
  })

  app.on('window-all-closed', () => {
    // 托盘常驻：只有用户明确退出才离开
  })
  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
