/* ============================================================
 * store.js — 课程数据持久化（IndexedDB，含 localStorage 兜底）
 * 暴露 window.Store：
 *   all() / put(course) / remove(id) / uid()          主库 clh-helper-main（courses 表）
 *   putFile(id, blob, name) / getFile(id) / removeFile(id)
 *                                     课件原件单独存 clh-helper-files-v3（files 表）
 *
 * 连接策略：每次操作独立开关连接（IDB 打开为毫秒级，写入频率低）。
 * 不缓存连接，避免 versionchange/超时留下"已关闭仍被使用"的僵尸连接；
 * 我们不长期持连接，也永远不会阻塞其他标签页的库升级。
 * ============================================================ */
(function () {
  'use strict';
  const DB_MAIN = 'clh-helper-courses-v3';
  const STORE = 'courses';
  const DB_FILES = 'clh-helper-files-v3';
  const FILES = 'files';
  const LS_KEY = 'clh-courses-fallback';
  const RETRY_DELAY = 300;

  const noIDB = () => typeof indexedDB === 'undefined';

  const req = r => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  function openRaw(name, version, upgrade) {
    return new Promise((resolve, reject) => {
      const rq = version ? indexedDB.open(name, version) : indexedDB.open(name);
      if (upgrade) rq.onupgradeneeded = () => upgrade(rq.result);   // 传入数据库本身
      rq.onblocked = () => reject(new Error('数据库被其他标签页阻塞'));
      rq.onsuccess = () => {
        rq.result.onversionchange = () => { try { rq.result.close(); } catch (e) {} };
        resolve(rq.result);
      };
      rq.onerror = () => reject(rq.error);
    });
  }
  /** 打开 + 操作 + 关闭。4 秒打不开快速失败；失败重试一次（建库升级竞态等瞬时错误） */
  async function withDB(name, version, upgrade, fn) {
    const attempt = async () => {
      const db = await Promise.race([
        openRaw(name, version, upgrade),
        new Promise((_, reject) => setTimeout(() => reject(new Error('数据库打开超时')), 4000)),
      ]);
      try { return await fn(db); } finally { try { db.close(); } catch (e) {} }
    };
    try {
      return await attempt();
    } catch (e1) {
      await new Promise(r => setTimeout(r, RETRY_DELAY));
      try {
        return await attempt();
      } catch (e2) {
        try { window.__storeErr = name + ': ' + (e2 && e2.message || e2); } catch (e3) {}
        throw e2;
      }
    }
  }
  const createMain = db => { if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
  const createFiles = db => { if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES); };

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function lsWrite(list) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) { /* 超出配额则忽略 */ }
  }

  /* ---------------- 主库：课程数据 ---------------- */
  async function all() {
    if (noIDB()) return lsRead();
    let idb = null;
    try {
      idb = await withDB(DB_MAIN, undefined, createMain,
        db => req(db.transaction(STORE).objectStore(STORE).getAll()));
    } catch (e) {
      return lsRead();      // 当次降级；下次调用自动重试 IDB（升级竞态等瞬时错误可自愈）
    }
    // 合并读取：IDB 为主，localStorage 独有的课程并入（治"两个后端各存一半"的分裂）
    // 同 id 时取 updatedAt 较新的那份
    const ls = lsRead();
    if (!ls.length) return idb;
    const byId = new Map();
    for (const c of idb) byId.set(String(c.id), c);
    for (const c of ls) {
      const k = String(c.id);
      const cur = byId.get(k);
      if (!cur) byId.set(k, c);
      else if ((Number(c.updatedAt) || 0) > (Number(cur.updatedAt) || 0)) byId.set(k, c);
    }
    return [...byId.values()];
  }
    async function put(course) {
    const rec = JSON.parse(JSON.stringify(course));
    rec.updatedAt = Date.now();          // 打时间戳，供合并读取时取新
    if (noIDB()) {
      const list = lsRead();
      const i = list.findIndex(c => c.id === rec.id);
      if (i >= 0) list[i] = rec; else list.push(rec);
      lsWrite(list);
      return rec;
    }
    try {
      const db = await open();
      await req(db.transaction(STORE, 'readwrite').objectStore(STORE).put(rec));
      return rec;
    } catch (e) {
      const list = lsRead();
      const i = list.findIndex(c => c.id === rec.id);
      if (i >= 0) list[i] = rec; else list.push(rec);
      lsWrite(list);
      return rec;  // 当次走 LS，下次调用重试 IDB
    }
  }
  async function remove(id) {
    if (noIDB()) {
      lsWrite(lsRead().filter(c => c.id !== id));
      return;
    }
    try {
      await withDB(DB_MAIN, undefined, createMain,
        db => req(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)));
    } catch (e) {
      return remove(id);  // 当次走 LS，下次调用重试 IDB
    }
  }

  /* ---------------- 课件原件库（Blob 直存） ---------------- */
  async function putFile(id, blob, name) {
    if (noIDB()) return false;
    try {
      await withDB(DB_FILES, 2, createFiles,
        db => req(db.transaction(FILES, 'readwrite').objectStore(FILES).put({ blob, name: name || '', addedAt: Date.now() }, id)));
      return true;
    } catch (e) { return false; }
  }
  async function getFile(id) {
    if (noIDB()) return null;
    try {
      return await withDB(DB_FILES, 2, createFiles, async db => {
        const rec = await req(db.transaction(FILES).objectStore(FILES).get(id));
        return rec ? { blob: rec.blob, name: rec.name } : null;
      });
    } catch (e) { return null; }
  }
  async function removeFile(id) {
    if (noIDB()) return;
    try {
      await withDB(DB_FILES, 2, createFiles,
        db => req(db.transaction(FILES, 'readwrite').objectStore(FILES).delete(id)));
    } catch (e) { /* 忽略 */ }
  }


  /* ---------------- 做题记录（独立新库：绝不升级有用户数据的主库） ---------------- */
  const ATT_DB = 'clh-helper-attempts-v3';
  const ATT_STORE = 'attempts';
  const ATT_LS = 'clh-attempts-ls';
  function openAtt() {
    return new Promise((resolve, reject) => {
      const rq = indexedDB.open(ATT_DB, 1);
      rq.onupgradeneeded = () => {
        if (!rq.result.objectStoreNames.contains(ATT_STORE)) rq.result.createObjectStore(ATT_STORE, { keyPath: 'qKey' });
      };
      rq.onblocked = () => reject(new Error('blocked'));
      rq.onsuccess = () => {
        rq.result.onversionchange = () => { try { rq.result.close(); } catch (e) {} };
        resolve(rq.result);
      };
      rq.onerror = () => reject(rq.error);
    });
  }
  function attRead() {
    // IDB + LS 镜像合并（按 updatedAt 取新），治双后端分裂
    let idbRecs = null;
    const idbP = withDB(ATT_DB, 1, db => {
      if (!db.objectStoreNames.contains(ATT_STORE)) db.createObjectStore(ATT_STORE, { keyPath: 'qKey' });
    }, db => req(db.transaction(ATT_STORE).objectStore(ATT_STORE).getAll()));
    return Promise.race([
      idbP.then(v => { idbRecs = v || []; }),
      new Promise(r => setTimeout(r, 4000)),
    ]).then(() => {
      let ls = {};
      try { ls = JSON.parse(localStorage.getItem(ATT_LS) || '{}'); } catch (e) { ls = {}; }
      const byKey = new Map();
      for (const r of (idbRecs || [])) byKey.set(r.qKey, r);
      for (const k of Object.keys(ls)) {
        const cur = byKey.get(k);
        if (!cur || (Number(ls[k].updatedAt) || 0) > (Number(cur.updatedAt) || 0)) byKey.set(k, ls[k]);
      }
      return [...byKey.values()];
    }).catch(() => {
      try { return Object.values(JSON.parse(localStorage.getItem(ATT_LS) || '{}')); } catch (e) { return []; }
    });
  }
  function attWrite(rec) {
    // 双写 IDB + LS 镜像（小记录，开销可忽略）；IDB 失败时 LS 仍可用
    try {
      let m = {};
      try { m = JSON.parse(localStorage.getItem(ATT_LS) || '{}'); } catch (e2) {}
      m[rec.qKey] = rec;
      localStorage.setItem(ATT_LS, JSON.stringify(m));
    } catch (e) {}
    if (noIDB()) return;
    return withDB(ATT_DB, 1, db => {
      if (!db.objectStoreNames.contains(ATT_STORE)) db.createObjectStore(ATT_STORE, { keyPath: 'qKey' });
    }, db => req(db.transaction(ATT_STORE, 'readwrite').objectStore(ATT_STORE).put(rec)))
      .catch(() => {});
  }
  async function attemptsBulkWrite(recs) {
    for (const r of recs) attWrite(r);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  window.Store = { all, put, remove, uid, putFile, getFile, removeFile, attRead, attWrite, attemptsBulkWrite };
})();
