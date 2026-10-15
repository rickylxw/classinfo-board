/* 全局响应式状态 + 持久化（localStorage 结构化数据 / IndexedDB 文件实体 / 登录后同步云端） */
import { reactive, watch } from 'vue'
import { uid, toLocalInput, courseKeyOf } from './utils'
import * as api from './api'
import { session } from './api'

// CourseDetail 等组件从 store 取 session，这里转导出一份
export { session }

const LS_KEY = 'classinfo-board-data'

// 课程类别（要加类别改这里即可；空字符串 = 未分类）
export const CATEGORIES = ['数理基础类', '专业类', '思政类', '通选类', '体育类']
export const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6']

export const store = reactive({
  courses: [],      // { id, name, teacher, semester, category, color, group:{type,num,link,note}, note, createdAt }
  assignments: [],  // { id, courseId, title, deadline, status, requirement, createdAt }  courseId='personal' 为个人待办
  files: [],        // { id, courseId, kind:'blob'|'link', name, size, url, note, addedAt, data?, inline? }
  synced: {},       // courseKey -> { ref, from, assignments, files }（负责人维护的共享板，自动同步给同课同学）
  syncStatus: {},   // syncedAssignmentId -> 'done' | 'pending'（个人完成状态，不参与共享）
  board: {},        // courseKey -> 共享板原文（负责人管理视图用，不持久化）
  mySubs: { assignments: [], files: [], group: null },   // 我投稿到当前共享板的待审条目
  sidebarOpen: false,   // 移动端抽屉
  view: { type: 'overview', id: null, q: '' }   // 当前视图 + 搜索词
})

// 个人待办的虚拟课程 id（不属于任何课程）
export const PERSONAL_ID = 'personal'
export const PERSONAL_COURSE = { name: '个人待办', color: '#64748b' }
export const personalCount = () =>
  store.assignments.filter(a => a.courseId === PERSONAL_ID && a.status !== 'done' && !a.archived).length

/* ---------- DDL 归档（完成后清出主列表，随时恢复；个人与课程作业均可归档） ---------- */
export const archivedCount = () => store.assignments.filter(a => a.archived).length

export function archiveAssignment(id) {
  const a = store.assignments.find(x => x.id === id)
  if (a) {
    a.archived = true
    enqueueOps([{ op: 'upsert', coll: 'assignments', items: [{ ...a }] }])
    toast('已归档，可在「🗃 归档」中找回')
  }
}
export function restoreAssignment(id) {
  const a = store.assignments.find(x => x.id === id)
  if (a) {
    a.archived = false
    enqueueOps([{ op: 'upsert', coll: 'assignments', items: [{ ...a }] }])
    toast('已恢复到原列表')
  }
}
export function archiveDone(scope) {
  // scope: 'personal' | { courseId } | 'all'（仅统计自己的作业与个人待办，不含班级同步项）
  const list = store.assignments.filter(a => {
    if (a.status !== 'done' || a.archived) return false
    if (scope === 'personal') return a.courseId === PERSONAL_ID
    if (scope === 'all') return true
    return scope?.courseId && a.courseId === scope.courseId
  })
  if (!list.length) { toast('没有可归档的已完成作业'); return }
  list.forEach(a => { a.archived = true })
  enqueueOps([{ op: 'upsert', coll: 'assignments', items: list.map(a => ({ ...a })) }])
  toast(`已归档 ${list.length} 项已完成作业`)
}

/* ---------- Toast ---------- */
export const toasts = reactive([])
export function toast(msg, type = '') {
  const t = { id: uid(), msg, type }
  toasts.push(t)
  setTimeout(() => { const i = toasts.indexOf(t); if (i > -1) toasts.splice(i, 1) }, type === 'error' ? 4500 : 2600)
}

/* ---------- localStorage 持久化（启动缓存 + 未登录纯本地模式；登录态下每次变动走 ops 即时上云） ---------- */
function persist() {
  localStorage.setItem(LS_KEY, JSON.stringify({
    courses: store.courses,
    assignments: store.assignments,
    files: store.files,
    syncStatus: store.syncStatus
  }))
}
watch(() => [store.courses, store.assignments, store.files, store.syncStatus], persist, { deep: true })

/* ---------- 云端同步（服务器权威：服务端数据是唯一可信源） ----------
 * 每次变动立即向后端发请求：变动先落本机（乐观更新，UI 即时响应），同时作为 ops 进队列
 * 串行发往服务器；服务器按序合并后返回权威状态，本机采用（服务器强制下发）。
 * localStorage 仅作启动缓存与未登录的纯本地模式，登录态下云端才是存储本体。 */
