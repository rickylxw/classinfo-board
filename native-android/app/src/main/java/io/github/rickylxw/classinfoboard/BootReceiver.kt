package io.github.rickylxw.classinfoboard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import io.github.rickylxw.classinfoboard.data.Reminders
import io.github.rickylxw.classinfoboard.data.StatusBar
import io.github.rickylxw.classinfoboard.data.WidgetSync

/* 开机恢复 + 常驻卡片「收起」按钮：
 * - BOOT_COMPLETED：通知/闹钟跨重启不保留 → 重挂提醒闹钟 + 刷小组件 + 恢复常驻卡片
 * - STATUS_HIDE：常驻卡片的「收起卡片」动作（记住用户选择，不再自动恢复） */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> {
                Reminders.scheduleAlarm(context)
                Reminders.checkAsync(context)
                WidgetSync.saveCurrent()
            }
            StatusBar.ACTION_HIDE -> {
                // 直接写 prefs（接收器进程里 Prefs 可能未 init）
                context.getSharedPreferences("classinfo", Context.MODE_PRIVATE)
                    .edit().putBoolean("statusBarOn", false).apply()
                StatusBar.hide(context)
            }
        }
    }
}
