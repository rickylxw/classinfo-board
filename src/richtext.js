/* 作业要求富文本：Markdown + 内嵌 HTML 渲染（净化防 XSS）+ cbimg:// 图片解析 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { blobGet } from './store'
import { session, fetchCloudFileBlob } from './api'

marked.setOptions({ breaks: true, gfm: true })

// 在默认 URI 白名单（http/https/mailto/data 等）基础上放行 cbimg:，
// 否则 img src 会被 DOMPurify 整个剥掉
const ALLOWED_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|cbimg):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

export function renderRich(text) {
  if (!text) return ''
  return DOMPurify.sanitize(marked.parse(text), { ALLOWED_URI_REGEXP: ALLOWED_URI })
}

/* cbimg://<文件id> → blob URL（本地 IndexedDB 优先，其次云端），带缓存 */
const urlCache = new Map()
const pending = new Map()

export async function resolveImage(id) {
  if (urlCache.has(id)) return urlCache.get(id)
  if (pending.has(id)) return pending.get(id)
  const p = (async () => {
    try {
      let blob = await blobGet(id).catch(() => null)
      if (!blob && session.token) blob = await fetchCloudFileBlob(id).catch(() => null)
      if (!blob) throw new Error('not found')
      const url = URL.createObjectURL(blob)
      urlCache.set(id, url)
      return url
    } finally {
      pending.delete(id)
    }
  })()
  pending.set(id, p)
  return p
}
