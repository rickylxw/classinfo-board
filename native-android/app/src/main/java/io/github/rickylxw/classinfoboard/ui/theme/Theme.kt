package io.github.rickylxw.classinfoboard.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/* 品牌色对齐 web 端 --accent（#5457E5 亮 / #8A8DF5 暗） */

private val LightColors = lightColorScheme(
    primary = Color(0xFF5457E5),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFEEF0FE),
    onPrimaryContainer = Color(0xFF1B1D6B),
    secondary = Color(0xFF0A9E6F),
    error = Color(0xFFDC2626),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFF6F7FA),
    background = Color(0xFFEEF0F5),
    outlineVariant = Color(0xFFE4E7EE)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8A8DF5),
    onPrimary = Color(0xFF161840),
    primaryContainer = Color(0xFF232647),
    onPrimaryContainer = Color(0xFFDCDFFC),
    secondary = Color(0xFF4FD6A4),
    error = Color(0xFFF28B8B),
    surface = Color(0xFF171B25),
    surfaceVariant = Color(0xFF12151D),
    background = Color(0xFF0D1017),
    outlineVariant = Color(0xFF272D3A)
)

@Composable
fun AppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val ctx = LocalContext.current
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            // 动态取色兜底之外保留品牌色：骨架先用固定品牌方案，动态取色待设置项再加
            if (darkTheme) DarkColors else LightColors
        }
        else -> if (darkTheme) DarkColors else LightColors
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
