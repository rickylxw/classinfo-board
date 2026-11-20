package io.github.rickylxw.classinfoboard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import io.github.rickylxw.classinfoboard.data.Reminders

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Reminders.ACTION_CHECK) Reminders.checkAsync(context)
    }
}
