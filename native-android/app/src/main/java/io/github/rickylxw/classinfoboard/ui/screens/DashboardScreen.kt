package io.github.rickylxw.classinfoboard.ui.screens

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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.widget.Toast
import io.github.rickylxw.classinfoboard.data.PendingItem
import io.github.rickylxw.classinfoboard.data.Prefs
import io.github.rickylxw.classinfoboard.data.Repo
import io.github.rickylxw.classinfoboard.data.ddlBadge
import io.github.rickylxw.classinfoboard.data.fmtDeadline
import io.github.rickylxw.classinfoboard.data.pendingItems
import io.github.rickylxw.classinfoboard.data.stats
import io.github.rickylxw.classinfoboard.data.weekNumberOf
import io.github.rickylxw.classinfoboard.ui.theme.isAppDark
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    pad: PaddingValues,
    onNeedLogin: () -> Unit,
    onFeedback: (String) -> Unit = {},
    onOpenCourse: (String) -> Unit = {},
    onOpenSettings: () -> Unit = {}
) {
    val scope = rememberCoroutineScope()
    var opBusy by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<PendingItem?>(null) }
    var statFilter by rememberSaveable { mutableStateOf("") }   // "" | overdue | soon
    var showReqFor by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        Repo.ensureLoaded()
        if (!Prefs.loggedIn) onNeedLogin()
    }

    fun run(op: suspend () -> Unit) {
        if (opBusy) return
        opBusy = true
        scope.launch { try { op() } finally { opBusy = false } }
    }

    val hour = remember { LocalTime.now().hour }
    val greet = when (hour) {
        in 5..8 -> "早上好"
        in 9..11 -> "上午好"
        in 12..13 -> "中午好"
        in 14..17 -> "下午好"
        in 18..22 -> "晚上好"
        else -> "夜深了"
    }
    val today = remember { LocalDate.now() }
    val wd = when (today.dayOfWeek.value) {
        1 -> "周一"; 2 -> "周二"; 3 -> "周三"; 4 -> "周四"; 5 -> "周五"; 6 -> "周六"; else -> "周日"
    }
    val dateLine = today.format(DateTimeFormatter.ofPattern("M月d日 ")) + wd +
        (weekNumberOf(today, Repo.semStart)?.let { " · 第 $it 教学周" } ?: "")

    Column(Modifier.padding(pad)) {
        TopAppBar(
            title = {
                Column {
                    Text(greet, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "$dateLine · 👤 " + (Prefs.xh ?: ""),
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
                IconButton(onClick = onOpenSettings) {
                    Icon(Icons.Filled.Settings, contentDescription = "设置")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent)
        )

        Repo.error.takeIf { it.isNotBlank() }?.let { errorMsg ->
            Card(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
            ) {
                Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(errorMsg, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.weight(1f))
                    TextButton(onClick = { onFeedback("故障：$errorMsg\n（页面：仪表盘）") }) { Text("反馈") }
                    TextButton(onClick = { run { Repo.refresh() } }) { Text("重试") }
                }
            }
        }

        val d = Repo.data
        if (Repo.adminMode) {
            EmptyState("🛡", "管理员会话请使用网页端管理台", "本端为班级成员视图")
            return@Column
        }
        if (d == null) {
            if (Repo.busy) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            else EmptyState("😕", "加载失败", "点右上角刷新重试")
            return@Column
        }

        val items0 = pendingItems(d, Repo.syncMap)
        val nowMs = System.currentTimeMillis()
        val items = when (statFilter) {
            "overdue" -> items0.filter { p ->
                p.deadline != null && runCatching {
                    java.time.LocalDateTime.parse(p.deadline).isBefore(java.time.LocalDateTime.now())
                }.getOrDefault(false)
            }
            "soon" -> items0.filter { p ->
                p.deadline != null && runCatching {
                    val t = java.time.LocalDateTime.parse(p.deadline)
                    !t.isBefore(java.time.LocalDateTime.now()) &&
                        !t.isAfter(java.time.LocalDateTime.now().plusDays(7))
                }.getOrDefault(false)
            }
            else -> items0
        }
        val st = stats(d, Repo.syncMap)
        val dark = isAppDark()

        // 统计 2×2（可点筛选）
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatCard(
                    Modifier.weight(1f),
                    pickTonal(dark, TonalViolet, TonalVioletDark),
                    Icons.Filled.List, "${st["courses"] ?: 0}", "课程",
                    selected = statFilter.isEmpty(),
                    onClick = { statFilter = "" }
                )
                StatCard(
                    Modifier.weight(1f),
                    pickTonal(dark, TonalRed, TonalRedDark),
                    Icons.Filled.Warning, "${st["over"] ?: 0}", "已逾期",
                    selected = statFilter == "overdue",
                    onClick = { statFilter = "overdue" }
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatCard(
                    Modifier.weight(1f),
                    pickTonal(dark, TonalAmber, TonalAmberDark),
                    Icons.Filled.Notifications, "${st["soon"] ?: 0}", "7 天内截止",
                    selected = statFilter == "soon",
                    onClick = { statFilter = "soon" }
                )
                StatCard(
                    Modifier.weight(1f),
                    pickTonal(dark, TonalGreen, TonalGreenDark),
                    Icons.Filled.CheckCircle, "${st["pending"] ?: 0}", "待办"
                )
            }
        }

        // 课程快捷入口
        if (d.courses.isNotEmpty()) {
            LazyRow(
                Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(16.dp, 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(d.courses, key = { it.id }) { c ->
                    Surface(
                        onClick = { onOpenCourse(c.id) },
                        shape = RoundedCornerShape(999.dp),
                        color = if (isAppDark()) MaterialTheme.colorScheme.surfaceContainerHigh
                        else MaterialTheme.colorScheme.surfaceContainerLow
                    ) {
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(8.dp).background(colorOf(c.color), CircleShape))
                            Spacer(Modifier.width(6.dp))
                            Text(c.name, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }

        // 待办区标题
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("待办作业", fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Spacer(Modifier.width(8.dp))
            Text(
                "${items.size} 项" + when (statFilter) {
                    "overdue" -> " · 已逾期"
                    "soon" -> " · 7 天内"
                    else -> ""
                },
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (statFilter.isNotEmpty()) {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { statFilter = "" }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                    Text("清除筛选", fontSize = 12.sp)
                }
            }
        }

        if (items.isEmpty()) {
            EmptyState(
                if (items0.isEmpty()) "🎉" else "✅",
                if (statFilter.isNotEmpty()) "该筛选下没有作业"
                else if (d.courses.isEmpty()) "还没有课程——先在网页/桌面端导入课表或新建课程"
                else "没有待办，好好休息！",
                ""
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp, 2.dp, 16.dp, 88.dp)
            ) {
                items(items, key = { it.id }) { it ->
                    AssignmentRow(
                        modifier = Modifier.animateItem(),
                        item = it,
                        enabled = !opBusy,
                        onOpen = if (it.courseId != "personal") { { onOpenCourse(it.courseId) } } else null,
                        showReq = showReqFor == it.id,
                        onToggleShowReq = { showReqFor = if (showReqFor == it.id) null else it.id },
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

private fun PendingItem.toAssignment(d: io.github.rickylxw.classinfoboard.data.CloudData) =
    d.assignments.first { it.id == id.removePrefix("own-") }

private val PendingItem.syncId: String get() = id.removePrefix("sync-")

/* ---------- 统计卡 ---------- */
private data class Tonal(val bg: Color, val fg: Color)
private val TonalViolet = Tonal(Color(0xFFE4E3FF), Color(0xFF4548D1))
private val TonalRed = Tonal(Color(0xFFFEE9E9), Color(0xFFDC2626))
private val TonalAmber = Tonal(Color(0xFFFDF0D7), Color(0xFFB45309))
private val TonalGreen = Tonal(Color(0xFFDFF3EC), Color(0xFF0A9E6F))
private val TonalVioletDark = Tonal(Color(0xFF26274D), Color(0xFFB9BBFA))
private val TonalRedDark = Tonal(Color(0xFF3A2126), Color(0xFFF28B8B))
private val TonalAmberDark = Tonal(Color(0xFF3A2F1A), Color(0xFFF0B45E))
private val TonalGreenDark = Tonal(Color(0xFF14382C), Color(0xFF4FD6A4))

private fun pickTonal(dark: Boolean, light: Tonal, darkT: Tonal) = if (dark) darkT else light

@Composable
private fun StatCard(
    modifier: Modifier,
    tonal: Tonal,
    icon: ImageVector,
    num: String,
    label: String,
    selected: Boolean = false,
    onClick: (() -> Unit)? = null
) {
    Column(
        modifier
            .background(
                if (selected) tonal.fg.copy(alpha = 0.18f) else tonal.bg,
                RoundedCornerShape(16.dp)
            )
            .let { m -> if (onClick != null) m.clickable(onClick = onClick) else m }
            .padding(horizontal = 12.dp, vertical = 12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = tonal.fg, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(5.dp))
            Text(label, fontSize = 11.sp, color = tonal.fg.copy(alpha = 0.9f), fontWeight = FontWeight.SemiBold)
        }
        Text(num, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = tonal.fg, modifier = Modifier.padding(top = 2.dp))
    }
}

@Composable
private fun EmptyState(icon: String, title: String, sub: String) {
    Column(
        Modifier.fillMaxSize().padding(top = 56.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(icon, fontSize = 44.sp)
        Text(title, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp))
        if (sub.isNotBlank()) {
            Text(
                sub, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp, start = 24.dp, end = 24.dp)
            )
        }
    }
}

@Composable
private fun AssignmentRow(
    modifier: Modifier = Modifier,
    item: PendingItem,
    enabled: Boolean,
    onOpen: (() -> Unit)?,
    showReq: Boolean,
    onToggleShowReq: () -> Unit,
    onToggle: (PendingItem) -> Unit,
    onArchive: (PendingItem) -> Unit,
    onDelete: (PendingItem) -> Unit
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    val courseColor = runCatching { Color(android.graphics.Color.parseColor(item.color ?: "#6366F1")) }
        .getOrDefault(Color(0xFF6366F1))
    val badge = ddlBadge(item.deadline, item.done)
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

    Card(
        modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)
    ) {
        Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.Top) {
            // 课程色条
            Box(
                Modifier
                    .padding(top = 4.dp, bottom = 4.dp)
                    .width(4.dp)
                    .height(46.dp)
                    .background(courseColor, RoundedCornerShape(2.dp))
            )
            Spacer(Modifier.width(12.dp))
            IconButton(onClick = { onToggle(item) }, enabled = enabled, modifier = Modifier.size(36.dp)) {
                Icon(
                    Icons.Filled.CheckCircle, contentDescription = "标完成",
                    tint = MaterialTheme.colorScheme.outlineVariant,
                    modifier = Modifier.size(25.dp)
                )
            }
            Column(
                Modifier
                    .weight(1f)
                    .let { m -> if (onOpen != null) m.clickable(onClick = onOpen) else m }
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        item.courseName, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                        color = courseColor,
                        modifier = Modifier
                            .background(courseColor.copy(alpha = 0.13f), RoundedCornerShape(999.dp))
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                    item.from?.let { from ->
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "同步·$from", fontSize = 10.sp, color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier
                                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f), RoundedCornerShape(999.dp))
                                .padding(horizontal = 6.dp, vertical = 1.dp)
                        )
                    }
                }
                Text(
                    item.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                    modifier = Modifier.padding(top = 4.dp),
                    maxLines = 2, overflow = TextOverflow.Ellipsis
                )
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    Text(
                        badge.text, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = badgeFg,
                        modifier = Modifier.background(badgeBg, RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                    val whenTxt = fmtDeadline(item.deadline)
                    if (whenTxt.isNotBlank()) {
                        Spacer(Modifier.width(8.dp))
                        Text("📅 $whenTxt", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (!item.requirement.isNullOrBlank()) {
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "作业要求 " + if (showReq) "▴" else "▾",
                            fontSize = 11.sp, color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.clickable(onClick = onToggleShowReq)
                        )
                    }
                }
                if (showReq && !item.requirement.isNullOrBlank()) {
                    Text(
                        item.requirement, fontSize = 12.sp, lineHeight = 17.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .padding(top = 6.dp)
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                            .padding(8.dp)
                    )
                }
            }
            Box {
                IconButton(onClick = { menu = true }, enabled = enabled, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.MoreVert, contentDescription = "更多")
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (item.from != null) {
                        DropdownMenuItem(text = { Text("📋 复制为我的作业") }, onClick = {
                            menu = false
                            scope.launch {
                                Repo.add(item.title, item.courseId, item.deadline, item.requirement ?: "")
                                Toast.makeText(ctx, "已复制为我的作业", Toast.LENGTH_SHORT).show()
                            }
                        })
                    }
                    DropdownMenuItem(text = { Text("📦 归档") }, onClick = { menu = false; onArchive(item) })
                    if (onDelete != null) {
                        DropdownMenuItem(text = { Text("🗑 删除", color = MaterialTheme.colorScheme.error) },
                            onClick = { menu = false; onDelete(item) })
                    }
                }
            }
        }
    }
}
