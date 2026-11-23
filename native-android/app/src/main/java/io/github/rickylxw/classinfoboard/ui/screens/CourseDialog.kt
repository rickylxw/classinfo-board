package io.github.rickylxw.classinfoboard.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rickylxw.classinfoboard.data.Course
import io.github.rickylxw.classinfoboard.data.Repo
import kotlinx.coroutines.launch

private val PALETTE = listOf(
    "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6"
)

/* 课程 新建/编辑 表单（对齐 web 端 CourseDialog 字段：名称* / 教师 / 学期 / 类别 / 颜色 / 备注） */

private val CATEGORIES = listOf("数理基础类", "专业类", "思政类", "通选类", "体育类")

@Composable
fun CourseDialog(existing: Course?, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(existing?.name ?: "") }
    var teacher by remember { mutableStateOf(existing?.teacher ?: "") }
    var semester by remember { mutableStateOf(existing?.semester ?: "") }
    var category by remember { mutableStateOf(existing?.category ?: "") }
    var color by remember { mutableStateOf(existing?.color ?: PALETTE.first()) }
    var note by remember { mutableStateOf(existing?.note ?: "") }
    var catMenu by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing == null) "新建课程" else "编辑课程") },
        text = {
            Column {
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text("课程名称 *") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = teacher, onValueChange = { teacher = it },
                        label = { Text("教师") }, singleLine = true, modifier = Modifier.weight(1f)
                    )
                    OutlinedTextField(
                        value = semester, onValueChange = { semester = it },
                        label = { Text("学期") }, singleLine = true, modifier = Modifier.weight(1f)
                    )
                }
                Spacer(Modifier.height(8.dp))
                // 类别下拉
                Box {
                    OutlinedTextField(
                        value = category.ifBlank { "未分类" }, onValueChange = {},
                        label = { Text("类别") }, readOnly = true,
                        trailingIcon = {
                            Box(Modifier.clickable { catMenu = true }.padding(8.dp)) {
                                Text("▾")
                            }
                        },
                        modifier = Modifier.fillMaxWidth().clickable { catMenu = true }
                    )
                    DropdownMenu(expanded = catMenu, onDismissRequest = { catMenu = false }) {
                        DropdownMenuItem(text = { Text("未分类") },
                            onClick = { category = ""; catMenu = false })
                        CATEGORIES.forEach { c ->
                            DropdownMenuItem(text = { Text(c) },
                                onClick = { category = c; catMenu = false })
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                // 颜色选择（8 色）
                Text("颜色标签", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(
                    Modifier.fillMaxWidth().padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    PALETTE.forEach { hex ->
                        val c = runCatching { Color(android.graphics.Color.parseColor(hex)) }
                            .getOrDefault(Color(0xFF6366F1))
                        Box(
                            Modifier
                                .size(26.dp)
                                .background(c, CircleShape)
                                .border(
                                    width = if (color == hex) 2.5.dp else 1.dp,
                                    color = if (color == hex) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline,
                                    shape = CircleShape
                                )
                                .clickable { color = hex }
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = note, onValueChange = { if (it.length <= 2000) note = it },
                    label = { Text("课程备注（可写上课时间：周X · 第X-Y节 · 周次 · 教室，日程表会解析）") },
                    minLines = 2, modifier = Modifier.fillMaxWidth()
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
                if (name.isBlank()) { err = "课程名称不能为空"; return@Button }
                busy = true
                val c = Course(
                    id = existing?.id ?: Repo.uid(),
                    name = name.trim(), teacher = teacher.trim(),
                    semester = semester.trim(), category = category,
                    color = color, note = note.trim()
                )
                scope.launch {
                    try {
                        Repo.upsertCourse(c)
                        onDismiss()
                    } catch (e: Exception) { err = e.message ?: "保存失败" } finally { busy = false }
                }
            }, enabled = !busy) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}
