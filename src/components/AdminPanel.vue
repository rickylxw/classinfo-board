<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  adminOverview, adminShares, adminShareDecision, adminShareRevoke, adminShareAppoint,
  adminSubmissions, adminBoards, adminKick, adminDeleteAccount,
  boardDeleteAssignment, boardDeleteFile,
  reviewBoardGroup
} from '../api'
import { toast } from '../store'
import BoardReviewRow from './BoardReviewRow.vue'
import AdminGroupCard from './AdminGroupCard.vue'

const data = ref(null)
const shares = ref(null)
const submissions = ref(null)
const boards = ref(null)
const error = ref('')
const loading = ref(false)
const updatedAt = ref(null)

/* 标签页导航；首次加载自动跳到第一个有待办的队列 */
const activeTab = ref('boards')
const bootstrapped = ref(false)
const boardQ = ref('')
const accountQ = ref('')
const appFilter = ref('all')

const TABS = [
  { id: 'submissions', label: '📥 投稿审核' },
  { id: 'applications', label: '📨 负责人申请' },
  { id: 'groups', label: '💬 教学群' },
  { id: 'boards', label: '🗂 共享板内容' },
  { id: 'accounts', label: '👥 账号管理' }
]

const APP_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待审核' },
  { id: 'approved', label: '已通过' },
  { id: 'revoked', label: '已撤销' },
  { id: 'rejected', label: '已驳回' }
]

const pendingSubs = computed(() => submissions.value?.submissions.length ?? 0)
const pendingApps = computed(() => shares.value?.applications.filter(a => a.status === 'pending').length ?? 0)

const filteredBoards = computed(() => {
  const list = boards.value?.boards ?? []
  const q = boardQ.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(b => (b.courseName + ' ' + (b.teacher || '')).toLowerCase().includes(q))
})

const filteredAccounts = computed(() => {
  const list = data.value?.accounts ?? []
  const q = accountQ.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(a => a.xh.toLowerCase().includes(q))
})

/* 共享教学群维护（多群）：增删改/审核都封装在 AdminGroupCard 内，改完 emit('changed') 刷新；
   投稿队列里的群申请审核仍走这里的 reviewGroup */
async function reviewGroup(key, pid, approve) {
  if (!approve && !confirm('驳回该教学群申请？')) return
  await reviewBoardGroup(key, pid, approve)
  toast(approve ? '已通过并同步给全班' : '已驳回')
  load()
}

/* 教学群管理页：状态筛选 + 搜索 */
const groupFilter = ref('all')
const groupQ = ref('')
const groupStats = computed(() => {
  const list = boards.value?.boards ?? []
  return {
    total: list.length,
    set: list.filter(b => (b.groups || []).length).length,
    unset: list.filter(b => !(b.groups || []).length).length,
    pending: list.filter(b => (b.pendingGroups || []).length).length
  }
})
const filteredGroups = computed(() => {
  let list = boards.value?.boards ?? []
  if (groupFilter.value === 'set') list = list.filter(b => (b.groups || []).length)
  else if (groupFilter.value === 'unset') list = list.filter(b => !(b.groups || []).length)
  else if (groupFilter.value === 'pending') list = list.filter(b => (b.pendingGroups || []).length)
  const q = groupQ.value.trim().toLowerCase()
  if (q) list = list.filter(b => (b.courseName + ' ' + (b.teacher || '')).toLowerCase().includes(q))
  return list
})

/* 申请状态归类：待审核 / 已通过（现任或他人任）/ 已撤销（通过但无人任）/ 已驳回 */
function appStatus(a) {
  if (a.status === 'pending') return 'pending'
  if (a.status === 'rejected') return 'rejected'
  return a.hasOwner ? 'approved' : 'revoked'
}
const filteredApps = computed(() => {
  const list = shares.value?.applications ?? []
  if (appFilter.value === 'all') return list
  return list.filter(a => appStatus(a) === appFilter.value)
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await adminOverview()
    shares.value = await adminShares()
    submissions.value = await adminSubmissions()
    boards.value = await adminBoards()
    updatedAt.value = Date.now()
    if (!bootstrapped.value) {
      bootstrapped.value = true
      activeTab.value = pendingSubs.value ? 'submissions' : pendingApps.value ? 'applications' : 'boards'
    }
  } catch (e) { error.value = e.message }
  loading.value = false
}
onMounted(load)

/* 管理员删除已上架的共享作业/附件（同步给全班的删除） */
async function delBoardItem(key, type, id, name) {
  if (!confirm(`从共享板删除「${name}」？\n所有同学都会同步删除，不可恢复。`)) return
  if (type === 'file') await boardDeleteFile(key, id)
  else await boardDeleteAssignment(key, id)
  toast('已删除并同步')
  load()
}

