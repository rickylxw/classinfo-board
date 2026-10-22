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

/* 群号点击跳转：复制群号并尽力唤起对应应用。
 * 移动端 QQ 可经 mqqapi scheme 直达群名片；桌面端与其他类型复制后提示手动打开。
 * 返回提示语，由调用方负责 toast（utils 不依赖 store，避免循环引用）。 */
export async function openGroupChat(type, num) {
  const n = String(num || '').trim()
  if (!n) return ''
  await copyText(n)
  const t = String(type || '')
  if (/QQ/i.test(t)) {
    if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
      const a = document.createElement('a')
      a.href = `mqqapi://card/show_pslcard?src_type=internal&version=1&uin=${encodeURIComponent(n)}&card_type=group&source=qrcode`
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
      return '群号已复制，正在打开 QQ…'
    }
    return '群号已复制，请打开 QQ 粘贴搜索加群'
  }
  if (/微信/i.test(t)) return '群号已复制：微信群需群内邀请，可把群号发给同学'
  if (/数智东南/i.test(t)) return '群号已复制，请打开「数智东南」App 粘贴搜索加群'
  return '已复制：' + n
}

/* ---------- 附件分类（课件 / 作业文件 / 其他） ---------- */
export const FILE_CATEGORIES = [
  { id: 'courseware', label: '课件' },
  { id: 'assignment', label: '作业文件' },
  { id: 'other', label: '其他' }
]
const CATEGORY_LABELS = Object.fromEntries(FILE_CATEGORIES.map(c => [c.id, c.label]))
export const fileCategoryLabel = id => CATEGORY_LABELS[id] || '其他'

/* 按文件名猜分类：强作业特征（报告/答案/作业等）最优先，其次演示文稿扩展名与课件特征，
 * 再「实验/Lab」弱作业特征，其余归其他 */
export function guessFileCategory(name = '') {
  const n = String(name).toLowerCase()
  const dot = n.lastIndexOf('.')
  const ext = dot > -1 ? n.slice(dot + 1) : ''
  if (/(作业|hw[sd_-]|homework|assignment|报告|report|答案|解题|提交|ipynb)/.test(n)) return 'assignment'
  if (['ppt', 'pptx', 'key'].includes(ext) || /(课件|讲义|lecture|slide|教材|课本|教案|chapter|第[一二三四五六七八九十d]+章)/.test(n)) return 'courseware'
  if (/(实验|lab[sd_-]|problem|习题)/.test(n)) return 'assignment'
  return 'other'
}
