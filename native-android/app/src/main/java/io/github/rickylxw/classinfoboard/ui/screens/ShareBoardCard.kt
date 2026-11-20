package io.github.rickylxw.classinfoboard.ui.screens

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rickylxw.classinfoboard.data.Api
import io.github.rickylxw.classinfoboard.data.BoardAssignment
import io.github.rickylxw.classinfoboard.data.BoardGroup
import io.github.rickylxw.classinfoboard.data.Course
import io.github.rickylxw.classinfoboard.data.Prefs
import io.github.rickylxw.classinfoboard.data.Repo
import io.github.rickylxw.classinfoboard.data.SyncGroup
import io.github.rickylxw.classinfoboard.data.ddlBadge
import io.github.rickylxw.classinfoboard.data.fmtDeadline
import io.github.rickylxw.classinfoboard.data.fmtSize
import io.github.rickylxw.classinfoboard.data.maskXh
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/* 负责人共享板管理卡：作业增删改 / 成员投稿待审（作业·附件·群）/ 共享附件 / 教学群维护。
 * 全部操作走后端共享板接口（负责人或管理员同权），改完重拉整板保证一致性。 */

internal fun downloadBoardFile(ctx: Context, key: String, id: String, name: String) {
    val token = Prefs.token ?: return
    val req = DownloadManager.Request(
        Uri.parse(Prefs.serverUrl.trimEnd('/') + "/api/board/file/download?key=" +
            java.net.URLEncoder.encode(key, "UTF-8") + "&id=" + java.net.URLEncoder.encode(id, "UTF-8"))
    )
        .setTitle(name)
        .setDescription("共享附件下载")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .addRequestHeader("Authorization", "Bearer $token")
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "课程信息板/$name")
    (ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
    Toast.makeText(ctx, "开始下载：$name（保存到 下载/课程信息板/）", Toast.LENGTH_SHORT).show()
}

