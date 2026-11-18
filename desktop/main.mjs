/* Electron 桌面端主进程：课表板外壳 + 本机 QQ Reader 消息服务桥
 *
 * 与 APK 同思路：窗口直接加载板子服务器（远端），前端改动部署即生效、无需重发包。
 * 板子地址从 gitignored 的 .desktop-server-url 读取（内容一行 http://<板子IP>:5173），
 * 本机 QQ Reader 目录从 .desktop-qqreader-path 读取（本机路径不入库）。
 *
 * 消息阅读（QQ / 微信 / 数智东南三源，来自 QQ Reader 的 messages.db）走 IPC 白名单
 * 代理到其只读服务（127.0.0.1:3210），页面拿不到任意本机 fetch 能力；服务不在时
 * 自动拉起（与 QQ Reader 自带 WPF 壳同一套复用逻辑，探活同一端口即可共存）。
 */
import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '..')
const QQ_PORT = 3210
const QQ_BASE = `http://127.0.0.1:${QQ_PORT}`

// 配置读取：打包后优先 exe 所在目录（portable 运行时给 PORTABLE_EXECUTABLE_DIR），开发时用仓库根
function configDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR
  if (app.isPackaged) return path.dirname(app.getPath('exe'))
  return ROOT
}
function readConfig(name) {
  for (const dir of [configDir(), ROOT]) {
    try {
      const v = readFileSync(path.join(dir, name), 'utf8').trim()
      if (v) return v
    } catch { /* 试下一个位置 */ }
  }
  return ''
}

const serverUrl = readConfig('.desktop-server-url')
// http/https 均可，端口可省（如 https://class.rickylin.top 或 http://192.168.3.5:5173）
const configValid = /^https?:\/\/[^\s/]+(:\d+)?$/.test(serverUrl)

if (!app.requestSingleInstanceLock()) {
  // 已有实例在跑：直接退出，由 first-instance 那边把窗口带到前台
  app.quit()
} else if (!configValid) {
  app.whenReady().then(() => {
    dialog.showErrorBox(
      '课程信息板 · 缺少配置',
      '缺少 .desktop-server-url（内容一行：http://<板子IP>:5173）。\n' +
      '该文件不入库，放在桌面端 exe 同目录（或仓库根目录）即可。'
    )
    app.quit()
  })
} else {
  main()
}

function main() {
  // ---------- QQ Reader 消息服务 ----------
  const qqPath = readConfig('.desktop-qqreader-path')
  const qq = { available: false, reason: 'starting', proc: null }
  let qqReadyResolve
  const qqReadyPromise = new Promise(r => { qqReadyResolve = r })

  async function probeQQ(timeoutMs = 800) {
    try {
      const res = await fetch(`${QQ_BASE}/api/stats`, { signal: AbortSignal.timeout(timeoutMs) })
      return res.ok
    } catch { return false }
  }

  async function ensureQQReaderServer() {
    if (!qqPath) { qq.reason = 'unconfigured'; qqReadyResolve(); return }
    if (await probeQQ()) { qq.available = true; qq.reason = ''; qqReadyResolve(); return }
    // 不在就拉起：cwd 指向 QQ Reader 目录，与它的 WPF 壳（app.ps1）同一套复用逻辑；
    // 退出时不杀进程——只读服务无害，且 WPF 壳可能正在共用
    try {
      qq.proc = spawn('node', ['server.mjs'], { cwd: qqPath, windowsHide: true, stdio: 'ignore' })
      qq.proc.on('error', () => { if (!qq.available) { qq.reason = 'spawn-failed'; qqReadyResolve() } })
      qq.proc.on('exit', () => { if (!qq.available) { qq.reason = 'spawn-failed'; qqReadyResolve() } })
    } catch {
      qq.reason = 'spawn-failed'; qqReadyResolve(); return
    }
    for (let i = 0; i < 10 && !qq.available; i++) {
      await new Promise(r => setTimeout(r, 1000))
      if (await probeQQ()) { qq.available = true; qq.reason = '' }
    }
    if (!qq.available) qq.reason = 'unreachable'
    qqReadyResolve()
  }

  // 只放行 4 个只读端点：页面（含被注入的脚本）无法借这道桥探测本机其它端口
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
      const res = await fetch(QQ_BASE + p, { signal: AbortSignal.timeout(15000) })
      const data = await res.json()
      if (data && data.error) return { ok: false, error: data.error }
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: e?.message || '请求失败' }
    }
  })

  // ---------- 窗口 ----------
  function createWindow() {
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 640,
      title: '课程信息板',
      autoHideMenuBar: true,
      backgroundColor: '#eef0f5',
      webPreferences: {
        preload: path.join(DIR, 'preload.cjs'),
        partition: 'persist:classinfo', // 登录 token 持久化（独立于浏览器，二次打开免登录）
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    })
    win.setMenuBarVisibility(false)
    // F12 开发者工具（打包版也保留，排障用）
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
    // 页内 target=_blank 外链（GitHub 仓库等）交系统默认浏览器
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
    win.loadURL(serverUrl)
    return win
  }

  let win = null
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    ensureQQReaderServer() // 后台拉起，不阻塞窗口加载
    win = createWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
