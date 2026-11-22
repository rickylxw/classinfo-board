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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import io.github.rickylxw.classinfoboard.data.Assignment
import io.github.rickylxw.classinfoboard.data.Course
import io.github.rickylxw.classinfoboard.data.Prefs
import io.github.rickylxw.classinfoboard.data.Repo
import io.github.rickylxw.classinfoboard.data.courseKeyOf
import io.github.rickylxw.classinfoboard.data.ddlBadge
import io.github.rickylxw.classinfoboard.data.fmtDeadline
import io.github.rickylxw.classinfoboard.data.fmtSize
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CourseDetailScreen(courseId: String, pad: PaddingValues, onBack: () -> Unit, onFeedback: (String) -> Unit = {}) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var opBusy by remember { mutableStateOf(false) }
    var showAdd by remember { mutableStateOf(false) }
    var showSubmit by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<Assignment?>(null) }
    var showReqFor by remember { mutableStateOf<String?>(null) }

    val d = Repo.data
    val course: Course? = d?.courses?.firstOrNull { it.id == courseId }
    val key = course?.let { courseKeyOf(it.name, it.teacher) }
    val board = key?.let { Repo.syncMap[it] }

    // 课程负责人状态（申请/审核中/在任），决定详情页是否出现共享板管理卡
    var shareInfo by remember { mutableStateOf<io.github.rickylxw.classinfoboard.data.ShareStatus?>(null) }
    val isOwner = shareInfo?.isOwner == true
    val canPush = Prefs.loggedIn && !Repo.adminMode && !isOwner
    LaunchedEffect(course?.id, Prefs.loggedIn, Repo.adminMode) {
        shareInfo = null
        if (course != null && Prefs.loggedIn && !Repo.adminMode) {
            shareInfo = runCatching { Api.shareStatus(course.name, course.teacher ?: "") }.getOrNull()
        }
    }
    val filePick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && key != null) scope.launch {
            try {
                val name = ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                    val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (c.moveToFirst() && i >= 0) c.getString(i) else "附件"
                } ?: "附件"
                val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw Exception("读取文件失败")
                Api.boardFileSubmit(key, name, bytes)
                Toast.makeText(ctx, "附件投稿已提交，待审核", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(ctx, e.message ?: "投稿失败", Toast.LENGTH_LONG).show()
            }
        }
    }

    fun run(op: suspend () -> Unit) {
        if (opBusy) return
        opBusy = true
        scope.launch { try { op() } finally { opBusy = false } }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(course?.name ?: "个人待办", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") }
                },
                actions = {
                    IconButton(onClick = { showAdd = true }) { Icon(Icons.Filled.Add, contentDescription = "添加作业") }
                }
            )
        }
    ) { p ->
        if (d == null) {
            Column(Modifier.padding(p).fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center) {
                Text("加载中/无数据", color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onBack) { Text("返回") }
            }
            return@Scaffold
        }

        LazyColumn(Modifier.padding(p).fillMaxSize(), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 32.dp)) {
            // ---------- 课程头 ----------
            if (course != null) {
                item {
                    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
                        Column(Modifier.padding(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(12.dp).background(colorOf(course.color), CircleShape))
                                Spacer(Modifier.width(8.dp))
                                Text(course.name, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            }
                            val meta = listOfNotNull(
                                course.category, course.teacher, course.semester
                            ).filter { it.isNotBlank() }
                            if (meta.isNotEmpty()) {
                                Text(meta.joinToString(" · "), fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(top = 4.dp))
                            }
                            // 负责人状态芯片 / 申请入口
                            if (!Repo.adminMode) {
                                val si = shareInfo
                                when {
                                    si?.isOwner == true ->
                                        Text("👑 我是课程负责人 · 共享板对同课同学开放",
                                            fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                                            color = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.padding(top = 6.dp))
                                    si?.status == "pending" ->
                                        Text("⏳ 负责人申请审核中", fontSize = 12.sp,
                                            color = Color(0xFFB45309), modifier = Modifier.padding(top = 6.dp))
                                    si?.status == "rejected" ->
                                        Text("🚫 申请已驳回（不可重新申请）", fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 6.dp))
                                    si != null && !si.hasOwner ->
                                        TextButton(onClick = {
                                            scope.launch {
                                                runCatching { Api.applyShare(course.name, course.teacher ?: "") }
                                                    .onSuccess {
                                                        Toast.makeText(ctx, "已提交申请，等待管理员审核", Toast.LENGTH_SHORT).show()
                                                        shareInfo = runCatching { Api.shareStatus(course.name, course.teacher ?: "") }.getOrNull()
                                                    }
                                                    .onFailure { Toast.makeText(ctx, it.message ?: "提交失败", Toast.LENGTH_LONG).show() }
                                            }
                                        }, contentPadding = PaddingValues(0.dp)) {
                                            Text("📨 申请成为课程负责人", fontSize = 13.sp)
                                        }
                                    si?.hasOwner == true ->
                                        Text("👑 课程负责人已设定 · 班级同步开启", fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            modifier = Modifier.padding(top = 6.dp))
                                }
                            }
                        }
                    }
                }
                // 负责人：共享板管理卡
                if (isOwner && key != null) {
                    item { ShareBoardCard(course, key) }
                }
            }

            // ---------- 作业与 DDL ----------
            item {
                Row(Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("📝 作业与 DDL", fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.weight(1f))
                    if (key != null && !Repo.adminMode) {
                        TextButton(onClick = { showSubmit = true }, enabled = !opBusy) { Text("📤 投稿作业") }
                    }
                }
            }
            val own = d.assignments
                .filter { it.courseId == courseId && !it.archived }
                .sortedWith(compareBy({ it.status == "done" }, { it.deadline ?: "9999" }))
            if (own.isEmpty() && (board == null || board.assignments.isEmpty())) {
                item { Text("暂无作业记录", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 10.dp)) }
            }
            for (a in own) {
                item(key = "own-" + a.id) {
                    DetailAssignmentRow(
                        title = a.title, deadline = a.deadline, requirement = a.requirement,
                        done = a.status == "done", syncFrom = null,
                        showReq = showReqFor == a.id,
                        onToggleShowReq = { showReqFor = if (showReqFor == a.id) null else a.id },
                        onToggleDone = { run { Repo.toggleDone(a) } },
                        onArchive = { run { Repo.archive(a) } },
                        onDelete = { confirmDelete = a }
                    )
                }
            }
            if (board != null) {
                for (sa in board.assignments) {
                    val st = d.syncStatus[sa.id]
                    if (st == "archived") continue
                    item(key = "sync-" + sa.id) {
                        DetailAssignmentRow(
                            modifier = Modifier.animateItem(),
                            title = sa.title, deadline = sa.deadline, requirement = sa.requirement,
                            done = st == "done", syncFrom = board.from ?: "班级同步",
                            showReq = showReqFor == sa.id,
                            onToggleShowReq = { showReqFor = if (showReqFor == sa.id) null else sa.id },
                            onToggleDone = { run { Repo.toggleSynced(sa.id) } },
                            onArchive = { run { Repo.archiveSynced(sa.id) } },
                            onDelete = null,
                            onCopy = {
                                run {
                                    Repo.add(sa.title, courseId, sa.deadline, sa.requirement ?: "")
                                    Toast.makeText(ctx, "已复制为我的作业", Toast.LENGTH_SHORT).show()
                                }
                            }
                        )
                    }
                }
            }

            // ---------- 共享附件（班级同步） ----------
            if (!isOwner && board != null && board.files.isNotEmpty() && course != null) {
                item { Text("📎 共享附件", fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 12.dp, bottom = 4.dp)) }
                for (bf in board.files) {
                    item(key = "bf-" + bf.id) {
                        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp), shape = RoundedCornerShape(10.dp)) {
                            Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("📎 " + bf.name, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(fmtSize(bf.size) + " · 来自 " + (board.from ?: "班级同步"), fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                TextButton(onClick = {
                                    if (key != null) downloadBoardFile(ctx, key, bf.id, bf.name)
                                }) { Text("下载") }
                            }
                        }
                    }
                }
            }

            // ---------- 教学群 ----------
            if (course != null) {
                item {
                    Text("👥 教学群", fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(top = 18.dp, bottom = 6.dp))
                }
                val groups = board?.groups.orEmpty()
                if (groups.isEmpty()) {
                    item { Text("本课暂无共享教学群", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                for (g in groups) {
                    item(key = "g-" + g.idSuffix()) {
                        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp), shape = RoundedCornerShape(10.dp)) {
                            Column(Modifier.padding(10.dp)) {
                                Text((g.type ?: "群") + (if (!g.num.isNullOrBlank()) " · " + g.num else ""), fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                if (!g.note.isNullOrBlank()) Text(g.note, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Row(Modifier.padding(top = 4.dp)) {
                                    if (!g.num.isNullOrBlank()) TextButton(onClick = {
                                        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                                        cm.setPrimaryClip(android.content.ClipData.newPlainText("群号", g.num))
                                        Toast.makeText(ctx, "已复制群号 " + g.num, Toast.LENGTH_SHORT).show()
                                    }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) { Text("复制群号") }
                                    if (!g.link.isNullOrBlank()) TextButton(onClick = {
                                        runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(g.link))) }
                                            .onFailure { Toast.makeText(ctx, "链接无效", Toast.LENGTH_SHORT).show() }
                                    }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) { Text("打开链接") }
                                }
                            }
                        }
                    }
                }
            }

            // ---------- 文件 ----------
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("📁 文件", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 18.dp, bottom = 6.dp))
                    Spacer(Modifier.weight(1f))
                    if (canPush && key != null && !isOwner) {
                        TextButton(onClick = { filePick.launch(arrayOf("*/*")) }, enabled = !opBusy) { Text("📤 投稿附件") }
                    }
                }
            }
            val files = d.files.filter { it.courseId == courseId }
            if (files.isEmpty()) {
                item { Text("暂无自己的文件（上传请用网页端或桌面端）", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            for (f in files) {
                item(key = "f-" + f.id) {
                    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp), shape = RoundedCornerShape(10.dp)) {
                        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(f.name ?: f.id, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    (if (f.kind == "link") "链接" else fmtSize(f.size)) +
                                        (f.note?.takeIf { it.isNotBlank() }?.let { " · " + it } ?: ""),
                                    fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            TextButton(onClick = {
                                if (f.kind == "link" && !f.url.isNullOrBlank()) {
                                    runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(f.url))) }
                                        .onFailure { Toast.makeText(ctx, "链接无效", Toast.LENGTH_SHORT).show() }
                                } else {
                                    downloadCourseFile(ctx, f.id, f.name ?: f.id)
                                }
                            }) { Text(if (f.kind == "link") "打开" else "下载") }
                        }
                    }
                }
            }
        }

        confirmDelete?.let { a ->
            AlertDialog(
                onDismissRequest = { confirmDelete = null },
                title = { Text("删除作业") },
                text = { Text("删除「${a.title}」？云端会同步删除，不可恢复。") },
                confirmButton = {
                    TextButton(onClick = {
                        val target = a; confirmDelete = null
                        run { Repo.delete(target) }
                    }) { Text("删除", color = MaterialTheme.colorScheme.error) }
                },
                dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("取消") } }
            )
        }
        if (showAdd) {
            AddAssignmentDialog(presetCourseId = courseId, onDismiss = { showAdd = false })
        }
        if (showSubmit && key != null) {
            SubmitBoardDialog(courseKey = key, courseName = course?.name ?: "", onDismiss = { showSubmit = false })
        }
        // 错误统一浮层（Repo.error 已在仪表盘展示，这里仅操作失败 Toast）
        val errSnap = Repo.error
        LaunchedEffect(errSnap) {
            if (errSnap.isNotBlank() && errSnap.startsWith("云端同步失败")) Toast.makeText(ctx, errSnap, Toast.LENGTH_LONG).show()
        }
    }
}

