/* 东南大学 ehall「我的课表」解析
 * 接口与字段依据：docs/seu-ehall-api-报告.md
 * 每行 rows 记录代表一门课的一个教学时段，同一门课多时段会出现多行，按 KCH+JXBQH+课程名+教师 合并。
 */

// 在 ehall 课表页控制台运行的提取脚本（同源请求自动带登录 cookie）
// 实测要点（2026-10，与调研报告的差异已在实测中修正）：
//   - PX 越小越新；三学期制：DM 末位 1=暑期学校 2=秋季 3=春季
//   - 课表数量字段是 totalSize；未来学期会返回"课程未发布"的空 rows
//   - 复制策略逐级降级：DevTools copy() → clipboard API → 页面内文本框
export const EXTRACT_SCRIPT = `(async () => {
  const termRes = await fetch('/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do').then(r => r.json());
  const terms = termRes.datas.xnxqcx.rows.sort((a, b) => parseInt(a.PX) - parseInt(b.PX));
  let target = null, kb = null;
  for (const t of terms.slice(0, 4)) {           // 从最新学期起，找第一个有课的学期
    const r = await fetch('/jwapp/sys/wdkb/modules/xskcb/xskcb.do?XNXQDM=' + encodeURIComponent(t.DM)).then(x => x.json());
    if (r?.datas?.xskcb?.rows?.length) { target = t; kb = r; break; }
  }
  if (!target) { console.error('最近几个学期都没有查到课程，请确认已登录 / 已选课'); return; }
  const rows = kb.datas.xskcb.rows;
  const text = JSON.stringify({ term: target.MC, rows });
  let ok = false;
  try { copy(text); ok = true; } catch (e) {}
  if (!ok) { try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {} }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:5%;top:5%;width:90%;height:80%;z-index:99999;font-size:12px';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (e) {}
    if (ok) { ta.remove(); } else { console.log('⚠️ 请在页面左上角的文本框中 Ctrl+A 全选后 Ctrl+C 复制'); }
  }
  console.log(ok ? '✅ ' + target.MC + ' 共 ' + rows.length + ' 条记录，JSON 已复制到剪贴板'
                 : '⬆️ ' + target.MC + ' 的课表 JSON 已显示在页面文本框中，手动复制后回到课程信息板粘贴导入');
})();`

const WD = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const EHALL_KB_LINK = 'http://ehall.seu.edu.cn/appShow?appId=4770397878132218'

// 接口里的空值会以字符串 "null" 出现
const clean = v => {
  const s = String(v ?? '').trim()
  return (s === 'null' || s === 'undefined') ? '' : s
}

// "2026-2027学年秋季学期" → "2026-2027 秋"；兼容 春/秋/冬/暑期/第N学期
export function termToCode(mc) {
  const s = String(mc || '').trim()
  const m = /(\d{4}-\d{4})学年\s*(春季|秋季|冬季|暑期学校|第([一二三\d])学期)/.exec(s)
  if (m) {
    if (m[3]) {
      const n = '一二三'.indexOf(m[3])
      return `${m[1]}-${n > -1 ? n + 1 : m[3]}`
    }
    const label = { 春季: '春', 秋季: '秋', 冬季: '冬', 暑期学校: '暑' }[m[2]]
    return `${m[1]} ${label}`
  }
  return s || ''
}

/**
 * 解析粘贴的课表 JSON，接受三种形态：
 * 1. 提取脚本导出 { term, rows: [...] }
 * 2. xskcb.do 原始响应 { datas: { xskcb: { rows } } }
 * 3. 裸 rows 数组
 * 返回 { term, semester, courses: [{ name, teacher, timeText, groupLink }] }
 */
export function parseSeuTimetable(json) {
  let rows = null
  let term = ''
  if (Array.isArray(json)) {
    rows = json
  } else if (json && Array.isArray(json.rows)) {
    rows = json.rows
    term = String(json.term || '')
  } else if (json?.datas?.xskcb?.rows) {
    rows = json.datas.xskcb.rows
  }
  if (!rows || !rows.length) {
    throw new Error('未在 JSON 中找到课表数据（rows）。请确认粘贴的是提取脚本的输出，或 xskcb 接口的完整响应。')
  }

  const map = new Map()
  for (const r of rows) {
    const name = clean(r.KCM)
    if (!name) continue
    const teacher = clean(r.SKJS)
    const key = [clean(r.KCH), clean(r.JXBQH), name, teacher].join('|')
    if (!map.has(key)) map.set(key, { name, teacher, times: [] })

    const bits = []
    const wd = parseInt(clean(r.SKXQ), 10)
    if (wd >= 1 && wd <= 7) bits.push(WD[wd])
    const ks = clean(r.KSJC)
    const js = clean(r.JSJC)
    if (ks && js && ks !== js) bits.push(`第${ks}-${js}节`)
    else if (ks) bits.push(`第${ks}节`)
    if (clean(r.ZCMC)) bits.push(clean(r.ZCMC))
    if (clean(r.JASMC)) bits.push(clean(r.JASMC))
    if (bits.length) map.get(key).times.push(bits.join(' · '))
  }

  const courses = [...map.values()].map(c => ({
    name: c.name,
    teacher: c.teacher,
    timeText: c.times.join('\n'),
    groupLink: EHALL_KB_LINK
  }))
  if (!courses.length) throw new Error('rows 中没有识别到课程（缺少 KCM 字段）。')

  return { term, semester: termToCode(term), courses }
}
