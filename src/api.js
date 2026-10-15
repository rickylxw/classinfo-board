/* 后端 API 客户端 + 会话状态（未登录时所有功能照常本地可用） */
import { reactive } from 'vue'

const TOKEN_KEY = 'classinfo-token'

export const session = reactive({
  token: localStorage.getItem(TOKEN_KEY) || '',
  xh: '',
  isAdmin: false
})

export function setToken(token, xh = '') {
  session.token = token
  session.xh = xh
  if (!token) session.isAdmin = false
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function req(path, { method = 'GET', body } = {}) {
  const headers = {}
  if (session.token) headers.Authorization = 'Bearer ' + session.token
  if (body !== undefined && !(body instanceof Blob)) headers['Content-Type'] = 'application/json'
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body instanceof Blob ? body : body !== undefined ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    let msg = 'HTTP ' + res.status
    try { msg = (await res.json()).error || msg } catch (e) { /* 非 JSON 响应 */ }
    throw new Error(msg)
  }
  return res.json()
}

export const login = cookie => req('/auth/login', { method: 'POST', body: { cookie } })
export const adminLogin = (username, password) => req('/auth/admin-login', { method: 'POST', body: { username, password } })
export const logout = () => req('/auth/logout', { method: 'POST' }).catch(() => {})
export const fetchMe = () => req('/auth/me')
export const fetchCloudData = () => req('/data')
// 服务器权威同步：每次变动立即发送 ops 批次（服务器按序合并后返回权威状态）；
// merge-local 登录对齐只增并入；PUT /data 仅用于云端为空时的首次整包备份
export const pushCloudData = data => req('/data', { method: 'PUT', body: data })
export const mergeLocalData = data => req('/data/merge-local', { method: 'POST', body: data })
export const pushOps = ops => req('/data/ops', { method: 'POST', body: { ops } })
export const putCloudFile = (id, blob) => req('/files/' + id, { method: 'PUT', body: blob })
export const deleteCloudFile = id => req('/files/' + id, { method: 'DELETE' })
export const fetchTimetable = () => req('/timetable', { method: 'POST' })
export const getCloudSemStart = () => req('/semstart')
export const putCloudSemStart = semStart => req('/semstart', { method: 'PUT', body: { semStart } })

/* 课程负责人申请 / 班级同步 / 共享板 */
export const applyShare = (name, teacher) => req('/share/apply', { method: 'POST', body: { name, teacher } })
export const fetchShareStatus = (name, teacher) =>
  req('/share/status?name=' + encodeURIComponent(name || '') + '&teacher=' + encodeURIComponent(teacher || ''))
export const fetchSync = () => req('/sync')
export const fetchBoard = key => req('/board?key=' + encodeURIComponent(key))
export const boardUpsertAssignment = (key, data) => req('/board/assignment/upsert', { method: 'POST', body: { key, ...data } })
export const boardDeleteAssignment = (key, id) => req('/board/assignment/delete', { method: 'POST', body: { key, id } })
export const boardUploadFile = (key, name, blob) =>
  req('/board/file/upload?key=' + encodeURIComponent(key) + '&name=' + encodeURIComponent(name), { method: 'PUT', body: blob })
export const boardDeleteFile = (key, id) => req('/board/file/delete', { method: 'POST', body: { key, id } })
export const saveBoardGroup = (key, group) => req('/board/group/save', { method: 'POST', body: { key, group } })
export const submitBoardGroup = (key, group) => req('/board/group/submit', { method: 'POST', body: { key, group } })
export const reviewBoardGroup = (key, approve) => req('/board/group/review', { method: 'POST', body: { key, approve } })
/* 成员投稿（待负责人审核） */
export const submitBoardAssignment = (key, data) => req('/board/assignment/submit', { method: 'POST', body: { key, ...data } })
export const submitBoardFile = (key, name, blob) =>
  req('/board/file/submit?key=' + encodeURIComponent(key) + '&name=' + encodeURIComponent(name), { method: 'PUT', body: blob })
export const reviewBoardAssignment = (key, id, approve, patch = {}) => req('/board/assignment/review', { method: 'POST', body: { key, id, approve, ...patch } })
export const reviewBoardFile = (key, id, approve) => req('/board/file/review', { method: 'POST', body: { key, id, approve } })
export const fetchMySubmissions = key => req('/board/submissions?key=' + encodeURIComponent(key))
export async function fetchBoardFileBlob(key, id) {
  const res = await fetch('/api/board/file/download?key=' + encodeURIComponent(key) + '&id=' + encodeURIComponent(id), {
    headers: session.token ? { Authorization: 'Bearer ' + session.token } : {}
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '附件获取失败')
  return res.blob()
}

/* 管理面板 */
export const adminOverview = () => req('/admin/overview')
export const adminShares = () => req('/admin/shares')
export const adminShareDecision = (key, xh, approve) => req('/admin/share/decision', { method: 'POST', body: { key, xh, approve } })
export const adminShareRevoke = key => req('/admin/share/revoke', { method: 'POST', body: { key } })
export const adminShareAppoint = (key, xh) => req('/admin/share/appoint', { method: 'POST', body: { key, xh } })
export const adminSubmissions = () => req('/admin/submissions')
export const adminBoards = () => req('/admin/boards')
export const adminKick = xh => req('/admin/kick', { method: 'POST', body: { xh } })
export const adminDeleteAccount = xh => req('/admin/account/' + xh, { method: 'DELETE' })

export async function fetchCloudFileBlob(id) {
  const res = await fetch('/api/files/' + id, { headers: session.token ? { Authorization: 'Bearer ' + session.token } : {} })
  if (!res.ok) throw new Error('云端无此文件')
  return res.blob()
}