private fun io.github.rickylxw.classinfoboard.data.SyncGroup.idSuffix(): String =
    id ?: ((num ?: "") + "|" + (type ?: "") + "|" + (note?.take(10) ?: ""))

/** 附件下载：走系统下载器（带 Bearer 头，落公共 Download/课程信息板/） */
fun downloadCourseFile(ctx: Context, id: String, name: String) {
    val token = Prefs.token ?: return
    val req = DownloadManager.Request(Uri.parse(Prefs.serverUrl.trimEnd('/') + "/api/files/" + id))
        .setTitle(name)
        .setDescription("课程信息板附件下载")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .addRequestHeader("Authorization", "Bearer $token")
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "课程信息板/$name")
    (ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
    Toast.makeText(ctx, "开始下载：$name（保存到 下载/课程信息板/）", Toast.LENGTH_SHORT).show()
}

/** 单条作业行（课程详情版：含要求展开、归档/删除菜单；同步项无删除、可复制为我的作业） */
@Composable
private fun DetailAssignmentRow(
    modifier: Modifier = Modifier,
    title: String,
    deadline: String?,
    requirement: String?,
    done: Boolean,
    syncFrom: String?,
    showReq: Boolean,
    onToggleShowReq: () -> Unit,
    onToggleDone: () -> Unit,
    onArchive: () -> Unit,
    onDelete: (() -> Unit)?,
    onCopy: (() -> Unit)? = null
) {
    var menu by remember { mutableStateOf(false) }
    val badge = ddlBadge(deadline, done)
    val badgeBg = when (badge.level) {
        2 -> MaterialTheme.colorScheme.error.copy(alpha = 0.12f)
        1 -> Color(0xFFB45309).copy(alpha = 0.14f)
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    val badgeFg = when (badge.level) {
        2 -> MaterialTheme.colorScheme.error
        1 -> Color(0xFFB45309)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Card(modifier.fillMaxWidth().padding(vertical = 4.dp), shape = RoundedCornerShape(10.dp)) {
        Row(Modifier.padding(start = 8.dp, end = 4.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.Top) {
            IconButton(onClick = onToggleDone, modifier = Modifier.size(36.dp)) {
                Icon(
                    Icons.Filled.CheckCircle, contentDescription = "标完成",
                    tint = if (done) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outlineVariant,
                    modifier = Modifier.size(24.dp)
                )
            }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false))
                    syncFrom?.let {
                        Spacer(Modifier.width(6.dp))
                        Text("同步·$it", fontSize = 10.sp, color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f), RoundedCornerShape(999.dp))
                                .padding(horizontal = 6.dp, vertical = 1.dp))
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 3.dp)) {
                    Text(badge.text, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = badgeFg,
                        modifier = Modifier.background(badgeBg, RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 2.dp))
                    val whenTxt = fmtDeadline(deadline)
                    if (whenTxt.isNotBlank()) {
                        Spacer(Modifier.width(8.dp))
                        Text("📅 $whenTxt", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (!requirement.isNullOrBlank()) {
                        Spacer(Modifier.width(8.dp))
                        Text("作业要求 " + if (showReq) "▴" else "▾", fontSize = 11.sp, color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.clickable(onClick = onToggleShowReq).padding(vertical = 2.dp))
                    }
                }
                if (showReq && !requirement.isNullOrBlank()) {
                    Text(requirement, fontSize = 12.sp, lineHeight = 17.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .padding(top = 6.dp)
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                            .padding(8.dp))
                }
            }
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.MoreVert, contentDescription = "更多")
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    onCopy?.let { copy ->
                        DropdownMenuItem(text = { Text("📋 复制为我的作业") }, onClick = { menu = false; copy() })
                    }
                    DropdownMenuItem(text = { Text("📦 归档") }, onClick = { menu = false; onArchive() })
                    if (onDelete != null) {
                        DropdownMenuItem(text = { Text("🗑 删除", color = MaterialTheme.colorScheme.error) },
                            onClick = { menu = false; onDelete() })
                    }
                }
            }
        }
    }
}
