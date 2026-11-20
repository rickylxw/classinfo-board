package io.github.rickylxw.classinfoboard.ui.screens

import android.content.Context
import android.os.Build
import android.widget.Toast
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import io.github.rickylxw.classinfoboard.data.Api
import kotlinx.coroutines.launch

/* 意见反馈/故障上报：POST /feedback（按会话学号记录，管理台「用户反馈」页签处理） */

fun deviceInfo(): String =
    (Build.MANUFACTURER.ifBlank { "?" } + " " + Build.MODEL + " / Android " + Build.VERSION.RELEASE)

fun appTag(ctx: Context): String = runCatching {
    val p = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
    "native-${p.versionName}(${p.longVersionCode})"
}.getOrDefault("native")

@Composable
fun FeedbackDialog(initialType: String, initialText: String, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var type by rememberSaveable { mutableStateOf(initialType.ifBlank { "bug" }) }
    var text by rememberSaveable { mutableStateOf(initialText) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    fun submit() {
        if (busy) return
        val c = text.trim()
        if (c.length < 5) { err = "请描述一下具体情况（至少 5 个字）"; return }
        busy = true
        scope.launch {
            try {
                Api.sendFeedback(type, c, appTag(ctx), deviceInfo())
                Toast.makeText(ctx, "已提交，感谢反馈！可在班级群或联系管理员跟进", Toast.LENGTH_LONG).show()
                onDismiss()
            } catch (e: Exception) {
                err = e.message ?: "提交失败"
            } finally { busy = false }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("意见反馈") },
        text = {
            Column {
                Text(
                    "遇到故障或有好想法？提交后管理员在管理台即可看到（自动附上学号、设备与版本，方便定位）",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.height(8.dp))
                Row {
                    FilterChip(
                        selected = type == "bug",
                        onClick = { type = "bug" },
                        label = { Text("🐞 故障") })
                    Spacer(Modifier.padding(horizontal = 4.dp))
                    FilterChip(
                        selected = type == "idea",
                        onClick = { type = "idea" },
                        label = { Text("💡 建议") })
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = text, onValueChange = { if (it.length <= 2000) text = it },
                    label = { Text("具体描述 *") },
                    placeholder = { Text("做了什么操作 / 期望什么 / 实际发生了什么") },
                    minLines = 5,
                    modifier = Modifier.fillMaxWidth()
                )
                Text(
                    "${text.length}/2000",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(androidx.compose.ui.Alignment.End).padding(top = 2.dp)
                )
                if (err.isNotBlank()) {
                    Text(err, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 4.dp))
                }
            }
        },
        confirmButton = { Button(onClick = { submit() }, enabled = !busy) { Text("提交") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}
