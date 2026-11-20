package io.github.rickylxw.classinfoboard.ui

import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import io.github.rickylxw.classinfoboard.data.Prefs
import io.github.rickylxw.classinfoboard.data.Repo
import io.github.rickylxw.classinfoboard.ui.screens.AddAssignmentDialog
import io.github.rickylxw.classinfoboard.ui.screens.DashboardScreen
import io.github.rickylxw.classinfoboard.ui.screens.LoginScreen
import io.github.rickylxw.classinfoboard.ui.screens.ScheduleScreen
import io.github.rickylxw.classinfoboard.ui.screens.SettingsScreen

@Composable
fun AppRoot() {
    var loggedIn by remember { mutableStateOf(Prefs.loggedIn) }
    var tab by rememberSaveable { mutableIntStateOf(0) } // 0 仪表盘 1 日程 2 设置
    var showAdd by remember { mutableStateOf(false) }

    if (!loggedIn) {
        LoginScreen(onLoggedIn = { loggedIn = true; tab = 0 })
        return
    }

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
            0 -> DashboardScreen(pad, onNeedLogin = { Repo.reset(); loggedIn = false })
            1 -> ScheduleScreen(pad, onNeedLogin = { Repo.reset(); loggedIn = false })
            else -> SettingsScreen(pad, onLoggedOut = { Repo.reset(); loggedIn = false })
        }
    }

    if (showAdd) {
        AddAssignmentDialog(onDismiss = { showAdd = false })
    }
}
