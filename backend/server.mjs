// Classinfo Board 后端：账号（ehall Cookie 验证）+ 按账号隔离的数据同步 + 文件存储 + 课表代理
// 零依赖，监听 5174；开发时由 Vite 代理 /api，生产时由根 server.mjs 代理。
//
// 存储结构（backend/data/）：
//   accounts/<学号>.json   每个账号一个文件（Cookie + 该账号的课程/作业/文件元数据）
//   files/<学号>/<文件id>   每个账号一个目录，存放上传文件本体，跨账号不可访问
//   sessions.json          全局会话表 { token: { xh, expiresAt} }
//   legacy/                旧版单文件 accounts.json 迁移后的备份
//
// ehall Cookie 明文保存在本机 backend/data/，注意勿外传整个目录。
import http from 'node:http'
import { readFile, writeFile, mkdir, unlink, rename, readdir, rm, stat } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const rmDir = p => rm(p, { recursive: true, force: true })

/* ---------- 原子写入 + 滚动备份 + 损坏自恢复 ----------
 * 所有 JSON 一律「写临时文件 → rename 原子替换」，进程崩溃/断电不会留下半个文件；
 * 每次保存成功后快照到 data/backups/<kind>/ 滚动保留最近 BACKUP_KEEP 份；
 * 启动加载发现主文件损坏时，自动从最新可用备份恢复，不再静默变空。 */
const BACKUP_KEEP = 20

async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(obj))
  await rename(tmp, file)
}

async function backupJson(kind, obj) {
  try {
    const dir = path.join(BACKUP_DIR, kind)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, Date.now() + '.json'), JSON.stringify(obj))
    const all = (await readdir(dir)).filter(f => f.endsWith('.json')).sort()
    for (const f of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) {
      await unlink(path.join(dir, f)).catch(() => {})
    }
  } catch (e) {
    console.error(`[backup] ${kind} 备份失败：`, e.message)
  }
}

async function restoreLatestBackup(kind) {
  try {
    const dir = path.join(BACKUP_DIR, kind)
    const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort().reverse()
    for (const f of files) {
      try { return JSON.parse(await readFile(path.join(dir, f), 'utf8')) } catch (e) { /* 试更早一份 */ }
    }
  } catch (e) { /* 无备份 */ }
  return null
}

