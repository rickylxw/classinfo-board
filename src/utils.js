/* 纯工具函数：无状态、不依赖组件 */

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2)

// 课程匹配键：课程名+教师，去空格、忽略大小写（与后端 courseKey 规则一致）
const normKey = v => String(v || '').trim().toLowerCase().replace(/\s+/g, '')
export const courseKeyOf = c => normKey(c?.name) + '|' + normKey(c?.teacher)

const pad = n => String(n).padStart(2, '0')
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

export function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtSize(n) {
  if (!n && n !== 0) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

export function fmtDT(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const now = new Date()
  const y = d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '-' : ''
  return `${y}${pad(d.getMonth() + 1)}-${pad(d.getDate())}(周${WEEK[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ddlBadge(iso, status) {
  if (status === 'done') return { cls: 'b-done', text: '已完成' }
  if (!iso) return { cls: 'b-none', text: '无截止时间' }
  const diff = new Date(iso) - Date.now()
  if (diff < 0) return { cls: 'b-over', text: '已逾期' }
  const days = Math.floor(diff / 864e5)
  const hours = Math.floor((diff % 864e5) / 36e5)
  if (days === 0) return { cls: 'b-today', text: hours > 0 ? `今天 · ${hours} 小时后` : '即将截止' }
  if (days <= 3) return { cls: 'b-soon', text: `${days} 天后截止` }
  if (days <= 7) return { cls: 'b-week', text: `${days} 天后截止` }
  return { cls: 'b-far', text: `${days} 天后截止` }
}

export function fileIcon(name, kind) {
  if (kind === 'link') return '🔗'
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (['pdf'].includes(ext)) return '📄'
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return '📝'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
  if (['ppt', 'pptx'].includes(ext)) return '📽️'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️'
  if (['mp4', 'mkv', 'avi', 'mov', 'mp3', 'wav'].includes(ext)) return '🎬'
  return '📎'
}

export async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t)
    return true
  } catch (e) {
    const ta = document.createElement('textarea')
    ta.value = t
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
