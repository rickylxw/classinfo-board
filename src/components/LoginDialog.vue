<script setup>
import { ref, onMounted } from 'vue'
import { login, adminLogin, passwordLogin, setPassword, fetchMe } from '../api'
import { handleLogin, handleAdminLogin, toast } from '../store'

const emit = defineEmits(['close'])

const REMEMBER_KEY = 'classinfo-last-cookie'

const cookie = ref('')
const error = ref('')
const loading = ref(false)
const remembered = ref('')

// 应用密码登录
const pwXh = ref('')
const pwPass = ref('')
const pwError = ref('')
const pwLoading = ref(false)

// 登录成功后引导设置应用密码（仅账号还没设置过时出现）
const setpwOpen = ref(false)
const setpw1 = ref('')
const setpw2 = ref('')
const setpwError = ref('')
const setpwLoading = ref(false)

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
    // 账号还没设置应用密码时，顺手引导设置（之后免 Cookie 登录）
    try {
      const me = await fetchMe()
      if (me && me.hasPassword === false) { setpwOpen.value = true; return }
    } catch (e) { /* 忽略，正常关闭 */ }
    emit('close')
  } catch (e) {
    error.value = viaQuick
      ? `上次保存的凭证已失效（${e.message}），请重新复制 ehall Cookie`
      : e.message
  } finally {
    loading.value = false
  }
}

async function doPasswordLogin() {
  if (!pwXh.value.trim() || !pwPass.value) { pwError.value = '请输入学号和密码'; return }
  pwLoading.value = true
  pwError.value = ''
  try {
    const r = await passwordLogin(pwXh.value.trim(), pwPass.value)
    await handleLogin(r.token, r.xh)
    toast(`登录成功：${r.xh}`)
    emit('close')
  } catch (e) {
    pwError.value = e.message
  } finally {
    pwLoading.value = false
  }
}

async function doSetPw() {
  if (setpw1.value.length < 6) { setpwError.value = '密码至少 6 位'; return }
  if (setpw1.value !== setpw2.value) { setpwError.value = '两次输入的密码不一致'; return }
  setpwLoading.value = true
  setpwError.value = ''
  try {
    await setPassword(setpw1.value)
    toast('应用密码已设置，以后可用「学号 + 密码」直接登录')
    emit('close')
  } catch (e) {
    setpwError.value = e.message
  } finally {
    setpwLoading.value = false
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
        <!-- 登录成功后的应用密码设置引导 -->
        <template v-if="setpwOpen">
          <h2>🔐 设置应用密码</h2>
          <p class="muted" style="margin:0 0 12px;font-size:12px;">
            设置后，以后无论换设备还是 ehall 凭证过期，都能用「学号 + 密码」直接登录本应用，
            不用再去 ehall 复制 Cookie。密码只保存在服务器（scrypt 单向哈希，谁也看不到原文）。
          </p>
          <div class="field"><label>应用密码（至少 6 位）</label><input v-model="setpw1" type="password" autocomplete="new-password" placeholder="本应用的独立密码，可与学校密码不同"></div>
          <div class="field"><label>再输一遍</label><input v-model="setpw2" type="password" autocomplete="new-password"></div>
          <div v-if="setpwError" class="tt-status error">{{ setpwError }}</div>
          <div class="dlg-actions">
            <button class="btn" @click="emit('close')">跳过，以后再说</button>
            <button class="btn primary" :disabled="setpwLoading" @click="doSetPw">{{ setpwLoading ? '保存中…' : '保存并进入' }}</button>
          </div>
        </template>

        <template v-else>
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

          <!-- 应用密码登录（设置过一次后，任何设备免 Cookie 直接进） -->
          <div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px;">🔑 应用密码登录 <span class="muted" style="font-weight:400;">（设置过一次，任何设备免 Cookie）</span></div>
            <div class="row2">
              <div class="field"><label>学号</label><input v-model="pwXh" autocomplete="username" placeholder="你的学号"></div>
              <div class="field"><label>密码</label><input v-model="pwPass" type="password" autocomplete="current-password" placeholder="应用密码"></div>
            </div>
            <div v-if="pwError" class="tt-status error">{{ pwError }}</div>
            <button class="btn sm primary" :disabled="pwLoading" @click="doPasswordLogin">
              {{ pwLoading ? '验证中…' : '密码登录' }}
            </button>
            <div class="muted" style="font-size:11px;margin-top:6px;">首次使用请先用下方 ehall Cookie 登录一次，登录成功后会引导你设置应用密码。</div>
          </div>

          <details class="tt-how" style="margin-top:10px;">
            <summary>📋 如何获取 ehall Cookie？{{ remembered ? '（快捷登录失败时才需要）' : '（首次使用请看）' }}</summary>
            <ol>
              <li>在浏览器登录 <b>ehall.seu.edu.cn</b>（保持登录状态）</li>
              <li>按 <b>F12</b> 打开开发者工具，切到 <b>Network（网络）</b> 面板</li>
              <li>刷新页面，在请求列表里点任意一个请求</li>
              <li>在 <b>Request Headers（请求标头）</b> 里找到 <b>cookie:</b> 一行，右键 → 复制值（Copy value）</li>
              <li>粘贴到下方输入框，点「登录验证」</li>
            </ol>
            <p class="muted" style="margin:4px 0;font-size:12px;">
              提示：Cookie 相当于你的 ehall 登录凭证，验证通过后只用于本应用拉课表；设置应用密码后，日常登录不再需要它。
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
        </template>
      </div>
    </div>
  </Teleport>
</template>
