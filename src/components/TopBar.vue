<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { store, exportData, importData, doLogout } from '../store'
import { session } from '../api'
import { useTheme } from '../theme'

defineEmits(['new-course', 'pull-timetable', 'login', 'toggle-sidebar'])

const { theme, toggle } = useTheme()
const importInput = ref(null)
const searchInput = ref(null)

function pickImport() {
  importInput.value.value = ''
  importInput.value.click()
}
function onImportChange(e) {
  if (e.target.files[0]) importData(e.target.files[0])
}
async function onLogout() {
  await doLogout()
}
function onKey(e) {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    e.preventDefault()
    searchInput.value?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <header class="topbar">
    <button class="icon-btn menu-btn" title="菜单" @click="$emit('toggle-sidebar')">☰</button>
    <div class="brand">
      <span class="logo">📚</span>
      <div>
        <h1>课程信息板</h1>
        <p>{{ session.isAdmin ? '管理员控制台' : 'Classinfo Board' }}</p>
      </div>
    </div>

    <!-- 管理员：只保留主题与退出 -->
    <div v-if="session.isAdmin" class="top-actions">
      <button class="icon-btn" :title="theme === 'dark' ? '切换浅色' : '切换深色'" @click="toggle">{{ theme === 'dark' ? '☀️' : '🌙' }}</button>
      <span class="chip user-chip">🛡 管理员</span>
      <button class="btn" @click="onLogout">退出</button>
    </div>

    <!-- 用户 / 本地模式 -->
    <template v-else>
      <div class="search-wrap">
        <input ref="searchInput" type="search" v-model="store.view.q" placeholder="搜索课程 / 作业 / 要求…（按 / 聚焦）">
      </div>
      <div class="top-actions">
        <button class="icon-btn" :title="theme === 'dark' ? '切换浅色' : '切换深色'" @click="toggle">{{ theme === 'dark' ? '☀️' : '🌙' }}</button>
        <template v-if="session.xh">
          <span class="chip user-chip" title="已登录：ehall 学号">👤 {{ session.xh }}</span>
          <button class="btn" @click="onLogout">退出</button>
        </template>
        <button v-else class="btn" title="用 ehall Cookie 登录，同步数据到云端" @click="$emit('login')">登录</button>
        <!-- data-ops：低频数据操作，移动端（≤760px）从顶栏隐藏，入口移到抽屉「数据」区 -->
        <span class="data-ops">
          <button class="btn" title="导出全部数据为 JSON 备份" @click="exportData">导出</button>
          <button class="btn" title="从 JSON 备份恢复" @click="pickImport">导入</button>
        </span>
        <button class="btn data-ops" title="从东南大学 ehall 拉取课表并导入" @click="$emit('pull-timetable')">拉取课表</button>
        <button class="btn primary" title="新建课程" @click="$emit('new-course')">＋ 新建课程</button>
      </div>
    </template>
    <input type="file" ref="importInput" accept=".json,application/json" hidden @change="onImportChange">
  </header>
</template>
