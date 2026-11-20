<script setup>
import { ref } from 'vue'
import { sendFeedback } from '../api'
import { version } from '../../package.json'

const emit = defineEmits(['close'])
const type = ref('bug')
const content = ref('')
const err = ref('')
const busy = ref(false)

async function submit() {
  const c = content.value.trim()
  if (c.length < 5) { err.value = '请描述一下具体情况（至少 5 个字）'; return }
  busy.value = true
  err.value = ''
  try {
    await sendFeedback(type.value, c, 'web-' + version, navigator.userAgent.slice(0, 110))
    emit('close')
  } catch (e) {
    err.value = e.message || '提交失败'
  } finally { busy.value = false }
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <div class="dlg-body">
        <h2>意见反馈</h2>
        <p class="muted" style="margin:0 0 10px;font-size:12px;">
          故障或建议直接提交，自动附上学号（脱敏）、浏览器与版本，管理员在控制台处理。
        </p>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <button class="btn" :class="{ primary: type === 'bug' }" @click="type = 'bug'">🐞 故障</button>
          <button class="btn" :class="{ primary: type === 'idea' }" @click="type = 'idea'">💡 建议</button>
        </div>
        <div class="field">
          <label>具体描述 *（至少 5 个字）</label>
          <textarea
            v-model="content" rows="5" maxlength="2000"
            placeholder="做了什么操作 / 期望什么 / 实际发生了什么"></textarea>
        </div>
        <div v-if="err" class="tt-status error">{{ err }}</div>
        <div class="dlg-actions">
          <button class="btn" @click="emit('close')">取消</button>
          <button class="btn primary" :disabled="busy || content.trim().length < 5" @click="submit">提交</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
