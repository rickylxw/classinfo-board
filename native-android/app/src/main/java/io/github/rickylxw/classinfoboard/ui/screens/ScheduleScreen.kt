package io.github.rickylxw.classinfoboard.ui.screens

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
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
import androidx.compose.material3.rememberDatePickerState
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
import androidx.core.content.FileProvider
import io.github.rickylxw.classinfoboard.data.CalendarExporter
import io.github.rickylxw.classinfoboard.data.Course
import io.github.rickylxw.classinfoboard.data.Prefs
import io.github.rickylxw.classinfoboard.data.Repo
import io.github.rickylxw.classinfoboard.data.WD_NAMES
import io.github.rickylxw.classinfoboard.data.WeekSlot
import io.github.rickylxw.classinfoboard.data.buildSemesterICS
import io.github.rickylxw.classinfoboard.data.fmtDeadline
import io.github.rickylxw.classinfoboard.data.mondayOf
import io.github.rickylxw.classinfoboard.data.nextClassInfo
import io.github.rickylxw.classinfoboard.data.parseCourseTimes
import io.github.rickylxw.classinfoboard.data.weekNumberOf
import io.github.rickylxw.classinfoboard.data.weekSlots
import kotlinx.coroutines.launch
import java.io.File
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private const val SLOT_H = 44
private const val DAY_W = 108
private const val HEADER_H = 40

