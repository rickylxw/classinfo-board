// 精确重建真实共享板（数据结构与算法ii 的两个 Week 报告 + 数字逻辑的 Logisim 附件）
// 并移除测试板与乱码键板
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const sharesPath = path.join(dataDir, 'shares.json')
const shares = JSON.parse(fs.readFileSync(sharesPath, 'utf8'))

const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, '')
const keyHash = key => crypto.createHash('sha256').update('board:' + key).digest('hex').slice(0, 16)

// 1) 只保留真实板，丢弃测试板/乱码板
const keep = Object.keys(shares.boards).filter(k => k === '数据结构与算法ii|吴巍炜' || k === '数字逻辑与计算机组成|李少锋')
const newBoards = {}
for (const k of keep) newBoards[k] = shares.boards[k]
shares.boards = newBoards

// 2) 数据结构与算法ii：两个 Week 报告（标题/DDL 可考，要求正文遗失留空待补）
const k1 = '数据结构与算法ii|吴巍炜'
shares.boards[k1] = shares.boards[k1] || { assignments: [], files: [], pendingAssignments: [], pendingFiles: [], group: null }
shares.boards[k1].assignments = shares.boards[k1].assignments || []
const b1 = shares.boards[k1]
const want = [
  { title: 'Week 1-2 双周报告', deadline: '2026-10-15T00:00' },
  { title: 'Week 3-4 Agent 报告', deadline: '2026-10-19T00:00' }
]
for (const w of want) {
  if (!b1.assignments.some(a => a.title === w.title)) {
    b1.assignments.push({ id: crypto.randomBytes(6).toString('hex'), ...w, requirement: '', updatedAt: Date.now() })
  }
}

// 3) 数字逻辑：确保 Logisim 附件存在（从账号个人空间复制）
const k2 = '数字逻辑与计算机组成|李少锋'
shares.boards[k2] = shares.boards[k2] || { assignments: [], files: [], pendingAssignments: [], pendingFiles: [], group: null }
const b2 = shares.boards[k2]
if (!b2.files.some(f => f.name === 'Logisim-ITA.exe')) {
  const src = path.join(dataDir, 'files', process.env.RECOVER_XH || '<学号，运行时注入，不入库>', '9b5564ff-ffb9-4d04-a360-2cb83fa81ae9')
  if (fs.existsSync(src)) {
    const id = crypto.randomBytes(8).toString('hex')
    const dir = path.join(dataDir, 'files', 'board', keyHash(k2))
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(src, path.join(dir, id))
    b2.files.push({ id, name: 'Logisim-ITA.exe', size: fs.statSync(src).size, uploadedAt: Date.now() })
  } else {
    console.warn('⚠️ Logisim-ITA.exe 云端原件已不存在（可能在界面上删除过），请稍后在课程页重新上传')
  }
}

// 4) 附件目录里清掉不属于任何保留板的散落文件
const validHashes = new Set(Object.keys(shares.boards).map(keyHash))
const boardRoot = path.join(dataDir, 'files', 'board')
if (fs.existsSync(boardRoot)) {
  for (const d of fs.readdirSync(boardRoot)) {
    if (!validHashes.has(d)) fs.rmSync(path.join(boardRoot, d), { recursive: true, force: true })
  }
}

fs.writeFileSync(sharesPath, JSON.stringify(shares))
for (const [k, b] of Object.entries(shares.boards)) {
  console.log('板:', k)
  console.log('  作业:', b.assignments.map(a => a.title).join('、') || '无')
  console.log('  附件:', b.files.map(f => f.name).join('、') || '无')
}
console.log('重建完成')
