/* ============================================================
 * board.js — Classinfo Board 对接客户端
 * 经 devserver.py 的 /board-api 反向代理访问 Board 后端（同源，无 CORS 问题）。
 * Board 端点（代理后）：
 *   POST /auth/password-login {xh,password} → {token}
 *   GET  /data                              → {courses,assignments,files}
 *   POST /data/ops {ops:[{op:'upsert',coll:'assignments',items:[...]}]}
 * Board 作业条目：{ id, courseId, title, deadline, status, requirement, createdAt }
 * ============================================================ */
(function () {
  'use strict';

  async function call(base, path, { method = 'GET', token, body } = {}) {
    const res = await fetch(base.replace(/\/+$/, '') + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON 响应 */ }
    if (!res.ok) throw new Error((data && data.error) || ('接口返回 ' + res.status));
    return data;
  }

  /** 学号 + 应用密码登录 → { token, xh } */
  async function login(base, xh, password) {
    if (!xh || !password) throw new Error('请先在设置里填写 Board 学号和应用密码');
    return call(base, '/auth/password-login', { method: 'POST', body: { xh, password } });
  }

  /** 拉取账号数据（含课程列表） */
  async function fetchData(base, token) {
    return call(base, '/data', { token });
  }

  /**
   * 构造推送条目：考点清单 1 条 + 每道题 1 条。
   * id 使用确定性前缀，重复推送 = 更新，不会产生重复作业。
   */
  function buildItems(boardCourseId, courseName, points, questions) {
    const items = [];
    const deckNames = [...new Set((questions || []).map(q => q.deck).filter(Boolean))];
    if (points && points.length) {
      const groups = [[3, '★★★ 高频必考'], [2, '★★ 重点掌握'], [1, '★ 了解即可']];
      let md = `## 📐 考点清单（来自 Class Learning Helper）\n\n> 课程：${courseName} · 共 ${points.length} 个知识点\n`;
      for (const [stars, label] of groups) {
        const list = points.filter(p => p.importance === stars);
        if (!list.length) continue;
        md += `\n### ${label}\n`;
        for (const p of list) {
          const meta = (p.tags || []).join(' / ');
          md += `- [P${p.slide ?? '?'}] ${p.text}${meta ? `（${meta}）` : ''}\n`;
        }
      }
      items.push({
        id: 'clh-' + boardCourseId + '-kp',
        courseId: boardCourseId,
        title: '📐 考点清单' + (deckNames.length ? '｜' + deckNames.join('、').slice(0, 30) : ''),
        deadline: '', status: 'pending', requirement: md, createdAt: Date.now(),
      });
    }
    for (const q of questions || []) {
      const text = String(q.text || '').trim();
      if (!text) continue;
      let h = 0;
      for (const ch of text) h = (h * 31 + ch.codePointAt(0)) >>> 0;
      let md = '## ✏️ 题目\n\n' + (q.md || text) + '\n';
      if (q.solution) md += '\n## 💡 解题方式\n\n' + q.solution + '\n';
      const kps = q.knowledgePoints || q.points || [];
      if (kps.length) md += '\n📌 **关联知识点**：' + kps.join('、') + '\n';
      if (q.deck) md += '\n> 来源：' + q.deck + (q.slide != null ? ` · P${q.slide}` : '') + '\n';
      items.push({
        id: 'clh-' + boardCourseId + '-q-' + h.toString(36),
        courseId: boardCourseId,
        title: '[CLH] ' + (q.type ? q.type + '｜' : '') + text.slice(0, 40) + (text.length > 40 ? '…' : ''),
        deadline: '', status: 'pending', requirement: md.slice(0, 19000), createdAt: Date.now(),
      });
    }
    return items;
  }

  /** 推送：upsert assignments，返回服务器权威数据 */
  async function pushAssignments(base, token, items) {
    return call(base, '/data/ops', {
      method: 'POST', token,
      body: { ops: [{ op: 'upsert', coll: 'assignments', items }] },
    });
  }

  /** 课程名归一化（与 Board 后端 norm 完全一致：trim + 小写 + 去所有空白） */
  function normName(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  }
  /** Board 的课程标识 key = norm(name) + '|' + norm(teacher) */
  function boardKeyOf(course) {
    return normName(course && course.name) + '|' + normName(course && course.teacher);
  }
  /** 在 Board 课程列表里找同名课程（按名称包含匹配，返回最佳候选） */
  function matchCourse(boardCourses, localName) {
    const n = normName(localName);
    if (!n) return null;
    let best = null, bestScore = 0;
    for (const c of boardCourses || []) {
      const bn = normName(c.name);
      if (!bn) continue;
      const score = bn === n ? 3 : bn.includes(n) || n.includes(bn) ? 2 : 0;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    return best;
  }

  /* ---------------- 附件（共享板文件） ---------------- */

  /** GET /sync → 我所在课程的共享板（含 files 列表） */
  async function listSynced(base, token) {
    return call(base, '/sync', { token });
  }

  /** GET /board?key= → 负责人视角的共享板原文（非负责人 403） */
  async function fetchOwnedBoard(base, token, key) {
    try {
      return await call(base, '/board?key=' + encodeURIComponent(key), { token });
    } catch (e) {
      return null;                       // 非负责人 → 忽略
    }
  }

  /** 下载共享附件 → Blob（业务错误时后端返回 JSON） */
  async function downloadShared(base, token, key, id) {
    const res = await fetch(base.replace(/\/+$/, '') + '/board/file/download?key=' + encodeURIComponent(key) + '&id=' + encodeURIComponent(id), {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    if (!res.ok) {
      let msg = '下载失败 ' + res.status;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* 二进制 */ }
      throw new Error(msg);
    }
    return await res.blob();
  }

  /** 上传/投稿附件：PUT 原始字节。负责人 → upload（直接发布）；成员 → submit（待负责人审核） */
  async function putSharedFile(base, token, key, name, blob) {
    const qs = '?key=' + encodeURIComponent(key) + '&name=' + encodeURIComponent(String(name || '附件').slice(0, 120));
    const res = await fetch(base.replace(/\/+$/, '') + '/board/file/upload' + qs, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: blob,
    });
    if (res.ok) return { ok: true, published: true };
    if (res.status === 403) {            // 非负责人 → 降级为投稿（进待审队列）
      const res2 = await fetch(base.replace(/\/+$/, '') + '/board/file/submit' + qs, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: blob,
      });
      let d2 = null;
      try { d2 = await res2.json(); } catch (e) { /* 忽略 */ }
      if (!res2.ok) throw new Error((d2 && d2.error) || ('投稿失败 ' + res2.status));
      return { ok: true, published: false };
    }
    let d = null;
    try { d = await res.json(); } catch (e) { /* 忽略 */ }
    throw new Error((d && d.error) || ('上传失败 ' + res.status));
  }

  window.BoardClient = { login, fetchData, pushAssignments, buildItems, matchCourse, normName, boardKeyOf, listSynced, fetchOwnedBoard, downloadShared, putSharedFile };
})();
