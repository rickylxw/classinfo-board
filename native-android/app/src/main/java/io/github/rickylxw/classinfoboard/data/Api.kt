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
}

@Serializable
data class SemStartReq(val semStart: String)
