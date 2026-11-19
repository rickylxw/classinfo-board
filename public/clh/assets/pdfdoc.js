/* ============================================================
 * pdfdoc.js — 解析 .pdf 课件（PDF.js），输出与 pptx.js 相同的结构
 * 暴露 window.PDFParser.parsePdf(file, {onProgress, fallbackName})
 *   → { title, slides: [{ index, title, items:[{text,lvl}], notes:'', hasTable:false }] }
 * 行还原：按 transform 坐标把文本碎片聚合为行；标题 = 页内最大字号行；
 * 页码行（纯数字 / 第x页）自动过滤。
 * ============================================================ */
(function () {
  'use strict';

  if (window.pdfjsLib) {
    try { pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js'; } catch (e) { /* file:// 自动回退假 worker */ }
  }

  const isJunkLine = t =>
    !t || /^\d{1,4}$/.test(t) || /^第\s*\d+\s*页$/.test(t) || /^-\s*\d+\s*-$/.test(t);
  const needsSpace = (prevTail, nextHead) =>
    /[A-Za-z0-9)$%]/.test(prevTail) && /^[A-Za-z0-9($]/.test(nextHead);

  /** 把 pdf.js 文本碎片按 y 坐标聚合成行：[{ y, h, text }] */
  function groupLines(items) {
    const raw = [];
    for (const it of items) {
      const s = String(it.str || '').replace(/\s+/g, ' ').trim();
      if (!s) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.abs(it.height || Math.hypot(it.transform[1], it.transform[3]) || 12) || 12;
      raw.push({ s, x, y, h });
    }
    raw.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of raw) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= Math.max(2, last.h * 0.5)) {
        const tail = last.text.slice(-1), head = it.s.slice(0, 1);
        last.text += (needsSpace(tail, head) ? ' ' : '') + it.s;
        last.h = Math.max(last.h, it.h);
      } else {
        lines.push({ y: it.y, h: it.h, text: it.s });
      }
    }
    return lines;
  }

  /** 行 → { title, rest[] }：最大字号行作标题（过长则降级为普通行） */
  function pickTitle(lines) {
    if (!lines.length) return { title: '', rest: [] };
    const candidates = lines.filter(l => !isJunkLine(l.text));
    if (!candidates.length) return { title: '', rest: [] };
    const sorted = [...candidates].sort((a, b) => b.h - a.h);
    const big = sorted[0];
    let title = big.text.replace(/\s+/g, ' ').trim();
    const rest = candidates.filter(l => l !== big).map(l => l.text.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!title || title.length > 50) {
      rest.unshift(title);                 // 过长的“大字行”多半是正文，还原回去
      title = '';
    }
    return { title, rest };
  }

  async function parsePdf(file, opts = {}) {
    const onProgress = opts.onProgress || (() => {});
    if (!window.pdfjsLib) throw new Error('PDF 解析引擎未加载');
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const n = doc.numPages;
    const slides = [];
    let firstTitle = '';

    for (let i = 1; i <= n; i++) {
      onProgress(i, n);
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const lines = groupLines(tc.items);
      const { title, rest } = pickTitle(lines);
      if (i === 1 && title) firstTitle = title;
      const items = rest.map(t => ({ text: t, lvl: 0 }));
      if (!title && !items.length) {
        slides.push({ index: i, title: `第 ${i} 页（无文本，可能为图片/扫描页）`, items: [], notes: '', hasTable: false });
      } else {
        slides.push({ index: i, title: title || `第 ${i} 页`, items, notes: '', hasTable: false });
      }
      try { page.cleanup(); } catch (e) { /* 忽略 */ }
    }

    let metaTitle = '';
    try {
      const meta = await doc.getMetadata();
      metaTitle = String((meta && meta.info && meta.info.Title) || '').trim();
    } catch (e) { /* 无元数据 */ }

    const title = metaTitle || firstTitle || opts.fallbackName || '';
    return { title: title.slice(0, 80), slides };
  }

  window.PDFParser = { parsePdf };
})();