fun colorOf(hex: String?): Color =
    runCatching { Color(android.graphics.Color.parseColor(hex ?: "#6366F1")) }
        .getOrDefault(Color(0xFF6366F1))

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleScreen(pad: PaddingValues, onNeedLogin: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var weekOffset by rememberSaveable { mutableStateOf(0) }
    var menu by remember { mutableStateOf(false) }
    var showSemStart by remember { mutableStateOf(false) }
    var calMsg by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        Repo.ensureLoaded()
        // 后端判会话失效时 Repo 会清会话，这里感知后回登录页
        if (!Prefs.loggedIn) onNeedLogin()
    }

    val today = remember { LocalDate.now() }
    val monday = mondayOf(today).plusWeeks(weekOffset.toLong())
    val weekNo = weekNumberOf(monday, Repo.semStart)
    val courses = Repo.data?.courses.orEmpty()
    val slots = remember(courses, weekNo) { weekSlots(courses, weekNo) }
    val todayIdx = if (weekOffset == 0) today.dayOfWeek.value else 0

    // 本周 DDL（我的 + 班级同步），按天分组
    val weekEnd = monday.plusDays(7).atStartOfDay()
    val ddlItems = remember(Repo.data, Repo.syncMap, monday) {
        val d = Repo.data ?: return@remember emptyList<DdlLine>()
        val out = mutableListOf<DdlLine>()
        val inWeek = { dl: String? ->
            if (dl.isNullOrBlank()) null else runCatching {
                java.time.LocalDateTime.parse(dl)
            }.getOrNull()?.takeIf { it >= monday.atStartOfDay() && it < weekEnd }
        }
        d.assignments.filter { !it.archived && it.status != "done" }.forEach { a ->
            inWeek(a.deadline)?.let { t ->
                val c = d.courses.firstOrNull { it.id == a.courseId }
                out.add(DdlLine("own-" + a.id, a.title, c?.name ?: "个人待办", c?.color, null, t, a.deadline))
            }
        }
        for ((key, b) in Repo.syncMap) {
            val c = d.courses.firstOrNull { courseKeyOfMatch(it, key) } ?: continue
            b.assignments.forEach { sa ->
                if (d.syncStatus[sa.id] == "done" || d.syncStatus[sa.id] == "archived") return@forEach
                inWeek(sa.deadline)?.let { t ->
                    out.add(DdlLine("sync-" + sa.id, sa.title, c.name, c.color, b.from, t, sa.deadline))
                }
            }
        }
        out.sortedBy { it.at }
    }

    // 下一节课（顶部提示条）
    val next = remember(courses, Repo.semStart) { nextClassInfo(courses, Repo.semStart) }

    // 写系统日历：READ + WRITE 两个运行时权限都要（查日历账户列表要 READ）
    var calDeny by remember { mutableStateOf(false) }
    suspend fun doImport() {
        val r = CalendarExporter.importTimetable(context, courses, Repo.semStart)
        calMsg = r.error ?: run {
            val base = if (r.written == 0) "没有写入任何事件" else "已写入系统日历 ${r.written} 条事件（重复导入会先清理旧的）"
            if (r.skipped.isEmpty()) base
            else base + "\n⚠️ 跳过 ${r.skipped.size} 门课（备注无可识别上课时间）：" +
                r.skipped.take(3).joinToString("、") + if (r.skipped.size > 3) " 等" else ""
        }
    }
    val calPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (CalendarExporter.allGranted(result)) {
            scope.launch { doImport() }
        } else {
            calDeny = true
        }
    }
    fun requestCal() {
        val read = androidx.core.content.ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR)
        val write = androidx.core.content.ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CALENDAR)
        val allGranted = read == android.content.pm.PackageManager.PERMISSION_GRANTED &&
            write == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (allGranted) scope.launch { doImport() }
        else calPerm.launch(arrayOf(CalendarExporter.PERMISSION_READ, CalendarExporter.PERMISSION_WRITE))
    }

    fun shareIcs() {
        val text = buildSemesterICS(courses, Repo.semStart)
        if (text.isEmpty()) { Toast.makeText(context, "课表为空或未设学期起点", Toast.LENGTH_SHORT).show(); return }
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        val f = File(dir, "kebiao.ics").apply { writeText(text) }
        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", f)
        val i = Intent(Intent.ACTION_SEND)
            .setType("text/calendar")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(i, "分享课表 .ics"))
    }

    Column(Modifier.padding(pad).fillMaxSize()) {
        // 顶部栏
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("📅 日程表", fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(start = 12.dp))
            Spacer(Modifier.weight(1f))
            if (Repo.busy) Text("…", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 4.dp))
            IconButton(onClick = { shareIcs() }) { Icon(Icons.Filled.Share, contentDescription = "分享 .ics") }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "更多") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("🗓 写入系统日历") }, onClick = {
                        menu = false
                        requestCal()
                    })
                    DropdownMenuItem(text = { Text("学期第一周周一：" + (Repo.semStart ?: "未设")) }, onClick = {
                        menu = false; showSemStart = true
                    })
                }
            }
        }

        // 周导航
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { weekOffset--; weekOffset = weekOffset }) {
                Icon(Icons.Filled.KeyboardArrowLeft, contentDescription = "上一周")
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    "${monday.monthValue}/${monday.dayOfMonth} ~ ${monday.plusDays(6).monthValue}/${monday.plusDays(6).dayOfMonth}",
                    fontSize = 13.sp, fontWeight = FontWeight.SemiBold
                )
                Text(
                    if (weekOffset == 0) "本周" + (weekNo?.let { " · 第 $it 教学周" } ?: "") else weekNo?.let { "第 $it 教学周" } ?: " ",
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.primary
                )
            }
            IconButton(onClick = { weekOffset++; weekOffset = weekOffset }) {
                Icon(Icons.Filled.KeyboardArrowRight, contentDescription = "下一周")
            }
            if (weekOffset != 0) TextButton(onClick = { weekOffset = 0 }) { Text("回本周") }
        }

        // 下节课提示
        if (weekOffset == 0 && next != null) {
            Surface(
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)
            ) {
                Text(
                    "🔔 下节课：${next.name}" + (if (next.room.isNotBlank()) " @${next.room}" else "") +
                        " · 第${next.section}节 ${next.at.format(DateTimeFormatter.ofPattern("HH:mm"))}",
                    fontSize = 12.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    maxLines = 1, overflow = TextOverflow.Ellipsis
                )
            }
        }
        if (Repo.semStart.isNullOrBlank()) {
            Text(
                "⚠️ 未设「学期第一周周一」，课表不按周次过滤——右上角菜单设置",
                fontSize = 11.sp, color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
            )
        }
        // 无法解析上课时间的课程（不会显示在网格、也不会导出日历）——口径与网页端一致
        val unparsed = remember(courses) {
            courses.count { it.note?.contains("上课时间") == true && parseCourseTimes(it).isEmpty() }
        }
        if (unparsed > 0) {
            Text(
                "⚠️ 有 $unparsed 门课的备注无法识别上课时间（格式：周X · 第X-Y节 · 周次 · 教室），可在网页端编辑备注或重新拉取课表",
                fontSize = 11.sp, color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
            )
        }

        // 周网格（横向滚动；节次列 + 7 天列）
        Row(Modifier.fillMaxSize().horizontalScroll(rememberScrollState())) {
            // 节次列
            Column(Modifier.width(28.dp)) {
                Box(Modifier.height(HEADER_H.dp))
                for (p in 1..13) {
                    Box(Modifier.height(SLOT_H.dp), contentAlignment = Alignment.Center) {
                        Text("$p", fontSize = 10.sp, color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
            for (day in 1..7) {
                val date = monday.plusDays((day - 1).toLong())
                val isToday = day == todayIdx
                Column(Modifier.width(DAY_W.dp)) {
                    // 日头
                    Box(
                        Modifier.height(HEADER_H.dp).fillMaxWidth()
                            .background(if (isToday) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                WD_NAMES[day - 1] + if (isToday) " · 今" else "",
                                fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                                color = if (isToday) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                "${date.monthValue}/${date.dayOfMonth}",
                                fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    // 时段格 + 课块
                    Box(Modifier.height((SLOT_H * 13).dp).fillMaxWidth()) {
                        Column {
                            for (p in 1..13) {
                                Box(
                                    Modifier.fillMaxWidth().height(SLOT_H.dp)
                                        .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant)
                                ) {}
                            }
                        }
                        slots.filter { it.slot.weekday == day }.forEach { ws ->
                            val span = ws.slot.end - ws.slot.start + 1
                            val c = colorOf(ws.course.color)
                            Box(
                                Modifier
                                    .offset(y = ((ws.slot.start - 1) * SLOT_H + 1).dp)
                                    .padding(horizontal = 1.dp)
                                    .fillMaxWidth()
                                    .height((span * SLOT_H - 2).dp)
                                    .background(c.copy(alpha = 0.16f), RoundedCornerShape(6.dp))
                                    .border(1.5.dp, c, RoundedCornerShape(6.dp))
                                    .padding(horizontal = 4.dp, vertical = 2.dp)
                            ) {
                                Column {
                                    Text(
                                        ws.course.name, fontSize = 10.sp, lineHeight = 13.sp,
                                        fontWeight = FontWeight.SemiBold, maxLines = 3, overflow = TextOverflow.Ellipsis
                                    )
                                    if (ws.slot.room.isNotBlank() && span >= 2) {
                                        Text("@" + ws.slot.room, fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    calMsg?.let { msg ->
        AlertDialog(
            onDismissRequest = { calMsg = null },
            title = { Text("写入系统日历") },
            text = { Text(msg) },
            confirmButton = { TextButton(onClick = { calMsg = null }) { Text("好") } }
        )
    }

    if (calDeny) {
        AlertDialog(
            onDismissRequest = { calDeny = false },
            title = { Text("需要日历权限") },
            text = { Text("把课表写进系统日历需要「日历」读取+写入两项权限（仅用于导入课表事件）。可在系统设置→应用→课程信息板→权限里手动开启。") },
            confirmButton = {
                TextButton(onClick = {
                    calDeny = false
                    runCatching {
                        context.startActivity(
                            Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.fromParts("package", context.packageName, null))
                        )
                    }
                }) { Text("去设置") }
            },
            dismissButton = { TextButton(onClick = { calDeny = false }) { Text("取消") } }
        )
    }

    if (showSemStart) {
        val st = rememberDatePickerState(
            initialSelectedDateMillis = (Repo.semStart ?: LocalDate.now().toString())?.let {
                runCatching { java.time.LocalDate.parse(it).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull()
            }
        )
        DatePickerDialog(
            onDismissRequest = { showSemStart = false },
            confirmButton = {
                TextButton(onClick = {
                    st.selectedDateMillis?.let { ms ->
                        val d = java.time.LocalDate.ofInstant(java.time.Instant.ofEpochMilli(ms), java.time.ZoneOffset.UTC)
                        scope.launch { Repo.setSemStart(d.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))) }
                    }
                    showSemStart = false
                }) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { showSemStart = false }) { Text("取消") } }
        ) {
            DatePicker(state = st)
        }
    }
}

private fun courseKeyOfMatch(c: Course, key: String): Boolean =
    io.github.rickylxw.classinfoboard.data.courseKeyOf(c.name, c.teacher) == key

data class DdlLine(
    val id: String, val title: String, val courseName: String, val color: String?,
    val from: String?, val at: java.time.LocalDateTime, val raw: String?
)
