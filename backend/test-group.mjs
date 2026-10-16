// 教学群（多群）全链路测试：负责人增改删、成员 add/edit 申请与审核、旧单群数据迁移
// （隔离实例自动起停，不碰生产数据）
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

  // O 申请并成为负责人
  await post('/share/apply', { name: '软件工程', teacher: '王老师' }, token('O'))
  const ap = await post('/admin/share/decision', { key: KEY, xh: 'groupO0002', approve: true }, admin.token)
  ck('O 被任命为课程负责人', ap.ok && ap.ownerSet === true, JSON.stringify(ap))

  // 1) 负责人添加两个群（QQ + 数智东南）
  const g1 = await post('/board/group/add', { key: KEY, group: { type: 'QQ群', num: '111 222', note: '主力群' } }, token('O'))
  ck('负责人添加第 1 个群（QQ群）', g1.ok && !!g1.group?.id, JSON.stringify(g1))
  const g2 = await post('/board/group/add', { key: KEY, group: { type: '数智东南群', num: '888 999' } }, token('O'))
  ck('负责人添加第 2 个群（数智东南群）', g2.ok && !!g2.group?.id)
  ck('两个群 id 不同', g1.group.id !== g2.group.id)

  // 2) 空内容被拒
  const empty = await post('/board/group/add', { key: KEY, group: { type: 'QQ群', num: '', link: '', note: '' } }, token('O'))
  ck('空内容添加被 400 拒绝', !!empty.error)

  // 3) 成员同步拿到 groups 数组
  const sync = await get('/sync', token('M'))
  ck('成员同步收到 groups 数组（2 个）', sync[0]?.groups?.length === 2, JSON.stringify(sync[0]?.groups))
  ck('兼容字段 group = 首个有内容的群', sync[0]?.group?.num === '111 222')

  // 4) 负责人更新其中一个群
  const up = await post('/board/group/update', { key: KEY, id: g1.group.id, group: { type: 'QQ群', num: '111 222', link: '', note: '改为旗舰群' } }, token('O'))
  ck('负责人更新指定群（id 不变）', up.ok && up.group.note === '改为旗舰群' && up.group.id === g1.group.id)
  const board1 = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('更新后仍是 2 个群', board1.groups.length === 2)

  // 5) 成员提交「添加」申请 → 负责人通过 → 第 3 个群入列
  const sub = await post('/board/group/submit', { key: KEY, action: 'add', group: { type: '微信群', num: '777 000' } }, token('M'))
  ck('成员提交添加群申请', sub.ok, JSON.stringify(sub))
  const pend = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('负责人可见待审（action=add）', pend.pendingGroup?.action === 'add' && pend.pendingGroup.group.num === '777 000')
  const rv = await post('/board/group/review', { key: KEY, approve: true }, token('O'))
  ck('审核通过后第 3 个群入列', rv.ok && rv.published)
  const board2 = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('现共 3 个群', board2.groups.length === 3, JSON.stringify(board2.groups.map(g => g.num)))

  // 6) 成员提交「修改」申请（带 id）→ 管理员驳回 → 原群不变
  const sub2 = await post('/board/group/submit', { key: KEY, action: 'edit', id: g2.group.id, group: { type: '数智东南群', num: '000 111' } }, token('M'))
  ck('成员提交修改群申请（带 id）', sub2.ok)
  const rj = await post('/board/group/review', { key: KEY, approve: false }, admin.token)
  ck('驳回成功且无待审', rj.ok && !(await get('/board?key=' + encodeURIComponent(KEY), token('O'))).pendingGroup)
  const board3 = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('驳回不改动原群', board3.groups.find(x => x.id === g2.group.id)?.num === '888 999')

  // 7) 负责人删除一个群
  const del = await post('/board/group/delete', { key: KEY, id: g1.group.id }, token('O'))
  ck('负责人删除指定群', del.ok)
  const board4 = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('删除后剩 2 个群', board4.groups.length === 2)

  // 8) 非负责人维护被 403、负责人走申请通道被 400 提示直接编辑
  const forbidden = await post('/board/group/add', { key: KEY, group: { num: 'x' } }, token('M'))
  ck('非负责人添加群被 403', !!forbidden.error)
  const notMember = await post('/board/group/submit', { key: KEY, action: 'add', group: { num: 'y' } }, token('O'))
  ck('负责人走申请通道被 400 提示直接编辑', String(notMember.error || '').includes('可直接编辑'), JSON.stringify(notMember))

  console.log(out.join('\n'))
  console.log(out.every(r => r.startsWith('✅')) ? '\n=== 多群链路全部通过 ===' : '\n=== 存在失败项 ===')
  if (!out.every(r => r.startsWith('✅'))) process.exitCode = 1
})

/* 旧版单群数据迁移：启动时 legacy group（有内容）自动并入 groups 首位，旧待审补 action */
await withTestServer({
  U: { xh: 'migr00001' }
}, async ({ base, adminPass, token }) => {
  const out2 = []
  const ck = (n, c, d = '') => out2.push((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : ''))
  const post = (p, body, tk) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify(body) }).then(r => r.json())
  const admin = await post('/auth/admin-login', { username: 'admin', password: adminPass }, '')
  const boards = await fetch(base + '/admin/boards', { headers: { Authorization: 'Bearer ' + admin.token } }).then(r => r.json())
  const b = boards.boards.find(x => x.key === '旧课|老師')
  ck('迁移：旧单群并入 groups', b && b.groups?.length === 1 && b.groups[0].num === '555 666', JSON.stringify(b))
  ck('迁移：旧待审申请补 action=edit', b?.pendingGroup?.action === 'edit' && b.pendingGroup.group.num === '9', JSON.stringify(b?.pendingGroup))
  console.log(out2.join('\n'))
  console.log(out2.every(r => r.startsWith('✅')) ? '=== 迁移验证全部通过 ===' : '=== 迁移验证存在失败 ===')
  if (!out2.every(r => r.startsWith('✅'))) process.exitCode = 1
}, {
  seedShares: {
    applications: [], owners: {},
    boards: {
      '旧课|老師': {
        assignments: [], files: [], pendingAssignments: [], pendingFiles: [],
        group: { type: 'QQ群', num: '555 666', link: '', note: '旧数据', updatedAt: 1 },
        pendingGroup: { group: { type: 'QQ群', num: '9', link: '', note: '' }, xh: 'migr00001', submittedAt: 1 }
      }
    }
  }
})
