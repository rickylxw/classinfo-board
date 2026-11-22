package io.github.rickylxw.classinfoboard.data

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.rickylxw.classinfoboard.MainActivity
import io.github.rickylxw.classinfoboard.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/* 常驻媒体胶囊（音乐播放器同款机制）：MediaSession + MediaStyle 通知。
 * Android 14+/Pixel 会在状态栏顶部正中显示媒体胶囊（专辑图+波形），
 * 其他机型显示为通知栏媒体卡片/锁屏播放器——都是系统级「正在播放」位。
 * 内容 = 下节课 + 实时倒计时（Chronometer 系统控件自己走秒）+ 教学周 + 待办数。 */

object StatusBar {
    const val CHANNEL = "status"
    const val NOTIF_ID = 3001
    const val ACTION_HIDE = "io.github.rickylxw.classinfoboard.STATUS_HIDE"

    private var session: MediaSession? = null
    private var artCache: Bitmap? = null
    private val timeFmt = SimpleDateFormat("HH:mm", Locale.CHINA)
    private val ddlFmt = SimpleDateFormat("M/d HH:mm", Locale.CHINA)

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "常驻课表卡片", NotificationManager.IMPORTANCE_LOW)
            )   // LOW = 静默显示，不打扰
        }
    }

    /** 专辑图：品牌渐变 + 📚（Canvas 现画，进程内缓存） */
    private fun art(): Bitmap {
        artCache?.let { return it }
        val s = 256
        val bmp = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(0f, 0f, s.toFloat(), s.toFloat(),
                Color.rgb(0x54, 0x57, 0xE5), Color.rgb(0x42, 0x45, 0xCF), Shader.TileMode.CLAMP)
        }
        c.drawRect(0f, 0f, s.toFloat(), s.toFloat(), p)
        p.colorFilter = null; p.shader = null; p.color = Color.WHITE
        p.textSize = 120f; p.textAlign = Paint.Align.CENTER
        val fm = p.fontMetrics
        c.drawText("📚", s / 2f, s / 2f - (fm.ascent + fm.descent) / 2f, p)
        artCache = bmp
        return bmp
    }

    private fun mediaSession(ctx: Context): MediaSession {
        session?.let { return it }
        val s = MediaSession(ctx, "ClassinfoStatusBar")
        s.setActive(true)
        session = s
        return s
    }

    /** 按 Prefs.statusBarOn 显示/隐藏；数据变化处直接调这个 */
    fun updateIfEnabled(ctx: Context) {
        if (Prefs.statusBarOn && Prefs.loggedIn &&
            ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
            == android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            ensureChannel(ctx)
            show(ctx)
            return
        }
        hide(ctx)
    }

    private fun show(ctx: Context) {
        val snap = WidgetSync.load(ctx)
        val now = System.currentTimeMillis()
        // 三级「播放态」：正在上课 > 下节课 > 最近 DDL；都没有才退回普通常驻卡
        val inProgress = snap.today.firstOrNull { it.end > 0 && it.at <= now && it.end > now }
        val next = snap.today.firstOrNull { it.at > now }
        val ddl = snap.deadlines.firstOrNull { it.at > now }
        val week = snap.weekNo?.let { "第 $it 教学周" } ?: ""
        val pending = "📝 待办 ${snap.pending} 项"

        val open = PendingIntent.getActivity(
            ctx, 0, Intent(ctx, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val hide = PendingIntent.getBroadcast(
            ctx, 3002, Intent(ctx, io.github.rickylxw.classinfoboard.BootReceiver::class.java).setAction(ACTION_HIDE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(open)

        var refreshAt = now + 30 * 60_000L

        fun enterPlaying(title: String, meta: String, album: String, countdownTo: Long) {
            val ms = mediaSession(ctx)
            ms.setMetadata(
                MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, meta)
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                    .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art())
                    .build()
            )
            ms.setPlaybackState(
                PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_STOP)
                    .setState(PlaybackState.STATE_PLAYING, 0, 1f)
                    .build()
            )
            b.setContentTitle(title)
            b.setContentText(meta)
            b.setSubText(pending)
            // 实时倒计时（系统 Chronometer 走秒，通知自己倒数到目标时刻）
            b.setUsesChronometer(true)
            b.setChronometerCountDown(true)
            b.setWhen(countdownTo)
            b.setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(android.support.v4.media.session.MediaSessionCompat.Token.fromToken(ms.sessionToken))
                    .setShowActionsInCompactView(0)
            )
            b.addAction(0, "打开应用", open)
            b.addAction(0, "收起卡片", hide)
        }

        fun exitPlaying(title: String, text: String) {
            session?.setPlaybackState(
                PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_STOP)
                    .setState(PlaybackState.STATE_STOPPED, 0, 1f)
                    .build()
            )
            b.setContentTitle(title)
            b.setContentText(text)
            b.addAction(0, "打开应用", open)
            b.addAction(0, "收起卡片", hide)
        }

        when {
            inProgress != null -> {
                val room = if (inProgress.room.isNotBlank()) " @${inProgress.room}" else ""
                enterPlaying(
                    "正在上：" + inProgress.name,
                    "第${inProgress.section}节 · 到 " + timeFmt.format(Date(inProgress.end)) + room,
                    week.ifBlank { "课程信息板" },
                    inProgress.end
                )
                refreshAt = inProgress.end + 60_000   // 下课后立刻换卡（下一节/DDL/退出）
            }
            next != null -> {
                val room = if (next.room.isNotBlank()) " @${next.room}" else ""
                enterPlaying(
                    "下节课：" + next.name,
                    "第${next.section}节 · " + timeFmt.format(Date(next.at)) + room,
                    week.ifBlank { "课程信息板" },
                    next.at
                )
                refreshAt = next.at + 60_000          // 上课后立刻切「正在上」
            }
            ddl != null -> {
                enterPlaying(
                    "⏰ DDL：" + ddl.title,
                    ddl.course + " · 截止 " + ddlFmt.format(Date(ddl.at)),
                    week.ifBlank { "课程信息板" },
                    ddl.at
                )
                refreshAt = ddl.at + 60_000           // 到期后立刻切下一项/退出
            }
            else -> {
                exitPlaying(
                    if (snap.today.isEmpty()) "今天没有课" else "今日课程已结束 · 共 ${snap.today.size} 节",
                    listOf(week, pending).filter { it.isNotBlank() }.joinToString(" · ")
                )
            }
        }

        runCatching { NotificationManagerCompat.from(ctx).notify(NOTIF_ID, b.build()) }
        // 倒计时结束后定点刷新（下一节/DDL/退出播放态），不用干等 30 分钟兜底
        Reminders.scheduleAlarmAt(ctx, refreshAt)
    }

    fun hide(ctx: Context) {
        NotificationManagerCompat.from(ctx).cancel(NOTIF_ID)
        session?.setActive(false)
        session?.release()
        session = null
    }
}
