// 成员投稿 → 负责人审核 全链路测试（隔离实例自动起停，不碰生产数据）
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

  // B 申请并成为负责人
  await post('/share/apply', { name: '操作系统', teacher: '钱老师' }, token('B'))
  await post('/admin/share/decision', { key: KEY, xh: 'shareB0002', approve: true }, admin.token)
  check('B 成为课程负责人', true)

  // A（成员）投稿作业
  const sub1 = await post('/board/assignment/submit', { key: KEY, title: '补充：Lab1 加做银行家算法', deadline: '2026-11-08T23:59', requirement: '选做加分' }, token('A'))
  check('成员投稿作业 → 待审', sub1.ok)
  // A 投稿附件
  const up = await fetch(base + '/board/file/submit?key=' + encodeURIComponent(KEY) + '&name=' + encodeURIComponent('同学笔记.md'), { method: 'PUT', headers: { Authorization: 'Bearer ' + token('A') }, body: 'MEMBER-NOTE' }).then(j)
  check('成员投稿附件 → 待审', up.ok && !!up.id)

  // 负责人能看到待审队列
  const board0 = await get('/board?key=' + encodeURIComponent(KEY), token('B'))
  check('负责人可见待审作业+附件', board0.pendingAssignments.length === 1 && board0.pendingFiles.length === 1)
  // 上架前成员同步里没有
  check('上架前成员同步不含投稿', (await get('/sync', token('A'))).length === 0)
  // A 查自己的投稿
  const mine = await get('/board/submissions?key=' + encodeURIComponent(KEY), token('A'))
  check('成员可查自己的待审投稿', mine.assignments.length === 1 && mine.files.length === 1)

  // 非负责人不能审核
  const forbidden = await post('/board/assignment/review', { key: KEY, id: sub1.ok ? board0.pendingAssignments[0].id : 'x', approve: true }, token('A'))
  check('非负责人审核被 403', forbidden.error?.includes('仅课程负责人'))

  // 负责人：通过作业投稿 + 驳回附件投稿
  const r1 = await post('/board/assignment/review', { key: KEY, id: board0.pendingAssignments[0].id, approve: true }, token('B'))
  check('负责人通过作业投稿', r1.ok && r1.published)
  const r2 = await post('/board/file/review', { key: KEY, id: up.id, approve: false }, token('B'))
  check('负责人驳回附件投稿', r2.ok && !r2.published)

  // 上架后成员同步可见作业；驳回的附件不在板里且文件已删
  const sync = await get('/sync', token('A'))
  check('上架后成员同步含投稿作业', sync.length === 1 && sync[0].assignments[0].title.includes('银行家算法'))
  const board1 = await get('/board?key=' + encodeURIComponent(KEY), token('B'))
  check('驳回后队列清空且未入板', board1.pendingAssignments.length === 0 && board1.pendingFiles.length === 0 && board1.files.length === 0)

  // 重复审核 → 404
  const again = await post('/board/assignment/review', { key: KEY, id: board0.pendingAssignments[0].id, approve: true }, token('B'))
  check('重复审核返回 404', again.error?.includes('不存在'))

  console.log(results.join('\n'))
  console.log(results.every(r => r.startsWith('✅')) ? '\n=== 全部通过 ===' : '\n=== 存在失败项 ===')
  if (!results.every(r => r.startsWith('✅'))) process.exitCode = 1
})
