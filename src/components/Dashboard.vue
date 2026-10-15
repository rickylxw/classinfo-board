<script setup>
import { computed, ref } from 'vue'
import { store, courseById, toggleAssignment, deleteAssignment, toggleSynced, copySharedAssignment, archiveDone, archiveAssignment, archiveSynced, PERSONAL_ID, PERSONAL_COURSE } from '../store'
import { ddlBadge, fmtDT, courseKeyOf } from '../utils'
import RichText from './RichText.vue'

const emit = defineEmits(['new-assignment', 'edit-assignment'])

const statFilter = ref('')            // '' 全部 | 'overdue' 已逾期 | 'soon' 7 天内
function applyStat(f) {
  statFilter.value = statFilter.value === f ? '' : f
}

function matchCourse(c) {
  const q = store.view.q.trim().toLowerCase()
  if (!q) return true
  return (c.name + ' ' + (c.teacher || '') + ' ' + (c.semester || '') + ' ' + (c.category || '')).toLowerCase().includes(q)
}
function matchText(...parts) {
  const q = store.view.q.trim().toLowerCase()
  if (!q) return true
  return parts.join(' ').toLowerCase().includes(q)
}

// 未筛选的全量待办
const allPending = computed(() => {
  const local = store.assignments
    .filter(a => a.status !== 'done' && !a.archived)
    .filter(a => {
      if (a.courseId === PERSONAL_ID) return matchText(a.title, a.requirement || '')
      const c = courseById(a.courseId)
      return c && (matchCourse(c) || matchText(a.title, a.requirement || ''))
    })
    .map(a => {
      const personal = a.courseId === PERSONAL_ID
      return { kind: personal ? 'personal' : 'local', a, course: personal ? PERSONAL_COURSE : courseById(a.courseId) }
    })
  const synced = []
  for (const item of Object.values(store.synced)) {
    const myCourse = store.courses.find(c => courseKeyOf(c) === item.key)
    if (!myCourse || !matchCourse(myCourse)) continue
    for (const sa of item.assignments) {
      const st = store.syncStatus[sa.id]
      if (st === 'done' || st === 'archived') continue
      if (!matchText(sa.title, sa.requirement || '')) continue
      synced.push({ kind: 'synced', a: sa, course: myCourse, from: item.from })
    }
  }
  return [...local, ...synced].sort((x, y) => (x.a.deadline || '9999').localeCompare(y.a.deadline || '9999'))
})

// 点击统计卡后的筛选视图
const pending = computed(() => {
  if (!statFilter.value) return allPending.value
  const now = Date.now()
  return allPending.value.filter(p => {
    if (statFilter.value === 'overdue') return !!p.a.deadline && new Date(p.a.deadline) - now < 0
    return !!p.a.deadline && new Date(p.a.deadline) - now <= 7 * 864e5 && new Date(p.a.deadline) - now >= 0
  })
})

const stats = computed(() => {
  const now = Date.now()
  const withDdl = allPending.value.map(p => p.a).filter(a => a.deadline)
  const due7 = withDdl.filter(a => new Date(a.deadline) - now <= 7 * 864e5 && new Date(a.deadline) - now >= 0).length
  const over = withDdl.filter(a => new Date(a.deadline) - now < 0).length
  return { courses: store.courses.length, over, due7, pending: allPending.value.length }
})

const subtitle = computed(() =>
  store.view.q.trim() ? `搜索“${store.view.q.trim()}”的结果` : '所有课程动态一览')

function openCourse(id) {
  store.view = { type: 'course', id, q: store.view.q }
}
</script>

