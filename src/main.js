import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')

// Service Worker：仅生产构建 + 安全上下文（HTTPS/localhost）注册；
// 其余环境（dev / 局域网 http）主动注销残留的 SW 并清空缓存——
// SW 会跨构建残留在源上，旧 fetch 处理器拦截请求会把页面永久挂死（已发生的事故），
// 这段自愈逻辑让注册过它的浏览器回到正常（等效于手动 F12 → Unregister）
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
} else if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      if (!regs.length) return
      await Promise.all(regs.map(r => r.unregister()))
      await Promise.all((await caches.keys()).map(k => caches.delete(k)))
      console.info('[sw] 已注销残留 Service Worker 并清理缓存')
    } catch { /* 忽略 */ }
  })
}
