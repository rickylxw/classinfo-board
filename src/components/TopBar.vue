<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { store, exportData, importData, doLogout, toast } from '../store'
import { session } from '../api'
import { useTheme } from '../theme'
import { isDesktop, openTool } from '../desktop'

defineEmits(['new-course', 'pull-timetable', 'login', 'toggle-sidebar', 'feedback'])

const { theme, toggle } = useTheme()
const importInput = ref(null)
const searchInput = ref(null)
const moreOpen = ref(false)

// ⋯ 菜单动作执行后顺手收起
async function onMore(fn) {
  moreOpen.value = false
  await fn()
}

async function onClock() {
  try {
    await openTool('clock')
  } catch (e) {
    toast(e.message, 'error')
  }
}

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
      <button class="btn" title="意见反馈/故障上报" @click="$emit('feedback')">📝 反馈</button>
      <button class="btn" @click="onLogout">退出</button>
    </div>

    <!-- 用户 / 本地模式 -->
    <template v-else>
      <div class="search-wrap">
        <input ref="searchInput" type="search" v-model="store.view.q" placeholder="搜索课程 / 作业 / 要求…（按 / 聚焦）">
      </div>
      <div class="top-actions">
        <!-- 桌面端专属：悬浮时钟开关（课件助手已并入侧栏，浏览器也可用） -->
        <button
          v-if="isDesktop"
          class="icon-btn"
          title="悬浮时钟开关（托盘菜单 / Ctrl+Alt+L 穿透锁定）"
          @click="onClock">⏱</button>
        <button class="icon-btn" :title="theme === 'dark' ? '切换浅色' : '切换深色'" @click="toggle">{{ theme === 'dark' ? '☀️' : '🌙' }}</button>
        <button class="btn" title="意见反馈/故障上报给开发者" @click="$emit('feedback')">📝 反馈</button>
        <template v-if="session.xh">
          <span class="chip user-chip" title="已登录：ehall 学号">👤 {{ session.xh }}</span>
          <!-- ⋯ 次级菜单：低频操作（拉课表/导入导出/退出）收纳，顶栏只留高频入口 -->
          <div class="more-wrap">
            <button
              class="icon-btn"
              :class="{ on: moreOpen }"
              title="更多：拉取课表 / 备份 / 退出登录"
              @click="moreOpen = !moreOpen">⋯</button>
            <div v-if="moreOpen" class="more-menu" @mouseleave="moreOpen = false">
              <button class="more-item" @click="onMore(() => $emit('pull-timetable'))">📅 拉取课表</button>
              <button class="more-item" @click="onMore(exportData)">📤 导出备份</button>
              <button class="more-item" @click="onMore(pickImport)">📥 导入备份</button>
              <div class="more-sep"></div>
              <button class="more-item more-danger" @click="onMore(onLogout)">🚪 退出登录</button>
            </div>
          </div>
        </template>
        <button v-else class="btn" title="用 ehall Cookie 登录，同步数据到云端" @click="$emit('login')">登录</button>
        <button class="btn primary" title="新建课程" @click="$emit('new-course')">＋ 新建课程</button>
      </div>
    </template>
    <input type="file" ref="importInput" accept=".json,application/json" hidden @change="onImportChange">
  </header>
</template>

<style scoped>
.more-wrap { position: relative; display: inline-flex; }
.more-btn.on { background: var(--accent-weak); color: var(--accent); }
.more-menu {
  position: absolute; top: 34px; right: -6px; z-index: 60;
  min-width: 148px; padding: 5px;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column; gap: 2px;
}
.more-item {
  border: none; background: transparent; text-align: left;
  padding: 8px 12px; border-radius: 8px;
  font-size: 13px; color: var(--text); white-space: nowrap;
  transition: background .12s;
}
.more-item:hover { background: var(--accent-weak); color: var(--accent); }
.more-item.more-danger:hover { background: var(--danger-weak); color: var(--danger); }
.more-sep { height: 1px; background: var(--line); margin: 4px 6px; }
</style>
