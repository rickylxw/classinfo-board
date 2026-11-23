// merge.mjs — 数据同步合并（服务器权威，纯函数无状态）
// 客户端推送只能「新增/更新条目」，永远不能整体覆盖或删除云端数据：
//   - 空集合/缺字段 = 不动该集合；推送里没有的条目原样保留
//   - 同 id 条目按客户端副本更新（同一账号的编辑需要备份到云端）
//   - 删除云端条目只能走 POST /data/delete 显式提交 id 白名单
//   - 示例数据（c-demo 等）永不上云，防止新浏览器播种的示例污染真实账号
// 三个写入端点的响应都携带合并后的权威状态 data，客户端必须采用（服务器强制下发）。

const SAMPLE_IDS = new Set(['c-demo', 'a-demo1', 'a-demo2', 'f-demo1'])
const isSampleItem = it => !it || it.id == null || SAMPLE_IDS.has(String(it.id)) || it.sample === true

export function normalizeData(d) {
  return {
    courses: Array.isArray(d?.courses) ? d.courses : [],
    assignments: Array.isArray(d?.assignments) ? d.assignments : [],
    files: Array.isArray(d?.files) ? d.files : [],
    syncStatus: d?.syncStatus && typeof d.syncStatus === 'object' ? d.syncStatus : {}
  }
}

export function mergeList(current, incoming, { addOnly = false } = {}) {
  const out = [...(current || [])]
  const idx = new Map(out.map((it, i) => [String(it.id), i]))
  for (const it of (incoming || [])) {
    if (isSampleItem(it)) continue
    const i = idx.get(String(it.id))
    if (i === undefined) { idx.set(String(it.id), out.length); out.push(it) }
    else if (!addOnly) out[i] = { ...out[i], ...it }
  }
  return out
}

export function mergeAccountData(serverData, body, { addOnly = false } = {}) {
  const cur = normalizeData(serverData)
  const inc = normalizeData(body)
  return {
    courses: mergeList(cur.courses, inc.courses, { addOnly }),
    assignments: mergeList(cur.assignments, inc.assignments, { addOnly }),
    files: mergeList(cur.files, inc.files, { addOnly }),
    // 个人完成/归档状态按 key 合并：客户端已知的 key 以客户端为准，云端多出的 key 保留
    syncStatus: { ...cur.syncStatus, ...inc.syncStatus }
  }
}

// 显式删除：只删除调用方列出的 id，其余云端条目一律保留
export function applyRemovals(serverData, removed) {
  const d = normalizeData(serverData)
  const drop = (list, ids) => {
    const s = new Set((Array.isArray(ids) ? ids : []).map(String))
    return s.size ? list.filter(it => !s.has(String(it.id))) : list
  }
  return {
    courses: drop(d.courses, removed?.courses),
    assignments: drop(d.assignments, removed?.assignments),
    files: drop(d.files, removed?.files),
    syncStatus: d.syncStatus
  }
}
