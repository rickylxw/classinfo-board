// util.mjs — 无状态通用工具（无任何模块依赖，谁都可以 import）
import path from 'node:path'
import { readdir, rm, stat } from 'node:fs/promises'

export const rmDir = p => rm(p, { recursive: true, force: true })

// 学号/文件 id 白名单净化：只留字母数字下划线连字符
export const safeId = s => String(s).replace(/[^a-zA-Z0-9_-]/g, '')

// 课程匹配用的名称规范化：去空白 + 小写
export const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, '')

// 学号脱敏展示：前3 + **** + 后2
export const maskXh = xh => (String(xh).length > 5 ? String(xh).slice(0, 3) + '****' + String(xh).slice(-2) : String(xh))

// 服务端字段截断，防单条超大内容灌爆 shares.json
export const clampStr = (v, n) => String(v ?? '').slice(0, n)

// 应用与前端同源（经 5173 代理），无需跨域放行；不再返回 Access-Control-Allow-Origin: *
export function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

export const fail = (status, message) => { const e = new Error(message); e.status = status; throw e }

export function readBody(req, limit) {
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

export async function readJson(req, limit) {
  const raw = (await readBody(req, limit)).toString('utf8')
  try { return raw ? JSON.parse(raw) : {} } catch (e) { fail(400, '请求体不是合法 JSON') }
}

// 附件下载响应头：强制下载 + nosniff，防上传的 HTML/SVG 被浏览器内联执行
export function fileHeaders(res, name) {
  const safe = String(name || '').replace(/[\r\n"\\/]/g, '_').slice(0, 120) || '附件'
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safe)}`
  })
}

export async function dirSize(dir) {
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
