/* CLH 课件助手云同步端点测试：/api/clh-data GET/PUT（隔离实例，不触碰生产数据） */
import { withTestServer } from './test-util.mjs'

let pass = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg) } else { console.error('  ✗', msg); process.exitCode = 1 } }

await withTestServer(
  { A: { xh: 'clhA000001' }, B: { xh: 'clhB000002' } },
  async ({ base, token }) => {
    const get = (t) => fetch(base + '/clh-data', { headers: t ? { Authorization: 'Bearer ' + t } : {} })
    const put = (t, body) => fetch(base + '/clh-data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: JSON.stringify(body)
    })

    // 1. 无 token → 401
    ok((await get()).status === 401, 'GET 无 token → 401')
    ok((await put(null, {})).status === 401, 'PUT 无 token → 401')

    // 2. 从未同步 → 200 + null
    const r0 = await get(token('A'))
    ok(r0.status === 200 && (await r0.json()) === null, '首次 GET → 200 null')

    // 3. PUT 整包 → ok；GET 回读一致
    const payload = { courses: [{ id: 'c1', name: '高等数学', decks: [{ id: 'd1', name: '第一章' }] }], attempts: [], savedAt: 1 }
    const r1 = await put(token('A'), payload)
    ok(r1.status === 200 && (await r1.json()).ok === true, 'PUT → ok')
    const r2 = await get(token('A'))
    const back = await r2.json()
    ok(back?.courses?.[0]?.id === 'c1', 'GET 回读整包一致')

    // 4. 按学号隔离：B 看不到 A 的数据
    const r3 = await get(token('B'))
    ok((await r3.json()) === null, 'B 的 GET → null（按学号隔离）')

    // 5. 非法 JSON → 400
    const r4 = await fetch(base + '/clh-data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token('A') },
      body: 'not-json'
    })
    ok(r4.status === 400, 'PUT 非法 JSON → 400')
  }
)

console.log(`\n通过 ${pass} 项断言`)
