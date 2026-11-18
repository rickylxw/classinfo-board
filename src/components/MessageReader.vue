<script setup>
/* 群消息阅读器（仅桌面端）：本机 QQ Reader 消息库的只读视图
 * 数据源：QQ Reader 服务 127.0.0.1:3210 的 4 个只读 API（经主进程代理），
 * 聚合 QQ / 微信 / 数智东南 三个来源。交互对齐 QQ Reader web 版：
 * 会话列表 + 来源过滤 + 气泡流（日分隔、向上翻页）+ 全文搜索（点结果跳会话）。
 */
import { computed, onMounted, onBeforeUnmount, nextTick, reactive, ref } from 'vue'
import { store } from '../store'
import { isDesktop, qqApi, probeQQ, qqReason } from '../qqreader'

const SRC = [
  { key: '', label: '全部' },
  { key: 'qq', label: 'QQ' },
  { key: 'wechat', label: '微信' },
  { key: 'seu', label: '数智东南' }
]
const SRC_LABEL = { qq: 'QQ', wechat: '微信', seu: '东南' }

const state = reactive({
  ready: false,
  reason: '',
  srcFilter: '',
  chats: [],
  stats: '',
  conv: null,       // 当前会话 conv 串：source|chat_type|key
  convMeta: null,   // { name, source, chat_type, cnt }
  messages: [],     // 按时间升序
  before: 0,        // 翻页游标：已加载最早一条的 time
  hasMore: false,
  loadingOlder: false,
  searchQ: '',
  searchMode: false,
  results: [],
  loadingChats: false,
  error: ''
})
const msgsEl = ref(null)
let timer = null

const filteredChats = computed(() =>
  state.chats.filter(c => !state.srcFilter || c.source === state.srcFilter)
)

// 日分隔：相邻消息不同天时插入一条分隔项
const displayList = computed(() => {
  const out = []
  let prevDay = ''
  for (const m of state.messages) {
    const day = dayKey(m.time)
    if (day !== prevDay) { out.push({ sep: true, key: 'sep-' + m.message_id, day: fmtDay(m.time) }); prevDay = day }
    out.push(m)
  }
  return out
})

