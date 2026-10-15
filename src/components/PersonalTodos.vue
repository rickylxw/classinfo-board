<script setup>
import { computed } from 'vue'
import { store, PERSONAL_ID, toggleAssignment, deleteAssignment, archiveAssignment, archiveDone } from '../store'
import { ddlBadge, fmtDT } from '../utils'
import RichText from './RichText.vue'

const emit = defineEmits(['add', 'edit'])

const items = computed(() => store.assignments
  .filter(a => a.courseId === PERSONAL_ID && !a.archived)
  .filter(a => {
    const q = store.view.q.trim().toLowerCase()
    if (!q) return true
    return (a.title + ' ' + (a.requirement || '')).toLowerCase().includes(q)
  })
  .sort((a, b) => {
    if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1
    return (a.deadline || '9999').localeCompare(b.deadline || '9999')
  }))

const pendingN = computed(() => items.value.filter(a => a.status !== 'done').length)
const doneN = computed(() => items.value.filter(a => a.status === 'done').length)
</script>

<template>
  <div>
    <div class="page-title"><h2>📌 个人待办</h2><span class="muted">不属于任何课程 · 仅自己可见</span></div>

    <section class="card">
      <div class="card-head">
        <h3>📝 待办 <span class="muted">（{{ pendingN }} 项待办）</span></h3>
        <div class="ops">
          <button v-if="doneN" class="btn sm" title="把已完成的收进「归档」" @click="archiveDone('personal')">🧹 归档已完成（{{ doneN }}）</button>
          <button class="btn sm primary" @click="emit('add')">＋ 添加待办</button>
        </div>
      </div>
      <TransitionGroup name="list" tag="div" class="asg-list">
        <div v-for="a in items" :key="a.id" class="asg" :class="{ done: a.status === 'done' }">
          <button
            class="chk"
            :class="{ on: a.status === 'done' }"
            :title="a.status === 'done' ? '标记未完成' : '标记完成'"
            @click="toggleAssignment(a.id)">{{ a.status === 'done' ? '✓' : '' }}</button>
          <div class="asg-body">
            <div class="asg-top"><span class="asg-title">{{ a.title }}</span></div>
            <div class="asg-meta">
              <span class="badge" :class="ddlBadge(a.deadline, a.status).cls">{{ ddlBadge(a.deadline, a.status).text }}</span>
              <span v-if="a.deadline">📅 {{ fmtDT(a.deadline) }}</span>
            </div>
            <details v-if="a.requirement" class="req">
              <summary>备注</summary>
              <div class="req-body"><RichText :text="a.requirement" /></div>
            </details>
          </div>
          <div class="asg-ops">
            <button class="icon-btn" title="归档（从列表收起，可在「归档」找回）" @click="archiveAssignment(a.id)">📦</button>
            <button class="icon-btn" title="编辑" @click="emit('edit', a)">✏️</button>
            <button class="icon-btn" title="删除" @click="deleteAssignment(a.id)">🗑️</button>
          </div>
        </div>
        <div v-if="!items.length" class="empty">
          <span class="big">📌</span>还没有个人待办
          <div><button class="btn sm primary" @click="emit('add')">＋ 添加待办</button></div>
        </div>
      </TransitionGroup>
    </section>
  </div>
</template>
