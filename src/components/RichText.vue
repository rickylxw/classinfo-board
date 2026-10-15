<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { renderRich, resolveImage } from '../richtext'

const props = defineProps({ text: { type: String, default: '' } })

const el = ref(null)
const liveUrls = []

// 渲染后把 cbimg://<id> 图片替换为真实 blob URL
async function hydrate() {
  await nextTick()
  if (!el.value) return
  for (const img of el.value.querySelectorAll('img[src^="cbimg://"]')) {
    const id = img.getAttribute('src').slice('cbimg://'.length)
    try {
      img.src = await resolveImage(id)
      img.loading = 'lazy'
      liveUrls.push(img.src)
    } catch (e) {
      img.alt = img.alt || '⚠️ 图片加载失败'
    }
  }
}

watch(() => props.text, hydrate, { immediate: true })
onBeforeUnmount(() => { /* blob URL 由 richtext 模块缓存统一持有，页面级复用，无需逐个撤销 */ })
</script>

<template>
  <div ref="el" class="rich" v-html="renderRich(text)"></div>
</template>
