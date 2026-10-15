<script setup>
import { computed, reactive, ref } from 'vue'
import {
  store, courseById, PERSONAL_ID, PERSONAL_COURSE,
  toggleAssignment, toggleSynced
} from '../store'
import { ddlBadge, fmtDT, courseKeyOf } from '../utils'
import { session } from '../api'
import {
  parseCourseTimes, parseWeeks, mondayOf, addDays, fmtMD, fmtDate,
  getSemStartInput, setSemStart, weekNumberOf
} from '../schedule'

const PERIODS = Array.from({ length: 13 }, (_, i) => i + 1)
const WD_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const weekOffset = ref(0)
// 学期起点以输入框为唯一数据源（storage 只是持久化）
const semStartInput = ref(getSemStartInput())
const semStart = computed(() => {
  if (!semStartInput.value) return null
  const d = mondayOf(new Date(semStartInput.value))
  return isNaN(d) ? null : d
})
const semSet = computed(() => !!semStart.value)

// 查看的这一周：周一 ~ 周日
const monday = computed(() => addDays(mondayOf(new Date()), weekOffset.value * 7))
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(monday.value, i)))
const weekNo = computed(() => {
  if (!semStart.value) return null
  const diff = Math.round((monday.value - semStart.value) / (7 * 864e5))
  return diff >= 0 ? diff + 1 : null
})
const isCurrentWeek = computed(() => weekOffset.value === 0)
const rangeText = computed(() => `${fmtMD(days.value[0])} ~ ${fmtMD(days.value[6])}`)

function go(offset) { weekOffset.value += offset }
function goCurrent() { weekOffset.value = 0 }
function onSemStartChange(e) {
  semStartInput.value = e.target.value
  setSemStart(e.target.value)
  // 登录状态下随账号漫游（其他设备/浏览器自动带上）
  if (session.token && !session.isAdmin) {
    api.putCloudSemStart(e.target.value).catch(() => {})
  }
}

/* ---- 课程格子：解析全部课程的上课时间，命中当前查看周次的放进网格 ---- */
const slots = computed(() => {
  const wk = weekNo.value
  const list = []
  let unparsed = 0
  for (const c of store.courses) {
    const times = parseCourseTimes(c)
    if (!times.length && c.note?.includes('上课时间')) unparsed++
    for (const t of times) {
      if (wk !== null && !t.weeks.has(wk)) continue
      list.push({ course: c, ...t })
    }
  }
  return { list, unparsed }
})

/* ---- 该周 DDL：自己的作业 + 个人待办 + 班级同步（已完成置灰） ---- */
const weekDdls = computed(() => {
  const start = monday.value.getTime()
  const end = start + 7 * 864e5
  const inWeek = a => {
    if (!a.deadline) return false
    const t = new Date(a.deadline).getTime()
    return t >= start && t < end
  }
  const items = []
  for (const a of store.assignments) {
    if (a.archived) continue
    if (!inWeek(a)) continue
    const personal = a.courseId === PERSONAL_ID
    const c = personal ? PERSONAL_COURSE : courseById(a.courseId)
    items.push({ kind: personal ? 'personal' : 'local', a, course: c || PERSONAL_COURSE })
  }
  for (const item of Object.values(store.synced)) {
    const myCourse = store.courses.find(c => courseKeyOf(c) === item.key)
    if (!myCourse) continue
    for (const sa of item.assignments) {
      if (store.syncStatus[sa.id] === 'archived') continue
      if (!inWeek(sa)) continue
      items.push({ kind: 'synced', a: sa, course: myCourse, from: item.from })
    }
  }
  // 按天分组
  const byDay = days.value.map(() => [])
  for (const it of items) {
    const d = new Date(it.a.deadline).getDate()
    const idx = days.value.findIndex(day => day.getDate() === d)
    if (idx > -1) byDay[idx].push(it)
  }
  return byDay
})
function ddlDone(it) {
  return it.kind === 'synced'
    ? store.syncStatus[it.a.id] === 'done'
    : it.a.status === 'done'
}
function onDdlClick(it) {
  if (it.kind === 'synced') toggleSynced(it.a.id)
  else toggleAssignment(it.a.id)
}

