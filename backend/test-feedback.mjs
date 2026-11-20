/* 用户反馈/故障上报端点测试：POST /feedback + /admin/feedback*（隔离实例，不触碰生产数据） */
import { withTestServer } from './test-util.mjs'

let pass = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg) } else { console.error('  ✗', msg); process.exitCode = 1 } }

await withTestServer(
  { A: { xh: 'fbA000001' }, B: { xh: 'fbB000002' } },
  async ({ base, adminPass, token }) => {
    const user = token('A')
    const authed = (t) => ({ 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) })

    // 1. 无 token → 401
    const r0 = await fetch(base + '/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x' }) })
    ok(r0.status === 401, '无 token → 401')

    // 2. 用户 token → 200 ok
    const r1 = await fetch(base + '/feedback', {
      method: 'POST', headers: authed(user),
      body: JSON.stringify({ type: 'bug', content: '日程页写日历失败', app: 'native-0.2.1(3)', device: 'Xiaomi 14 / Android 15' })
    })
    ok(r1.status === 200 && (await r1.json()).ok === true, '提交故障反馈 → 200 ok')

    // 3. 30 秒内再提交 → 429 限频
    const r2 = await fetch(base + '/feedback', { method: 'POST', headers: authed(user), body: JSON.stringify({ content: '第二条' }) })
    ok(r2.status === 429, '30 秒内重复提交 → 429')

    // 4. 空内容 → 400（用另一账号测，避开 A 的 30 秒限频窗口）
    const r2b = await fetch(base + '/feedback', { method: 'POST', headers: authed(token('B')), body: JSON.stringify({ content: '  ' }) })
    ok(r2b.status === 400, '空内容 → 400')

    // 5. 管理接口对普通用户 → 403
    const r3 = await fetch(base + '/admin/feedback', { headers: authed(user) })
    ok(r3.status === 403, '普通用户访问 /admin/feedback → 403')

    // 6. 管理员登录 → 列表 1 条 open，学号脱敏
    const lr = await fetch(base + '/auth/admin-login', { method: 'POST', headers: authed(), body: JSON.stringify({ username: 'admin', password: adminPass }) })
    const { token: adminToken } = await lr.json()
    const list1 = await (await fetch(base + '/admin/feedback', { headers: authed(adminToken) })).json()
    ok(list1.items.length === 1 && list1.items[0].status === 'open', '管理员 GET → 1 条 open')
    ok(list1.open === 1, 'open 计数 = 1')
    ok(list1.items[0].content === '日程页写日历失败', '内容一致')
    ok(list1.items[0].app === 'native-0.2.1(3)' && list1.items[0].device.includes('Xiaomi'), 'app/device 记录')
    ok(list1.items[0].xhMasked !== 'fbA000001' && list1.items[0].xhMasked.includes('****'), '学号脱敏展示')

    // 7. 标记已处理 → open=0
    const id = list1.items[0].id
    const r4 = await fetch(base + '/admin/feedback/update', { method: 'POST', headers: authed(adminToken), body: JSON.stringify({ id, status: 'resolved' }) })
    ok(r4.status === 200, '标记已处理 → 200')
    const list2 = await (await fetch(base + '/admin/feedback', { headers: authed(adminToken) })).json()
    ok(list2.items[0].status === 'resolved' && list2.open === 0, '状态已变 resolved、open=0')

    // 8. 删除 → 空
    const r5 = await fetch(base + '/admin/feedback/delete', { method: 'POST', headers: authed(adminToken), body: JSON.stringify({ id }) })
    ok(r5.status === 200, '删除 → 200')
    const list3 = await (await fetch(base + '/admin/feedback', { headers: authed(adminToken) })).json()
    ok(list3.items.length === 0 && list3.open === 0, '删除后列表为空')
  }
)

console.log(`\n通过 ${pass} 项断言`)
