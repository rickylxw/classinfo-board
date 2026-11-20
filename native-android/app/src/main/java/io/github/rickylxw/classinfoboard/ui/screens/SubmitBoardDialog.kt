package io.github.rickylxw.classinfoboard.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.rickylxw.classinfoboard.data.Api
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/* 投稿作业到共享板：成员提交，经负责人/管理员审核后同步全班（POST /board/assignment/submit） */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubmitBoardDialog(courseKey: String, courseName: String, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var title by rememberSaveable { mutableStateOf("") }
    var deadline by remember { mutableStateOf<LocalDate?>(null) }
    var requirement by rememberSaveable { mutableStateOf("") }
    var showDate by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("投稿作业（待审核）") },
        text = {
            Column {
                Text(
                    "投稿到「$courseName」共享板，经负责人/管理员审核通过后同步全班",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = title, onValueChange = { title = it },
                    label = { Text("标题 *") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { showDate = true }) {
                    Text(deadline?.format(DateTimeFormatter.ofPattern("截止 yyyy-MM-dd")) ?: "截止日期（可留空）")
                }
                if (deadline != null) {
                    TextButton(onClick = { deadline = null }) { Text("清空截止") }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = requirement, onValueChange = { if (it.length <= 2000) requirement = it },
                    label = { Text("要求 / 说明（可留空）") }, minLines = 3,
                    modifier = Modifier.fillMaxWidth()
                )
                if (err.isNotBlank()) {
                    Text(err, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 6.dp))
                }
            }
        },
        confirmButton = {
            Button(onClick = {
                if (busy) return@Button
                if (title.isBlank()) { err = "标题不能为空"; return@Button }
                busy = true
                scope.launch {
                    try {
                        Api.submitBoardAssignment(
                            courseKey, title.trim(),
                            deadline?.format(DateTimeFormatter.ofPattern("yyyy-MM-dd")) ?: "",
                            requirement.trim()
                        )
                        onDismiss()
                    } catch (e: Exception) { err = e.message ?: "提交失败" } finally { busy = false }
                }
            }, enabled = !busy) { Text("提交投稿") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )

    if (showDate) {
        val st = rememberDatePickerState(
            initialSelectedDateMillis = (deadline ?: LocalDate.now()).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        )
        DatePickerDialog(
            onDismissRequest = { showDate = false },
            confirmButton = {
                TextButton(onClick = {
                    deadline = st.selectedDateMillis?.let {
                        LocalDate.ofInstant(Instant.ofEpochMilli(it), ZoneOffset.UTC)
                    }
                    showDate = false
                }) { Text("确定") }
            },
            dismissButton = { TextButton(onClick = { showDate = false }) { Text("取消") } }
        ) { DatePicker(state = st) }
    }
}
