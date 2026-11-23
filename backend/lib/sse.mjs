// sse.mjs — SSE 实时广播通道
// 全局广播（sync 事件 = 共享板变更，前端收到重拉 /sync）+ 按账号定向广播（data 事件 =
// 账号数据变更，同账号跨设备实时；发起端自己也收到，由前端 ops 在途守卫跳过）。
// 连接表 { res, xh }；同一 token 多标签页多连接属正常；班级规模无需限流。
// res/req 挂 error 监听：向已断连接写入会触发流错误，无人接住会让整个进程崩溃。

const sseClients = new Set()
export const sseClientCount = () => sseClients.size

export function sseBroadcast() {
  const frame = `event: sync\ndata: {"t": ${Date.now()}}\n\n`
  for (const c of [...sseClients]) {
    try { c.res.write(frame) } catch (e) { sseClients.delete(c) }
  }
}

export function sseBroadcastTo(xh, event = 'data') {
  const frame = `event: ${event}\ndata: {"t": ${Date.now()}}\n\n`
  for (const c of [...sseClients]) {
    if (c.xh !== xh) continue
    try { c.res.write(frame) } catch (e) { sseClients.delete(c) }
  }
}

// 心跳 ≤25s：既保活也让代理不判定空闲断开；写失败即移除
setInterval(() => {
  for (const c of [...sseClients]) {
    try { c.res.write(': ka\n\n') } catch (e) { sseClients.delete(c) }
  }
}, 25 * 1000).unref()

/* 鉴权通过后的连接建立（保持连接，不 end；事件由 sseBroadcast/心跳写入） */
export function sseAttach(req, res, xh) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no'
  })
  const client = { res, xh }
  sseClients.add(client)
  // 断连清理（close）+ 流错误兜底（写已断连接会 async 抛错，无人接住进程会崩）
  let gone = false
  const cleanup = () => {
    if (gone) return
    gone = true
    sseClients.delete(client)
    console.log(`[sse] ${client.xh} 连接断开（当前 ${sseClients.size} 个）`)
  }
  req.on('close', cleanup)
  req.on('error', cleanup)
  res.on('error', cleanup)
  console.log(`[sse] ${client.xh} 建立实时连接（当前 ${sseClients.size} 个）`)
}
