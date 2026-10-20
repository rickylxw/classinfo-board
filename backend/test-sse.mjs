/* 共享板 SSE 实时广播测试：隔离实例自动起停（test-util.mjs），不碰生产数据。
 * 运行：node backend/test-sse.mjs（心跳用例需等待 ~26 秒）
 */
import { withTestServer } from './test-util.mjs'

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log('  ✅', name)) : (fail++, console.log('  ❌', name)) }

const KEY = '操作系统|钱老师'

/* 建立一条 SSE 连接，返回 { next() } 帧队列读取器（帧：'sync' | 'ka' | 'closed' | 'other:…'） */
async function connect(base, token, { signal } = {}) {
  const r = await fetch(base + '/events?token=' + encodeURIComponent(token), { signal })
  if (r.status !== 200) throw new Error('SSE 建立失败：HTTP ' + r.status)
  const queue = []
  let waiter = null
  const push = f => { if (waiter) { const w = waiter; waiter = null; w(f) } else queue.push(f) }
  ;(async () => {
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i).trim()
        buf = buf.slice(i + 2)
        push(frame === ': ka' ? 'ka' : frame.startsWith('event: sync') ? 'sync' : 'other:' + frame)
      }
    }
    push('closed')
  })().catch(e => push(e.name === 'AbortError' ? 'closed' : 'error:' + e.message))
  const next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise(res => { waiter = res }))
  return { next }
}
/* 等待指定帧出现；期间跳过其他帧（心跳等） */
async function waitFor(client, type, ms) {
  for (;;) {
    const f = await Promise.race([client.next(), new Promise(r => setTimeout(() => r('timeout'), ms))])
    if (f === type) return true
    if (f === 'timeout' || f === 'closed' || f === undefined) return false
  }
}

await withTestServer({
  A: { xh: 'sseA0001', data: { courses: [{ id: 'cA', name: '操作系统', teacher: '钱老师', semester: '2026-2027-1' }], assignments: [], files: [] } },
  B: { xh: 'sseB0002' }
}, async ({ base, adminPass, token }) => {
  const j = r => r.json()
  const post = (p, body, tk) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) }, body: JSON.stringify(body) }).then(j)

  console.log('— 鉴权 —')
  let adminToken = ''
  {
    const bad = await fetch(base + '/events?token=not-a-real-token')
    ok(bad.status === 401, '无效 token 返回 401（非流式）')
    const admin = await post('/auth/admin-login', { username: 'admin', password: adminPass })
    adminToken = admin.token
    // 管理员会话可挂实时流（管理台投稿审核的实时刷新依赖），且确实收到广播
    const asAdmin = await fetch(base + '/events?token=' + adminToken)
    ok(asAdmin.status === 200, '管理员会话可建立实时流')
    const reader = asAdmin.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    const t0 = await post('/board/group/save', { key: KEY, group: { type: 'QQ群', num: '000 111' } }, adminToken)
    ok(t0.ok, '管理员触发一次共享板变更')
    let got = false
    const deadline = Date.now() + 1000
    while (Date.now() < deadline && !got) {
      const { done, value } = await Promise.race([reader.read(), new Promise(r => setTimeout(() => r({ done: true, value: undefined }), deadline - Date.now()))])
      if (done) break
      buf += dec.decode(value, { stream: true })
      if (buf.includes('event: sync')) got = true
    }
    ok(got, '管理员流 1 秒内收到 event: sync')
    await reader.cancel().catch(() => {})
  }

  console.log('— 连接与广播 —')
  const ac = new AbortController()
  const ca = await connect(base, token('A'), { signal: ac.signal })
  const cb = await connect(base, token('B'))
  ok(true, '两个用户会话各建立一条连接（多标签页多连接）')

  {
    // 账号数据变更不应广播
    await fetch(base + '/data/ops', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token('A') }, body: JSON.stringify({ ops: [{ op: 'upsert', coll: 'assignments', items: [{ id: 'ax1', courseId: 'cA', title: '个人作业' }] }] }) })
    ok(!(await waitFor(ca, 'sync', 2000)), '账号数据变更（/data/ops）不触发广播')
  }

  {
    const admin = await post('/auth/admin-login', { username: 'admin', password: adminPass })
    const t0 = Date.now()
    const r = await post('/board/group/save', { key: KEY, group: { type: 'QQ群', num: '123 456' } }, admin.token)
    ok(r.ok, '管理员保存共享板教学群（触发 saveShares）')
    const aGot = await waitFor(ca, 'sync', 1000)
    ok(aGot, 'A 在 1 秒内收到 event: sync')
    const bGot = await waitFor(cb, 'sync', 1000)
    ok(bGot, 'B 同样收到广播')
    if (aGot) console.log(`    （实测延迟约 ${Date.now() - t0}ms）`)
  }

  console.log('— 心跳与断连 —')
  ok(await waitFor(ca, 'ka', 30000), '30 秒内收到心跳注释 : ka')

  {
    ac.abort()   // A 断开
    await new Promise(r => setTimeout(r, 300))
    const admin = await post('/auth/admin-login', { username: 'admin', password: adminPass })
    await post('/board/group/save', { key: KEY, group: { type: 'QQ群', num: '654 321' } }, admin.token)
    ok(await waitFor(cb, 'sync', 1000), 'A 断开后服务器仍健康，B 正常收到后续广播（无泄漏导致失灵）')
  }
})

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