const todayCol = computed(() => {
  if (!isCurrentWeek.value) return -1
  const wd = ((new Date().getDay() + 6) % 7) + 1
  return wd
})
</script>

<template>
  <div>
    <div class="page-title">
      <h2>📅 日程表</h2>
      <span class="muted">课程来自课表导入的上课时间；DDL 自动落到对应日期</span>
    </div>

    <section class="card">
      <div class="sch-toolbar">
        <div class="sch-nav">
          <button class="btn sm" @click="go(-1)">‹ 上一周</button>
          <button class="btn sm" :class="{ primary: isCurrentWeek }" @click="goCurrent()">本周</button>
          <button class="btn sm" @click="go(1)">下一周 ›</button>
          <span class="sch-range">{{ rangeText }}</span>
          <span v-if="weekNo" class="badge sch-week">第 {{ weekNo }} 教学周</span>
          <span v-else-if="!semSet" class="badge b-none" title="设置「学期第一周周一」后，课表会按周次过滤、并显示教学周">未设学期起点</span>
        </div>
        <div class="sch-sem">
          <label>学期第一周周一</label>
          <input type="date" :value="semStartInput" @change="onSemStartChange">
        </div>
      </div>

      <div v-if="slots.unparsed" class="muted" style="font-size:12px;margin-bottom:8px;">
        ⚠️ 有 {{ slots.unparsed }} 门课的备注里没有可识别的上课时间（格式：周X · 第X-Y节 · 周次 · 教室），可重新「拉取课表」修复
      </div>

      <!-- 周课表网格 -->
      <div class="sch-grid-wrap">
        <div class="sch-grid" :style="{ '--rows': PERIODS.length + 1 }">
          <div class="sch-head sch-corner"></div>
          <div
            v-for="(name, i) in WD_NAMES" :key="name"
            class="sch-head"
            :class="{ today: i + 1 === todayCol }">{{ name }}<template v-if="i + 1 === todayCol"> · 今天</template><span class="sch-date">{{ fmtMD(days[i]) }}</span></div>

          <template v-for="p in PERIODS" :key="p">
            <div class="sch-period">{{ p }}</div>
            <div
              v-for="i in 7" :key="i"
              class="sch-cell"
              :class="{ today: i === todayCol }"
              :style="{ gridRow: p + 1, gridColumn: i + 1 }"></div>
          </template>

          <!-- 课程块（跨节次） -->
          <div
            v-for="(s, i) in slots.list" :key="i"
            class="sch-class"
            :style="{
              gridColumn: s.weekday + 1,
              gridRow: `${s.start + 1} / span ${s.end - s.start + 1}`,
              '--c': s.course.color
            }"
            :title="`${s.course.name}${s.room ? ' @' + s.room : ''}`">
            <div class="sch-class-name">{{ s.course.name }}</div>
            <div v-if="s.room" class="sch-class-room">@{{ s.room }}</div>
          </div>
        </div>
      </div>

      <!-- 该周 DDL -->
      <div class="card-head" style="margin-top:16px;margin-bottom:8px;">
        <h3>⏰ 本周 DDL</h3>
      </div>
      <div class="sch-ddls">
        <div v-for="(list, i) in weekDdls" :key="i" class="sch-day" :class="{ today: i + 1 === todayCol }">
          <div class="sch-day-head">{{ WD_NAMES[i] }} {{ fmtMD(days[i]) }}</div>
          <div v-for="it in list" :key="it.kind + it.a.id" class="sch-ddl" :class="{ done: ddlDone(it) }">
            <span class="course-chip" :style="{ '--c': it.course?.color }">{{ it.kind === 'personal' ? '📌' : '' }}{{ it.course?.name }}</span>
            <span class="sch-ddl-title" @click="onDdlClick(it)" :title="ddlDone(it) ? '标记未完成' : '标记完成'">{{ it.a.title }}</span>
            <span class="sch-ddl-time">{{ fmtDT(it.a.deadline).split(' ').pop() }}</span>
          </div>
          <div v-if="!list.length" class="muted sch-none">—</div>
        </div>
      </div>
    </section>
  </div>
</template>