function project() {
  // 上传云端时剥离内联 dataURL（文件本体单独走 /files/:id）
  return {
    courses: store.courses,
    assignments: store.assignments,
    files: store.files.map(f => (f.data ? { ...f, data: undefined } : f)),
    syncStatus: store.syncStatus
  }
}

/* 采用云端权威状态（保留当前视图；本机内联图片的 dataURL 回退不丢） */
function adoptCanonical(data) {
  if (!data) return
  // 显式删除在途的条目：即使权威快照里还有（删除 op 尚未落库），也不许回到本机
  const isPendingRemoval = it => pendingRemovalIds.has(String(it.id))
  store.courses = (data.courses || []).filter(c => !isPendingRemoval(c))
  store.assignments = (data.assignments || []).filter(a => !isPendingRemoval(a))
  store.files = (data.files || []).filter(f => !isPendingRemoval(f)).map(f => {
    const local = store.files.find(x => x.id === f.id)
    return !f.data && local?.data ? { ...f, data: local.data } : f
  })
  store.syncStatus = data.syncStatus || {}
  // 服务端已确认不存在（删除落库）的 id 不再需要拦截
  const present = (list, id) => list.some(x => String(x.id) === id)
  for (const id of [...pendingRemovalIds]) {
    if (!present(store.courses, id) && !present(store.assignments, id) && !present(store.files, id)) {
      pendingRemovalIds.delete(id)
    }
  }
}

/* 显式删除的去重防护：删除 op 落库前，权威状态下发不许把这些条目带回来 */
const pendingRemovalIds = new Set()
function trackRemovals(removed) {
  for (const k of ['courses', 'assignments', 'files']) {
    for (const id of (removed?.[k] || [])) pendingRemovalIds.add(String(id))
  }
}

/* ops 队列：串行发送、失败按原序放回重试；仅在请求在途没有新变动时采用响应（防覆盖乐观更新） */
const opQueue = []
let pumping = false
let opSeq = 0
let pushFails = 0
function enqueueOps(ops) {
  if (!session.token || session.isAdmin) return   // 未登录 = 纯本地模式；管理员会话不写用户数据
  opQueue.push(...ops)
  opSeq++
  pumpOps()
}
async function pumpOps() {
  if (pumping || !opQueue.length || !session.token || session.isAdmin) return
  pumping = true
  const seqAtSend = opSeq
  const batch = opQueue.splice(0, opQueue.length)
  let failed = false
  try {
    const r = await api.pushOps(batch)
    pushFails = 0
    if (r?.data && opSeq === seqAtSend && session.token && !session.isAdmin) adoptCanonical(r.data)
  } catch (e) {
    failed = true
    opQueue.unshift(...batch)   // 按原序放回队首
    if (++pushFails === 3) toast('云端同步连续失败：' + e.message + '（改动已保存在本机，将自动重试）', 'error')
    setTimeout(pumpOps, 4000)
  } finally {
    pumping = false
  }
  if (!failed && opQueue.length) pumpOps()
}

/* 登录/恢复会话时的对齐：云端已有数据 → 本机独有条目只增并入云端，随后整体采用云端状态；
 * 云端为空 → 把本机数据首次备份上去。没有「本机覆盖云端」的路径。 */
async function reconcileWithCloud() {
  const cloud = await api.fetchCloudData()
  const cloudHas = cloud.courses?.length || cloud.assignments?.length || cloud.files?.length
  const localHas = store.courses.length || store.assignments.length || store.files.length
  if (cloudHas) {
    const r = await api.mergeLocalData(project())
    adoptCanonical(r?.data || cloud)
    toast('已同步云端数据（以云端为准）')
  } else if (localHas) {
    const r = await api.pushCloudData(project())
    if (r?.data) adoptCanonical(r.data)
    toast('本地数据已备份到云端')
  }
}

/* ---------- 班级同步（审核通过后自动接收同步源的作业，完成状态仅自己可见） ---------- */
export async function fetchSyncs() {
  if (!session.token || session.isAdmin) return
  try {
    const list = await api.fetchSync()
    const map = {}
    for (const item of list) map[item.key] = item
    store.synced = map
  } catch (e) { /* 静默，下次再拉 */ }
}

export function toggleSynced(id) {
  if (store.syncStatus[id] === 'archived') return   // 已归档的先恢复再操作
  store.syncStatus[id] = store.syncStatus[id] === 'done' ? 'pending' : 'done'
  enqueueOps([{ op: 'syncStatus', entries: { [id]: store.syncStatus[id] } }])
}

