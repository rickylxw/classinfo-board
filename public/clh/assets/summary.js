/* ============================================================
 * summary.js — 把解析出的幻灯片内容整理成思维导图树
 * 暴露 window.SummaryBuilder：
 *   buildTree(slides, deckTitle, opts)  本地规则总结
 *   outlineText(slides, opts)           供 AI 的纯文本大纲
 *   normalizeAITree(json)               校验/规范化 AI 返回的树
 * 节点结构：{ id, name, children: [], slideNo? }
 * ============================================================ */
(function () {
  'use strict';

  let uid = 0;
  function newNode(name, slideNo) {
    return { id: ++uid, name, children: [], slideNo: slideNo || undefined };
  }

  /** 精简一句话：在标点处截断，超长加省略号 */
  function condense(text, max = 22) {
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const head = t.slice(0, max + 8);
    const m = head.match(/^(.{6,}?)[，。；：、！？,.;:!?）)]/);
    if (m) return m[1];
    return t.slice(0, max) + '…';
  }

  /** 单页 → 一个分支节点（按 bullet 层级嵌套） */
  function slideToBranch(slide, opts) {
    const name = slide.title || `第 ${slide.index} 页`;
    const branch = newNode(opts.condense ? condense(name) : name, slide.index);

    const stack = [branch];
    for (const it of slide.items) {
      const lvl = Math.min(it.lvl || 0, 4);
      stack.length = Math.min(stack.length, lvl + 1);
      const parent = stack[stack.length - 1];
      const node = newNode(opts.condense ? condense(it.text) : it.text, slide.index);
      parent.children.push(node);
      stack.push(node);
    }

    if (opts.includeNotes && slide.notes) {
      branch.children.push(newNode('📝 ' + condense(slide.notes, 60), slide.index));
    }
    return branch;
  }

  /**
   * 本地规则总结：根节点 = 课件标题，每页 = 一条一级分支
   * @param {Array} slides  PPTXParser 输出
   * @param {string} deckTitle  文档属性里的标题
   * @param {{condense?:boolean, includeNotes?:boolean, fallbackName?:string}} opts
   */
  function buildTree(slides, deckTitle, opts = {}) {
    const firstTitle = slides.find(s => s.title);
    const rootName = deckTitle || (firstTitle && firstTitle.title) || opts.fallbackName || '课件导图';
    const root = newNode(rootName);
    for (const s of slides) root.children.push(slideToBranch(s, opts));
    return root;
  }

  /** 供 AI 总结用的纯文本大纲（控制总长度） */
  function outlineText(slides, maxTotal = 9000) {
    const parts = [];
    let total = 0;
    for (const s of slides) {
      let block = `【第${s.index}页】${s.title || '（无标题）'}`;
      for (const it of s.items) block += '\n' + '  '.repeat(Math.min(it.lvl || 0, 3)) + '- ' + it.text;
      if (s.notes) block += '\n  [备注] ' + s.notes;
      total += block.length;
      if (total > maxTotal) { parts.push('（内容过长，已截断）'); break; }
      parts.push(block);
    }
    return parts.join('\n\n');
  }

  /** 规范化 AI 返回的树，生成新 id */
  function normalizeAITree(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('AI 返回内容无法解析');
    const walk = (n, depth) => ({
      id: ++uid,
      name: String(n.name || n.title || '节点').replace(/\s+/g, ' ').trim().slice(0, 80) || '节点',
      children: depth >= 5 || !Array.isArray(n.children)
        ? []
        : n.children.slice(0, 20).map(c => walk(typeof c === 'string' ? { name: c } : c, depth + 1)),
    });
    const tree = walk(raw.name ? raw : (raw.root || raw.mindmap || {}), 0);
    if (!tree.children.length) throw new Error('AI 返回的导图为空');
    return tree;
  }

  /** 重新编号（本地/AI 切换后保持 id 唯一） */
  function renumber(tree) {
    uid = 0;
    (function walk(n) { n.id = ++uid; (n.children || []).forEach(walk); })(tree);
    return tree;
  }

  window.SummaryBuilder = { buildTree, outlineText, normalizeAITree, renumber, condense };
})();