@Composable
fun ShareBoardCard(course: Course, courseKey: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val board = Repo.boards[courseKey]
    var tab by rememberSaveable { mutableIntStateOf(0) }   // 0 作业 1 待审 2 附件 3 群
    var editAsg by remember { mutableStateOf<BoardAssignment?>(null) }
    var showAddAsg by remember { mutableStateOf(false) }
    var groupForm by remember { mutableStateOf<BoardGroup?>(null) }   // null=关闭；非 null=编辑/新增
    var showGroupAdd by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    val pendingTotal = (board?.pendingAssignments?.size ?: 0) +
        (board?.pendingFiles?.size ?: 0) + (board?.pendingGroups?.size ?: 0)

    LaunchedEffect(courseKey) { Repo.loadBoard(courseKey) }

    fun refresh() = scope.launch { Repo.loadBoard(courseKey) }
    fun op(toast: String, block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                block()
                Toast.makeText(ctx, toast, Toast.LENGTH_SHORT).show()
                Repo.loadBoard(courseKey)
            } catch (e: Exception) {
                Toast.makeText(ctx, e.message ?: "操作失败", Toast.LENGTH_LONG).show()
            } finally { busy = false }
        }
    }

    // 上传共享附件（系统文件选择器）
    val uploadPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            try {
                val name = ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                    val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (c.moveToFirst() && i >= 0) c.getString(i) else "附件"
                } ?: "附件"
                val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw Exception("读取文件失败")
                Api.boardFileUpload(courseKey, name, bytes)
                Toast.makeText(ctx, "已上传 $name", Toast.LENGTH_SHORT).show()
                Repo.loadBoard(courseKey)
            } catch (e: Exception) {
                Toast.makeText(ctx, e.message ?: "上传失败", Toast.LENGTH_LONG).show()
            }
        }
    }

    @Composable
    fun tabBtn(index: Int, label: String, modifier: Modifier = Modifier) {
        TextButton(
            onClick = { tab = index },
            modifier = modifier,
            colors = androidx.compose.material3.ButtonDefaults.textButtonColors(
                contentColor = if (tab == index) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
            )
        ) { Text(label, fontWeight = if (tab == index) FontWeight.Bold else FontWeight.Normal, fontSize = 13.sp) }
    }

    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("👑 共享板管理", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (pendingTotal > 0) {
                    Text(
                        "$pendingTotal 待审",
                        fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.error,
                        modifier = Modifier
                            .background(MaterialTheme.colorScheme.error.copy(alpha = 0.12f), RoundedCornerShape(999.dp))
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                }
            }
            Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                tabBtn(0, "作业", Modifier.weight(1f))
                tabBtn(1, if (pendingTotal > 0) "待审($pendingTotal)" else "待审", Modifier.weight(1f))
                tabBtn(2, "附件", Modifier.weight(1f))
                tabBtn(3, "群", Modifier.weight(1f))
            }

            if (board == null) {
                Text("加载中…", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 10.dp))
                return@Column
            }

            when (tab) {
                0 -> {
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                        Text("共 ${board.assignments.size} 项 · 自动同步给同课同学", fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                        Button(onClick = { editAsg = null; showAddAsg = true }, enabled = !busy) { Text("＋ 添加") }
                    }
                    if (board.assignments.isEmpty()) {
                        Text("还没有共享作业", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    for (a in board.assignments) {
                        val badge = ddlBadge(a.deadline, false)
                        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp), shape = RoundedCornerShape(10.dp)) {
                            Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp)) {
                                Column(Modifier.weight(1f)) {
                                    Text(a.title, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(
                                        (if (a.deadline.isNullOrBlank()) "无期限" else "📅 " + fmtDeadline(a.deadline)) +
                                            (if (!a.requirement.isNullOrBlank()) " · 有要求" else ""),
                                        fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(top = 2.dp)
                                    )
                                }
                                Box {
                                    var m by remember { mutableStateOf(false) }
                                    TextButton(onClick = { m = true }, enabled = !busy) { Text("✏️") }
                                    DropdownMenu(expanded = m, onDismissRequest = { m = false }) {
                                        DropdownMenuItem(text = { Text("✏️ 编辑") }, onClick = { m = false; editAsg = a })
                                        DropdownMenuItem(text = { Text("🗑 删除", color = MaterialTheme.colorScheme.error) },
                                            onClick = { m = false; op("已删除并同步") { Api.boardDeleteAssignment(courseKey, a.id) } })
                                    }
                                }
                            }
                        }
                    }
                }

                1 -> {
                    if (pendingTotal == 0) {
                        Text("没有待审的成员投稿", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 10.dp))
                    }
                    for (a in board.pendingAssignments) {
                        PendingRow(
                            key0 = "pa-" + a.id,
                            title = a.title,
                            meta = (if (!a.deadline.isNullOrBlank()) "截止 " + fmtDeadline(a.deadline) else "无截止") +
                                " · 来自 " + maskXh(a.xh),
                            onApprove = { op("已通过并同步") { Api.boardReviewAssignment(courseKey, a.id, true) } },
                            onReject = { op("已驳回") { Api.boardReviewAssignment(courseKey, a.id, false) } }
                        )
                    }
                    for (f in board.pendingFiles) {
                        PendingRow(
                            key0 = "pf-" + f.id,
                            title = "📎 " + f.name,
                            meta = fmtSize(f.size) + " · 来自 " + maskXh(f.xh),
                            onApprove = { op("已通过并同步") { Api.boardReviewFile(courseKey, f.id, true) } },
                            onReject = { op("已驳回") { Api.boardReviewFile(courseKey, f.id, false) } }
                        )
                    }
                    for (pg in board.pendingGroups) {
                        PendingRow(
                            key0 = "pg-" + pg.pid,
                            title = (if (pg.action == "edit") "✏️ 修改群申请" else "➕ 添加群申请") +
                                "（来自 " + maskXh(pg.xh) + "）",
                            meta = listOf(pg.group?.type, pg.group?.num, pg.group?.link).filterNotNull()
                                .filter { it.isNotBlank() }.joinToString(" · ").ifBlank { "（空）" },
                            onApprove = { op("已通过并同步") { Api.boardGroupReview(courseKey, pg.pid, true) } },
                            onReject = { op("已驳回") { Api.boardGroupReview(courseKey, pg.pid, false) } }
                        )
                    }
                }

                2 -> {
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("共 ${board.files.size} 个 · 全班可下载", fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                        Button(onClick = { uploadPicker.launch(arrayOf("*/*")) }, enabled = !busy) { Text("⬆️ 上传") }
                    }
                    if (board.files.isEmpty()) {
                        Text("还没有共享附件", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    for (f in board.files) {
                        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp), shape = RoundedCornerShape(10.dp)) {
                            Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("📎 " + f.name, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(fmtSize(f.size), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                TextButton(onClick = { downloadBoardFile(ctx, courseKey, f.id, f.name) }) { Text("下载") }
                                TextButton(onClick = { op("附件已删除并同步") { Api.boardFileDelete(courseKey, f.id) } },
                                    enabled = !busy) { Text("🗑", color = MaterialTheme.colorScheme.error) }
                            }
                        }
                    }
                }

                3 -> {
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("共 ${board.groups.size} 个（≤10）· 改动即同步全班", fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                        Button(onClick = { groupForm = null; showGroupAdd = true }, enabled = !busy) { Text("＋ 添加") }
                    }
                    if (board.groups.isEmpty()) {
                        Text("还没有共享教学群", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    for (g in board.groups) {
                        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp), shape = RoundedCornerShape(10.dp)) {
                            Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp)) {
                                Column(Modifier.weight(1f)) {
                                    Text((g.type ?: "群") + (if (!g.num.isNullOrBlank()) " · " + g.num else ""),
                                        fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                    if (!g.link.isNullOrBlank()) Text(g.link, fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    if (!g.note.isNullOrBlank()) Text(g.note, fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                Box {
                                    var m by remember { mutableStateOf(false) }
                                    TextButton(onClick = { m = true }, enabled = !busy) { Text("✏️") }
                                    DropdownMenu(expanded = m, onDismissRequest = { m = false }) {
                                        DropdownMenuItem(text = { Text("✏️ 编辑") }, onClick = { m = false; groupForm = g; showGroupAdd = true })
                                        DropdownMenuItem(text = { Text("🗑 删除", color = MaterialTheme.colorScheme.error) },
                                            onClick = {
                                                m = false
                                                val gid = g.id ?: return@DropdownMenuItem
                                                op("已删除并同步") { Api.boardGroupDelete(courseKey, gid) }
                                            })
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 共享作业 添加/编辑 对话框
        if (showAddAsg) {
            BoardAssignDialog(
                courseKey = courseKey,
                existing = editAsg,
                onDismiss = { showAddAsg = false }
            )
        }
        // 共享群 添加/编辑 对话框
        if (showGroupAdd) {
            GroupFormDialog(
                courseKey = courseKey,
                existing = groupForm,
                onDismiss = { showGroupAdd = false }
            )
        }
    }
}

/* ---------- 共享作业 添加/编辑 ---------- */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BoardAssignDialog(courseKey: String, existing: BoardAssignment?, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var title by rememberSaveable { mutableStateOf(existing?.title ?: "") }
    var deadline by remember { mutableStateOf<LocalDate?>(existing?.deadline?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }) }
    var requirement by rememberSaveable { mutableStateOf(existing?.requirement ?: "") }
    var showDate by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing == null) "添加共享作业" else "编辑共享作业") },
        text = {
            Column {
                OutlinedTextField(value = title, onValueChange = { title = it },
                    label = { Text("标题 *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = { showDate = true }) {
                        Text(deadline?.format(DateTimeFormatter.ofPattern("截止 yyyy-MM-dd")) ?: "截止日期（可留空）")
                    }
                    if (deadline != null) {
                        Spacer(Modifier.width(8.dp))
                        TextButton(onClick = { deadline = null }) { Text("清空") }
                    }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = requirement, onValueChange = { if (it.length <= 20000) requirement = it },
                    label = { Text("要求 / 说明（可留空，不支持内嵌图片）") }, minLines = 3, modifier = Modifier.fillMaxWidth())
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
                        Api.boardUpsertAssignment(
                            courseKey, existing?.id, title.trim(),
                            deadline?.format(DateTimeFormatter.ofPattern("yyyy-MM-dd")) ?: "",
                            requirement.trim()
                        )
                        Toast.makeText(ctx, "已保存并同步给同课同学", Toast.LENGTH_SHORT).show()
                        Repo.loadBoard(courseKey)
                        onDismiss()
                    } catch (e: Exception) { err = e.message ?: "保存失败" } finally { busy = false }
                }
            }, enabled = !busy) { Text("保存并同步") }
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
                    deadline = st.selectedDateMillis?.let { LocalDate.ofInstant(Instant.ofEpochMilli(it), ZoneOffset.UTC) }
                    showDate = false
                }) { Text("确定") }
            },
            dismissButton = { TextButton(onClick = { showDate = false }) { Text("取消") } }
        ) { DatePicker(state = st) }
    }
}