/* ---- 时间格式 ---- */
const dayKey = t => { const d = new Date(t * 1000); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
const fmtDay = t => new Date(t * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
const fmtClock = t => new Date(t * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const fmtFull = t => new Date(t * 1000).toLocaleString('zh-CN', { hour12: false })
function fmtShort(t) {
  const d = new Date(t * 1000), n = new Date()
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (d.toDateString() === n.toDateString()) return hm
  if (d.toDateString() === new Date(n - 86400000).toDateString()) return '昨天 ' + hm
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm
}

/* ---- 展示辅助 ---- */
const nameOf = c => c.display || c.name || '未知'
const whoOf = m => m.direction === 'sent' ? '我' : (m.card || m.nickname || m.chat_key || (m.user_id ?? '') || '群' + (m.group_id ?? ''))
function avColor(s) {
  let h = 0
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 45% 42%)`
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// 搜索结果高亮：先转义再替换关键词（对齐 QQ Reader web 版做法）
function hl(text) {
  const safe = esc(text)
  const q = state.searchQ.trim()
  if (!q) return safe
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  return safe.replace(re, x => `<mark>${x}</mark>`)
}

/* ---- 数据加载 ---- */
// /api/chats 是全库聚合（9 万条消息约 3 秒，QQ Reader 服务端特性），加载中要有占位；
// 深链会话不等它：消息查询有索引、先开，列表回来后再把会话名补上
async function loadChats() {
  try {
    state.chats = await qqApi('/api/chats')
    if (state.conv && state.convMeta?.name === state.conv) {
      const row = state.chats.find(c => c.conv === state.conv)
      if (row) state.convMeta = { name: nameOf(row), source: row.source, chat_type: row.chat_type, cnt: row.cnt }
    }
  } catch (e) { state.error = e.message }
}
async function loadStats() {
  try {
    const s = await qqApi('/api/stats')
    state.stats = (s.sources || []).map(x => `${SRC_LABEL[x.source] ?? x.source} ${(x.cnt || 0).toLocaleString()} 条`).join(' · ')
  } catch { state.stats = '' }
}
async function loadMessages(initial = false) {
  if (!state.conv || (state.loadingOlder && !initial)) return
  state.loadingOlder = true
  state.error = ''
  try {
    const data = await qqApi(`/api/messages?conv=${encodeURIComponent(state.conv)}&before=${state.before}&limit=80`)
    state.hasMore = !!data.hasMore
    if (data.messages?.length) state.before = data.messages[0].time
    const el = msgsEl.value
    const keep = !initial && el ? el.scrollHeight : 0
    state.messages = [...(data.messages || []), ...state.messages]
    await nextTick()
    if (el) el.scrollTop = initial ? el.scrollHeight : el.scrollHeight - keep
  } catch (e) {
    state.error = e.message
  } finally {
    state.loadingOlder = false
  }
}

/* ---- 会话切换 ---- */
function openConv(row) {
  state.conv = row.conv
  state.convMeta = { name: nameOf(row), source: row.source, chat_type: row.chat_type, cnt: row.cnt }
  state.searchMode = false
  state.messages = []
  state.before = 0
  state.hasMore = false
  loadMessages(true)
}
// 深链入口：只有 conv 串（如课程页跳转 qq|group|<群号>），会话列表里找不到就按串硬开
async function openConvString(conv) {
  let row = state.chats.find(c => c.conv === conv)
  if (!row && state.srcFilter) {
    state.srcFilter = ''
    await loadChats()
    row = state.chats.find(c => c.conv === conv)
  }
  if (row) return openConv(row)
  const [source, chat_type] = conv.split('|')
  state.conv = conv
  state.convMeta = { name: conv, source: source || 'qq', chat_type: chat_type === 'private' ? 'private' : 'group', cnt: 0 }
  state.searchMode = false
  state.messages = []
  state.before = 0
  state.hasMore = false
  await loadMessages(true)
}

/* ---- 搜索 ---- */
async function doSearch() {
  const q = state.searchQ.trim()
  if (!q) return
  state.searchMode = true
  state.results = []
  state.error = ''
  try {
    const srcParam = state.srcFilter ? '&source=' + state.srcFilter : ''
    const data = await qqApi(`/api/search?q=${encodeURIComponent(q)}${srcParam}`)
    state.results = data.results || []
  } catch (e) { state.error = e.message }
}
// 点搜索结果跳会话：会话被来源过滤藏住时先清过滤
async function jumpResult(m) {
  let row = state.chats.find(c => c.conv === m.conv)
  if (!row && state.srcFilter) {
    state.srcFilter = ''
    await loadChats()
    row = state.chats.find(c => c.conv === m.conv)
  }
  if (row) openConv(row)
}

function setFilter(key) {
  state.srcFilter = key
  if (state.searchMode) doSearch() // 过滤联动搜索结果（与 web 版一致）
}

async function retry() {
  state.reason = qqReason.value
  state.ready = await probeQQ()
  state.reason = qqReason.value
  if (!state.ready) return
  state.loadingChats = true
  const task = Promise.all([loadChats(), loadStats()]).finally(() => { state.loadingChats = false })
  if (store.view.id) openConvString(String(store.view.id))
  await task
}

function onKey(e) {
  if (e.key === 'Escape' && state.searchMode) state.searchMode = false
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  state.reason = qqReason.value
  state.ready = await probeQQ()
  state.reason = qqReason.value
  if (!state.ready) return
  state.loadingChats = true
  const chatsTask = Promise.all([loadChats(), loadStats()]).finally(() => { state.loadingChats = false })
  // 深链（课程页跳转 qq|group|<群号>）：不等慢的会话列表，先按串直接打开
  if (store.view.id) openConvString(String(store.view.id))
  await chatsTask
  timer = setInterval(() => { loadChats(); loadStats() }, 30000)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="mr-root">
    <!-- 服务不可用：按原因给指引 -->
    <div v-if="!state.ready" class="mr-hint">
      <div class="mr-hint-icon">💬</div>
      <div v-if="!isDesktop">消息阅读需要在「课程信息板」桌面端使用，浏览器 / 手机端不提供。</div>
      <div v-else-if="state.reason === 'starting'">正在拉起本机消息服务…（首次约需数秒）</div>
      <div v-else-if="state.reason === 'unconfigured'">
        未配置消息库路径：在桌面端 exe 同目录放置 <code>.desktop-qqreader-path</code>（内容一行：QQ Reader 项目目录）。
      </div>
      <div v-else>
        无法连接本机消息服务（127.0.0.1:3210）。<br>
        <span class="muted" style="font-size:12px;">
          确认 QQ Reader 的 <code>server.mjs</code> 可运行（需要 Node ≥ 22.5、已生成 messages.db），
          且 <code>.desktop-qqreader-path</code> 指向其目录。
        </span>
      </div>
      <button v-if="isDesktop && state.reason !== 'starting'" class="btn sm" style="margin-top:12px;" @click="retry">🔄 重试</button>
    </div>

    <template v-else>
      <!-- 工具条：来源过滤 + 搜索 + 库存统计 -->
      <div class="mr-toolbar">
        <div class="mr-chips">
          <button
            v-for="s in SRC" :key="s.key"
            class="mr-chip" :class="{ on: state.srcFilter === s.key }"
            @click="setFilter(s.key)">{{ s.label }}</button>
        </div>
        <input
          v-model="state.searchQ"
          class="mr-search"
          placeholder="搜索消息内容，回车执行…"
          @keydown.enter="doSearch">
        <span class="mr-stats">{{ state.stats }}</span>
      </div>

      <div class="mr-body">
        <!-- 左：会话列表 -->
        <div class="mr-sessions">
          <button
            v-for="c in filteredChats" :key="c.conv"
            class="mr-conv" :class="{ on: state.conv === c.conv && !state.searchMode }"
            @click="openConv(c)">
            <span class="mr-ava" :style="{ background: avColor(c.conv) }">
              {{ nameOf(c)[0] ?? '?' }}<i class="mr-badge" :class="c.source">{{ SRC_LABEL[c.source] ?? c.source }}</i>
            </span>
            <span class="mr-conv-main">
              <span class="mr-row">
                <span class="mr-conv-name">{{ c.chat_type === 'group' ? '[群] ' : '' }}{{ nameOf(c) }}</span>
                <span class="mr-conv-time">{{ fmtShort(c.last_time) }}</span>
              </span>
              <span class="mr-row">
                <span class="mr-conv-preview">{{ c.last_dir === 'sent' ? '⇢ ' : '' }}{{ c.last_msg || '（空）' }}</span>
                <span class="mr-conv-cnt">{{ c.cnt }}</span>
              </span>
            </span>
          </button>
          <div v-if="!filteredChats.length" class="mr-empty">{{ state.loadingChats ? '加载中…' : '暂无数据' }}</div>
        </div>

        <!-- 右：消息流 / 搜索结果 -->
        <div class="mr-chat">
          <template v-if="state.searchMode">
            <div class="mr-chat-head">
              <span class="mr-chat-title">🔍 「{{ state.searchQ }}」的搜索结果</span>
              <button class="btn sm" @click="state.searchMode = false">返回会话</button>
            </div>
            <div class="mr-msgs">
              <div class="mr-empty" style="margin:4px 0 12px;">
                共 {{ state.results.length }} 条结果（最多显示 200）· 点结果跳转会话 · Esc 返回
              </div>
              <button v-for="m in state.results" :key="m.message_id" class="mr-sr" @click="jumpResult(m)">
                <span class="mr-sr-meta">
                  <i class="mr-tag" :class="m.source">{{ SRC_LABEL[m.source] ?? m.source }}</i>
                  {{ m.chat_type === 'group' ? '群聊' : '私聊' }} · {{ whoOf(m) }} · {{ fmtFull(m.time) }}
                </span>
                <!-- eslint-disable-next-line vue/no-v-html —— 内容已转义，仅插入 <mark> 高亮 -->
                <span class="mr-sr-text" v-html="hl(m.raw_message)"></span>
              </button>
              <div v-if="!state.results.length" class="mr-empty">无结果</div>
            </div>
          </template>

          <template v-else-if="state.convMeta">
            <div class="mr-chat-head">
              <span class="mr-chat-title">
                <i class="mr-tag" :class="state.convMeta.source">{{ SRC_LABEL[state.convMeta.source] ?? state.convMeta.source }}</i>
                {{ state.convMeta.name }}
              </span>
              <span class="mr-chat-sub">{{ state.convMeta.chat_type === 'group' ? '群聊' : '私聊' }} · {{ state.convMeta.cnt }} 条消息</span>
            </div>
            <div ref="msgsEl" class="mr-msgs">
              <button v-if="state.hasMore" class="mr-more" :disabled="state.loadingOlder" @click="loadMessages()">
                {{ state.loadingOlder ? '加载中…' : '加载更早消息' }}
              </button>
              <template v-for="item in displayList" :key="item.message_id">
                <div v-if="item.sep" class="mr-daysep">{{ item.day }}</div>
                <div v-else class="mr-msg" :class="{ out: item.direction === 'sent' }">
                  <span class="mr-ava sm" :style="{ background: avColor(whoOf(item)) }">{{ whoOf(item)[0] ?? '?' }}</span>
                  <span class="mr-msg-body">
                    <span class="mr-who">{{ whoOf(item) }}</span>
                    <span class="mr-bubble">{{ item.raw_message }}</span>
                    <span class="mr-time">{{ fmtClock(item.time) }}</span>
                  </span>
                </div>
              </template>
            </div>
          </template>

          <div v-else class="mr-placeholder">左侧选择一个会话，或按回车全局搜索</div>
        </div>
      </div>

      <div v-if="state.error" class="mr-error">{{ state.error }}</div>
    </template>
  </div>
</template>

<style scoped>
/* 满高双栏：顶栏 57 + main 上内边 20 + 下内边 48 + 页脚 60 */
.mr-root {
  height: calc(100dvh - 185px);
  min-height: 440px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  overflow: hidden;
}

/* 服务不可用提示 */
.mr-hint {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  padding: 24px;
  color: var(--muted);
}
.mr-hint-icon { font-size: 44px; }
.mr-hint code {
  background: var(--code-bg);
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 12px;
}

/* 工具条 */
.mr-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--card);
  flex-wrap: wrap;
}
.mr-chips { display: flex; gap: 6px; }
.mr-chip {
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  transition: all .12s;
}
.mr-chip:hover { border-color: var(--accent); color: var(--accent); }
.mr-chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.mr-search {
  flex: 1;
  min-width: 180px;
  max-width: 360px;
  margin-left: auto;
  padding: 7px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--bg-soft);
  outline: none;
  transition: border .15s, background .15s;
}
.mr-search:focus { border-color: var(--accent); background: var(--card); }
.mr-stats { color: var(--faint); font-size: 12px; white-space: nowrap; }

/* 主体双栏 */
.mr-body { flex: 1; display: flex; min-height: 0; }
.mr-sessions {
  width: 320px;
  min-width: 240px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--line);
  background: var(--bg-soft);
  display: flex;
  flex-direction: column;
}
.mr-conv {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 14px;
  border: none;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  text-align: left;
  transition: background .12s;
}
.mr-conv:hover { background: var(--card-hover); }
.mr-conv.on { background: var(--accent-weak); box-shadow: inset 3px 0 0 var(--accent); }

.mr-ava {
  position: relative;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 17px;
  font-weight: 600;
}
.mr-ava.sm { width: 36px; height: 36px; font-size: 15px; border-radius: 9px; }
.mr-badge {
  position: absolute;
  bottom: -5px;
  right: -7px;
  font-style: normal;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 8px;
  color: #fff;
  white-space: nowrap;
}
.mr-badge.qq { background: #e8622c; }
.mr-badge.wechat { background: #2aae67; }
.mr-badge.seu { background: #4a7d4e; }

.mr-conv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mr-row { display: flex; justify-content: space-between; gap: 6px; min-width: 0; }
.mr-conv-name {
  font-weight: 600;
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mr-conv-time, .mr-conv-cnt { color: var(--faint); font-size: 11px; flex-shrink: 0; }
.mr-conv-preview {
  flex: 1;
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 右侧 */
.mr-chat { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.mr-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--card);
}
.mr-chat-title { font-weight: 600; font-size: 14.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mr-chat-sub { color: var(--faint); font-size: 12px; flex-shrink: 0; }
.mr-msgs { flex: 1; overflow-y: auto; padding: 14px 24px 20px; }
.mr-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--faint);
  font-size: 13px;
}

.mr-more {
  display: block;
  margin: 0 auto 14px;
  padding: 5px 18px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--bg-soft);
  color: var(--muted);
  font-size: 12px;
  transition: all .12s;
}
.mr-more:hover { color: var(--accent); border-color: var(--accent); }
.mr-more:disabled { opacity: .6; }

.mr-daysep {
  text-align: center;
  color: var(--faint);
  font-size: 12px;
  margin: 14px 0;
}
.mr-msg { display: flex; gap: 10px; margin-bottom: 12px; align-items: flex-start; }
.mr-msg.out { flex-direction: row-reverse; }
.mr-msg-body { max-width: 62%; display: flex; flex-direction: column; }
.mr-msg.out .mr-msg-body { align-items: flex-end; }
.mr-who { font-size: 12px; color: var(--muted); margin-bottom: 3px; }
.mr-bubble {
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13.5px;
  line-height: 1.55;
}
.mr-msg.out .mr-bubble { background: var(--accent-weak); border-color: var(--accent-line); }
.mr-time { font-size: 11px; color: var(--faint); margin-top: 3px; }

/* 搜索结果 */
.mr-sr {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  text-align: left;
  transition: background .12s;
}
.mr-sr:hover { background: var(--card-hover); }
.mr-sr-meta { font-size: 11px; color: var(--muted); }
.mr-sr-text { font-size: 13px; }
.mr-sr-text :deep(mark) {
  background: var(--ok-weak);
  color: var(--ok);
  border-radius: 3px;
  padding: 0 2px;
}
.mr-tag {
  display: inline-block;
  font-style: normal;
  font-size: 10px;
  padding: 0 5px;
  border-radius: 4px;
  margin-right: 5px;
  vertical-align: 1px;
  color: #fff;
}
.mr-tag.qq { background: #e8622c; }
.mr-tag.wechat { background: #2aae67; }
.mr-tag.seu { background: #4a7d4e; }

.mr-empty { text-align: center; color: var(--faint); margin-top: 60px; font-size: 13px; }
.mr-error {
  padding: 6px 16px;
  border-top: 1px solid var(--line);
  background: var(--danger-weak);
  color: var(--danger);
  font-size: 12px;
}

/* 窄屏：会话列表收到上方 */
@media (max-width: 760px) {
  .mr-root { height: calc(100dvh - 195px); }
  .mr-sessions { width: 100%; min-width: 0; max-height: 34%; border-right: none; border-bottom: 1px solid var(--line); }
  .mr-msg-body { max-width: 80%; }
}
</style>
