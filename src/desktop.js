/* 桌面端专属工具（仅 Electron 壳内可用；浏览器/手机端 window.desktop 不存在，全部自动跳过）：
 * - openTool：打开课件助手（CLH）窗口 / 悬浮时钟显隐切换
 * - startScheduleFeed：把「下节课」信息每分钟推给主进程（转发给悬浮时钟显示）
 */
import { store } from './store'
import { nextClassInfo } from './ics'
import { getSemStartInput } from './schedule'

const bridge = typeof window !== 'undefined' ? window.desktop : null
export const isDesktop = !!bridge?.isDesktop

export async function openTool(name) {
  const r = await bridge.openTool(name)
  if (!r || !r.ok) throw new Error(r?.error || '工具不可用')
}

let feedStarted = false
export function startScheduleFeed() {
  if (!bridge || feedStarted) return
  feedStarted = true
  const push = () => {
    const info = nextClassInfo(store.courses, getSemStartInput())
    bridge.setScheduleInfo(info ? { name: info.name, room: info.room, at: info.at.getTime() } : null)
  }
  push()
  setInterval(push, 60000)
}
