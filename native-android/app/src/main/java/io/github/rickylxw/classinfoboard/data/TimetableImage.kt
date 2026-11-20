package io.github.rickylxw.classinfoboard.data

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/* 课表周视图 → PNG 位图（Canvas 直接绘制，3 倍超采样；浅色主题，适合分享）。
 * 网格结构与 App 内日程页一致：节次列 + 7 天列，跨节次课块，今日列高亮。 */

object TimetableImage {
    private const val S = 3                       // 3x 超采样
    private const val PERIOD_W = 26 * S
    private const val DAY_W = 76 * S
    private const val SLOT_H = 42 * S
    private const val HEADER_H = 40 * S
    private const val TITLE_H = 30 * S

    private val GRID = Color.rgb(0xD3, 0xD8, 0xE2)
    private val HEAD_BG = Color.rgb(0xF6, 0xF7, 0xFA)
    private val TEXT = Color.rgb(0x1C, 0x24, 0x34)
    private val MUTED = Color.rgb(0x8A, 0x93, 0xA5)
    private val ACCENT = Color.rgb(0x54, 0x57, 0xE5)

    private fun wrap(paint: Paint, text: String, maxW: Float, maxLines: Int): List<String> {
        val out = mutableListOf<String>()
        var cur = StringBuilder()
        for (ch in text) {
            if (cur.isNotEmpty() && paint.measureText(cur.toString() + ch) > maxW) {
                out.add(cur.toString()); cur = StringBuilder()
                if (out.size == maxLines) return out
            }
            cur.append(ch)
        }
        if (cur.isNotEmpty()) out.add(cur.toString())
        return out
    }

    /** 绘制一周课表位图。slots 建议来自 weekSlots(courses, weekNo)；todayIdx 0=不高亮 */
    fun buildWeek(
        slots: List<WeekSlot>,
        monday: LocalDate,
        weekNo: Int?,
        todayIdx: Int
    ): Bitmap {
        val wd = arrayOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")
        val w = PERIOD_W + 7 * DAY_W
        val h = TITLE_H + HEADER_H + 13 * SLOT_H
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(Color.WHITE)

        val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = GRID; strokeWidth = S.toFloat() }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)

        // 标题条
        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = TEXT; textSize = 13f * S; typeface = Typeface.DEFAULT_BOLD
        }
        val subPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = MUTED; textSize = 10f * S }
        val weekText = weekNo?.let { "第 $it 教学周" } ?: ""
        val range = "${monday.monthValue}/${monday.dayOfMonth} - ${monday.plusDays(6).monthValue}/${monday.plusDays(6).dayOfMonth}"
        c.drawText("课程信息板", 12f * S, TITLE_H * 0.62f, titlePaint)
        val t2 = listOf(weekText, range).filter { it.isNotBlank() }.joinToString(" · ")
        c.drawText(t2, w - 12f * S - subPaint.measureText(t2), TITLE_H * 0.62f, subPaint)

        // 表头
        for (i in 0..6) {
            val x = PERIOD_W + i * DAY_W
            val isToday = i + 1 == todayIdx
            fill.color = if (isToday) Color.rgb(0xEE, 0xF0, 0xFE) else HEAD_BG
            c.drawRect(x.toFloat(), TITLE_H.toFloat(), (x + DAY_W).toFloat(), (TITLE_H + HEADER_H).toFloat(), fill)
            val namePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = if (isToday) ACCENT else TEXT
                textSize = 11f * S; typeface = Typeface.DEFAULT_BOLD; textAlign = Paint.Align.CENTER
            }
            val datePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = if (isToday) ACCENT else MUTED
                textSize = 9f * S; textAlign = Paint.Align.CENTER
            }
            val cx = x + DAY_W / 2f
            c.drawText(wd[i] + if (isToday) " · 今" else "", cx, TITLE_H + 16f * S, namePaint)
            c.drawText(monday.plusDays(i.toLong()).format(DateTimeFormatter.ofPattern("M/d")), cx, TITLE_H + 32f * S, datePaint)
        }

        // 节次列 + 网格线
        val periodPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = MUTED; textSize = 9f * S; textAlign = Paint.Align.CENTER
        }
        fill.color = HEAD_BG
        c.drawRect(0f, TITLE_H.toFloat(), PERIOD_W.toFloat(), h.toFloat(), fill)
        for (p in 1..13) {
            val y = (TITLE_H + p * SLOT_H).toFloat()
            c.drawLine(0f, y, w.toFloat(), y, line)
            c.drawText("$p", PERIOD_W / 2f, TITLE_H + (p - 0.5f) * SLOT_H + 3f * S, periodPaint)
        }
        for (i in 0..7) {
            val x = (PERIOD_W + i * DAY_W).toFloat()
            c.drawLine(x, TITLE_H.toFloat(), x, h.toFloat(), line)
        }

        // 课程块
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = TEXT; textSize = 9.5f * S; typeface = Typeface.DEFAULT_BOLD
        }
        val roomPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = MUTED; textSize = 8f * S }
        for (s in slots) {
            val stT = CLASS_TIMES[s.slot.start] ?: continue
            val enT = CLASS_TIMES[s.slot.end] ?: continue
            val span = s.slot.end - s.slot.start + 1
            val x0 = PERIOD_W + (s.slot.weekday - 1) * DAY_W + 2f * S
            val y0 = TITLE_H + (s.slot.start - 1) * SLOT_H + 2f * S
            val bw = DAY_W - 4f * S
            val bh = span * SLOT_H - 4f * S
            val col = runCatching { Color.parseColor(s.course.color ?: "#6366F1") }.getOrDefault(0xFF6366F1.toInt())
            fill.color = col
            fill.alpha = 42
            c.drawRoundRect(RectF(x0, y0, x0 + bw, y0 + bh), 4f * S, 4f * S, fill)
            fill.alpha = 255
            fill.style = Paint.Style.STROKE
            fill.strokeWidth = 1.5f * S
            c.drawRoundRect(RectF(x0, y0, x0 + bw, y0 + bh), 4f * S, 4f * S, fill)
            fill.style = Paint.Style.FILL

            // 文本：名称最多占满块高（留房间行），逐字换行
            val innerW = bw - 6f * S
            val maxLines = ((bh - 8f * S) / (12f * S)).toInt().coerceAtLeast(1)
            val lines = wrap(textPaint, s.course.name, innerW, maxLines)
            var ty = y0 + 8f * S + textPaint.textSize
            for (l in lines) {
                c.drawText(l, x0 + 3f * S, ty, textPaint)
                ty += 12f * S
            }
            if (s.slot.room.isNotBlank() && span >= 2 && ty < y0 + bh - 8f * S) {
                c.drawText("@" + s.slot.room, x0 + 3f * S, y0 + bh - 5f * S, roomPaint)
            }
        }

        // 今日列整体高亮描边
        if (todayIdx > 0) {
            val x = PERIOD_W + (todayIdx - 1) * DAY_W
            line.color = ACCENT
            line.strokeWidth = 2f * S
            c.drawRect(x.toFloat(), TITLE_H.toFloat(), (x + DAY_W).toFloat(), h.toFloat(), line)
        }
        return bmp
    }
}
