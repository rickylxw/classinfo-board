<script setup>
import { toasts } from '../store'
</script>

<template>
  <div id="toasts">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.msg }}</div>
  </div>
</template>