// 启动时清掉上次崩溃残留的 .tmp 临时文件（此刻没有并发写者）
async function cleanTmpFiles() {
  for (const dir of [DATA_DIR, ACCOUNTS_DIR]) {
    for (const f of await readdir(dir).catch(() => [])) {
      if (f.endsWith('.tmp')) await unlink(path.join(dir, f)).catch(() => {})
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 5174)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const ACCOUNTS_DIR = path.join(DATA_DIR, 'accounts')
const FILES_DIR = path.join(DATA_DIR, 'files')
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json')
const EHALL = 'https://ehall.seu.edu.cn'
const SESSION_DAYS = 30
const MAX_JSON = 8 * 1024 * 1024
const MAX_FILE = 100 * 1024 * 1024
const MAX_ACCOUNT_DISK = 512 * 1024 * 1024   // 每账号云盘附件总配额
const MAX_BOARD_DISK = 1024 * 1024 * 1024    // 每共享板附件总配额
const MAX_BOARDS = 500            // 共享板总数上限（防灌板）
const MAX_PENDING = 50            // 每板待审作业/附件各自上限
const MAX_BOARD_ITEMS = 200       // 每板已上架作业/附件各自上限
const MAX_APPLICATIONS = 2000     // 负责人申请记录总量上限
const MAX_KEY_LEN = 200           // 课程标识（name|teacher）长度上限
const clampStr = (v, n) => String(v ?? '').slice(0, n)   // 服务端字段截断，防单条超大内容灌爆 shares.json
const BACKUP_DIR = path.join(DATA_DIR, 'backups')

await mkdir(ACCOUNTS_DIR, { recursive: true })
await mkdir(FILES_DIR, { recursive: true })

/* ---------- 管理员（首次启动自动注册，账号密码打印在日志；重置=删除 admin.json）
 * 密码用 scrypt 慢哈希；兼容旧版 sha256(salt+hash) 格式，成功登录一次后自动升级。 ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex')
  return `scrypt$${salt}$${hash}`
}
function timingEq(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}
async function ensureAdmin() {
  if (existsSync(ADMIN_FILE)) return false
  const username = process.env.ADMIN_USER || 'admin'
  const password = process.env.ADMIN_PASS || crypto.randomBytes(9).toString('hex')
  await writeJsonAtomic(ADMIN_FILE, { username, pw: hashPassword(password), createdAt: Date.now() })
  console.log('════════════════════════════════════════════')
  console.log(`👑 已注册管理员账号: ${username} / ${password}`)
  console.log('   仅首次创建显示；忘记密码可删除 backend/data/admin.json 重启重置')
  console.log('════════════════════════════════════════════')
  return true
}
function checkAdminPassword(username, password) {
  try {
    const a = JSON.parse(readFileSync(ADMIN_FILE, 'utf8'))
    let ok = false, legacy = false
    if (typeof a.pw === 'string' && a.pw.startsWith('scrypt$')) {
      const [, salt, hash] = a.pw.split('$')
      ok = !!salt && !!hash && timingEq(crypto.scryptSync(String(password), salt, 32).toString('hex'), hash)
    } else if (a.salt && a.hash) {   // 旧版 sha256(salt+password)，验证通过后升级为 scrypt
      ok = timingEq(crypto.createHash('sha256').update(a.salt + password).digest('hex'), a.hash)
      legacy = true
    }
    if (ok && a.username === username) {
      if (legacy) {
        writeJsonAtomic(ADMIN_FILE, { ...a, pw: hashPassword(password), salt: undefined, hash: undefined })
          .then(() => console.log('[admin] 管理员密码哈希已升级为 scrypt'))
          .catch(e => console.error('[admin] 哈希升级失败：', e.message))
      }
      return true
    }
    return false
  } catch (e) { return false }
}
/* ---------- 账号存取（每账号独立文件，内存缓存） ---------- */
const safeId = s => String(s).replace(/[^a-zA-Z0-9_-]/g, '')
const accountPath = xh => path.join(ACCOUNTS_DIR, safeId(xh) + '.json')
const accountFilesDir = xh => path.join(FILES_DIR, safeId(xh))

const accountCache = new Map()   // xh -> 账号对象

async function loadAccount(xh, { create = false } = {}) {
  if (accountCache.has(xh)) return accountCache.get(xh)
  let acc = null
  try {
    acc = JSON.parse(await readFile(accountPath(xh), 'utf8'))
  } catch (e) {
    if (existsSync(accountPath(xh))) {   // 文件在但读不出/解析失败 → 从备份恢复
      acc = await restoreLatestBackup('accounts/' + safeId(xh))
      if (acc) {
        console.error(`[recover] 账号 ${xh} 数据文件损坏，已从备份自动恢复`)
        await writeJsonAtomic(accountPath(xh), acc).catch(() => {})
      }
    }
  }
  if (!acc && create) acc = { xh, createdAt: Date.now(), cookie: '', data: null }
  if (acc) accountCache.set(xh, acc)
  return acc
}
async function saveAccount(acc) {
  accountCache.set(acc.xh, acc)
  try {
    await writeJsonAtomic(accountPath(acc.xh), acc)
    await backupJson('accounts/' + safeId(acc.xh), acc)
  } catch (e) {
    console.error(`[save] 账号 ${acc.xh} 保存失败：`, e.message)
  }
}

/* ---------- 旧版单文件迁移（accounts.json + 扁平 files/） ---------- */
async function migrateLegacy() {
  const legacyFile = path.join(DATA_DIR, 'accounts.json')
  if (!existsSync(legacyFile)) return
  try {
    const all = JSON.parse(await readFile(legacyFile, 'utf8'))
    for (const old of Object.values(all)) {
      if (!old?.xh) continue
      const acc = await loadAccount(old.xh)
      if (acc) continue   // 已有则不覆盖
      await saveAccount({ ...old })
      // 把该账号记录过的文件从旧的扁平目录移入其独立目录
      const ids = (old.data?.files || []).filter(f => f.kind === 'blob').map(f => safeId(f.id))
      if (ids.length) await mkdir(accountFilesDir(old.xh), { recursive: true })
      for (const id of ids) {
        const flat = path.join(FILES_DIR, id)
        if (existsSync(flat)) await rename(flat, path.join(accountFilesDir(old.xh), id)).catch(() => {})
      }
      console.log(`[migrate] 账号 ${old.xh} 已迁移为独立文件`)
    }
    await mkdir(path.join(DATA_DIR, 'legacy'), { recursive: true })
    await rename(legacyFile, path.join(DATA_DIR, 'legacy', 'accounts.json')).catch(() => {})
    console.log('[migrate] 旧版 accounts.json 已备份至 data/legacy/')
  } catch (e) {
    console.error('[migrate] 迁移失败：', e.message)
  }
}

/* ---------- 会话（全局 sessions.json） ---------- */
const sessions = {}
const pruneSessions = () => {
  const now = Date.now()
  for (const [t, s] of Object.entries(sessions)) if (s.expiresAt < now) delete sessions[t]
}
async function loadSessions() {
  let data = null
  try {
    data = JSON.parse(await readFile(path.join(DATA_DIR, 'sessions.json'), 'utf8'))
  } catch (e) {
    if (existsSync(path.join(DATA_DIR, 'sessions.json'))) {
      data = await restoreLatestBackup('sessions')
      if (data) {
        console.error('[recover] sessions.json 损坏，已从备份自动恢复')
        await writeJsonAtomic(path.join(DATA_DIR, 'sessions.json'), data).catch(() => {})
      }
    }
  }
  if (data && typeof data === 'object') Object.assign(sessions, data)
  pruneSessions()
}
async function saveSessions() {
  pruneSessions()
  try {
    await writeJsonAtomic(path.join(DATA_DIR, 'sessions.json'), sessions)
    await backupJson('sessions', sessions)
  } catch (e) {
    console.error('[save] sessions.json 保存失败：', e.message)
  }
}

/* ---------- 工具 ---------- */
// 应用与前端同源（经 5173 代理），无需跨域放行；不再返回 Access-Control-Allow-Origin: *
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e }
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let n = 0
    req.on('data', c => {
      n += c.length
      if (n > limit) { const e = new Error('请求体过大'); e.status = 413; reject(e); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
async function readJson(req, limit) {
  const raw = (await readBody(req, limit)).toString('utf8')
  try { return raw ? JSON.parse(raw) : {} } catch (e) { fail(400, '请求体不是合法 JSON') }
}
// 附件下载响应头：强制下载 + nosniff，防上传的 HTML/SVG 被浏览器内联执行
function fileHeaders(res, name) {
  const safe = String(name || '').replace(/[\r\n"\\/]/g, '_').slice(0, 120) || '附件'
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safe)}`
  })
}
async function dirSize(dir) {
  let n = 0
  const walk = async d => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const fp = path.join(d, e.name)
      if (e.isDirectory()) await walk(fp)
      else { try { n += (await stat(fp)).size } catch (err) { /* 刚被删 */ } }
    }
  }
  await walk(dir)
  return n
}
const bearer = req => (/^Bearer (.+)$/.exec(req.headers.authorization || '') || [])[1] || ''
function auth(req) {
  const s = sessions[bearer(req)]
  if (!s || s.expiresAt <= Date.now()) return null
  // 滑动续期：活跃会话每次使用都顺延（1 小时节流，避免高频写盘），常用用户永不过期
  if (Date.now() - (s.renewedAt || 0) > 3600e3) {
    s.expiresAt = Date.now() + SESSION_DAYS * 864e5
    s.renewedAt = Date.now()
    saveSessions()
  }
  return s
}
// 用户端点专用：管理员会话不能当用户会话用
function userAuth(req) {
  const s = auth(req)
  return (s && !s.admin) ? s : null
}

/* ---------- 数据同步合并（服务器权威） ----------
 * 客户端推送只能「新增/更新条目」，永远不能整体覆盖或删除云端数据：
 *   - 空集合/缺字段 = 不动该集合；推送里没有的条目原样保留
 *   - 同 id 条目按客户端副本更新（同一账号的编辑需要备份到云端）
 *   - 删除云端条目只能走 POST /data/delete 显式提交 id 白名单
 *   - 示例数据（c-demo 等）永不上云，防止新浏览器播种的示例污染真实账号
 * 三个写入端点的响应都携带合并后的权威状态 data，客户端必须采用（服务器强制下发）。
 */
const SAMPLE_IDS = new Set(['c-demo', 'a-demo1', 'a-demo2', 'f-demo1'])
const isSampleItem = it => !it || it.id == null || SAMPLE_IDS.has(String(it.id)) || it.sample === true

function normalizeData(d) {
  return {
    courses: Array.isArray(d?.courses) ? d.courses : [],
    assignments: Array.isArray(d?.assignments) ? d.assignments : [],
    files: Array.isArray(d?.files) ? d.files : [],
    syncStatus: d?.syncStatus && typeof d.syncStatus === 'object' ? d.syncStatus : {}
  }
}
function mergeList(current, incoming, { addOnly = false } = {}) {
  const out = [...(current || [])]
  const idx = new Map(out.map((it, i) => [String(it.id), i]))
  for (const it of (incoming || [])) {
    if (isSampleItem(it)) continue
    const i = idx.get(String(it.id))
    if (i === undefined) { idx.set(String(it.id), out.length); out.push(it) }
    else if (!addOnly) out[i] = { ...out[i], ...it }
  }
  return out
}
function mergeAccountData(serverData, body, { addOnly = false } = {}) {
  const cur = normalizeData(serverData)
  const inc = normalizeData(body)
  return {
    courses: mergeList(cur.courses, inc.courses, { addOnly }),
    assignments: mergeList(cur.assignments, inc.assignments, { addOnly }),
    files: mergeList(cur.files, inc.files, { addOnly }),
    // 个人完成/归档状态按 key 合并：客户端已知的 key 以客户端为准，云端多出的 key 保留
    syncStatus: { ...cur.syncStatus, ...inc.syncStatus }
  }
}
// 显式删除：只删除调用方列出的 id，其余云端条目一律保留
function applyRemovals(serverData, removed) {
  const d = normalizeData(serverData)
  const drop = (list, ids) => {
    const s = new Set((Array.isArray(ids) ? ids : []).map(String))
    return s.size ? list.filter(it => !s.has(String(it.id))) : list
  }
  return {
    courses: drop(d.courses, removed?.courses),
    assignments: drop(d.assignments, removed?.assignments),
    files: drop(d.files, removed?.files),
    syncStatus: d.syncStatus
  }
}

/* ---------- 登录限速（防局域网内暴力破解） ----------
 * 经代理访问时取 X-Forwarded-For 最后一跳（由可信代理追加的真实客户端地址），
 * 直连 127.0.0.1 时用 socket 地址；伪造的 XFF 会被代理追加真实地址后挤到前面。 */
const clientIp = req => {
  const xf = String(req.headers['x-forwarded-for'] || '')
  const last = xf.split(',').map(s => s.trim()).filter(Boolean).pop()
  return last || req.socket.remoteAddress || 'unknown'
}
const rateBuckets = new Map()
function rateLimited(key, max, windowMs) {
  const now = Date.now()
  const hits = (rateBuckets.get(key) || []).filter(t => now - t < windowMs)
  hits.push(now)
  rateBuckets.set(key, hits)
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (!v.some(t => now - t < windowMs)) rateBuckets.delete(k)
  }
  return hits.length > max
}

/* ---------- 课程负责人与共享板（shares.json） ----------
 * applications: [{ key, xh, appliedAt, decidedAt?, status: 'pending'|'approved'|'rejected' }]
 *   - rejected 永久生效：同一人对同一课程被驳回后不可重新申请
 * owners: { [courseKey]: 学号 }  每门课一名课程负责人
 * boards: { [courseKey]: { assignments: [...], files: [...],
 *           pendingAssignments: [{id,xh,title,deadline,requirement,submittedAt}],
 *           pendingFiles: [{id,xh,name,size,submittedAt}] } }
 *   共享板由负责人编辑；普通成员可「投稿」作业/附件进入待审队列，负责人审核通过后上架同步。
 */
const SHARES_FILE = path.join(DATA_DIR, 'shares.json')
const shares = { applications: [], owners: {}, boards: {} }
async function loadShares() {
  let data = null
  try {
    data = JSON.parse(await readFile(SHARES_FILE, 'utf8'))
  } catch (e) {
    if (existsSync(SHARES_FILE)) {
      data = await restoreLatestBackup('shares')
      if (data) {
        console.error('[recover] shares.json 损坏，已从最新备份自动恢复！')
        // 立即把恢复内容回写主文件，避免损坏文件滞留磁盘
        await writeJsonAtomic(SHARES_FILE, data).catch(e2 => console.error('[recover] 回写失败：', e2.message))
      }
    }
  }
  if (data && typeof data === 'object') {
    shares.applications = Array.isArray(data.applications) ? data.applications : []
    shares.owners = data.owners && typeof data.owners === 'object' ? data.owners : {}
    shares.boards = data.boards && typeof data.boards === 'object' ? data.boards : {}
  }
}
async function saveShares() {
  try {
    await writeJsonAtomic(SHARES_FILE, shares)
    await backupJson('shares', shares)
  } catch (e) {
    console.error('[save] shares.json 保存失败：', e.message)
  }
}
const boardOf = key => (shares.boards[key] = shares.boards[key] || { assignments: [], files: [], pendingAssignments: [], pendingFiles: [], group: null, pendingGroup: null })
const keyHash = key => crypto.createHash('sha256').update('board:' + key).digest('hex').slice(0, 16)
const boardDir = key => path.join(FILES_DIR, 'board', keyHash(key))
const isOwner = (xh, key) => shares.owners[key] === xh

/* ---------- 课程共享（同名同教师匹配） ---------- */
const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, '')
const courseKey = c => norm(c.name) + '|' + norm(c.teacher)
const xhRef = xh => crypto.createHash('sha256').update('ref:' + xh).digest('hex').slice(0, 10)
const maskXh = xh => (xh.length > 5 ? xh.slice(0, 3) + '****' + xh.slice(-2) : xh)

// 我能收到同步的课程：有共享板且有上架内容即推送（负责人或管理员维护），排除自己维护的
async function syncForMe(myXh) {
  const me = await loadAccount(myXh)
  const out = []
  for (const c of me?.data?.courses || []) {
    const key = courseKey(c)
    const board = shares.boards[key]
    if (!board) continue
    const hasGroup = board.group && (board.group.num || board.group.link || board.group.note)
    if (!board.assignments?.length && !board.files?.length && !hasGroup) continue   // 板上还没有任何上架内容时不推送空同步
    const ownerXh = shares.owners[key]
    if (ownerXh === myXh) continue   // 负责人自己走管理卡片，不重复下发
    out.push({
      key,
      ref: keyHash(key),
      from: ownerXh ? maskXh(ownerXh) : '管理员',
      group: board.group || null,
      assignments: (board.assignments || []).map(a => ({
        id: a.id, title: a.title, deadline: a.deadline || '', requirement: a.requirement || ''
      })),
      files: (board.files || []).map(f => ({ id: f.id, name: f.name, size: f.size }))
    })
  }
  return out
}

/* ---------- ehall 验证与课表 ---------- */
async function ehallGet(pathname, cookie) {
  // redirect: 'manual' —— 未登录时 ehall 会 302 到统一认证页，据此判定 Cookie 失效
  return fetch(EHALL + pathname, { headers: { cookie }, redirect: 'manual' })
}
async function ehallTerms(cookie) {
  let r
  try {
    r = await ehallGet('/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do', cookie)
  } catch (e) {
    throw new Error('无法访问 ehall（请检查本机网络能否直连 ehall.seu.edu.cn）')
  }
  if (r.status === 301 || r.status === 302) throw new Error('Cookie 无效或已过期（ehall 重定向到了登录页）')
  if (r.status !== 200) throw new Error('ehall 返回异常 HTTP ' + r.status)
  const j = await r.json().catch(() => null)
  const terms = j?.datas?.xnxqcx?.rows
  if (!Array.isArray(terms) || !terms.length) throw new Error('Cookie 无效或已过期（未返回学期数据）')
  // 实测 PX 越小学期越新
  return [...terms].sort((a, b) => parseInt(a.PX) - parseInt(b.PX))
}
// 按当前日期猜测学期代码：9-1月=秋季(-2)，2-6月=春季(-3)，7-8月=暑期(-1)
function guessCurrentTerm(terms) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const start = m >= 8 ? y : y - 1
  const code = (m >= 9 || m === 1) ? `${start}-${start + 1}-2`
    : (m >= 2 && m <= 6) ? `${start}-${start + 1}-3`
    : `${start}-${start + 1}-1`
  return terms.find(t => t.DM === code)
}
async function ehallTimetable(cookie) {
  const terms = await ehallTerms(cookie)
  // 优先取按日期推断的当前学期，取不到课再从新到旧兜底
  const guess = guessCurrentTerm(terms)
  const ordered = guess ? [guess, ...terms.filter(t => t !== guess)] : terms
  for (const t of ordered) {
    const r = await ehallGet('/jwapp/sys/wdkb/modules/xskcb/xskcb.do?XNXQDM=' + encodeURIComponent(t.DM), cookie).catch(() => null)
    if (!r || r.status !== 200) continue
    const j = await r.json().catch(() => null)
    const rows = j?.datas?.xskcb?.rows
    if (rows?.length) return { term: t.MC, dm: t.DM, rows }
  }
  throw new Error('最近几个学期都没有查到课表数据')
}
// 验证 Cookie 并从课表响应里提取学号（XH）作为账号身份
let lastBeatAt = 0   // ehall 心跳节流
async function verifyCookie(cookie) {
  const kb = await ehallTimetable(cookie)
  const xh = kb.rows.find(x => x.XH)?.XH
  if (!xh) throw new Error('Cookie 验证通过，但课表数据里没有学号字段（XH），无法确定账号')
  return { xh: String(xh) }
}

/* ---------- 路由 ---------- */
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Allow': 'GET,PUT,POST,DELETE,OPTIONS' })
    return res.end()
  }
  const url = new URL(req.url, 'http://localhost')
  if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' })
  const p = url.pathname.slice(4)  // 去掉 /api

  try {
    /* 登录（无需会话） */
    if (p === '/auth/login' && req.method === 'POST') {
      if (rateLimited('login:' + clientIp(req), 10, 10 * 60 * 1000)) return json(res, 429, { error: '登录尝试过于频繁，请 10 分钟后再试' })
      const body = await readJson(req, 65536)
      const cookie = String(body.cookie || '').trim()
      if (!cookie || !cookie.includes('=')) return json(res, 400, { error: '请粘贴 ehall 的 Cookie（形如 MOD_AUTH_CAS=…）' })
      // 无效/过期 Cookie 是预期错误，返回 401 和友好提示，不进全局 500
      let info
      try {
        info = await verifyCookie(cookie)
      } catch (e) {
        return json(res, 401, { error: e.message || 'ehall Cookie 无效，请重新复制' })
      }
      let acc = await loadAccount(info.xh)
      const isNew = !acc
      if (!acc) acc = await loadAccount(info.xh, { create: true })
      acc.cookie = cookie
      acc.lastLoginAt = Date.now()
      await saveAccount(acc)
      const token = crypto.randomBytes(24).toString('hex')
      sessions[token] = { xh: info.xh, expiresAt: Date.now() + SESSION_DAYS * 864e5 }
      saveSessions()
      console.log(`[auth] ${info.xh} 登录成功（${isNew ? '新账号' : '已有账号'}）`)
      return json(res, 200, { token, xh: info.xh, isNew })
    }

    if (p === '/auth/logout' && req.method === 'POST') {
      const t = bearer(req)
      if (t && sessions[t]) { delete sessions[t]; saveSessions() }
      return json(res, 200, { ok: true })
    }

    if (p === '/auth/me' && req.method === 'GET') {
      const s = auth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      if (s.admin) return json(res, 200, { xh: 'admin', admin: true })
      const acc = await loadAccount(s.xh)
      return json(res, 200, { xh: s.xh, hasPassword: !!acc?.pw })
    }

    /* 应用密码登录：首次用 ehall Cookie 登录后设置密码，之后学号+密码直接进，无需再复制 Cookie */
    if (p === '/auth/password-login' && req.method === 'POST') {
      if (rateLimited('password-login:' + clientIp(req), 5, 10 * 60 * 1000)) return json(res, 429, { error: '尝试过于频繁，请 10 分钟后再试' })
      const body = await readJson(req, 65536)
      const xh = safeId(String(body.xh || '').trim())
      if (!xh || xh === 'admin') return json(res, 400, { error: '请输入学号' })
      const acc = await loadAccount(xh)
      if (!acc?.pw) return json(res, 404, { error: '该账号还没有设置应用密码，请先用 ehall Cookie 登录一次' })
      const [, salt, hash] = String(acc.pw).split('$')
      const ok = acc.pw.startsWith('scrypt$') && !!salt && !!hash &&
        timingEq(crypto.scryptSync(String(body.password || ''), salt, 32).toString('hex'), hash)
      if (!ok) return json(res, 401, { error: '学号或应用密码错误' })
      const token = crypto.randomBytes(24).toString('hex')
      sessions[token] = { xh, expiresAt: Date.now() + SESSION_DAYS * 864e5 }
      acc.lastLoginAt = Date.now()
      await saveAccount(acc)
      saveSessions()
      console.log(`[auth] ${xh} 应用密码登录成功`)
      return json(res, 200, { token, xh, isNew: false })
    }

    /* 设置/修改应用密码（需已登录） */
    if (p === '/auth/set-password' && req.method === 'POST') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const next = String(body.next || '')
      if (next.length < 6 || next.length > 64) return json(res, 400, { error: '应用密码长度需在 6-64 位之间' })
      const acc = await loadAccount(s.xh)
      if (!acc) return json(res, 404, { error: '账号不存在' })
      if (acc.pw) {
        const [, salt, hash] = String(acc.pw).split('$')
        const okCurrent = acc.pw.startsWith('scrypt$') && !!salt && !!hash &&
          timingEq(crypto.scryptSync(String(body.current || ''), salt, 32).toString('hex'), hash)
        if (!okCurrent) return json(res, 401, { error: '当前应用密码不对' })
      }
      const hadPw = !!acc.pw
      acc.pw = hashPassword(next)
      await saveAccount(acc)
      console.log(`[auth] ${s.xh} ${hadPw ? '更新' : '设置'}了应用密码`)
      return json(res, 200, { ok: true })
    }

    /* 管理员登录（账号密码，非 ehall） */
    if (p === '/auth/admin-login' && req.method === 'POST') {
      if (rateLimited('admin-login:' + clientIp(req), 5, 10 * 60 * 1000)) return json(res, 429, { error: '尝试过于频繁，请 10 分钟后再试' })
      const body = await readJson(req, 65536)
      if (!checkAdminPassword(String(body.username || ''), String(body.password || ''))) {
        return json(res, 401, { error: '管理员账号或密码错误' })
      }
      const token = crypto.randomBytes(24).toString('hex')
      sessions[token] = { admin: true, xh: 'admin', expiresAt: Date.now() + SESSION_DAYS * 864e5 }
      saveSessions()
      console.log('[auth] 管理员登录')
      return json(res, 200, { token, admin: true })
    }

    /* 管理员接口 */
    if (p.startsWith('/admin/')) {
      const as = auth(req)
      if (!as || !as.admin) return json(res, 403, { error: '需要管理员权限' })

      if (p === '/admin/overview' && req.method === 'GET') {
        const accounts = []
        for (const f of await readdir(ACCOUNTS_DIR).catch(() => [])) {
          if (!f.endsWith('.json')) continue
          const acc = await loadAccount(f.slice(0, -5))
          if (!acc) continue
          let size = 0
          try { size = (await readFile(accountPath(acc.xh))).length } catch (e) { /* 忽略 */ }
          accounts.push({
            xh: acc.xh,
            createdAt: acc.createdAt,
            lastLoginAt: acc.lastLoginAt,
            dataUpdatedAt: acc.dataUpdatedAt,
            courses: acc.data?.courses?.length || 0,
            assignments: acc.data?.assignments?.length || 0,
            files: acc.data?.files?.length || 0,
            size
          })
        }
        accounts.sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0))
        return json(res, 200, {
          accounts,
          activeSessions: Object.values(sessions).filter(x => x.expiresAt > Date.now()).length,
          adminConfigured: true
        })
      }
      if (p === '/admin/shares' && req.method === 'GET') {
        const apps = []
        for (const a of shares.applications) {
          const acc = await loadAccount(a.xh)
          const c = (acc?.data?.courses || []).find(x => courseKey(x) === a.key)
          apps.push({
            ...a,
            xhMasked: maskXh(a.xh),
            isOwner: shares.owners[a.key] === a.xh,
            hasOwner: !!shares.owners[a.key],
            courseName: c?.name || a.key.split('|')[0],
            teacher: c?.teacher || a.key.split('|')[1] || ''
          })
        }
        return json(res, 200, {
          applications: apps.reverse(),
          ownerCount: Object.keys(shares.owners).length,
          boardCounts: Object.fromEntries(Object.entries(shares.boards).map(([k, b]) => [k, { assignments: b.assignments.length, files: b.files.length }]))
        })
      }
      if (p === '/admin/share/decision' && req.method === 'POST') {
        const body = await readJson(req, 65536)
        const app = shares.applications.find(a => a.key === body.key && a.xh === body.xh && a.status === 'pending')
        if (!app) return json(res, 404, { error: '申请不存在或已处理' })
        app.status = body.approve ? 'approved' : 'rejected'   // rejected 永久记录，申请人不可重申
        app.decidedAt = Date.now()
        let ownerSet = false
        if (body.approve && !shares.owners[app.key]) {
          shares.owners[app.key] = app.xh
          ownerSet = true
        }
        saveShares()
        console.log(`[share] 管理员${body.approve ? '通过' : '驳回'} ${app.xh} 的负责人申请 ${app.key}${ownerSet ? '（任命为课程负责人）' : ''}`)
        return json(res, 200, { ok: true, status: app.status, ownerSet })
      }
      if (p === '/admin/share/revoke' && req.method === 'POST') {
        const body = await readJson(req, 65536)
        if (shares.owners[body.key]) {
          delete shares.owners[body.key]
          saveShares()   // 共享板数据保留，便于任命新负责人
        }
        return json(res, 200, { ok: true })
      }
      if (p === '/admin/boards' && req.method === 'GET') {
        // 所有课程的共享板内容（管理员的删除入口）
        const boards = []
        for (const [key, b] of Object.entries(shares.boards)) {
          const ownerXh = shares.owners[key]
          boards.push({
            key,
            courseName: key.split('|')[0],
            teacher: key.split('|')[1] || '',
            owner: ownerXh ? maskXh(ownerXh) : null,
            assignments: (b.assignments || []).map(a => ({ id: a.id, title: a.title, deadline: a.deadline || '' })),
            files: (b.files || []).map(f => ({ id: f.id, name: f.name, size: f.size })),
            pending: (b.pendingAssignments?.length || 0) + (b.pendingFiles?.length || 0)
          })
        }
        return json(res, 200, { boards })
      }
      if (p === '/admin/submissions' && req.method === 'GET') {
        // 全部课程的待审投稿（管理员审核用）
        const subs = []
        for (const [key, board] of Object.entries(shares.boards)) {
          for (const a of board.pendingAssignments || []) {
            subs.push({ type: 'assignment', key, courseName: key.split('|')[0], teacher: key.split('|')[1] || '', ...a, xhMasked: maskXh(a.xh) })
          }
          for (const f of board.pendingFiles || []) {
            subs.push({ type: 'file', key, courseName: key.split('|')[0], teacher: key.split('|')[1] || '', ...f, xhMasked: maskXh(f.xh) })
          }
        }
        subs.sort((a, b) => a.submittedAt - b.submittedAt)
        return json(res, 200, { submissions: subs })
      }
      if (p === '/admin/share/appoint' && req.method === 'POST') {
        // 重新任命：把曾通过但已被撤销的申请人再次设为负责人
        const body = await readJson(req, 65536)
        const app = shares.applications.find(a => a.key === body.key && a.xh === body.xh && a.status === 'approved')
        if (!app) return json(res, 404, { error: '找不到已通过的申请' })
        if (shares.owners[body.key]) return json(res, 400, { error: '该课程已有负责人' })
        shares.owners[body.key] = body.xh
        saveShares()
        console.log(`[share] 管理员重新任命 ${body.xh} 为 ${body.key} 的负责人`)
        return json(res, 200, { ok: true })
      }
      if (p === '/admin/kick' && req.method === 'POST') {
        const body = await readJson(req, 65536)
        let n = 0
        for (const [t, x] of Object.entries(sessions)) {
          if (x.xh === body.xh && !x.admin) { delete sessions[t]; n++ }
        }
        saveSessions()
        return json(res, 200, { ok: true, kicked: n })
      }
      if (p.startsWith('/admin/account/') && req.method === 'DELETE') {
        const xh = safeId(p.slice('/admin/account/'.length))
        if (!xh) return json(res, 400, { error: 'bad xh' })
        await unlink(accountPath(xh)).catch(() => {})
        await rmDir(accountFilesDir(xh))
        for (const [t, x] of Object.entries(sessions)) if (x.xh === xh) delete sessions[t]
        saveSessions()
        accountCache.delete(xh)
        console.log(`[admin] 账号 ${xh} 已删除`)
        return json(res, 200, { ok: true })
      }
      return json(res, 404, { error: 'not found' })
    }

    /* 共享申请（课程负责人）/ 同步 / 共享板 */
    if (p === '/share/apply' && req.method === 'POST') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const name = clampStr(norm(body.name), 100)
      const teacher = clampStr(norm(body.teacher), 100)
      const key = name + '|' + teacher
      if (!name) return json(res, 400, { error: '缺少课程名' })
      if (shares.applications.length >= MAX_APPLICATIONS) return json(res, 400, { error: '申请记录已达上限，请联系管理员' })
      if (shares.owners[key]) return json(res, 200, { status: 'has-owner', note: '该课程已有负责人' })
      // 被驳回过：永久禁止重新申请
      if (shares.applications.some(a => a.key === key && a.xh === s.xh && a.status === 'rejected')) {
        return json(res, 403, { error: '你的申请已被驳回，无法重新申请该课程的负责人' })
      }
      if (!shares.applications.some(a => a.key === key && a.xh === s.xh && a.status === 'pending')) {
        shares.applications.push({ key, xh: s.xh, appliedAt: Date.now(), status: 'pending' })
        saveShares()
      }
      console.log(`[share] ${s.xh} 申请成为课程负责人 ${key}`)
      return json(res, 200, { status: 'pending' })
    }
    if (p === '/share/status' && req.method === 'GET') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const key = norm(url.searchParams.get('name')) + '|' + norm(url.searchParams.get('teacher'))
      const app = shares.applications.find(a => a.key === key && a.xh === s.xh)
      return json(res, 200, {
        status: isOwner(s.xh, key) ? 'approved' : (app?.status || 'none'),
        isOwner: isOwner(s.xh, key),
        hasOwner: !!shares.owners[key]
      })
    }
    if (p === '/sync' && req.method === 'GET') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      return json(res, 200, await syncForMe(s.xh))
    }
    /* 负责人读取自己管理的共享板 */
    if (p === '/board' && req.method === 'GET') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const key = norm(url.searchParams.get('key'))
      if (!isOwner(s.xh, key)) return json(res, 403, { error: '仅课程负责人可管理共享板' })
      return json(res, 200, boardOf(key))
    }
    /* 共享板作业：新增/编辑/删除（仅负责人） */
    if (p === '/board/assignment/upsert' && req.method === 'POST') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 1024 * 1024)
      const key = norm(body.key)
      if (!isOwner(s.xh, key)) return json(res, 403, { error: '仅课程负责人可编辑共享板' })
      if (!String(body.title || '').trim()) return json(res, 400, { error: '标题不能为空' })
      const board = boardOf(key)
      if (!body.id && board.assignments.length >= MAX_BOARD_ITEMS) return json(res, 400, { error: '该板已上架作业已达上限（200 条）' })
      const item = { title: clampStr(String(body.title).trim(), 200), deadline: clampStr(body.deadline, 40), requirement: clampStr(body.requirement, 20000), updatedAt: Date.now() }
      if (body.id && board.assignments.some(a => a.id === body.id)) {
        const a = board.assignments.find(a => a.id === body.id)
        Object.assign(a, item)
        saveShares()
        return json(res, 200, { ok: true, id: body.id })
      }
      item.id = crypto.randomBytes(8).toString('hex')
      board.assignments.push(item)
      saveShares()
      console.log(`[board] ${s.xh} 更新共享作业 ${key} :: ${item.title}`)
      return json(res, 200, { ok: true, id: item.id })
    }
    if (p === '/board/assignment/delete' && req.method === 'POST') {
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可编辑共享板' })
      const board = boardOf(key)
      board.assignments = board.assignments.filter(a => a.id !== body.id)
      saveShares()
      return json(res, 200, { ok: true })
    }
    /* 共享板附件：上传/下载/删除 */
    if (p === '/board/file/upload' && req.method === 'PUT') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const key = norm(url.searchParams.get('key'))
      const name = (url.searchParams.get('name') || '附件').slice(0, 120)
      if (!key || key.length > MAX_KEY_LEN) return json(res, 400, { error: '课程标识过长或为空' })
      if (!isOwner(s.xh, key)) return json(res, 403, { error: '仅课程负责人可上传共享附件' })
      if ((shares.boards[key]?.files?.length || 0) >= MAX_BOARD_ITEMS) return json(res, 400, { error: '该板附件已达上限（200 个）' })
      const id = crypto.randomBytes(8).toString('hex')
      const buf = await readBody(req, MAX_FILE)
      if ((await dirSize(boardDir(key))) + buf.length > MAX_BOARD_DISK) return json(res, 413, { error: '共享板附件空间已满（每板上限 1GB），请先清理旧附件' })
      await mkdir(boardDir(key), { recursive: true })
      await writeFile(path.join(boardDir(key), id), buf)
      const board = boardOf(key)
      board.files.push({ id, name, size: buf.length, uploadedAt: Date.now() })
      saveShares()
      console.log(`[board] ${s.xh} 上传共享附件 ${key} :: ${name} (${buf.length}B)`)
      return json(res, 200, { ok: true, id })
    }
    if (p === '/board/file/download' && req.method === 'GET') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const key = norm(url.searchParams.get('key'))
      const id = safeId(url.searchParams.get('id') || '')
      const board = shares.boards[key]
      if (!board || !board.files.some(f => f.id === id)) return json(res, 404, { error: '附件不存在' })
      // 仅同名同教师课程的同学（或负责人本人）可下载
      const me = await loadAccount(s.xh)
      const isMember = (me?.data?.courses || []).some(c => courseKey(c) === key) || isOwner(s.xh, key)
      if (!isMember) return json(res, 403, { error: '仅本课程成员可下载' })
      const fp = path.join(boardDir(key), id)
      if (!existsSync(fp)) return json(res, 404, { error: '附件文件缺失' })
      const buf = await readFile(fp)
      fileHeaders(res, board.files.find(f => f.id === id)?.name)
      return res.end(buf)
    }
    if (p === '/board/file/delete' && req.method === 'POST') {
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可管理附件' })
      const board = boardOf(key)
      board.files = board.files.filter(f => f.id !== body.id)
      saveShares()
      await unlink(path.join(boardDir(key), safeId(String(body.id || '')))).catch(() => {})
      return json(res, 200, { ok: true })
    }

    /* 成员投稿：作业 / 附件进入待审队列，负责人审核 */
    if (p === '/board/assignment/submit' && req.method === 'POST') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 1024 * 1024)
      const key = norm(body.key)
      if (!key || key.length > MAX_KEY_LEN) return json(res, 400, { error: '课程标识过长或为空' })
      const me = await loadAccount(s.xh)
      const isMember = (me?.data?.courses || []).some(c => courseKey(c) === key)
      if (!isMember) return json(res, 403, { error: '仅本课程成员可投稿' })
      if (!String(body.title || '').trim()) return json(res, 400, { error: '标题不能为空' })
      if (!shares.boards[key] && Object.keys(shares.boards).length >= MAX_BOARDS) return json(res, 400, { error: '共享板总数已达上限，请联系管理员' })
      const board = boardOf(key)
      if (board.pendingAssignments.length >= MAX_PENDING) return json(res, 400, { error: '该板待审投稿过多，请等负责人处理后再投' })
      board.pendingAssignments.push({
        id: crypto.randomBytes(8).toString('hex'),
        xh: s.xh,
        title: clampStr(String(body.title).trim(), 200),
        deadline: clampStr(body.deadline, 40),
        requirement: clampStr(body.requirement, 20000),
        submittedAt: Date.now()
      })
      saveShares()
      console.log(`[board] ${s.xh} 投稿共享作业 ${key} :: ${body.title}`)
      return json(res, 200, { ok: true })
    }
    if (p === '/board/file/submit' && req.method === 'PUT') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const key = norm(url.searchParams.get('key'))
      const name = (url.searchParams.get('name') || '附件').slice(0, 120)
      if (!key || key.length > MAX_KEY_LEN) return json(res, 400, { error: '课程标识过长或为空' })
      const me = await loadAccount(s.xh)
      const isMember = (me?.data?.courses || []).some(c => courseKey(c) === key)
      if (!isMember) return json(res, 403, { error: '仅本课程成员可投稿' })
      const pendingFiles = shares.boards[key]?.pendingFiles?.length || 0
      if (pendingFiles >= MAX_PENDING) return json(res, 400, { error: '该板待审投稿过多，请等负责人处理后再投' })
      const id = crypto.randomBytes(8).toString('hex')
      const buf = await readBody(req, MAX_FILE)
      if ((await dirSize(boardDir(key))) + buf.length > MAX_BOARD_DISK) return json(res, 413, { error: '共享板附件空间已满（每板上限 1GB），请联系负责人清理' })
      await mkdir(boardDir(key), { recursive: true })
      await writeFile(path.join(boardDir(key), id), buf)
      const board = boardOf(key)
      board.pendingFiles.push({ id, xh: s.xh, name, size: buf.length, submittedAt: Date.now() })
      saveShares()
      console.log(`[board] ${s.xh} 投稿共享附件 ${key} :: ${name} (${buf.length}B)`)
      return json(res, 200, { ok: true, id })
    }
    /* 审核投稿：课程负责人或管理员均可 */
    if (p === '/board/assignment/review' && req.method === 'POST') {
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可审核投稿' })
      const board = boardOf(key)
      const item = board.pendingAssignments.find(a => a.id === body.id)
      if (!item) return json(res, 404, { error: '投稿不存在或已处理' })
      board.pendingAssignments = board.pendingAssignments.filter(a => a.id !== body.id)
      let published = false
      if (body.approve) {
        // 支持审核时修改内容后上架：传了 title/deadline/requirement 就用修改值
        const title = clampStr(String(body.title ?? item.title).trim(), 200) || item.title
        board.assignments.push({
          id: item.id,
          title,
          deadline: clampStr(body.deadline ?? (item.deadline || ''), 40),
          requirement: clampStr(body.requirement ?? (item.requirement || ''), 20000),
          updatedAt: Date.now()
        })
        published = true
      }
      saveShares()
      console.log(`[board] ${as.admin ? '管理员' : '负责人'}${body.approve ? '通过' : '驳回'}投稿 ${key} :: ${item.title}`)
      return json(res, 200, { ok: true, published })
    }
    if (p === '/board/file/review' && req.method === 'POST') {
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可审核投稿' })
      const board = boardOf(key)
      const item = board.pendingFiles.find(f => f.id === body.id)
      if (!item) return json(res, 404, { error: '投稿不存在或已处理' })
      board.pendingFiles = board.pendingFiles.filter(f => f.id !== body.id)
      let published = false
      if (body.approve) {
        board.files.push({ id: item.id, name: item.name, size: item.size, uploadedAt: Date.now() })
        published = true
      } else {
        await unlink(path.join(boardDir(key), safeId(String(item.id)))).catch(() => {})
      }
      saveShares()
      return json(res, 200, { ok: true, published })
    }
    /* 成员查看自己的待审投稿 */
    if (p === '/board/submissions' && req.method === 'GET') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const key = norm(url.searchParams.get('key'))
      const board = shares.boards[key]
      return json(res, 200, {
        assignments: (board?.pendingAssignments || []).filter(a => a.xh === s.xh),
        files: (board?.pendingFiles || []).filter(f => f.xh === s.xh),
        group: (board?.pendingGroup && board.pendingGroup.xh === s.xh) ? board.pendingGroup : null
      })
    }

    /* 共享教学群：负责人或管理员维护，随板同步 */
    if (p === '/board/group/save' && req.method === 'POST') {
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可维护共享教学群' })
      const g = body.group || {}
      const board = boardOf(key)
      board.group = {
        type: String(g.type || '').slice(0, 20),
        num: String(g.num || '').slice(0, 60),
        link: String(g.link || '').slice(0, 300),
        note: String(g.note || '').slice(0, 200),
        updatedAt: Date.now()
      }
      saveShares()
      console.log(`[board] ${as.admin ? '管理员' : '负责人'}更新共享教学群 ${key}`)
      return json(res, 200, { ok: true, group: board.group })
    }

    /* 成员提交教学群修改申请（负责人/管理员直接保存，不走申请） */
    if (p === '/board/group/submit' && req.method === 'POST') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      const me = await loadAccount(s.xh)
      const isMember = (me?.data?.courses || []).some(c => courseKey(c) === key)
      if (!isMember) return json(res, 403, { error: '仅本课程成员可提交修改申请' })
      if (isOwner(s.xh, key)) return json(res, 400, { error: '你是课程负责人，可直接编辑保存' })
      const g = body.group || {}
      boardOf(key).pendingGroup = {
        group: {
          type: String(g.type || '').slice(0, 20),
          num: String(g.num || '').slice(0, 60),
          link: String(g.link || '').slice(0, 300),
          note: String(g.note || '').slice(0, 200)
        },
        xh: s.xh,
        submittedAt: Date.now()
      }
      saveShares()
      console.log(`[board] ${s.xh} 提交教学群修改申请 ${key}`)
      return json(res, 200, { ok: true })
    }
    /* 负责人或管理员审核教学群修改申请 */
    if (p === '/board/group/review' && req.method === 'POST') {
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可审核' })
      const board = boardOf(key)
      if (!board.pendingGroup) return json(res, 404, { error: '没有待审的修改申请' })
      const pg = board.pendingGroup
      board.pendingGroup = null
      let published = false
      if (body.approve) {
        board.group = { ...pg.group, updatedAt: Date.now() }
        published = true
      }
      saveShares()
      console.log(`[board] ${as.admin ? '管理员' : '负责人'}${body.approve ? '通过' : '驳回'}教学群修改 ${key}`)
      return json(res, 200, { ok: true, published })
    }

    /* 以下均需登录，且全部按会话所属账号隔离 */
    const s = userAuth(req)
    if (!s) return json(res, 401, { error: '未登录或会话过期' })
    const acc = await loadAccount(s.xh)

    // ehall 心跳：使用期间轻触接口保持保存的 Cookie 会话活跃（10 分钟一次，失败忽略）
    if (acc?.cookie && Date.now() - lastBeatAt > 10 * 60 * 1000) {
      lastBeatAt = Date.now()
      ehallGet('/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do', acc.cookie).catch(() => {})
    }

    if (p === '/data' && req.method === 'GET') {
      return json(res, 200, normalizeData(acc?.data))
    }
    /* 数据同步（服务器权威）：推送只增/改条目，不整体覆盖、不隐式删除；响应携带合并后的权威状态 */
    if (p === '/data' && req.method === 'PUT') {
      const body = await readJson(req, MAX_JSON)
      const target = acc || await loadAccount(s.xh, { create: true })
      target.data = mergeAccountData(target.data, body)
      target.dataUpdatedAt = Date.now()
      await saveAccount(target)
      return json(res, 200, { ok: true, data: normalizeData(target.data), dataUpdatedAt: target.dataUpdatedAt })
    }
    /* 登录/换设备合并：本机独有条目并入云端（只增），云端已有条目一律不动 */
    if (p === '/data/merge-local' && req.method === 'POST') {
      const body = await readJson(req, MAX_JSON)
      const target = acc || await loadAccount(s.xh, { create: true })
      target.data = mergeAccountData(target.data, body, { addOnly: true })
      target.dataUpdatedAt = Date.now()
      await saveAccount(target)
      console.log(`[sync] ${s.xh} 登录合并：云端现为 ${target.data.courses.length} 门课 / ${target.data.assignments.length} 项作业 / ${target.data.files.length} 个文件`)
      return json(res, 200, { ok: true, data: normalizeData(target.data), dataUpdatedAt: target.dataUpdatedAt })
    }
    /* 显式删除：只删调用方列出的 id（白名单），其余云端条目一律保留 */
    if (p === '/data/delete' && req.method === 'POST') {
      const body = await readJson(req, MAX_JSON)
      const target = acc || await loadAccount(s.xh, { create: true })
      target.data = applyRemovals(target.data, body)
      target.dataUpdatedAt = Date.now()
      await saveAccount(target)
      return json(res, 200, { ok: true, data: normalizeData(target.data), dataUpdatedAt: target.dataUpdatedAt })
    }
    /* 细粒度操作批次：客户端每次变动立即发送的 ops，按序应用后返回权威状态。
     * op 形态：{ op:'upsert', coll:'courses'|'assignments'|'files', items:[...] }
     *        { op:'delete', coll:..., ids:[...] }
     *        { op:'syncStatus', entries:{ id: 状态 } } */
    if (p === '/data/ops' && req.method === 'POST') {
      const body = await readJson(req, MAX_JSON)
      const ops = Array.isArray(body.ops) ? body.ops : []
      if (ops.length > 2000) return json(res, 413, { error: '单批操作过多，请分批发送' })
      const target = acc || await loadAccount(s.xh, { create: true })
      const d = normalizeData(target.data)
      const COLLS = ['courses', 'assignments', 'files']
      for (const o of ops) {
        if (!o || typeof o !== 'object') continue
        if (o.op === 'upsert' && COLLS.includes(o.coll)) {
          d[o.coll] = mergeList(d[o.coll], Array.isArray(o.items) ? o.items : [])
        } else if (o.op === 'delete' && COLLS.includes(o.coll)) {
          const rm = new Set((Array.isArray(o.ids) ? o.ids : []).map(String))
          if (rm.size) d[o.coll] = d[o.coll].filter(it => !rm.has(String(it.id)))
        } else if (o.op === 'syncStatus' && o.entries && typeof o.entries === 'object') {
          for (const [k, v] of Object.entries(o.entries)) {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
            d.syncStatus[k] = v
          }
        }
      }
      target.data = d
      target.dataUpdatedAt = Date.now()
      await saveAccount(target)
      return json(res, 200, { ok: true, data: normalizeData(d), dataUpdatedAt: target.dataUpdatedAt })
    }

    if (p.startsWith('/files/')) {
      const id = safeId(p.slice(7))
      if (!id) return json(res, 400, { error: 'bad file id' })
      const dir = accountFilesDir(s.xh)
      const fp = path.join(dir, id)
      if (req.method === 'PUT') {
        const buf = await readBody(req, MAX_FILE)
        if ((await dirSize(dir)) + buf.length > MAX_ACCOUNT_DISK) return json(res, 413, { error: '云盘空间已满（每账号上限 512MB），请先删除部分文件' })
        await mkdir(dir, { recursive: true })
        await writeFile(fp, buf)
        return json(res, 200, { ok: true })
      }
      if (req.method === 'GET') {
        if (!existsSync(fp)) return json(res, 404, { error: '文件不存在' })
        const buf = await readFile(fp)
        fileHeaders(res, (acc?.data?.files || []).find(f => f.id === id)?.name)
        return res.end(buf)
      }
      if (req.method === 'DELETE') {
        await unlink(fp).catch(() => {})
        return json(res, 200, { ok: true })
      }
    }

    /* 学期第一周（随账号漫游） */
    if (p === '/semstart' && req.method === 'GET') {
      return json(res, 200, { semStart: acc?.semStart || '' })
    }
    if (p === '/semstart' && req.method === 'PUT') {
      const body = await readJson(req, 65536)
      const date = String(body.semStart || '').trim()
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: '日期格式应为 YYYY-MM-DD' })
      const target = acc || await loadAccount(s.xh, { create: true })
      target.semStart = date
      await saveAccount(target)
      return json(res, 200, { ok: true })
    }

    /* 用账号保存的 Cookie 在服务端直接拉课表 */
    if (p === '/timetable' && req.method === 'POST') {
      if (!acc?.cookie) return json(res, 401, { error: '账号未保存 ehall Cookie，请重新登录' })
      try {
        const kb = await ehallTimetable(acc.cookie)
        console.log(`[timetable] ${s.xh} 拉取 ${kb.dm} 共 ${kb.rows.length} 条`)
        return json(res, 200, { term: kb.term, rows: kb.rows })
      } catch (e) {
        return json(res, 401, { error: 'ehall Cookie 已失效（' + e.message + '），请退出后重新登录' })
      }
    }

    return json(res, 404, { error: 'not found' })
  } catch (e) {
    // 预期内错误（fail 抛出）原样告知；其余一律脱敏，细节只进日志
    console.error('[error]', req.method, p, e)
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : '服务器内部错误，详情见后端日志' })
  }
}).listen(PORT, '127.0.0.1', async () => {
  await migrateLegacy()
  await loadSessions()
  const adminRecreated = await ensureAdmin()
  if (adminRecreated) {
    // 密码重置（删除 admin.json 重启）后，旧的管理员会话全部作废
    let purged = 0
    for (const t of Object.keys(sessions)) if (sessions[t].admin) { delete sessions[t]; purged++ }
    if (purged) { await saveSessions(); console.log(`[admin] 密码已重置，${purged} 个旧管理员会话已作废`) }
  }
  await loadShares()
  await cleanTmpFiles()
  const n = (await readdir(ACCOUNTS_DIR).catch(() => [])).length
  console.log(`🛠  Classinfo Board 后端已启动: http://127.0.0.1:${PORT}（仅本机可直连，局域网经 5173 代理访问；${n} 个账号）`)
})
