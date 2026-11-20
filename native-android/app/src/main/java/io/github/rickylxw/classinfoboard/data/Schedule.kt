package io.github.rickylxw.classinfoboard.data

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

/* 课表解析：移植自 web 端 src/schedule.js（ehall 导入的备注格式），逻辑逐条对齐。
 * 备注（course.note）行格式：周二 · 第11-12节 · 4-6周,8周 · 教三-304 */

val WD_CN = mapOf('一' to 1, '二' to 2, '三' to 3, '四' to 4, '五' to 5, '六' to 6, '日' to 7, '天' to 7)
val WD_NAMES = arrayOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")

/** 东南大学节次时间表（教务处 2024.9.10 版，移植自 ics.js / Schedule generation） */
val CLASS_TIMES: Map<Int, Pair<String, String>> = mapOf(
    1 to ("08:00" to "08:45"), 2 to ("08:50" to "09:35"), 3 to ("09:50" to "10:35"),
    4 to ("10:40" to "11:25"), 5 to ("11:30" to "12:15"), 6 to ("14:00" to "14:45"),
    7 to ("14:50" to "15:35"), 8 to ("15:50" to "16:35"), 9 to ("16:40" to "17:25"),
    10 to ("17:30" to "18:15"), 11 to ("19:00" to "19:45"), 12 to ("19:50" to "20:35"),
    13 to ("20:40" to "21:25")
)

fun mondayOf(d: LocalDate): LocalDate = d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

/** 周次集合：{min,max,has(w)} 语义对齐 parseWeeks；支持 1-16周 / 1-13周(单) / 2,4,6周 */
class Weeks(text: String?) {
    private val set: MutableSet<Int> = mutableSetOf()
    val min: Int
    val max: Int

    init {
        var mn = Int.MAX_VALUE
        var mx = 0
        val odd = text?.contains('单') == true
        val even = text?.contains('双') == true
        val re = Regex("(\\d+)\\s*(?:-\\s*(\\d+))?\\s*周")
        for (part in (text ?: "").split(',', '，')) {
            val m = re.find(part) ?: continue
            val s = m.groupValues[1].toInt()
            val e = m.groupValues[2].takeIf { it.isNotEmpty() }?.toInt() ?: s
            for (w in s..e) {
                if (odd && w % 2 == 0) continue
                if (even && w % 2 == 1) continue
                set.add(w)
            }
            mn = minOf(mn, s); mx = maxOf(mx, e)
        }
        min = if (set.isNotEmpty()) mn else 0
        max = mx
    }

    fun has(w: Int): Boolean = set.contains(w)
}

class TimeSlot(
    val weekday: Int,        // 1..7（周一=1）
    val start: Int,          // 起始节
    val end: Int,            // 结束节（含）
    val weeks: Weeks,
    val room: String
)

private val TIME_RE = Regex("^(周[一二三四五六日天])\\s*·\\s*第\\s*(\\d+)(?:\\s*-\\s*(\\d+))?\\s*节\\s*·\\s*(.+)$")

/** 解析课程备注里的全部上课时段；无法识别的行忽略 */
fun parseCourseTimes(course: Course?): List<TimeSlot> {
    val text = course?.note ?: return emptyList()
    val out = mutableListOf<TimeSlot>()
    for (raw in text.split('\n')) {
        val m = TIME_RE.find(raw.trim()) ?: continue
        val weekday = WD_CN[m.groupValues[1][1]] ?: continue
        val start = m.groupValues[2].toInt()
        val end = m.groupValues[3].takeIf { it.isNotEmpty() }?.toInt() ?: start
        // 余下段：周次 · 教室（教室可能含 ·，取最后一段）
        val rest = m.groupValues[4].split('·').map { it.trim() }.filter { it.isNotEmpty() }
        val room = if (rest.size >= 2) rest.last() else ""
        val weeks = Weeks(rest.dropLast(1).joinToString("·").ifEmpty { rest.firstOrNull() ?: "" })
        out.add(TimeSlot(weekday, start, end, weeks, room))
    }
    return out
}

/** 该日期所在教学周（学期第一周=1）；未设学期起点或不在学期内返回 null */
fun weekNumberOf(date: LocalDate, semStart: String?): Int? {
    if (semStart.isNullOrBlank()) return null
    val sem = runCatching { mondayOf(LocalDate.parse(semStart)) }.getOrNull() ?: return null
    val diff = ChronoUnit.WEEKS.between(mondayOf(date), sem).toInt()
    val n = -diff + 1
    return if (n >= 1) n else null
}

/** 今天接下来要上的课（下节课，对齐 ics.nextClassInfo） */
fun nextClassInfo(courses: List<Course>, semStart: String?, now: LocalDateTime = LocalDateTime.now()): ClassInfo? {
    if (semStart.isNullOrBlank()) return null
    val week = weekNumberOf(now.toLocalDate(), semStart) ?: return null
    val weekday = now.dayOfWeek.value   // Mon=1..Sun=7，与 weekday 定义一致
    var best: ClassInfo? = null
    for (c in courses) {
        for (t in parseCourseTimes(c)) {
            if (t.weekday != weekday || !t.weeks.has(week)) continue
            val hm = CLASS_TIMES[t.start] ?: continue
            val at = now.toLocalDate().atTime(LocalTime.parse(hm.first))
            if (!at.isAfter(now)) continue
            if (best == null || at.isBefore(best!!.at)) {
                best = ClassInfo(c.name, t.room, at, t.start, c.color)
            }
        }
    }
    return best
}

data class ClassInfo(val name: String, val room: String, val at: LocalDateTime, val section: Int, val color: String?)

/** 一周课块：某教学周里某门课的某时段 */
data class WeekSlot(val course: Course, val slot: TimeSlot)

/** 当前周偏移对应的教学周的全部课块（学期起点未设时不过滤周次） */
fun weekSlots(courses: List<Course>, week: Int?): List<WeekSlot> {
    val out = mutableListOf<WeekSlot>()
    for (c in courses) {
        for (t in parseCourseTimes(c)) {
            if (week != null && !t.weeks.has(week)) continue
            out.add(WeekSlot(c, t))
        }
    }
    return out
}
