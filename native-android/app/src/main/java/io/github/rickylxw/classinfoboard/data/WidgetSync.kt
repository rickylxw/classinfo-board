package io.github.rickylxw.classinfoboard.data

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.LocalDateTime
import java.time.ZoneId

/* 桌面小组件数据桥：Repo 每次变化后把「今天课程 + 教学周 + 待办数」快照写进
 * SharedPreferences（App 进程被杀后组件仍可独立渲染），并立即推送组件刷新。 */

@Serializable
data class WidgetTodayClass(
    val name: String,
    val room: String = "",
    val at: Long,          // epoch millis（上课）
    val section: Int,
    val end: Long = 0      // epoch millis（下课；0=未知，旧快照兼容）
)

@Serializable
data class WidgetDeadline(
    val id: String,
    val title: String,
    val course: String,
    val at: Long          // epoch millis
)

@Serializable
data class WidgetSnapshot(
    val loggedIn: Boolean = true,
    val today: List<WidgetTodayClass> = emptyList(),
    val deadlines: List<WidgetDeadline> = emptyList(),   // 未完成且有截止时间的待办（≤12 条，提醒通知用）
    val weekNo: Int? = null,
    val pending: Int = 0,
    val updatedAt: Long = 0
)

object WidgetSync {
    private val json = Json { ignoreUnknownKeys = true }

    fun build(): WidgetSnapshot {
        val d = Repo.data
        val sem = Repo.semStart
        val now = LocalDateTime.now()
        val t = if (d != null && Prefs.loggedIn) todayClasses(d.courses, sem, now) else emptyList()
        val dls = if (d != null && Prefs.loggedIn) {
            pendingItems(d, Repo.syncMap).mapNotNull { p ->
                val t2 = p.deadline?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() }
                    ?: return@mapNotNull null
                WidgetDeadline(p.id, p.title, p.courseName, t2.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli())
            }.sortedBy { it.at }.take(12)
        } else emptyList()
        return WidgetSnapshot(
            loggedIn = Prefs.loggedIn,
            today = t.map { c ->
                WidgetTodayClass(
                    c.name, c.room,
                    c.at.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(),
                    c.section,
                    c.endAt?.atZone(ZoneId.systemDefault())?.toInstant()?.toEpochMilli() ?: 0L
                )
            },
            deadlines = dls,
            weekNo = sem?.let { weekNumberOf(now.toLocalDate(), it) },
            pending = if (d != null) pendingItems(d, Repo.syncMap).size else 0,
            updatedAt = System.currentTimeMillis()
        )
    }

    /** Repo 变化后调用：写快照 + 推送所有组件立即刷新 */
    fun saveCurrent() {
        val ctx = Prefs.appCtx ?: return
        Prefs.widgetSnapshot = json.encodeToString(build())
        push(ctx)
    }

    fun load(ctx: Context): WidgetSnapshot {
        Prefs.widgetSnapshot?.let { s ->
            runCatching { return json.decodeFromString<WidgetSnapshot>(s) }
        }
        return WidgetSnapshot(loggedIn = Prefs.loggedIn)
    }

    fun push(ctx: Context) {
        val mgr = ctx.getSystemService(AppWidgetManager::class.java)
        if (mgr != null) {
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, io.github.rickylxw.classinfoboard.NextClassWidget::class.java))
            if (ids != null && ids.isNotEmpty()) {
                for (id in ids) io.github.rickylxw.classinfoboard.NextClassWidget.renderOne(ctx, mgr, id)
            }
        }
        StatusBar.updateIfEnabled(ctx)   // 常驻状态栏卡片跟随数据变化
    }
}
