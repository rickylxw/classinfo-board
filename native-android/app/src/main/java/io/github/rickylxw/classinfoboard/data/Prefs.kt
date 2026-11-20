package io.github.rickylxw.classinfoboard.data

import android.content.Context
import android.content.SharedPreferences

/* 轻量配置存储（v0 用 SharedPreferences；后续可升级 DataStore/EncryptedSharedPreferences）。
 * 服务器地址默认走正式域名（https，免明文流量问题）；仍可改成局域网 http。 */

const val DEFAULT_SERVER = "https://class.rickylin.top"

object Prefs {
    private lateinit var sp: SharedPreferences
    var appCtx: Context? = null
        private set

    fun init(ctx: Context) {
        sp = ctx.getSharedPreferences("classinfo", Context.MODE_PRIVATE)
        appCtx = ctx.applicationContext
    }

    var serverUrl: String
        get() = sp.getString("serverUrl", DEFAULT_SERVER)?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER
        set(v) = sp.edit().putString("serverUrl", v.trim()).apply()

    var token: String?
        get() = sp.getString("token", null)
        set(v) = if (v.isNullOrBlank()) sp.edit().remove("token").apply()
                 else sp.edit().putString("token", v).apply()

    var xh: String?
        get() = sp.getString("xh", null)
        set(v) = if (v.isNullOrBlank()) sp.edit().remove("xh").apply()
                 else sp.edit().putString("xh", v).apply()

    /** 学期第一周周一（本地缓存；服务端有值时以服务端为准，见 Repo.ensureLoaded） */
    var localSemStart: String?
        get() = sp.getString("semStart", null)
        set(v) = if (v.isNullOrBlank()) sp.edit().remove("semStart").apply()
                 else sp.edit().putString("semStart", v).apply()

    /* ---------- 自动更新 ---------- */
    var lastUpdateCheckAt: Long
        get() = sp.getLong("lastUpdateCheckAt", 0L)
        set(v) = sp.edit().putLong("lastUpdateCheckAt", v).apply()

    var dismissedUpdateTag: String?
        get() = sp.getString("dismissedUpdateTag", null)
        set(v) = if (v.isNullOrBlank()) sp.edit().remove("dismissedUpdateTag").apply()
                 else sp.edit().putString("dismissedUpdateTag", v).apply()

    var lastApkDownloadId: Long
        get() = sp.getLong("lastApkDownloadId", -1L)
        set(v) = sp.edit().putLong("lastApkDownloadId", v).apply()

    var lastApkDownloadTag: String?
        get() = sp.getString("lastApkDownloadTag", null)
        set(v) = if (v.isNullOrBlank()) sp.edit().remove("lastApkDownloadTag").apply()
                 else sp.edit().putString("lastApkDownloadTag", v).apply()

    /** 桌面小组件快照（JSON；App 进程被杀后组件仍可渲染） */
    var widgetSnapshot: String?
        get() = sp.getString("widgetSnapshot", null)
        set(v) = if (v.isNullOrBlank()) sp.edit().remove("widgetSnapshot").apply()
                 else sp.edit().putString("widgetSnapshot", v).apply()

    fun clearSession() {
        token = null
        xh = null
    }

    val loggedIn: Boolean get() = !token.isNullOrBlank()
}
