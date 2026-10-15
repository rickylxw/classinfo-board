// 教学群修改申请-审核 全链路测试（UTF-8）
const BASE = 'http://127.0.0.1:5174/api'
const post = (p, body, token) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }).then(r => r.json())
const get = (p, token) => fetch(BASE + p, { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
const KEY = '软件工程|王老师'

const out = []
const results = out
const ck = (n, c, d = '') => out.push((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : ''))
const check = ck

const ADMIN_PASS = process.env.ADMIN_PASS
if (!ADMIN_PASS) { console.error('❌ 请先设置环境变量 ADMIN_PASS（管理员密码），密码不得写入代码'); process.exit(1) }
const admin = await post('/auth/admin-login', { username: 'admin', password: ADMIN_PASS })
ck('管理员登录', !!admin.token)

// 重置板的待审状态（保留已上架内容）
const fs = await import('fs')
const sharesPath = new URL('./backend/data/shares.json', 'file://E:/Documents/Trae project/Classinfo Board/').pathname
const shares = JSON.parse(fs.readFileSync(new URL('../backend/data/shares.json', import.meta.url), 'utf8'))
shares.boards[KEY].pendingGroup = null
fs.writeFileSync(new URL('../backend/data/shares.json', import.meta.url), shares ? JSON.stringify(shares) : '{}')

// 1) 成员提交教学群修改申请
const sub = await post('/board/group/submit', { key: KEY, group: { type: 'QQ群', num: '999 888', link: '', note: '换新群' } }, 'tkM')
ck('成员提交教学群修改申请', sub.ok, JSON.stringify(sub))

// 2) 负责人看到待审申请
const board = await get('/board?key=' + encodeURIComponent(KEY), 'tkO')
ck('负责人可见待审修改', board.pendingGroup && board.pendingGroup.group.num === '999 888', JSON.stringify(board.pendingGroup))

// 3) 无关人员不能审核（成员 tkM 是提交者，非负责人……此处 tMember2 不是负责人）
const forbidden = await post('/board/group/review', { key: KEY, approve: true }, 'tkM')
ck('非负责人/管理员审核被 403', !!forbidden.error)

// 4) 负责人驳回
const rj = await post('/board/group/review', { key: KEY, approve: false }, 'tkO')
ck('负责人驳回成功', rj.ok)
ck('驳回后无待审', !(await get('/board?key=' + encodeURIComponent(KEY), 'tkO')).pendingGroup)

// 5) 成员再次提交 → 管理员通过 → board.group 更新 → 成员同步拿到
await post('/board/group/submit', { key: KEY, group: { type: 'QQ群', num: '888 777', link: '', note: '' } }, 'tkM')
const r2 = await post('/board/group/review', { key: KEY, approve: true }, admin.token)
ck('管理员通过成员申请', r2.ok && r2.published)
const sync = await get('/sync', 'tkM')
ck('成员同步拿到更新后的共享教学群', sync[0]?.group?.num === '888 777', JSON.stringify(sync[0]?.group))

// 6) /board/submissions 包含待审 group（提交者视角）
await post('/board/group/submit', { key: KEY, group: { type: '微信群', num: '777 000', link: '', note: '' } }, 'tkM')
const subs = await get('/board/submissions?key=' + encodeURIComponent(KEY), 'tkM')
ck('提交者可见自己的待审修改', subs.group && subs.group.group.num === '777 000', JSON.stringify(subs.group))
// 清理这条
await post('/board/group/review', { key: KEY, approve: false }, admin.token)

console.log(out.join('\n'))
console.log(out.every(r => r.startsWith('✅')) ? '=== 全部通过 ===' : '=== 存在失败 ===')
