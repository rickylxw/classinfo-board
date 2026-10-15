<script setup>
import { reactive, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { store, initStore, initSession } from './store'
import { session } from './api'
import TopBar from './components/TopBar.vue'
import SideBar from './components/SideBar.vue'
import Dashboard from './components/Dashboard.vue'
import CourseDetail from './components/CourseDetail.vue'
import CourseDialog from './components/CourseDialog.vue'
import AssignmentDialog from './components/AssignmentDialog.vue'
import LinkDialog from './components/LinkDialog.vue'
import TimetableDialog from './components/TimetableDialog.vue'
import LoginDialog from './components/LoginDialog.vue'
import AdminPanel from './components/AdminPanel.vue'
import PersonalTodos from './components/PersonalTodos.vue'
import Archive from './components/Archive.vue'
import ScheduleView from './components/ScheduleView.vue'
import Toasts from './components/Toasts.vue'

import { version } from '../package.json'
const year = new Date().getFullYear()

initStore()
// 启动：先验证会话再亮界面；未登录一律只见只读欢迎门（无数据、无修改入口）
const booted = ref(false)
onMounted(async () => {
  await initSession()
  booted.value = true
})
const needLogin = computed(() => booted.value && !session.xh)

// ESC：先关对话框，再收起抽屉
function onKey(e) {
  if (e.key === 'Escape') {
    if (ui.dialog) ui.dialog = null
    else store.sidebarOpen = false
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// 对话框统一由 App 调度；v-if 挂载保证每次打开都是全新表单状态
const ui = reactive({
  dialog: null,            // 'course' | 'assignment' | 'link' | 'timetable' | 'login' | null
  editingCourse: null,
  editingAssignment: null,
  boardKey: null,          // 共享板模式（课程负责人编辑共享代办）
  boardItem: null,
  submitKey: null,         // 投稿模式（成员提交，待负责人审核）
  presetCourseId: null     // 预设课程（如个人待办页添加）
})

const currentCourse = computed(() => store.courses.find(c => c.id === store.view.id) || null)

function openCourseDialog(course = null) {
  ui.editingCourse = course
  ui.dialog = 'course'
}
function openAssignmentDialog(assignment = null) {
  ui.editingAssignment = assignment
  ui.boardKey = null
  ui.boardItem = null
  ui.submitKey = null
  ui.presetCourseId = null
  ui.dialog = 'assignment'
}
function openPersonalAssignmentDialog() {
  ui.editingAssignment = null
  ui.boardKey = null
  ui.boardItem = null
  ui.submitKey = null
  ui.presetCourseId = 'personal'
  ui.dialog = 'assignment'
}
function openBoardAssignmentDialog(courseKey, item) {
  ui.editingAssignment = null
  ui.boardKey = courseKey
  ui.boardItem = item
  ui.submitKey = null
  ui.dialog = 'assignment'
}
function openSubmitAssignmentDialog(courseKey) {
  ui.editingAssignment = null
  ui.boardKey = null
  ui.boardItem = null
  ui.submitKey = courseKey
  ui.dialog = 'assignment'
}
</script>

<template>
  <!-- 启动中：先验证会话，避免闪现欢迎门或空界面 -->
  <div v-if="!booted" class="boot-splash">
    <div class="boot-logo">📚</div>
    <div>课程信息板</div>
    <div class="muted" style="font-size:12px;">正在进入…</div>
  </div>

  <!-- 首次进入 / 未登录：只读欢迎门，不给任何数据，也没有修改入口 -->
  <div v-else-if="needLogin" class="welcome">
    <div class="welcome-card">
      <div class="welcome-logo">📚</div>
      <h1>课程信息板</h1>
      <p class="welcome-sub">课程 · 作业 DDL · 文件 · 班级共享，登录后一站式管理</p>
      <ul class="welcome-feats">
        <li>🏷️ 按课程整理教学群、作业要求与课件文件</li>
        <li>☁️ 数据云端同步，换设备登录即取回</li>
        <li>🤝 班级共享板：作业 / 附件 / 教学群全班同一份</li>
        <li>📅 日程表周视图 + DDL 归档 + 个人待办</li>
      </ul>
      <button class="btn primary lg" @click="ui.dialog = 'login'">🚪 登录后开始使用</button>
      <p class="muted" style="font-size:12px;margin-top:14px;">
        东南大学 ehall Cookie 验证登录，可设置应用密码免 Cookie 进入；<br>
        未登录状态为只读预览，不提供数据修改。
      </p>
    </div>
  </div>

  <template v-else>
    <TopBar
      @new-course="openCourseDialog()"
      @pull-timetable="ui.dialog = 'timetable'"
      @login="ui.dialog = 'login'"
      @toggle-sidebar="store.sidebarOpen = !store.sidebarOpen" />

    <!-- 管理员：独立控制台（不加载用户课程数据界面） -->
    <AdminPanel v-if="session.isAdmin" />

    <!-- 用户 -->
    <div v-else class="layout">
    <SideBar @new-course="openCourseDialog()" />    <main class="main">
      <div class="main-inner">
        <Dashboard
          v-if="store.view.type === 'overview'"
          @new-assignment="openAssignmentDialog()"
          @edit-assignment="a => openAssignmentDialog(a)" />
        <PersonalTodos
          v-else-if="store.view.type === 'personal'"
          @add="openPersonalAssignmentDialog"
          @edit="a => openAssignmentDialog(a)" />
        <Archive
          v-else-if="store.view.type === 'archive'"
          @open-course="store.view = { type: 'overview', id: null, q: store.view.q }" />
        <ScheduleView v-else-if="store.view.type === 'schedule'" />
        <CourseDetail
          v-else-if="currentCourse"
          :course="currentCourse"
          @edit-course="openCourseDialog"
          @new-assignment="openAssignmentDialog()"
          @edit-assignment="a => openAssignmentDialog(a)"
          @board-assignment="(key, item) => openBoardAssignmentDialog(key, item)"
          @submit-assignment="openSubmitAssignmentDialog"
          @new-link="ui.dialog = 'link'" />
      </div>
    </main>
  </div>
  </template>

  <!-- 页脚：欢迎门与主界面共用（启动闪屏阶段不显示） -->
  <footer v-if="booted" class="app-footer">
    <span>课程信息板 · v{{ version }} · 开源班级课程管理工具</span>
    <span>
      © {{ year }} rickylxw ·
      <a href="https://github.com/rickylxw/classinfo-board" target="_blank" rel="noopener">GitHub 仓库</a> ·
      <a href="https://github.com/rickylxw/classinfo-board/blob/main/LICENSE" target="_blank" rel="noopener">GPLv3</a>
    </span>
  </footer>

  <CourseDialog
    v-if="ui.dialog === 'course'"
    :course="ui.editingCourse"
    @close="ui.dialog = null" />
  <AssignmentDialog
    v-if="ui.dialog === 'assignment'"
    :assignment="ui.editingAssignment"
    :course-id="currentCourse?.id"
    :preset-course-id="ui.presetCourseId"
    :board-key="ui.boardKey"
    :board-item="ui.boardItem"
    :submit-key="ui.submitKey"
    @close="ui.dialog = null" />
  <LinkDialog
    v-if="ui.dialog === 'link'"
    :course-id="currentCourse?.id"
    @close="ui.dialog = null" />
  <TimetableDialog
    v-if="ui.dialog === 'timetable'"
    @close="ui.dialog = null" />
  <LoginDialog
    v-if="ui.dialog === 'login'"
    @close="ui.dialog = null" />
  <Toasts />
</template>
