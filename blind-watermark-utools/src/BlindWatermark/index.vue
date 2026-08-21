<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import Embed from './Embed.vue'
import Extract from './Extract.vue'

const tab = ref(0)
const isDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)

let mq
onMounted(() => {
  mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e) => { isDark.value = e.matches }
  mq.addEventListener('change', handler)
})
onUnmounted(() => {
  mq?.removeEventListener('change', handler)
})
</script>

<template>
  <div class="wm-app" :class="{ 'wm-dark': isDark }">
    <!-- Header -->
    <div class="wm-header">
      <h1 class="wm-title">盲水印工具</h1>
      <p class="wm-subtitle">DWT 小波变换 + QIM 量化盲水印</p>
      <div class="wm-tabs">
        <button
          class="wm-tab"
          :class="{ active: tab === 0 }"
          @click="tab = 0"
        >嵌入水印</button>
        <button
          class="wm-tab"
          :class="{ active: tab === 1 }"
          @click="tab = 1"
        >提取水印</button>
      </div>
    </div>

    <!-- Content -->
    <div class="wm-content">
      <Embed v-show="tab === 0" />
      <Extract v-show="tab === 1" />
    </div>

    <!-- Footer -->
    <div class="wm-footer">
      <span>基于 Haar DWT + QIM 的盲水印算法</span>
    </div>
  </div>
</template>
