package io.github.rickylxw.classinfoboard.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import io.github.rickylxw.classinfoboard.data.Updater

@Composable
fun UpdateDialog(onDismiss: () -> Unit) {
    val rel = Updater.available ?: return
    val ctx = LocalContext.current
    val bodyText = rel.body?.takeIf { it.isNotBlank() } ?: "体验优化与问题修复。"
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("发现新版本 ${rel.tagName.removePrefix("native-v")}") },
        text = {
            Column(Modifier.heightIn(max = 340.dp).verticalScroll(rememberScrollState())) {
                Text(bodyText, style = MaterialTheme.typography.bodyMedium)
            }
        },
        confirmButton = {
            Button(onClick = {
                Updater.startDownload(ctx)
                onDismiss()
            }) { Text("下载更新") }
        },
        dismissButton = {
            Column {
                TextButton(onClick = {
                    ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(rel.htmlUrl)))
                }) { Text("在浏览器查看") }
                TextButton(onClick = onDismiss) { Text("以后再说") }
            }
        }
    )
}
