// security.mjs — 管理员账号（scrypt 慢哈希 + 旧 sha256 自动升级）与登录限速
import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { P } from './env.mjs'
import { writeJsonAtomic } from './persist.mjs'

/* 管理员（首次启动自动注册，账号密码打印在日志；重置=删除 admin.json）
 * 密码用 scrypt 慢哈希；兼容旧版 sha256(salt+hash) 格式，成功登录一次后自动升级。 */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function timingEq(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

export async function ensureAdmin() {
  const adminFile = path.join(P.DATA_DIR, 'admin.json')
  if (existsSync(adminFile)) return false
  const username = process.env.ADMIN_USER || 'admin'
  const password = process.env.ADMIN_PASS || crypto.randomBytes(9).toString('hex')
  await writeJsonAtomic(adminFile, { username, pw: hashPassword(password), createdAt: Date.now() })
  console.log('════════════════════════════════════════════')
  console.log(`👑 已注册管理员账号: ${username} / ${password}`)
  console.log('   仅首次创建显示；忘记密码可删除 backend/data/admin.json 重启重置')
  console.log('════════════════════════════════════════════')
  return true
}

export function checkAdminPassword(username, password) {
  try {
    const adminFile = path.join(P.DATA_DIR, 'admin.json')
    const a = JSON.parse(readFileSync(adminFile, 'utf8'))
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
        writeJsonAtomic(adminFile, { ...a, pw: hashPassword(password), salt: undefined, hash: undefined })
          .then(() => console.log('[admin] 管理员密码哈希已升级为 scrypt'))
          .catch(e => console.error('[admin] 哈希升级失败：', e.message))
      }
      return true
    }
    return false
  } catch (e) { return false }
}

/* ---------- 登录限速（防局域网内暴力破解） ----------
 * 经代理访问时取 X-Forwarded-For 最后一跳（由可信代理追加的真实客户端地址），
 * 直连 127.0.0.1 时用 socket 地址；伪造的 XFF 会被代理追加真实地址后挤到前面。 */
export const clientIp = req => {
  const xf = String(req.headers['x-forwarded-for'] || '')
  const last = xf.split(',').map(s => s.trim()).filter(Boolean).pop()
  return last || req.socket.remoteAddress || 'unknown'
}

const rateBuckets = new Map()
export function rateLimited(key, max, windowMs) {
  const now = Date.now()
  const hits = (rateBuckets.get(key) || []).filter(t => now - t < windowMs)
  hits.push(now)
  rateBuckets.set(key, hits)
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (!v.some(t => now - t < windowMs)) rateBuckets.delete(k)
  }
  return hits.length > max
}
