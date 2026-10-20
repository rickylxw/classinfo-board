<script setup>
import { computed, ref } from 'vue'
import { store, CATEGORIES, pendingCount, personalCount, exportData, importData } from '../store'

const emit = defineEmits(['new-course', 'navigated', 'pull-timetable'])

/* 导入备份：抽屉里的移动端入口（桌面在顶栏） */
const importInput = ref(null)
function pickImport() {
  importInput.value.value = ''
  importInput.value.click()
}
function onImportChange(e) {
  if (e.target.files[0]) importData(e.target.files[0])
}

function nav(payload) {
  store.view = payload
  store.sidebarOpen = false
}

function matchCourse(c) {
  const q = store.view.q.trim().toLowerCase()
  if (!q) return true
  return (c.name + ' ' + (c.teacher || '') + ' ' + (c.semester || '') + ' ' + (c.category || '')).toLowerCase().includes(q)
}

// 按 CATEGORIES 顺序分组；未设置类别的课程归入「未分类」，仅存在时显示
const sections = computed(() => {
  const list = store.courses.filter(matchCourse)
  return [...CATEGORIES, '']
    .map(cat => ({ cat, list: list.filter(c => (c.category || '') === cat) }))
    .filter(s => s.list.length)
})

const visibleCount = computed(() => store.courses.filter(matchCourse).length)
</script>

<template>
  <!-- 移动端抽屉打开时的遮罩：点击任意处收起 -->
  <button v-if="store.sidebarOpen" class="scrim" aria-label="收起菜单" @click="store.sidebarOpen = false"></button>
  <aside class="sidebar" :class="{ open: store.sidebarOpen }">
    <div class="side-title"><span>总览</span></div>
    <button
      class="nav-item"
      :class="{ active: store.view.type === 'overview' }"
      @click="nav({ type: 'overview', id: null, q: store.view.q })">
      <span>🏠</span><span class="nav-name">仪表盘</span>
    </button>
    <button
      class="nav-item"
      :class="{ active: store.view.type === 'personal' }"
      @click="nav({ type: 'personal', id: null, q: store.view.q })">
      <span>📌</span><span class="nav-name">个人待办</span>
      <span class="count" :class="{ zero: !personalCount() }">{{ personalCount() }}</span>
    </button>
    <button
      class="nav-item"
      :class="{ active: store.view.type === 'schedule' }"
      @click="nav({ type: 'schedule', id: null, q: store.view.q })">
      <span>📅</span><span class="nav-name">日程表</span>
    </button>
    <button
      class="nav-item"
      :class="{ active: store.view.type === 'archive' }"
      @click="nav({ type: 'archive', id: null, q: store.view.q })">
      <span>🗃</span><span class="nav-name">归档</span>
    </button>

    <div class="side-title" style="margin-top:10px;">
      <span>我的课程</span><span>{{ visibleCount }}</span>
    </div>
    <template v-if="sections.length">
      <div v-for="s in sections" :key="s.cat || '_none'" class="cat-group">
        <div class="side-title"><span>{{ s.cat || '未分类' }}</span><span>{{ s.list.length }}</span></div>
        <button
          v-for="c in s.list" :key="c.id"
          class="nav-item"
          :class="{ active: store.view.type === 'course' && store.view.id === c.id }"
          :style="{ '--c': c.color }"
          @click="nav({ type: 'course', id: c.id, q: store.view.q })">
          <span class="dot"></span>
          <span class="nav-name" :title="c.name">{{ c.name }}</span>
          <span class="count" :class="{ zero: !pendingCount(c.id) }">{{ pendingCount(c.id) }}</span>
        </button>
      </div>
    </template>
    <div v-else class="muted" style="padding:6px 10px;font-size:12px;">暂无课程</div>

    <button class="side-add" @click="$emit('new-course')">＋ 新建课程</button>

    <!-- 数据操作：移动端入口（≤760px 显示；桌面在顶栏，避免重复） -->
    <div class="side-data-ops">
      <div class="side-title" style="margin-top:10px;"><span>数据</span></div>
      <button class="nav-item" @click="exportData()"><span>📤</span><span class="nav-name">导出备份</span></button>
      <button class="nav-item" @click="pickImport()"><span>📥</span><span class="nav-name">导入备份</span></button>
      <button class="nav-item" @click="emit('pull-timetable')"><span>📅</span><span class="nav-name">拉取课表</span></button>
    </div>
    <input type="file" ref="importInput" accept=".json,application/json" hidden @change="onImportChange">

    <div class="side-tip">数据保存在本浏览器中<br>可用「导出备份」生成备份文件</div>
  </aside>
</template>
