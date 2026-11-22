package io.github.rickylxw.classinfoboard.data

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/* 自动更新：检查（板子中转优先）→ 应用内下载（镜像可选+延迟测速+进度条）→ 自动拉起安装器。
 * 不再用系统 DownloadManager：进度在应用内展示，下载完成立即自行跳出安装。 */

@Serializable
data class GhAssetDto(val name: String = "", val browser_download_url: String = "")

@Serializable
data class GhReleaseDto(
    val tag_name: String = "",
    val html_url: String = "",
    val body: String? = null,
    val assets: List<GhAssetDto> = emptyList()
)

data class GhRelease(
    val tagName: String,
    val htmlUrl: String,
    val body: String?,
    val apkUrl: String,
    val apkName: String
)

/** 下载镜像 */
enum class Mirror(val label: String, val key: String) {
    AUTO("自动（选最快）", "auto"),
    BOARD("板子中转", "board"),
    GITHUB("GitHub 直连", "github");

    companion object {
        fun fromKey(k: String): Mirror = entries.firstOrNull { it.key == k } ?: AUTO
    }
}

object Updater {
    private const val RELEASES_API = "https://api.github.com/repos/rickylxw/classinfo-board/releases/latest"

    var available by mutableStateOf<GhRelease?>(null); private set
    var checking by mutableStateOf(false); private set
    var showDialog by mutableStateOf(false); private set

    /* ---------- 下载状态（应用内进度） ---------- */
    var downloading by mutableStateOf(false); private set
    var progress by mutableStateOf(0)            // 0..100
    var downloadError by mutableStateOf<String?>(null); private set
    var downloadedFile by mutableStateOf<File?>(null); private set

    /* ---------- 镜像与延迟 ---------- */
    var mirror by mutableStateOf(Mirror.fromKey(Prefs.downloadMirror))
    var latencyBoard by mutableStateOf<Int?>(null)      // ms，null=不可达/未测
    var latencyGithub by mutableStateOf<Int?>(null)
    var latencyTesting by mutableStateOf(false); private set

    private val json = Json { ignoreUnknownKeys = true }
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val dlClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    fun currentVersion(ctx: Context): String = runCatching {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""
    }.getOrDefault("")

