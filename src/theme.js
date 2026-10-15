/* 主题：默认跟随系统，可手动切换并记忆 */
import { ref, watchEffect } from 'vue'

const saved = localStorage.getItem('classinfo-theme')
const theme = ref(saved === 'dark' || saved === 'light'
  ? saved
  : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))

watchEffect(() => {
  document.documentElement.dataset.theme = theme.value
  localStorage.setItem('classinfo-theme', theme.value)
})

export function useTheme() {
  return {
    theme,
    toggle: () => { theme.value = theme.value === 'dark' ? 'light' : 'dark' }
  }
}
