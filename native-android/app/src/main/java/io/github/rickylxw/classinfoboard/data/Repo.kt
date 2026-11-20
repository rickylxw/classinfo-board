package io.github.rickylxw.classinfoboard.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/* 全局应用状态 + 读写层：服务器权威模型（对齐 web 端 store.js）
 * 本地先改（乐观更新）→ ops 批次上云 → 用响应的权威快照回填；失败则回滚重拉。 */

object Repo {
    var data by mutableStateOf<CloudData?>(null); private set
    var syncMap by mutableStateOf<Map<String, SyncBoard>>(emptyMap()); private set
    var semStart by mutableStateOf<String?>(null); private set
    var adminMode by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var loadedOnce by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set

    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }
    private val pendingIds = mutableSetOf<String>()   // 在途删除的条目不许被权威快照带回来（对齐 pendingRemovalIds）

    fun reset() {
        data = null; syncMap = emptyMap(); semStart = null
        adminMode = false; error = ""; loadedOnce = false
        pendingIds.clear()
        WidgetSync.saveCurrent()   // 退出登录/会话失效：组件回到未登录态
    }

    suspend fun ensureLoaded(force: Boolean = false) {
        if (!Prefs.loggedIn) return
        if (loadedOnce && !force) return
        busy = true; error = ""
        try {
            val me = Api.me()
            if (me.admin) { adminMode = true; loadedOnce = true; return }
            adminMode = false
            data = Api.data()
            syncMap = runCatching { Api.sync() }.getOrDefault(emptyMap())
            val ss = runCatching { Api.semStart() }.getOrNull()?.semStart
            semStart = ss?.takeIf { it.isNotBlank() } ?: Prefs.localSemStart
            loadedOnce = true
        } catch (e: Exception) {
            val m = e.message ?: "加载失败"
            error = m
            // 会话失效：清会话让 UI 回登录页
            if (m.contains("未登录") || m.contains("401")) {
                Prefs.clearSession()
                reset()
            }
        } finally {
            busy = false
            WidgetSync.saveCurrent()   // 快照落盘 + 刷新桌面小组件
        }
    }

    suspend fun refresh() = ensureLoaded(force = true)

    suspend fun pullSync() {
        syncMap = runCatching { Api.sync() }.getOrDefault(syncMap)
    }

    /* ---------- 作业写入（契约对齐 backend /data/ops 与 src/store.js） ---------- */

    fun uid(): String = java.util.UUID.randomUUID().toString().replace("-", "").take(12)

    /** 标完成/未完成（我的作业） */
    suspend fun toggleDone(a: Assignment) {
        val b = a.copy(status = if (a.status == "done") "pending" else "done")
        mutate { it.copy(assignments = it.assignments.map { x -> if (x.id == b.id) b else x }) }
        pushOps(listOf(upsertOp(assignmentJson(b))))
    }

    /** 归档（我的作业）：从待办流收起，云端保留可在归档找回 */
    suspend fun archive(a: Assignment) {
        val b = a.copy(archived = true)
        mutate { it.copy(assignments = it.assignments.map { x -> if (x.id == b.id) b else x }) }
        pushOps(listOf(upsertOp(assignmentJson(b))))
    }

    /** 删除（我的作业）：显式 id 白名单删除 */
    suspend fun delete(a: Assignment) {
        mutate { it.copy(assignments = it.assignments.filterNot { x -> x.id == a.id }) }
        pendingIds.add(a.id)
        pushOps(listOf(buildJsonObject {
            put("op", "delete"); put("coll", "assignments")
            put("ids", JsonArray(listOf(kotlinx.serialization.json.JsonPrimitive(a.id))))
        }))
    }

    /** 添加作业（课程 id 用 'personal' 表示个人待办，与 web 端一致） */
    suspend fun add(title: String, courseId: String, deadline: String?, requirement: String = "") {
        val a = Assignment(
            id = uid(), courseId = courseId, title = title.trim(),
            deadline = deadline?.takeIf { it.isNotBlank() },
            status = "pending", requirement = requirement, archived = false
        )
        mutate { it.copy(assignments = it.assignments + a) }
        pushOps(listOf(upsertOp(assignmentJson(a))))
    }

    /** 班级同步项的个人完成状态（只影响自己，不回写共享板） */
    suspend fun setSyncStatus(id: String, status: String) {
        mutate { it.copy(syncStatus = it.syncStatus + (id to status)) }
        pushOps(listOf(buildJsonObject {
            put("op", "syncStatus")
            put("entries", buildJsonObject { put(id, status) })
        }))
    }

    suspend fun toggleSynced(id: String) {
        val cur = data?.syncStatus?.get(id)
        if (cur == "archived") return
        setSyncStatus(id, if (cur == "done") "pending" else "done")
    }

    suspend fun archiveSynced(id: String) {
        if (data?.syncStatus?.get(id) == "archived") return
        setSyncStatus(id, "archived")
    }

    /** 学期第一周周一（本地+云端漫游），格式 yyyy-MM-dd */
    suspend fun setSemStart(date: String) {
        semStart = date
        Prefs.localSemStart = date
        runCatching { Api.putSemStart(date) }
    }

    /* ---------- 内部 ---------- */

    private fun mutate(f: (CloudData) -> CloudData) { data = data?.let(f) }

    private fun assignmentJson(a: Assignment): JsonObject =
        json.encodeToJsonElement(Assignment.serializer(), a).jsonObject

    private fun upsertOp(item: JsonObject): JsonObject = buildJsonObject {
        put("op", "upsert"); put("coll", "assignments")
        put("items", JsonArray(listOf(item)))
    }

    private suspend fun pushOps(ops: List<JsonObject>): Boolean {
        return try {
            val body = buildJsonObject { put("ops", JsonArray(ops)) }
            val r = Api.pushOps(body.toString())
            // 采纳权威快照（过滤在途删除），并顺带重拉共享板（新课程可能刚进云端）
            r.data?.let { c ->
                data = c.copy(
                    courses = c.courses.filter { it.id !in pendingIds },
                    assignments = c.assignments.filter { it.id !in pendingIds },
                    files = c.files.filter { it.id !in pendingIds }
                )
            }
            pullSync()
            WidgetSync.saveCurrent()   // 待办数变化同步到组件
            true
        } catch (e: Exception) {
            error = "云端同步失败：${e.message}（稍后自动重拉）"
            delay(600)
            refresh()
            false
        }
    }
}
