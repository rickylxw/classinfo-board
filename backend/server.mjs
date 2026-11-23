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
import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { configurePaths } from './lib/env.mjs'
import { json, readBody, readJson, clampStr, fileHeaders, dirSize, rmDir, safeId, norm, maskXh } from './lib/util.mjs'
import { writeJsonAtomic, cleanTmpFiles } from './lib/persist.mjs'
import { hashPassword, timingEq, ensureAdmin, checkAdminPassword, clientIp, rateLimited } from './lib/security.mjs'
import { SESSION_DAYS, sessions, loadSessions, saveSessions, bearer, auth, userAuth, loadAccount, saveAccount, accountPath, accountFilesDir, forgetAccount, migrateLegacy } from './lib/accounts.mjs'
import { sseAttach, sseBroadcastTo } from './lib/sse.mjs'
import { shares, saveShares, loadShares, boardOf, boardDir, isOwner, courseKey, sanitizeGroup, groupHasContent, syncForMe } from './lib/shares.mjs'
import { verifyCookie, ehallTimetable, ehallHeartbeatMaybe } from './lib/ehall.mjs'
import { normalizeData, mergeAccountData, applyRemovals, mergeList } from './lib/merge.mjs'


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 5174)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const MAX_JSON = 8 * 1024 * 1024
const MAX_FILE = 100 * 1024 * 1024
const MAX_ACCOUNT_DISK = 512 * 1024 * 1024   // 每账号云盘附件总配额
const MAX_BOARD_DISK = 1024 * 1024 * 1024    // 每共享板附件总配额
const MAX_BOARDS = 500            // 共享板总数上限（防灌板）
const MAX_PENDING = 50            // 每板待审作业/附件各自上限
const MAX_BOARD_ITEMS = 200       // 每板已上架作业/附件各自上限
const MAX_APPLICATIONS = 2000     // 负责人申请记录总量上限
const MAX_KEY_LEN = 200           // 课程标识（name|teacher）长度上限

const ACCOUNTS_DIR = path.join(DATA_DIR, 'accounts')
const FILES_DIR = path.join(DATA_DIR, 'files')

configurePaths({
  DATA_DIR,
  ACCOUNTS_DIR: path.join(DATA_DIR, 'accounts'),
  FILES_DIR: path.join(DATA_DIR, 'files')
})
await mkdir(path.join(DATA_DIR, 'accounts'), { recursive: true })
await mkdir(path.join(DATA_DIR, 'files'), { recursive: true })

/* ---------- 应用更新（公开，免登录）：服务端中转 GitHub Releases ----------
 * 部分客户端网络直连 api.github.com 会被重置，但板子域名必然可达——以板子为跳板最稳。
 * 元数据内存缓存 10 分钟，GitHub 抖动时回退上次缓存；APK 落盘缓存到
 * data/cache/appupdate/，首次从 GitHub 拉取，之后直接回缓存。 */
