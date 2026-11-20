package io.github.rickylxw.classinfoboard.data

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.provider.CalendarContract
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/* 直写系统日历：整学期课表逐周写入（WRITE_CALENDAR 权限需运行时请求）。
 * 形态比 web 端的 .ics 文件更进一步：导入即进日历 App，与周循环各设备自提。 */

object CalendarExporter {

    /** 优先取用户的主日历，否则第一个可见可写日历；返回 null = 没有可写日历（调用方已在 IO 协程内） */
    private fun primaryCalendarId(ctx: Context): Long? {
        return runCatching {
            val uri = CalendarContract.Calendars.CONTENT_URI
            ctx.contentResolver.query(
                uri, arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.IS_PRIMARY,
                    CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL),
                "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ?",
                arrayOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR.toString()),
                "${CalendarContract.Calendars.IS_PRIMARY} DESC, ${CalendarContract.Calendars._ID} ASC"
            )?.use { c -> if (c.moveToFirst()) c.getLong(0) else null }
        }.getOrNull()
    }

    /**
     * 全部课程 × 时段 × 活跃周写入系统日历（事件自带 UID 语义：以自定义属性保存，简单起见
     * 与 .ics 相同的 uid 放 DESCRIPTION 尾部；重复导入会产生重复事件，所以先按前缀清理旧事件）。
     * @return 成功写入条数；-1 = 没有可写日历
     */
    suspend fun importTimetable(
        ctx: Context,
        courses: List<Course>,
        semStartStr: String?,
        semName: String = "课表"
    ): Int = withContext(Dispatchers.IO) {
        if (semStartStr.isNullOrBlank()) return@withContext 0
        val calId = primaryCalendarId(ctx) ?: return@withContext -1
        val sem = runCatching { mondayOf(java.time.LocalDate.parse(semStartStr)) }.getOrNull() ?: return@withContext 0
        val tz = "Asia/Shanghai"
        val cr = ctx.contentResolver

        // 幂等：先删掉本应用此前导入的课表事件（DESCRIPTION 前缀识别），避免重复堆积
        runCatching {
            cr.delete(
                CalendarContract.Events.CONTENT_URI,
                "${CalendarContract.Events.DESCRIPTION} LIKE ?",
                arrayOf("由课程信息板导出%")
            )
        }

        var count = 0
        val ops = ArrayList<android.content.ContentProviderOperation>()
        for (c in courses) {
            for (t in parseCourseTimes(c)) {
                val stT = CLASS_TIMES[t.start] ?: continue
                val enT = CLASS_TIMES[t.end] ?: continue
                for (w in 1..30) {
                    if (!t.weeks.has(w)) continue
                    val day = sectionDate(semStartStr, w, t.weekday)
                    val startAt = day.atTime(java.time.LocalTime.parse(stT.first))
                    val endAt = day.atTime(java.time.LocalTime.parse(enT.second))
                    val zone = java.time.ZoneId.of(tz)
                    val v = ContentValues().apply {
                        put(CalendarContract.Events.CALENDAR_ID, calId)
                        put(CalendarContract.Events.TITLE, c.name)
                        put(CalendarContract.Events.EVENT_LOCATION, t.room)
                        put(CalendarContract.Events.DESCRIPTION,
                            "由课程信息板导出 · 第${w}周 第${t.start}-${t.end}节" +
                                (c.teacher?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""))
                        put(CalendarContract.Events.DTSTART, startAt.atZone(zone).toInstant().toEpochMilli())
                        put(CalendarContract.Events.DTEND, endAt.atZone(zone).toInstant().toEpochMilli())
                        put(CalendarContract.Events.EVENT_TIMEZONE, tz)
                        put(CalendarContract.Events.AVAILABILITY, CalendarContract.Events.AVAILABILITY_FREE)
                    }
                    ops.add(android.content.ContentProviderOperation
                        .newInsert(CalendarContract.Events.CONTENT_URI).withValues(v).build())
                    count++
                }
            }
        }
        if (ops.isEmpty()) return@withContext 0
        val applied = runCatching { cr.applyBatch(CalendarContract.AUTHORITY, ops) }.isSuccess
        if (!applied) return@withContext -1
        count
    }

    val PERMISSION = Manifest.permission.WRITE_CALENDAR
}
