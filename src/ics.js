/* 课表 → .ics 日历导出 + 「下节课」计算
 * 节次时间表与逐周展开逻辑移植自 Schedule generation 项目
 * （lib/utils/class_time.dart，教务处 2024.9.10 版上课时间安排）。
 * 上课时间解析复用 schedule.js 的 parseCourseTimes（周X · 第X-Y节 · 周次 · 教室）。
 */
import { parseCourseTimes, mondayOf, addDays } from './schedule'

// 东南大学默认节次时间表：节次 -> [开始, 结束]
export const CLASS_TIMES = {
  1: ['08:00', '08:45'], 2: ['08:50', '09:35'], 3: ['09:50', '10:35'],
  4: ['10:40', '11:25'], 5: ['11:30', '12:15'], 6: ['14:00', '14:45'],
  7: ['14:50', '15:35'], 8: ['15:50', '16:35'], 9: ['16:40', '17:25'],
  10: ['17:30', '18:15'], 11: ['19:00', '19:45'], 12: ['19:50', '20:35'],
  13: ['20:40', '21:25']
}

/* ---------- 内部工具 ---------- */
const escText = s => String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

// ICS 规范：每行 ≤75 字节（UTF-8），超出折行，续行以空格开头
function foldLine(line) {
  const enc = new TextEncoder()
  const bytes = enc.encode(line)
  if (bytes.length <= 75) return [line]
  const out = []
  let chunk = []
  let len = 0
  for (const ch of line) {
    const cb = enc.encode(ch).length
    if (len + cb > (out.length ? 74 : 75)) {
      out.push(chunk.join(''))
      chunk = []
      len = 0
    }
    chunk.push(ch)
    len += cb
  }
  if (chunk.length) out.push(chunk.join(''))
  return out.map((l, idx) => idx === 0 ? l : ' ' + l)
}

const pad2 = n => String(n).padStart(2, '0')
// 本地时间 basic 格式，配 TZID=Asia/Shanghai
const fmtDTLocal = (d, hm) =>
  `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${hm.replace(':', '')}00`

const normId = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/* ---------- 导出 ---------- */

/**
 * 生成整学期课表的 .ics 文本：每门课 × 每个上课时段 × 每个活跃周一条 VEVENT
 * （与 Schedule generation 安卓端的逐周写入策略一致，重复导入由 UID 保持稳定）。
 * @returns ICS 文本；学期起点无效返回 ''
 */
export function buildSemesterICS(courses, semStartStr, { calendarName = '东南课表' } = {}) {
  const sem = mondayOf(new Date(semStartStr))
  if (!semStartStr || isNaN(sem)) return ''
  const stamp = new Date()
  const stampStr = fmtDTLocal(stamp, `${pad2(stamp.getHours())}:${pad2(stamp.getMinutes())}`)

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//classinfo-board//schedule-ics//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escText(calendarName),
    'X-WR-TIMEZONE:Asia/Shanghai',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Shanghai',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'END:STANDARD',
    'END:VTIMEZONE'
  ]
  let count = 0
  for (const c of courses) {
    const slots = parseCourseTimes(c)
    if (!slots.length) continue
    for (const t of slots) {
      const stT = CLASS_TIMES[t.start]
      const enT = CLASS_TIMES[t.end]
      if (!stT || !enT) continue
      // t.weeks 是 parseWeeks 的 {min,max,has(w)}（非 Set），逐周判定
      for (let w = 1; w <= 30; w++) {
        if (!t.weeks.has(w)) continue
        const day = addDays(sem, (w - 1) * 7 + (t.weekday - 1))
        const uid = `clb-${normId(c.name) || 'course'}${normId(c.teacher) ? '-' + normId(c.teacher) : ''}-d${t.weekday}-p${t.start}-w${w}@classinfo-board`
        const descParts = ['由课程信息板导出']
        if (c.teacher) descParts.push(`教师：${c.teacher}`)
        descParts.push(`第${w}周 · 第${t.start}-${t.end}节`)
        lines.push('BEGIN:VEVENT')
        lines.push('UID:' + uid)
        lines.push('DTSTAMP:' + stampStr)
        lines.push('DTSTART;TZID=Asia/Shanghai:' + fmtDTLocal(day, stT[0]))
        lines.push('DTEND;TZID=Asia/Shanghai:' + fmtDTLocal(day, enT[1]))
        lines.push('SUMMARY:' + escText(c.name))
        if (t.room) lines.push('LOCATION:' + escText(t.room))
        lines.push('DESCRIPTION:' + escText(descParts.join('；')))
        lines.push('END:VEVENT')
        count++
      }
    }
  }
  if (!count) return ''
  lines.push('END:VCALENDAR')
  const folded = []
  for (const l of lines) folded.push(...foldLine(l))
  return folded.join('\r\n') + '\r\n'
}

/* ---------- 下节课（时钟悬浮条联动用） ---------- */

/**
 * 计算「今天接下来要上的课」。学期起点无效或非本学期/已过时间返回 null。
 * @returns {null | { name, room, at: Date, section }}
 */
export function nextClassInfo(courses, semStartStr, now = new Date()) {
  if (!semStartStr) return null
  const sem = mondayOf(new Date(semStartStr))
  if (isNaN(sem)) return null
  const week = Math.round((mondayOf(now) - sem) / (7 * 864e5)) + 1
  if (week < 1 || week > 30) return null
  const weekday = ((now.getDay() + 6) % 7) + 1
  let best = null
  for (const c of courses) {
    for (const t of parseCourseTimes(c)) {
      if (t.weekday !== weekday || !t.weeks.has(week)) continue
      const hm = CLASS_TIMES[t.start]
      if (!hm) continue
      const [h, m] = hm[0].split(':').map(Number)
      const at = new Date(now)
      at.setHours(h, m, 0, 0)
      if (at <= now) continue
      if (!best || at < best.at) best = { name: c.name, room: t.room || '', at, section: t.start }
    }
  }
  return best
}
