// 生成 PWA 应用图标（纯 Node，零依赖：手写 PNG 编码 + 逐像素绘制）
// 用法：node scripts/make-icons.mjs   输出到 public/icons/
// 设计：竖向渐变圆角方块（主题紫）+ 白色打开书本剪影，中缝留缝区分左右页
import zlib from 'node:zlib'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- 绘制（设计坐标 0..100，4x4 超采样抗锯齿） ---------- */
function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r
}
function inPolygon(px, py, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// 书本剪影：中缝在 x=49/51 之间留缝；scale 围绕中心缩放（maskable 安全区）
const PAGE_L = [[20, 32], [49, 42], [49, 74], [20, 64]]
const PAGE_R = [[80, 32], [51, 42], [51, 74], [80, 64]]
const TOP = [0x5f, 0x62, 0xf5], BOT = [0x42, 0x45, 0xcf]

function drawIcon(size, { rounded = true, glyphScale = 1, glyphOnly = false, circle = false } = {}) {
  const K = 4 // 每边超采样数
  const buf = Buffer.alloc(size * size * 4)
  const scale = (p) => 50 + (p - 50) * glyphScale
  const l = PAGE_L.map(([x, y]) => [scale(x), scale(y)])
  const r = PAGE_R.map(([x, y]) => [scale(x), scale(y)])
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCov = 0, glyphCov = 0
      for (let sy = 0; sy < K; sy++) {
        for (let sx = 0; sx < K; sx++) {
          const ux = ((x + (sx + 0.5) / K) / size) * 100
          const uy = ((y + (sy + 0.5) / K) / size) * 100
          if (circle && Math.hypot(ux - 50, uy - 50) > 50) continue
          if (rounded && sdRoundBox(ux, uy, 50, 50, 50, 50, 22) > 0) continue
          bgCov++
          if (inPolygon(ux, uy, l) || inPolygon(ux, uy, r)) glyphCov++
        }
      }
      const t = y / size
      const br = bgCov ? Math.round(TOP[0] + (BOT[0] - TOP[0]) * t) : 0
      const bgG = bgCov ? Math.round(TOP[1] + (BOT[1] - TOP[1]) * t) : 0
      const bb = bgCov ? Math.round(TOP[2] + (BOT[2] - TOP[2]) * t) : 0
      const g = glyphCov / (K * K), b = glyphOnly ? g : bgCov / (K * K)
      const i = (y * size + x) * 4
      buf[i] = Math.round(255 * g + br * (1 - g))
      buf[i + 1] = Math.round(255 * g + bgG * (1 - g))
      buf[i + 2] = Math.round(255 * g + bb * (1 - g))
      buf[i + 3] = Math.round(255 * b)
    }
  }
  return encodePng(size, size, buf)
}

/* 启动屏：竖向渐变铺满 w×h，白色书本居中（贴 square 图标后合成） */
function drawSplash(w, h, glyphScale = 0.62) {
  const canvas = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    const t = y / h
    const r = Math.round(TOP[0] + (BOT[0] - TOP[0]) * t)
    const g = Math.round(TOP[1] + (BOT[1] - TOP[1]) * t)
    const b = Math.round(TOP[2] + (BOT[2] - TOP[2]) * t)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      canvas[i] = r; canvas[i + 1] = g; canvas[i + 2] = b; canvas[i + 3] = 255
    }
  }
  // 书本直接按大坐标系画在画布中央（比贴图少一次合成误差）
  const S = Math.min(w, h)
  const K = 3
  const scale = (p) => 50 + (p - 50) * glyphScale
  const l = PAGE_L.map(([x, y]) => [scale(x), scale(y)])
  const r2 = PAGE_R.map(([x, y]) => [scale(x), scale(y)])
  for (let y = 0; y < S; y++) {
    const cy = Math.floor((h - S) / 2) + y
    for (let x = 0; x < S; x++) {
      const cx = Math.floor((w - S) / 2) + x
      let cov = 0
      for (let sy = 0; sy < K; sy++) {
        for (let sx = 0; sx < K; sx++) {
          const ux = ((x + (sx + 0.5) / K) / S) * 100
          const uy = ((y + (sy + 0.5) / K) / S) * 100
          if (inPolygon(ux, uy, l) || inPolygon(ux, uy, r2)) cov++
        }
      }
      if (!cov) continue
      const gA = cov / (K * K)
      const i = (cy * w + cx) * 4
      canvas[i] = Math.round(255 * gA + canvas[i] * (1 - gA))
      canvas[i + 1] = Math.round(255 * gA + canvas[i + 1] * (1 - gA))
      canvas[i + 2] = Math.round(255 * gA + canvas[i + 2] * (1 - gA))
    }
  }
  return encodePng(w, h, canvas)
}

