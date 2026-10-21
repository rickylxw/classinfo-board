<script setup>
import { computed, reactive, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  store, toast, session, toggleAssignment, deleteAssignment, deleteCourse,
  uploadFiles, downloadFile, deleteFile, archiveDone, archiveAssignment,
  copySharedAssignment, toggleSynced, applyShare, fetchShareStatus, fetchSyncs,
  loadBoard, boardSaveAssignment, boardRemoveAssignment, boardAddFile, boardRemoveFile, downloadBoardFile,
  submitBoardFile, loadMySubmissions,
  onSyncBroadcast,
  submitExistingAssignment, submitExistingFile,
  submitGroupProposal, reviewBoardGroupEdit,
  publishExistingAssignment, publishExistingFile,
  boardAddGroup, boardUpdateGroup, boardRemoveGroup,
  archiveSynced
} from '../store'
import { ddlBadge, fmtDT, fmtSize, fileIcon, courseKeyOf, openGroupChat } from '../utils'
import RichText from './RichText.vue'
import BoardReviewRow from './BoardReviewRow.vue'

const props = defineProps({ course: { type: Object, required: true } })
const emit = defineEmits(['edit-course', 'new-assignment', 'edit-assignment', 'new-link', 'board-assignment', 'submit-assignment'])

const maskXh = xh => (String(xh || '').length > 5 ? xh.slice(0, 3) + '****' + xh.slice(-2) : xh)

const fileInput = ref(null)
const boardInput = ref(null)
const submitInput = ref(null)

/* 课程负责人申请状态：none / pending / rejected / approved（isOwner） */
const shareInfo = ref({ status: 'none', isOwner: false, hasOwner: false })
const courseKey = computed(() => courseKeyOf(props.course))

async function loadShareInfo() {
  shareInfo.value = { status: 'none', isOwner: false, hasOwner: false }
  store.board = {}
  store.mySubs = { assignments: [], files: [], groups: [] }
  if (!session.xh || session.isAdmin || !props.course.name) return
  shareInfo.value = await fetchShareStatus(props.course.name, props.course.teacher)
  if (shareInfo.value.isOwner) loadBoard(courseKey.value)
  // 无论是否有负责人，成员都可以投稿并查看自己的待审状态
  loadMySubmissions(courseKey.value)
}
async function apply() {
  const r = await applyShare(props.course.name, props.course.teacher)
  if (r) loadShareInfo()
}
watch(() => props.course.id, loadShareInfo, { immediate: true })

/* 共享板广播到达：整页共享状态对齐一次（负责人待审/板内容、成员我的待审、负责人身份芯片），
 * 无需重进课程页。广播 1s 防抖 + 此处 800ms 合并；切课程页时 courseKey 跟随变化 */
let boardSyncTimer = null
let offBoardSync = null
onMounted(() => {
  offBoardSync = onSyncBroadcast(() => {
    if (!session.xh || session.isAdmin || !props.course.name) return
    if (boardSyncTimer) return
    boardSyncTimer = setTimeout(() => {
      boardSyncTimer = null
      loadShareInfo()
    }, 800)
  })
})
onBeforeUnmount(() => {
  if (offBoardSync) offBoardSync()
  if (boardSyncTimer) clearTimeout(boardSyncTimer)
})

/* 本课收到的班级同步（负责人维护的共享板） */
const synced = computed(() => store.synced[courseKey.value] || null)
const syncedVisible = computed(() =>
  (synced.value?.assignments || []).filter(a => store.syncStatus[a.id] !== 'archived'))
const syncedPending = computed(() =>
  syncedVisible.value.filter(a => store.syncStatus[a.id] !== 'done').length)
const board = computed(() => store.board[courseKey.value] || null)

/* 共享板页签：有待审时自动跳到「待审」 */
const boardTab = ref('items')
const pendingTotal = computed(() =>
  (board.value?.pendingAssignments?.length || 0) + (board.value?.pendingFiles?.length || 0))
watch(pendingTotal, n => { if (n) boardTab.value = 'review' })

function matchText(...parts) {
  const q = store.view.q.trim().toLowerCase()
  if (!q) return true
  return parts.join(' ').toLowerCase().includes(q)
}

