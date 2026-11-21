<script setup>
/* 课件助手（Class Learning Helper）：已整体并入本站 /clh/ 路径（同源静态目录）
 * iframe 隔离其全局样式与免构建 Vue 运行时；同源下它直接读本站 classinfo-token 免登录
 */
</script>

<template>
  <div class="clh-page">
    <iframe class="clh-frame" src="/clh/index.html" title="课件助手 · Class Learning Helper"></iframe>
  </div>
</template>

<style scoped>
/* 满高：顶栏 57 + main 上内边 20 + 收紧后的下内边 10 + 页脚 60（.main:has 收紧规则见 style.css） */
.clh-page { height: calc(100dvh - 147px); min-height: 460px; }
.clh-frame {
  width: 100%; height: 100%;
  border: 1px solid var(--line); border-radius: var(--radius);
  background: #fff; display: block;
}
@media (max-width: 760px) {
  .clh-page { height: calc(100dvh - 155px); }
}
</style>
