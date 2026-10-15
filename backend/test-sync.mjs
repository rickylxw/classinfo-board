/* 数据同步「服务器权威」语义测试：隔离实例自动起停（test-util.mjs），不碰生产数据。
 * 运行：node backend/test-sync.mjs
 */
import { withTestServer } from './test-util.mjs'

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log('  ✅', name)) : (fail++, console.log('  ❌', name)) }

await withTestServer({ U: { xh: 'itest01' } }, async ({ base, token }) => {
  const TOKEN = token('U')
  const req = (path, method = 'GET', body) => fetch(base + path, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const jbody = async r => { try { return await r.json() } catch { return null } }
  const ids = list => (list || []).map(x => x.id).sort().join(',')

  const c1 = { id: 'c1', name: '高等数学', teacher: '张三', semester: '2026-2027-1' }
  const c2 = { id: 'c2', name: '大学英语', teacher: '李四', semester: '2026-2027-1' }
  const c3 = { id: 'c3', name: '数据结构', teacher: '王五', semester: '2026-2027-1' }
  const a1 = { id: 'a1', courseId: 'c1', title: '第一章习题', deadline: '2026-10-20', status: 'pending' }

  console.log('— 鉴权 —')
  {
    const r = await fetch(base + '/data')
    ok(r.status === 401, '无 token 访问 /data 被 401 拒绝')
    const r2 = await fetch(base + '/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    ok(r2.status === 401, '无 token 推送 /data 被 401 拒绝')
  }

  console.log('— 首次推送与权威回读 —')
  {
    const r = await req('/data', 'PUT', { courses: [c1, c2], assignments: [a1], files: [], syncStatus: {} })
    const b = await jbody(r)
    ok(r.status === 200 && b.ok, 'PUT /data 成功')
    ok(ids(b.data?.courses) === 'c1,c2', '响应携带合并后的权威状态（2 门课）')
    ok(b.data?.assignments?.length === 1, '响应包含 1 项作业')
    const g = await jbody(await req('/data'))
    ok(ids(g.courses) === 'c1,c2' && g.assignments?.length === 1, 'GET /data 与推送结果一致')
  }

  console.log('— 核心规则：客户端不能覆盖/清空服务端 —')
  {
    // 空整包推送（旧版语义下会把云端清空）
    const r = await req('/data', 'PUT', { courses: [], assignments: [], files: [] })
    const b = await jbody(r)
    ok(ids(b.data?.courses) === 'c1,c2' && b.data?.assignments?.length === 1, '空整包推送后云端数据原样保留')
    // 缺字段推送
    const b2 = await jbody(await req('/data', 'PUT', { courses: [] }))
    ok(ids(b2.data?.courses) === 'c1,c2', '缺 assignments/files 字段的推送同样不清空云端')
    // 本机内容比云端少（陈旧客户端不知道 c2）
    const b3 = await jbody(await req('/data', 'PUT', { courses: [c1], assignments: [a1], files: [] }))
    ok(ids(b3.data?.courses) === 'c1,c2', '陈旧客户端缺少的条目不会被删除')
  }

  console.log('— 增改合并 —')
  {
    const c1v2 = { ...c1, teacher: '张三丰' }
    const r = await req('/data', 'PUT', { courses: [c1v2, c3], assignments: [], files: [] })
    const b = await jbody(r)
    ok(b.data.courses.find(x => x.id === 'c1')?.teacher === '张三丰', '同 id 条目按客户端修改更新')
    ok(ids(b.data.courses) === 'c1,c2,c3', '新条目被加入且云端已有条目保留')
  }

  console.log('— 登录合并（只增不改） —')
  {
    const c1stale = { ...c1, teacher: '过期的张三' }   // 陈旧副本不应回退云端
    const c4 = { id: 'c4', name: '概率统计', teacher: '赵六', semester: '2026-2027-1' }
    const r = await req('/data/merge-local', 'POST', { courses: [c1stale, c4], assignments: [] })
    const b = await jbody(r)
    ok(b.data.courses.find(x => x.id === 'c4')?.name === '概率统计', '本机独有条目被并入云端')
    ok(b.data.courses.find(x => x.id === 'c1')?.teacher === '张三丰', '云端已有条目不被本机陈旧副本回退')
    ok(ids(b.data.courses) === 'c1,c2,c3,c4', '合并后无丢失')
  }

  console.log('— 显式白名单删除 —')
  {
    const r = await req('/data/delete', 'POST', { courses: ['c3'], assignments: ['不存在'] })
    const b = await jbody(r)
    ok(ids(b.data.courses) === 'c1,c2,c4', '只删除列出的 id，其余保留')
    ok(b.data.assignments?.length === 1, '未提及的集合不受影响')
    const b2 = await jbody(await req('/data/delete', 'POST', { assignments: ['a1'] }))
    ok(b2.data.assignments?.length === 0, '删除作业条目生效')
  }

  console.log('— 示例数据防护 —')
  {
    const r = await req('/data', 'PUT', {
      courses: [{ id: 'c-demo', name: '示例：数据结构（可删除）', teacher: '王老师' }],
      assignments: [{ id: 'a-demo1', courseId: 'c-demo', title: 'Lab1' }, { id: 'ax', courseId: 'c-demo', title: '真实作业', sample: true }],
      files: [{ id: 'f-demo1', courseId: 'c-demo', kind: 'link', name: '示例链接' }]
    })
    const b = await jbody(r)
    ok(!b.data.courses.some(x => x.id === 'c-demo'), '示例课程不入云')
    ok(!b.data.assignments.some(x => x.id === 'a-demo1' || x.sample === true), '示例作业与 sample 标记条目不入云')
    ok(!b.data.files.some(x => x.id === 'f-demo1'), '示例文件不入云')
  }

  console.log('— syncStatus 合并 —')
  {
    const b = await jbody(await req('/data', 'PUT', { syncStatus: { 'board-x': 'done' } }))
    ok(b.data.syncStatus['board-x'] === 'done', '推送的完成状态被记录')
    const b2 = await jbody(await req('/data/merge-local', 'POST', { syncStatus: { 'board-y': 'archived' } }))
    ok(b2.data.syncStatus['board-x'] === 'done' && b2.data.syncStatus['board-y'] === 'archived', '云端多出的状态 key 保留、本机 key 并入')
  }

  console.log('— /data/ops 细粒度操作批次 —')
  {
    const r = await req('/data/ops', 'POST', { ops: [
      { op: 'upsert', coll: 'courses', items: [{ id: 'c10', name: '操作系统', teacher: '钱七' }] },
      { op: 'upsert', coll: 'assignments', items: [{ id: 'a10', courseId: 'c10', title: 'Lab1' }] },
      { op: 'syncStatus', entries: { bd1: 'done' } }
    ] })
    const b = await jbody(r)
    ok(b.data.courses.some(x => x.id === 'c10') && b.data.assignments.some(x => x.id === 'a10'), 'ops 批量 upsert 生效')
    ok(b.data.syncStatus.bd1 === 'done', 'ops syncStatus 生效')
    const b2 = await jbody(await req('/data/ops', 'POST', { ops: [
      { op: 'upsert', coll: 'courses', items: [{ id: 'c11', name: '临时课' }] },
      { op: 'delete', coll: 'courses', ids: ['c11'] }
    ] }))
    ok(!b2.data.courses.some(x => x.id === 'c11'), '同批 upsert+delete 按序应用（净删除）')
    const b3 = await jbody(await req('/data/ops', 'POST', { ops: [
      { op: 'upsert', coll: 'courses', items: [{ id: 'c10', name: '操作系统', teacher: '钱八' }] }
    ] }))
    ok(b3.data.courses.find(x => x.id === 'c10')?.teacher === '钱八', 'ops upsert 更新已有条目')
    const b4 = await jbody(await req('/data/ops', 'POST', { ops: [
      { op: 'upsert', coll: 'hacker', items: [{ id: 'hx' }] },
      { op: 'upsert', coll: 'courses', items: [{ id: 'c-demo', name: '示例' }] },
      { op: 'syncStatus', entries: JSON.parse('{"__proto__":{"x":1},"bad":"done"}') }
    ] }))
    ok(!b4.data.courses.some(x => x.id === 'hx' || x.id === 'c-demo'), '非法 coll 与示例 id 被忽略')
    ok(b4.data.syncStatus.bad === 'done' && !JSON.stringify(b4.data.syncStatus).includes('"x":1') && Object.prototype.x === undefined, 'syncStatus 原型污染键被过滤、普通键正常写入')
    const b5 = await jbody(await req('/data/ops', 'POST', { ops: [] }))
    ok(b5?.ok === true, '空批次安全返回')
  }

  console.log('— 应用密码登录 —')
  {
    const me0 = await jbody(await fetch(base + '/auth/me', { headers: { Authorization: 'Bearer ' + TOKEN } }))
    ok(me0.xh === 'itest01' && me0.hasPassword === false, '/auth/me 返回 hasPassword=false')
    const noPw = await fetch(base + '/auth/password-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xh: 'itest01', password: 'whatever' }) })
    ok(noPw.status === 404, '未设密码账号密码登录被 404 拒绝')
    const set1 = await req('/auth/set-password', 'POST', { next: 'testpw123' })
    ok(set1.status === 200, '设置应用密码成功')
    const wrong = await fetch(base + '/auth/password-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xh: 'itest01', password: 'wrong!' }) })
    ok(wrong.status === 401, '密码错误被 401 拒绝')
    const right = await fetch(base + '/auth/password-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xh: 'itest01', password: 'testpw123' }) })
    const rb = await jbody(right)
    ok(right.status === 200 && rb.token && rb.xh === 'itest01', '密码正确登录成功并颁发会话')
    const me2 = await jbody(await fetch(base + '/auth/me', { headers: { Authorization: 'Bearer ' + rb.token } }))
    ok(me2.xh === 'itest01' && me2.hasPassword === true, '新会话有效且 hasPassword=true')
    const chg = await req('/auth/set-password', 'POST', { current: 'bad', next: 'newpw456' })
    ok(chg.status === 401, '改密码时当前密码错误被 401 拒绝')
    const chg2 = await req('/auth/set-password', 'POST', { current: 'testpw123', next: 'newpw456' })
    ok(chg2.status === 200, '改密码成功（需当前密码）')
    const relog = await jbody(await fetch(base + '/auth/password-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xh: 'itest01', password: 'newpw456' }) }))
    ok(!!relog.token, '新密码可登录')
  }
})

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
