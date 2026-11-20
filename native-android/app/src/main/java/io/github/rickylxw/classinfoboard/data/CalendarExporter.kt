package io.github.rickylxw.classinfoboard.data

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.CalendarContract
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/* 直写系统日历：整学期课表逐周写入。
 * 权限坑：查日历账户列表（Calendars 表）要 READ_CALENDAR，写事件要 WRITE_CALENDAR——两个都要运行时请求。
 * 账户坑：不少国产手机默认没添加过任何日历账户（Calendars 表为空）——此时用
 * ACCOUNT_TYPE_LOCAL + CALLER_IS_SYNCADAPTER URI 自建一个 App 专属本地日历兜底
 * （无需任何同步账户，事件照常显示在系统日历 App 里）。 */

object CalendarExporter {
    const val PERMISSION_READ = Manifest.permission.READ_CALENDAR
    const val PERMISSION_WRITE = Manifest.permission.WRITE_CALENDAR

    private const val APP_ACCOUNT = "classinfo-board"
    private const val CAL_NAME = "课程信息板课表"

    /** 两个权限都拿到才算授权 */
    fun allGranted(result: Map<String, Boolean>): Boolean =
        result[PERMISSION_READ] == true && result[PERMISSION_WRITE] == true

    /** 自建本地日历必须走 sync-adapter 形式的 URI（携带账户参数），普通 insert 会被拒 */
    private fun localCalendarInsertUri(): Uri =
        CalendarContract.Calendars.CONTENT_URI.buildUpon()
            .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, APP_ACCOUNT)
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            .build()

    /** 可写日历：用户主日历优先；查不到（无账户/无 READ 权限）返回 null，由调用方走自建兜底 */
    private fun pickCalendarId(ctx: Context): Long? {
        return runCatching {
            ctx.contentResolver.query(
                CalendarContract.Calendars.CONTENT_URI,
                arrayOf(
                    CalendarContract.Calendars._ID,
                    CalendarContract.Calendars.IS_PRIMARY,
                    CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL
                ),
                "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ?",
                arrayOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR.toString()),
                "${CalendarContract.Calendars.IS_PRIMARY} DESC, ${CalendarContract.Calendars._ID} ASC"
            )?.use { c -> if (c.moveToFirst()) c.getLong(0) else null }
        }.getOrNull()
    }

    /** 创建 App 专属本地日历（幂等性由调用方保证：只在查无可写日历时调用一次） */
    private fun createLocalCalendar(ctx: Context): Long? = runCatching {
        val v = ContentValues().apply {
            put(CalendarContract.Calendars.NAME, CAL_NAME)
            put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, CAL_NAME)
            put(CalendarContract.Calendars.CALENDAR_COLOR, 0xFF5457E5.toInt())
            put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER)
            put(CalendarContract.Calendars.OWNER_ACCOUNT, APP_ACCOUNT)
            put(CalendarContract.Calendars.SYNC_EVENTS, 1)
            put(CalendarContract.Calendars.VISIBLE, 1)
            put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, "Asia/Shanghai")
        }
        ctx.contentResolver.insert(localCalendarInsertUri(), v)?.lastPathSegment?.toLongOrNull()
    }.getOrNull()

    /** 导出结果：written=写入条数；skipped=未产生事件的课程名；error 非空=失败原因 */
    data class ImportResult(
        val written: Int = 0,
        val skipped: List<String> = emptyList(),
        val error: String? = null
    )

    /**
     * 全部课程 × 时段 × 活跃周写入系统日历。
     * 备注里没有可识别上课时间（或节次超表）的课程会跳过并记入 skipped。
     */
    suspend fun importTimetable(
        ctx: Context,
        courses: List<Course>,
        semStartStr: String?
    ): ImportResult = withContext(Dispatchers.IO) {
        if (semStartStr.isNullOrBlank()) return@withContext ImportResult(error = "未设置「学期第一周周一」，先在日程页菜单设置")
        val calId = pickCalendarId(ctx) ?: createLocalCalendar(ctx)
            ?: return@withContext ImportResult(error = "无法创建或访问日历（检查日历权限）")
        val sem = runCatching { mondayOf(java.time.LocalDate.parse(semStartStr)) }.getOrNull()
            ?: return@withContext ImportResult(error = "学期起点格式无效，请重新设置")
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
        val skipped = mutableListOf<String>()
        val ops = ArrayList<android.content.ContentProviderOperation>()
        for (c in courses) {
            val slots = parseCourseTimes(c).filter { CLASS_TIMES[it.start] != null && CLASS_TIMES[it.end] != null }
            if (slots.isEmpty()) { skipped.add(c.name); continue }
            for (t in slots) {
                val stT = CLASS_TIMES[t.start]!!
                val enT = CLASS_TIMES[t.end]!!
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
                        put(
                            CalendarContract.Events.DESCRIPTION,
                            "由课程信息板导出 · 第${w}周 第${t.start}-${t.end}节" +
                                (c.teacher?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: "")
                        )
                        put(CalendarContract.Events.DTSTART, startAt.atZone(zone).toInstant().toEpochMilli())
                        put(CalendarContract.Events.DTEND, endAt.atZone(zone).toInstant().toEpochMilli())
                        put(CalendarContract.Events.EVENT_TIMEZONE, tz)
                        put(CalendarContract.Events.AVAILABILITY, CalendarContract.Events.AVAILABILITY_FREE)
                    }
                    ops.add(
                        android.content.ContentProviderOperation
                            .newInsert(CalendarContract.Events.CONTENT_URI).withValues(v).build()
                    )
                    count++
                }
            }
        }
        if (ops.isEmpty()) return@withContext ImportResult(0, skipped, "没有可写入的课表事件")
        val applied = runCatching { cr.applyBatch(CalendarContract.AUTHORITY, ops) }.isSuccess
        if (!applied) return@withContext ImportResult(0, skipped, "写入日历失败（系统拒绝）")
        ImportResult(count, skipped)
    }
}
