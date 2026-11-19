/* ============================================================
 * pptx.js — 在浏览器中解析 .pptx（OOXML），提取每页标题/大纲/备注
 * 依赖：JSZip（lib/jszip.min.js），暴露 window.PPTXParser
 * ============================================================ */
(function () {
  'use strict';

  const parser = new DOMParser();

  function decodeEntities(s) {
    // DOMParser 解析后 textContent 已自动反转义，这里只做兜底
    return String(s == null ? '' : s);
  }

  /** 读 zip 内文本文件 */
  async function readText(zip, path) {
    const f = zip.file(path);
    return f ? f.async('string') : '';
  }

  /** 从 docProps/core.xml 取文档标题 */
  async function readCoreTitle(zip) {
    const xml = await readText(zip, 'docProps/core.xml');
    if (!xml) return '';
    const m = xml.match(/<dc:title>([\s\S]*?)<\/dc:title>/i);
    return m ? decodeEntities(m[1].trim()) : '';
  }

  /** presentation.xml + rels → 按真实顺序排列的 slide 文件路径 */
  async function readSlideOrder(zip) {
    const relMap = {};
    const relsXml = await readText(zip, 'ppt/_rels/presentation.xml.rels');
    if (relsXml) {
      for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
        const tag = m[0];
        const id = (tag.match(/ Id="([^"]+)"/) || [])[1];
        const target = (tag.match(/ Target="([^"]+)"/) || [])[1];
        if (id && target) relMap[id] = target;
      }
    }
    const ordered = [];
    const presXml = await readText(zip, 'ppt/presentation.xml');
    if (presXml) {
      for (const m of presXml.matchAll(/<p:sldId\b[^>]*>/g)) {
        const rid = (m[0].match(/r:id="([^"]+)"/) || [])[1];
        const target = rid && relMap[rid];
        if (target) ordered.push(normalizePath('ppt/presentation.xml', target));
      }
    }
    const valid = ordered.filter(p => zip.file(p));
    if (valid.length) return valid;
    // 兜底：直接枚举并按数字排序
    return Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => num(a) - num(b));
  }

  function num(path) {
    return parseInt((path.match(/slide(\d+)\.xml$/) || [])[1] || '0', 10);
  }
  function normalizePath(base, target) {
    const parts = (base.split('/').slice(0, -1).join('/') + '/' + target).split('/');
    const out = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p && p !== '.') out.push(p);
    }
    return out.join('/');
  }

  /**
   * 解析单页 slide XML → { title, items:[{text,lvl}] }
   * 文本段落来自所有形状（含组合形状与表格），层级取 a:pPr@lvl
   */
  function parseSlideXml(xml) {
    const doc = parser.parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return { title: '', items: [] };

    let title = '';
    const items = [];
    const shapes = doc.getElementsByTagName('p:sp');

    for (const sp of shapes) {
      const txBody = sp.getElementsByTagName('p:txBody')[0];
      if (!txBody) continue;
      const ph = sp.getElementsByTagName('p:ph')[0];
      const phType = ph ? (ph.getAttribute('type') || '') : '';
      const isTitle = phType === 'title' || phType === 'ctrTitle';

      const paras = [];
      for (const p of txBody.getElementsByTagName('a:p')) {
        let text = '';
        for (const t of p.getElementsByTagName('a:t')) text += t.textContent;
        text = text.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const pPr = p.getElementsByTagName('a:pPr')[0];
        let lvl = parseInt((pPr && pPr.getAttribute('lvl')) || '0', 10);
        if (!Number.isFinite(lvl) || lvl < 0) lvl = 0;
        paras.push({ text, lvl });
      }
      if (!paras.length) continue;

      if (isTitle && !title) {
        title = paras.map(p => p.text).join(' ');
      } else {
        items.push(...paras);
      }
    }

    // 表格文字（每行合并为一项）
    let hasTable = false;
    for (const tbl of doc.getElementsByTagName('a:tbl')) {
      hasTable = true;
      for (const tr of tbl.getElementsByTagName('a:tr')) {
        const cells = [];
        for (const tc of tr.getElementsByTagName('a:tc')) {
          let text = '';
          for (const t of tc.getElementsByTagName('a:t')) text += t.textContent;
          text = text.replace(/\s+/g, ' ').trim();
          if (text) cells.push(text);
        }
        if (cells.length) items.push({ text: cells.join(' / '), lvl: 0 });
      }
    }

    // 无标题占位时：首个较短的一级段落当作标题
    if (!title && items.length && items[0].lvl === 0 && items[0].text.length <= 30) {
      title = items[0].text;
      items.shift();
    }
    return { title, items, hasTable };
  }

  /** 读取某页对应的演讲者备注 */
  async function readNotes(zip, slidePath) {
    const m = slidePath.match(/ppt\/slides\/(slide\d+\.xml)$/);
    if (!m) return '';
    const relsXml = await readText(zip, `ppt/slides/_rels/${m[1]}.rels`);
    if (!relsXml) return '';
    let target = '';
    for (const rel of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      if (/notesSlide/i.test(rel[0])) {
        target = (rel[0].match(/ Target="([^"]+)"/) || [])[1] || '';
        break;
      }
    }
    if (!target) return '';
    const notesPath = normalizePath(slidePath, target);
    const xml = await readText(zip, notesPath);
    if (!xml) return '';
    const doc = parser.parseFromString(xml, 'application/xml');
    let text = '';
    // 备注正文在类型为 body 的占位符里，这里直接取全部 a:t（过滤页码等数字占位）
    for (const t of doc.getElementsByTagName('a:t')) text += t.textContent;
    text = text.replace(/\s+/g, ' ').trim();
    return text.replace(/^\d+\s*/, '');
  }

  /**
   * 主入口：解析 .pptx 文件
   * @param {File} file
   * @param {{includeNotes?:boolean, onProgress?:Function}} opts
   * @returns {Promise<{title:string, slides:Array}>}
   */
  async function parsePptx(file, opts = {}) {
    const onProgress = opts.onProgress || (() => {});
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (e) {
      throw new Error('无法读取该文件，请确认是未加密的 .pptx 文件');
    }
    const slidePaths = await readSlideOrder(zip);
    if (!slidePaths.length) throw new Error('该文件中没有找到幻灯片');

    const title = await readCoreTitle(zip);
    const slides = [];
    for (let i = 0; i < slidePaths.length; i++) {
      onProgress(i + 1, slidePaths.length);
      const xml = await readText(zip, slidePaths[i]);
      const page = parseSlideXml(xml);
      const slide = { index: i + 1, title: page.title, items: page.items, hasTable: !!page.hasTable, notes: '' };
      if (opts.includeNotes) {
        slide.notes = await readNotes(zip, slidePaths[i]);
      }
      slides.push(slide);
    }
    return { title, slides };
  }

  window.PPTXParser = { parsePptx };
})();
