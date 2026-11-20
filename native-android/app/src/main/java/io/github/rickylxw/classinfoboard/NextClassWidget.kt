package io.github.rickylxw.classinfoboard

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import io.github.rickylxw.classinfoboard.data.WidgetSync

/* 「下节课」桌面小组件：桌面时钟（悬浮时钟）的安卓形态。
 * 数据来自 WidgetSync 快照（App 进程死了也能渲染）；刷新策略：
 *   1) App 内数据变化 → WidgetSync.push 立即刷
 *   2) 系统每 30 分钟兜底（updatePeriodMillis）
 *   3) AlarmManager 在「下一节课开始 +1 分钟」定点刷（倒计时文案过期前） */

class NextClassWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) renderOne(ctx, mgr, id)
        scheduleAlarm(ctx)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            val mgr = context.getSystemService(AppWidgetManager::class.java) ?: return
            val ids = mgr.getAppWidgetIds(ComponentName(context, NextClassWidget::class.java))
            for (id in ids) renderOne(context, mgr, id)
            scheduleAlarm(context)
        }
    }

    companion object {
        const val ACTION_REFRESH = "io.github.rickylxw.classinfoboard.WIDGET_REFRESH"
        private const val ALARM_RC = 1001

        fun renderOne(ctx: Context, mgr: AppWidgetManager, id: Int) {
            val snap = WidgetSync.load(ctx)
            val now = System.currentTimeMillis()
            var alarmAt = now + 30 * 60_000L

            var title: String
            var line2: String
            if (!snap.loggedIn) {
                title = "课程信息板"; line2 = "点按打开并登录"
            } else {
                val next = snap.today.firstOrNull { it.at > now }
                when {
                    next != null -> {
                        val mins = Math.max(1, Math.round((next.at - now) / 60000.0))
                        title = "下节课：" + next.name
                        line2 = (if (next.room.isNotBlank()) "@" + next.room + " · " else "") +
                            fmtTime(next.at) + " · 第" + next.section + "节 · 还有 " +
                            (if (mins < 60) mins.toString() + " 分钟" else (mins / 60).toString() + " 小时 " + (mins % 60) + " 分")
                        alarmAt = next.at + 60_000
                    }
                    snap.today.isNotEmpty() -> {
                        title = "今日课程已结束"
                        line2 = "共 ${snap.today.size} 节 · 明天见"
                    }
                    else -> {
                        title = "今天没有课"
                        line2 = snap.weekNo?.let { "第 $it 教学周" } ?: "点按查看课表"
                    }
                }
            }
            val line3 = listOf(
                snap.weekNo?.let { "第 $it 教学周" },
                "📝 待办 ${snap.pending} 项"
            ).filterNotNull().joinToString(" · ")

            val open = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            val views = RemoteViews(ctx.packageName, R.layout.widget_next_class).apply {
                setTextViewText(R.id.w_title, title)
                setTextViewText(R.id.w_line2, line2)
                setTextViewText(R.id.w_line3, line3)
                setOnClickPendingIntent(R.id.widget_root, open)
            }
            mgr.updateAppWidget(id, views)
            scheduleAlarmAt(ctx, alarmAt)
        }

        private fun scheduleAlarm(ctx: Context) {
            val snap = WidgetSync.load(ctx)
            val trigger = snap.today.firstOrNull { it.at > now() }?.at?.plus(60_000) ?: (now() + 30 * 60_000L)
            scheduleAlarmAt(ctx, trigger)
        }

        private fun scheduleAlarmAt(ctx: Context, triggerAt: Long) {
            val am = ctx.getSystemService(AlarmManager::class.java) ?: return
            val pi = PendingIntent.getBroadcast(
                ctx, ALARM_RC,
                Intent(ctx, NextClassWidget::class.java).setAction(ACTION_REFRESH),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            // 非精确闹钟即可：组件文案晚几分钟刷新无伤大雅，且不申请精确闹钟权限
            am.setAndAllowWhileIdle(AlarmManager.RTC, triggerAt, pi)
        }

        private fun now() = System.currentTimeMillis()
        private val timeFmt = java.text.SimpleDateFormat("HH:mm", java.util.Locale.CHINA)
        private fun fmtTime(epochMs: Long): String = timeFmt.format(java.util.Date(epochMs))
    }
}
