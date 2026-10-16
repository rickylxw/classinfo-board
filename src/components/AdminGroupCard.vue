<script setup>
import { ref, reactive } from 'vue'
import { toast } from '../store'
import { boardAddGroup, boardUpdateGroup, boardRemoveGroup, reviewBoardGroup } from '../api'

/* 管理台的共享教学群卡片（多群模型：一门课可挂多个群）。
   自包含：展示全部群 / 添加 / 编辑 / 删除 / 待审申请审核，直接调 API；
   任何变更后 emit('changed') 让父级刷新数据 */
const props = defineProps({
  board: { type: Object, required: true },
  showCourse: { type: Boolean, default: false }
})
const emit = defineEmits(['changed'])

const groups = () => props.board.groups || []

const panelOpen = ref(false)
const editingId = ref('')
const saving = ref(false)
const form = reactive({ type: 'QQ群', num: '', link: '', note: '' })

function togglePanel() {
  panelOpen.value = !panelOpen.value
  editingId.value = ''
  Object.assign(form, { type: 'QQ群', num: '', link: '', note: '' })
}
function startEdit(g) {
  panelOpen.value = true
  editingId.value = g.id
  Object.assign(form, { type: g.type || 'QQ群', num: g.num || '', link: g.link || '', note: g.note || '' })
}
async function save() {
  if (!form.num.trim() && !form.link.trim() && !form.note.trim()) {
    toast('群号、链接、备注至少填一项', 'error')
    return
  }
  saving.value = true
  try {
    if (editingId.value) await boardUpdateGroup(props.board.key, editingId.value, { ...form })
    else await boardAddGroup(props.board.key, { ...form })
    toast('教学群已保存并同步给全班')
    panelOpen.value = false
    editingId.value = ''
    emit('changed')
  } catch (e) { toast(e.message, 'error') }
  saving.value = false
}
async function remove(g) {
  if (!confirm(`删除「${g.num || g.link || '这个群'}」？全班同步删除。`)) return
  try {
    await boardRemoveGroup(props.board.key, g.id)
    toast('已删除该共享教学群')
    emit('changed')
  } catch (e) { toast(e.message, 'error') }
}
async function review(pid, approve) {
  if (!approve && !confirm('驳回该教学群申请？')) return
  try {
    await reviewBoardGroup(props.board.key, pid, approve)
    toast(approve ? '已通过并同步给全班' : '已驳回')
    emit('changed')
  } catch (e) { toast(e.message, 'error') }
}
const fmt = ts => ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
</script>

<template>
  <div class="admin-group-card">
    <div class="admin-group-card-head">
      <template v-if="showCourse">
        <b>{{ board.courseName }}</b><span class="muted"> · {{ board.teacher || '无教师' }}</span>
      </template>
      <span class="badge" :class="(board.pendingGroups || []).length ? 'b-week' : groups().length ? 'b-done' : 'b-none'">
        {{ (board.pendingGroups || []).length ? `待审 ${board.pendingGroups.length}` : groups().length ? `已设置 ${groups().length} 个` : '未设置' }}
      </span>
      <button class="btn sm admin-group-edit" @click="togglePanel">
        {{ panelOpen ? '✏️ 收起' : groups().length ? '✏️ 管理' : '➕ 添加' }}
      </button>
    </div>

    <div v-for="g in groups()" :key="g.id" class="share-app-row">
      <div class="share-app-main">
        <span>👥 {{ g.type || '—' }} · <b>{{ g.num || g.link || '—' }}</b></span>
        <span v-if="g.note" class="muted"> · {{ g.note }}</span>
        <span class="muted"> · 更新于 {{ fmt(g.updatedAt) }}</span>
      </div>
      <span style="display:flex;gap:6px;">
        <button class="btn sm" @click="startEdit(g)">✏️ 编辑</button>
        <button class="btn sm danger-ghost" @click="remove(g)">删除</button>
      </span>
    </div>
    <div v-if="!groups().length" class="muted admin-board-empty">{{ board.exists === false ? '课程尚无共享板动态——添加教学群后自动建板并对全班生效' : '未设置——添加后立即同步给全班同学' }}</div>

    <div v-for="pg in board.pendingGroups || []" :key="pg.pid" class="admin-group-pending">
      <div class="admin-group-title">⏳ 教学群{{ pg.action === 'edit' ? '修改' : '添加' }}申请（来自 {{ pg.xhMasked }}）</div>
      <div class="group-grid">
        <span class="gl">类型</span><span class="gv"><b>{{ pg.group.type || '—' }}</b></span>
        <span class="gl">群号/群名</span><span class="gv"><b>{{ pg.group.num || '—' }}</b></span>
        <span class="gl">链接</span><span class="gv">{{ pg.group.link || '—' }}</span>
        <span class="gl">备注</span><span class="gv">{{ pg.group.note || '—' }}</span>
      </div>
      <div class="admin-group-ops">
        <button class="btn sm primary" @click="review(pg.pid, true)">✅ 通过并同步</button>
        <button class="btn sm danger-ghost" @click="review(pg.pid, false)">❌ 驳回</button>
      </div>
    </div>

    <div v-if="panelOpen" class="admin-group-form">
      <div class="admin-group-title">{{ editingId ? '✏️ 编辑群' : '➕ 添加一个群' }}</div>
      <div class="row2">
        <div class="field"><label>群类型</label>
          <select v-model="form.type">
            <option>QQ群</option><option>微信群</option><option>数智东南群</option>
            <option>课程平台</option><option>其他</option>
          </select>
        </div>
        <div class="field"><label>群号 / 群名</label><input v-model="form.num" maxlength="60" placeholder="如 741 952 836"></div>
      </div>
      <div class="field"><label>加群 / 入口链接</label><input v-model="form.link" type="url" placeholder="https://…（可留空）"></div>
      <div class="field"><label>群备注</label><input v-model="form.note" maxlength="200" placeholder="如：作业提交到群文件（可留空）"></div>
      <div class="admin-group-ops">
        <button class="btn sm primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : (editingId ? '💾 保存修改' : '➕ 添加') }}</button>
        <button class="btn sm" @click="panelOpen = false">取消</button>
      </div>
    </div>
  </div>
</template>