const asgCount = computed(() => store.assignments.filter(a => a.courseId === props.course.id).length)
const fileCount = computed(() => store.files.filter(f => f.courseId === props.course.id && !f.inline).length)

const asgs = computed(() => store.assignments
  .filter(a => a.courseId === props.course.id && !a.archived && matchText(a.title, a.requirement || ''))
  .sort((a, b) => {
    if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1
    return (a.deadline || '9999').localeCompare(b.deadline || '9999')
  }))

const doneN = computed(() => store.assignments
  .filter(a => a.courseId === props.course.id && !a.archived && a.status === 'done').length)

const files = computed(() => store.files
  .filter(f => f.courseId === props.course.id && !f.inline && matchText(f.name, f.note || '', f.url || '')))

const pendingN = computed(() =>
  asgs.value.filter(a => a.status !== 'done').length + syncedPending.value)

/* 共享板附件：并入「文件」卡片统一展示（负责人=自己维护的；成员=负责人/管理员发布的） */
const sharedFiles = computed(() => {
  if (session.isAdmin) return []
  const key = courseKey.value
  if (shareInfo.value.isOwner) return store.board[key]?.files || []
  if (!session.xh) return []
  return store.synced[key]?.files || []
})
const sharedFrom = computed(() =>
  shareInfo.value.isOwner ? '我维护的共享附件' : (synced.value?.from ? `来自 ${synced.value.from}` : '共享附件'))

/* 登录用户（非管理员）都可以一键投稿/发布自己的作业与文件 */
const canPush = computed(() => session.xh && !session.isAdmin)
/* 负责人=直接发布上架；成员=投稿（负责人审；无负责人时管理员审） */
function pushAssignment(a) {
  shareInfo.value.isOwner
    ? publishExistingAssignment(courseKey.value, a)
    : submitExistingAssignment(courseKey.value, a, shareInfo.value.hasOwner)
}
function pushFile(f) {
  shareInfo.value.isOwner
    ? publishExistingFile(courseKey.value, f)
    : submitExistingFile(courseKey.value, f, shareInfo.value.hasOwner)
}
const pushTitle = computed(() =>
  shareInfo.value.isOwner
    ? '发布到共享板（立即同步全班）'
    : `投稿到共享板（待${shareInfo.value.hasOwner ? '课程负责人' : '管理员'}审核）`)