/* 同步作业的个人归档：仅隐藏自己视角，共享板与他人不受影响 */
export function archiveSynced(id) {
  store.syncStatus[id] = 'archived'
  enqueueOps([{ op: 'syncStatus', entries: { [id]: 'archived' } }])
  toast('已归档，可在「🗃 归档」中找回')
}
export function restoreSynced(id) {
  store.syncStatus[id] = 'pending'
  enqueueOps([{ op: 'syncStatus', entries: { [id]: 'pending' } }])
  toast('已恢复到班级同步列表')
}

export async function applyShare(name, teacher) {
  try {
    const r = await api.applyShare(name, teacher)
    if (r.status === 'has-owner') toast('该课程已有课程负责人', 'error')
    else toast('负责人申请已提交，等待管理员审核')
    return r
  } catch (e) {
    toast(e.message, 'error')
    return null
  }
}

export async function fetchShareStatus(name, teacher) {
  try { return await api.fetchShareStatus(name, teacher) } catch (e) { return { status: 'none', isOwner: false, hasOwner: false } }
}

/* ---------- 共享板（课程负责人编辑，自动同步给同课同学） ---------- */
export async function loadBoard(key) {
  try { store.board[key] = await api.fetchBoard(key) } catch (e) { /* 非负责人 */ }
}
export async function boardSaveAssignment(key, data) {
  await api.boardUpsertAssignment(key, data)
  await loadBoard(key)
  fetchSyncs()
  toast(data.id ? '共享作业已更新' : '共享作业已添加')
}
export async function boardRemoveAssignment(key, id) {
  if (!confirm('从共享板删除这项作业？所有同学都会同步删除。')) return
  await api.boardDeleteAssignment(key, id)
  await loadBoard(key)
  fetchSyncs()
  toast('共享作业已删除')
}
export async function boardAddFile(key, file) {
  await api.boardUploadFile(key, file.name, file)
  await loadBoard(key)
  fetchSyncs()
  toast('附件已上传并同步')
}
export async function boardRemoveFile(key, id) {
  if (!confirm('删除这个共享附件？所有同学都会同步删除。')) return
  await api.boardDeleteFile(key, id)
  await loadBoard(key)
  fetchSyncs()
  toast('附件已删除')
}
export async function downloadBoardFile(key, id, name) {
  try {
    const blob = await api.fetchBoardFileBlob(key, id)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  } catch (e) {
    toast(e.message, 'error')
  }
}

/* ---------- 共享教学群（负责人/管理员维护，随板同步；成员可一键填入自己的教学群） ---------- */
export async function saveBoardGroup(key, group) {
  await api.saveBoardGroup(key, group)
  await loadBoard(key)
  fetchSyncs()
  toast('共享教学群已保存并同步')
}

export function applySharedGroupToCourse(key, courseId) {
  const g = store.synced[key]?.group
  const c = courseById(courseId)
  if (!g || !c) return
  if (!confirm(`用共享教学群覆盖「${c.name}」的教学群信息？\n当前填写的内容会被替换。`)) return
  c.group = { type: g.type || '其他', num: g.num || '', link: g.link || '', note: g.note || '' }
  enqueueOps([{ op: 'upsert', coll: 'courses', items: [{ ...c }] }])
  toast('已填入我的教学群')
}

/* 成员提交教学群信息修改申请（负责人/管理员审核通过后同步全班） */
export async function submitBoardGroupEdit(key, group) {
  await api.submitBoardGroup(key, group)
  await loadMySubmissions(key)
  toast('教学群修改申请已提交，等待审核')
}
export async function reviewBoardGroupEdit(key, approve) {
  await api.reviewBoardGroup(key, approve)
  await loadBoard(key)
  fetchSyncs()
  toast(approve ? '已通过，共享教学群已更新并同步' : '已驳回该修改申请')
}

