<script setup>
import { computed } from 'vue'
import {
  store, courseById, PERSONAL_ID, PERSONAL_COURSE,
  restoreAssignment, deleteAssignment, restoreSynced
} from '../store'
import { fmtDT, courseKeyOf } from '../utils'
import RichText from './RichText.vue'

const emit = defineEmits(['open-course'])

const groups = computed(() => {
  const q = store.view.q.trim().toLowerCase()
  const hit = text => !q || String(text || '').toLowerCase().includes(q)
  const map = new Map()
  const push = (label, color, entry) => {
    if (!map.has(label)) map.set(label, { label, color, items: [] })
    map.get(label).items.push(entry)
  }

  // 自己的作业 / 个人待办
  for (const a of store.assignments.filter(a => a.archived)) {
    if (!hit(a.title) && !hit(a.requirement)) continue
    const course = a.courseId === PERSONAL_ID ? PERSONAL_COURSE : courseById(a.courseId)
    push(course?.name || '（课程已删除）', course?.color || '#9aa3b5', { kind: 'own', a, color: course?.color })
  }
  // 班级同步的作业（个人归档）
  for (const item of Object.values(store.synced)) {
    const myCourse = store.courses.find(c => courseKeyOf(c) === item.key)
    if (!myCourse) continue
    for (const sa of item.assignments) {
      if (store.syncStatus[sa.id] !== 'archived') continue
      if (!hit(sa.title) && !hit(sa.requirement)) continue
      push(myCourse.name, myCourse.color, { kind: 'synced', a: sa, from: item.from })
    }
  }
  return [...map.values()]
})
</script>

<template>
  <div>
    <div class="page-title">
      <h2>🗃 归档</h2>
      <span class="muted">完成的作业收在这里，不影响任何统计；可随时恢复</span>
    </div>

    <section v-for="g in groups" :key="g.label" class="card">
      <div class="card-head">
        <h3><span :style="{ color: g.color }">●</span> {{ g.label }} <span class="muted">（{{ g.items.length }}）</span></h3>
      </div>
      <div class="asg-list">
        <div v-for="e in g.items" :key="e.kind + e.a.id" class="asg done">
          <div class="asg-body">
            <div class="asg-top">
              <span class="asg-title">{{ e.a.title }}</span>
              <span v-if="e.kind === 'synced'" class="badge sync-badge">同步 · {{ e.from }}</span>
            </div>
            <div class="asg-meta">
              <span class="badge b-none">{{ e.kind === 'synced' || e.a.status === 'done' ? '已完成' : '未完成时归档' }}</span>
              <span v-if="e.a.deadline">原 DDL：{{ fmtDT(e.a.deadline) }}</span>
            </div>
            <details v-if="e.a.requirement" class="req">
              <summary>作业要求</summary>
              <div class="req-body"><RichText :text="e.a.requirement" /></div>
            </details>
          </div>
          <div class="asg-ops">
            <button
              class="icon-btn" :title="e.kind === 'synced' ? '恢复到班级同步列表' : '恢复到原列表'"
              @click="e.kind === 'synced' ? restoreSynced(e.a.id) : restoreAssignment(e.a.id)">↩️</button>
            <button
              v-if="e.kind === 'own'"
              class="icon-btn" title="彻底删除" @click="deleteAssignment(e.a.id)">🗑️</button>
          </div>
        </div>
      </div>
    </section>

    <div v-if="!groups.length" class="empty">
      <span class="big">🗃️</span>归档是空的
      <div><button class="btn sm" @click="emit('open-course')">去课程页把完成的作业归档</button></div>
    </div>
  </div>
</template>
