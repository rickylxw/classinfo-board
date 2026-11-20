package io.github.rickylxw.classinfoboard.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rickylxw.classinfoboard.data.Api
import io.github.rickylxw.classinfoboard.data.Prefs
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(onLoggedIn: () -> Unit) {
    val scope = rememberCoroutineScope()
    var xh by rememberSaveable { mutableStateOf("") }
    var pass by rememberSaveable { mutableStateOf("") }
    var cookie by rememberSaveable { mutableStateOf("") }
    var cookieOpen by rememberSaveable { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    fun doPasswordLogin() {
        if (busy) return
        if (xh.isBlank() || pass.isBlank()) { error = "请输入一卡通号和密码"; return }
        error = ""; busy = true
        scope.launch {
            try {
                Api.passwordLogin(xh.trim(), pass)
                onLoggedIn()
            } catch (e: Exception) {
                error = e.message ?: "登录失败"
            } finally { busy = false }
        }
    }

    fun doCookieLogin() {
        if (busy) return
        if (cookie.isBlank()) { error = "请先粘贴 ehall Cookie"; return }
        error = ""; busy = true
        scope.launch {
            try {
                Api.cookieLogin(cookie.trim())
                onLoggedIn()
            } catch (e: Exception) {
                error = e.message ?: "登录失败"
            } finally { busy = false }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Spacer(Modifier.height(48.dp))
        Text("📚", fontSize = 52.sp)
        Text("课程信息板", fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp))
        Text(
            "课程 · 作业 DDL · 文件 · 班级共享",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp, bottom = 24.dp)
        )

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("🔑 应用密码登录", fontWeight = FontWeight.SemiBold)
                Text(
                    "设置过应用密码即可免 Cookie 直接登录；首次使用请用下方 Cookie 登录一次",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp, bottom = 10.dp)
                )
                OutlinedTextField(
                    value = xh, onValueChange = { xh = it },
                    label = { Text("一卡通号") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = pass, onValueChange = { pass = it },
                    label = { Text("应用密码") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(12.dp))
                Button(onClick = { doPasswordLogin() }, enabled = !busy, modifier = Modifier.fillMaxWidth().height(46.dp)) {
                    if (busy) CircularProgressIndicator(modifier = Modifier.height(20.dp)) else Text("登录")
                }
            }
        }

        TextButton(onClick = { cookieOpen = !cookieOpen }, modifier = Modifier.padding(top = 10.dp)) {
            Text(if (cookieOpen) "收起 ehall Cookie 登录" else "用 ehall Cookie 登录（首次使用）")
        }
        if (cookieOpen) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    OutlinedTextField(
                        value = cookie, onValueChange = { cookie = it },
                        label = { Text("ehall Cookie") },
                        placeholder = { Text("粘贴整段 Cookie 或 Copy as cURL") },
                        minLines = 3,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(10.dp))
                    Button(onClick = { doCookieLogin() }, enabled = !busy && cookie.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                        Text("验证并登录")
                    }
                }
            }
        }

        if (error.isNotBlank()) {
            Text(
                error,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 12.dp)
            )
        }
        Spacer(Modifier.height(24.dp))
    }
}