/* ---------- 成员投稿（提交 DDL/作业与附件，负责人审核通过后上架同步） ---------- */
export async function submitBoardAssignment(key, data) {
  await api.submitBoardAssignment(key, data)
  loadMySubmissions(key)
  toast('已投稿到共享板，等待审核')
}
export async function submitBoardFile(key, file, blobOverride) {
  const blob = blobOverride ?? file
  const name = blobOverride ? file : file.name
  await api.submitBoardFile(key, name, blob)
  loadMySubmissions(key)
  toast('附件已投稿，等待审核')
}
/* 把自己已有的作业/文件一键投稿（个人原条目保持不动）；hasOwner 决定审核方文案 */
export async function submitExistingAssignment(key, a, hasOwner = true) {
  const reviewer = hasOwner ? '课程负责人' : '管理员'
  if (!confirm(`把「${a.title}」投稿到共享板？\n经${reviewer}审核通过后同步给全班；你自己的这条作业不受影响。`)) return
  await submitBoardAssignment(key, { title: a.title, deadline: a.deadline || '', requirement: a.requirement || '' })
}
export async function submitExistingFile(key, f, hasOwner = true) {
  const reviewer = hasOwner ? '课程负责人' : '管理员'
  if (!confirm(`把「${f.name}」投稿到共享板？\n经${reviewer}审核通过后同步给全班；你自己的这份文件不受影响。`)) return
  const blob = await getFileBlobById(f.id)
  if (!blob) { toast('文件内容在本机不可读（可能来自云端），请先下载后再投稿', 'error'); return }
  await submitBoardFile(key, f.name, blob)
}
/* 负责人：把已有作业/文件直接发布到共享板（无需审核，立即同步） */
export async function publishExistingAssignment(key, a) {
  if (!confirm(`把「${a.title}」直接发布到共享板？\n将立即同步给全班同学；你自己的这条作业不受影响。`)) return
  await boardSaveAssignment(key, { title: a.title, deadline: a.deadline || '', requirement: a.requirement || '' })
}
export async function publishExistingFile(key, f) {
  if (!confirm(`把「${f.name}」直接发布到共享板附件？\n将立即同步给全班同学；你自己的这份文件不受影响。`)) return
  const blob = await getFileBlobById(f.id)
  if (!blob) { toast('文件内容在本机不可读（可能来自云端），请先下载后再发布', 'error'); return }
  await api.boardUploadFile(key, f.name, blob)
  await loadBoard(key)
  fetchSyncs()
  toast('附件已发布并同步')
}
export async function loadMySubmissions(key) {
  try {
    const r = await api.fetchMySubmissions(key)
    store.mySubs = { assignments: r.assignments || [], files: r.files || [], group: r.group || null }
  } catch (e) { store.mySubs = { assignments: [], files: [], group: null } }
}
export async function reviewBoardSubmission(key, type, id, approve, patch = {}) {
  const fn = type === 'file' ? api.reviewBoardFile : api.reviewBoardAssignment
  await fn(key, id, approve, patch)
  await loadBoard(key)
  fetchSyncs()
  toast(approve ? '已通过并上架同步' : '已驳回该投稿')
}

// 应用启动时恢复会话（App.vue onMounted 调用）
// 网络级失败（代理重启/后端刚启动）重试，401 这类明确拒绝不重试
async function fetchMeResilient() {
  let lastErr
  for (let i = 0; i < 3; i++) {
    try { return await api.fetchMe() } catch (e) {
      lastErr = e
      if (String(e.message).includes('未登录')) throw e
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw lastErr
}

export async function initSession() {
  if (!session.token) return
  // 刷新后首个请求偶发撞上陈旧连接，网络级失败整段重试；401 明确拒绝立即退出
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const me = await fetchMeResilient()
      if (me.admin) {
        session.isAdmin = true
        session.xh = 'admin'
        return
      }
      session.xh = me.xh
      await reconcileWithCloud()
      fetchSyncs()
      // 学期起点漫游：本地没设而云端有时自动带上
      try {
        const { semStart } = await api.getCloudSemStart()
        if (semStart && !localStorage.getItem('classinfo-sem-start')) {
          localStorage.setItem('classinfo-sem-start', semStart)
        }
      } catch (e) { /* 忽略 */ }
      return
    } catch (e) {
      if (String(e.message).includes('未登录')) { api.setToken(''); return }
      if (attempt === 2) { api.setToken(''); return }   // 连续失败，回到本地模式
      await new Promise(r => setTimeout(r, 600))
    }
  }
}

export async function handleLogin(token, xh) {
  api.setToken(token, xh)
  await reconcileWithCloud()
}

export function handleAdminLogin(token) {
  // 管理员登录不挤掉用户登录：先备份用户会话，退出管理员时自动恢复
  if (session.token && !session.isAdmin) {
    localStorage.setItem('classinfo-user-backup', JSON.stringify({ token: session.token, xh: session.xh }))
  }
  api.setToken(token, 'admin')
  session.isAdmin = true
}

