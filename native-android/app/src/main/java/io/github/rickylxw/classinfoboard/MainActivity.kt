package io.github.rickylxw.classinfoboard

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import io.github.rickylxw.classinfoboard.data.LiveSync
import io.github.rickylxw.classinfoboard.data.Prefs
import io.github.rickylxw.classinfoboard.data.Reminders
import io.github.rickylxw.classinfoboard.data.Updater
import io.github.rickylxw.classinfoboard.ui.AppRoot
import io.github.rickylxw.classinfoboard.ui.theme.AppTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Prefs.init(applicationContext)
        Updater.registerDownloadReceiver(applicationContext)
        Reminders.ensureChannel(applicationContext)
        Reminders.scheduleAlarm(applicationContext)
        Reminders.checkAsync(applicationContext)
        setContent {
            AppTheme {
                AppRoot()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        LiveSync.start()   // 前台：挂实时流（省电设计：退后台即断）
    }

    override fun onStop() {
        LiveSync.stop()
        super.onStop()
    }
}
