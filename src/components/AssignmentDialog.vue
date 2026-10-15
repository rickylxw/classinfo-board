<script setup>
import { reactive, ref } from 'vue'
import { store, upsertAssignment, toast, addInlineImage, boardSaveAssignment, submitBoardAssignment } from '../store'
import { courseKeyOf } from '../utils'
import RichText from './RichText.vue'

const props = defineProps({
  assignment: { type: Object, default: null },
  courseId: { type: String, default: null },
  presetCourseId: { type: String, default: null },   // 打开时预设的课程（如个人待办）
  boardKey: { type: String, default: null },     // 共享板模式：负责人直接编辑
  boardItem: { type: Object, default: null },
  submitKey: { type: String, default: null }     // 投稿模式：成员提交，待负责人审核
})
const emit = defineEmits(['close'])

const isBoard = !!props.boardKey
const isSubmit = !!props.submitKey

const form = reactive({
  courseId: props.assignment?.courseId || props.courseId || props.presetCourseId || store.courses[0]?.id || '',
  title: (props.assignment || props.boardItem)?.title || '',
  deadline: (props.assignment || props.boardItem)?.deadline
    ? String((props.assignment || props.boardItem).deadline).slice(0, 16) : '',
  status: props.assignment?.status || 'pending',
  requirement: (props.assignment || props.boardItem)?.requirement || ''
})

const reqInput = ref(null)
const preview = ref(false)
const imgInput = ref(null)
const saving = ref(false)

// 在光标处插入文本
function insertAtCursor(el, text) {
  const s = el.selectionStart ?? el.value.length
  const e = el.selectionEnd ?? s
  el.value = el.value.slice(0, s) + text + el.value.slice(e)
  el.selectionStart = el.selectionEnd = s + text.length
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.focus()
}

async function insertImageFile(file) {
  if (!file.type.startsWith('image/')) { toast('只支持图片文件', 'error'); return }
  if (isBoard) { toast('共享作业暂不支持内嵌图片（图片存在个人空间，同学看不到），请用「共享附件」上传图片', 'error'); return }
  const id = await addInlineImage(file, form.courseId)
  if (id && reqInput.value) {
    const name = file.name || '图片'
    insertAtCursor(reqInput.value, `${form.requirement && !form.requirement.endsWith('\n') ? '\n' : ''}![${name}](cbimg://${id})\n`)
  }
}

function onReqPaste(e) {
  const file = [...(e.clipboardData?.items || [])]
    .find(i => i.kind === 'file' && i.type.startsWith('image/'))
    ?.getAsFile()
  if (file) {
    e.preventDefault()
    insertImageFile(file)
  }
}

async function save() {
  if (saving.value) return
  if (!form.title.trim()) return
  saving.value = true
  try {
    if (isBoard) {
      await boardSaveAssignment(props.boardKey, {
        id: props.boardItem?.id,
        title: form.title.trim(),
        deadline: form.deadline,
        requirement: form.requirement.trim()
      })
      emit('close')
      return
    }
    if (isSubmit) {
      await submitBoardAssignment(props.submitKey, {
        title: form.title.trim(),
        deadline: form.deadline,
        requirement: form.requirement.trim()
      })
      emit('close')
      return
    }
    if (!store.courses.length && form.courseId !== 'personal') { toast('请先创建课程', 'error'); return }
    if (!form.courseId) return
    upsertAssignment({
      id: props.assignment?.id,
      courseId: form.courseId,
      title: form.title.trim(),
      deadline: form.deadline,
      status: form.status,
      requirement: form.requirement.trim()
    })
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="$emit('close')">
      <form class="dlg-body" @submit.prevent="save">
        <h2>{{ isBoard
          ? (props.boardItem ? '编辑共享作业' : '添加共享作业')
          : isSubmit ? '投稿到共享板（待负责人审核）'
          : (props.assignment ? '编辑作业' : '添加作业') }}</h2>

        <div class="field">
          <label>课程 *</label>
          <select v-if="!isBoard && !isSubmit" v-model="form.courseId" required>
            <option value="personal">📌 个人待办（不属于任何课程）</option>
            <option v-if="!store.courses.length" value="" disabled>（还没有课程，可先选个人待办）</option>
            <option v-for="c in store.courses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <input v-else :value="form.courseId === 'personal' ? '📌 个人待办' : store.courses.find(c => courseKeyOf(c) === (boardKey || submitKey))?.name || '共享板'" disabled>
        </div>
        <div class="field">
          <label>标题 *</label>
          <input v-model="form.title" required maxlength="80" placeholder="例如：Lab2 二叉树实现">
        </div>
        <div class="row2">
          <div class="field"><label>截止时间 (DDL)</label><input type="datetime-local" v-model="form.deadline"></div>
          <div v-if="!isBoard && !isSubmit" class="field">
            <label>状态</label>
            <select v-model="form.status">
              <option value="pending">待完成</option>
              <option value="done">已完成</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>作业要求 <span class="muted">（支持 Markdown / HTML，可直接粘贴截图）</span></label>
          <textarea
            ref="reqInput"
            v-model="form.requirement" rows="6"
            placeholder="## 提交说明&#10;- 命名：**学号-姓名-Lab2.zip**&#10;- 截止前上传课程平台&#10;&#10;也可直接 Ctrl+V 粘贴截图"
            @paste="onReqPaste"></textarea>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button type="button" class="btn sm" @click="imgInput.click()">🖼 插入图片</button>
            <button type="button" class="btn sm" :class="{ primary: preview }" @click="preview = !preview">
              {{ preview ? '✏️ 编辑' : '👁 预览' }}
            </button>
          </div>
          <input type="file" ref="imgInput" accept="image/*" hidden @change="e => { if (e.target.files[0]) insertImageFile(e.target.files[0]); e.target.value = '' }">
          <div v-if="preview && form.requirement.trim()" class="req-body" style="margin-top:8px;">
            <RichText :text="form.requirement" />
          </div>
        </div>

        <div class="dlg-actions">
          <button type="button" class="btn" @click="emit('close')">取消</button>
          <button type="submit" class="btn primary" :disabled="saving">
            <span v-if="saving" class="spinner"></span>{{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
