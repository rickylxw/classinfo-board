<script setup>
import { reactive } from 'vue'
import { store, addLink, toast } from '../store'

const props = defineProps({ courseId: { type: String, default: null } })
const emit = defineEmits(['close'])

const form = reactive({
  courseId: props.courseId || store.courses[0]?.id || '',
  name: '',
  url: '',
  note: ''
})

function save() {
  if (!store.courses.length) { toast('请先创建课程', 'error'); return }
  if (!form.name.trim() || !form.url.trim() || !form.courseId) return
  addLink({
    courseId: form.courseId,
    name: form.name.trim(),
    url: form.url.trim(),
    note: form.note.trim()
  })
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="$emit('close')">
      <form class="dlg-body" @submit.prevent="save">
        <h2>添加文件链接</h2>
        <p class="muted" style="margin:0 0 12px;font-size:12px;">适合网盘、课程平台等在线资源；本地文件请用「上传文件」。</p>

        <div class="field">
          <label>所属课程 *</label>
          <select v-model="form.courseId" required>
            <option v-if="!store.courses.length" value="">（请先创建课程）</option>
            <option v-for="c in store.courses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="field"><label>名称 *</label><input v-model="form.name" required maxlength="80" placeholder="如：课件网盘 / 教务系统课程主页"></div>
        <div class="field"><label>链接 *</label><input v-model="form.url" type="url" required placeholder="https://…"></div>
        <div class="field"><label>备注</label><input v-model="form.note" maxlength="120" placeholder="提取码等（可留空）"></div>

        <div class="dlg-actions">
          <button type="button" class="btn" @click="emit('close')">取消</button>
          <button type="submit" class="btn primary">保存</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
