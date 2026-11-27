package io.github.rickylxw.classinfoboard.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rickylxw.classinfoboard.data.Mirror
import io.github.rickylxw.classinfoboard.data.Updater

@Composable
fun UpdateDialog(onDismiss: () -> Unit) {
    val rel = Updater.available ?: return
    val ctx = LocalContext.current
    val bodyText = rel.body?.takeIf { it.isNotBlank() } ?: "体验优化与问题修复。"

    // 打开时测两个下载源的延迟
    LaunchedEffect(rel.tagName) { Updater.measureLatencies(rel) }

    AlertDialog(
        onDismissRequest = { if (!Updater.downloading) onDismiss() },
        title = { Text("发现新版本 ${rel.tagName.removePrefix("native-v")}") },
        text = {
            Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
                Text(bodyText, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(12.dp))

                // 下载源选择 + 延迟
                Text("下载源", fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(6.dp))
                var menu by remember { mutableStateOf(false) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = { menu = true }, enabled = !Updater.downloading) {
                        Text(Updater.mirror.label)
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(
                        latencyText(),
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (Updater.latencyTesting) {
                        Spacer(Modifier.width(8.dp))
                        CircularProgressIndicator(Modifier.height(12.dp), strokeWidth = 2.dp)
                    }
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    Mirror.entries.forEach { m ->
                        DropdownMenuItem(
                            text = { Text(m.label + mirrorLatencySuffix(m)) },
                            onClick = { Updater.chooseMirror(m); menu = false }
                        )
                    }
                }
                // 生效源提示（AUTO 时解析结果）
                if (Updater.mirror == Mirror.AUTO) {
                    Text(
                        "将使用：" + mirrorLatencySuffix(Updater.effectiveMirror()).removePrefix(" · "),
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }

                // 下载进度：进度条 + 百分比 + 字节数（应用内下载，不转圈）
                if (Updater.downloading || Updater.progress in 1..99) {
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LinearProgressIndicator(
                            progress = { Updater.progress / 100f },
                            modifier = Modifier.weight(1f)
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "${Updater.progress}%",
                            fontSize = 13.sp, fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.width(42.dp)
                        )
                    }
                    Text(
                        mbText() + "（完成后自动拉起安装）",
                        fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 3.dp)
                    )

                }
                if (Updater.progress == 100 && !Updater.downloading) {
                    Text("下载完成，正在拉起安装…", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
                }
                Updater.downloadError?.let { err ->
                    Text(err, fontSize = 12.sp, color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(top = 6.dp))
                }
            }
        },
        confirmButton = {
            when {
                Updater.downloading -> Button(onClick = {}, enabled = false) {
                    Text("下载中…")
                }
                Updater.progress == 100 && Updater.downloadedFile != null ->
                    Button(onClick = { Updater.promptInstall(ctx) }) { Text("安装") }
                else -> Button(onClick = { Updater.startDownload(ctx) }) {
                    Text(
                        if (Updater.downloadError != null) "重试下载"
                        else "下载更新"
                    )
                }
            }
        },
        dismissButton = {
            Column(horizontalAlignment = Alignment.End) {
                TextButton(onClick = {
                    ctx.startActivity(
                        android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(rel.htmlUrl))
                    )
                }) { Text("在浏览器查看") }
                TextButton(onClick = { if (!Updater.downloading) onDismiss() }) {
                    Text(if (Updater.downloading) "后台下载中" else "以后再说")
                }
            }
        }
    )
}

@Composable
private fun latencyText(): String {
    val b = Updater.latencyBoard
    val g = Updater.latencyGithub
    return when {
        Updater.latencyTesting -> "测速中…"
        b == null && g == null -> "延迟：未测得"
        else -> "延迟：板子 ${b?.let { "${it}ms" } ?: "×"} · GitHub ${g?.let { "${it}ms" } ?: "×"}"
    }
}

private fun mirrorLatencySuffix(m: Mirror): String {
    if (m == Mirror.AUTO) return ""
    val l = if (m == Mirror.BOARD) Updater.latencyBoard else Updater.latencyGithub
    return " · " + (l?.let { "${it}ms" } ?: "×")
}

private fun mbText(): String {
    val b = Updater.progressBytes
    val t = Updater.totalBytes
    if (t <= 0) return ""
    fun f(v: Long) = String.format(java.util.Locale.US, "%.1f MB", v / 1048576.0)
    return "${f(b)} / ${f(t)}"
}