let appUpdateCache = { at: 0, data: null }
async function ensureAppUpdateData() {
  if (Date.now() - appUpdateCache.at < 10 * 60 * 1000 && appUpdateCache.data) return appUpdateCache.data
  const r = await fetch('https://api.github.com/repos/rickylxw/classinfo-board/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'classinfo-board' }
  })
  if (!r.ok) throw new Error('GitHub HTTP ' + r.status)
  const j = await r.json()
  const apk = (j.assets || []).find(a => /\.apk$/.test(a.name))
  appUpdateCache = {
    at: Date.now(),
    data: {
      tag: j.tag_name,
      apkUrl: apk ? apk.browser_download_url : '',
      apkName: apk ? apk.name : '',
      notes: j.body || '',
      htmlUrl: j.html_url
    }
  }
  return appUpdateCache.data
}
async function serveUpdateApk(res, tag, name) {
  if (!/^native-v[0-9A-Za-z.\-]+$/.test(tag) || !/^[0-9A-Za-z._\-]+\.apk$/.test(name)) {
    return json(res, 400, { error: '参数不合法' })
  }
  const dir = path.join(DATA_DIR, 'cache', 'appupdate')
  const fp = path.join(dir, name)
  if (!existsSync(fp)) {
    await mkdir(dir, { recursive: true })
    const gh = `https://github.com/rickylxw/classinfo-board/releases/download/${tag}/${encodeURIComponent(name)}`
    const r = await fetch(gh, { headers: { 'User-Agent': 'classinfo-board' } })
    if (!r.ok) throw new Error('GitHub HTTP ' + r.status)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 1024 * 1024) throw new Error('下载内容异常（过小）')
    await writeFile(fp, buf)
    console.log(`[app-update] 缓存 ${name}（${(buf.length / 1048576).toFixed(1)} MB）`)
  }
  const buf = await readFile(fp)
  res.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': buf.length,
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'public, max-age=3600'
  })
  res.end(buf)
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
      if (!cookie || !cookie.includes('=')) return json(res, 400, { error: '请粘贴 ehall 的 Cookie（在 ehall 请求的 Request Headers 里整行复制）' })
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

    /* 共享板变更实时流（SSE）。EventSource 无法带 Authorization 头，仅此端点接受 ?token=
     * 用户与管理员会话均可挂（管理台待审队列的实时刷新依赖它）；无效/过期 → 401 JSON。
     * 注意：日志绝不打印完整 URL（含 token）。 */
    if (p === '/events' && req.method === 'GET') {
      const ts = sessions[url.searchParams.get('token') || '']
      if (!ts || ts.expiresAt <= Date.now()) return json(res, 401, { error: '未登录或会话过期' })
      sseAttach(req, res, ts.xh)
      return   // 保持连接，不 end；事件由 sseBroadcast/心跳写入
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
        // 所有课程的共享板内容（管理员的删除/预挂教学群入口）。
        // 左连接：全部账号的课程 ∪ shares.boards——没人互动过的课程也可见（exists=false）。
        // 仅为展示而枚举，不调用 boardOf 落盘（否则会给每门课都创建空板文件）；
        // 管理员无用户账号课程、示例数据永不上云，天然不会混入。
        const known = new Map()   // courseKey -> 展示用原文 { name, teacher }（首个出现的账号为准）
        for (const f of await readdir(ACCOUNTS_DIR).catch(() => [])) {
          if (!f.endsWith('.json')) continue
          const acc = await loadAccount(f.slice(0, -5))
          for (const c of acc?.data?.courses || []) {
            if (!norm(c.name)) continue   // 无名课程不成键
            const k = courseKey(c)
            if (!known.has(k)) known.set(k, { name: c.name, teacher: c.teacher || '' })
          }
        }
        const keys = [...new Set([...known.keys(), ...Object.keys(shares.boards)])].sort()
        const boards = keys.map(key => {
          const b = shares.boards[key]
          const src = known.get(key) || { name: key.split('|')[0], teacher: key.split('|')[1] || '' }
          return {
            key,
            exists: !!b,
            courseName: src.name,
            teacher: src.teacher,
            owner: (b && shares.owners[key]) ? maskXh(shares.owners[key]) : null,
            assignments: b ? (b.assignments || []).map(a => ({ id: a.id, title: a.title, deadline: a.deadline || '' })) : [],
            files: b ? (b.files || []).map(f => ({ id: f.id, name: f.name, size: f.size })) : [],
            groups: b ? (b.groups || []).map(g => ({ type: g.type, num: g.num, note: g.note })) : [],
            group: b ? (b.group || null) : null,
            pendingGroups: b ? (b.pendingGroups || []).map(pg => ({ pid: pg.pid, action: pg.action, gid: pg.gid, group: pg.group, xhMasked: maskXh(pg.xh), submittedAt: pg.submittedAt })) : [],
            pendingGroup: b && (b.pendingGroups || [])[0] ? { action: b.pendingGroups[0].action, group: b.pendingGroups[0].group, xhMasked: maskXh(b.pendingGroups[0].xh), submittedAt: b.pendingGroups[0].submittedAt } : null,
            pending: b ? (b.pendingAssignments?.length || 0) + (b.pendingFiles?.length || 0) + (b.pendingGroups?.length || 0) : 0
          }
        })
        return json(res, 200, { boards })
      }
      /* 删除空板：仅当板上无任何内容（作业/附件/群/全部待审）时允许，防误删真实数据 */
      if (p === '/admin/board/delete' && req.method === 'POST') {
        const body = await readJson(req, 65536)
        const key = norm(body.key)
        const b = shares.boards[key]
        if (!b) return json(res, 404, { error: '板不存在' })
        const count = (b.assignments?.length || 0) + (b.files?.length || 0) + (b.groups?.length || 0) +
          (b.pendingAssignments?.length || 0) + (b.pendingFiles?.length || 0) + (b.pendingGroups?.length || 0)
        if (count > 0) return json(res, 400, { error: `板上还有 ${count} 项内容（作业/附件/群/待审），请先清空再删除空板` })
        delete shares.boards[key]
        saveShares()
        console.log(`[admin] 空板已删除 ${key}`)
        return json(res, 200, { ok: true })
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
          for (const pg of board.pendingGroups || []) {
            subs.push({ type: 'group', pid: pg.pid, key, courseName: key.split('|')[0], teacher: key.split('|')[1] || '', action: pg.action, group: pg.group, xh: pg.xh, xhMasked: maskXh(pg.xh), submittedAt: pg.submittedAt })
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
        forgetAccount(xh)
        console.log(`[admin] 账号 ${xh} 已删除`)
        return json(res, 200, { ok: true })
      }

      /* 用户反馈查看/处理 */
      if (p === '/admin/feedback' && req.method === 'GET') {
        let list = []
        try { list = JSON.parse(await readFile(path.join(DATA_DIR, 'feedback.json'), 'utf8')) } catch { /* 首次为空 */ }
        if (!Array.isArray(list)) list = []
        return json(res, 200, { items: list, open: list.filter(x => x.status === 'open').length })
      }
      if (p === '/admin/feedback/update' && req.method === 'POST') {
        const body = await readJson(req, 65536)
        const id = safeId(String(body.id || ''))
        const status = body.status === 'resolved' ? 'resolved' : 'open'
        const file = path.join(DATA_DIR, 'feedback.json')
        let list = []
        try { list = JSON.parse(await readFile(file, 'utf8')) } catch { /* 空 */ }
        if (!Array.isArray(list)) list = []
        const hit = list.find(x => x.id === id)
        if (!hit) return json(res, 404, { error: '反馈不存在' })
        hit.status = status
        await writeJsonAtomic(file, list)
        return json(res, 200, { ok: true })
      }
      if (p === '/admin/feedback/delete' && req.method === 'POST') {
        const body = await readJson(req, 65536)
        const id = safeId(String(body.id || ''))
        const file = path.join(DATA_DIR, 'feedback.json')
        let list = []
        try { list = JSON.parse(await readFile(file, 'utf8')) } catch { /* 空 */ }
        if (!Array.isArray(list)) list = []
        await writeJsonAtomic(file, list.filter(x => x.id !== id))
        console.log(`[feedback] 管理员删除反馈 ${id}`)
        return json(res, 200, { ok: true })
      }
      return json(res, 404, { error: 'not found' })
    }

    /* 应用更新（公开，免登录）：服务端中转 GitHub Releases。
     * 部分客户端网络直连 api.github.com 会被重置，但板子域名必然可达——以板子为跳板最稳。
     * 元数据内存缓存 10 分钟，GitHub 抖动时回退上次缓存；APK 落盘缓存到
     * data/cache/appupdate/，首次从 GitHub 拉取，之后直接回缓存。 */
    if (p === '/app-update/latest' && req.method === 'GET') {
      if (rateLimited('app-update:' + clientIp(req), 30, 60 * 1000)) return json(res, 429, { error: 'too frequent' })
      try {
        const data = await ensureAppUpdateData()
        return json(res, 200, data)
      } catch (e) {
        if (appUpdateCache.data) return json(res, 200, appUpdateCache.data)
        return json(res, 502, { error: '更新源暂不可达，请稍后再试' })
      }
    }
    /* 最新版 APK 直链：网站页脚「📱 安卓 App」与此地址，始终指向最新 Release（浏览器直接下载） */
    if (p === '/app-update/apk' && req.method === 'GET') {
      if (rateLimited('app-dl:' + clientIp(req), 10, 60 * 1000)) return json(res, 429, { error: '下载请求过于频繁，请稍后再试' })
      try {
        const data = await ensureAppUpdateData().catch(() => appUpdateCache.data)
        if (!data || !data.tag || !data.apkName) return json(res, 502, { error: '暂无可下载的安装包' })
        return await serveUpdateApk(res, data.tag, data.apkName)
      } catch (e) {
        return json(res, 502, { error: '下载源不可达（' + e.message + '），请稍后再试' })
      }
    }
    if (p === '/app-update/download' && req.method === 'GET') {
      if (rateLimited('app-dl:' + clientIp(req), 10, 60 * 1000)) return json(res, 429, { error: '下载请求过于频繁，请稍后再试' })
      const tag = String(url.searchParams.get('tag') || '').trim()
      const name = String(url.searchParams.get('name') || '').trim()
      try {
        return await serveUpdateApk(res, tag, name)
      } catch (e) {
        return json(res, 502, { error: '下载源不可达（' + e.message + '），请切换下载源重试' })
      }
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
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 1024 * 1024)
      const key = norm(body.key)
      // 负责人与管理员同权：管理员可在控制台代为编辑/新增共享作业（无负责人课程的管理兜底）
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可编辑共享板' })
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
      console.log(`[board] ${as.admin ? '管理员' : '负责人'}更新共享作业 ${key} :: ${item.title}`)
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
        groups: (board?.pendingGroups || []).filter(pg => pg.xh === s.xh),
        group: (board?.pendingGroups || []).find(pg => pg.xh === s.xh) || null
      })
    }

    /* 共享教学群（多群）：一门课可挂多个群；负责人或管理员维护，随板同步 */
    if (p === '/board/group/add' && req.method === 'POST') {
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可维护共享教学群' })
      const g = sanitizeGroup(body.group)
      if (!groupHasContent(g)) return json(res, 400, { error: '群号、链接、备注至少填一项' })
      const board = boardOf(key)
      if ((board.groups || []).length >= 10) return json(res, 400, { error: '一门课最多挂 10 个群，请先清理' })
      const entry = { id: crypto.randomBytes(8).toString('hex'), ...g, updatedAt: Date.now() }
      board.groups = [...(board.groups || []), entry]
      saveShares()
      console.log(`[board] ${as.admin ? '管理员' : '负责人'}添加共享教学群 ${key} :: ${g.type} ${g.num}`)
      return json(res, 200, { ok: true, group: entry })
    }
    if (p === '/board/group/update' && req.method === 'POST') {
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可维护共享教学群' })
      const board = boardOf(key)
      const entry = (board.groups || []).find(x => x.id === body.id)
      if (!entry) return json(res, 404, { error: '该教学群不存在或已删除' })
      const g = sanitizeGroup(body.group)
      if (!groupHasContent(g)) return json(res, 400, { error: '群号、链接、备注至少填一项' })
      Object.assign(entry, g, { updatedAt: Date.now() })
      saveShares()
      console.log(`[board] ${as.admin ? '管理员' : '负责人'}更新共享教学群 ${key} :: ${g.type} ${g.num}`)
      return json(res, 200, { ok: true, group: entry })
    }
    if (p === '/board/group/delete' && req.method === 'POST') {
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可维护共享教学群' })
      const board = boardOf(key)
      board.groups = (board.groups || []).filter(x => x.id !== body.id)
      saveShares()
      return json(res, 200, { ok: true })
    }
    /* 旧版单群保存（兼容旧前端）：有内容 = 整表替换为这一个群，无内容 = 清空 */
    if (p === '/board/group/save' && req.method === 'POST') {
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可维护共享教学群' })
      const g = sanitizeGroup(body.group)
      const board = boardOf(key)
      board.groups = groupHasContent(g)
        ? [{ id: crypto.randomBytes(8).toString('hex'), ...g, updatedAt: Date.now() }]
        : []
      saveShares()
      console.log(`[board] ${as.admin ? '管理员' : '负责人'}更新共享教学群 ${key}`)
      return json(res, 200, { ok: true, groups: board.groups })
    }

    /* 成员提交教学群申请（add=贡献一个新群 / edit=修改已有群；负责人/管理员直接维护，不走申请） */
    if (p === '/board/group/submit' && req.method === 'POST') {
      const s = userAuth(req)
      if (!s) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      const me = await loadAccount(s.xh)
      const isMember = (me?.data?.courses || []).some(c => courseKey(c) === key)
      if (!isMember) return json(res, 403, { error: '仅本课程成员可提交修改申请' })
      if (isOwner(s.xh, key)) return json(res, 400, { error: '你是课程负责人，可直接编辑保存' })
      const action = body.action === 'edit' ? 'edit' : 'add'
      const g = sanitizeGroup(body.group)
      if (!groupHasContent(g)) return json(res, 400, { error: '群号、链接、备注至少填一项' })
      const board = boardOf(key)
      if (action === 'edit' && !(board.groups || []).some(x => x.id === body.id)) {
        return json(res, 404, { error: '要修改的教学群不存在（可能刚被删除），请刷新后重试' })
      }
      board.pendingGroups = board.pendingGroups || []
      if (board.pendingGroups.length >= 50) return json(res, 400, { error: '待审申请过多，请等负责人处理后再提交' })
      // 防重复：同一人已有一条同动作、同目标/同内容的申请在队列里时拒绝重复提交
      const dup = board.pendingGroups.some(pg =>
        pg.xh === s.xh && pg.action === action &&
        (action === 'edit' ? pg.gid === body.id : (pg.group.num === g.num && pg.group.link === g.link && pg.group.note === g.note)))
      if (dup) return json(res, 400, { error: '你已有一条相同的申请在待审中，请等审核结果' })
      const proposal = {
        pid: crypto.randomBytes(8).toString('hex'),
        action,
        ...(action === 'edit' ? { gid: body.id } : {}),
        group: g,
        xh: s.xh,
        submittedAt: Date.now()
      }
      board.pendingGroups.push(proposal)
      saveShares()
      console.log(`[board] ${s.xh} 提交教学群${action === 'edit' ? '修改' : '添加'}申请 ${key}（待审 ${board.pendingGroups.length} 条）`)
      return json(res, 200, { ok: true, pid: proposal.pid })
    }
    /* 负责人或管理员审核教学群申请（按 pid 逐条；不传 pid 兼容旧前端=审最早一条）：
     * 通过 = add 入列新群 / edit 更新目标群；edit 目标已被删除按「已失效」处理不报错 */
    if (p === '/board/group/review' && req.method === 'POST') {
      const as = auth(req)
      if (!as) return json(res, 401, { error: '未登录或会话过期' })
      const body = await readJson(req, 65536)
      const key = norm(body.key)
      if (!as.admin && !isOwner(as.xh, key)) return json(res, 403, { error: '仅课程负责人或管理员可审核' })
      const board = boardOf(key)
      board.pendingGroups = board.pendingGroups || []
      const pg = body.pid
        ? board.pendingGroups.find(x => x.pid === body.pid)
        : board.pendingGroups[0]
      if (!pg) return json(res, 404, { error: '申请不存在或已处理' })
      board.pendingGroups = board.pendingGroups.filter(x => x.pid !== pg.pid)
      let published = false
      let stale = false
      if (body.approve) {
        if (pg.action === 'edit' && pg.gid) {
          const entry = (board.groups || []).find(x => x.id === pg.gid)
          if (entry) {
            Object.assign(entry, pg.group, { updatedAt: Date.now() })
            published = true
          } else {
            stale = true   // 目标群已被删除，申请自动作废
          }
        } else {
          board.groups = [...(board.groups || []), { id: crypto.randomBytes(8).toString('hex'), ...pg.group, updatedAt: Date.now() }]
          published = true
        }
      }
      saveShares()
      console.log(`[board] ${as.admin ? '管理员' : '负责人'}${body.approve ? '通过' : '驳回'}教学群申请 ${key}${stale ? '（目标群已删除，申请作废）' : ''}`)
      return json(res, 200, { ok: true, published, stale })
    }

    /* 以下均需登录，且全部按会话所属账号隔离 */
    const s = userAuth(req)
    if (!s) return json(res, 401, { error: '未登录或会话过期' })
    const acc = await loadAccount(s.xh)

    ehallHeartbeatMaybe(acc)   // ehall 心跳：10 分钟一次轻触保活，失败忽略

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
      sseBroadcastTo(s.xh, 'data')
      return json(res, 200, { ok: true, data: normalizeData(target.data), dataUpdatedAt: target.dataUpdatedAt })
    }
    /* 登录/换设备合并：本机独有条目并入云端（只增），云端已有条目一律不动 */
    if (p === '/data/merge-local' && req.method === 'POST') {
      const body = await readJson(req, MAX_JSON)
      const target = acc || await loadAccount(s.xh, { create: true })
      target.data = mergeAccountData(target.data, body, { addOnly: true })
      target.dataUpdatedAt = Date.now()
      await saveAccount(target)
      sseBroadcastTo(s.xh, 'data')
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
      sseBroadcastTo(s.xh, 'data')
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
      sseBroadcastTo(s.xh, 'data')
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

    /* 用户反馈/故障上报：按会话学号记录（学号脱敏展示），管理台「用户反馈」页签查看处理。
     * 端点与载荷对原生端/网页端/桌面端通用；限频 1 条/30 秒/账号，全局最多保留 500 条。 */
    if (p === '/feedback' && req.method === 'POST') {
      if (rateLimited('feedback:' + s.xh, 1, 30 * 1000)) return json(res, 429, { error: '提交太频繁，请稍后再试' })
      const body = await readJson(req, 65536)
      const type = ['bug', 'idea'].includes(body.type) ? body.type : 'idea'
      const content = clampStr(String(body.content || '').trim(), 2000)
      if (!content) return json(res, 400, { error: '反馈内容不能为空' })
      const file = path.join(DATA_DIR, 'feedback.json')
      let list = []
      try { list = JSON.parse(await readFile(file, 'utf8')) } catch { /* 首次为空 */ }
      if (!Array.isArray(list)) list = []
      list.unshift({
        id: crypto.randomBytes(8).toString('hex'),
        xh: s.xh, xhMasked: maskXh(s.xh),
        type, content,
        app: clampStr(String(body.app || ''), 120),
        device: clampStr(String(body.device || ''), 120),
        at: Date.now(),
        status: 'open'
      })
      await writeJsonAtomic(file, list.slice(0, 500))
      console.log(`[feedback] ${maskXh(s.xh)} 提交${type === 'bug' ? '故障' : '建议'}反馈`)
      return json(res, 200, { ok: true })
    }

    /* ---------- CLH 课件助手云同步：同源整包 GET/PUT（按学号隔离，存 data/clh/<学号>.json） ----------
     * 课件助手已并入前端（public/clh/），其整包云同步改走本端点，复用用户会话鉴权；
     * 载荷上限 80MB（与其原独立服务一致），原子写入防损坏。 */
    if (p === '/clh-data' && req.method === 'GET') {
      try {
        const text = await readFile(path.join(DATA_DIR, 'clh', `${s.xh}.json`), 'utf8')
        return json(res, 200, JSON.parse(text))
      } catch { return json(res, 200, null) } // 从未同步过 → null，前端按空数据处理
    }
    if (p === '/clh-data' && req.method === 'PUT') {
      const body = await readJson(req, 80 * 1024 * 1024)
      const dir = path.join(DATA_DIR, 'clh')
      await mkdir(dir, { recursive: true })
      await writeJsonAtomic(path.join(dir, `${s.xh}.json`), body)
      console.log(`[clh] ${s.xh} 云同步 ${JSON.stringify(body).length} 字节`)
      return json(res, 200, { ok: true })
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
