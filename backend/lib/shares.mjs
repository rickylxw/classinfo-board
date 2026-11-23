// shares.mjs — 课程负责人与共享板（shares.json）+ SSE 广播触发 + 同名同教师匹配
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { P } from './env.mjs'
import { restoreLatestBackup, writeJsonAtomic, backupJson } from './persist.mjs'
import { sseBroadcast, sseClientCount } from './sse.mjs'
import { loadAccount } from './accounts.mjs'
import { norm, maskXh } from './util.mjs'

/* ---------- 课程负责人与共享板（shares.json） ----------
 * applications: [{ key, xh, appliedAt, decidedAt?, status: 'pending'|'approved'|'rejected' }]
 *   - rejected 永久生效：同一人对同一课程被驳回后不可重新申请
 * owners: { [courseKey]: 学号 }  每门课一名课程负责人
 * boards: { [courseKey]: { assignments, files, pendingAssignments, pendingFiles,
 *           groups: [{id,type,num,link,note,updatedAt}], pendingGroups: [...] } }
 *   共享板由负责人编辑；普通成员可「投稿」作业/附件进入待审队列，负责人审核通过后上架同步。 */
const shares = { applications: [], owners: {}, boards: {} }
export { shares }

/* ---------- 课程共享（同名同教师匹配） ---------- */
export const courseKey = c => norm(c.name) + '|' + norm(c.teacher)
export const isOwner = (xh, key) => shares.owners[key] === xh

const keyHash = key => crypto.createHash('sha256').update('board:' + key).digest('hex').slice(0, 16)
export const boardDir = key => path.join(P.FILES_DIR, 'board', keyHash(key))

/* 教学群多群模型：boards[key].groups = [{id,type,num,link,note,updatedAt}...]，一门课可挂多个群 */
export const sanitizeGroup = g => ({
  type: String(g?.type || '').slice(0, 20),
  num: String(g?.num || '').slice(0, 60),
  link: String(g?.link || '').slice(0, 300),
  note: String(g?.note || '').slice(0, 200)
})
export const groupHasContent = g => !!(g && (g.num || g.link || g.note))

export const boardOf = key => (shares.boards[key] = shares.boards[key] || { assignments: [], files: [], pendingAssignments: [], pendingFiles: [], groups: [], pendingGroups: [], group: null, pendingGroup: null })

export async function loadShares() {
  const SHARES_FILE = path.join(P.DATA_DIR, 'shares.json')
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
  // 教学群多群模型迁移：旧的单个 group（若有内容）并入 groups 首位；旧单条待审申请迁入队列
  for (const b of Object.values(shares.boards)) {
    if (!Array.isArray(b.groups)) {
      b.groups = groupHasContent(b.group)
        ? [{ id: crypto.randomBytes(8).toString('hex'), ...sanitizeGroup(b.group), updatedAt: b.group.updatedAt || Date.now() }]
        : []
    }
    b.group = null
    if (!Array.isArray(b.pendingGroups)) {
      b.pendingGroups = b.pendingGroup
        ? [{
            pid: crypto.randomBytes(8).toString('hex'),
            action: b.pendingGroup.action || 'edit',
            gid: b.pendingGroup.id,
            group: sanitizeGroup(b.pendingGroup.group),
            xh: b.pendingGroup.xh,
            submittedAt: b.pendingGroup.submittedAt || Date.now()
          }]
        : []
    }
    b.pendingGroup = null
  }
}

export async function saveShares() {
  const SHARES_FILE = path.join(P.DATA_DIR, 'shares.json')
  let persisted = false
  try {
    await writeJsonAtomic(SHARES_FILE, shares)
    await backupJson('shares', shares)
    persisted = true
  } catch (e) {
    console.error('[save] shares.json 保存失败：', e.message)
  }
  // 唯一广播点：所有共享板/投稿/负责人变更都经 saveShares 落盘；写盘失败不广播。
  // 账号数据（/data 系端点）的跨设备广播在各自端点内用 sseBroadcastTo(定向同账号) 完成。
  if (persisted && sseClientCount()) sseBroadcast()
}

// 我能收到同步的课程：有共享板且有上架内容即推送（负责人或管理员维护），排除自己维护的
export async function syncForMe(myXh) {
  const me = await loadAccount(myXh)
  const out = []
  for (const c of me?.data?.courses || []) {
    const key = courseKey(c)
    const board = shares.boards[key]
    if (!board) continue
    const hasGroup = (board.groups || []).some(groupHasContent)
    if (!board.assignments?.length && !board.files?.length && !hasGroup) continue   // 板上还没有任何上架内容时不推送空同步
    const ownerXh = shares.owners[key]
    if (ownerXh === myXh) continue   // 负责人自己走管理卡片，不重复下发
    out.push({
      key,
      ref: keyHash(key),
      from: ownerXh ? maskXh(ownerXh) : '管理员',
      groups: board.groups || [],
      group: (board.groups || []).find(groupHasContent) || null,   // 旧前端兼容：首个有内容的群
      assignments: (board.assignments || []).map(a => ({
        id: a.id, title: a.title, deadline: a.deadline || '', requirement: a.requirement || ''
      })),
      files: (board.files || []).map(f => ({ id: f.id, name: f.name, size: f.size }))
    })
  }
  return out
}
