package io.github.rickylxw.classinfoboard.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.github.rickylxw.classinfoboard.data.Prefs

/* 主题：品牌紫（#5457E5）双主题 + 手动深浅色切换（跟随系统/浅色/深色）。
 * 卡片统一 surfaceContainerLow 底 + 14dp 圆角（Shapes.medium），层次靠容器色阶而非描边。 */

enum class ThemeMode(val label: String) {
    SYSTEM("跟随系统"), LIGHT("浅色"), DARK("深色")
}

/** 当前主题模式（AppTheme 与设置页共享；首次访问在 Prefs.init 之后，安全） */
object ThemeState {
    var mode: ThemeMode by mutableStateOf(
        runCatching { ThemeMode.valueOf(Prefs.themeMode) }.getOrDefault(ThemeMode.SYSTEM)
    )
}

/* 亮色 */
private val LightColors = lightColorScheme(
    primary = Color(0xFF5457E5),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE4E3FF),
    onPrimaryContainer = Color(0xFF171A61),
    secondary = Color(0xFF0A9E6F),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFDCF7EA),
    onSecondaryContainer = Color(0xFF045133),
    tertiary = Color(0xFFB45309),
    error = Color(0xFFDC2626),
    errorContainer = Color(0xFFFEE9E9),
    onErrorContainer = Color(0xFF7F1D1D),
    background = Color(0xFFF3F4F9),
    onBackground = Color(0xFF1C2434),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1C2434),
    surfaceVariant = Color(0xFFE9EBF3),
    onSurfaceVariant = Color(0xFF5D6679),
    outline = Color(0xFFC2C7D4),
    outlineVariant = Color(0xFFDFE3EC),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFBFCFE),
    surfaceContainer = Color(0xFFF2F4F9),
    surfaceContainerHigh = Color(0xFFEAEDF5),
    surfaceContainerHighest = Color(0xFFE3E6F0)
)

/* 暗色 */
private val DarkColors = darkColorScheme(
    primary = Color(0xFFA5A8F8),
    onPrimary = Color(0xFF16184F),
    primaryContainer = Color(0xFF26274D),
    onPrimaryContainer = Color(0xFFE1E2FF),
    secondary = Color(0xFF4FD6A4),
    onSecondary = Color(0xFF05372A),
    secondaryContainer = Color(0xFF14382C),
    onSecondaryContainer = Color(0xFFA8F0D3),
    tertiary = Color(0xFFF0B45E),
    error = Color(0xFFF28B8B),
    errorContainer = Color(0xFF3A2126),
    onErrorContainer = Color(0xFFFFC9C9),
    background = Color(0xFF0D1017),
    onBackground = Color(0xFFE2E5EE),
    surface = Color(0xFF141821),
    onSurface = Color(0xFFE2E5EE),
    surfaceVariant = Color(0xFF1A1F2B),
    onSurfaceVariant = Color(0xFF9AA3B6),
    outline = Color(0xFF3A4150),
    outlineVariant = Color(0xFF272D3A),
    surfaceContainerLowest = Color(0xFF0F131B),
    surfaceContainerLow = Color(0xFF161B24),
    surfaceContainer = Color(0xFF1B202B),
    surfaceContainerHigh = Color(0xFF212736),
    surfaceContainerHighest = Color(0xFF272E3C)
)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    val dark = when (ThemeState.mode) {
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
    }
    MaterialTheme(
        colorScheme = if (dark) DarkColors else LightColors,
        shapes = Shapes(
            extraSmall = RoundedCornerShape(8.dp),
            small = RoundedCornerShape(10.dp),
            medium = RoundedCornerShape(14.dp),
            large = RoundedCornerShape(18.dp),
            extraLarge = RoundedCornerShape(24.dp)
        ),
        content = content
    )
}

/** 统计卡等处用：判断当前是否暗色（与 AppTheme 同口径） */
@Composable
fun isAppDark(): Boolean = when (ThemeState.mode) {
    ThemeMode.LIGHT -> false
    ThemeMode.DARK -> true
    ThemeMode.SYSTEM -> isSystemInDarkTheme()
}
