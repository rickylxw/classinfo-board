// 教学群（多群 + 待审队列）全链路测试：负责人增改删、成员多申请并发、按 pid 审核、
// 重复防呆、失效作废、无 pid 兼容、旧数据迁移（隔离实例自动起停，不碰生产数据）
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

  // 5) 待审队列：同一成员可同时挂多个申请，按 pid 逐条审核
  const s1 = await post('/board/group/submit', { key: KEY, action: 'add', group: { type: '微信群', num: '777 000' } }, token('M'))
  ck('成员提交添加申请①', s1.ok && !!s1.pid, JSON.stringify(s1))
  const s2 = await post('/board/group/submit', { key: KEY, action: 'add', group: { type: 'QQ群', num: '555 010' } }, token('M'))
  ck('成员再提交申请②（同人不互相覆盖）', s2.ok && !!s2.pid && s2.pid !== s1.pid)
  const dup = await post('/board/group/submit', { key: KEY, action: 'add', group: { type: '微信群', num: '777 000' } }, token('M'))
  ck('同一人重复提交相同内容被 400 拒绝', !!dup.error && String(dup.error).includes('相同的申请'), JSON.stringify(dup))
  const pend = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('负责人看到队列里 2 条待审', pend.pendingGroups?.length === 2, JSON.stringify(pend.pendingGroups?.map(p => p.group.num)))
  const rv2 = await post('/board/group/review', { key: KEY, pid: s2.pid, approve: true }, token('O'))
  ck('按 pid 审核申请②通过', rv2.ok && rv2.published)
  const boardA = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('申请②的群已入列（555 010）', boardA.groups.some(g => g.num === '555 010'))
  const mine = await get('/board/submissions?key=' + encodeURIComponent(KEY), token('M'))
  ck('成员「我的待审」剩 1 条（自己的队列视图）', mine.groups?.length === 1 && mine.groups[0].pid === s1.pid, JSON.stringify(mine.groups))
  const rv1 = await post('/board/group/review', { key: KEY, pid: s1.pid, approve: true }, token('O'))
  ck('申请①也审核通过', rv1.ok && rv1.published)
  const boardB = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('现共 4 个群（2 挂牌 + 2 新增）', boardB.groups.length === 4, JSON.stringify(boardB.groups.map(g => g.num)))

  // 6) 「修改」申请 → 驳回不动原群
  const sub2 = await post('/board/group/submit', { key: KEY, action: 'edit', id: g2.group.id, group: { type: '数智东南群', num: '000 111' } }, token('M'))
  ck('成员提交修改申请（带 gid）', sub2.ok)
  const rj = await post('/board/group/review', { key: KEY, pid: sub2.pid, approve: false }, admin.token)
  ck('驳回成功', rj.ok)
  const board3 = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('驳回不改动原群', board3.groups.find(x => x.id === g2.group.id)?.num === '888 999')

  // 7) edit 申请的目标群被删除后再通过 → 作废（stale）而非报错
  const gtmp = await post('/board/group/add', { key: KEY, group: { type: '其他', num: 'temp 000' } }, token('O'))
  const se = await post('/board/group/submit', { key: KEY, action: 'edit', id: gtmp.group.id, group: { type: '其他', num: 'temp 111' } }, token('M'))
  ck('成员对临时群提交修改申请', se.ok)
  await post('/board/group/delete', { key: KEY, id: gtmp.group.id }, token('O'))
  const rvs = await post('/board/group/review', { key: KEY, pid: se.pid, approve: true }, token('O'))
  ck('目标群已删除时通过审核=作废（stale）', rvs.ok && rvs.published === false && rvs.stale === true, JSON.stringify(rvs))

  // 8) 不传 pid 兼容旧客户端 = 消费最早一条
  await post('/board/group/submit', { key: KEY, action: 'add', group: { type: '其他', num: 'old-compat 1' } }, token('M'))
  await post('/board/group/submit', { key: KEY, action: 'add', group: { type: '其他', num: 'old-compat 2' } }, token('M'))
  const rc = await post('/board/group/review', { key: KEY, approve: false }, admin.token)
  ck('不传 pid 审最早一条（兼容）', rc.ok)
  const boardQ = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('队列剩 1 条且是最晚那条', boardQ.pendingGroups.length === 1 && boardQ.pendingGroups[0].group.num === 'old-compat 2', JSON.stringify(boardQ.pendingGroups))

  // 9) 负责人删除一个群
  const del = await post('/board/group/delete', { key: KEY, id: g1.group.id }, token('O'))
  ck('负责人删除指定群', del.ok)
  const board4 = await get('/board?key=' + encodeURIComponent(KEY), token('O'))
  ck('删除后剩 3 个群', board4.groups.length === 3, JSON.stringify(board4.groups.map(g => g.num)))

  // 10) 权限边界
  const forbidden = await post('/board/group/add', { key: KEY, group: { num: 'x' } }, token('M'))
  ck('非负责人添加群被 403', !!forbidden.error)
  const notMember = await post('/board/group/submit', { key: KEY, action: 'add', group: { num: 'y' } }, token('O'))
  ck('负责人走申请通道被 400 提示直接编辑', String(notMember.error || '').includes('可直接编辑'), JSON.stringify(notMember))

  console.log(out.join('\n'))
  console.log(out.every(r => r.startsWith('✅')) ? '\n=== 多群+队列链路全部通过 ===' : '\n=== 存在失败项 ===')
  if (!out.every(r => r.startsWith('✅'))) process.exitCode = 1
})

