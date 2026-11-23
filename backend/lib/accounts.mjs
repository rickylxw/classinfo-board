// accounts.mjs — 会话表（全局 sessions.json，滑动续期）+ 账号存取（每账号独立文件，内存缓存）
// + 旧版单文件迁移（accounts.json + 扁平 files/ → 每账号独立目录）
import { readFile, writeFile, mkdir, unlink, rename, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { P } from './env.mjs'
import { restoreLatestBackup, writeJsonAtomic, backupJson } from './persist.mjs'
import { safeId } from './util.mjs'

export const SESSION_DAYS = 30

/* ---------- 会话（全局 sessions.json） ---------- */
export const sessions = {}
const pruneSessions = () => {
  const now = Date.now()
  for (const [t, s] of Object.entries(sessions)) if (s.expiresAt < now) delete sessions[t]
}
export async function loadSessions() {
  let data = null
  const file = path.join(P.DATA_DIR, 'sessions.json')
  try {
    data = JSON.parse(await readFile(file, 'utf8'))
  } catch (e) {
    if (existsSync(file)) {
      data = await restoreLatestBackup('sessions')
      if (data) {
        console.error('[recover] sessions.json 损坏，已从备份自动恢复')
        await writeJsonAtomic(file, data).catch(() => {})
      }
    }
  }
  if (data && typeof data === 'object') Object.assign(sessions, data)
  pruneSessions()
}
export async function saveSessions() {
  pruneSessions()
  try {
    await writeJsonAtomic(path.join(P.DATA_DIR, 'sessions.json'), sessions)
    await backupJson('sessions', sessions)
  } catch (e) {
    console.error('[save] sessions.json 保存失败：', e.message)
  }
}

export const bearer = req => (/^Bearer (.+)$/.exec(req.headers.authorization || '') || [])[1] || ''
export function auth(req) {
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
export function userAuth(req) {
  const s = auth(req)
  return (s && !s.admin) ? s : null
}

/* ---------- 账号存取（每账号独立文件，内存缓存） ---------- */
export const accountPath = xh => path.join(P.ACCOUNTS_DIR, safeId(xh) + '.json')
export const accountFilesDir = xh => path.join(P.FILES_DIR, safeId(xh))

const accountCache = new Map()   // xh -> 账号对象

export async function loadAccount(xh, { create = false } = {}) {
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
export async function saveAccount(acc) {
  accountCache.set(acc.xh, acc)
  try {
    await writeJsonAtomic(accountPath(acc.xh), acc)
    await backupJson('accounts/' + safeId(acc.xh), acc)
  } catch (e) {
    console.error(`[save] 账号 ${acc.xh} 保存失败：`, e.message)
  }
}
export function forgetAccount(xh) {
  accountCache.delete(xh)
}

/* ---------- 旧版单文件迁移（accounts.json + 扁平 files/） ---------- */
export async function migrateLegacy() {
  const legacyFile = path.join(P.DATA_DIR, 'accounts.json')
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
        const flat = path.join(P.FILES_DIR, id)
        if (existsSync(flat)) await rename(flat, path.join(accountFilesDir(old.xh), id)).catch(() => {})
      }
      console.log(`[migrate] 账号 ${old.xh} 已迁移为独立文件`)
    }
    await mkdir(path.join(P.DATA_DIR, 'legacy'), { recursive: true })
    await rename(legacyFile, path.join(P.DATA_DIR, 'legacy', 'accounts.json')).catch(() => {})
    console.log('[migrate] 旧版 accounts.json 已备份至 data/legacy/')
  } catch (e) {
    console.error('[migrate] 迁移失败：', e.message)
  }
}

/* ---------- 管理端账号清理辅助 ---------- */
export async function purgeAccountData(xh) {
  await unlink(accountPath(xh)).catch(() => {})
}