/* ---------- 共享群 添加/编辑 ---------- */
@Composable
private fun GroupFormDialog(courseKey: String, existing: BoardGroup?, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val TYPES = listOf("QQ群", "微信群", "数智东南群", "课程平台", "其他")
    var type by rememberSaveable { mutableStateOf(existing?.type ?: "QQ群") }
    var num by rememberSaveable { mutableStateOf(existing?.num ?: "") }
    var link by rememberSaveable { mutableStateOf(existing?.link ?: "") }
    var note by rememberSaveable { mutableStateOf(existing?.note ?: "") }
    var typeMenu by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing == null) "添加共享教学群" else "编辑共享教学群") },
        text = {
            Column {
                OutlinedTextField(value = type, onValueChange = {}, label = { Text("类型") }, readOnly = true,
                    trailingIcon = {
                        Box {
                            TextButton(onClick = { typeMenu = true }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) { Text("▾") }
                            DropdownMenu(expanded = typeMenu, onDismissRequest = { typeMenu = false }) {
                                TYPES.forEach { t -> DropdownMenuItem(text = { Text(t) }, onClick = { type = t; typeMenu = false }) }
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = num, onValueChange = { num = it }, label = { Text("群号 / 群名") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = link, onValueChange = { link = it }, label = { Text("加群 / 入口链接（可留空）") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("备注（可留空）") },
                    modifier = Modifier.fillMaxWidth())
                if (err.isNotBlank()) {
                    Text(err, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 6.dp))
                }
            }
        },
        confirmButton = {
            Button(onClick = {
                if (busy) return@Button
                if (num.isBlank() && link.isBlank() && note.isBlank()) { err = "群号、链接、备注至少填一项"; return@Button }
                busy = true
                val g = SyncGroup(id = existing?.id, type = type, num = num.trim(), link = link.trim(), note = note.trim())
                scope.launch {
                    try {
                        if (existing == null) Api.boardGroupAdd(courseKey, g) else Api.boardGroupUpdate(courseKey, existing.id!!, g)
                        Toast.makeText(ctx, "已保存并同步给同课同学", Toast.LENGTH_SHORT).show()
                        Repo.loadBoard(courseKey)
                        onDismiss()
                    } catch (e: Exception) { err = e.message ?: "保存失败" } finally { busy = false }
                }
            }, enabled = !busy) { Text("保存并同步") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}

/* 待审投稿行（作业/附件/群申请通用） */
@Composable
private fun PendingRow(key0: String, title: String, meta: String, onApprove: () -> Unit, onReject: () -> Unit) {
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp), shape = RoundedCornerShape(10.dp)) {
        Column(Modifier.padding(10.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(meta, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
            Row(Modifier.padding(top = 6.dp)) {
                TextButton(onClick = onApprove, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 0.dp)) {
                    Text("✅ 通过并同步", fontSize = 12.sp)
                }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = onReject, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 0.dp)) {
                    Text("❌ 驳回", fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}
