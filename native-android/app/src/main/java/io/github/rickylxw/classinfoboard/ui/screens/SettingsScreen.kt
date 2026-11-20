package io.github.rickylxw.classinfoboard.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rickylxw.classinfoboard.data.Api
import io.github.rickylxw.classinfoboard.data.DEFAULT_SERVER
import io.github.rickylxw.classinfoboard.data.Prefs
import io.github.rickylxw.classinfoboard.data.Updater
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(pad: PaddingValues, onLoggedOut: () -> Unit, onFeedback: (String) -> Unit = {}) {
    val scope = rememberCoroutineScope()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var url by rememberSaveable { mutableStateOf(Prefs.serverUrl) }
    var msg by remember { mutableStateOf("") }
    var updateMsg by remember { mutableStateOf("") }

    Column(
        Modifier
            .padding(pad)
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Text("设置", fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 12.dp))

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("关于与更新", fontWeight = FontWeight.SemiBold)
                Text(
                    "当前版本 v" + Updater.currentVersion(ctx) + "（更新包来源：GitHub Releases）",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp)
                )
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Button(onClick = {
                        scope.launch { updateMsg = Updater.check(ctx, manual = true) ?: "" }
                    }, enabled = !Updater.checking) { Text(if (Updater.checking) "检查中…" else "检查更新") }
                    Spacer(Modifier.width(8.dp))
                    OutlinedButton(onClick = { onFeedback("") }) { Text("意见反馈") }
                }
                if (updateMsg.isNotBlank()) {
                    Text(updateMsg, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("服务器地址", fontWeight = FontWeight.SemiBold)
                Text(
                    "默认走正式域名（https）；局域网调试可改成 http://<板子IP>:5173",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp)
                )
                OutlinedTextField(
                    value = url, onValueChange = { url = it },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(Modifier.padding(top = 8.dp)) {
                    Button(onClick = {
                        val u = url.trim().trimEnd('/')
                        if (!Regex("^https?://[^\\s/]+(:\\d+)?$").matches(u)) {
                            msg = "格式不对：应为 http(s):// 开头的完整地址"
                            return@Button
                        }
                        Prefs.serverUrl = u
                        msg = "已保存，刷新仪表盘生效"
                    }) { Text("保存") }
                    Spacer(Modifier.width(8.dp))
                    OutlinedButton(onClick = { url = DEFAULT_SERVER; Prefs.serverUrl = DEFAULT_SERVER; msg = "已恢复默认" }) {
                        Text("恢复默认")
                    }
                }
                if (msg.isNotBlank()) {
                    Text(msg, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("账号", fontWeight = FontWeight.SemiBold)
                Text(
                    "当前登录：" + (Prefs.xh ?: "未登录"),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 4.dp)
                )
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = {
                    scope.launch {
                        Api.logout()
                        onLoggedOut()
                    }
                }) {
                    Text("退出登录（本机会话清除，云端数据保留）")
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        Text(
            "课程信息板 · 原生端 v" + Updater.currentVersion(ctx) + "\n" +
                "✅ 登录 / 仪表盘读写 / 日程表（.ics·系统日历）/ 自动更新 / 意见反馈\n" +
                "🚧 进行中：共享板操作、课程管理、下节课小组件、群消息远程查看",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 4.dp)
        )
    }
}