/* 退出登录：清空本机全部用户数据（云端保留，重新登录取回） */
function wipeLocalData() {
  store.courses = []
  store.assignments = []
  store.files = []
  store.synced = {}
  store.syncStatus = {}
  store.board = {}
  store.view = { type: 'overview', id: null, q: '' }
  opQueue.length = 0
  pendingRemovalIds.clear()
  localStorage.removeItem(LS_KEY)
  localStorage.removeItem('classinfo-user-backup')
  localStorage.removeItem('classinfo-last-cookie')
  try { indexedDB.deleteDatabase('classinfo-board') } catch (e) { /* 忽略 */ }
}

export async function doLogout() {
  if (!confirm('退出登录？\n本机数据将被清空（云端保留），重新登录后自动恢复。')) return false
  await api.logout()
  api.setToken('')
  if (session.isAdmin) {
    // 管理员退出：若有备份的用户会话则直接恢复（不算真正登出）
    const backup = localStorage.getItem('classinfo-user-backup')
    localStorage.removeItem('classinfo-user-backup')
    if (backup) {
      try {
        const { token, xh } = JSON.parse(backup)
        api.setToken(token, xh)
        await reconcileWithCloud()
        fetchSyncs()
        toast(`管理员已退出，已恢复用户登录：${xh}`)
        return true
      } catch (e) {
        api.setToken('')
        wipeLocalData()
        toast('原用户会话已过期，请重新登录', 'error')
        location.reload()
        return true
      }
    }
  }
  // 真正退出：本机不残留任何用户数据
  wipeLocalData()
  toast('已退出登录，本机数据已清空')
  location.reload()
  return true
}

/* ---------- 作业要求里的内嵌图片（不进文件列表，靠 cbimg://<id> 引用） ---------- */
export async function addInlineImage(file, courseId) {
  const id = uid()
  const rec = {
    id, courseId: courseId || '', kind: 'blob', inline: true,
    name: file.name || `图片-${id.slice(0, 6)}.png`,
    size: file.size, mime: file.type, addedAt: Date.now()
  }
  let stored = false
  try { await blobPut(id, file); stored = true }
  catch (e) {
    if (file.size <= 2 * 1024 * 1024) {
      try { rec.data = await blobToDataUrl(file); stored = true } catch (e2) { /* 放弃 */ }
    }
  }
  if (!stored) { toast('图片保存失败', 'error'); return null }
  store.files.push(rec)
  enqueueOps([{ op: 'upsert', coll: 'files', items: [{ ...rec, data: undefined }] }])
  if (session.token) {
    api.putCloudFile(id, file).catch(e => {
      if (session.isAdmin) toast('图片云端备份失败：当前是管理员身份，管理员不能存用户文件。请退出管理员（会自动恢复用户登录）后再试', 'error')
      else toast('图片云端备份失败：' + e.message, 'error')
    })
  }
  return id
}

export async function getFileBlobById(id) {
  try { const b = await blobGet(id); if (b) return b } catch (e) { /* 走云端 */ }
  if (session.token) { try { return await api.fetchCloudFileBlob(id) } catch (e) { /* 都没有 */ } }
  return null
}

/* ---------- 同学共享（同名同教师课程） ---------- */
export async function copySharedAssignment(a, courseId) {
  const mine = store.assignments.find(x =>
    x.courseId === courseId && x.title === a.title && x.deadline === a.deadline)
  if (mine) { toast('我的作业里已有相同标题与 DDL 的条目', 'error'); return }
  const item = {
    id: uid(), courseId, createdAt: Date.now(),
    title: a.title, deadline: a.deadline || '', status: 'pending',
    requirement: a.requirement || ''
  }
  store.assignments.push(item)
  enqueueOps([{ op: 'upsert', coll: 'assignments', items: [{ ...item }] }])
  toast('已复制到我的作业')
}

export function initStore() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      store.courses = d.courses || []
      store.assignments = d.assignments || []
      store.files = d.files || []
      store.syncStatus = d.syncStatus || {}
      localStorage.setItem('classinfo-visited', '1')
      return
    }
  } catch (e) { /* 数据损坏则重置 */ }
  // 示例数据只在第一次使用时出现；退出登录清空后不再重新播种
  if (!localStorage.getItem('classinfo-visited')) {
    localStorage.setItem('classinfo-visited', '1')
    seedSample()
  }
}

