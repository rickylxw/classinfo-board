package io.github.rickylxw.classinfoboard.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.rickylxw.classinfoboard.data.Prefs
import io.github.rickylxw.classinfoboard.data.Repo
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/* 添加作业：课程（含 📌 个人待办）+ 标题 + 截止（可空）。deadline 格式 yyyy-MM-ddTHH:mm 与 web 一致 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddAssignmentDialog(presetCourseId: String? = null, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val courses = Repo.data?.courses.orEmpty()

    var courseId by remember { mutableStateOf(presetCourseId ?: courses.firstOrNull()?.id ?: "personal") }
    var title by remember { mutableStateOf("") }
    var date by remember { mutableStateOf<LocalDate?>(null) }
    var time by remember { mutableStateOf<LocalTime?>(LocalTime.of(23, 59)) }
    var showDate by remember { mutableStateOf(false) }
    var showTime by remember { mutableStateOf(false) }
    var showCourseMenu by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    val courseName = when (courseId) {
        "personal" -> "📌 个人待办"
        else -> courses.firstOrNull { it.id == courseId }?.name ?: "（选择课程）"
    }

    fun save() {
        if (busy) return
        if (title.isBlank()) { err = "标题不能为空"; return }
        if (courseId != "personal" && courses.none { it.id == courseId }) { err = "请选择课程"; return }
        val ddl = date?.let { d ->
            val t = time ?: LocalTime.of(23, 59)
            d.format(DateTimeFormatter.ofPattern("yyyy-MM-dd")) + "T" + t.format(DateTimeFormatter.ofPattern("HH:mm"))
        }
        busy = true
        scope.launch {
            try {
                Repo.add(title, courseId, ddl)
                onDismiss()
            } catch (e: Exception) {
                err = e.message ?: "保存失败"
            } finally { busy = false }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("添加作业") },
        text = {
            Column {
                // 课程选择（下拉）
                OutlinedTextField(
                    value = courseName, onValueChange = {},
                    label = { Text("课程") },
                    readOnly = true,
                    trailingIcon = { IconButton(onClick = { showCourseMenu = true }) { Icon(Icons.Filled.ArrowDropDown, null) } },
                    modifier = Modifier.fillMaxWidth()
                )
                DropdownMenu(expanded = showCourseMenu, onDismissRequest = { showCourseMenu = false }) {
                    DropdownMenuItem(
                        text = { Text("📌 个人待办") },
                        onClick = { courseId = "personal"; showCourseMenu = false })
                    courses.forEach { c ->
                        DropdownMenuItem(
                            text = { Text(c.name) },
                            onClick = { courseId = c.id; showCourseMenu = false })
                    }
                }
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = title, onValueChange = { title = it },
                    label = { Text("标题 *") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(10.dp))
                Text("截止时间（可留空）", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = { showDate = true }) {
                        Text(date?.format(DateTimeFormatter.ofPattern("MM-dd")) ?: "日期")
                    }
                    Spacer(Modifier.width(8.dp))
                    OutlinedButton(onClick = { showTime = true }, enabled = date != null) {
                        Text(time?.format(DateTimeFormatter.ofPattern("HH:mm")) ?: "时间")
                    }
                    if (date != null) {
                        Spacer(Modifier.width(8.dp))
                        TextButton(onClick = { date = null }) { Text("清空") }
                    }
                }
                if (err.isNotBlank()) {
                    Text(err, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 6.dp))
                }
            }
        },
        confirmButton = {
            Button(onClick = { save() }, enabled = !busy) { Text("保存") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        }
    )

    if (showDate) {
        val st = rememberDatePickerState(
            initialSelectedDateMillis = (date ?: LocalDate.now())
                .atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        )
        DatePickerDialog(
            onDismissRequest = { showDate = false },
            confirmButton = {
                TextButton(onClick = {
                    st.selectedDateMillis?.let {
                        // DatePicker 返回 UTC 零点毫秒，需按 UTC 取日期（不能用本地时区，否则日期会偏移）
                        date = LocalDate.ofInstant(Instant.ofEpochMilli(it), ZoneOffset.UTC)
                        if (time == null) time = LocalTime.of(23, 59)
                    }
                    showDate = false
                }) { Text("确定") }
            },
            dismissButton = { TextButton(onClick = { showDate = false }) { Text("取消") } }
        ) {
            DatePicker(state = st)
        }
    }

    if (showTime) {
        val st = rememberTimePickerState(
            initialHour = time?.hour ?: 23,
            initialMinute = time?.minute ?: 59,
            is24Hour = true
        )
        AlertDialog(
            onDismissRequest = { showTime = false },
            title = { Text("选择时间") },
            text = { TimePicker(state = st) },
            confirmButton = {
                TextButton(onClick = {
                    time = LocalTime.of(st.hour, st.minute)
                    showTime = false
                }) { Text("确定") }
            },
            dismissButton = { TextButton(onClick = { showTime = false }) { Text("取消") } }
        )
    }
}
