package io.github.rickylxw.classinfoboard.data

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Environment
import android.widget.Toast
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/* 自动更新：查 GitHub Releases（公开仓库免鉴权）→ 弹窗确认 → DownloadManager 下载
 * → 下载完成广播自动拉起系统安装器。只做静默检查+弹窗，绝不静默安装。 */

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
    val apkUrl: String?
)

object Updater {
    private const val RELEASES_API = "https://api.github.com/repos/rickylxw/classinfo-board/releases/latest"

    var available by androidx.compose.runtime.mutableStateOf<GhRelease?>(null); private set
    var checking by androidx.compose.runtime.mutableStateOf(false); private set
    var showDialog by androidx.compose.runtime.mutableStateOf(false); private set

    private val json = Json { ignoreUnknownKeys = true }
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    fun currentVersion(ctx: Context): String = runCatching {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""
    }.getOrDefault("")

    /** "native-v0.2.1" vs 本地 "0.2.1"：数字逐段比较；非数字 tag 视为不可比较（不更新） */
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
            // 主路：板子中转（同学手机/校园网直连 api.github.com 常被重置，板子域名必然可达）；
            // 兜底：GitHub 直连（板子后端故障时）
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

    @Serializable
    data class RelayDto(
        val tag: String = "",
        val apkUrl: String = "",
        val notes: String? = null,
        val htmlUrl: String = ""
    )

    /** 主路：板子后端中转 GitHub API（GET /api/app-update/latest，服务端 10 分钟缓存） */
    private suspend fun tryBoardRelay(): GhRelease? = withContext(Dispatchers.IO) {
        runCatching {
            val text = client.newCall(
                Request.Builder().url(Prefs.serverUrl.trimEnd('/') + "/api/app-update/latest").build()
            ).execute().use { it.body?.string() ?: "" }
            val d = json.decodeFromString<RelayDto>(text)
            if (d.tag.isBlank()) return@runCatching null
            GhRelease(d.tag, d.htmlUrl, d.notes, d.apkUrl.ifBlank { null })
        }.getOrNull()
    }

    /** 兜底：GitHub API 直连 */
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
                dto.assets.firstOrNull { it.name.endsWith(".apk") }?.browser_download_url
                    ?: dto.assets.firstOrNull()?.browser_download_url
            )
        }.getOrNull()
    }

    fun dismiss() {
        available?.let { Prefs.dismissedUpdateTag = it.tagName }
        showDialog = false
    }

    /* ---------- 下载与安装 ---------- */

    fun startDownload(ctx: Context) {
        val rel = available ?: return
        val url = rel.apkUrl ?: return
        val name = "classinfo-board-${rel.tagName}.apk"
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val req = DownloadManager.Request(Uri.parse(url))
            .setTitle("课程信息板 ${rel.tagName.removePrefix("native-v")}")
            .setDescription("正在下载更新包")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setMimeType("application/vnd.android.package-archive")
            .setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_DOWNLOADS, name)
        Prefs.lastApkDownloadId = dm.enqueue(req)
        Prefs.lastApkDownloadTag = rel.tagName
        Toast.makeText(ctx, "开始下载更新（通知栏可见进度，完成后自动拉起安装）", Toast.LENGTH_LONG).show()
    }

    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
            if (id != -1L && id == Prefs.lastApkDownloadId) promptInstall(c)
        }
    }

    /** 下载完成广播（系统保护广播，NOT_EXPORTED 也能收到）——MainActivity onCreate 注册 */
    fun registerDownloadReceiver(ctx: Context) {
        ContextCompat.registerReceiver(
            ctx, downloadReceiver,
            IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    fun promptInstall(ctx: Context) {
        val tag = Prefs.lastApkDownloadTag ?: return
        val f = File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "classinfo-board-$tag.apk")
        if (!f.exists()) return
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", f)
        ctx.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
