// 课程信息板 Service Worker（可选增强，仅 HTTPS 等安全上下文下才会注册生效；
// 局域网 http 部署时 main.js 不注册，本文件不产生任何影响）
// 策略：哈希静态资源/图标缓存优先，页面与其余请求网络优先、离线回缓存。
const CACHE = 'classinfo-v1'

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return // 接口永不缓存
  if (url.pathname === '/sw.js') return // 自身更新不走拦截

  // 开发服务器（Vite）的模块/HMR 路径绝不拦截：SW 若残留在 dev 源上，
  // 拦截这些请求会让 respondWith 的流不落定 → 页面永久挂死（已发生的事故）。
  // 直接 return = 交还浏览器原生处理。
  if (url.pathname.startsWith('/src/') || url.pathname.startsWith('/@') ||
      url.pathname.startsWith('/node_modules/')) return

  const cacheable = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')
  if (cacheable) {
    // 带内容哈希的构建产物：缓存优先；网络失败且无缓存 → 正常报错（不悬挂）
    e.respondWith((async () => {
      const hit = await caches.match(req)
      if (hit) return hit
      const res = await fetch(req)
      const cp = res.clone()
      caches.open(CACHE).then(c => c.put(req, cp))
      return res
    })())
    return
  }
  // 页面与其余静态文件：网络优先，断网回缓存。
  // respondWith 的 promise 必须保证落定：任何分支失败都转 Response.error()（正常报错而非悬挂）
  e.respondWith((async () => {
    try {
      // 导航请求重发用 url 而非原 Request（navigate 模式的 Request 不能直接复用）
      const res = await fetch(req.url, { headers: req.headers, credentials: 'same-origin' })
      const cp = res.clone()
      caches.open(CACHE).then(c => c.put(req, cp))
      return res
    } catch {
      const hit = await caches.match(req)
      if (hit) return hit
      if (req.mode === 'navigate') {
        const shell = await caches.match('/')
        if (shell) return shell
      }
      return Response.error()
    }
  })())
})
