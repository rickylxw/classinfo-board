<script setup>
import { reactive, computed, onMounted, onBeforeUnmount } from 'vue'
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

initStore()
onMounted(initSession)

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
  <TopBar
    @new-course="openCourseDialog()"
    @pull-timetable="ui.dialog = 'timetable'"
    @login="ui.dialog = 'login'"
    @toggle-sidebar="store.sidebarOpen = !store.sidebarOpen" />

  <!-- 管理员：独立控制台（不加载用户课程数据界面） -->
  <AdminPanel v-if="session.isAdmin" />

  <!-- 用户 / 本地模式 -->
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
