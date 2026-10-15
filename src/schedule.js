/* 日程表：解析课程备注里的上课时间（来自 ehall 课表导入），按周计算课表与 DDL */

const WD = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }

export function mondayOf(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))   // 周一为一周开始
  return d
}
export const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d }
export const fmtMD = d => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
export const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * 解析课程备注中的上课时间段。格式（拉取课表导入时生成）：
 *   周二 · 第11-12节 · 4-6周,8周 · 教三-304
 * 返回 [{ weekday:1-7, start, end, weeks:Set, room }]
 */
export function parseCourseTimes(course) {
  const text = course?.note || ''
  const out = []
  for (const line of text.split('\n')) {
    const m = /^(周[一二三四五六日天])\s*·\s*第\s*(\d+)(?:\s*-\s*(\d+))?\s*节\s*·\s*(.+)$/.exec(line.trim())
    if (!m) continue
    const weekday = WD[m[1][1]]
    const start = +m[2]
    const end = m[3] ? +m[3] : start
    // 剩余段：周次 · 教室（教室可能含 ·，取最后一个段为教室）
    const rest = m[4].split('·').map(s => s.trim())
    const room = rest.length >= 2 ? rest.pop() : ''
    const weeks = parseWeeks(rest.join('·'))
    out.push({ weekday, start, end, weeks, room })
  }
  return out
}

/** 解析周次文本："1-16周"、"1-13周(单)"、"2,4,6周"、"9-16周" → {min,max,has(w)} */
export function parseWeeks(zcmc) {
  const weeks = new Set()
  let min = Infinity
  let max = 0
  for (const part of String(zcmc || '').split(/[,，]/)) {
    const m = /(\d+)\s*(?:-\s*(\d+))?\s*周/.exec(part)
    if (!m) continue
    const s = +m[1]
    const e = m[2] ? +m[2] : s
    const odd = /单/.test(part)
    const even = /双/.test(part)
    for (let w = s; w <= e; w++) {
      if (odd && w % 2 === 0) continue
      if (even && w % 2 === 1) continue
      weeks.add(w)
    }
    min = Math.min(min, s)
    max = Math.max(max, e)
  }
  return { min: weeks.size ? min : 0, max, has: w => weeks.has(w) }
}

/** 学期第一周周一（localStorage 记忆）；未设置时返回 null，由调用方决定兜底 */
const SEM_KEY = 'classinfo-sem-start'
export function getSemStart() {
  const v = localStorage.getItem(SEM_KEY)
  if (!v) return null
  const d = new Date(v)
  return isNaN(d) ? null : mondayOf(d)
}
export function setSemStart(dateStr) {
  if (dateStr) localStorage.setItem(SEM_KEY, fmtDate(mondayOf(new Date(dateStr))))
  else localStorage.removeItem(SEM_KEY)
}
export function getSemStartInput() {
  const start = getSemStart()
  return start ? fmtDate(start) : ''
}
/** 该日期处于第几教学周（学期第一周=第 1 周）；未设置学期起点时返回 null */
export function weekNumberOf(date) {
  const start = getSemStart()
  if (!start) return null
  const diff = Math.round((mondayOf(date) - start) / (7 * 864e5))
  return diff >= 0 ? diff + 1 : null
}
