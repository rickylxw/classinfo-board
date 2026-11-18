/* QQ Reader 桥接：消息阅读（QQ / 微信 / 数智东南）只在桌面端可用
 *
 * 页面不直接 fetch 127.0.0.1:3210（跨源 + 远端 CSP 限制），全部经 Electron 主进程
 * 的白名单代理（window.desktop.qqFetch）。浏览器 / 手机端 window.desktop 不存在，
 * 相关入口自动隐藏，零影响。
 */
import { ref } from 'vue'

const bridge = typeof window !== 'undefined' ? window.desktop : null
export const isDesktop = !!bridge?.isDesktop

// 消息服务就绪（侧栏「群消息」入口、课程页「群消息」按钮据此显示）
export const qqReady = ref(false)
// 不可用原因：starting | unconfigured | spawn-failed | unreachable | ''
export const qqReason = ref(isDesktop ? 'starting' : '')

export async function probeQQ() {
  if (!bridge) return false
  try {
    const st = await bridge.qqStatus()
    qqReady.value = !!st?.available
    qqReason.value = st?.reason || ''
  } catch {
    qqReady.value = false
    qqReason.value = 'unreachable'
  }
  return qqReady.value
}

// 桌面端启动即后台探活（顺带让主进程拉起本机消息服务），侧栏入口就绪后自动浮现
if (isDesktop) probeQQ().catch(() => {})

/* 只读查询，返回 JSON；失败抛错。path 形如 '/api/chats'、'/api/messages?conv=…' */
export async function qqApi(path) {
  const r = await bridge.qqFetch(path)
  if (!r || !r.ok) throw new Error(r?.error || '消息服务不可用')
  return r.data
}