async function decide(app, approve) {
  if (!approve && !confirm(`驳回 ${app.xhMasked} 的课程负责人申请？\n驳回后该同学将无法再次申请这门课的负责人。`)) return
  const r = await adminShareDecision(app.key, app.xh, approve)
  toast(approve
    ? (r.ownerSet ? '已通过并任命为课程负责人，共享板对全班开放' : '已通过（该课程已有其他负责人）')
    : '已驳回（该同学不可再申请此课负责人）')
  load()
}
async function revoke(key) {
  if (!confirm('撤销该课程的负责人？\n共享板数据保留，之后可任命新负责人；撤销期间同学不再收到同步。')) return
  await adminShareRevoke(key)
  toast('已撤销课程负责人')
  load()
}
async function appoint(app) {
  const r = await adminShareAppoint(app.key, app.xh)
  if (r.error) { toast(r.error, 'error'); return }
  toast('已重新任命为课程负责人')
  load()
}
async function kick(xh) {
  if (!confirm(`将 ${xh} 的所有登录会话踢下线？`)) return
  const r = await adminKick(xh)
  toast(`已踢下线 ${r.kicked} 个会话`)
  load()
}
async function removeAccount(xh) {
  if (!confirm(`彻底删除账号 ${xh}？\n将删除其云端数据、全部上传文件与登录会话，不可恢复。`)) return
  await adminDeleteAccount(xh)
  toast(`账号 ${xh} 已删除`)
  load()
}
const fmt = ts => ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
</script>

