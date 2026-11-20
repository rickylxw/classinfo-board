package io.github.rickylxw.classinfoboard.data

import android.content.Context
import android.content.SharedPreferences

/* 轻量配置存储（v0 用 SharedPreferences；后续可升级 DataStore/EncryptedSharedPreferences）。
 * 服务器地址默认走正式域名（https，免明文流量问题）；仍可改成局域网 http。 */

const val DEFAULT_SERVER = "https://class.rickylin.top"

object Prefs {
    private lateinit var sp: SharedPreferences

    fun init(ctx: Context) {
        sp = ctx.getSharedPreferences("classinfo", Context.MODE_PRIVATE)
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

    fun clearSession() {
        token = null
        xh = null
    }

    val loggedIn: Boolean get() = !token.isNullOrBlank()
}