/* ---------- Android 启动图标 + 启动屏（node scripts/make-icons.mjs --android） ---------- */
function writeAndroid() {
  const res = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src', 'main', 'res')
  // 自适应图标：前景=白书(透明底,缩进安全区)，背景=主题紫纯色
  const DENS = [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]
  for (const [d, px, fg] of DENS) {
    mkdirSync(join(res, 'mipmap-' + d), { recursive: true })
    writeFileSync(join(res, 'mipmap-' + d, 'ic_launcher.png'), drawIcon(px))
    writeFileSync(join(res, 'mipmap-' + d, 'ic_launcher_round.png'), drawIcon(px, { rounded: false, circle: true }))
    writeFileSync(join(res, 'mipmap-' + d, 'ic_launcher_foreground.png'), drawIcon(fg, { rounded: false, glyphOnly: true, glyphScale: 0.8 }))
    console.log(`✓ mipmap-${d}: launcher ${px}px / foreground ${fg}px`)
  }
  mkdirSync(join(res, 'mipmap-anydpi-v26'), { recursive: true })
  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    writeFileSync(join(res, 'mipmap-anydpi-v26', name),
      `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`)
  }
  mkdirSync(join(res, 'values'), { recursive: true })
  writeFileSync(join(res, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#5457E5</color>
</resources>
`)
  // 启动屏（覆盖模板默认的 Capacitor 灰底 logo）：横竖全密度
  const SPL = { mdpi: 320, hdpi: 480, xhdpi: 640, xxhdpi: 960, xxxhdpi: 1280 }
  for (const [d, s] of Object.entries(SPL)) {
    mkdirSync(join(res, 'drawable-port-' + d), { recursive: true })
    mkdirSync(join(res, 'drawable-land-' + d), { recursive: true })
    writeFileSync(join(res, 'drawable-port-' + d, 'splash.png'), drawSplash(s, s * 2))
    writeFileSync(join(res, 'drawable-land-' + d, 'splash.png'), drawSplash(s * 2, s))
    console.log(`✓ splash-${d}: ${s}x${s * 2} + ${s * 2}x${s}`)
  }
  // 模板自带的默认矢量前景/背景已不再被引用
  for (const p of ['drawable/ic_launcher_background.xml', 'drawable-v24/ic_launcher_foreground.xml']) {
    try { rmSync(join(res, p)) } catch { /* 已不存在 */ }
  }
}

if (process.argv.includes('--android')) writeAndroid()

/* ---------- Web / PWA 图标（默认） ---------- */
if (!process.argv.includes('--android')) {
  mkdirSync(outDir, { recursive: true })
  const files = [
    ['icon-192.png', drawIcon(192)],
    ['icon-512.png', drawIcon(512)],
    // maskable：全出血 + 图形缩到安全区内（Android 圆形/异形裁切）
    ['maskable-512.png', drawIcon(512, { rounded: false, glyphScale: 0.82 })],
    // iOS 主屏图标：全出血方形（系统自己圆角）
    ['apple-touch-icon.png', drawIcon(180, { rounded: false, glyphScale: 0.88 })]
  ]
  for (const [name, png] of files) {
    writeFileSync(join(outDir, name), png)
    console.log('✓', name, (png.length / 1024).toFixed(1) + 'KB')
  }
}
