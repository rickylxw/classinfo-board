/* ============================================================
 * app.js — Vue 应用
 * 课程（新建/重命名/删除）→ 多个作业 PPT（导图 + 考点 + 题目）→ 题目本
 * 数据经 store.js 持久化到 IndexedDB；图片题经 ocr.js 识别
 * 布局：横向 tidy-tree，根的子分支按子树高度左右平衡分布
 * ============================================================ */
(function () {
  'use strict';

  const { createApp, reactive, ref, computed, watch, onMounted, nextTick } = Vue;

  // AI 请求统一走服务器代理（绕开浏览器跨域限制）；代理不可用（file:// 等）时回退直连
  window.aiFetch = async function (url, opts = {}) {
    try {
      const res = await fetch('/ai-proxy?target=' + encodeURIComponent(url), opts);
      if (res.status === 404 || res.status === 502) return fetch(url, opts);   // 代理不可用 → 直连
      return res;
    } catch (e) {
      return fetch(url, opts);                            // 无代理（file:// 等）→ 直连
    }
  };

  // AI 对话补全：经代理 + 429 自动重试一次 + 服务商错误详情透出
  let aiChain = Promise.resolve();          // AI 调用串行队列：同时只有一个请求，避免并发 429
  window.chatCompletion = async function (url, apiKey, body, timeoutMs = 240000) {
    const run = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const doCall = () => window.aiFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (apiKey || '') },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        let res = await doCall();
        if (res.status === 429) {           // 限流：等 3 秒自动重试一次
          await new Promise(r => setTimeout(r, 3000));
          res = await doCall();
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const msg = data && data.error && data.error.message ? data.error.message : ('接口返回 ' + res.status);
          throw new Error(msg);
        }
        let content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '';
        if (Array.isArray(content)) content = content.map(c => c.text || '').join('');
        return String(content);
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('AI 响应超时，请稍后重试');
        throw e;
      } finally {
        clearTimeout(timer);
      }
    };
    const p = aiChain.then(run, run);       // 无论前一个成功失败，都接着执行
    aiChain = p.then(() => {}, () => {});
    return p;
  };

  // ---------- 常量 ----------
  const FONT = "'Segoe UI','Microsoft YaHei',sans-serif";
  const PALETTE = ['#e6514e', '#ef7d2f', '#dfa010', '#7cb342', '#26a69a', '#3b8fe3', '#5c6bc0', '#9c5bc4', '#ec6bab', '#8d6e63'];
  const HGAP = 52, VGAP = 10;
  const AI_SYSTEM = [
    '你是课程笔记助手。用户给出 PPT 课件逐页大纲，请提炼为一张思维导图。',
    '只输出一个 JSON 对象，格式：{"name":"课件主题","children":[{"name":"要点","children":[{"name":"子要点"}]}]}。',
    '要求：层级最多 4 层；每个节点不超过 16 个字；合并同义重复内容；覆盖全部一级主题；不要输出 JSON 以外的任何文字。',
  ].join('\n');
  const Q_TYPE_LIST = ['选择', '填空', '判断', '计算', '简答', '思考', '例题', '习题', '其他'];

  // ---------- 文本测量 ----------
  const measCtx = document.createElement('canvas').getContext('2d');
  function lineW(text, font) { measCtx.font = font; return measCtx.measureText(text).width; }
  function wrapText(text, font, maxW, maxLines) {
    measCtx.font = font;
    const t = String(text);
    if (measCtx.measureText(t).width <= maxW) return [t];
    const lines = []; let cur = '';
    for (const ch of t) {
      if (cur && measCtx.measureText(cur + ch).width > maxW) {
        lines.push(cur);
        if (lines.length === maxLines) { cur = ch; break; }
        cur = ch;
      } else cur += ch;
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    const consumed = lines.join('').length;
    if (consumed < t.replace(/\n/g, '').length && lines.length) {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = last.slice(0, Math.max(0, last.length - 1)) + '…';
    }
    return lines;
  }

  function styleFor(depth, hue) {
    if (depth === 0) return { fill: '#4263eb', stroke: '#4263eb', sw: 0, color: '#fff', fs: 17, fw: 700, font: `700 17px ${FONT}` };
    if (depth === 1) return { fill: hue, stroke: hue, sw: 0, color: '#fff', fs: 14, fw: 600, font: `600 14px ${FONT}` };
    return { fill: '#ffffff', stroke: hue, sw: 1.4, color: '#1e293b', fs: 12.5, fw: 400, font: `400 12.5px ${FONT}` };
  }

  createApp({
    setup() {
      try {
      // ---------- 基础引用 ----------
      const fileInput = ref(null), folderInput = ref(null), imgInput = ref(null), canvasEl = ref(null), svgEl = ref(null), editorEl = ref(null);
      const renameEl = ref(null);
      const view = reactive({ x: 0, y: 0, k: 1 });
      const canvasW = ref(800), canvasH = ref(600);
      const rev = ref(0), collapsedVer = ref(0);
      const collapsedSet = new Set();
      const selectedId = ref(null);
      const activeSlide = ref(0);
      const loadingText = ref('');
      const exportMenu = ref(false);
      const showAI = ref(false);
      const aiLoading = ref(false);
      const dragActive = ref(false);
      const editing = ref(null);
      const toast = ref(null);
      const previewImage = ref(null);
      const demoUrl = 'demo/数据结构-第1章-绪论.pptx';

      // ---------- 课程 / 作业状态 ----------
      const courses = ref([]);
      const activeCourseId = ref(null);
      const activeDeckId = ref(null);
      const viewMode = ref('map');                 // 'map' | 'bank'
      const addingCourse = ref(false);
      const newCourseName = ref('');
      const renamingId = ref(null);
      const renameValue = ref('');

      // ---------- 当前打开的作业（导图视图数据） ----------
      const slides = ref([]);
      const tree = ref(null);
      const deckTitle = ref('');

      // ---------- 知识点 / 考点 / 题目（当前作业） ----------
      const showKP = ref(false);
      const kpList = ref([]);
      const kpFilter = ref(0);
      const kpAILoading = ref(false);
      const kpSource = ref('local');
      const kpVer = ref(0);
      const kpTab = ref('points');
      const qList = ref([]);

      // ---------- 题目本 ----------
      const bankFilter = ref('');
      const bankStatus = ref('');              // 做题状态筛选：'' | 待做 | 错 | 对

      // ---------- 设置 ----------
      const settings = reactive({ condense: true, includeNotes: false, practiceMode: true, autoAIExtract: true, cloudAuto: true, ai: { baseUrl: '', apiKey: '', model: '', visionModel: '' }, board: { xh: '', password: '', webOrigin: '' }, lastCourseId: null, lastDeckId: null, lastView: 'map' });
      const aiForm = reactive({ baseUrl: '', apiKey: '', model: '', visionModel: '', boardXh: '', boardPassword: '', boardWebOrigin: '' });
      try {
        const saved = JSON.parse(localStorage.getItem('clh-ppt2mindmap') || '{}');
        Object.assign(settings, saved);
        settings.ai = Object.assign({ baseUrl: '', apiKey: '', model: '', visionModel: '' }, saved.ai);
        settings.board = Object.assign({ xh: '', password: '', webOrigin: '' }, saved.board);
      } catch (e) { /* 忽略损坏的本地配置 */ }
      // 做题记录异步加载（不阻塞启动）
      Store.attRead().then(recs => {
        for (const r of recs) attemptsMap[r.qKey] = r;
      }).catch(() => {});
      watch(settings, v => localStorage.setItem('clh-ppt2mindmap', JSON.stringify(v)), { deep: true });

      let toastTimer = 0;
      function showToast(msg, type = 'info') {
        toast.value = { msg, type };
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (toast.value = null), 3200);
      }

      // ---------- 课程数据 ----------
      const activeCourse = computed(() => courses.value.find(c => c.id === activeCourseId.value) || null);
      const activeDeck = computed(() =>
        (activeCourse.value && activeCourse.value.decks.find(d => d.id === activeDeckId.value)) || null);

      async function loadCourses() {
        courses.value = (await Store.all()) || [];
        // 数据规范化：早期损坏会话的数据可能缺数组字段，统一补齐
        for (const c of courses.value) {
          c.decks = Array.isArray(c.decks) ? c.decks : [];
          c.images = Array.isArray(c.images) ? c.images : [];
          for (const d of c.decks) {
            d.slides = Array.isArray(d.slides) ? d.slides : [];
            d.points = Array.isArray(d.points) ? d.points : [];
            d.questions = Array.isArray(d.questions) ? d.questions : [];
            if (!d.id) d.id = c.id + '-' + Math.random().toString(36).slice(2, 8);
          }
        }
        // 上次会话中断的识别任务 → 标记为可重试
        for (const c of courses.value) {
          for (const img of c.images || []) {
            if (img.status === 'processing') {
              img.status = 'error';
              img.errMsg = '上次识别被中断';
            }
          }
        }
        // 恢复上次位置
        const c = courses.value.find(x => x.id === settings.lastCourseId);
        if (c) {
          activeCourseId.value = c.id;
          const d = c.decks.find(x => x.id === settings.lastDeckId);
          if (d) { openDeck(c.id, d.id); return; }
          viewMode.value = settings.lastView || 'bank';
        }
      }
      function saveActive() {
        if (activeCourse.value) {
          saveCourse(activeCourse.value);
          scheduleCloudPush();               // 已登录云端时自动上传（防抖 2.5 秒）
        }
      }
      const lastSavedJson = new Map();      // course.id -> 上次保存的 JSON（内容未变则跳过写盘）
      function saveCourse(c) {
        if (!c) return;
        const snapshot = JSON.stringify(c);
        if (lastSavedJson.get(String(c.id)) === snapshot) return;
        lastSavedJson.set(String(c.id), snapshot);
        Store.put(JSON.parse(snapshot));
      }
      function ensureCourse() {
        if (activeCourse.value) return activeCourse.value;
        const c = { id: Store.uid(), name: '我的课程', createdAt: new Date().toISOString(), decks: [], images: [] };
        courses.value.push(c);
        activeCourseId.value = c.id;
        saveCourse(c);
        return c;
      }
      function startAddCourse() { addingCourse.value = true; newCourseName.value = ''; }
      function confirmAddCourse() {
        const name = newCourseName.value.trim() || `课程 ${courses.value.length + 1}`;
        const c = { id: Store.uid(), name, createdAt: new Date().toISOString(), decks: [], images: [] };
        courses.value.push(c);
        addingCourse.value = false;
        saveCourse(c);
        openBank(c);
        showToast(`已创建「${name}」`, 'success');
      }
      function startRename(c) { renamingId.value = c.id; renameValue.value = c.name; nextTick(() => renameEl.value && renameEl.value.focus()); }
      function setRenameEl(el) { renameEl.value = el; }
      function confirmRename(c) {
        if (renamingId.value !== c.id) return;
        const name = renameValue.value.trim();
        if (name) c.name = name;
        renamingId.value = null;
        saveCourse(c);
      }
      function removeCourse(c) {
        if (!confirm(`删除课程「${c.name}」及其全部作业和题目？此操作不可恢复。`)) return;
        Store.remove(c.id);
        lastSavedJson.delete(String(c.id));
        courses.value = courses.value.filter(x => x.id !== c.id);
        if (activeCourseId.value === c.id) {
          activeCourseId.value = null; activeDeckId.value = null;
          slides.value = []; tree.value = null; kpList.value = []; qList.value = [];
        }
        showToast('课程已删除');
      }
      function removeDeck(c, d) {
        if (!confirm(`从「${c.name}」移除作业「${d.name}」？`)) return;
        c.decks = c.decks.filter(x => x.id !== d.id);
        Store.removeFile(d.id);
        if (activeDeckId.value === d.id) {
          activeDeckId.value = null;
          slides.value = []; tree.value = null; kpList.value = []; qList.value = [];
        }
        saveCourse(c);
      }

      function openDeck(courseId, deckId, auto = true) {
        activeCourseId.value = courseId;
        activeDeckId.value = deckId;
        viewMode.value = 'map';
        settings.lastCourseId = courseId;
        settings.lastDeckId = deckId;
        settings.lastView = 'map';
        const deck = activeDeck.value;
        if (!deck) return;
        slides.value = deck.slides || [];
        deckTitle.value = deck.name;
        kpList.value = deck.points || (deck.points = []);
        qList.value = deck.questions || (deck.questions = []);
        kpSource.value = deck.kpSource || 'local';
        collapsedSet.clear();
        selectedId.value = null;
        if (deck.treeCustom && deck.tree) {
          tree.value = JSON.parse(JSON.stringify(deck.tree));
        } else {
          tree.value = SummaryBuilder.buildTree(slides.value, deck.deckTitle || deck.name, {
            condense: settings.condense, includeNotes: settings.includeNotes, fallbackName: deck.name,
          });
        }
        collapsedVer.value++;
        nextTick(fitView);
        // 已配置 AI 且该作业还没用过 AI 提取 → 后台自动升级考点与题目（本地结果先展示）
        if (auto && settings.autoAIExtract && settings.ai.baseUrl && settings.ai.apiKey
            && !deck.kpAI && deck.slides && deck.slides.length) {
          autoAIExtract(deck);
        }
      }
      async function autoAIExtract(deck) {
        deck.kpAI = true;                          // 每个作业只自动跑一次
        const isCurrent = () => activeDeck.value && activeDeck.value.id === deck.id;
        try {
          if (isCurrent()) kpAILoading.value = true;
          const { points, questions } = await KnowledgeExtractor.aiExtractAll(deck.slides, deck.name, settings.ai);
          deck.points = points;
          deck.questions = questions;
          deck.kpSource = 'ai';
          if (isCurrent()) {
            kpList.value = deck.points;
            qList.value = deck.questions;
            kpSource.value = 'ai';
            kpVer.value++;
          }
          saveActive();
          if (isCurrent()) showToast('AI 考点与题目已更新', 'success');
        } catch (e) {
          if (isCurrent()) showToast('AI 提取失败：' + e.message + '（已保留本地规则结果，可点 ✨ AI 提取 重试）', 'error');
        } finally {
          if (isCurrent()) kpAILoading.value = false;
        }
      }
      function openBank(c) {
        activeCourseId.value = c.id;
        viewMode.value = 'bank';
        settings.lastCourseId = c.id;
        settings.lastDeckId = null;
        settings.lastView = 'bank';
        bankFilter.value = '';
      }
      function goMap() {
        viewMode.value = 'map';
        settings.lastView = 'map';
        // 没有打开的作业时，自动打开当前课程第一个作业
        if (!activeDeck.value && activeCourse.value && activeCourse.value.decks.length) {
          openDeck(activeCourse.value.id, activeCourse.value.decks[0].id);
        }
      }

      // ---------- 布局引擎 ----------
      const kpKeySet = computed(() => {
        kpVer.value;
        const set = new Set();
        for (const p of kpList.value) {
          const k = KnowledgeExtractor.norm(p.text);
          if (k.length >= 4) set.add(k);
        }
        return set;
      });
      function nameMatchesKp(name) {
        const n = KnowledgeExtractor.norm(name);
        if (!n || n.length < 4) return false;
        for (const k of kpKeySet.value) {
          if (k === n || k.includes(n) || n.includes(k)) return true;
        }
        return false;
      }

      const layout = computed(() => {
        rev.value; collapsedVer.value; kpVer.value;   // 依赖收集
        const t = tree.value;
        if (!t) return { nodes: [], links: [], bounds: null };
        const nodesArr = [], linksArr = [];
        let hueIdx = 0;

        (function measure(n, depth, hue) {
          const st = styleFor(depth, hue);
          const maxW = depth === 0 ? 260 : depth === 1 ? 190 : 160;
          const lines = wrapText(n.name, st.font, maxW, depth === 0 ? 3 : 4);
          const lh = st.fs * 1.5;
          const padX = depth === 0 ? 20 : 14, padY = depth === 0 ? 13 : 9;
          const w = Math.ceil(Math.max(40, ...lines.map(L => lineW(L, st.font)))) + padX * 2;
          const h = Math.ceil(lines.length * lh + padY * 2);
          n._m = { ...st, lines, lh, w, h, padX, textY0: padY + st.fs * 1.02 };
          n._depth = depth;
          n._hue = hue;
          n._expanded = !!(n.children && n.children.length) && !collapsedSet.has(n.id);
          if (n._expanded) {
            let sum = 0;
            for (const c of n.children) {
              measure(c, depth + 1, depth === 0 ? PALETTE[hueIdx++ % PALETTE.length] : hue);
              sum += c._sub + VGAP;
            }
            n._childSum = sum - VGAP;
            n._sub = Math.max(n._childSum, h);
          } else { n._childSum = 0; n._sub = h; }
        })(t, 0, null);

        const colW = [];
        (function cols(n) {
          colW[n._depth] = Math.max(colW[n._depth] || 0, n._m.w);
          if (n._expanded) n.children.forEach(cols);
        })(t);
        const colXRight = [0], colXLeft = [0];
        for (let d = 1; d < colW.length; d++) {
          colXRight[d] = colXRight[d - 1] + colW[d - 1] + HGAP;
          colXLeft[d] = colXLeft[d - 1] - (colW[d - 1] + HGAP) - colW[d];
        }

        let leftH = 0, rightH = 0;
        for (const c of t.children) {
          c._side = leftH <= rightH ? -1 : 1;
          if (c._side === -1) leftH += c._sub + VGAP; else rightH += c._sub + VGAP;
        }
        leftH = Math.max(leftH - VGAP, 0); rightH = Math.max(rightH - VGAP, 0);
        const center = Math.max(leftH, rightH, t._m.h) / 2;
        t._x = 0; t._y = center - t._m.h / 2; t._side = 1;

        function anchorOf(n) {
          const pad = n._m.padX;
          n._m.anchor = n._side === -1 ? 'end' : 'start';
          n._m.textX = n._side === -1 ? n._m.w - pad : pad;
        }
        function place(n, top) {
          n._y = top + (n._sub - n._m.h) / 2;
          n._x = n._side === -1 ? colXLeft[n._depth] : colXRight[n._depth];
          anchorOf(n);
          if (n._expanded) {
            let cy = top + (n._sub - n._childSum) / 2;
            for (const c of n.children) { c._side = n._side; place(c, cy); cy += c._sub + VGAP; }
          }
        }
        for (const side of [-1, 1]) {
          const total = side === -1 ? leftH : rightH;
          let cy = center - total / 2;
          for (const c of t.children) {
            if (c._side !== side) continue;
            place(c, cy); cy += c._sub + VGAP;
          }
        }

        function edge(p, c) {
          const x1 = c._side === 1 ? p._x + p._m.w : p._x;
          const y1 = p._y + p._m.h / 2;
          const x2 = c._side === 1 ? c._x : c._x + c._m.w;
          const y2 = c._y + c._m.h / 2;
          const dx = (x2 - x1) * 0.5;
          return {
            key: `${p.id}-${c.id}`,
            d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
            color: c._hue || '#4263eb',
            w: c._depth === 1 ? 3 : c._depth === 2 ? 2 : 1.4,
          };
        }
        (function emit(n) {
          const m = n._m;
          nodesArr.push({
            id: n.id, name: n.name, slideNo: n.slideNo, depth: n._depth, side: n._side,
            x: n._x, y: n._y, w: m.w, h: m.h, lines: m.lines,
            fs: m.fs, fw: m.fw, fill: m.fill, stroke: m.stroke, sw: m.sw, color: m.color,
            lh: m.lh, textX: m.textX, textY0: m.textY0, anchor: m.anchor,
            childrenCount: (n.children || []).length,
            collapsed: !n._expanded && (n.children || []).length > 0,
            star: nameMatchesKp(n.name),
            toggleX: n._side === 1 ? m.w : 0,
            countX: n._side === 1 ? m.w + 13 : -13,
          });
          if (n._expanded) {
            for (const c of n.children) { linksArr.push(edge(n, c)); emit(c); }
          }
        })(t);

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of nodesArr) {
          minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
          maxX = Math.max(maxX, n.x + n.w + 30); maxY = Math.max(maxY, n.y + n.h + 30);
        }
        return {
          nodes: nodesArr, links: linksArr,
          bounds: nodesArr.length ? { minX: minX - 40, minY: minY - 40, w: maxX - minX + 80, h: maxY - minY + 80 } : null,
        };
      });
      const nodes = computed(() => layout.value.nodes);
      const links = computed(() => layout.value.links);
      const bounds = computed(() => layout.value.bounds);
      const collapsedCount = computed(() => {
        collapsedVer.value;
        let c = 0;
        (function walk(n) {
          if (n.children && n.children.length && collapsedSet.has(n.id)) c++;
          (n.children || []).forEach(walk);
        })(tree.value || { children: [] });
        return c;
      });

      function snapshotTree() {
        const walk = n => ({ id: n.id, name: n.name, slideNo: n.slideNo, children: (n.children || []).map(walk) });
        return JSON.parse(JSON.stringify(walk(tree.value)));
      }
      function markTreeCustom() {
        const deck = activeDeck.value;
        if (!deck) return;
        deck.treeCustom = true;
        deck.tree = snapshotTree();
        saveActive();
      }

      // ---------- 文件解析（支持单文件 / 多选 / 拖入整个文件夹） ----------
      function pickFile() { fileInput.value && fileInput.value.click(); }
      function pickFolder() { folderInput.value && folderInput.value.click(); }
      function onFile(e) {
        const files = [...(e.target.files || [])];
        e.target.value = '';
        if (files.length) parseQueue(files);
      }
      function onFolder(e) {
        const all = [...(e.target.files || [])];
        e.target.value = '';
        if (!all.length) return;
        const pptx = all.filter(f => /\.(pptx|pdf)$/i.test(f.name));
        const skipped = all.length - pptx.length;
        if (!pptx.length) { showToast('文件夹里没有 .pptx / .pdf 文件', 'error'); return; }
        parseQueue(pptx, skipped);
      }
      /** 拖放内容收集：递归展开拖入的文件夹，收集全部 .pptx（其余计数跳过） */
      async function collectDropFiles(dt) {
        const files = []; let skipped = 0;
        const push = f => {
          if (!f) return;
          if (/\.(pptx|pdf)$/i.test(f.name)) files.push(f); else skipped++;
        };
        const walk = async entry => {
          if (!entry) return;
          if (entry.isFile) {
            const f = await new Promise(res => entry.file(res, () => res(null)));
            push(f);
          } else if (entry.isDirectory) {
            const reader = entry.createReader();
            let batch;
            do {
              batch = await new Promise(res => reader.readEntries(res, () => res([])));
              for (const e of batch) await walk(e);
            } while (batch.length);
          }
        };
        const entries = [];
        for (const item of (dt.items || [])) {
          const en = item.webkitGetAsEntry && item.webkitGetAsEntry();   // 必须在事件栈内同步调用
          if (en) entries.push(en);
        }
        if (entries.length) {
          for (const en of entries) await walk(en);
        } else {
          for (const f of (dt.files || [])) push(f);
        }
        return { files, skipped };
      }
      async function onDrop(e) {
        dragActive.value = false;
        const dt = e.dataTransfer;
        if (!dt) return;
        const { files, skipped } = await collectDropFiles(dt);
        if (!files.length) {
          if (skipped) showToast(`拖入的内容里没有 .pptx / .pdf 文件（跳过 ${skipped} 个其他文件）`, 'error');
          return;
        }
        parseQueue(files, skipped);
      }
      async function parseFile(file) { return parseQueue([file]); }

      async function parseQueue(files, skippedExt = 0) {
        const course = ensureCourse();
        const ok = [], failed = [];
        const multi = files.length > 1;
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const label = multi ? `(${i + 1}/${files.length}) ${f.name} · ` : '';
          try {
            ok.push(await parseOne(course, f, label));
          } catch (err) {
            failed.push(`${f.name}（${err.message || '解析失败'}）`);
          }
        }
        loadingText.value = '';
        if (ok.length) {
          saveActive();
          openDeck(ok[0].course.id, ok[0].deck.id);
        }
        const parts = [`导入 ${ok.length} 个课件`];
        if (skippedExt) parts.push(`跳过 ${skippedExt} 个非课件文件`);
        if (failed.length) parts.push(`失败 ${failed.length} 个`);
        showToast(parts.join('，'), ok.length ? 'success' : 'error');
        if (failed.length) console.warn('解析失败：', failed);
      }

      async function parseOne(course, file, label = '') {
        const isPdf = /\.pdf$/i.test(file.name);
        if (!isPdf && !/\.pptx$/i.test(file.name)) {
          throw new Error('仅支持 .pptx / .pdf；旧版 .ppt 请先在 PowerPoint 中另存为 .pptx 或导出 PDF');
        }
        loadingText.value = `${label}正在读取文件…`;
        const result = isPdf
          ? await PDFParser.parsePdf(file, {
              onProgress: (i, n) => (loadingText.value = `${label}正在解析第 ${i} / ${n} 页…`),
              fallbackName: file.name.replace(/\.pdf$/i, ''),
            })
          : await PPTXParser.parsePptx(file, {
              includeNotes: settings.includeNotes,
              onProgress: (i, n) => (loadingText.value = `${label}正在解析第 ${i} / ${n} 页…`),
            });
        const deck = {
          id: Store.uid(),
          name: result.title || file.name.replace(/\.(pptx|pdf)$/i, ''),
          deckTitle: result.title,
          addedAt: new Date().toISOString(),
          slides: result.slides,
          points: [], questions: [],
          tree: null, treeCustom: false,
          kpSource: 'local',
          hasFile: false,
        };
        deck.hasFile = await Store.putFile(deck.id, file, file.name);   // 保存原件，供投递 Board 附件
        deck.points = KnowledgeExtractor.extractLocal(deck.slides);
        deck.questions = KnowledgeExtractor.linkQuestions(
          KnowledgeExtractor.extractQuestions(deck.slides), deck.points);
        if (course.decks.some(d => d.name === deck.name)) {
          const keep = confirm('课程里已存在同名课件「' + deck.name + '」，仍要再导入一份吗？（取消则跳过这个文件）');
          if (!keep) throw new Error('已跳过（课程中已有同名课件）');
        }
        course.decks.unshift(deck);
        return { course, deck };
      }
      function rebuildTree() {
        const deck = activeDeck.value;
        tree.value = SummaryBuilder.buildTree(slides.value, deckTitle.value, {
          condense: settings.condense,
          includeNotes: settings.includeNotes,
          fallbackName: deck ? deck.name : '',
        });
        if (deck) { deck.treeCustom = false; deck.tree = null; saveActive(); }
        collapsedSet.clear();
        selectedId.value = null;
        collapsedVer.value++;
      }
      watch(() => [settings.condense, settings.includeNotes],
        () => { if (slides.value.length) rebuildTree(); });

      // ---------- 画布交互 ----------
      let pan = null;
      function onCanvasDown(e) {
        if (e.button !== 0) return;
        pan = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, moved: false };
      }
      function onCanvasMove(e) {
        if (!pan) return;
        const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
        if (!pan.moved && Math.abs(dx) + Math.abs(dy) > 4) pan.moved = true;
        if (pan.moved) { view.x = pan.ox + dx; view.y = pan.oy + dy; }
      }
      function onCanvasUp() { setTimeout(() => (pan = null), 0); }

      function zoomAt(sx, sy, factor) {
        const k2 = Math.min(4, Math.max(0.12, view.k * factor));
        view.x = sx - (sx - view.x) * (k2 / view.k);
        view.y = sy - (sy - view.y) * (k2 / view.k);
        view.k = k2;
      }
      function onWheel(e) {
        const rect = canvasEl.value.getBoundingClientRect();
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
      }
      function zoomIn() { zoomAt(canvasW.value / 2, canvasH.value / 2, 1.2); }
      function zoomOut() { zoomAt(canvasW.value / 2, canvasH.value / 2, 1 / 1.2); }
      function fitView() {
        const b = bounds.value;
        if (!b || !canvasW.value) return;
        const k = Math.min((canvasW.value - 60) / b.w, (canvasH.value - 60) / b.h, 1.2);
        view.k = Math.max(0.12, k);
        view.x = (canvasW.value - b.w * view.k) / 2 - b.minX * view.k;
        view.y = (canvasH.value - b.h * view.k) / 2 - b.minY * view.k;
      }

      function toggleNode(n) {
        if (collapsedSet.has(n.id)) collapsedSet.delete(n.id);
        else collapsedSet.add(n.id);
        collapsedVer.value++;
      }
      function onNodeClick(n) {
        if (pan && pan.moved) return;
        selectedId.value = n.id;
        if (n.slideNo) activeSlide.value = n.slideNo;
      }
      function expandAll() { collapsedSet.clear(); collapsedVer.value++; nextTick(fitView); }
      function collapseBranches() {
        (function walk(n, depth) {
          if (depth >= 1 && n.children && n.children.length) collapsedSet.add(n.id);
          (n.children || []).forEach(c => walk(c, depth + 1));
        })(tree.value || { children: [] }, 0);
        collapsedVer.value++;
        nextTick(fitView);
      }
      function focusSlide(no) {
        activeSlide.value = no;
        const list = nodes.value;
        const n = list.find(v => v.slideNo === no && v.depth === 1) || list.find(v => v.slideNo === no);
        if (!n) return;
        selectedId.value = n.id;
        view.x = canvasW.value / 2 - (n.x + n.w / 2) * view.k;
        view.y = canvasH.value / 2 - (n.y + n.h / 2) * view.k;
      }

      function findTreeNode(id) {
        let found = null;
        (function walk(n) {
          if (n.id === id) { found = n; return; }
          (n.children || []).forEach(walk);
        })(tree.value || {});
        return found;
      }
      function startEdit(n) {
        const rect = canvasEl.value.getBoundingClientRect();
        const k = view.k;
        editing.value = {
          id: n.id,
          value: n.name,
          style: {
            left: rect.left + view.x + n.x * k + 'px',
            top: rect.top + view.y + n.y * k + 'px',
            width: Math.max(n.w * k, 150) + 'px',
            height: Math.max(n.h * k, 40) + 'px',
            fontSize: Math.max(12, n.fs * k) + 'px',
          },
        };
        nextTick(() => { editorEl.value && editorEl.value.select(); });
      }
      function endEdit(save) {
        const ed = editing.value;
        if (!ed) return;
        editing.value = null;
        if (!save) return;
        const name = ed.value.replace(/\s+/g, ' ').trim();
        const node = findTreeNode(ed.id);
        if (node && name && name !== node.name) {
          node.name = name;
          rev.value++;
          markTreeCustom();
        }
      }

      // ---------- AI：导图总结 ----------
      const aiButtonTitle = computed(() =>
        settings.ai.baseUrl && settings.ai.apiKey ? '用 AI 重新提炼导图' : '先在设置中配置 AI 接口（可选）');
      const AI_PRESETS = {
        zhipu:    { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
        zhipuCoding: { baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', model: 'glm-5.3-flash' },
        deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
        moonshot: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
        qwen:     { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
        ollama:   { baseUrl: 'http://192.168.3.5:11434/v1', model: '' },
      };
      function applyPreset(name) {
        const p = AI_PRESETS[name];
        if (!p) return;
        aiForm.baseUrl = p.baseUrl;
        if (p.model) aiForm.model = p.model;
        showToast('已填入 ' + name + ' 接口地址与默认模型，请补全 API Key', 'info');
      }

      function openAI() {
        Object.assign(aiForm, settings.ai);
        aiForm.boardXh = settings.board.xh;
        aiForm.boardPassword = settings.board.password;
        aiForm.boardWebOrigin = settings.board.webOrigin || '';
        showAI.value = true;
      }
      function saveAI() {
        settings.ai = { baseUrl: aiForm.baseUrl, apiKey: aiForm.apiKey, model: aiForm.model, visionModel: aiForm.visionModel };
        settings.board = { xh: aiForm.boardXh, password: aiForm.boardPassword, webOrigin: aiForm.boardWebOrigin || '' };
        showAI.value = false;
        showToast('设置已保存', 'success');
      }
      async function aiSummarize() {
        if (!settings.ai.baseUrl || !settings.ai.apiKey) {
          openAI();
          showToast('使用 AI 总结前，请先填写接口配置', 'error');
          return;
        }
        aiLoading.value = true;
        try {
          const content = await window.chatCompletion(settings.ai.baseUrl.replace(/\/+$/, '') + '/chat/completions', settings.ai.apiKey, {
            model: settings.ai.model || 'gpt-4o-mini',
            temperature: 0.3,
            messages: [
              { role: 'system', content: AI_SYSTEM },
              { role: 'user', content: `课件标题：${deckTitle.value || ''}

${SummaryBuilder.outlineText(slides.value)}` },
            ],
          });
          const jsonStr = (content.match(/\{[\s\S]*\}/) || [])[0];
          if (!jsonStr) throw new Error('回复中没有 JSON');
          tree.value = SummaryBuilder.normalizeAITree(JSON.parse(jsonStr));
          collapsedSet.clear();
          collapsedVer.value++;
          markTreeCustom();
          nextTick(fitView);
          showToast('AI 总结完成', 'success');
        } catch (err) {
          const emsg = String(err.message || err);

          const hint = /Failed to fetch|NetworkError|Load failed/i.test(emsg) ? '无法连接接口（检查网络与接口地址）' : emsg;

          showToast('AI 总结失败：' + hint + '（已保留当前导图）', 'error');
        } finally {
          aiLoading.value = false;
        }
      }

      // ---------- 知识点 / 考点 / 题目（作业级） ----------
      const kpStats = computed(() => {
        const s = { 1: 0, 2: 0, 3: 0 };
        for (const p of kpList.value) s[p.stars] = (s[p.stars] || 0) + 1;
        return s;
      });
      const kpFiltered = computed(() =>
        kpFilter.value ? kpList.value.filter(p => p.stars === kpFilter.value) : kpList.value);
      function extractLocal() {
        if (!slides.value.length) return;
        const deck = activeDeck.value;
        kpList.value = deck.points = KnowledgeExtractor.extractLocal(slides.value);
        qList.value = deck.questions = KnowledgeExtractor.linkQuestions(
          KnowledgeExtractor.extractQuestions(slides.value), deck.points);
        deck.kpSource = 'local';
        deck.kpAI = true;                          // 用户主动选择本地规则，不再自动覆盖
        kpSource.value = 'local';
        kpVer.value++;
        saveActive();
      }
      async function extractAI() {
        if (!settings.ai.baseUrl || !settings.ai.apiKey) {
          openAI();
          showToast('AI 提取前请先配置接口', 'error');
          return;
        }
        kpAILoading.value = true;
        try {
          const { points, questions } = await KnowledgeExtractor.aiExtractAll(slides.value, deckTitle.value, settings.ai);
          const deck = activeDeck.value;
          kpList.value = deck.points = points;
          qList.value = deck.questions = questions;
          deck.kpSource = 'ai';
          deck.kpAI = true;
          kpSource.value = 'ai';
          kpVer.value++;
          saveActive();
          showToast(`AI 提取到 ${points.length} 个考点、${questions.length} 道题`, 'success');
        } catch (err) {
          showToast('AI 提取失败：' + err.message + '（已保留当前结果）', 'error');
        } finally {
          kpAILoading.value = false;
        }
      }

      // ---------- 题目本（课程级） ----------
      const bankItems = computed(() => {
        const c = activeCourse.value;
        if (!c) return [];
        const out = [];
        for (const d of c.decks) {
          (d.questions || []).forEach((q, i) => out.push({
            ...q, key: `d${d.id}-${i}`, source: 'ppt', deckName: d.name, deckId: d.id,
          }));
        }
        (c.images || []).forEach(img => out.push({
          ...img, key: `i${img.id}`, source: 'image',
          slideNo: null, deckName: '图片题',
        }));
        return out;
      });
      const bankTypes = computed(() => {
        const set = [];
        for (const q of bankItems.value) if (!set.includes(q.type)) set.push(q.type);
        return set;
      });
      const bankFiltered = computed(() => bankItems.value.filter(q => {
        if (bankFilter.value && q.type !== bankFilter.value) return false;
        const st = attStatus(q);
        if (bankStatus.value === '待做') return st === '未做' || st === '跳过';
        if (bankStatus.value === '错') return st === '错';
        if (bankStatus.value === '对') return st === '对';
        return true;
      }));
      function bankTypeCount(t) { return bankItems.value.filter(q => q.type === t).length; }
      function bankCount(c) {
        return c.decks.reduce((s, d) => s + (d.questions || []).length, 0) + (c.images || []).length;
      }
      const coursePointNames = computed(() => {
        const c = activeCourse.value;
        if (!c) return [];
        const out = []; const seen = new Set();
        for (const d of c.decks) {
          for (const p of d.points || []) {
            const k = KnowledgeExtractor.norm(p.text);
            if (k && !seen.has(k)) { seen.add(k); out.push(p.text); }
          }
        }
        return out;
      });

      function pickImages() { imgInput.value && imgInput.value.click(); }
      function onImages(e) {
        const files = [...(e.target.files || [])];
        e.target.value = '';
        if (!files.length) return;
        const course = ensureCourse();
        for (const f of files) {
          const reader = new FileReader();
          reader.onload = () => {
            const img = {
              id: Store.uid(), deckId: null, addedAt: new Date().toISOString(),
              imageData: reader.result, md: '', type: '其他', solution: '', points: [],
              status: 'processing', progressMsg: '',
            };
            course.images = course.images || [];
            course.images.unshift(img);
            saveActive();
            processImage(img);
          };
          reader.readAsDataURL(f);
        }
        showToast(`已加入 ${files.length} 张题目图片，开始识别…`);
      }
      async function processImage(item) {
        item.status = 'processing';
        item.progressMsg = '';
        try {
          if (settings.ai.baseUrl && settings.ai.apiKey) {
            item.progressMsg = 'AI 识别中';
            const r = await QuestionVision.visionExtract(item.imageData, settings.ai, coursePointNames.value);
            item.md = r.md; item.type = Q_TYPE_LIST.includes(r.type) ? r.type : '其他';
            item.solution = r.solution;
            const names = coursePointNames.value;
            item.points = r.points.filter(pt => names.some(n => n === pt || n.includes(pt) || pt.includes(n)));
            item.points.push(...r.points.filter(pt => !item.points.includes(pt)).slice(0, 2));
          } else {
            const text = await QuestionVision.ocrImage(item.imageData,
              (s, p) => { item.progressMsg = s === 'recognizing text' ? `识别文字 ${Math.round((p || 0) * 100)}%` : s; });
            const r = QuestionVision.ocrToQuestion(text);
            item.md = r.md;
            if (/A[．.、]/.test(text) || /下列/.test(text)) item.type = '选择';
            else if (/_{2,}|（\s*）/.test(text)) item.type = '填空';
            else if (text.includes('？')) item.type = '思考';
          }
          item.status = 'done';
          showToast('识别完成', 'success');
        } catch (err) {
          item.status = 'error';
          item.errMsg = err.message || String(err);
        }
        saveActive();
      }
      function touchImageQ(q) {
        const c = activeCourse.value;
        const img = c && (c.images || []).find(x => x.id === q.id);
        if (img) { img.solution = q.solution; saveActive(); }
      }
      function setType(q, t) {
        const c = activeCourse.value;
        const img = c && (c.images || []).find(x => x.id === q.id);
        if (img) { img.type = t; saveActive(); }
      }
      function assignPoint(q, pt) {
        if (!pt || q.points.includes(pt)) return;
        const c = activeCourse.value;
        const img = c && (c.images || []).find(x => x.id === q.id);
        if (img) { img.points.push(pt); saveActive(); }
      }
      function unassignPoint(q, pt) {
        const c = activeCourse.value;
        const img = c && (c.images || []).find(x => x.id === q.id);
        if (img) { img.points = img.points.filter(x => x !== pt); saveActive(); }
      }
      function removeImageQ(q) {
        if (!confirm('删除这道图片题？')) return;
        const c = activeCourse.value;
        c.images = (c.images || []).filter(x => x.id !== q.id);
        saveActive();
      }
      // 课程级聚合：全部作业的考点去重 + 题目（PPT 题 + 图片题），导出与推送共用
      function courseAggregates() {
        const c = activeCourse.value;
        if (!c) return { pts: [], questions: [] };
        const seen = new Set();
        const pts = [];
        for (const d of c.decks) {
          for (const p of d.points || []) {
            const k = KnowledgeExtractor.norm(p.text);
            if (!seen.has(k)) { seen.add(k); pts.push({ text: p.text, slide: p.slideNo, importance: p.stars, tags: p.tags || [] }); }
          }
        }
        const questions = [];
        for (const d of c.decks) {
          for (const q of d.questions || []) {
            questions.push({ text: q.text, slide: q.slideNo, type: q.type, knowledgePoints: q.points || [], deck: d.name });
          }
        }
        for (const img of c.images || []) {
          if (img.status !== 'done') continue;
          questions.push({
            text: String(img.md || '').replace(/[#*`>\n]+/g, ' ').trim().slice(0, 80) || '（图片题）',
            slide: null, type: img.type, knowledgePoints: img.points || [], deck: '图片题',
            md: img.md, solution: img.solution,
          });
        }
        return { pts, questions };
      }
      function exportCourseBoard() {
        const c = activeCourse.value;
        if (!c) return;
        const { pts, questions } = courseAggregates();
        const json = KnowledgeExtractor.toBoardJSON(c.name, pts, questions);
        download((c.name || 'course').replace(/[\\/:*?"<>|\s]+/g, '_') + '-board.json',
          new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
        showToast('已导出课程 Board 数据', 'success');
      }

      // ---------- 云同步（与 Board 共用账号，服务器按学号存储） ----------
      const showCloud = ref(false);
      const cloudErr = ref('');
      const cloudInfo = ref('');          // 已登录学号
      const cloudBusy = ref(false);
      const cloudAuto = computed(() => settings.cloudAuto !== false);
      const lastSyncAt = ref(Number(localStorage.getItem('clh-last-sync') || 0));
      let applyingRemote = false;         // 拉取应用期间暂停自动上传
      let pushTimer = 0;

      function clhCall(path, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        if (boardToken) headers.Authorization = 'Bearer ' + boardToken;
        return fetch(path, { ...opts, headers }).then(async res => {
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error((data && data.error) || ('接口返回 ' + res.status));
          return data;
        });
      }
      async function cloudLogin() {
        await boardLogin();
        cloudInfo.value = settings.board.xh || '已登录';
      }
      let cloudLoggedIn = false;
      async function cloudEnsureLogin() {
        if (cloudLoggedIn && boardToken) return;
        await cloudLogin();
        cloudLoggedIn = true;
        cloudInfo.value = settings.board.xh;
      }
      async function cloudPull() {
        cloudErr.value = '';
        cloudBusy.value = true;
        try {
          await cloudEnsureLogin();
          const r = await clhCall('/api/clh-data');
          if (!r.data || !Array.isArray(r.data.courses)) {
            showToast('云端暂无数据', 'info');
          } else {
            applyingRemote = true;
            try {
              for (const c of courses.value) await Store.remove(c.id);
              courses.value = JSON.parse(JSON.stringify(r.data.courses));
              for (const c of courses.value) await Store.put(JSON.parse(JSON.stringify(c)));
              if (Array.isArray(r.data.attempts)) {
                for (const rec of r.data.attempts) {
                  const cur = attemptsMap[rec.qKey];
                  if (!cur || (Number(rec.updatedAt) || 0) >= (Number(cur.updatedAt) || 0)) {
                    attemptsMap[rec.qKey] = rec;
                    Store.attWrite(JSON.parse(JSON.stringify(rec)));
                  }
                }
              }
              activeCourseId.value = null; activeDeckId.value = null;
              slides.value = []; tree.value = null; kpList.value = []; qList.value = [];
            } finally {
              applyingRemote = false;
            }
            lastSyncAt.value = Date.now();
            localStorage.setItem('clh-last-sync', String(lastSyncAt.value));
            showToast(`已拉取云端：${courses.value.length} 门课程`, 'success');
          }
          cloudLoggedIn = true;
          cloudInfo.value = settings.board.xh;
        } catch (e) {
          cloudErr.value = '拉取失败：' + e.message;
        } finally {
          cloudBusy.value = false;
        }
      }
      async function cloudPushNow() {
        cloudErr.value = '';
        if (!courses.value.length && !confirm('本地没有任何课程数据，确定要上传并覆盖云端吗？')) return;
        cloudBusy.value = true;
        try {
          await cloudEnsureLogin();
          const payload = {
          updatedAt: Date.now(),
          courses: sanitizeCourses(),
          attempts: Object.values(attemptsMap).map(a => JSON.parse(JSON.stringify(a))),
        };
          const r = await clhCall('/api/clh-data', { method: 'PUT', body: JSON.stringify(payload) });
          lastSyncAt.value = r.savedAt || Date.now();
          localStorage.setItem('clh-last-sync', String(lastSyncAt.value));
          showToast('已上传到云端', 'success');
        } catch (e) {
          cloudErr.value = '上传失败：' + e.message;
        } finally {
          cloudBusy.value = false;
        }
      }
      let pushPending = false;
      function scheduleCloudPush() {
        if (!cloudLoggedIn || applyingRemote || !settings.cloudAuto) return;
        if (pushPending) return;
        pushPending = true;
        setTimeout(async () => {
          pushPending = false;
          try { await cloudPushNow(); } catch (e) { /* 错误已在 cloudPushNow 提示 */ }
        }, 2500);
      }
      async function openCloudSync() {
        showCloud.value = true;
        cloudErr.value = '';
        if (!settings.board.xh || !settings.board.password) {
          cloudErr.value = '请先在 ⚙ 设置填写 Board 学号与应用密码（与 Classinfo Board 共用账号）';
          return;
        }
        cloudBusy.value = true;
        try {
          await cloudEnsureLogin();
          cloudLoggedIn = true;
          cloudInfo.value = settings.board.xh;
          // 登录后自动拉取一次（本地为空时），否则仅显示状态
          const r = await clhCall('/api/clh-data');
          cloudHasRemote = !!(r.data && Array.isArray(r.data.courses));
        } catch (e) {
          cloudErr.value = '登录失败：' + e.message;
        } finally {
          cloudBusy.value = false;
        }
      }
      function qKeyOf(q) {
        return q.source === 'image'
          ? 'i:' + q.id
          : 'd:' + q.deckId + ':' + (q.slideNo || 0) + ':' + KnowledgeExtractor.norm(q.text).slice(0, 60);
      }
      function attStatus(q) {
        const rec = attemptsMap[qKeyOf(q)];
        return rec ? rec.status : '未做';
      }
      function recordAttempt(q, status, wrongTag) {
        const qKey = qKeyOf(q);
        const prev = attemptsMap[qKey];
        const wrongTags = wrongTag
          ? [wrongTag]
          : (prev && prev.status === '错' ? prev.wrongTags : []);
        const rec = {
          qKey, status, wrongTags,
          type: q.type || '', text: String(q.text || q.md || '').slice(0, 60),
          points: q.points || [], deckName: q.deckName || '', slideNo: q.slideNo ?? null,
          updatedAt: Date.now(),
        };
        attemptsMap[qKey] = rec;
        Store.attWrite(JSON.parse(JSON.stringify(rec)));
        wrongSel.value = '';
        scheduleCloudPush();
      }
      function toggleWrongTag(q) {
        const k = qKeyOf(q);
        wrongSel.value = wrongSel.value === k ? '' : k;
      }

      function sanitizeCourses() {
        // 深拷贝并清理运行时附加属性（树节点上的测量缓存等）
        return JSON.parse(JSON.stringify(courses.value));
      }
      // ---------- 复习模式 ----------
      const rvFilter = ref('all');
      const rvIdx = ref(0);
      const rvFlipped = ref(false);
      const rvInput = ref('');
      const rvGradedKey = ref('');
      const rvVerdictOK = ref(false);
      const reviewMastery = reactive(JSON.parse(localStorage.getItem('clh-review-mastery') || '{}'));

      const reviewCards = computed(() => {
        const c = activeCourse.value;
        if (!c) return [];
        const cards = [];
        for (const d of c.decks) {
          for (const p of d.points || []) {
            cards.push({
              key: 'p:' + KnowledgeExtractor.norm(p.text).slice(0, 40),
              kind: 'point', stars: p.stars || 1, text: p.text, slideNo: p.slideNo,
              tags: p.tags || [], deckName: d.name,
              context: ((d.slides || [])[p.slideNo - 1] || {}).items ? d.slides[p.slideNo - 1].items.map(it => it.text) : [],
            });
          }
          for (const q of d.questions || []) {
            cards.push({
              key: 'q:' + KnowledgeExtractor.norm(q.text).slice(0, 40),
              kind: 'question', qtype: q.type || '题目', text: q.text, slideNo: q.slideNo,
              points: q.points || [], deckName: d.name,
              answer: q.answer || '', pitfalls: q.pitfalls || [],
            });
          }
        }
        for (const img of c.images || []) {
          if (img.status !== 'done') continue;
          cards.push({
            key: 'i:' + img.id,
            kind: 'question', qtype: img.type || '其他',
            text: String(img.md || '').replace(/[#*`>\n]+/g, ' ').trim().slice(0, 80) || '（图片题）',
            md: img.md, solution: img.solution, imageData: img.imageData,
            points: img.points || [], deckName: '图片题',
            answer: img.answer || '', pitfalls: img.pitfalls || [],
          });
        }
        return cards;
      });
      const rvCounts = computed(() => {
        const n = { 3: 0, 2: 0, 1: 0, q: 0 };
        for (const c of reviewCards.value) {
          if (c.kind === 'question') n.q++;
          else n[c.stars] = (n[c.stars] || 0) + 1;
        }
        return n;
      });
      const againCount = computed(() => reviewCards.value.filter(c => reviewMastery[c.key] === 'again').length);
      const rvCards = computed(() => reviewCards.value.filter(c => {
        const f = rvFilter.value;
        if (f === 'all') return true;
        if (f === 'again') return reviewMastery[c.key] === 'again';
        if (f === 'q') return c.kind === 'question';
        return Number(f) === c.stars;
      }));
      // 本轮队列：基准顺序 + "没记住"的卡重排到队尾（cram 式循环巩固）
      const rvQueue = computed(() => {
        const base = rvCards.value.slice();
        const again = base.filter(c => reviewMastery[c.key] === 'again');
        for (const c of again) { const p = base.indexOf(c); if (p !== -1) { base.splice(p, 1); base.push(c); } }
        return base;
      });
      const rvCurrent = computed(() => {
        const q = rvQueue.value;
        if (rvIdx.value >= q.length) rvIdx.value = 0;
        return q[rvIdx.value] || null;
      });
      // 可判分题：有标准答案的 选择/填空
      const rvGradable = computed(() => {
        const c = rvCurrent.value;
        return !!c && !!c.answer && (c.qtype === '选择' || c.qtype === '填空');
      });
      const rvGraded = computed(() => !!rvCurrent.value && rvGradedKey.value === rvCurrent.value.key);
      function normalizeAns(s) {
        return String(s || '').trim().toLowerCase().replace(/[\s]+/g, '');
      }
      function rvSubmit() {
        const c = rvCurrent.value;
        if (!c || rvGraded.value || !rvInput.value.trim()) return;
        const ok = normalizeAns(rvInput.value) === normalizeAns(c.answer);
        rvGradedKey.value = c.key;
        rvVerdictOK.value = ok;
        rvMark(ok ? 'known' : 'again');
        rvFlipped.value = true;
      }
      function rvFilterSet(f) { rvFilter.value = f; rvIdx.value = 0; rvFlipped.value = false; rvGradedKey.value = ''; rvInput.value = ''; }
      function rvNext() { const n = rvQueue.value.length; if (!n) return; rvIdx.value = (rvIdx.value + 1) % n; rvFlipped.value = false; rvGradedKey.value = ''; rvInput.value = ''; }
      function rvPrev() { const n = rvQueue.value.length; if (!n) return; rvIdx.value = (rvIdx.value - 1 + n) % n; rvFlipped.value = false; rvGradedKey.value = ''; rvInput.value = ''; }
      function rvMark(state) {
        const c = rvCurrent.value;
        if (!c) return;
        reviewMastery[c.key] = state;
        try { localStorage.setItem('clh-review-mastery', JSON.stringify(reviewMastery)); } catch (e) {}
        rvNext();   // "没记住"的卡已由 rvQueue 自动重排到队尾
      }
      // ---------- 弱点画像 ----------
      const statItems = computed(() => bankItems.value.map(q => {
        const k = qKeyOf(q);
        const rec = attemptsMap[k];
        return { ...q, aKey: k, status: rec ? rec.status : '未做', wrongTags: rec ? rec.wrongTags : [] };
      }));
      const attemptSummary = computed(() => {
        const n = { '对': 0, '错': 0, '跳过': 0, '未做': 0 };
        for (const s of statItems.value) n[s.status] = (n[s.status] || 0) + 1;
        return n;
      });
      const wrongTagStats = computed(() => {
        const cnt = {};
        for (const s of statItems.value) {
          if (s.status !== '错') continue;
          for (const t of (s.wrongTags || [])) cnt[t] = (cnt[t] || 0) + 1;
        }
        const max = Math.max(0, ...Object.values(cnt));
        return Object.entries(cnt).map(([tag, count]) => ({
          tag, count, pct: max ? Math.round(count / max * 100) : 0,
        })).sort((a, b) => b.count - a.count);
      });
      const kpMastery = computed(() => {
        const acc = {};
        for (const s of statItems.value) {
          for (const p of (s.points || [])) {
            const k = KnowledgeExtractor.norm(p);
            if (!acc[k]) acc[k] = { name: p, total: 0, wrong: 0 };
            acc[k].total++;
            if (s.status === '错') acc[k].wrong++;
          }
        }
        return Object.values(acc).map(k => {
          const mastery = k.total ? Math.round((k.total - k.wrong) / k.total * 100) : 0;
          return { ...k, mastery, level: mastery >= 80 ? 'ok' : mastery >= 50 ? 'mid' : 'bad' };
        }).sort((a, b) => b.wrong - a.wrong || b.total - a.total);
      });
      const wrongItems = computed(() => statItems.value.filter(s => s.status === '错'));
      function openStats() {
        viewMode.value = 'stats';
        settings.lastView = 'stats';
      }

      function openReview() {
        viewMode.value = 'review';
        settings.lastView = 'review';
        rvIdx.value = 0;
        rvFlipped.value = false;
      }

      // ---------- 推送到 Classinfo Board ----------
      const BOARD_API = '/api';       // devserver.py 反向代理 → Board 后端
      let boardToken = '';
      const cloudReady = ref(false);
      let cloudHasRemote = false;
      const attemptsMap = reactive({});       // qKey -> 做题记录
      const revealMap = reactive({});         // qKey -> 练习模式下已展开解答
      const wrongSel = ref('');
      const WRONG_TAGS = ['概念不清', '公式记错', '末端操作', '约定未锁'];
      const showBoardPush = ref(false);
      const boardLoading = ref(false);
      const boardReady = ref(false);
      const boardErr = ref('');
      const boardCourses = ref([]);
      const boardTarget = ref('');
      const boardPushing = ref(false);
      const boardPushKP = ref(true);
      const boardPushQ = ref(true);
      const pushAgg = computed(() => courseAggregates());
      const pushPoints = computed(() => pushAgg.value.pts);
      const pushQuestions = computed(() => pushAgg.value.questions);

      async function boardCall(path, opts = {}) {
        try {
          return await rawBoardCall(path, opts);
        } catch (e) {
          const msg = String(e.message || '');
          if (/未登录|会话过期/.test(msg)) {           // token 失效 → 重登一次再试
            await boardLogin();
            return await rawBoardCall(path, opts);
          }
          throw e;
        }
      }
      async function rawBoardCall(path, opts = {}) {
        const res = await fetch(BOARD_API + path, {
          method: opts.method || 'GET',
          headers: { 'Content-Type': 'application/json', ...(boardToken ? { Authorization: 'Bearer ' + boardToken } : {}) },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* 非 JSON */ }
        if (!res.ok) throw new Error((data && data.error) || ('接口返回 ' + res.status));
        return data;
      }
      function ssoFetchToken(origin, timeoutMs = 4000) {
        // 通过隐藏 iframe 向 Board 网页请求其登录令牌（sso.html 校验来源白名单后回传）
        return new Promise(resolve => {
          let iframe = null;
          const cleanup = () => {
            if (iframe) { iframe.remove(); iframe = null; }
            window.removeEventListener('message', onMsg);
            clearTimeout(timer);
          };
          const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
          const onMsg = e => {
            if (e.origin !== origin || !e.data || e.data.type !== 'clh-sso-token') return;
            cleanup();
            resolve(e.data.token || null);
          };
          window.addEventListener('message', onMsg);
          iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          iframe.src = origin + '/sso.html';
          iframe.onload = () => {
            try { iframe.contentWindow.postMessage({ type: 'clh-sso-request' }, origin); } catch (e) { /* 跨域 */ }
          };
          document.body.appendChild(iframe);
        });
      }
      async function quickVerify(token) {
        try {
          const r = await rawBoardCall('/auth/me', { headers: { Authorization: 'Bearer ' + token } });
          return !!(r && r.xh && !r.admin);
        } catch (e) { return false; }
      }
      async function boardLogin() {
        // 1) 已有令牌仍有效 → 直接用
        if (boardToken && await quickVerify(boardToken)) return;
        // 2) 单点登录：从已登录的 Board 网页静默取令牌
        if (true) { /* 同源部署：直接读本站令牌 */
          const t = localStorage.getItem('classinfo-token');
          if (t && await quickVerify(t)) {
            boardToken = t;
            localStorage.setItem('clh-board-token', t);
            if (settings.board.xh !== undefined) { /* 学号由 /auth/me 获知即可 */ }
            return;
          }
        }
        // 3) 学号 + 应用密码快速登录
        const { xh, password } = settings.board;
        if (!xh || !password) throw new Error('未登录：请先在 Board 网页登录一次（可自动单点登录），或在 ⚙ 设置填写学号与应用密码');
        const r = await rawBoardCall('/auth/password-login', { method: 'POST', body: { xh, password } });
        boardToken = r.token;
        localStorage.setItem('clh-board-token', boardToken);
      }
      async function openBoardPush() {
        showBoardPush.value = true;
        boardErr.value = '';
        if (!settings.board.xh || !settings.board.password) {
          boardReady.value = false;
          boardErr.value = '还没有配置 Board 账号：点右上角「⚙ 设置」填写学号与应用密码（在 Board 设置过应用密码）';
          return;
        }
        boardLoading.value = true;
        boardReady.value = false;
        try {
          await boardLogin();
          const data = await rawBoardCall('/data');
          boardCourses.value = (data.courses || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
          const hit = BoardClient.matchCourse(boardCourses.value, activeCourse.value && activeCourse.value.name);
          boardTarget.value = hit ? hit.id : '';
          boardReady.value = true;
        } catch (e) {
          boardErr.value = '连接 Board 失败：' + e.message;
        } finally {
          boardLoading.value = false;
        }
      }
      async function confirmBoardPush() {
        const course = activeCourse.value;
        if (!course || !boardTarget.value) return;
        boardPushing.value = true;
        try {
          const { pts, questions } = courseAggregates();
          const items = BoardClient.buildItems(boardTarget.value, course.name,
            boardPushKP.value ? pts : [], boardPushQ.value ? questions : []);
          if (!items.length) { showToast('没有可推送的内容', 'error'); return; }
          await boardCall('/data/ops', { method: 'POST', body: { ops: [{ op: 'upsert', coll: 'assignments', items }] } });
          showBoardPush.value = false;
          showToast(`已推送到 Board：考点 ${boardPushKP.value ? pts.length : 0} 条 · 题目 ${boardPushQ.value ? questions.length : 0} 道`, 'success');
        } catch (e) {
          boardErr.value = '推送失败：' + e.message;
        } finally {
          boardPushing.value = false;
        }
      }

      // ---------- Board 附件：拉取课件 PPT 分析 & 投递课件 ----------
      const showBoardFiles = ref(false);
      const boardFileBoards = ref([]);      // [{ key, label, from, files:[{id,name,size}] }]
      const boardFileCourse = ref('');
      const pullingId = ref('');
      const showBoardSubmit = ref(false);
      const submitDeckName = ref('');
      const submitHasFile = ref(false);
      const submitPickedFile = ref(null);
      let submitDeck = null;

      async function openBoardFiles() {
        showBoardFiles.value = true;
        boardErr.value = '';
        boardFileBoards.value = [];
        boardFileCourse.value = '';
        if (!settings.board.xh || !settings.board.password) {
          boardErr.value = '还没有配置 Board 账号：点右上角「⚙ 设置」填写学号与应用密码';
          return;
        }
        boardLoading.value = true;
        try {
          if (!boardToken) await boardLogin();
          // 成员视角：/sync 推送来的共享板
          const synced = await BoardClient.listSynced(BOARD_API, boardToken);
          const boards = (synced || []).map(b => ({ key: b.key, from: b.from || '', label: '', files: (b.files || []).slice() }));
          // 负责人视角：自己的每门 Board 课程尝试读管理板
          const data = await rawBoardCall('/data');
          boardCourses.value = (data.courses || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
          for (const c of boardCourses.value) {
            const key = BoardClient.boardKeyOf(c);
            if (boards.some(b => b.key === key)) continue;
            const owned = await BoardClient.fetchOwnedBoard(BOARD_API, boardToken, key);
            if (owned && Array.isArray(owned.files) && owned.files.length) {
              boards.push({ key, from: '我管理', label: '', files: owned.files.slice() });
            }
          }
          for (const b of boards) {
            const hit = boardCourses.value.find(c => BoardClient.boardKeyOf(c) === b.key);
            b.label = hit ? hit.name : b.key.split('|')[0];
          }
          boardFileBoards.value = boards.filter(b => b.files.length);
          boardReady.value = true;
          if (!boardFileBoards.value.length) boardErr.value = '你的课程共享板里还没有附件';
        } catch (e) {
          boardErr.value = '连接 Board 失败：' + e.message;
        } finally {
          boardLoading.value = false;
        }
      }
      const currentBoardFiles = computed(() => {
        const b = boardFileBoards.value.find(x => x.key === boardFileCourse.value);
        return b ? b.files : [];
      });
      async function pullBoardFile(f) {
        const b = boardFileBoards.value.find(x => x.key === boardFileCourse.value);
        if (!b) return;
        pullingId.value = f.id;
        try {
          const blob = await BoardClient.downloadShared(BOARD_API, boardToken, b.key, f.id);
          const file = new File([blob], f.name,
            { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
          ensureCourse();
          showBoardFiles.value = false;
          await parseFile(file);           // 正常走解析 → 导图/考点/题目，并保存原件
        } catch (e) {
          boardErr.value = '拉取失败：' + e.message;
        } finally {
          pullingId.value = '';
        }
      }

      async function openBoardSubmit(deck) {
        if (!deck) return;
        submitDeck = deck;
        submitDeckName.value = deck.name + '.pptx';
        submitPickedFile.value = null;
        showBoardSubmit.value = true;
        boardErr.value = '';
        if (!settings.board.xh || !settings.board.password) {
          boardErr.value = '还没有配置 Board 账号：点右上角「⚙ 设置」填写学号与应用密码';
          return;
        }
        boardLoading.value = true;
        try {
          if (!boardToken) await boardLogin();
          const data = await rawBoardCall('/data');
          boardCourses.value = (data.courses || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
          const owner = courses.value.find(c => c.decks.some(d => d.id === deck.id));
          const hit = owner ? BoardClient.matchCourse(boardCourses.value, owner.name) : null;
          boardTarget.value = hit ? hit.id : '';
          submitHasFile.value = !!(await Store.getFile(deck.id));
          boardReady.value = true;
        } catch (e) {
          boardErr.value = '连接 Board 失败：' + e.message;
        } finally {
          boardLoading.value = false;
        }
      }
      function onSubmitFilePick(e) {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (f) submitPickedFile.value = f;
      }
      async function confirmBoardSubmit() {
        const deck = submitDeck;
        if (!deck || !boardTarget.value) return;
        boardPushing.value = true;
        try {
          const rec = await Store.getFile(deck.id);
          const blob = (rec && rec.blob) || submitPickedFile.value;
          const name = (rec && rec.name) || (submitPickedFile.value && submitPickedFile.value.name) || (deck.name + '.pptx');
          if (!blob) throw new Error('本地没有 PPT 原件，也未重新选择文件');
          const boardCourse = boardCourses.value.find(c => c.id === boardTarget.value);
          if (!boardCourse) throw new Error('请选择目标课程');
          const key = BoardClient.boardKeyOf(boardCourse);
          const r = await BoardClient.putSharedFile(BOARD_API, boardToken, key, name, blob);
          showBoardSubmit.value = false;
          showToast(r.published ? '已发布到 Board 共享附件' : '已投稿，等待课程负责人审核', 'success');
        } catch (e) {
          boardErr.value = '投递失败：' + e.message;
        } finally {
          boardPushing.value = false;
        }
      }

      // ---------- 作业级导出 ----------
      function baseName() {
        return (deckTitle.value || 'mindmap').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'mindmap';
      }
      function download(name, blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      function cleanTree() {
        const walk = n => ({ name: n.name, children: (n.children || []).map(walk) });
        return walk(tree.value);
      }
      function exportMarkdown() {
        let out = `# ${tree.value.name}\n`;
        (function walk(n, depth) {
          for (const c of n.children || []) {
            if (depth === 1) out += `\n## ${c.name}\n`;
            else out += `${'  '.repeat(depth - 2)}- ${c.name}\n`;
            walk(c, depth + 1);
          }
        })(tree.value, 1);
        download(baseName() + '.md', new Blob([out], { type: 'text/markdown;charset=utf-8' }));
        showToast('已导出 Markdown', 'success');
      }
      function exportJSON() {
        download(baseName() + '.json', new Blob([JSON.stringify(cleanTree(), null, 2)], { type: 'application/json' }));
        showToast('已导出 JSON', 'success');
      }
      function exportFreeMind() {
        const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const walk = n => `<node TEXT="${esc(n.name)}">${(n.children || []).map(walk).join('')}</node>`;
        const xml = `<?xml version="1.0" encoding="UTF-8"?><map version="1.0.1">${walk(cleanTree())}</map>`;
        download(baseName() + '.mm', new Blob([xml], { type: 'text/xml;charset=utf-8' }));
        showToast('已导出 FreeMind（可导入 XMind）', 'success');
      }
      function svgSnapshot() {
        const b = bounds.value;
        if (!b || !svgEl.value) return null;
        const clone = svgEl.value.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', Math.round(b.w));
        clone.setAttribute('height', Math.round(b.h));
        clone.setAttribute('viewBox', `${b.minX} ${b.minY} ${Math.round(b.w)} ${Math.round(b.h)}`);
        const g = clone.querySelector('g');
        if (g) g.removeAttribute('transform');
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', b.minX); bg.setAttribute('y', b.minY);
        bg.setAttribute('width', Math.round(b.w)); bg.setAttribute('height', Math.round(b.h));
        bg.setAttribute('fill', '#ffffff');
        clone.insertBefore(bg, clone.firstChild);
        return clone;
      }
      function exportSVG() {
        const clone = svgSnapshot();
        if (!clone) return;
        const data = new XMLSerializer().serializeToString(clone);
        download(baseName() + '.svg', new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + data], { type: 'image/svg+xml;charset=utf-8' }));
        showToast('已导出 SVG', 'success');
      }
      function exportPNG() {
        const clone = svgSnapshot();
        if (!clone) return;
        const data = new XMLSerializer().serializeToString(clone);
        const url = URL.createObjectURL(new Blob([data], { type: 'image/svg+xml;charset=utf-8' }));
        const img = new Image();
        img.onload = () => {
          const scale = 2;
          const cv = document.createElement('canvas');
          cv.width = Math.round(parseFloat(clone.getAttribute('width'))) * scale;
          cv.height = Math.round(parseFloat(clone.getAttribute('height'))) * scale;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url);
          cv.toBlob(blob => {
            if (blob) { download(baseName() + '.png', blob); showToast('已导出 PNG', 'success'); }
            else showToast('导出 PNG 失败', 'error');
          }, 'image/png');
        };
        img.onerror = () => { URL.revokeObjectURL(url); showToast('导出 PNG 失败', 'error'); };
        img.src = url;
      }
      function exportKP() {
        if (!kpList.value.length) return;
        const md = KnowledgeExtractor.toMarkdown(kpList.value, deckTitle.value);
        download(baseName() + '-考点清单.md', new Blob([md], { type: 'text/markdown;charset=utf-8' }));
        showToast('已导出考点清单', 'success');
      }
      function exportBoard() {
        if (!qList.value.length && !kpList.value.length) return;
        const json = KnowledgeExtractor.toBoardJSON(deckTitle.value, kpList.value, qList.value);
        download(baseName() + '-board.json', new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
        showToast('已导出 Board 数据（题目 + 知识点关联）', 'success');
      }

      // ---------- 初始化 ----------
      onMounted(async () => {
        await loadCourses();
        const el = canvasEl.value;
        if (el) {
          const ro = new ResizeObserver(() => {
            canvasW.value = el.clientWidth;
            canvasH.value = el.clientHeight;
          });
          ro.observe(el);
          canvasW.value = el.clientWidth;
          canvasH.value = el.clientHeight;
        }
        document.addEventListener('click', () => (exportMenu.value = false));
        document.addEventListener('keydown', e => {
          if (viewMode.value === 'review') {
            if (e.key === 'ArrowRight') rvNext();
            else if (e.key === 'ArrowLeft') rvPrev();
            else if (e.key === ' ') { e.preventDefault(); rvFlipped.value = !rvFlipped.value; }
            else if (e.key === '1') rvMark('known');
            else if (e.key === '2') rvMark('again');
            return;
          }
          if (e.key === 'Escape') { exportMenu.value = false; showAI.value = false; previewImage.value = null; }
        });
        try { sessionStorage.removeItem('clh-boot-retry'); } catch (e) {}   // 启动成功，重置自愈标记
      });

      return {
        fileInput, folderInput, imgInput, canvasEl, svgEl, editorEl,
        view: viewMode, courses, activeCourse, activeDeck, activeCourseId, activeDeckId,
        addingCourse, newCourseName, renamingId, renameValue, setRenameEl,
        slides, tree, nodes, links, canvasW, canvasH,
        activeSlide, selectedId, collapsedCount, loadingText, exportMenu,
        showAI, aiForm, aiLoading, dragActive, editing, toast, settings, demoUrl,
        previewImage,
        showKP, kpList, kpFilter, kpStats, kpFiltered, kpAILoading, kpSource,
        kpTab, qList, bankFilter,
        bankItems, bankTypes, bankFiltered, bankTypeCount, bankCount, coursePointNames,
        aiButtonTitle, renderMD: QuestionVision.renderMD,
        pickFile, pickFolder, onFile, onFolder, onDrop, openDeck, openBank, goMap,
        startAddCourse, confirmAddCourse, startRename, confirmRename, removeCourse, removeDeck,
        focusSlide, toggleNode, onNodeClick,
        expandAll, collapseBranches, zoomIn, zoomOut, fitView, onWheel,
        onCanvasDown, onCanvasMove, onCanvasUp,
        startEdit, endEdit, openAI, saveAI, applyPreset, aiSummarize,
        showCloud, cloudErr, cloudInfo, cloudBusy,
        openReview, rvFilter, rvIdx, rvFlipped, rvCards, rvCurrent, rvCounts, againCount,
        rvGradable, rvGraded, rvSubmit, rvInput, rvVerdictOK,
        openStats, statItems, attemptSummary, wrongTagStats, kpMastery, wrongItems,
        attemptsMap, revealMap, WRONG_TAGS, wrongSel, qKeyOf, attStatus, recordAttempt, toggleWrongTag, bankStatus,
        rvFilterSet, rvNext, rvPrev, rvMark,
        openCloudSync, cloudPull, cloudPushNow, lastSyncAt,
        extractLocal, extractAI, exportKP, exportBoard,
        pickImages, onImages, processImage, touchImageQ, setType, assignPoint, unassignPoint, removeImageQ, exportCourseBoard,
        showBoardPush, boardLoading, boardReady, boardErr, boardCourses, boardTarget,
        boardPushing, boardPushKP, boardPushQ, pushPoints, pushQuestions,
        openBoardPush, confirmBoardPush,
        showBoardFiles, boardFileBoards, boardFileCourse, currentBoardFiles, pullingId,
        openBoardFiles, pullBoardFile,
        showBoardSubmit, submitDeckName, submitHasFile, onSubmitFilePick, openBoardSubmit, confirmBoardSubmit,
        exportPNG, exportSVG, exportMarkdown, exportJSON, exportFreeMind,
      };
    } catch (e) {
      window.__setupErr = {
        msg: e && e.message,
        stack: (e && e.stack || '').split(String.fromCharCode(10)).slice(0, 8),
      };
      return {};
    }
    },
  }).mount('#app');

  // 临时诊断：捕获 Vue 内部错误（含堆栈）
  const __diagApp = document.querySelector('#app').__vue_app__;
  if (__diagApp) {
    __diagApp.config.errorHandler = (err, inst, info) => {
      window.__appErrs = window.__appErrs || [];
      window.__appErrs.push({
        info,
        msg: err && err.message,
        stack: (err && err.stack || '').split(String.fromCharCode(10)).slice(0, 4).join(' | '),
      });
    };
  }
})();
