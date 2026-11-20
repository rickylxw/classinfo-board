package io.github.rickylxw.classinfoboard.data

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.rickylxw.classinfoboard.MainActivity
import io.github.rickylxw.classinfoboard.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/* 常驻状态栏通知（音乐播放器式卡片）：下节课 + 实时倒计时（系统 Chronometer 控件自己走秒，
 * 不耗电不需要进程活着）+ 教学周 + 待办数。setOngoing 防误滑，Importance LOW 静默更新。
 * 内容数据来自 WidgetSync 快照；Reminders 闹钟与 App 内变化都会触发 updateIfEnabled。 */

object StatusBar {
    const val CHANNEL = "status"
    const val NOTIF_ID = 3001
    const val ACTION_HIDE = "io.github.rickylxw.classinfoboard.STATUS_HIDE"

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "常驻课表卡片", NotificationManager.IMPORTANCE_LOW)
            )   // LOW = 静默显示在通知栏，不打扰
        }
    }

    /** 按 Prefs.statusBarOn 显示/隐藏；数据变化处直接调这个 */
    fun updateIfEnabled(ctx: Context) {
        if (Prefs.statusBarOn && Prefs.loggedIn) {
            if (ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                ensureChannel(ctx)
                show(ctx)
                return
            }
        }
        hide(ctx)
    }

    private fun show(ctx: Context) {
        val snap = WidgetSync.load(ctx)
        val now = System.currentTimeMillis()
        val week = snap.weekNo?.let { "第 $it 教学周" } ?: ""
        val pending = "📝 待办 ${snap.pending} 项"

        val views = RemoteViews(ctx.packageName, R.layout.notif_status_bar)
        val next = snap.today.firstOrNull { it.at > now }
        if (next != null) {
            views.setTextViewText(R.id.n_title, "下节课：" + next.name)
            val room = if (next.room.isNotBlank()) " @" + next.room else ""
            views.setTextViewText(R.id.n_meta, "第${next.section}节 · " + fmtTime(next.at) + room + (if (week.isNotBlank()) " · $week" else ""))
            // 实时倒计时：Chronometer 系统控件自己走秒，进程不活也走
            views.setViewVisibility(R.id.n_countdown, android.view.View.VISIBLE)
            views.setChronometerCountDown(R.id.n_countdown, true)
            views.setChronometer(R.id.n_countdown, SystemClock.elapsedRealtime() + (next.at - now), null, true)
            views.setTextViewText(R.id.n_tail, pending)
        } else {
            views.setTextViewText(
                R.id.n_title,
                if (snap.today.isEmpty()) "今天没有课" else "今日课程已结束 · 共 ${snap.today.size} 节"
            )
            views.setViewVisibility(R.id.n_countdown, android.view.View.GONE)
            views.setTextViewText(R.id.n_meta, week.ifBlank { "课程信息板" })
            views.setTextViewText(R.id.n_tail, pending)
        }

        val open = PendingIntent.getActivity(
            ctx, 0, Intent(ctx, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val hide = PendingIntent.getBroadcast(
            ctx, 3002, Intent(ctx, io.github.rickylxw.classinfoboard.BootReceiver::class.java).setAction(ACTION_HIDE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setCustomContentView(views)
            .setCustomBigContentView(views)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(open)
            .addAction(0, "打开应用", open)
            .addAction(0, "收起卡片", hide)
            .build()

        runCatching { NotificationManagerCompat.from(ctx).notify(NOTIF_ID, n) }
    }

    fun hide(ctx: Context) {
        NotificationManagerCompat.from(ctx).cancel(NOTIF_ID)
    }

    private fun fmtTime(epochMs: Long): String =
        SimpleDateFormat("HH:mm", Locale.CHINA).format(Date(epochMs))
}
