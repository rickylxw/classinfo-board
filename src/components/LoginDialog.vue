<script setup>
import { ref, onMounted } from 'vue'
import { login, adminLogin } from '../api'
import { handleLogin, handleAdminLogin, toast } from '../store'

const emit = defineEmits(['close'])

const REMEMBER_KEY = 'classinfo-last-cookie'

const cookie = ref('')
const error = ref('')
const loading = ref(false)
const remembered = ref('')

const adminName = ref('')
const adminPass = ref('')
const adminError = ref('')
const adminLoading = ref(false)

onMounted(() => {
  remembered.value = localStorage.getItem(REMEMBER_KEY) || ''
})

async function doLogin(value = cookie.value.trim(), viaQuick = false) {
  if (!value) { error.value = '请先粘贴 Cookie'; return }
  loading.value = true
  error.value = ''
  try {
    const r = await login(value)
    localStorage.setItem(REMEMBER_KEY, value)          // 记住本次成功凭证，供下次快捷登录
    await handleLogin(r.token, r.xh)
    toast(r.isNew ? `登录成功，欢迎！账号：${r.xh}` : `登录成功：${r.xh}`)
    emit('close')
  } catch (e) {
    error.value = viaQuick
      ? `上次保存的凭证已失效（${e.message}），请重新复制 ehall Cookie`
      : e.message
  } finally {
    loading.value = false
  }
}

async function doAdminLogin() {
  if (!adminName.value.trim() || !adminPass.value) { adminError.value = '请输入账号和密码'; return }
  adminLoading.value = true
  adminError.value = ''
  try {
    const r = await adminLogin(adminName.value.trim(), adminPass.value)
    handleAdminLogin(r.token)
    toast('管理员已登录')
    emit('close')
  } catch (e) {
    adminError.value = e.message
  } finally {
    adminLoading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <div class="dlg-body">
        <h2>登录（东南大学 ehall）</h2>
        <p class="muted" style="margin:0 0 12px;font-size:12px;">
          用你的 ehall 登录 Cookie 验证身份，后端会向我的课表接口发请求验证，并以返回的学号作为账号。
          Cookie 只保存在你本机，不会上传到任何第三方。
        </p>

        <!-- 快捷登录 -->
        <div v-if="remembered" class="tt-direct">
          <div style="flex:1;">
            ⚡ 检测到上次登录凭证<span class="muted">（ehall 会话若仍有效可直接进入）</span>
          </div>
          <button class="btn primary" :disabled="loading" @click="doLogin(remembered, true)">
            {{ loading ? '验证中…' : '快捷登录' }}
          </button>
        </div>

        <details class="tt-how">
          <summary>📋 如何获取 ehall Cookie？{{ remembered ? '（快捷登录失败时才需要）' : '（首次使用请看）' }}</summary>
          <ol>
            <li>在浏览器登录 <b>ehall.seu.edu.cn</b>（保持登录状态）</li>
            <li>按 <b>F12</b> 打开开发者工具，切到 <b>Network（网络）</b> 面板</li>
            <li>刷新页面，在请求列表里点任意一个请求</li>
            <li>在 <b>Request Headers（请求标头）</b> 里找到 <b>cookie:</b> 一行，右键 → 复制值（Copy value）</li>
            <li>粘贴到下方输入框，点「登录验证」</li>
          </ol>
          <p class="muted" style="margin:4px 0;font-size:12px;">
            提示：Cookie 相当于你的 ehall 登录凭证，验证通过后只用于本应用拉课表；ehall 会话过期（数小时到数天）后需要重新登录本应用。
          </p>
        </details>

        <div class="field" style="margin-top:14px;">
          <label>ehall Cookie</label>
          <textarea
            v-model="cookie" rows="4"
            placeholder="MOD_AUTH_CAS=…; mod_auth_session=…（整段粘贴）"></textarea>
        </div>
        <div v-if="error" class="tt-status error">{{ error }}</div>

        <div class="dlg-actions">
          <button class="btn" @click="emit('close')">取消</button>
          <button class="btn primary" :disabled="loading || !cookie.trim()" @click="doLogin()">
            {{ loading ? '验证中…' : '登录验证' }}
          </button>
        </div>

        <details style="margin-top:6px;">
          <summary style="cursor:pointer;font-size:12px;color:var(--muted);">管理员登录（账号密码）</summary>
          <div class="row2" style="margin-top:10px;">
            <div class="field"><label>账号</label><input v-model="adminName" autocomplete="username"></div>
            <div class="field"><label>密码</label><input v-model="adminPass" type="password" autocomplete="current-password"></div>
          </div>
          <div v-if="adminError" class="tt-status error">{{ adminError }}</div>
          <button class="btn sm" :disabled="adminLoading" @click="doAdminLogin">
            {{ adminLoading ? '验证中…' : '管理员登录' }}
          </button>
        </details>
      </div>
    </div>
  </Teleport>
</template>
