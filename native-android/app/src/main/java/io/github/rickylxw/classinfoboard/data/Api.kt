package io.github.rickylxw.classinfoboard.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/* 后端 API 客户端：与 src/api.js 契约一致。
 * Bearer 会话；服务器权威——读 /data /sync，写暂未接 ops（骨架阶段只读）。 */

class ApiException(message: String) : Exception(message)

object Api {
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        isLenient = true
    }
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val jsonBody = "application/json; charset=utf-8".toMediaType()

    private fun base() = Prefs.serverUrl.trimEnd('/')

    private suspend fun exec(path: String, method: String = "GET", body: String? = null, auth: Boolean = true): String =
        withContext(Dispatchers.IO) {
            val b = Request.Builder().url(base() + "/api" + path)
            when (method) {
                "POST" -> b.post((body ?: "{}").toRequestBody(jsonBody))
                "PUT" -> b.put((body ?: "{}").toRequestBody(jsonBody))
            }
            if (auth) Prefs.token?.let { b.header("Authorization", "Bearer $it") }
            client.newCall(b.build()).execute().use { resp ->
                val text = resp.body?.string() ?: ""
                if (!resp.isSuccessful) {
                    val msg = try {
                        json.decodeFromString<JsonObject>(text)["error"]?.jsonPrimitive?.content
                    } catch (_: Exception) { null } ?: "HTTP ${resp.code}"
                    throw ApiException(msg)
                }
                text
            }
        }

    /* ---------- 会话 ---------- */

    suspend fun passwordLogin(xh: String, password: String): LoginResp {
        val r = json.decodeFromString<LoginResp>(
            exec("/auth/password-login", "POST", json.encodeToString(PasswordLoginReq.serializer(), PasswordLoginReq(xh, password)), auth = false)
        )
        Prefs.token = r.token
        Prefs.xh = r.xh
        return r
    }

    /** ehall Cookie 登录（首次使用；整段粘贴即可，服务端提取并验证） */
    suspend fun cookieLogin(cookie: String): LoginResp {
        val r = json.decodeFromString<LoginResp>(
            exec("/auth/login", "POST", json.encodeToString(CookieLoginReq.serializer(), CookieLoginReq(cookie)), auth = false)
        )
        Prefs.token = r.token
        Prefs.xh = r.xh
        return r
    }

    suspend fun me(): Me = json.decodeFromString<Me>(exec("/auth/me"))

    suspend fun logout() {
        try { exec("/auth/logout", "POST") } catch (_: Exception) { /* 本地清空为准 */ }
        Prefs.clearSession()
    }

    /* ---------- 数据（只读骨架） ---------- */

    suspend fun data(): CloudData = json.decodeFromString<CloudData>(exec("/data"))

    suspend fun sync(): Map<String, SyncBoard> =
        json.decodeFromString<Map<String, SyncBoard>>(exec("/sync"))

    suspend fun semStart(): SemStartResp = json.decodeFromString<SemStartResp>(exec("/semstart"))

    suspend fun putSemStart(date: String) {
        exec("/semstart", "PUT", json.encodeToString(SemStartReq.serializer(), SemStartReq(date)))
    }

    /* 操作批次：契约对齐 backend /data/ops（upsert/delete/syncStatus），响应带权威快照 */
    suspend fun pushOps(body: String): PushOpsResp =
        json.decodeFromString<PushOpsResp>(exec("/data/ops", "POST", body))

    /* 意见反馈/故障上报：按会话学号记录，管理台处理（30 秒限频，服务端强制） */
    suspend fun sendFeedback(type: String, content: String, app: String, device: String): Boolean {
        val body = json.encodeToString(FeedbackReq.serializer(), FeedbackReq(type, content, app, device))
        return json.decodeFromString<OkResp>(exec("/feedback", "POST", body)).ok
    }

    /* 投稿作业到共享板（成员提交，经负责人/管理员审核后同步全班） */
    suspend fun submitBoardAssignment(key: String, title: String, deadline: String, requirement: String): Boolean {
        val body = buildJsonObject {
            put("key", key)
            put("title", title)
            put("deadline", deadline)
            put("requirement", requirement)
        }
        return json.decodeFromString<OkResp>(exec("/board/assignment/submit", "POST", body.toString())).ok
    }

    /* ---------- 共享板（负责人管理）+ 投稿附件 ---------- */

    suspend fun shareStatus(name: String, teacher: String): ShareStatus =
        json.decodeFromString<ShareStatus>(exec("/share/status?name=" + enc(name) + "&teacher=" + enc(teacher)))

    suspend fun applyShare(name: String, teacher: String): Boolean =
        postOk("/share/apply", json.encodeToString(ShareApplyReq.serializer(), ShareApplyReq(name, teacher)))

    suspend fun loadBoard(key: String): BoardData =
        json.decodeFromString<BoardData>(exec("/board?key=" + enc(key)))

    /** 新增/编辑共享作业；返回后端分配的 id（编辑时回传原 id） */
    suspend fun boardUpsertAssignment(key: String, id: String?, title: String, deadline: String, requirement: String): String? {
        val body = buildJsonObject {
            put("key", key)
            if (!id.isNullOrBlank()) put("id", id)
            put("title", title)
            put("deadline", deadline)
            put("requirement", requirement)
        }
        val r = json.decodeFromString<JsonObject>(exec("/board/assignment/upsert", "POST", body.toString()))
        return r["id"]?.jsonPrimitive?.content
    }

    suspend fun boardDeleteAssignment(key: String, id: String): Boolean =
        postOk("/board/assignment/delete", opBody(key, "id", id))

    suspend fun boardFileDelete(key: String, id: String): Boolean =
        postOk("/board/file/delete", opBody(key, "id", id))

    suspend fun boardReviewAssignment(key: String, id: String, approve: Boolean): Boolean =
        postOk("/board/assignment/review", reviewBody(key, id, approve))

    suspend fun boardReviewFile(key: String, id: String, approve: Boolean): Boolean =
        postOk("/board/file/review", reviewBody(key, id, approve))

    suspend fun boardGroupAdd(key: String, group: SyncGroup): BoardGroup? {
        val body = buildJsonObject { put("key", key); put("group", json.encodeToJsonElement(SyncGroup.serializer(), group)) }
        val r = json.decodeFromString<JsonObject>(exec("/board/group/add", "POST", body.toString()))
        return r["group"]?.jsonObject?.let { json.decodeFromJsonElement(SyncGroup.serializer(), it) }
    }

    suspend fun boardGroupUpdate(key: String, id: String, group: SyncGroup): Boolean {
        val body = buildJsonObject {
            put("key", key); put("id", id)
            put("group", json.encodeToJsonElement(SyncGroup.serializer(), group))
        }
        return json.decodeFromString<OkResp>(exec("/board/group/update", "POST", body.toString())).ok
    }

    suspend fun boardGroupDelete(key: String, id: String): Boolean =
        postOk("/board/group/delete", opBody(key, "id", id))

    suspend fun boardGroupReview(key: String, pid: String, approve: Boolean): Boolean =
        json.decodeFromString<OkResp>(exec("/board/group/review", "POST", buildJsonObject {
            put("key", key); put("pid", pid); put("approve", approve)
        }.toString())).ok

    /** 负责人上传共享附件（PUT 原始字节，无 JSON 载荷） */
    suspend fun boardFileUpload(key: String, name: String, bytes: ByteArray): Boolean =
        putRawBytes("/board/file/upload?key=" + enc(key) + "&name=" + enc(name), bytes)

    /** 成员投稿附件（PUT 原始字节） */
    suspend fun boardFileSubmit(key: String, name: String, bytes: ByteArray): Boolean =
        putRawBytes("/board/file/submit?key=" + enc(key) + "&name=" + enc(name), bytes)

    /* ---------- 内部 ---------- */

    private fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")

    private fun opBody(key: String, field: String, value: String): String =
        buildJsonObject { put("key", key); put(field, value) }.toString()

    private fun reviewBody(key: String, id: String, approve: Boolean): String =
        buildJsonObject { put("key", key); put("id", id); put("approve", approve) }.toString()

    private suspend fun postOk(path: String, body: String): Boolean =
        json.decodeFromString<OkResp>(exec(path, "POST", body)).ok

    private suspend fun putRawBytes(path: String, bytes: ByteArray): Boolean = withContext(Dispatchers.IO) {
        val b = Request.Builder()
            .url(base() + "/api" + path)
            .put(bytes.toRequestBody("application/octet-stream".toMediaType()))
        Prefs.token?.let { b.header("Authorization", "Bearer $it") }
        client.newCall(b.build()).execute().use { it.isSuccessful }
    }
}

@Serializable
data class ShareApplyReq(val name: String, val teacher: String)

@Serializable
data class SemStartReq(val semStart: String)
