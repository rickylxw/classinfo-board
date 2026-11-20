package io.github.rickylxw.classinfoboard.data

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/* 课表 → .ics 导出：移植自 web 端 src/ics.js（含 RFC5545 行折叠、UID 稳定可重复导入）。
 * 安卓侧另加直写系统日历的通道（见 CalendarExporter），这里负责 .ics 分享导出与校验。 */

private val F_COMPACT = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss")
private val F_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd")

private fun escText(s: String?): String = (s ?: "")
    .replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n")

/** RFC5545：每行 ≤75 字节（UTF-8），续行以空格开头 */
private fun foldLine(line: String): List<String> {
    val bytes = line.toByteArray(Charsets.UTF_8)
    if (bytes.size <= 75) return listOf(line)
    val out = mutableListOf<String>()
    val cur = StringBuilder()
    var len = 0
    for (ch in line) {
        val cb = ch.toString().toByteArray(Charsets.UTF_8).size
        if (len + cb > (if (out.isEmpty()) 75 else 74)) {
            out.add(cur.toString()); cur.setLength(0); len = 0
        }
        cur.append(ch); len += cb
    }
    if (cur.isNotEmpty()) out.add(cur.toString())
    return out.mapIndexed { i, l -> if (i == 0) l else " " + l }
}

private fun normId(s: String?): String = (s ?: "").lowercase().replace(Regex("[^a-z0-9]+"), "")

/**
 * 整学期课表 .ics 文本：每门课 × 时段 × 活跃周一条 VEVENT（UID 稳定，重复导入不重）。
 * 学期起点无效或没有任何可解析时段时返回空串。
 */
fun buildSemesterICS(
    courses: List<Course>,
    semStartStr: String?,
    calendarName: String = "东南课表"
): String {
    if (semStartStr.isNullOrBlank()) return ""
    val sem = runCatching { mondayOf(LocalDate.parse(semStartStr)) }.getOrNull() ?: return ""

    val stamp = LocalDateTime.now().format(F_COMPACT)
    val lines = mutableListOf(
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//classinfo-board//schedule-ics//CN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:" + escText(calendarName),
        "X-WR-TIMEZONE:Asia/Shanghai",
        "BEGIN:VTIMEZONE",
        "TZID:Asia/Shanghai",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:+0800",
        "TZOFFSETTO:+0800",
        "TZNAME:CST",
        "END:STANDARD",
        "END:VTIMEZONE"
    )
    var count = 0
    for (c in courses) {
        for (t in parseCourseTimes(c)) {
            val stT = CLASS_TIMES[t.start] ?: continue
            val enT = CLASS_TIMES[t.end] ?: continue
            for (w in 1..30) {
                if (!t.weeks.has(w)) continue
                val day = sem.plusDays(((w - 1) * 7 + (t.weekday - 1)).toLong())
                val tid = normId(c.name).ifEmpty { "course" }
                val uid = "clb-$tid" + (normId(c.teacher).takeIf { it.isNotEmpty() }?.let { "-$it" } ?: "") +
                    "-d${t.weekday}-p${t.start}-w$w@classinfo-board"
                val desc = listOf(
                    "由课程信息板导出",
                    c.teacher?.takeIf { it.isNotBlank() }?.let { "教师：$it" },
                    "第${w}周 · 第${t.start}-${t.end}节"
                ).filterNotNull().joinToString("；")
                lines.add("BEGIN:VEVENT")
                lines.add("UID:$uid")
                lines.add("DTSTAMP:$stamp")
                lines.add("DTSTART;TZID=Asia/Shanghai:" + day.atTime(java.time.LocalTime.parse(stT.first)).format(F_COMPACT))
                lines.add("DTEND;TZID=Asia/Shanghai:" + day.atTime(java.time.LocalTime.parse(enT.second)).format(F_COMPACT))
                lines.add("SUMMARY:" + escText(c.name))
                if (t.room.isNotBlank()) lines.add("LOCATION:" + escText(t.room))
                lines.add("DESCRIPTION:" + escText(desc))
                lines.add("END:VEVENT")
                count++
            }
        }
    }
    if (count == 0) return ""
    lines.add("END:VCALENDAR")
    val folded = mutableListOf<String>()
    for (l in lines) folded.addAll(foldLine(l))
    return folded.joinToString("\r\n") + "\r\n"
}

/** 节次开始时间的 LocalDate 处于教学周内的日期（日历写入用） */
fun sectionDate(semStartStr: String, week: Int, weekday: Int): LocalDate {
    val sem = mondayOf(LocalDate.parse(semStartStr))
    return sem.plusDays(((week - 1) * 7 + (weekday - 1)).toLong())
}
