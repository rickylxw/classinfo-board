package io.github.rickylxw.classinfoboard.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import io.github.rickylxw.classinfoboard.data.Prefs
import io.github.rickylxw.classinfoboard.data.Repo
import io.github.rickylxw.classinfoboard.data.Updater
import io.github.rickylxw.classinfoboard.ui.screens.AddAssignmentDialog
import io.github.rickylxw.classinfoboard.ui.screens.CourseDetailScreen
import io.github.rickylxw.classinfoboard.ui.screens.DashboardScreen
import io.github.rickylxw.classinfoboard.ui.screens.FeedbackDialog
import io.github.rickylxw.classinfoboard.ui.screens.LoginScreen
import io.github.rickylxw.classinfoboard.ui.screens.ScheduleScreen
import io.github.rickylxw.classinfoboard.ui.screens.SettingsScreen
import io.github.rickylxw.classinfoboard.ui.screens.UpdateDialog

@Composable
fun AppRoot() {
    val ctx = LocalContext.current
    var loggedIn by remember { mutableStateOf(Prefs.loggedIn) }
    var tab by rememberSaveable { mutableIntStateOf(0) } // 0 仪表盘 1 日程 2 设置
    var showAdd by remember { mutableStateOf(false) }
    var showFeedback by remember { mutableStateOf(false) }
    var feedbackText by remember { mutableStateOf("") }
    var detailCourseId by rememberSaveable { mutableStateOf<String?>(null) }

    // 自动更新检查：启动后静默查一次（8 小时节流），发现新版本弹窗
    LaunchedEffect(Unit) {
        val now = System.currentTimeMillis()
        if (now - Prefs.lastUpdateCheckAt > 8 * 3600_000L) {
            Prefs.lastUpdateCheckAt = now
            Updater.check(ctx, manual = false)
        }
    }

    if (!loggedIn) {
        LoginScreen(onLoggedIn = { loggedIn = true; tab = 0 })
    } else {
        Scaffold(
            bottomBar = {
                NavigationBar {
                    NavigationBarItem(
                        selected = tab == 0, onClick = { tab = 0 },
                        icon = { Icon(Icons.Filled.Home, contentDescription = null) },
                        label = { Text("仪表盘") })
                    NavigationBarItem(
                        selected = tab == 1, onClick = { tab = 1 },
                        icon = { Icon(Icons.Filled.DateRange, contentDescription = null) },
                        label = { Text("日程") })
                    NavigationBarItem(
                        selected = tab == 2, onClick = { tab = 2 },
                        icon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                        label = { Text("设置") })
                }
            },
            floatingActionButton = {
                if (tab == 0) {
                    ExtendedFloatingActionButton(
                        onClick = { showAdd = true },
                        icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                        text = { Text("添加作业") })
                }
            }
        ) { pad: PaddingValues ->
            when (tab) {
                0 -> DashboardScreen(
                    pad,
                    onNeedLogin = { Repo.reset(); loggedIn = false },
                    onFeedback = { prefill -> feedbackText = prefill; showFeedback = true },
                    onOpenCourse = { detailCourseId = it })
                1 -> ScheduleScreen(pad, onNeedLogin = { Repo.reset(); loggedIn = false })
                else -> SettingsScreen(
                    pad,
                    onLoggedOut = { Repo.reset(); loggedIn = false },
                    onFeedback = { prefill -> feedbackText = prefill; showFeedback = true })
            }
        }

        if (showAdd) AddAssignmentDialog(onDismiss = { showAdd = false })
    }

    // 课程详情（全屏覆盖，返回回到原页签）
    if (detailCourseId != null) {
        CourseDetailScreen(
            courseId = detailCourseId!!,
            pad = PaddingValues(0.dp),
            onBack = { detailCourseId = null },
            onFeedback = { prefill -> feedbackText = prefill; showFeedback = true }
        )
    }

    // 更新弹窗：登录前后都可弹出（检查独立于登录态）
    if (Updater.showDialog && Updater.available != null) {
        UpdateDialog(onDismiss = { Updater.dismiss() })
    }
    if (showFeedback) {
        FeedbackDialog(initialType = "bug", initialText = feedbackText, onDismiss = { showFeedback = false })
    }
}