    /** "native-v1.1.0" vs 本地 "1.1.0"：数字逐段比较；非数字 tag 视为不可比较（不更新） */
    fun isNewer(remoteTag: String, local: String): Boolean {
        val r = remoteTag.removePrefix("native-v").split('.').map { it.toIntOrNull() }
        if (r.isEmpty() || r.any { it == null }) return false
        val ri = r.map { it!! }
        val l = local.split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(ri.size, l.size)) {
            val a = ri.getOrElse(i) { 0 }
            val b = l.getOrElse(i) { 0 }
            if (a != b) return a > b
        }
        return false
    }

    /** @return 人工检查时的提示文案；静默检查返回 null */
    suspend fun check(ctx: Context, manual: Boolean): String? {
        if (checking) return if (manual) "正在检查中…" else null
        checking = true
        return try {
            val rel = tryBoardRelay() ?: tryGitHubDirect()
                ?: return if (manual) "检查更新失败：更新源不可达，请稍后再试" else null
            val local = currentVersion(ctx)
            if (!isNewer(rel.tagName, local)) return "已是最新版本（v$local）"
            available = rel
            showDialog = manual || Prefs.dismissedUpdateTag != rel.tagName
            if (manual) "发现新版本 ${rel.tagName.removePrefix("native-v")}" else null
        } catch (e: Exception) {
            if (manual) "检查更新失败：${e.message}" else null
        } finally { checking = false }
    }

    fun dismiss() {
        available?.let { Prefs.dismissedUpdateTag = it.tagName }
        showDialog = false
    }

    fun chooseMirror(m: Mirror) {
        mirror = m
        Prefs.downloadMirror = m.key
    }

    /** 当前生效镜像（AUTO 时按延迟解析；都未知时优先板子——可达性最好） */
    fun effectiveMirror(): Mirror = when (mirror) {
        Mirror.AUTO -> {
            val b = latencyBoard
            val g = latencyGithub
            when {
                b != null && (g == null || b <= g) -> Mirror.BOARD
                g != null -> Mirror.GITHUB
                else -> Mirror.BOARD
            }
        }
        else -> mirror
    }

    fun resolveUrl(rel: GhRelease): String = when (effectiveMirror()) {
        Mirror.BOARD ->
            Prefs.serverUrl.trimEnd('/') +
                "/api/app-update/download?tag=" + urlEnc(rel.tagName) + "&name=" + urlEnc(rel.apkName)
        else -> rel.apkUrl
    }

    private fun urlEnc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")

    /** 并发测两个源的延迟（打开更新对话框时调用；结果进状态供 UI 显示） */
    suspend fun measureLatencies(rel: GhRelease?) {
        if (latencyTesting) return
        latencyTesting = true
        try {
            coroutineScope {
                val b = async(Dispatchers.IO) { timeOf(Prefs.serverUrl.trimEnd('/') + "/api/app-update/latest", head = false) }
                val g = rel?.apkUrl?.let { u -> async(Dispatchers.IO) { timeOf(u, head = true) } }
                latencyBoard = b.await()
                latencyGithub = g?.await()
            }
        } finally { latencyTesting = false }
    }

    private fun timeOf(url: String, head: Boolean): Int? {
        val t0 = SystemClock.elapsedRealtime()
        return runCatching {
            val rb = Request.Builder().url(url)
            if (head) rb.head()
            client.newCall(rb.build()).execute().use { it.isSuccessful }
            ((SystemClock.elapsedRealtime() - t0)).toInt()
        }.getOrNull()
    }

    /** 应用内下载：进度回调百分比；完成返回 APK 文件（自动拉起安装由调用方执行） */
    private suspend fun downloadApk(ctx: Context, rel: GhRelease, onProgress: (Int) -> Unit): File =
        withContext(Dispatchers.IO) {
            val url = resolveUrl(rel)
            val dir = ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS) ?: ctx.cacheDir
            val f = File(dir, "classinfo-board-${rel.tagName}.apk")
            val tmp = File(f.absolutePath + ".part")
            dlClient.newCall(Request.Builder().url(url).build()).execute().use { resp ->
                if (!resp.isSuccessful) throw Exception("HTTP ${resp.code}")
                val body = resp.body ?: throw Exception("空响应")
                val total = body.contentLength()
                body.byteStream().use { input ->
                    tmp.outputStream().use { out ->
                        val buf = ByteArray(16 * 1024)
                        var read = 0L
                        var lastPct = -1
                        while (true) {
                            val n = input.read(buf)
                            if (n == -1) break
                            out.write(buf, 0, n)
                            read += n
                            if (total > 0) {
                                val pct = (read * 100 / total).toInt()
                                if (pct != lastPct) { lastPct = pct; onProgress(pct) }
                            }
                        }
                    }
                }
            }
            if (tmp.length() < 1024 * 1024) { tmp.delete(); throw Exception("下载内容异常（过小），请换下载源重试") }
            tmp.renameTo(f) || (f.delete() && tmp.renameTo(f))
            f
        }

    /** 触发下载（后台进行，状态进 Compose state 供对话框渲染）；完成自动拉起安装 */
    fun startDownload(ctx: Context) {
        val rel = available ?: return
        if (downloading) return
        downloading = true
        progress = 0
        downloadError = null
        downloadedFile = null
        kotlinx.coroutines.CoroutineScope(Dispatchers.IO).launch {
            try {
                val f = downloadApk(ctx, rel) { progress = it }
                downloadedFile = f
                progress = 100
                downloading = false
                withContext(Dispatchers.Main) { promptInstall(ctx, f) }
            } catch (e: Exception) {
                downloadError = e.message ?: "下载失败"
                downloading = false
            }
        }
    }

    fun promptInstall(ctx: Context, f: File? = null) {
        val file = f ?: downloadedFile ?: run {
            val tag = Prefs.lastApkDownloadTag ?: return
            File(ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS), "classinfo-board-$tag.apk")
                .takeIf { it.exists() }
        } ?: return
        val uri = FileProviderUri(ctx, file)
        ctx.startActivity(
            android.content.Intent(android.content.Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(
                    android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                )
        )
    }

    private fun FileProviderUri(ctx: Context, f: File): Uri =
        androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", f)

    /* ---------- 更新检查（板子中转优先 + GitHub 直连兜底） ---------- */

    @Serializable
    data class RelayDto(
        val tag: String = "",
        val apkUrl: String = "",
        val apkName: String = "",
        val notes: String? = null,
        val htmlUrl: String = ""
    )

    private suspend fun tryBoardRelay(): GhRelease? = withContext(Dispatchers.IO) {
        runCatching {
            val text = client.newCall(
                Request.Builder().url(Prefs.serverUrl.trimEnd('/') + "/api/app-update/latest").build()
            ).execute().use { it.body?.string() ?: "" }
            val d = json.decodeFromString<RelayDto>(text)
            if (d.tag.isBlank()) return@runCatching null
            val name = d.apkName.ifBlank {
                d.apkUrl.substringAfterLast('/')
            }
            GhRelease(d.tag, d.htmlUrl, d.notes, d.apkUrl.ifBlank { null } ?: "", name)
        }.getOrNull()
    }

    private suspend fun tryGitHubDirect(): GhRelease? = withContext(Dispatchers.IO) {
        runCatching {
            val text = client.newCall(
                Request.Builder().url(RELEASES_API)
                    .header("Accept", "application/vnd.github+json")
                    .build()
            ).execute().use { it.body?.string() ?: "" }
            val dto = json.decodeFromString<GhReleaseDto>(text)
            GhRelease(
                dto.tag_name, dto.html_url, dto.body,
                dto.assets.firstOrNull { it.name.endsWith(".apk") }?.browser_download_url ?: "",
                dto.assets.firstOrNull { it.name.endsWith(".apk") }?.name ?: ""
            )
        }.getOrNull()
    }

    /** 下载完成广播接收（旧 DownloadManager 路径已移除；保留空实现占位避免外部引用断裂） */
    fun registerDownloadReceiver(@Suppress("UNUSED_PARAMETER") ctx: Context) { /* no-op */ }
}
