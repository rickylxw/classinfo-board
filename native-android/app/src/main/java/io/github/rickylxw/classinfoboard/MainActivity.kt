package io.github.rickylxw.classinfoboard

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import io.github.rickylxw.classinfoboard.data.Prefs
import io.github.rickylxw.classinfoboard.ui.AppRoot
import io.github.rickylxw.classinfoboard.ui.theme.AppTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Prefs.init(applicationContext)
        setContent {
            AppTheme {
                AppRoot()
            }
        }
    }
}
