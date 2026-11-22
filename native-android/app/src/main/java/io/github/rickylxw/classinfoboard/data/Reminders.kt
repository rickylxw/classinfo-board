package io.github.rickylxw.classinfoboard.data

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.rickylxw.classinfoboard.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/* DDL / 下节课 本地提醒：数据来自 WidgetSync 快照（进程被杀也能查），
 * AlarmManager 每 30 分钟兜底 + App 启动即查；去重 key 记在 prefs（7 天过期）。 */

object Reminders {
    const val CHANNEL = "reminders"
    const val PERMISSION = Manifest.permission.POST_NOTIFICATIONS
    private const val ALARM_RC = 2002
    const val ACTION_CHECK = "io.github.rickylxw.classinfoboard.REMINDER_CHECK"

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "作业与上课提醒", NotificationManager.IMPORTANCE_DEFAULT)
            )
        }
    }

    fun canNotify(ctx: Context): Boolean =
        Prefs.remindersOn &&
            ContextCompat.checkSelfPermission(ctx, PERMISSION) == PackageManager.PERMISSION_GRANTED &&
            NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    fun scheduleAlarm(ctx: Context) {
        scheduleAlarmAt(ctx, System.currentTimeMillis() + 30 * 60_000L)
    }

    /** 定点检查（倒计时到期后精确刷新媒体胶囊/小组件；与 30 分钟循环闹钟共用同一 PendingIntent 槽） */
    fun scheduleAlarmAt(ctx: Context, triggerAt: Long) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val pi = PendingIntent.getBroadcast(
            ctx, ALARM_RC, Intent(ctx, io.github.rickylxw.classinfoboard.ReminderReceiver::class.java)
                .setAction(ACTION_CHECK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        am.setAndAllowWhileIdle(AlarmManager.RTC, triggerAt, pi)
    }

    fun cancelAlarm(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        am.cancel(
            PendingIntent.getBroadcast(
                ctx, ALARM_RC, Intent(ctx, io.github.rickylxw.classinfoboard.ReminderReceiver::class.java)
                    .setAction(ACTION_CHECK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
        )
    }

    fun checkAndNotify(ctx: Context) {
        if (!Prefs.loggedIn || !Prefs.remindersOn) return
        if (ContextCompat.checkSelfPermission(ctx, PERMISSION) != PackageManager.PERMISSION_GRANTED) return
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
        ensureChannel(ctx)

        val snap = WidgetSync.load(ctx)
        val now = System.currentTimeMillis()
        val notified = JSONObject(Prefs.notifiedKeys)
        val fmt = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA)
        fun prune() {
            val keys = notified.keys()
            val dead = mutableListOf<String>()
            while (keys.hasNext()) {
                val k = keys.next()
                if (now - notified.optLong(k, 0) > 7 * 864e5) dead.add(k)
            }
            dead.forEach { notified.remove(it) }
        }
        fun fire(key: String, idTag: String, title: String, text: String) {
            if (notified.has(key)) return
            notified.put(key, now)
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(
                    PendingIntent.getActivity(
                        ctx, idTag.hashCode(),
                        Intent(ctx, io.github.rickylxw.classinfoboard.MainActivity::class.java),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                    )
                )
                .build()
            NotificationManagerCompat.from(ctx).notify(idTag.hashCode(), n)
        }

        // DDL：截止前 24h 内提醒一次「明天/即将截止」；过期 6h 内提醒一次「已到截止」
        for (d in snap.deadlines) {
            val diff = d.at - now
            if (diff in 0..(24 * 3600_000L)) {
                fire("ddl24:" + d.id, "ddl" + d.id,
                    "⏰ 「${d.title}」即将截止",
                    "${d.course} · 截止 ${fmt.format(Date(d.at))}" + if (diff < 2 * 3600_000L) "（不到 2 小时）" else "")
            } else if (-diff in 0..(6 * 3600_000L)) {
                fire("ddl0:" + d.id, "ddl" + d.id,
                    "⏰ 「${d.title}」已到截止时间",
                    "${d.course} · 截止 ${fmt.format(Date(d.at))}，如果还没提交请尽快")
            }
        }

        // 下节课：开始前 15 分钟内提醒一次（按 日期+节次 去重）
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(Date(now))
        for (c in snap.today) {
            val diff = c.at - now
            if (diff in 0..(15 * 60_000L)) {
                val mins = Math.max(1, Math.round(diff / 60000.0))
                fire("cls:$day:${c.section}", "cls$day${c.section}",
                    "🔔 约 $mins 分钟后上课" + if (c.room.isNotBlank()) " @${c.room}" else "",
                    "${c.name} · 第${c.section}节 · ${fmt.format(Date(c.at))} 开始")
            }
        }

        prune()
        Prefs.notifiedKeys = notified.toString()

        // 常驻状态栏卡片跟着快照刷新（30 分钟闹钟兜底，倒计时由 Chronometer 自己走）
        StatusBar.updateIfEnabled(ctx)
    }

    /** 主线程触发后台检查（App 启动 / 闹钟） */
    fun checkAsync(ctx: Context) {
        CoroutineScope(Dispatchers.Default).launch { checkAndNotify(ctx) }
    }
}