function seedSample() {
  const now = Date.now()
  const iso = days => toLocalInput(new Date(now + days * 864e5))
  store.courses = [{
    id: 'c-demo', name: '示例：数据结构（可删除）', teacher: '王老师', semester: '2026-2027-1',
    category: '专业类', color: '#6366f1',
    group: { type: 'QQ群', num: '741 952 836', link: '', note: '作业提交到群文件，命名：学号-姓名-Lab1' },
    note: '成绩构成：平时 30% + 期末 70%\n每周三 3-4 节 · 教三 301',
    createdAt: now
  }]
  store.assignments = [
    { id: 'a-demo1', courseId: 'c-demo', title: 'Lab1 顺序表实现', deadline: iso(2), status: 'pending', requirement: '实现顺序表的增删改查接口，提交 .zip 压缩包，内含源码与实验报告 PDF。', createdAt: now },
    { id: 'a-demo2', courseId: 'c-demo', title: '预习：第 3 章 栈与队列', deadline: iso(6), status: 'pending', requirement: '', createdAt: now }
  ]
  store.files = [
    { id: 'f-demo1', courseId: 'c-demo', kind: 'link', name: '课程主页（示例链接）', url: 'https://example.com', note: '查分、课件下载', addedAt: now }
  ]
}

/* ---------- IndexedDB（上传文件的本体） ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('classinfo-board', 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('blobs')) r.result.createObjectStore('blobs') }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
export async function blobPut(id, blob) {
  const db = await idb()
  return new Promise((res, rej) => {
    const tx = db.transaction('blobs', 'readwrite')
    tx.objectStore('blobs').put(blob, id)
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
}
export async function blobGet(id) {
  const db = await idb()
  return new Promise((res, rej) => {
    const tx = db.transaction('blobs', 'readonly')
    const rq = tx.objectStore('blobs').get(id)
    rq.onsuccess = () => res(rq.result || null)
    rq.onerror = () => rej(rq.error)
  })
}
async function blobDel(id) {
  try {
    const db = await idb()
    await new Promise((res, rej) => {
      const tx = db.transaction('blobs', 'readwrite')
      tx.objectStore('blobs').delete(id)
      tx.oncomplete = res
      tx.onerror = () => rej(tx.error)
    })
  } catch (e) { /* 忽略 */ }
}
async function blobClear() {
  const db = await idb()
  await new Promise((res, rej) => {
    const tx = db.transaction('blobs', 'readwrite')
    tx.objectStore('blobs').clear()
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
}
const blobToDataUrl = blob => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(r.result)
  r.onerror = () => rej(r.error)
  r.readAsDataURL(blob)
})
async function getFileBlob(f) {
  if (f.kind !== 'blob') return null
  try { const b = await blobGet(f.id); if (b) return b } catch (e) { /* 走回退 */ }
  if (f.data) { try { return await (await fetch(f.data)).blob() } catch (e) { /* 忽略 */ } }
  if (session.token) { try { return await api.fetchCloudFileBlob(f.id) } catch (e) { /* 云端也没有 */ } }
  return null
}

/* ---------- 查询 ---------- */
export const courseById = id => store.courses.find(c => c.id === id)
// 课程待办数 = 自己的作业（未归档）+ 该课收到的同步作业（完成状态为各自的，不计入他人视角）
export const pendingCount = courseId => {
  const base = store.assignments.filter(a => a.courseId === courseId && a.status !== 'done' && !a.archived).length
  const c = store.courses.find(x => x.id === courseId)
  if (!c) return base
  const syncedItem = store.synced[courseKeyOf(c)]
  const syncedPending = syncedItem
    ? syncedItem.assignments.filter(a => {
        const st = store.syncStatus[a.id]
        return st !== 'done' && st !== 'archived'
      }).length
    : 0
  return base + syncedPending
}

/* ---------- 课程 ---------- */
export function upsertCourse(data) {
  if (data.id) {
    const c = courseById(data.id)
    if (c) {
      Object.assign(c, data, { updatedAt: Date.now() })
      enqueueOps([{ op: 'upsert', coll: 'courses', items: [{ ...c }] }])
      toast('课程已更新')
    }
  } else {
    // 新建分支：显式 id/createdAt 放在展开之后，避免 data.id === undefined 覆盖
    const c = { ...data, id: uid(), createdAt: Date.now() }
    store.courses.push(c)
    enqueueOps([{ op: 'upsert', coll: 'courses', items: [{ ...c }] }])
    store.view = { type: 'course', id: c.id, q: store.view.q }
    toast('课程已创建')
  }
}

