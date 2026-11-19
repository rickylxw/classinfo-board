/* ============================================================
 * knowledge.js — 知识点 / 考点提取 + 题目识别与归类
 * 暴露 window.KnowledgeExtractor：
 *   extractLocal(slides)                    本地提取考点
 *   extractQuestions(slides)                本地识别题目（例题/习题/思考题…）
 *   linkQuestions(questions, points)        题目 → 知识点归类（同页优先+相似度）
 *   aiExtractAll(slides, deckTitle, cfg)    AI 一次提取 考点+题目（async）
 *   toMarkdown(points, deckTitle)           考点清单 Markdown
 *   toBoardJSON(title, points, questions)   Classinfo Board 导入格式
 * 考点：{ text, slideNo, stars(1-3), tags[] }
 * 题目：{ text, slideNo, type, points[] }（points 为关联知识点文本）
 * ============================================================ */
(function () {
  'use strict';

  // 考查信号：分值越高越像考点
  const RX = {
    exam:      /(考点|重点|必考|常考|高频|考试|真题|命题)/,
    metaHigh:  /(掌握|牢记|熟练)/,
    metaMid:   /(理解|熟悉|领会)/,
    metaLow:   /(了解|认识)/,
    definition: /(是指|指的是|定义为|的定义|称为|所谓|概念)/,
    compare:   /(区别|比较|对比|异同|优缺点|不同点|\bvs\b|\bVS\b)/,
    formula:   /(公式|O\s*\(|log|∑|∫|[≈≤≥=]|\d\s*[+\-*/×÷]\s*\d)/,
    summary:   /(小结|总结|要点回顾|本章要点|本章概要)/,
    exercise:  /(作业|习题|思考|练习|课后|讨论)/,
    enumTitle: /([一二三四五六七八九十]{1,3}|\d+)\s*(种|个|大类|类|方面)/,
  };
  const STARS_OF = { 高: 3, 中: 2, 低: 1 };

  // 题型信号（按顺序匹配，先具体后泛化）
  const Q_TYPES = [
    ['选择', /(选择题|选择正确|下列.{0,8}(说法|选项|哪个)|[（(]\s*[ABCD]\s*[)）]|A[．.、]\S)/],
    ['填空', /(_{2,}|＿{2,}|（\s*）|\(\s*\))/],
    ['判断', /(判断(对错|正误|以下)|是否正确)/],
    ['例题', /(^例\s*[：:0-9一二]|例题)/],
    ['计算', /(计算(?!机|器)|求.{0,12}(值|解|结果|复杂度)|推导|证明|求解)/],
    ['简答', /(简述|论述|说明|阐述|试析|简答)/],
    ['思考', /(思考|讨论|想一想|为什么|如何理解)/],
    ['习题', /(习题|作业|练习)/],
  ];
  // 题目高发页：标题本身指向题目
  const EX_SLIDE = /(作业|习题|思考|练习|例题|讨论|课堂测|随堂)/;

  function clean(t) { return String(t).replace(/\s+/g, ' ').trim(); }
  function norm(t) {
    return clean(t).toLowerCase()
      .replace(/[，。；：、！？,.;:!?（）()【】\[\]{}"'“”·—\-…\s]/g, '');
  }
  function bigrams(t) {
    const s = norm(t), set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }
  /** 二元组相似度：交集 / 较短集合大小 */
  function sim(a, b) {
    if (!a || !b) return 0;
    const A = bigrams(a), B = bigrams(b);
    let inter = 0;
    A.forEach(x => { if (B.has(x)) inter++; });
    return inter / Math.max(1, Math.min(A.size, B.size));
  }

  /* ---------------- 本地：考点提取 ---------------- */
  function extractLocal(slides) {
    const points = [];
    const push = (text, slideNo, stars, tags) => {
      text = clean(text).slice(0, 80);
      if (!text || stars < 1) return;
      points.push({ text, slideNo, stars, tags });
    };

    for (const s of slides || []) {
      const slidePts = [];

      // ---- 页级判断 ----
      if (s.title) {
        const tags = []; let stars = 0;
        if (RX.summary.test(s.title)) { stars = Math.max(stars, 2); tags.push('本章小结'); }
        if (RX.exercise.test(s.title)) { stars = Math.max(stars, 2); tags.push('课后练习'); }
        if (RX.compare.test(s.title)) { stars = Math.max(stars, 2); tags.push('对比'); }
        if (s.hasTable) { stars = Math.max(stars, 2); tags.push('对比表格'); }
        if (RX.enumTitle.test(s.title)) { stars = Math.max(stars, 1); tags.push('要点框架'); }
        if (stars) slidePts.push({ text: s.title, stars, tags });
      }

      // ---- 条目级判断（表格页只保留页级结论，行文本太碎）----
      if (!s.hasTable) {
        const scored = [];
        (s.items || []).forEach((it, i) => {
          if (s.title && norm(it.text) === norm(s.title)) return;
          let score = 0; const tags = [];
          if (RX.exam.test(it.text)) { score += 5; tags.push('考点词'); }
          if (RX.metaHigh.test(it.text)) { score += 4; tags.push('掌握要求'); }
          else if (RX.metaMid.test(it.text)) { score += 2; tags.push('理解要求'); }
          else if (RX.metaLow.test(it.text)) { score += 1; tags.push('了解要求'); }
          if (RX.definition.test(it.text)) { score += 2; tags.push('定义'); }
          if (RX.compare.test(it.text)) { score += 2; tags.push('对比'); }
          if (RX.formula.test(it.text)) { score += 2; tags.push('公式'); }
          if (RX.exercise.test(it.text)) { score += 2; tags.push('练习提示'); }
          let children = 0;
          for (let j = i + 1; j < s.items.length && (s.items[j].lvl || 0) > (it.lvl || 0); j++) children++;
          if (children >= 4) { score += 3; tags.push(`展开 ${children} 条`); }
          else if (children >= 2) { score += 2; tags.push(`展开 ${children} 条`); }
          if ((it.lvl || 0) === 0) score += 1;
          if (score >= 2) scored.push({ text: it.text, score, stars: score >= 6 ? 3 : score >= 4 ? 2 : 1, tags });
        });
        scored.sort((a, b) => b.score - a.score);
        slidePts.push(...scored.slice(0, 3));
      }

      for (const p of slidePts) push(p.text, s.index, p.stars, p.tags);
    }
    return points.sort((a, b) => a.slideNo - b.slideNo || b.stars - a.stars);
  }

  /* ---------------- 本地：题目识别 ---------------- */
  function detectType(text) {
    for (const [name, rx] of Q_TYPES) if (rx.test(text)) return name;
    return '';
  }

  function extractQuestions(slides) {
    const qs = [];
    for (const s of slides || []) {
      const isExSlide = EX_SLIDE.test(s.title || '');
      for (const it of s.items || []) {
        const t = clean(it.text);
        if (!t || /[:：]\s*$/.test(t)) continue;              // 冒号结尾是分组小标题，不是题目
        if (s.title && norm(t) === norm(s.title)) continue;
        if (s.hasTable) continue;                             // 表格行不当作题目
        if (/^(掌握|理解|了解|熟悉|领会|牢记|重点|难点|本章重点|本章难点|学习目标)[:：]?/.test(t)) continue; // 教学要求，不是题目
        const hasQM = /？|\?/.test(t);
        const type = detectType(t);
        const lvl = it.lvl || 0;
        // 子条目只有明确信号（问号 / 选择、填空、判断、例题）才算题目，避免步骤类误报
        const strongType = type && ['选择', '填空', '判断', '例题'].includes(type);
        if (lvl > 0 && !hasQM && !strongType) continue;
        if (hasQM || type || (isExSlide && lvl === 0)) {
          qs.push({ text: t.slice(0, 100), slideNo: s.index, type: type || (isExSlide ? '习题' : '思考'), points: [] });
        }
      }
    }
    return qs.slice(0, 60);
  }

  /**
   * 题目 → 知识点归类：
   * 同页知识点直接关联；跨页用二元组相似度（阈值 0.2），最多保留 2 条。
   */
  function linkQuestions(questions, points) {
    for (const q of questions || []) {
      const cands = (points || []).filter(p => norm(p.text) !== norm(q.text)).map(p => {
        const s = sim(q.text, p.text);
        return { text: p.text, score: s + (p.slideNo === q.slideNo ? 0.2 : 0), cross: s };
      }).filter(c => c.cross >= 0.2 || c.score >= 0.2);
      cands.sort((a, b) => b.score - a.score);
      q.points = [...new Set(cands.slice(0, 2).map(c => c.text))];
    }
    return questions;
  }

  /* ---------------- AI：一次提取 考点 + 题目 ---------------- */
  const AI_SYSTEM = [
    '你是考试复习助手。根据 PPT 逐页大纲完成两件事：',
    '1) 提取重要知识点和考点；2) 识别课件中的题目（例题、习题、思考题、讨论题等）并把每道题归类到相关知识点。',
    '只输出一个 JSON 对象，不要任何其他文字：',
    '{"points":[{"text":"知识点","slide":页码数字,"importance":"高|中|低","tags":["定义","公式"等1-2个]}],',
    '"questions":[{"text":"题目原文","slide":页码数字,"type":"选择|填空|判断|计算|简答|思考|例题","points":["关联知识点原文"]}]}',
    '要求：points 8~20 条，覆盖主线；questions 只收真正的题目或任务，普通陈述内容不算；所有 text 不超过 40 字。',
  ].join('\n');

  async function aiExtractAll(slides, deckTitle, cfg) {
    const content = await window.chatCompletion(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', cfg.apiKey, {
      model: cfg.model || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: AI_SYSTEM },
        { role: 'user', content: `课件标题：${deckTitle || ''}

${SummaryBuilder.outlineText(slides)}` },
      ],
    });
    const jsonStr = (content.match(/\{[\s\S]*\}/) || [])[0];
    if (!jsonStr) throw new Error('回复中没有 JSON');
    const obj = JSON.parse(jsonStr);

    const points = (Array.isArray(obj.points) ? obj.points : []).map(raw => ({
      text: clean(raw.text || raw.name || '').slice(0, 80),
      slideNo: Math.max(1, parseInt(raw.slide, 10) || 1),
      stars: STARS_OF[raw.importance] || 2,
      tags: Array.isArray(raw.tags) ? raw.tags.map(clean).slice(0, 3) : [],
    })).filter(p => p.text);

    const qTypes = Q_TYPES.map(x => x[0]);
    const questions = (Array.isArray(obj.questions) ? obj.questions : []).map(raw => ({
      text: clean(raw.text || '').slice(0, 100),
      slideNo: Math.max(1, parseInt(raw.slide, 10) || 1),
      type: qTypes.includes(raw.type) ? raw.type : '思考',
      points: Array.isArray(raw.points) ? raw.points.map(clean).filter(Boolean).slice(0, 3) : [],
    })).filter(q => q.text);

    if (!points.length && !questions.length) throw new Error('AI 返回内容为空');
    return { points, questions };
  }

  /* ---------------- 导出 ---------------- */
  function toMarkdown(points, deckTitle) {
    const groups = [
      [3, '★★★ 高频必考'],
      [2, '★★ 重点掌握'],
      [1, '★ 了解即可'],
    ];
    let out = `# ${deckTitle || '本课件'} 考点清单\n\n> 共 ${points.length} 个知识点，由 Class Learning Helper 提取\n`;
    for (const [stars, label] of groups) {
      const list = points.filter(p => p.stars === stars);
      if (!list.length) continue;
      out += `\n## ${label}\n`;
      for (const p of list) {
        const meta = [...(p.tags || []), ...(p.examTypes || [])].join(' / ');
        out += `- [P${p.slideNo}] ${p.text}${meta ? `（${meta}）` : ''}\n`;
      }
    }
    return out;
  }

  /** Classinfo Board 导入格式（v1） */
  function toBoardJSON(title, points, questions) {
    return {
      schema: 'class-learning-helper/board-import/v1',
      deck: { title: title || '', exportedAt: new Date().toISOString() },
      knowledgePoints: (points || []).map(p => ({
        text: p.text, slide: p.slideNo, importance: p.stars, tags: p.tags || [],
      })),
      questions: (questions || []).map(q => ({
        text: q.text, slide: q.slideNo, type: q.type, knowledgePoints: q.points || [],
        deck: q.deck || null,
      })),
    };
  }

  window.KnowledgeExtractor = {
    extractLocal, extractQuestions, linkQuestions,
    aiExtractAll, toMarkdown, toBoardJSON, norm,
  };
})();
