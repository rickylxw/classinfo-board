package io.github.rickylxw.classinfoboard.data

/* 业务合并逻辑：把「我的作业 + 个人待办 + 班级同步」合成待办流（对齐 Dashboard.vue 的口径）。
 * 课程键与 web 端 utils.courseKeyOf 完全一致：norm(name) + '|' + norm(teacher) —— 键不同步不到就找不到课程。 */

data class PendingItem(
    val id: String,
    val title: String,
    val deadline: String?,       // "YYYY-MM-DDTHH:mm" 可空
    val courseId: String,        // 'personal' = 个人待办
    val courseName: String,
    val color: String?,
    val from: String?,           // null=我的作业/个人待办，否则=共享板来源（负责人名）
    val done: Boolean
)

data class DdlBadge(val text: String, val level: Int)   // level: 0 一般 1 提醒 2 紧急(今天/已逾期)

private fun norm(s: String?): String = (s ?: "").trim().lowercase().replace(Regex("\\s+"), "")

fun courseKeyOf(name: String?, teacher: String?): String = norm(name) + "|" + norm(teacher)

/* 截止徽章：对齐 utils.js ddlBadge 的展示口径（骨架版） */
fun ddlBadge(deadline: String?, done: Boolean, now: Long = System.currentTimeMillis()): DdlBadge {
    if (deadline.isNullOrBlank()) return DdlBadge(if (done) "无期限" else "无 DDL", 0)
    val t = runCatching {
        val f = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm", java.util.Locale.US)
        f.timeZone = java.util.TimeZone.getDefault()
        f.parse(deadline)?.time
    }.getOrNull() ?: return DdlBadge("时间格式?", 1)
    val diff = t - now
    return when {
        done -> DdlBadge("已完成", 0)
        diff < 0 -> DdlBadge("已逾期", 2)
        diff <= 24 * 3600e3 -> DdlBadge("今天截止", 2)
        diff <= 7 * 864e5 -> DdlBadge("${((diff + 864e5 - 1) / 864e5).toInt()} 天内截止", 1)
        else -> DdlBadge("${((diff + 864e5 - 1) / 864e5).toInt()} 天后", 0)
    }
}

fun fmtDeadline(deadline: String?): String {
    if (deadline.isNullOrBlank()) return ""
    return try {
        val f = java.text.SimpleDateFormat("MM-dd(E) HH:mm", java.util.Locale.CHINA)
        val p = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm", java.util.Locale.US)
        p.timeZone = java.util.TimeZone.getDefault()
        f.timeZone = java.util.TimeZone.getDefault()
        val d = p.parse(deadline) ?: return deadline
        f.format(d)
    } catch (_: Exception) { deadline }
}

fun fmtSize(bytes: Long): String = when {
    bytes >= 1 shl 20 -> String.format(java.util.Locale.US, "%.1f MB", bytes / 1048576.0)
    bytes >= 1024 -> String.format(java.util.Locale.US, "%.1f KB", bytes / 1024.0)
    else -> "$bytes B"
}

/* 合成待办列表：我的（含个人待办，未归档未完成）+ 班级同步（syncStatus 非 done/archived），按截止升序 */
fun pendingItems(data: CloudData, sync: Map<String, SyncBoard>): List<PendingItem> {
    val coursesById = data.courses.associateBy { it.id }
    val out = mutableListOf<PendingItem>()

    for (a in data.assignments) {
        if (a.archived || a.status == "done") continue
        val c = coursesById[a.courseId]
        out += PendingItem(
            id = "own-" + a.id,
            title = a.title,
            deadline = a.deadline,
            courseId = a.courseId,
            courseName = c?.name ?: "个人待办",
            color = c?.color ?: "#64748B",
            from = null,
            done = false
        )
    }

    for ((key, board) in sync) {
        val course = data.courses.firstOrNull { courseKeyOf(it.name, it.teacher) == key } ?: continue
        for (sa in board.assignments) {
            val st = data.syncStatus[sa.id]
            if (st == "done" || st == "archived") continue
            out += PendingItem(
                id = "sync-" + sa.id,
                title = sa.title,
                deadline = sa.deadline,
                courseId = course.id,
                courseName = course.name,
                color = course.color,
                from = board.from ?: "班级同步",
                done = false
            )
        }
    }

    return out.sortedWith(
        compareBy(nullsLast()) { it.deadline ?: "9999" }
    )
}

fun stats(data: CloudData, sync: Map<String, SyncBoard>, now: Long = System.currentTimeMillis()): Map<String, Int> {    val items = pendingItems(data, sync)
    var over = 0; var soon = 0
    for (it in items) {
        if (it.deadline.isNullOrBlank()) continue
        val t = runCatching {
            val f = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm", java.util.Locale.US)
            f.timeZone = java.util.TimeZone.getDefault()
            f.parse(it.deadline!!)?.time ?: 0L
        }.getOrDefault(0L)
        val diff = t - now
        if (diff < 0) over++
        else if (diff <= 7 * 864e5) soon++
    }
    return mapOf("courses" to data.courses.size, "over" to over, "soon" to soon, "pending" to items.size)
}
