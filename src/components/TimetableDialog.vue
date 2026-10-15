<script setup>
import { reactive, ref, computed } from 'vue'
import { store, toast, CATEGORIES, importTimetable } from '../store'
import { parseSeuTimetable, EXTRACT_SCRIPT } from '../timetable'
import { copyText } from '../utils'
import { session, fetchTimetable } from '../api'

const emit = defineEmits(['close'])

const pasted = ref('')
const error = ref('')
const parsed = ref(null)                    // { term, semester, courses }
const form = reactive({ semester: '', category: '' })
const rowState = reactive({})               // key -> { checked, category }
const pulling = ref(false)

async function copyScript() {
  if (await copyText(EXTRACT_SCRIPT)) toast('提取脚本已复制，请到 ehall 页面的控制台运行')
}

function applyParsed(result) {
  parsed.value = result
  form.semester = result.semester || result.term
  form.category = ''
  result.courses.forEach(c => {
    rowState[c.name + '|' + c.teacher] = { checked: true, category: '' }
  })
}

// 已登录：后端用保存的 ehall Cookie 直接拉取（Cookie 失效会返回错误提示重新登录）
async function pullDirect() {
  pulling.value = true
  error.value = ''
  try {
    const { term, rows } = await fetchTimetable()
    applyParsed(parseSeuTimetable({ term, rows }))
  } catch (e) {
    error.value = e.message
  } finally {
    pulling.value = false
  }
}

function parse() {
  error.value = ''
  parsed.value = null
  try {
    applyParsed(parseSeuTimetable(JSON.parse(pasted.value)))
  } catch (e) {
    error.value = e.message || 'JSON 解析失败，请检查粘贴内容'
  }
}

function exists(c) {
  return store.courses.some(x => x.name === c.name && (x.semester || '') === (form.semester || '').trim())
}

const rows = computed(() => (parsed.value?.courses || []).map(c => ({
  ...c,
  key: c.name + '|' + c.teacher,
  exists: exists(c)
})))

const importable = computed(() => rows.value.filter(r => !r.exists && rowState[r.key]?.checked))

function doImport() {
  if (!importable.value.length) return
  importTimetable(
    importable.value.map(r => ({
      name: r.name, teacher: r.teacher, timeText: r.timeText, groupLink: r.groupLink,
      category: rowState[r.key].category || form.category
    })),
    { semester: form.semester.trim() }
  )
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="$emit('close')">
      <div class="dlg-body">
        <h2>拉取课表（东南大学 ehall）</h2>

        <!-- 已登录：服务端直接拉取 -->
        <div v-if="session.xh" class="tt-direct">
          <div style="flex:1;">
            已登录 <b>👤 {{ session.xh }}</b><span class="muted">，由后端使用你的 ehall 登录态直接拉取：</span>
          </div>
          <button class="btn primary" :disabled="pulling" @click="pullDirect">
            {{ pulling ? '拉取中…' : '⚡ 直接拉取课表' }}
          </button>
        </div>
        <p v-else class="muted" style="margin:0 0 10px;font-size:12px;">
          💡 登录（顶栏「登录」，粘贴 ehall Cookie）后可在这里一键直接拉取；未登录可按下面说明手动导出。
        </p>

        <details class="tt-how">
          <summary>📋 手动方式：如何导出课表 JSON？</summary>
          <ol>
            <li>浏览器登录 <b>ehall.seu.edu.cn</b>，打开「我的课表」应用（任意 ehall 页面即可）</li>
            <li>按 <b>F12</b> 打开控制台（Console），粘贴运行下面的提取脚本</li>
            <li>脚本会拉取<b>最新学期</b>的课表，并把 JSON 复制到剪贴板</li>
            <li>回到本页粘贴到下方输入框，点「解析预览」</li>
          </ol>
          <pre class="tt-script">{{ EXTRACT_SCRIPT }}</pre>
          <button class="btn sm" @click="copyScript">复制脚本</button>
        </details>

        <div class="field" style="margin-top:14px;">
          <label>粘贴课表 JSON</label>
          <textarea
            v-model="pasted" rows="5"
            placeholder='提取脚本的输出，例如 { "term": "2026-2027学年秋季学期", "rows": [ … ] }'></textarea>
        </div>
        <div v-if="error" class="tt-status error">{{ error }}</div>
        <button class="btn" :disabled="!pasted.trim()" @click="parse">解析预览</button>

        <template v-if="parsed">
          <div class="row2" style="margin-top:16px;">
            <div class="field">
              <label>学期（用于显示与去重）</label>
              <input v-model="form.semester" maxlength="20" placeholder="如 2026-2027 秋">
            </div>
            <div class="field">
              <label>默认类别（未单独选择时应用）</label>
              <select v-model="form.category">
                <option value="">未分类</option>
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
          </div>

          <div class="tt-head">共识别 {{ rows.length }} 门课程，其中 {{ rows.filter(r => r.exists).length }} 门已存在</div>
          <div class="tt-list">
            <div v-for="r in rows" :key="r.key" class="tt-row" :class="{ exists: r.exists }">
              <input type="checkbox" v-model="rowState[r.key].checked" :disabled="r.exists">
              <div class="tt-main">
                <div class="tt-name">
                  {{ r.name }} <span class="muted">· {{ r.teacher || '未知教师' }}</span>
                </div>
                <div v-if="r.timeText" class="tt-time">{{ r.timeText }}</div>
              </div>
              <select class="tt-cat" v-model="rowState[r.key].category" :disabled="r.exists" title="类别">
                <option value="">默认</option>
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
              </select>
              <span v-if="r.exists" class="badge b-done">已存在</span>
            </div>
          </div>
        </template>

        <div class="dlg-actions">
          <button class="btn" @click="emit('close')">取消</button>
          <button class="btn primary" :disabled="!importable.length" @click="doImport">
            导入 {{ importable.length }} 门课程
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
