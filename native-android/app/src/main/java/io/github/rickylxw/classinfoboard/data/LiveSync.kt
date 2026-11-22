package io.github.rickylxw.classinfoboard.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/* 前台实时同步（SSE）：App 在前台时挂一条事件流连接，退后台（onStop）立即断开。
 * 省电设计：仅前台保持连接（空闲 TCP 几乎不耗电，服务端 25s 心跳保活）；
 * 后台不连——由 30 分钟闹钟（ReminderReceiver）复用唤醒顺带拉取兜底；
 * 收到 data / sync 事件 → 1s 防抖重拉云端（Repo.refresh：/data+/sync+快照落盘+小组件刷新）。
 * 重连指数退避 2/5/15/30s 封顶，成功连上即复位；手工解析 SSE 帧，零新依赖。 */
object LiveSync {
    private var call: okhttp3.Call? = null
    private var loop: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var running = false
    @Volatile private var lastEventAt = 0L

    private val client = OkHttpClient.Builder()
        .readTimeout(70, TimeUnit.SECONDS)   // 服务端 25s 心跳，70s 读超时足够容错
        .build()

    fun start() {
        if (running || !Prefs.loggedIn || Prefs.token.isNullOrBlank()) return
        running = true
        loop = scope.launch { runLoop() }
    }

    fun stop() {
        running = false
        try { call?.cancel() } catch (_: Exception) {}
        call = null
        loop?.cancel()
        loop = null
    }

    private suspend fun runLoop() {
        var backoff = 2_000L
        while (running) {
            val token = Prefs.token ?: return
            try {
                val req = Request.Builder()
                    .url(Prefs.serverUrl.trimEnd('/') + "/api/events?token=" +
                        URLEncoder.encode(token, "UTF-8"))
                    .header("Accept", "text/event-stream")
                    .build()
                val c = client.newCall(req)
                call = c
                c.execute().use { resp ->
                    if (!resp.isSuccessful) throw IOException("SSE HTTP ${resp.code}")
                    backoff = 2_000L   // 成功连上（哪怕随后断）也复位退避
                    val src = resp.body?.source() ?: return
                    while (running) {
                        val line = src.readUtf8Line() ?: break
                        // SSE 帧：event: data / event: sync 各占一行；心跳是注释行 ": ka"，忽略
                        if (line.startsWith("event: data") || line.startsWith("event: sync")) {
                            onEvent()
                        }
                    }
                }
            } catch (e: Exception) {
                if (!running) return   // cancel = 正常退后台，不算错误
            }
            if (!running) return
            delay(backoff)
            backoff = (backoff * 2).coerceAtMost(30_000L)
        }
    }

    private fun onEvent() {
        val now = System.currentTimeMillis()
        if (now - lastEventAt < 1_000) return   // 事件可能连发（批量变更），1s 防抖
        lastEventAt = now
        scope.launch {
            runCatching { Repo.refresh() }   // /data + /sync + 快照落盘 + 小组件刷新一体完成
        }
    }
}