<template>
  <div class="main">
    <div class="main-inner">
      <div class="page-title">
        <h2>🛡 管理控制台</h2>
        <span class="muted">独立于用户界面 · 审核与账号管理</span>
        <span class="admin-title-ops">
          <span v-if="updatedAt" class="admin-updated">更新于 {{ fmt(updatedAt) }}</span>
          <button class="btn sm" :disabled="loading" @click="load">🔄 刷新</button>
        </span>
      </div>

      <div v-if="error" class="tt-status error">{{ error }}</div>
      <div v-if="loading && !data" class="empty"><span class="big">⏳</span>加载中…</div>

      <template v-if="data">
        <!-- 统计：待办两项可点击直达对应队列 -->
        <div class="stats five">
          <div class="stat tone-violet"><div class="num">{{ data.accounts.length }}</div><div class="lbl">注册账号</div></div>
          <div class="stat tone-blue"><div class="num">{{ data.activeSessions }}</div><div class="lbl">活跃会话</div></div>
          <div class="stat tone-green"><div class="num">{{ shares?.ownerCount ?? '—' }}</div><div class="lbl">课程负责人</div></div>
          <button class="stat" :class="{ 'tone-orange': pendingSubs > 0 }" @click="activeTab = 'submissions'">
            <div class="num">{{ pendingSubs }}</div><div class="lbl">待审投稿</div>
          </button>
          <button class="stat" :class="{ 'tone-red': pendingApps > 0 }" @click="activeTab = 'applications'">
            <div class="num">{{ pendingApps }}</div><div class="lbl">待审申请</div>
          </button>
        </div>

        <!-- 标签页导航（审核队列带待办徽标） -->
        <nav class="board-tabs admin-tabs">
          <button
            v-for="t in TABS" :key="t.id"
            class="board-tab" :class="{ active: activeTab === t.id }"
            @click="activeTab = t.id">
            {{ t.label }}
            <span v-if="t.id === 'submissions' && pendingSubs" class="tab-badge">{{ pendingSubs }}</span>
            <span v-if="t.id === 'applications' && pendingApps" class="tab-badge">{{ pendingApps }}</span>
            <span v-if="t.id === 'groups' && groupStats.pending" class="tab-badge">{{ groupStats.pending }}</span>
          </button>
        </nav>

        <!-- 成员投稿审核 -->
        <section v-if="activeTab === 'submissions'" class="card">
          <div class="card-head">
            <h3>📥 成员投稿审核 <span class="muted">（负责人未处理或未设负责人时在此审核）</span></h3>
          </div>
          <div v-if="submissions?.submissions.length" class="admin-sub-list">
            <div v-for="s in submissions.submissions" :key="s.type + (s.pid ?? s.id ?? s.submittedAt)">
              <div class="admin-sub-meta">
                {{ s.courseName }}{{ s.teacher ? '（' + s.teacher + '）' : '' }} · {{ s.type === 'file' ? '附件投稿' : s.type === 'group' ? (s.action === 'edit' ? '教学群修改' : '教学群添加') : '作业投稿' }} · {{ fmt(s.submittedAt) }} · 来自 {{ s.xhMasked }}
              </div>
              <template v-if="s.type === 'group'">
                <div class="group-grid admin-sub-group">
                  <span class="gl">类型</span><span class="gv"><b>{{ s.group.type || '—' }}</b></span>
                  <span class="gl">群号/群名</span><span class="gv"><b>{{ s.group.num || '—' }}</b></span>
                  <span class="gl">链接</span><span class="gv">{{ s.group.link || '—' }}</span>
                  <span class="gl">备注</span><span class="gv">{{ s.group.note || '—' }}</span>
                </div>
                <div class="admin-group-ops">
                  <button class="btn sm primary" @click="reviewGroup(s.key, s.pid, true)">✅ 通过并同步</button>
                  <button class="btn sm danger-ghost" @click="reviewGroup(s.key, s.pid, false)">❌ 驳回</button>
                </div>
              </template>
              <BoardReviewRow
                v-else
                :board-key="s.key"
                :item="s"
                :type="s.type"
                :submitter="s.xhMasked"
                @reviewed="load" />
            </div>
          </div>
          <div v-else class="empty"><span class="big">📭</span>暂无待审投稿</div>
        </section>

        <!-- 负责人申请审核 -->
        <section v-if="activeTab === 'applications'" class="card">
          <div class="card-head">
            <h3>📨 课程负责人申请审核</h3>
          </div>
          <div v-if="shares?.applications.length" class="admin-filter">
            <button
              v-for="f in APP_FILTERS" :key="f.id"
              class="btn sm" :class="{ active: appFilter === f.id }"
              @click="appFilter = f.id">{{ f.label }}</button>
          </div>
          <div v-if="filteredApps.length">
            <div v-for="a in filteredApps" :key="a.key + a.xh" class="share-app-row">
              <div class="share-app-main">
                <div>
                  <b>{{ a.courseName }}</b>
                  <span class="muted"> · {{ a.teacher || '无教师' }} · 申请人 {{ a.xhMasked }}</span>
                  <span class="muted"> · {{ fmt(a.appliedAt) }}</span>
                </div>
                <span v-if="a.status === 'pending'" class="badge b-week">待审核</span>
                <span v-else-if="a.isOwner" class="badge b-done">已通过 · 现任负责人</span>
                <span v-else-if="a.status === 'approved' && a.hasOwner" class="badge b-done">已通过（负责人为他人）</span>
                <span v-else-if="a.status === 'approved'" class="badge b-over">负责人已撤销</span>
                <span v-else class="badge b-over">已驳回（不可重申）</span>
              </div>
              <div class="ops" style="display:flex;gap:6px;">
                <template v-if="a.status === 'pending'">
                  <button class="btn sm primary" @click="decide(a, true)">通过并任命</button>
                  <button class="btn sm danger-ghost" @click="decide(a, false)">驳回</button>
                </template>
                <button v-else-if="a.isOwner" class="btn sm" @click="revoke(a.key)">撤销负责人</button>
                <button v-else-if="a.status === 'approved' && !a.hasOwner" class="btn sm primary" @click="appoint(a)">重新任命</button>
              </div>
            </div>
          </div>
          <div v-else-if="shares?.applications.length" class="empty"><span class="big">🔍</span>没有符合筛选的申请</div>
          <div v-else class="empty"><span class="big">📨</span>暂无负责人申请</div>
        </section>

        <!-- 教学群管理 -->
        <section v-if="activeTab === 'groups'" class="card">
          <div class="card-head">
            <h3>💬 教学群管理 <span class="muted">（全部课程的教学群一览，可添加、编辑、删除与审核申请）</span></h3>
          </div>
          <div v-if="boards?.boards.length" class="admin-toolbar">
            <div class="admin-filter" style="margin-bottom:0;">
              <button class="btn sm" :class="{ active: groupFilter === 'all' }" @click="groupFilter = 'all'">全部 {{ groupStats.total }}</button>
              <button class="btn sm" :class="{ active: groupFilter === 'set' }" @click="groupFilter = 'set'">已设置 {{ groupStats.set }}</button>
              <button class="btn sm" :class="{ active: groupFilter === 'unset' }" @click="groupFilter = 'unset'">未设置 {{ groupStats.unset }}</button>
              <button class="btn sm" :class="{ active: groupFilter === 'pending' }" @click="groupFilter = 'pending'">有待审 {{ groupStats.pending }}</button>
            </div>
            <input v-model="groupQ" class="admin-search" placeholder="搜索课程 / 教师…" style="margin-left:auto;">
          </div>
          <div v-if="filteredGroups.length" class="admin-sub-list">
            <AdminGroupCard
              v-for="b in filteredGroups" :key="b.key"
              :board="b" show-course
              @changed="load" />
          </div>
          <div v-else-if="boards?.boards.length" class="empty"><span class="big">🔍</span>没有符合筛选的课程</div>
          <div v-else class="empty"><span class="big">🗂</span>还没有任何共享板</div>
        </section>

        <!-- 共享板内容管理 -->
        <section v-if="activeTab === 'boards'" class="card">
          <div class="card-head">
            <h3>🗂 共享板内容管理 <span class="muted">（浏览所有课程的已上架内容，可删除）</span></h3>
          </div>
          <div v-if="boards?.boards.length" class="admin-toolbar">
            <input v-model="boardQ" class="admin-search" placeholder="搜索课程 / 教师…">
            <span class="admin-count">{{ filteredBoards.length }} / {{ boards.boards.length }} 个共享板</span>
          </div>
          <div v-if="filteredBoards.length">
            <div v-for="b in filteredBoards" :key="b.key" class="admin-board">
              <div class="admin-board-head">
                {{ b.courseName }}<span class="muted"> · {{ b.teacher || '无教师' }}</span>
                <span class="badge" :class="b.owner ? 'b-done' : 'b-none'">{{ b.owner ? '负责人 ' + b.owner : '未设负责人' }}</span>
                <span v-if="b.pending" class="badge b-week">{{ b.pending }} 项待审</span>
              </div>
              <div v-for="a in b.assignments" :key="a.id" class="share-app-row">
                <div class="share-app-main">
                  <span>📝 {{ a.title }}</span>
                  <span v-if="a.deadline" class="muted"> · 截止 {{ fmt(new Date(a.deadline).getTime()) }}</span>
                </div>
                <button class="btn sm danger-ghost" @click="delBoardItem(b.key, 'assignment', a.id, a.title)">删除</button>
              </div>
              <div v-for="f in b.files" :key="f.id" class="share-app-row">
                <div class="share-app-main">
                  <span>📎 {{ f.name }}</span>
                  <span class="muted"> · {{ (f.size / 1024).toFixed(1) }} KB</span>
                </div>
                <button class="btn sm danger-ghost" @click="delBoardItem(b.key, 'file', f.id, f.name)">删除</button>
              </div>

              <!-- 教学群（多群）：展示 / 编辑 / 待审，全在卡片内 -->
              <AdminGroupCard :board="b" @changed="load" />

              <div v-if="!b.assignments.length && !b.files.length" class="muted admin-board-empty">板上暂无已上架内容</div>
            </div>
          </div>
          <div v-else-if="boards?.boards.length" class="empty"><span class="big">🔍</span>没有匹配的共享板</div>
          <div v-else class="empty"><span class="big">🗂</span>还没有任何共享板</div>
        </section>

        <!-- 账号管理 -->
        <section v-if="activeTab === 'accounts'" class="card">
          <div class="card-head">
            <h3>👥 账号管理</h3>
          </div>
          <div class="admin-toolbar">
            <input v-model="accountQ" class="admin-search" placeholder="搜索学号…">
            <span class="admin-count">{{ filteredAccounts.length }} / {{ data.accounts.length }} 个账号</span>
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr><th>学号</th><th>课程</th><th>作业</th><th>文件</th><th>数据大小</th><th>最近登录</th><th>数据更新</th><th>操作</th></tr>
              </thead>
              <tbody>
                <tr v-for="a in filteredAccounts" :key="a.xh">
                  <td class="mono">{{ a.xh }}</td>
                  <td>{{ a.courses }}</td>
                  <td>{{ a.assignments }}</td>
                  <td>{{ a.files }}</td>
                  <td>{{ (a.size / 1024).toFixed(1) }} KB</td>
                  <td>{{ fmt(a.lastLoginAt) }}</td>
                  <td>{{ fmt(a.dataUpdatedAt) }}</td>
                  <td class="ops">
                    <button class="btn sm" @click="kick(a.xh)">踢下线</button>
                    <button class="btn sm danger-ghost" @click="removeAccount(a.xh)">删除</button>
                  </td>
                </tr>
                <tr v-if="!filteredAccounts.length"><td colspan="8" class="muted" style="text-align:center;">{{ accountQ ? '没有匹配的账号' : '暂无账号' }}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
