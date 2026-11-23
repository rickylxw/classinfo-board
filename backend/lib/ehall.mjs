// ehall.mjs — 东南大学 ehall 验证与课表代理（纯网络函数，无本地状态）
const EHALL = 'https://ehall.seu.edu.cn'

async function ehallGet(pathname, cookie) {
  // redirect: 'manual' —— 未登录时 ehall 会 302 到统一认证页，据此判定 Cookie 失效
  return fetch(EHALL + pathname, { headers: { cookie }, redirect: 'manual' })
}

async function ehallTerms(cookie) {
  let r
  try {
    r = await ehallGet('/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do', cookie)
  } catch (e) {
    throw new Error('无法访问 ehall（请检查本机网络能否直连 ehall.seu.edu.cn）')
  }
  if (r.status === 301 || r.status === 302) throw new Error('Cookie 无效或已过期（ehall 重定向到了登录页）')
  if (r.status !== 200) throw new Error('ehall 返回异常 HTTP ' + r.status)
  const j = await r.json().catch(() => null)
  const terms = j?.datas?.xnxqcx?.rows
  if (!Array.isArray(terms) || !terms.length) throw new Error('Cookie 无效或已过期（未返回学期数据）')
  // 实测 PX 越小学期越新
  return [...terms].sort((a, b) => parseInt(a.PX) - parseInt(b.PX))
}

// 按当前日期猜测学期代码：9-1月=秋季(-2)，2-6月=春季(-3)，7-8月=暑期(-1)
function guessCurrentTerm(terms) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const start = m >= 8 ? y : y - 1
  const code = (m >= 9 || m === 1) ? `${start}-${start + 1}-2`
    : (m >= 2 && m <= 6) ? `${start}-${start + 1}-3`
    : `${start}-${start + 1}-1`
  return terms.find(t => t.DM === code)
}

async function ehallTimetable(cookie) {
  const terms = await ehallTerms(cookie)
  // 优先取按日期推断的当前学期，取不到课再从新到旧兜底
  const guess = guessCurrentTerm(terms)
  const ordered = guess ? [guess, ...terms.filter(t => t !== guess)] : terms
  for (const t of ordered) {
    const r = await ehallGet('/jwapp/sys/wdkb/modules/xskcb/xskcb.do?XNXQDM=' + encodeURIComponent(t.DM), cookie).catch(() => null)
    if (!r || r.status !== 200) continue
    const j = await r.json().catch(() => null)
    const rows = j?.datas?.xskcb?.rows
    if (rows?.length) return { term: t.MC, dm: t.DM, rows }
  }
  throw new Error('最近几个学期都没有查到课表数据')
}

// 验证 Cookie 并从课表响应里提取学号（XH）作为账号身份
export async function verifyCookie(cookie) {
  const kb = await ehallTimetable(cookie)
  const xh = kb.rows.find(x => x.XH)?.XH
  if (!xh) throw new Error('Cookie 验证通过，但课表数据里没有学号字段（XH），无法确定账号')
  return { xh: String(xh) }
}

// ehall 心跳：使用期间轻触接口保持保存的 Cookie 会话活跃（10 分钟一次，失败忽略）
let lastBeatAt = 0
export function ehallHeartbeatMaybe(acc) {
  if (acc?.cookie && Date.now() - lastBeatAt > 10 * 60 * 1000) {
    lastBeatAt = Date.now()
    ehallGet('/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do', acc.cookie).catch(() => {})
  }
}

export { ehallTimetable }
