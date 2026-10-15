// 教学群修改申请-审核 全链路测试（隔离实例自动起停，不碰生产数据；
// 旧版直写生产 shares.json 重置待审态的做法已废弃，改用全新实例天然无待审）
import { withTestServer } from './test-util.mjs'

const KEY = '软件工程|王老师'

await withTestServer({
  M: { xh: 'groupM0001', data: { courses: [{ id: 'cM', name: '软件工程', teacher: '王老师', semester: '2026-2027-1' }], assignments: [], files: [] } },
  O: { xh: 'groupO0002', data: { courses: [{ id: 'cO', name: '软件工程', teacher: '王老师', semester: '2026-2027-1' }], assignments: [], files: [] } }
}, async ({ base, adminPass, token }) => {
  const post = (p, body, tk) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify(body) }).then(r => r.json())
  const get = (p, tk) => fetch(base + p, { headers: { Authorization: 'Bearer ' + tk } }).then(r => r.json())

  const out = []
  const ck = (n, c, d = '') => out.push((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : ''))

  const admin = await post('/auth/admin-login', { username: 'admin', password: adminPass }, '')
  ck('管理员登录', !!admin.token)

  // O 申请并成为负责人（取代旧版直写 shares.json 造负责人的做法）
  await post('/share/apply', { name: '软件工程', teacher: '王老师' }, token('O'))
  const ap = await post('/admin/share/decision', { key: KEY, xh: 'groupO0002', approve: true }, admin.token)
  ck('O 被任命为课程负责人', ap.ok && ap.ownerSet === true, JSON.stringify(ap))

  // 1) 成员提交教学群修改申请
  const sub = await post('/board/group/submit', { key: KEY, group: { type: 'QQ群', num: '999 888', link: '', note: '换新群' } }, token('M'))
  ck('成员提交教学群修改申请', sub.ok, JSON.stringify(sub))

  // 2) 负责人看到待审申请
  const board = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('负责人可见待审修改', board.pendingGroup && board.pendingGroup.group.num === '999 888', JSON.stringify(board.pendingGroup))

  // 3) 无关人员不能审核（成员 M 是提交者，非负责人）
  const forbidden = await post('/board/group/review', { key: KEY, approve: true }, token('M'))
  ck('非负责人/管理员审核被 403', !!forbidden.error)

  // 4) 负责人驳回
  const rj = await post('/board/group/review', { key: KEY, approve: false }, token('O'))
  ck('负责人驳回成功', rj.ok)
  ck('驳回后无待审', !(await get('/board?key=' + encodeURIComponent(KEY), token('O'))).pendingGroup)

  // 5) 成员再次提交 → 管理员通过 → board.group 更新 → 成员同步拿到
  await post('/board/group/submit', { key: KEY, group: { type: 'QQ群', num: '888 777', link: '', note: '' } }, token('M'))
  const r2 = await post('/board/group/review', { key: KEY, approve: true }, admin.token)
  ck('管理员通过成员申请', r2.ok && r2.published)
  const sync = await get('/sync', token('M'))
  ck('成员同步拿到更新后的共享教学群', sync[0]?.group?.num === '888 777', JSON.stringify(sync[0]?.group))

  // 6) /board/submissions 包含待审 group（提交者视角）
  await post('/board/group/submit', { key: KEY, group: { type: '微信群', num: '777 000', link: '', note: '' } }, token('M'))
  const subs = await get('/board/submissions?key=' + encodeURIComponent(KEY), token('M'))
  ck('提交者可见自己的待审修改', subs.group && subs.group.group.num === '777 000', JSON.stringify(subs.group))
  // 清理这条
  await post('/board/group/review', { key: KEY, approve: false }, admin.token)

  console.log(out.join('\n'))
  console.log(out.every(r => r.startsWith('✅')) ? '=== 全部通过 ===' : '=== 存在失败 ===')
  if (!out.every(r => r.startsWith('✅'))) process.exitCode = 1
})