<template>
  <div>
    <div class="page-title"><h2>仪表盘</h2><span class="muted">{{ subtitle }}</span></div>

    <div class="stats">
      <button class="stat tone-violet" :class="{ active: !statFilter }" @click="applyStat('')">
        <div class="num">📚 {{ stats.courses }}</div><div class="lbl">课程总数 · 显示全部</div>
      </button>
      <button class="stat tone-red" :class="{ active: statFilter === 'overdue' }" @click="applyStat('overdue')">
        <div class="num">⏰ {{ stats.over }}</div><div class="lbl">已逾期 · 点击筛选</div>
      </button>
      <button class="stat tone-orange" :class="{ active: statFilter === 'soon' }" @click="applyStat('soon')">
        <div class="num">📌 {{ stats.due7 }}</div><div class="lbl">7 天内截止 · 点击筛选</div>
      </button>
      <div class="stat tone-blue"><div class="num">📝 {{ stats.pending }}</div><div class="lbl">待办作业</div></div>
    </div>

    <section class="card">
      <div class="card-head">
        <h3>⏰ 待办作业 <span class="muted">（{{ pending.length }} 项{{ statFilter === 'overdue' ? ' · 已逾期' : statFilter === 'soon' ? ' · 7 天内截止' : '' }}）</span></h3>
        <div class="ops">
          <button class="btn sm" title="把所有已完成的作业收进「归档」" @click="archiveDone('all')">🧹 归档已完成</button>
          <button class="btn sm primary" @click="emit('new-assignment')">＋ 添加作业</button>
        </div>
      </div>
      <TransitionGroup name="list" tag="div" class="asg-list">
        <div
          v-for="p in pending" :key="p.kind + p.a.id"
          class="asg clickable"
          :class="{ done: p.kind === 'synced' && store.syncStatus[p.a.id] === 'done' }"
          @click="openCourse(p.course.id)">
          <button
            v-if="p.kind === 'local'"
            class="chk" title="标记完成" @click.stop="toggleAssignment(p.a.id)"></button>
          <button
            v-else
            class="chk"
            :class="{ on: store.syncStatus[p.a.id] === 'done' }"
            title="标记完成（仅自己）"
            @click.stop="toggleSynced(p.a.id)"></button>
          <div class="asg-body">
            <div class="asg-top">
              <span class="course-chip" :style="{ '--c': p.course?.color }">
                {{ p.kind === 'personal' ? '📌 ' + p.course?.name : p.course?.name }}
              </span>
              <span class="asg-title">{{ p.a.title }}</span>
              <span v-if="p.kind === 'synced'" class="badge sync-badge">同步 · {{ p.from }}</span>
            </div>
            <div class="asg-meta">
              <span class="badge" :class="ddlBadge(p.a.deadline, p.kind === 'local' ? p.a.status : 'pending').cls">
                {{ ddlBadge(p.a.deadline, p.kind === 'local' ? p.a.status : 'pending').text }}
              </span>
              <span v-if="p.a.deadline">📅 {{ fmtDT(p.a.deadline) }}</span>
            </div>
            <details v-if="p.a.requirement" class="req">
              <summary>作业要求</summary>
              <div class="req-body"><RichText :text="p.a.requirement" /></div>
            </details>
          </div>
          <div class="asg-ops">
            <button
              v-if="p.kind === 'local'"
              class="icon-btn" title="归档（从列表收起，可在「归档」找回）" @click.stop="archiveAssignment(p.a.id)">📦</button>
            <button
              v-else-if="p.kind === 'synced'"
              class="icon-btn" title="归档（仅自己隐藏，可在「归档」找回）" @click.stop="archiveSynced(p.a.id)">📦</button>
            <button v-if="p.kind === 'local'" class="icon-btn" title="编辑" @click.stop="emit('edit-assignment', p.a)">✏️</button>
            <button v-else-if="p.kind === 'synced'" class="icon-btn" title="复制为我的作业" @click.stop="copySharedAssignment(p.a, p.course.id)">📋</button>
            <button v-if="p.kind !== 'synced'" class="icon-btn" title="删除" @click.stop="deleteAssignment(p.a.id)">🗑️</button>
          </div>
        </div>
        <div v-if="!pending.length" class="empty">
          <span class="big">🎉</span>
          {{ statFilter === 'overdue' ? '没有逾期作业，保持住！' : statFilter === 'soon' ? '7 天内没有截止的作业' : store.courses.length ? '没有待办作业，好好休息！' : '还没有课程，点击右上角「新建课程」开始吧' }}
        </div>
      </TransitionGroup>
    </section>
  </div>
</template>
