<script setup>
import { reactive } from 'vue'
import { store, upsertCourse, CATEGORIES, PALETTE } from '../store'

const props = defineProps({ course: { type: Object, default: null } })
const emit = defineEmits(['close'])

const form = reactive({
  name: props.course?.name || '',
  teacher: props.course?.teacher || '',
  semester: props.course?.semester || '',
  category: props.course?.category || '',
  color: props.course?.color || PALETTE[store.courses.length % PALETTE.length],
  note: props.course?.note || ''
})

function save() {
  if (!form.name.trim()) return
  upsertCourse({
    id: props.course?.id,
    name: form.name.trim(),
    teacher: form.teacher.trim(),
    semester: form.semester.trim(),
    category: form.category,
    color: form.color,
    note: form.note.trim()
  })
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="$emit('close')">
      <form class="dlg-body" @submit.prevent="save">
        <h2>{{ props.course ? '编辑课程' : '新建课程' }}</h2>

        <div class="field">
          <label>课程名称 *</label>
          <input v-model="form.name" required maxlength="60" placeholder="例如：数据结构">
        </div>
        <div class="row2">
          <div class="field"><label>教师</label><input v-model="form.teacher" maxlength="30" placeholder="任课教师"></div>
          <div class="field"><label>学期</label><input v-model="form.semester" maxlength="20" placeholder="如 2026-2027-1"></div>
        </div>
        <div class="field">
          <label>类别</label>
          <select v-model="form.category">
            <option value="">未分类</option>
            <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="field">
          <label>颜色标签</label>
          <div class="swatches">
            <label v-for="c in PALETTE" :key="c" class="swatch">
              <input type="radio" :value="c" v-model="form.color">
              <span :style="{ background: c }"></span>
            </label>
          </div>
        </div>

        <h3>其他</h3>
        <div class="field"><label>课程备注</label><textarea v-model="form.note" rows="2" placeholder="考试形式、成绩构成、上课时间地点…"></textarea></div>
        <div class="muted" style="font-size:12px;">👥 教学群信息为班级共享，由课程负责人/管理员维护，不随个人课程填写。</div>

        <div class="dlg-actions">
          <button type="button" class="btn" @click="emit('close')">取消</button>
          <button type="submit" class="btn primary">保存</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
