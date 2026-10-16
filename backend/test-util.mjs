/* 测试公共设施：为每个测试起一个完全隔离的后端实例（独立临时 DATA_DIR + 预置随机会话/账号），
 * 跑完自动停进程并删除临时目录。生产 backend/data/ 永不被触碰（docs/repo-management.md §7）。
 *
 * 用法：
 *   import { withTestServer } from './test-util.mjs'
 *   await withTestServer(
 *     {
 *       A: { xh: 'shareA0001', data: { courses: [/* 种子课程 *\/], assignments: [], files: [] } },
 *       B: { xh: 'shareB0002' }
 *     },
 *     async ({ base, adminPass, token }) => {
 *       // base = 'http://127.0.0.1:<port>/api'；token('A') 取该用户的会话 token
 *       // 管理员用 adminPass 走 POST /auth/admin-login（实例启动时经 ADMIN_PASS 环境变量注册）
 *     }
 *   )
 * 会话 token 与管理员密码均为每次运行随机生成，绝不写入代码（repo-management §2 红线）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs')

export async function withTestServer(users, fn, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classinfo-test-'))
  const dataDir = path.join(root, 'data')
  fs.mkdirSync(path.join(dataDir, 'accounts'), { recursive: true })
  if (opts.seedShares) {
    // 预置 shares.json（如旧版单群数据，验证启动迁移）
    fs.writeFileSync(path.join(dataDir, 'shares.json'), JSON.stringify(opts.seedShares))
  }

  const tokenOf = {}
  const sessions = {}
  for (const [alias, u] of Object.entries(users || {})) {
    if (!u?.xh) throw new Error(`测试用户 ${alias} 缺少 xh`)
    const token = crypto.randomBytes(16).toString('hex')
    tokenOf[alias] = token
    sessions[token] = { xh: u.xh, expiresAt: Date.now() + 864e5 }
    if (u.data) {
      fs.writeFileSync(
        path.join(dataDir, 'accounts', u.xh + '.json'),
        JSON.stringify({ xh: u.xh, createdAt: Date.now(), cookie: '', data: u.data })
      )
    }
  }
  fs.writeFileSync(path.join(dataDir, 'sessions.json'), JSON.stringify(sessions))

  const adminPass = crypto.randomBytes(9).toString('hex')
  let child = null
  let base = null
  for (let attempt = 0; attempt < 5 && !base; attempt++) {
    const port = 15000 + Math.floor(Math.random() * 10000)
    child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_PASS: adminPass },
      stdio: 'ignore'
    })
    base = await new Promise(resolve => {
      const t0 = Date.now()
      const poll = async () => {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/auth/me`)
          if (r.status === 401) return resolve(`http://127.0.0.1:${port}/api`)   // 实例已应答
        } catch (e) { /* 尚未就绪 */ }
        if (child.exitCode !== null) return resolve(null)   // 进程退了（如端口冲突）
        if (Date.now() - t0 > 8000) return resolve(null)
        setTimeout(poll, 200)
      }
      poll()
    })
    if (!base) { try { child.kill() } catch (e) { /* 忽略 */ } }
  }
  if (!base) {
    fs.rmSync(root, { recursive: true, force: true })
    throw new Error('隔离测试实例启动失败（连续 5 个端口未就绪）')
  }

  try {
    return await fn({ base, adminPass, token: alias => tokenOf[alias], dataDir })
  } finally {
    try { child.kill() } catch (e) { /* 忽略 */ }
    await new Promise(r => setTimeout(r, 200))
    fs.rmSync(root, { recursive: true, force: true })
  }
}
