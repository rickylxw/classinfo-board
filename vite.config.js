import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// strictPort：5173 被占用时直接报错，避免悄悄换端口导致浏览器本地数据"消失"
// host: true 监听 0.0.0.0，局域网内其他设备可通过 http://<本机IP>:5173 访问
// /api 代理到本地后端（backend/server.mjs，仅监听 127.0.0.1:5174），外machines 只接触 5173
export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // dev 环境安全头（不含 CSP：HMR 需要内联脚本，完整 CSP 由生产入口 server.mjs 提供）
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'no-referrer'
    },
    proxy: {
      // xfwd：把真实客户端 IP 追加到 X-Forwarded-For，后端按它做登录限速
      '/api': { target: 'http://127.0.0.1:5174', xfwd: true }
    }
  }
})