/* 旧版单条待审申请迁移：启动时 legacy pendingGroup 自动入队（补 pid/action） */
await withTestServer({
  U: { xh: 'migr00001' }
}, async ({ base, adminPass }) => {
  const out2 = []
  const ck = (n, c, d = '') => out2.push((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : ''))
  const admin = await fetch(base + '/auth/admin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: adminPass }) }).then(r => r.json())
  const boards = await fetch(base + '/admin/boards', { headers: { Authorization: 'Bearer ' + admin.token } }).then(r => r.json())
  const b = boards.boards.find(x => x.key === '旧课|老師')
  ck('迁移：旧单群并入 groups', b && b.groups?.length === 1 && b.groups[0].num === '555 666', JSON.stringify(b))
  ck('迁移：旧单条待审申请入队（action=edit、带 pid）', b?.pendingGroups?.length === 1 && b.pendingGroups[0].action === 'edit' && !!b.pendingGroups[0].pid && b.pendingGroups[0].group.num === '9', JSON.stringify(b?.pendingGroups))
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

/* /admin/boards 全课程覆盖：无人互动的课程可见（exists=false）→ 管理员预挂群 →
 * 惰性建板 → 同课成员 /sync 收到；纯枚举课程不被落盘建板 */
await withTestServer({
  S: { xh: 'freshS0001', data: { courses: [{ id: 'cS1', name: '毛概', teacher: '陈老师', semester: '2026-2027-1' }, { id: 'cS2', name: '全新课程', teacher: '新老师', semester: '2026-2027-1' }], assignments: [], files: [] } }
}, async ({ base, adminPass, token }) => {
  const out3 = []
  const ck = (n, c, d = '') => out3.push((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : ''))
  const post = (p, body, tk) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify(body) }).then(r => r.json())
  const adminAuth = { Authorization: 'Bearer ' + (await post('/auth/admin-login', { username: 'admin', password: adminPass }, '')).token }
  const adminBoards = () => fetch(base + '/admin/boards', { headers: adminAuth }).then(r => r.json())
  const KEY2 = '全新课程|新老师'

  const boards0 = await adminBoards()
  const fresh = boards0.boards.find(x => x.key === KEY2)
  ck('无板课程出现在 /admin/boards', !!fresh)
  ck('exists=false 且 groups 为空数组', fresh?.exists === false && Array.isArray(fresh.groups) && fresh.groups.length === 0, JSON.stringify(fresh))
  ck('课程名/教师用账号里的原文（非 key 切分）', fresh?.courseName === '全新课程' && fresh?.teacher === '新老师')
  ck('同账号的未互动课程也全部可见', boards0.boards.some(x => x.key === '毛概|陈老师'))

  const add = await post('/board/group/add', { key: KEY2, group: { type: 'QQ群', num: '246 810' } }, adminAuth.Authorization.split(' ')[1])
  ck('管理员对无板课程直接添加教学群（惰性建板）', add.ok && !!add.group?.id, JSON.stringify(add))

  const boards1 = await adminBoards()
  const now = boards1.boards.find(x => x.key === KEY2)
  ck('挂群后 exists=true 且 groups 入列', now?.exists === true && now?.groups?.length === 1)
  const maogai = boards1.boards.find(x => x.key === '毛概|陈老师')
  ck('纯枚举课程未被落盘建板（exists 仍为 false）', maogai?.exists === false)

  const sync = await fetch(base + '/sync', { headers: { Authorization: 'Bearer ' + token('S') } }).then(r => r.json())
  ck('同课成员 /sync 收到预挂的教学群', sync[0]?.key === KEY2 && sync[0]?.groups?.length === 1 && sync[0]?.groups[0].num === '246 810', JSON.stringify(sync[0]))

  console.log(out3.join('\n'))
  console.log(out3.every(r => r.startsWith('✅')) ? '=== 全课程覆盖验证全部通过 ===' : '=== 全课程覆盖验证存在失败 ===')
  if (!out3.every(r => r.startsWith('✅'))) process.exitCode = 1
})
