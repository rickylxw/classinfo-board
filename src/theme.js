/* 主题：默认跟随系统，可手动切换并记忆 */
import { ref, watchEffect } from 'vue'

const saved = localStorage.getItem('classinfo-theme')
const theme = ref(saved === 'dark' || saved === 'light'
  ? saved
  : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))

watchEffect(() => {
  document.documentElement.dataset.theme = theme.value
  localStorage.setItem('classinfo-theme', theme.value)
  // 同步浏览器地址栏/状态栏颜色（应用内手动切换深色也要跟着变，不能只跟随系统）
  const color = theme.value === 'dark' ? '#0d1017' : '#eef0f5'
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.removeAttribute('media')
    m.setAttribute('content', color)
  }
})

export function useTheme() {
  return {
    theme,
    toggle: () => { theme.value = theme.value === 'dark' ? 'light' : 'dark' }
  }
}