export async function deleteCourse(id) {
  const c = courseById(id)
  if (!c) return
  const na = store.assignments.filter(a => a.courseId === id).length
  const nf = store.files.filter(f => f.courseId === id).length
  if (!confirm(`删除课程「${c.name}」？\n将同时删除 ${na} 项作业、${nf} 个文件，且不可恢复。`)) return
  const removedAssignments = store.assignments.filter(a => a.courseId === id).map(a => a.id)
  const removedFiles = store.files.filter(f => f.courseId === id)
  for (const f of removedFiles) {
    if (f.kind === 'blob') {
      await blobDel(f.id)
      if (session.token && !session.isAdmin) api.deleteCloudFile(f.id).catch(() => {})
    }
  }
  store.courses = store.courses.filter(x => x.id !== id)
  store.assignments = store.assignments.filter(a => a.courseId !== id)
  store.files = store.files.filter(f => f.courseId !== id)
  if (session.token && !session.isAdmin) {
    const removed = { courses: [id], assignments: removedAssignments, files: removedFiles.map(f => f.id) }
    trackRemovals(removed)
    enqueueOps([
      { op: 'delete', coll: 'courses', ids: [id] },
      { op: 'delete', coll: 'assignments', ids: removedAssignments },
      { op: 'delete', coll: 'files', ids: removedFiles.map(f => f.id) }
    ])
  }
  if (store.view.type === 'course' && store.view.id === id) store.view = { type: 'overview', q: store.view.q }
  toast('课程已删除')
}

/* ---------- 作业 ---------- */
export function upsertAssignment(data) {
  if (data.id) {
    const a = store.assignments.find(x => x.id === data.id)
    if (a) {
      Object.assign(a, data, { updatedAt: Date.now() })
      enqueueOps([{ op: 'upsert', coll: 'assignments', items: [{ ...a }] }])
      toast('作业已更新')
    }
  } else {
    const a = { ...data, id: uid(), createdAt: Date.now() }
    store.assignments.push(a)
    enqueueOps([{ op: 'upsert', coll: 'assignments', items: [{ ...a }] }])
    toast('作业已添加')
  }
  // 个人待办回到个人待办页，课程作业回到课程页
  store.view = data.courseId === PERSONAL_ID
    ? { type: 'personal', id: null, q: store.view.q }
    : { type: 'course', id: data.courseId, q: store.view.q }
}

export function toggleAssignment(id) {
  const a = store.assignments.find(x => x.id === id)
  if (a) {
    a.status = a.status === 'done' ? 'pending' : 'done'
    enqueueOps([{ op: 'upsert', coll: 'assignments', items: [{ ...a }] }])
  }
}

export function deleteAssignment(id) {
  const a = store.assignments.find(x => x.id === id)
  if (!a || !confirm(`删除作业「${a.title}」？`)) return
  store.assignments = store.assignments.filter(x => x.id !== id)
  // 服务器权威模型：云端条目只能通过显式 id 白名单删除
  if (session.token && !session.isAdmin) {
    trackRemovals({ assignments: [id] })
    enqueueOps([{ op: 'delete', coll: 'assignments', ids: [id] }])
  }
  toast('作业已删除')
}

/* ---------- 文件 ---------- */
export async function uploadFiles(list, courseId) {
  let ok = 0
  for (const file of list) {
    const id = uid()
    const rec = { id, courseId, kind: 'blob', name: file.name, size: file.size, mime: file.type, addedAt: Date.now() }
    let stored = false
    try { await blobPut(id, file); stored = true }
    catch (e) {
      // file:// 等场景 IndexedDB 不可用时，回退为小文件内联存储
      if (file.size <= 2 * 1024 * 1024) {
        try { rec.data = await blobToDataUrl(file); stored = true } catch (e2) { /* 放弃 */ }
      }
    }
    if (stored) {
      store.files.push(rec)
      enqueueOps([{ op: 'upsert', coll: 'files', items: [{ ...rec, data: undefined }] }])
      if (session.token) api.putCloudFile(id, file).catch(() => toast(`「${file.name}」云端备份失败`, 'error'))
      ok++
    }
    else toast(`「${file.name}」保存失败（超过 2MB 且本地数据库不可用），建议添加为链接`, 'error')
  }
  if (ok) toast(`已保存 ${ok} 个文件`)
}

export function addLink(data) {
  const rec = { id: uid(), kind: 'link', addedAt: Date.now(), ...data }
  store.files.push(rec)
  enqueueOps([{ op: 'upsert', coll: 'files', items: [{ ...rec }] }])
  toast('链接已添加')
}

