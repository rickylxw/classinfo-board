// 生产模式静态服务器：npm run build 之后，node server.mjs 访问 http://localhost:5173
// 日常开发请直接使用 npm run dev（Vite 开发服务器）
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.PORT || 5173);

if (!existsSync(path.join(root, 'index.html'))) {
  console.error('未找到 dist/index.html，请先运行：npm run build');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm'
};

// 安全响应头：附加到静态文件与 /api 代理响应上（生产入口统一加固）
// CSP 说明：本应用全部资源同源自带，style 允许内联（Vue 样式绑定），图片放行 blob/data/远程
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: http: https:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
}

// /clh/*（并入的课件助手）专用头：其免构建 Vue 需 'unsafe-eval'，OCR 懒加载放行 jsdelivr，
// AI 接口直连放行 connect-src；且不能带 frame-ancestors 'none'（否则同源 iframe 嵌入被拒）
const CLH_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; connect-src 'self' https: http:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'"
};
const headersFor = p => (p === '/clh' || p.startsWith('/clh/')) ? CLH_SECURITY_HEADERS : SECURITY_HEADERS;

http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // /api 代理到后端（backend/server.mjs，端口 5174）
    if (p.startsWith('/api/')) {
      const xf = (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'] + ', ' : '') + req.socket.remoteAddress;
      const px = http.request({
        hostname: '127.0.0.1', port: 5174, path: req.url, method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:5174', 'x-forwarded-for': xf }
      }, pr => { res.writeHead(pr.statusCode, { ...pr.headers, ...SECURITY_HEADERS }); pr.pipe(res); });
      px.on('error', () => { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }); res.end('后端未启动：请先运行 node backend/server.mjs'); });
      req.pipe(px);
      return;
    }
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403, SECURITY_HEADERS); res.end('Forbidden'); return; }
    // 单页应用：未命中的路径回退到 index.html；/clh/* 是静态目录，缺文件直接 404（回退会把板子嵌进 iframe）
    let target = file;
    if (!existsSync(file)) {
      if (p === '/clh' || p.startsWith('/clh/')) { res.writeHead(404, headersFor(p)); res.end('404 Not Found'); return }
      target = path.join(root, 'index.html');
    } else {
      // 目录 → index.html（如 /clh/ 这类静态子站入口）
      try { if (statSync(target).isDirectory()) target = path.join(target, 'index.html') } catch { /* 忽略 */ }
    }
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', ...headersFor(p) });
    res.end(data);
  } catch {
    res.writeHead(404, SECURITY_HEADERS); res.end('404 Not Found');
  }
}).listen(port, () => {
  console.log(`📚 课程信息板已启动: http://localhost:${port}（/api → 5174 后端）`);
});
