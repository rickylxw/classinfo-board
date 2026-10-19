// 课程负责人模型全链路测试（隔离实例自动起停，不碰生产数据）
import { withTestServer } from './test-util.mjs'

const KEY = '操作系统|钱老师'

await withTestServer({
  A: { xh: 'shareA0001', data: { courses: [{ id: 'cA', name: '操作系统', teacher: '钱老师', semester: '2026-2027-1' }], assignments: [], files: [] } },
  B: { xh: 'shareB0002' }
}, async ({ base, adminPass, token }) => {
  const j = r => r.json()
  const post = (p, body, tk) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify(body) }).then(j)
  const get = (p, tk) => fetch(base + p, { headers: { Authorization: 'Bearer ' + tk } }).then(j)

  const results = []
  const check = (name, cond, detail = '') => { results.push(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`) }

  const admin = await post('/auth/admin-login', { username: 'admin', password: adminPass }, '')
  check('管理员登录', !!admin.token)

  // 1) A 申请成为负责人
  const ap = await post('/share/apply', { name: '操作系统', teacher: '钱老师' }, token('A'))
  check('A 申请负责人 → pending', ap.status === 'pending', JSON.stringify(ap))

  // 2) 审核前 B 无同步
  check('审核前 B 无同步', (await get('/sync', token('B'))).length === 0)

  // 3) 管理员驳回 → A 不可重申
  await post('/admin/share/decision', { key: KEY, xh: 'shareA0001', approve: false }, admin.token)
  const reapply = await post('/share/apply', { name: '操作系统', teacher: '钱老师' }, token('A'))
  check('驳回后重新申请被 403 拒绝', reapply.error?.includes('无法重新申请'), JSON.stringify(reapply))

  // 4) 管理员没有"撤销驳回"的常规途径（测试直接造第二人申请，管理员通过他）——
  //    为测通过路径：B 申请 → 通过 → B 成为负责人
  const apB = await post('/share/apply', { name: '操作系统', teacher: '钱老师' }, token('B'))
  check('B 申请 → pending', apB.status === 'pending')
  const dec = await post('/admin/share/decision', { key: KEY, xh: 'shareB0002', approve: true }, admin.token)
  check('B 被任命为课程负责人', dec.ok && dec.ownerSet === true, JSON.stringify(dec))

  // 5) 负责人维护共享板：加两项作业 + 一个附件
  const up1 = await post('/board/assignment/upsert', { key: KEY, title: 'Lab1 进程调度', deadline: '2026-11-01T23:59', requirement: '**双周提交**' }, token('B'))
  check('负责人添加共享作业', up1.ok && !!up1.id)
  const up2 = await post('/board/assignment/upsert', { key: KEY, title: 'Lab1 进程调度（改期）', deadline: '2026-11-05T23:59' }, token('B'))
  const edit = await post('/board/assignment/upsert', { key: KEY, id: up1.id, title: 'Lab1 进程调度（改期）', deadline: '2026-11-05T23:59', requirement: '**双周提交**' }, token('B'))
  check('负责人编辑共享作业', edit.ok)
  await post('/board/assignment/delete', { key: KEY, id: up2.id }, token('B'))
  const board = await get('/board?key=' + encodeURIComponent(KEY), token('B'))
  check('共享板最终 1 项作业', board.assignments.length === 1 && board.assignments[0].title.includes('改期'))

  // 非负责人被拒
  const forbidden = await post('/board/assignment/upsert', { key: KEY, title: 'x' }, token('A'))
  check('非负责人编辑共享板被 403', forbidden.error?.includes('仅课程负责人'))

  // 6) 上传附件
  const up = await fetch(base + '/board/file/upload?key=' + encodeURIComponent(KEY) + '&name=' + encodeURIComponent('讲义.pdf'), { method: 'PUT', headers: { Authorization: 'Bearer ' + token('B') }, body: 'PDF-BOARD-CONTENT' }).then(j)
  check('负责人上传共享附件', up.ok && !!up.id)

  // 7) A（同课成员）收到同步：作业无完成状态 + 可下载附件
  const sync = await get('/sync', token('A'))
  const item = sync[0]
  check('成员收到共享板同步', sync.length === 1 && item.assignments.length === 1 && item.assignments[0].title.includes('改期'), JSON.stringify(sync).slice(0, 150))
  check('同步作业无完成状态字段', item.assignments.every(a => !('status' in a)))
  const dl = await fetch(base + '/board/file/download?key=' + encodeURIComponent(KEY) + '&id=' + up.id, { headers: { Authorization: 'Bearer ' + token('A') } }).then(r => r.text())
  check('成员下载共享附件', dl === 'PDF-BOARD-CONTENT', dl)

  // 8) 无关课程成员不可下载（造一个不同课的账号太重——用未登录验证即可）
  const anon = await fetch(base + '/board/file/download?key=' + encodeURIComponent(KEY) + '&id=' + up.id)
  check('未登录下载被拒', anon.status === 401)

  // 9) 撤销负责人 → 板数据保留；无主板的已上架内容仍同步（来源显示「管理员」，10-14 功能④）
  await post('/admin/share/revoke', { key: KEY }, admin.token)
  const sync2 = await get('/sync', token('A'))
  check('撤销后板内容仍同步且来源=管理员', sync2.length === 1 && sync2[0].from === '管理员', JSON.stringify(sync2).slice(0, 120))
  const boardKept = await get('/admin/shares', admin.token)
  check('撤销后共享板数据保留（可任命新负责人）', boardKept.boardCounts[KEY] !== undefined, JSON.stringify(boardKept.boardCounts))

  // 10) 撤销负责人后，管理员可直接编辑/新增共享作业（无负责人板的管理兜底，与负责人同权）
  const bd0 = (await get('/admin/boards', admin.token)).boards.find(x => x.key === KEY)
  const ae = await post('/board/assignment/upsert', { key: KEY, id: bd0.assignments[0].id, title: 'Lab1 进程调度（管理员改）', deadline: '2026-11-06T23:59' }, admin.token)
  check('管理员编辑共享作业（无负责人板）', ae.ok && ae.id === bd0.assignments[0].id, JSON.stringify(ae))
  const an = await post('/board/assignment/upsert', { key: KEY, title: '管理员代增的作业' }, admin.token)
  check('管理员新增共享作业', an.ok && !!an.id, JSON.stringify(an))
  const bd1 = (await get('/admin/boards', admin.token)).boards.find(x => x.key === KEY)
  check('编辑与新增均已入板', bd1.assignments.length === 2 && bd1.assignments.some(a => a.title.includes('管理员改')), JSON.stringify(bd1.assignments))

  console.log(results.join('\n'))
  console.log(results.every(r => r.startsWith('✅')) ? '\n=== 全部通过 ===' : '\n=== 存在失败项 ===')
  if (!results.every(r => r.startsWith('✅'))) process.exitCode = 1
})
