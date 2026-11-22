package io.github.rickylxw.classinfoboard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import io.github.rickylxw.classinfoboard.data.Reminders
import io.github.rickylxw.classinfoboard.data.Repo
import io.github.rickylxw.classinfoboard.data.WidgetSync
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Reminders.ACTION_CHECK) return
        // 复用本次唤醒顺带拉一次云端（后台兜底层，不新增唤醒次数；9s 上限守卫广播窗口）
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                withTimeoutOrNull(9_000) { runCatching { Repo.refresh() } }
                WidgetSync.push(context)   // 新快照 → 桌面小组件 / 常驻卡片
            } catch (_: Exception) { }
            Reminders.checkAndNotify(context)   // 用刷新后的快照判提醒
            Reminders.scheduleAlarm(context)    // 重挂 30 分钟循环（定点闹钟触发后也要恢复循环）
            pending.finish()
        }
    }
}