function pickFiles() {
  fileInput.value.value = ''
  fileInput.value.click()
}
function onFilesChange(e) {
  uploadFiles([...e.target.files], props.course.id)
}
function pickBoardFiles() {
  boardInput.value.value = ''
  boardInput.value.click()
}
async function onBoardFilesChange(e) {
  for (const f of e.target.files) await boardAddFile(courseKey.value, f)
}
/* 成员投稿附件 */
function pickSubmitFiles() {
  submitInput.value.value = ''
  submitInput.value.click()
}
async function onSubmitFilesChange(e) {
  for (const f of e.target.files) await submitBoardFile(courseKey.value, f)
  loadMySubmissions(courseKey.value)
}
/* 负责人维护共享教学群（可挂多个）：添加 / 编辑 / 删除 */
const gform = reactive({ type: 'QQ群', num: '', link: '', note: '' })
const editingId = ref('')   // 非空 = 正在编辑这个群
async function saveGroup() {
  if (!gform.num.trim() && !gform.link.trim() && !gform.note.trim()) {
    toast('群号、链接、备注至少填一项', 'error')
    return
  }
  if (editingId.value) await boardUpdateGroup(courseKey.value, editingId.value, { ...gform })
  else await boardAddGroup(courseKey.value, { ...gform })
  resetGroupForm()
}
function editGroup(g) {
  editingId.value = g.id
  Object.assign(gform, { type: g.type || 'QQ群', num: g.num || '', link: g.link || '', note: g.note || '' })
}
function resetGroupForm() {
  editingId.value = ''
  Object.assign(gform, { type: 'QQ群', num: '', link: '', note: '' })
}
async function removeGroup(id) {
  if (!confirm('删除这个共享教学群？全班同学都会同步删除。')) return
  await boardRemoveGroup(courseKey.value, id)
}
/* 点击群号：复制并尽力跳转到对应应用 */
async function jumpGroup(g) {
  if (!g?.num) return
  const msg = await openGroupChat(g.type, g.num)
  if (msg) toast(msg)
}
/* 教学群（可多个）：负责人看自己维护的列表，成员看同步到的列表 */
const groupList = computed(() => {
  const list = shareInfo.value.isOwner
    ? (board.value?.groups || [])
    : (synced.value?.groups || (synced.value?.group ? [synced.value.group] : []))
  return list.filter(g => g.num || g.link || g.note)
})
/* 成员：提交教学群申请（add=贡献新群 / edit=修改已有群） */
const gsubOpen = ref(false)
const gsubAction = ref('add')
const gsubId = ref('')
const gsub = reactive({ type: 'QQ群', num: '', link: '', note: '' })
function openGroupProposal(action = 'add', g = null) {
  gsubAction.value = action
  gsubId.value = action === 'edit' && g ? g.id : ''
  gsubOpen.value = true
  Object.assign(gsub, {
    type: (action === 'edit' && g ? g.type : '') || 'QQ群',
    num: g?.num || '',
    link: g?.link || '',
    note: g?.note || ''
  })
}
async function submitGroupEdit() {
  if (!gsub.num.trim() && !gsub.link.trim() && !gsub.note.trim()) {
    toast('群号、链接、备注至少填一项', 'error')
    return
  }
  await submitGroupProposal(courseKey.value, gsubAction.value, { ...gsub }, gsubId.value)
  gsubOpen.value = false
}
async function reviewGroupEdit(pid, approve) {
  await reviewBoardGroupEdit(courseKey.value, pid, approve)
}
function fileSub(f) {
  if (f.kind === 'link') {
    const host = (f.url || '').replace(/^https?:\/\//, '').split('/')[0]
    return host + (f.note ? ' · ' + f.note : '')
  }
  return `${fmtSize(f.size)} · ${fmtDT(f.addedAt)}`
}
</script>

<template>
  <div>
    <div class="page-title"><h2>课程详情</h2></div>

    <section class="card course-head" :style="{ '--c': course.color }">
      <div class="ch-row">
        <div style="flex:1;min-width:0;">
          <h2>{{ course.name }}</h2>
          <div class="ch-meta">
            <span v-if="course.category" class="chip cat">🏷️ {{ course.category }}</span>
            <span v-if="course.teacher" class="chip">👤 {{ course.teacher }}</span>
            <span v-if="course.semester" class="chip">📅 {{ course.semester }}</span>
            <span class="chip">作业 {{ asgCount }} · 文件 {{ fileCount }}</span>
            <!-- 课程负责人状态 -->
            <template v-if="session.xh && !session.isAdmin">
              <button v-if="shareInfo.status === 'none' && !shareInfo.hasOwner" class="chip chip-btn" title="审核通过后你将负责维护这门课的共享代办与附件" @click="apply">📨 申请成为课程负责人</button>
              <span v-else-if="shareInfo.status === 'pending'" class="chip" style="background:#fef9c3;color:#a16207;">⏳ 负责人申请审核中</span>
              <span v-else-if="shareInfo.status === 'rejected'" class="chip" style="background:#fee2e2;color:#b91c1c;" title="被驳回的申请无法重新提交">🚫 申请已驳回（不可重新申请）</span>
              <span v-else-if="shareInfo.isOwner" class="chip" style="background:#ecfdf5;color:#047857;">👑 我是课程负责人</span>
              <button v-else-if="shareInfo.status === 'approved' && !shareInfo.hasOwner" class="chip chip-btn" style="background:#fef9c3;color:#a16207;" title="你的负责人身份已被管理员撤销，可重新申请" @click="apply">👑 曾任负责人（已撤销）· 重新申请</button>
              <span v-else-if="shareInfo.hasOwner" class="chip" style="background:#eff6ff;color:#1d4ed8;">👑 课程负责人已设定 · 班级同步已开启</span>
            </template>
          </div>
          <p v-if="course.note" class="ch-note">{{ course.note }}</p>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn sm" @click="emit('edit-course', course)">✏️ 编辑</button>
          <button class="btn sm danger-ghost" @click="deleteCourse(course.id)">🗑️ 删除课程</button>
        </div>
      </div>
    </section>

    <div class="grid2">
      <!-- 作业与 DDL -->
      <section class="card">
        <div class="card-head">
          <h3>📝 作业与 DDL <span class="muted">（{{ pendingN }} 项待办）</span></h3>
          <div class="ops">
            <button v-if="doneN" class="btn sm" title="把已完成的收进「归档」" @click="archiveDone({ courseId: course.id })">🧹 归档已完成（{{ doneN }}）</button>
            <button class="btn sm primary" @click="emit('new-assignment')">＋ 添加作业</button>
          </div>
        </div>
        <TransitionGroup name="list" tag="div" class="asg-list">
          <!-- 我的作业 -->
          <div v-for="a in asgs" :key="a.id" class="asg" :class="{ done: a.status === 'done' }">
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
                <summary>作业要求</summary>
                <div class="req-body"><RichText :text="a.requirement" /></div>
              </details>
            </div>
            <div class="asg-ops">
              <button
                class="icon-btn" title="归档（从列表收起，可在「归档」找回）"
                @click="archiveAssignment(a.id)">📦</button>
              <button
                v-if="canPush"
                class="icon-btn" :title="pushTitle"
                @click="pushAssignment(a)">📤</button>
              <button class="icon-btn" title="编辑" @click="emit('edit-assignment', a)">✏️</button>
              <button class="icon-btn" title="删除" @click="deleteAssignment(a.id)">🗑️</button>
            </div>
          </div>

          <!-- 班级同步的作业（完成状态仅自己可见，可个人归档） -->
          <template v-if="synced">
            <div v-for="a in syncedVisible" :key="'s-' + a.id" class="asg" :class="{ done: store.syncStatus[a.id] === 'done' }">
              <button
                class="chk"
                :class="{ on: store.syncStatus[a.id] === 'done' }"
                :title="store.syncStatus[a.id] === 'done' ? '标记未完成' : '标记完成'"
                @click="toggleSynced(a.id)">{{ store.syncStatus[a.id] === 'done' ? '✓' : '' }}</button>
              <div class="asg-body">
                <div class="asg-top">
                  <span class="asg-title">{{ a.title }}</span>
                  <span class="badge sync-badge">同步 · {{ synced.from }}</span>
                </div>
                <div class="asg-meta">
                  <span class="badge" :class="ddlBadge(a.deadline, 'pending').cls">{{ ddlBadge(a.deadline, 'pending').text }}</span>
                  <span v-if="a.deadline">📅 {{ fmtDT(a.deadline) }}</span>
                </div>
                <details v-if="a.requirement" class="req">
                  <summary>作业要求</summary>
                  <div class="req-body"><RichText :text="a.requirement" /></div>
                </details>
              </div>
              <div class="asg-ops">
                <button class="icon-btn" title="归档（仅自己隐藏，可在「归档」找回）" @click="archiveSynced(a.id)">📦</button>
                <button class="icon-btn" title="复制为我的作业（可编辑）" @click="copySharedAssignment(a, course.id)">📋</button>
              </div>
            </div>
          </template>

          <div v-if="!asgs.length && !syncedVisible.length" class="empty">
            <span class="big">🗒️</span>暂无作业记录
            <div><button class="btn sm primary" @click="emit('new-assignment')">＋ 添加作业</button></div>
          </div>
        </TransitionGroup>
      </section>

      <div class="col">
        <!-- 负责人：共享板管理（页签布局） -->
        <section v-if="shareInfo.isOwner" class="card board-card">
          <div class="card-head">
            <h3>👑 共享板管理 <span class="muted">（自动同步给全部同课同学）</span></h3>
            <div class="ops">
              <button v-if="boardTab !== 'review' && pendingTotal" class="btn sm" @click="boardTab = 'review'">⏳ 去审核（{{ pendingTotal }}）</button>
              <button v-if="boardTab !== 'items'" class="btn sm primary" @click="boardTab = 'items'">＋ 添加共享作业</button>
            </div>
          </div>

          <div class="board-tabs">
            <button class="board-tab" :class="{ active: boardTab === 'review' }" @click="boardTab = 'review'">
              ⏳ 待审 <span v-if="pendingTotal" class="tab-badge">{{ pendingTotal }}</span>
            </button>
            <button class="board-tab" :class="{ active: boardTab === 'items' }" @click="boardTab = 'items'">
              📝 作业 {{ board?.assignments?.length || 0 }}
            </button>
            <button class="board-tab" :class="{ active: boardTab === 'files' }" @click="boardTab = 'files'">
              📎 附件 {{ board?.files?.length || 0 }}
            </button>
            <button class="board-tab" :class="{ active: boardTab === 'group' }" @click="boardTab = 'group'">
              👥 教学群
            </button>
          </div>

          <!-- 待审 -->
          <template v-if="boardTab === 'review'">
            <template v-if="board?.pendingAssignments?.length || board?.pendingFiles?.length">
              <div v-for="a in board.pendingAssignments" :key="'pa-' + a.id">
                <BoardReviewRow :board-key="courseKey" :item="a" type="assignment" :submitter="maskXh(a.xh)" @reviewed="loadShareInfo" />
              </div>
              <div v-for="f in board.pendingFiles" :key="'pf-' + f.id">
                <BoardReviewRow :board-key="courseKey" :item="f" type="file" :submitter="maskXh(f.xh)" @reviewed="loadShareInfo" />
              </div>
            </template>
            <div v-else class="empty" style="padding:14px;">没有待审的成员投稿</div>
          </template>

          <!-- 已上架作业 -->
          <template v-if="boardTab === 'items'">
            <div v-for="a in board?.assignments || []" :key="a.id" class="asg">
              <div class="asg-body">
                <div class="asg-top"><span class="asg-title">{{ a.title }}</span></div>
                <div class="asg-meta">
                  <span v-if="a.deadline" class="badge" :class="ddlBadge(a.deadline, 'pending').cls">{{ ddlBadge(a.deadline, 'pending').text }}</span>
                  <span v-if="a.deadline">📅 {{ fmtDT(a.deadline) }}</span>
                </div>
                <details v-if="a.requirement" class="req">
                  <summary>作业要求</summary>
                  <div class="req-body"><RichText :text="a.requirement" /></div>
                </details>
              </div>
              <div class="asg-ops">
                <button class="icon-btn" title="编辑" @click="emit('board-assignment', courseKey, a)">✏️</button>
                <button class="icon-btn" title="删除" @click="boardRemoveAssignment(courseKey, a.id)">🗑️</button>
              </div>
            </div>
            <div v-if="!board?.assignments?.length" class="muted" style="font-size:12px;">共享板还没有作业，点右上角「＋ 添加共享作业」</div>
          </template>

          <!-- 附件（与作业一致的卡片形式） -->
          <template v-if="boardTab === 'files'">
            <div v-for="f in board?.files || []" :key="f.id" class="asg">
              <span class="ficon">📎</span>
              <div class="asg-body">
                <div class="asg-top"><span class="asg-title">{{ f.name }}</span></div>
                <div class="asg-meta">
                  <span class="badge b-far">{{ fmtSize(f.size) }}</span>
                  <span>共享附件 · 全班可下载</span>
                </div>
              </div>
              <div class="asg-ops">
                <button class="icon-btn" title="下载" @click="downloadBoardFile(courseKey, f.id, f.name)">⬇️</button>
                <button class="icon-btn" title="删除" @click="boardRemoveFile(courseKey, f.id)">🗑️</button>
              </div>
            </div>
            <div v-if="!board?.files?.length" class="empty" style="padding:14px;">
              <span class="big">📎</span>还没有共享附件
            </div>
            <div style="margin-top:8px;">
              <button class="btn sm" @click="pickBoardFiles">⬆️ 上传共享附件</button>
            </div>
            <input type="file" ref="boardInput" multiple hidden @change="onBoardFilesChange">
          </template>

          <!-- 共享教学群（可挂多个） -->
          <template v-if="boardTab === 'group'">
            <template v-if="(board?.pendingGroups || []).length">
              <div v-for="pg in board.pendingGroups" :key="pg.pid" style="margin-bottom:12px;">
                <div style="font-size:13px;font-weight:600;color:#a16207;">⏳ 教学群{{ pg.action === 'edit' ? '修改' : '添加' }}申请（来自 {{ maskXh(pg.xh) }}）</div>
                <div class="group-grid" style="margin:6px 0 8px;">
                  <span class="gl">类型</span><span class="gv"><b>{{ pg.group.type || '—' }}</b></span>
                  <span class="gl">群号/群名</span><span class="gv"><b>{{ pg.group.num || '—' }}</b></span>
                  <span class="gl">链接</span><span class="gv">{{ pg.group.link || '—' }}</span>
                  <span class="gl">备注</span><span class="gv">{{ pg.group.note || '—' }}</span>
                </div>
                <div style="display:flex;gap:6px;">
                  <button class="btn sm primary" @click="reviewGroupEdit(pg.pid, true)">✅ 通过并同步</button>
                  <button class="btn sm danger-ghost" @click="reviewGroupEdit(pg.pid, false)">❌ 驳回</button>
                </div>
              </div>
            </template>
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;">共享教学群（可挂多个） <span class="muted">（改动立即同步给全班）</span></div>
            <div v-for="g in board?.groups || []" :key="g.id" class="group-item">
              <div class="group-grid" style="flex:1;">
                <span class="gl">类型</span><span class="gv"><b>{{ g.type || '—' }}</b></span>
                <span class="gl">群号/群名</span><span class="gv"><b>{{ g.num || '—' }}</b></span>
                <span class="gl">链接</span><span class="gv">{{ g.link || '—' }}</span>
                <span class="gl">备注</span><span class="gv">{{ g.note || '—' }}</span>
              </div>
              <div class="asg-ops">
                <button class="icon-btn" title="编辑" @click="editGroup(g)">✏️</button>
                <button class="icon-btn" title="删除" @click="removeGroup(g.id)">🗑️</button>
              </div>
            </div>
            <div v-if="!(board?.groups || []).length" class="muted" style="font-size:12px;">还没有共享教学群，在下方添加第一个</div>
            <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line);">
              <div style="font-size:13px;font-weight:600;margin-bottom:6px;">{{ editingId ? '✏️ 编辑群' : '➕ 添加一个群' }}</div>
              <div class="row2">
                <div class="field"><label>群类型</label>
                  <select v-model="gform.type">
                    <option>QQ群</option><option>微信群</option><option>数智东南群</option>
                    <option>课程平台</option><option>其他</option>
                  </select>
                </div>
                <div class="field"><label>群号 / 群名</label><input v-model="gform.num" maxlength="60" placeholder="如 741 952 836"></div>
              </div>
              <div class="field"><label>加群 / 入口链接</label><input v-model="gform.link" type="url" placeholder="https://…（可留空）"></div>
              <div class="field"><label>群备注</label><input v-model="gform.note" maxlength="200" placeholder="如：作业提交到群文件（可留空）"></div>
              <div style="display:flex;gap:6px;">
                <button class="btn sm primary" @click="saveGroup">{{ editingId ? '💾 保存修改' : '➕ 添加这个群' }}</button>
                <button v-if="editingId" class="btn sm" @click="resetGroupForm">取消编辑</button>
              </div>
            </div>
          </template>
        </section>

        <!-- 成员：班级同步 + 投稿（无论是否有负责人，均可投稿） -->
        <section v-else-if="session.xh && !session.isAdmin" class="card">
          <div class="card-head">
            <h3>🤝 班级同步 <span class="muted">{{ shareInfo.hasOwner ? `（来自 ${synced?.from || '课程负责人'} · 完成状态各自独立）` : '（本课暂未设课程负责人）' }}</span></h3>
            <div class="ops">
              <button v-if="synced" class="icon-btn" title="重新拉取同步" @click="fetchSyncs()">🔄</button>
              <button class="btn sm" title="把 DDL/作业提交审核，通过后同步给全班" @click="emit('submit-assignment', courseKey)">📤 投稿作业</button>
            </div>
          </div>
          <template v-if="synced">
            <div class="muted" style="font-size:12px;margin-bottom:6px;">
              共 {{ syncedVisible.length }} 项作业、{{ synced.files.length }} 个附件{{ shareInfo.hasOwner ? '由课程负责人维护' : '由管理员维护' }}；标完成只影响你自己。共享附件已并入下方「文件」卡片。
            </div>
            <div v-if="!synced.files.length" class="muted" style="font-size:12px;">暂无共享附件</div>
          </template>
          <div v-else class="muted" style="font-size:12px;margin-bottom:6px;">
            本课还没有上架的共享内容{{ shareInfo.hasOwner ? '' : '（也未设负责人，投稿将由管理员审核）' }}；你可以直接投稿，审核通过后就会同步给全班。
          </div>

          <!-- 投稿附件 + 我的待审投稿 -->
          <div style="margin-top:10px;">
            <button class="btn sm" @click="pickSubmitFiles">📤 投稿附件</button>
            <span class="muted" style="font-size:12px;margin-left:6px;">投稿经{{ shareInfo.hasOwner ? '课程负责人' : '管理员' }}审核通过后，会同步给全班</span>
          </div>
          <template v-if="store.mySubs.assignments.length || store.mySubs.files.length">
            <div style="margin-top:8px;font-size:12px;font-weight:600;color:#a16207;">⏳ 我投稿待审核（{{ store.mySubs.assignments.length + store.mySubs.files.length }}）</div>
            <div v-for="a in store.mySubs.assignments" :key="'msa-' + a.id" class="file-item">
              <span class="ficon">📝</span>
              <div class="f-main"><div class="f-name" :title="a.title">{{ a.title }}</div><div class="f-sub">作业投稿</div></div>
              <span class="badge b-week">待审核</span>
            </div>
            <div v-for="f in store.mySubs.files" :key="'msf-' + f.id" class="file-item">
              <span class="ficon">{{ fileIcon(f.name, 'blob') }}</span>
              <div class="f-main"><div class="f-name" :title="f.name">{{ f.name }}</div><div class="f-sub">{{ fmtSize(f.size) }} · 附件投稿</div></div>
              <span class="badge b-week">待审核</span>
            </div>
          </template>
          <input type="file" ref="submitInput" multiple hidden @change="onSubmitFilesChange">
        </section>

        <!-- 教学群（班级共享，可挂多个：负责人/管理员维护，成员可申请添加/修改） -->
        <section class="card">
          <div class="card-head">
            <h3>👥 教学群 <span class="muted">（班级共享 · 可挂多个）</span></h3>
            <div class="ops">
              <button v-if="shareInfo.isOwner" class="btn sm" title="在共享板管理的「教学群」页签维护" @click="boardTab = 'group'">👑 去维护</button>
              <button v-else-if="session.xh && !session.isAdmin" class="btn sm" @click="openGroupProposal('add')">✏️ 申请添加群</button>
            </div>
          </div>
          <div v-if="groupList.length">
            <div v-for="(g, i) in groupList" :key="g.id || i" class="group-item">
              <div class="group-grid" style="flex:1;">
                <span class="gl">类型</span><span class="gv"><b>{{ g.type || '—' }}</b></span>
                <span class="gl">群号/群名</span>
                <span class="gv">
                  <b v-if="g.num" class="jump-link" title="点击复制群号并打开对应应用" @click="jumpGroup(g)">{{ g.num }}</b>
                  <template v-else>—</template>
                </span>
                <span class="gl">链接</span>
                <span class="gv">
                  <a v-if="g.link" class="jump-link" :href="g.link" target="_blank" rel="noopener" title="点击打开链接">{{ g.link }}</a>
                  <template v-else>—</template>
                </span>
                <span class="gl">备注</span><span class="gv">{{ g.note || '—' }}</span>
              </div>
              <div v-if="session.xh && !session.isAdmin && !shareInfo.isOwner" class="asg-ops">
                <button class="icon-btn" title="申请修改这个群" @click="openGroupProposal('edit', g)">✏️</button>
              </div>
            </div>
          </div>
          <div v-else class="group-empty">
            <span>班级还没有共享教学群</span>
            <button v-if="shareInfo.isOwner" class="btn sm" @click="boardTab = 'group'">去维护</button>
            <span v-else-if="session.xh && !session.isAdmin" class="muted" style="font-size:12px;">点右上角「申请添加群」，经{{ shareInfo.hasOwner ? '课程负责人' : '管理员' }}审核后同步全班</span>
            <span v-else class="muted" style="font-size:12px;">登录后可见班级共享教学群</span>
          </div>
          <!-- 成员的申请表单与待审状态 -->
          <div v-if="gsubOpen" style="margin-top:8px;padding:10px;border:1px solid var(--line);border-radius:10px;">
            <div class="muted" style="font-size:12px;margin-bottom:6px;">{{ gsubAction === 'edit' ? '申请修改这个群' : '申请添加一个新群' }}，经{{ shareInfo.hasOwner ? '课程负责人' : '管理员' }}审核通过后同步给全班</div>
            <div class="row2">
              <div class="field"><label>群类型</label>
                <select v-model="gsub.type">
                  <option>QQ群</option><option>微信群</option><option>数智东南群</option>
                  <option>课程平台</option><option>其他</option>
                </select>
              </div>
              <div class="field"><label>群号 / 群名</label><input v-model="gsub.num" maxlength="60" placeholder="如 741 952 836"></div>
            </div>
            <div class="field"><label>加群 / 入口链接</label><input v-model="gsub.link" type="url" placeholder="https://…（可留空）"></div>
            <div class="field"><label>群备注</label><input v-model="gsub.note" maxlength="200" placeholder="可留空"></div>
            <div style="display:flex;gap:6px;">
              <button class="btn sm primary" @click="submitGroupEdit">提交{{ gsubAction === 'edit' ? '修改' : '添加' }}申请</button>
              <button class="btn sm" @click="gsubOpen = false">收起</button>
            </div>
          </div>
          <template v-if="(store.mySubs.groups || []).length">
            <div style="margin-top:8px;font-size:12px;font-weight:600;color:#a16207;">⏳ 我的待审申请（{{ store.mySubs.groups.length }}）</div>
            <div v-for="pg in store.mySubs.groups" :key="pg.pid" class="file-item">
              <span class="ficon">📢</span>
              <div class="f-main">
                <div class="f-name">教学群{{ pg.action === 'edit' ? '修改' : '添加' }}申请</div>
                <div class="f-sub">{{ pg.group.num || pg.group.link || pg.group.note || '（空）' }}</div>
              </div>
              <span class="badge b-week">待审核</span>
            </div>
          </template>
        </section>

        <!-- 文件 -->
        <section class="card">
          <div class="card-head">
            <h3>📁 文件</h3>
            <div class="ops">
              <button class="btn sm" @click="emit('new-link')">🔗 添加链接</button>
              <button class="btn sm primary" @click="pickFiles">⬆️ 上传文件</button>
            </div>
          </div>
          <div v-for="f in files" :key="f.id" class="file-item">
            <span class="ficon">{{ fileIcon(f.name, f.kind) }}</span>
            <div class="f-main">
              <div class="f-name">
                <a v-if="f.kind === 'link'" :href="f.url" target="_blank" rel="noopener" :title="f.url">{{ f.name }}</a>
                <span v-else :title="f.name">{{ f.name }}</span>
              </div>
              <div class="f-sub">{{ fileSub(f) }}</div>
            </div>
            <div class="asg-ops">
              <button
                v-if="canPush && f.kind === 'blob'"
                class="icon-btn" :title="pushTitle"
                @click="pushFile(f)">📤</button>
              <button class="icon-btn" :title="f.kind === 'link' ? '打开链接' : '下载'" @click="downloadFile(f.id)">
                {{ f.kind === 'link' ? '🌐' : '⬇️' }}
              </button>
              <button class="icon-btn" title="删除" @click="deleteFile(f.id)">🗑️</button>
            </div>
          </div>
          <!-- 共享板附件并入文件列表 -->
          <div v-for="f in sharedFiles" :key="'sf-' + f.id" class="file-item">
            <span class="ficon">📎</span>
            <div class="f-main">
              <div class="f-name" :title="f.name">{{ f.name }}</div>
              <div class="f-sub">{{ fmtSize(f.size) }} · {{ sharedFrom }}</div>
            </div>
            <div class="asg-ops">
              <button class="icon-btn" title="下载" @click="downloadBoardFile(courseKey, f.id, f.name)">⬇️</button>
              <button
                v-if="shareInfo.isOwner"
                class="icon-btn" title="从共享板删除" @click="boardRemoveFile(courseKey, f.id)">🗑️</button>
            </div>
          </div>
          <div v-if="!files.length && !sharedFiles.length" class="empty"><span class="big">📂</span>暂无文件，可上传或添加链接</div>
          <input type="file" ref="fileInput" multiple hidden @change="onFilesChange">
        </section>
      </div>
    </div>
  </div>
</template>
