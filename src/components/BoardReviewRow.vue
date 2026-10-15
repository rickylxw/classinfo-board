<script setup>
import { reactive, ref } from 'vue'
import { reviewBoardSubmission } from '../store'
import RichText from './RichText.vue'
import { fmtDT, fmtSize } from '../utils'

const props = defineProps({
  boardKey: { type: String, required: true },
  item: { type: Object, required: true },          // 待审条目（作业或附件）
  type: { type: String, required: true },          // 'assignment' | 'file'
  submitter: { type: String, default: '' }         // 已脱敏的投稿人
})
const emit = defineEmits(['reviewed'])

const editing = ref(false)
const busy = ref(false)
const form = reactive({})

function startEdit() {
  form.title = props.item.title
  form.deadline = String(props.item.deadline || '').slice(0, 16)
  form.requirement = props.item.requirement || ''
  editing.value = true
}
async function review(approve) {
  if (busy.value) return
  busy.value = true
  try {
    const patch = editing.value && approve
      ? { title: form.title, deadline: form.deadline, requirement: form.requirement }
      : {}
    await reviewBoardSubmission(props.boardKey, props.type, props.item.id, approve, patch)
    emit('reviewed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <!-- 附件投稿：无可编辑内容 -->
  <div v-if="type === 'file'" class="file-item">
    <span class="ficon">📎</span>
    <div class="f-main">
      <div class="f-name" :title="item.name">{{ item.name }}</div>
      <div class="f-sub">{{ fmtSize(item.size) }} · {{ submitter }} 投稿</div>
    </div>
    <div class="asg-ops">
      <button class="icon-btn" title="通过并上架同步" :disabled="busy" @click="review(true)">✅</button>
      <button class="icon-btn" title="驳回" :disabled="busy" @click="review(false)">❌</button>
    </div>
  </div>

  <!-- 作业投稿：可展开查看内容，可修改后通过 -->
  <div v-else class="asg">
    <div class="asg-body">
      <template v-if="!editing">
        <div class="asg-top">
          <span class="asg-title">{{ item.title }}</span>
          <span class="badge b-week">成员投稿</span>
        </div>
        <div class="asg-meta">
          <span>{{ submitter }} 投稿</span>
          <span v-if="item.deadline">📅 {{ fmtDT(item.deadline) }}</span>
        </div>
        <details v-if="item.requirement" class="req">
          <summary>作业要求（点击查看内容）</summary>
          <div class="req-body"><RichText :text="item.requirement" /></div>
        </details>
        <div v-else class="muted" style="font-size:12px;margin-top:4px;">（无作业要求内容）</div>
      </template>
      <template v-else>
        <div class="field"><label>标题</label><input v-model="form.title" maxlength="80"></div>
        <div class="field"><label>截止时间</label><input type="datetime-local" v-model="form.deadline"></div>
        <div class="field"><label>作业要求（Markdown）</label><textarea v-model="form.requirement" rows="5"></textarea></div>
      </template>
    </div>
    <div class="asg-ops">
      <template v-if="!editing">
        <button class="icon-btn" title="修改内容后通过" @click="startEdit">✏️</button>
        <button class="icon-btn" title="通过并上架同步" :disabled="busy" @click="review(true)">✅</button>
        <button class="icon-btn" title="驳回" :disabled="busy" @click="review(false)">❌</button>
      </template>
      <template v-else>
        <button class="icon-btn" title="按修改后的内容通过并上架" :disabled="busy" @click="review(true)">✅</button>
        <button class="icon-btn" title="取消修改" :disabled="busy" @click="editing = false">↩️</button>
      </template>
    </div>
  </div>
</template>
