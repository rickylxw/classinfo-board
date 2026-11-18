import type { CapacitorConfig } from '@capacitor/cli'
import { readFileSync } from 'node:fs'

// APK 是站点外壳：WebView 直接加载板子服务器，/api 相对路径同源可用，
// 前端改动部署服务器即全员生效、无需重发 APK。
// 服务器地址属内网 IP，不入库（公开仓库红线，见 docs/repo-management.md）：
// 从仓库根目录 gitignored 的 .capacitor-server-url 读取，内容一行，如 http://<板子IP>:5173
let serverUrl = ''
try {
  serverUrl = readFileSync(new URL('./.capacitor-server-url', import.meta.url), 'utf8').trim()
} catch { /* 文件不存在 */ }
if (!/^http:\/\/\S+:\d+$/.test(serverUrl)) {
  throw new Error('缺少 .capacitor-server-url（内容一行：http://<板子IP>:5173）。该文件已被 .gitignore 排除，按 README 说明自建。')
}

const config: CapacitorConfig = {
  appId: 'io.github.rickylxw.classinfoboard',
  appName: '课程信息板',
  webDir: 'dist',
  server: {
    url: serverUrl,
    // 安卓 9+ 默认禁明文 http，局域网板子未上 HTTPS 时必须放行（AndroidManifest 同时兜底）
    cleartext: true
  }
}

export default config