export async function downloadFile(id) {
  const f = store.files.find(x => x.id === id)
  if (!f) return
  if (f.kind === 'link') { window.open(f.url, '_blank', 'noopener'); return }
  const blob = await getFileBlob(f)
  if (!blob) { toast('文件数据缺失（可能来自其他浏览器），请重新上传', 'error'); return }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = f.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

export async function deleteFile(id) {
  const f = store.files.find(x => x.id === id)
  if (!f || !confirm(`删除「${f.name}」？`)) return
  if (f.kind === 'blob') {
    await blobDel(f.id)
    if (session.token && !session.isAdmin) api.deleteCloudFile(f.id).catch(() => {})
  }
  store.files = store.files.filter(x => x.id !== id)
  if (session.token && !session.isAdmin) {
    trackRemovals({ files: [id] })
    enqueueOps([{ op: 'delete', coll: 'files', ids: [id] }])
  }
  toast('已删除')
}

/* ---------- 课表导入 ---------- */
export function importTimetable(list, { semester } = {}) {
  let added = 0
  let skipped = 0
  const created = []
  for (const item of list) {
    const exists = store.courses.some(c => c.name === item.name && (c.semester || '') === (semester || ''))
    if (exists) { skipped++; continue }
    const c = {
      id: uid(), createdAt: Date.now(),
      name: item.name,
      teacher: item.teacher || '',
      semester: semester || '',
      category: item.category || '',
      color: PALETTE[store.courses.length % PALETTE.length],
      group: {
        type: '课程平台',
        num: '',
        link: item.groupLink || '',
        note: ''
      },
      note: item.timeText ? `上课时间：\n${item.timeText}` : ''
    }
    store.courses.push(c)
    created.push(c)
    added++
  }
  if (created.length) enqueueOps([{ op: 'upsert', coll: 'courses', items: created.map(c => ({ ...c })) }])
  toast(`课表导入完成：新增 ${added} 门${skipped ? `，跳过已存在 ${skipped} 门` : ''}`)
  return { added, skipped }
}

/* ---------- 备份导入导出 ---------- */
export async function exportData() {
  try {
    const blobs = []
    for (const f of store.files) {
      if (f.kind !== 'blob') continue
      const b = await getFileBlob(f)
      if (b) blobs.push({ id: f.id, data: await blobToDataUrl(b) })
    }
    const payload = {
      app: 'classinfo-board', version: 1, exportedAt: new Date().toISOString(),
      state: { courses: store.courses, assignments: store.assignments, files: store.files },
      blobs
    }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `课程信息板备份-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    toast('备份已导出')
  } catch (e) {
    toast('导出失败：' + e.message, 'error')
  }
}

export async function importData(file) {
  try {
    const payload = JSON.parse(await file.text())
    if (payload.app !== 'classinfo-board' || !payload.state) throw new Error('格式不符')
    const n = (payload.state.courses || []).length
    if (!confirm(`将用备份覆盖当前全部数据（共 ${n} 门课程、${(payload.state.assignments || []).length} 项作业），是否继续？`)) return
    const before = {
      courses: store.courses.map(x => x.id),
      assignments: store.assignments.map(x => x.id),
      files: store.files.map(x => x.id)
    }
    try { await blobClear() } catch (e) { /* 忽略 */ }
    for (const b of payload.blobs || []) {
      try { await blobPut(b.id, await (await fetch(b.data)).blob()) } catch (e) { /* 单个失败继续 */ }
    }
    store.courses = payload.state.courses || []
    store.assignments = payload.state.assignments || []
    store.files = payload.state.files || []
    store.view = { type: 'overview', id: null, q: '' }
    // 备份恢复替换了本机数据：整包 upsert 恢复包内容 + 显式删除被恢复包丢弃的旧条目
    const removed = {
      courses: before.courses.filter(x => !store.courses.some(y => y.id === x)),
      assignments: before.assignments.filter(x => !store.assignments.some(y => y.id === x)),
      files: before.files.filter(x => !store.files.some(y => y.id === x))
    }
    if (session.token && !session.isAdmin) {
      trackRemovals(removed)
      enqueueOps([
        { op: 'upsert', coll: 'courses', items: store.courses.map(c => ({ ...c })) },
        { op: 'upsert', coll: 'assignments', items: store.assignments.map(a => ({ ...a })) },
        { op: 'upsert', coll: 'files', items: store.files.map(f => ({ ...f, data: undefined })) },
        { op: 'delete', coll: 'courses', ids: removed.courses },
        { op: 'delete', coll: 'assignments', ids: removed.assignments },
        { op: 'delete', coll: 'files', ids: removed.files }
      ])
      for (const fid of removed.files) api.deleteCloudFile(fid).catch(() => {})
    }
    toast('备份已恢复')
  } catch (e) {
    toast('导入失败：不是有效的备份文件', 'error')
  }
}
