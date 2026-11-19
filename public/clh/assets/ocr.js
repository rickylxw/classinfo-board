/* ============================================================
 * ocr.js — 图片题目识别管线
 * 暴露 window.QuestionVision：
 *   renderMD(src)                     极小 Markdown 渲染（题面/解题展示）
 *   visionExtract(dataURL, cfg, names) AI 视觉：题面 MD + 解题方式 + 知识点
 *   ocrImage(dataURL, onProgress)     本地 OCR（Tesseract.js 懒加载，需联网）
 *   ocrToQuestion(text)               OCR 文本 → 题面
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 极小 Markdown 渲染 ---------------- */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function renderMD(src) {
    const lines = String(src || '').split(/\r?\n/);
    let html = '', inList = false;
    const inline = s => esc(s)
      .replace(/\$\$([^$]+)\$\$/g, (m, f) => `<code class="math">${f}</code>`)
      .replace(/\$([^$]+)\$/g, (m, f) => `<code class="math">${f}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    for (const raw of lines) {
      const l = raw.trim();
      const li = l.match(/^[-*]\s+(.*)/), ol = l.match(/^\d+[.、]\s+(.*)/), h = l.match(/^(#{1,4})\s+(.*)/);
      if (li || ol) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${inline((li || ol)[1])}</li>`;
        continue;
      }
      if (inList) { html += '</ul>'; inList = false; }
      if (!l) continue;
      if (h) html += `<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`;
      else html += `<p>${inline(l)}</p>`;
    }
    if (inList) html += '</ul>';
    return html || '<p>（空）</p>';
  }

  /* ---------------- AI 视觉识别 ---------------- */
  const VISION_SYS = [
    '你是题目整理助手。识别图片中的题目，只输出一个 JSON 对象，不要任何其他文字：',
    '{"md":"题面（Markdown；数学公式用 $...$ LaTeX；保留选项/图形描述）","type":"选择|填空|判断|计算|简答|思考|其他","solution":"解题思路与关键步骤（Markdown，简洁，含最终答案）","points":["涉及的知识点，尽量使用给定列表中的名称"]}',
    '若图片不是题目，md 里简要说明图片内容，type 用「其他」，solution 留空。',
  ].join('\n');

  async function visionExtract(dataURL, cfg, pointNames) {
    let content = await window.chatCompletion(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', cfg.apiKey, {
    model: cfg.visionModel || cfg.model || 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: VISION_SYS },
      {
        role: 'user',
        content: [
          { type: 'text', text: '本课程知识点列表：' + (pointNames.join('、') || '（暂无）') },
          { type: 'image_url', image_url: { url: dataURL } },
        ],
      },
    ],
  });
  content = String(content).trim();
    if (Array.isArray(content)) content = content.map(c => c.text || '').join('');   // 兼容分段返回
    content = String(content).trim();

    // 优先按约定的 JSON 解析；解析失败则视为纯 OCR 模型（如 GLM-OCR），
    // 把整段返回当作题面 markdown —— 解题方式与知识点需手动补充。
    const jsonStr = (content.match(/\{[\s\S]*\}/) || [])[0];
    if (jsonStr) {
      try {
        const obj = JSON.parse(jsonStr);
        if (obj.md || obj.question || obj.content) {
          return {
            md: String(obj.md || obj.question || obj.content).trim(),
            type: String(obj.type || '其他'),
            solution: String(obj.solution || '').trim(),
            points: Array.isArray(obj.points) ? obj.points.map(s => String(s).trim()).filter(Boolean).slice(0, 4) : [],
          };
        }
      } catch (e) { /* JSON 损坏 → 走纯文本分支 */ }
    }
    const md = content.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/,'').trim();
    if (!md) throw new Error('接口返回内容为空');
    return { md, type: '其他', solution: '', points: [] };
  }

  /* ---------------- 本地 OCR（懒加载 Tesseract.js） ---------------- */
  let tessPromise = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (!tessPromise) {
      tessPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        s.onload = resolve;
        s.onerror = () => { tessPromise = null; reject(new Error('OCR 引擎加载失败（需要联网）')); };
        document.head.appendChild(s);
      });
    }
    return tessPromise;
  }

  async function ocrImage(dataURL, onProgress) {
    await loadTesseract();
    const blob = await (await fetch(dataURL)).blob();
    const worker = await window.Tesseract.createWorker(['chi_sim', 'eng'], 1, {
      logger: m => { if (onProgress && m.status) onProgress(m.status, m.progress); },
    });
    try {
      const { data } = await worker.recognize(blob);
      return (data.text || '').trim();
    } finally {
      await worker.terminate();
    }
  }

  function ocrToQuestion(text) {
    const t = String(text || '').replace(/[ \t]+/g, ' ').trim();
    return {
      md: t ? '## 题面\n\n' + t : '',
      type: '其他',
      solution: '',
      points: [],
    };
  }

  window.QuestionVision = { renderMD, visionExtract, ocrImage, ocrToQuestion };
})();
