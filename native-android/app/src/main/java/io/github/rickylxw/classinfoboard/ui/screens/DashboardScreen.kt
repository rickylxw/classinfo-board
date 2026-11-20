package io.github.rickylxw.classinfoboard.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rickylxw.classinfoboard.data.PendingItem
import io.github.rickylxw.classinfoboard.data.Prefs
import io.github.rickylxw.classinfoboard.data.Repo
import io.github.rickylxw.classinfoboard.data.ddlBadge
import io.github.rickylxw.classinfoboard.data.fmtDeadline
import io.github.rickylxw.classinfoboard.data.pendingItems
import io.github.rickylxw.classinfoboard.data.stats
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(pad: PaddingValues, onNeedLogin: () -> Unit, onFeedback: (String) -> Unit = {}) {
    val scope = rememberCoroutineScope()
    var opBusy by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<PendingItem?>(null) }

    LaunchedEffect(Unit) {
        Repo.ensureLoaded()
        // 会话被后端判失效时 ensureLoaded 已清会话，这里感知回登录页
        if (!Prefs.loggedIn) onNeedLogin()
    }

    fun run(op: suspend () -> Unit) {
        if (opBusy) return
        opBusy = true
        scope.launch {
            try { op() } finally { opBusy = false }
        }
    }

    Column(Modifier.padding(pad)) {
        TopAppBar(
            title = {
                Column {
                    Text("课程信息板", fontWeight = FontWeight.Bold)
                    Text(
                        "👤 " + (Prefs.xh ?: ""),
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            },
            actions = {
                if (Repo.busy) CircularProgressIndicator(Modifier.size(20.dp).padding(end = 14.dp), strokeWidth = 2.dp)
                IconButton(onClick = { run { Repo.refresh() } }, enabled = !Repo.busy) {
                    Icon(Icons.Filled.Refresh, contentDescription = "刷新")
                }
            }
        )

        Repo.error.takeIf { it.isNotBlank() }?.let { msg ->
            Card(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(msg, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                    TextButton(onClick = { onFeedback("故障：$msg\n（页面：仪表盘）") }) { Text("反馈") }
                    TextButton(onClick = { run { Repo.refresh() } }) { Text("重试") }
                }
            }
        }

        val d = Repo.data
        if (Repo.adminMode) {
            Empty("🛡", "管理员会话请使用网页/桌面端管理台，本端为班级成员视图")
            return@Column
        }
        if (d == null) {
            if (Repo.busy) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            else Empty("😕", "加载失败，点右上角刷新重试")
            return@Column
        }

        val items = pendingItems(d, Repo.syncMap)
        val st = stats(d, Repo.syncMap)

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            StatCard(Modifier.weight(1f), "📚 ${st["courses"] ?: 0}", "课程")
            StatCard(Modifier.weight(1f), "⏰ ${st["over"] ?: 0}", "已逾期")
            StatCard(Modifier.weight(1f), "📌 ${st["soon"] ?: 0}", "7天内")
            StatCard(Modifier.weight(1f), "📝 ${st["pending"] ?: 0}", "待办")
        }

        if (items.isEmpty()) {
            Empty("🎉", if ((st["courses"] ?: 0) == 0) "还没有课程——先在网页/桌面端导入课表或新建课程" else "没有待办作业，好好休息！")
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 88.dp)
            ) {
                items(items, key = { it.id }) { it ->
                    AssignmentRow(
                        it,
                        enabled = !opBusy,
                        onToggle = { p -> run { if (p.from == null) Repo.toggleDone(p.toAssignment(d)) else Repo.toggleSynced(p.syncId) } },
                        onArchive = { p -> run { if (p.from == null) Repo.archive(p.toAssignment(d)) else Repo.archiveSynced(p.syncId) } },
                        onDelete = { confirmDelete = it }
                    )
                }
            }
        }
    }

    confirmDelete?.let { p ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("删除作业") },
            text = { Text("删除「${p.title}」？云端会同步删除，不可恢复。") },
            confirmButton = {
                TextButton(onClick = {
                    val target = p; confirmDelete = null
                    run {
                        val dd = Repo.data ?: return@run
                        Repo.delete(target.toAssignment(dd))
                    }
                }) { Text("删除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("取消") } }
        )
    }
}

/* PendingItem ↔ Assignment：动作需要完整记录（title/deadline/status 等） */
private fun PendingItem.toAssignment(d: io.github.rickylxw.classinfoboard.data.CloudData) =
    d.assignments.first { it.id == id.removePrefix("own-") }

private val PendingItem.syncId: String get() = id.removePrefix("sync-")

@Composable
private fun Empty(icon: String, text: String) {
    Column(
        Modifier.fillMaxSize().padding(top = 60.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(icon, fontSize = 40.sp)
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp, start = 24.dp, end = 24.dp))
    }
}

@Composable
private fun StatCard(modifier: Modifier, num: String, label: String) {
    Card(modifier, shape = RoundedCornerShape(12.dp)) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            Text(num, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun AssignmentRow(
    it: PendingItem,
    enabled: Boolean,
    onToggle: (PendingItem) -> Unit,
    onArchive: (PendingItem) -> Unit,
    onDelete: (PendingItem) -> Unit
) {
    var menu by remember { mutableStateOf(false) }
    val badge = ddlBadge(it.deadline, it.done)
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
    Card(Modifier.fillMaxWidth().padding(vertical = 5.dp), shape = RoundedCornerShape(12.dp)) {
        Row(Modifier.padding(start = 8.dp, end = 4.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.Top) {
            // 完成/撤销完成：列表只显示未完成项，点击后该项移出（完成在归档页可找回）
            IconButton(onClick = { onToggle(it) }, enabled = enabled, modifier = Modifier.size(40.dp)) {
                Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = "标完成",
                    tint = MaterialTheme.colorScheme.outlineVariant,
                    modifier = Modifier.size(26.dp)
                )
            }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(10.dp).background(
                            runCatching { Color(android.graphics.Color.parseColor(it.color ?: "#64748B")) }
                                .getOrDefault(Color(0xFF64748B)),
                            CircleShape
                        )
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        it.courseName, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    it.from?.let { from ->
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "同步·$from", fontSize = 10.sp, color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier
                                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f), RoundedCornerShape(999.dp))
                                .padding(horizontal = 6.dp, vertical = 1.dp)
                        )
                    }
                }
                Text(it.title, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    Text(
                        badge.text, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = badgeFg,
                        modifier = Modifier.background(badgeBg, RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                    val whenTxt = fmtDeadline(it.deadline)
                    if (whenTxt.isNotBlank()) {
                        Spacer(Modifier.width(8.dp))
                        Text("📅 $whenTxt", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Box {
                IconButton(onClick = { menu = true }, enabled = enabled, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Filled.MoreVert, contentDescription = "更多")
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("📦 归档") }, onClick = { menu = false; onArchive(it) })
                    if (it.from == null) {
                        DropdownMenuItem(text = { Text("🗑 删除", color = MaterialTheme.colorScheme.error) },
                            onClick = { menu = false; onDelete(it) })
                    } else {
                        DropdownMenuItem(text = { Text("归档仅自己隐藏，共享板保留") },
                            onClick = { menu = false }, enabled = false)
                    }
                }
            }
        }
    }
}

/** 供后续屏幕复用的小输入（占位保留） */
@Composable
internal fun FieldLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
