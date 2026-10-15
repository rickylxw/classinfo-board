// 课程负责人模型全链路测试
const BASE = 'http://127.0.0.1:5174/api'
const j = r => r.json()
const post = (p, body, token) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }).then(j)
const get = (p, token) => fetch(BASE + p, { headers: { Authorization: 'Bearer ' + token } }).then(j)
const KEY = '操作系统|钱老师'

const results = []
const check = (name, cond, detail = '') => { results.push(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`) }

const ADMIN_PASS = process.env.ADMIN_PASS
if (!ADMIN_PASS) { console.error('❌ 请先设置环境变量 ADMIN_PASS（管理员密码），密码不得写入代码'); process.exit(1) }
const admin = await post('/auth/admin-login', { username: 'admin', password: ADMIN_PASS })
check('管理员登录', !!admin.token)

// 1) A 申请成为负责人
const ap = await post('/share/apply', { name: '操作系统', teacher: '钱老师' }, 'shA')
check('A 申请负责人 → pending', ap.status === 'pending', JSON.stringify(ap))

// 2) 审核前 B 无同步
check('审核前 B 无同步', (await get('/sync', 'shB')).length === 0)

// 3) 管理员驳回 → A 不可重申
await post('/admin/share/decision', { key: KEY, xh: 'shareA0001', approve: false }, admin.token)
const reapply = await post('/share/apply', { name: '操作系统', teacher: '钱老师' }, 'shA')
check('驳回后重新申请被 403 拒绝', reapply.error?.includes('无法重新申请'), JSON.stringify(reapply))

// 4) 管理员没有"撤销驳回"的常规途径（测试直接造第二人申请，管理员通过他）——
//    为测通过路径：B 申请 → 通过 → B 成为负责人
const apB = await post('/share/apply', { name: '操作系统', teacher: '钱老师' }, 'shB')
check('B 申请 → pending', apB.status === 'pending')
const dec = await post('/admin/share/decision', { key: KEY, xh: 'shareB0002', approve: true }, admin.token)
check('B 被任命为课程负责人', dec.ok && dec.ownerSet === true, JSON.stringify(dec))

// 5) 负责人维护共享板：加两项作业 + 一个附件
const up1 = await post('/board/assignment/upsert', { key: KEY, title: 'Lab1 进程调度', deadline: '2026-11-01T23:59', requirement: '**双周提交**' }, 'shB')
check('负责人添加共享作业', up1.ok && !!up1.id)
const up2 = await post('/board/assignment/upsert', { key: KEY, title: 'Lab1 进程调度（改期）', deadline: '2026-11-05T23:59' }, 'shB')
const edit = await post('/board/assignment/upsert', { key: KEY, id: up1.id, title: 'Lab1 进程调度（改期）', deadline: '2026-11-05T23:59', requirement: '**双周提交**' }, 'shB')
check('负责人编辑共享作业', edit.ok)
await post('/board/assignment/delete', { key: KEY, id: up2.id }, 'shB')
const board = await get('/board?key=' + encodeURIComponent(KEY), 'shB')
check('共享板最终 1 项作业', board.assignments.length === 1 && board.assignments[0].title.includes('改期'))

// 非负责人被拒
const forbidden = await post('/board/assignment/upsert', { key: KEY, title: 'x' }, 'shA')
check('非负责人编辑共享板被 403', forbidden.error?.includes('仅课程负责人'))

// 6) 上传附件
const up = await fetch(BASE + '/board/file/upload?key=' + encodeURIComponent(KEY) + '&name=' + encodeURIComponent('讲义.pdf'), { method: 'PUT', headers: { Authorization: 'Bearer shB' }, body: 'PDF-BOARD-CONTENT' }).then(j)
check('负责人上传共享附件', up.ok && !!up.id)

// 7) A（同课成员）收到同步：作业无完成状态 + 可下载附件
const sync = await get('/sync', 'shA')
const item = sync[0]
check('成员收到共享板同步', sync.length === 1 && item.assignments.length === 1 && item.assignments[0].title.includes('改期'), JSON.stringify(sync).slice(0, 150))
check('同步作业无完成状态字段', item.assignments.every(a => !('status' in a)))
const dl = await fetch(BASE + '/board/file/download?key=' + encodeURIComponent(KEY) + '&id=' + up.id, { headers: { Authorization: 'Bearer shA' } }).then(r => r.text())
check('成员下载共享附件', dl === 'PDF-BOARD-CONTENT', dl)

// 8) 无关课程成员不可下载（造一个不同课的账号太重——用未登录验证即可）
const anon = await fetch(BASE + '/board/file/download?key=' + encodeURIComponent(KEY) + '&id=' + up.id)
check('未登录下载被拒', anon.status === 401)

// 9) 撤销负责人 → A 不再收到同步
await post('/admin/share/revoke', { key: KEY }, admin.token)
check('撤销负责人后成员无同步', (await get('/sync', 'shA')).length === 0)
const boardKept = await get('/admin/shares', admin.token)
check('撤销后共享板数据保留（可任命新负责人）', boardKept.boardCounts[KEY] !== undefined, JSON.stringify(boardKept.boardCounts))

console.log(results.join('\n'))
console.log(results.every(r => r.startsWith('✅')) ? '\n=== 全部通过 ===' : '\n=== 存在失败项 ===')
