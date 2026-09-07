<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import Embed from './Embed.vue'
import Extract from './Extract.vue'

const tab = ref('embed')
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
const isDark = ref(window.utools?.isDarkColors?.() ?? mediaQuery.matches)

function handleThemeChange (event) {
  isDark.value = window.utools?.isDarkColors?.() ?? event.matches
}

function handlePluginEnter (action) {
  if (action?.type !== 'files' || !Array.isArray(action.payload)) return
  const paths = action.payload
    .map(item => typeof item === 'string' ? item : item?.path)
    .filter(item => typeof item === 'string' && item)
  if (!paths.length) return
  tab.value = 'embed'
  window.dispatchEvent(new CustomEvent('blind-watermark:add-files', {
    detail: { mode: 'embed', paths }
  }))
}

onMounted(() => {
  mediaQuery.addEventListener('change', handleThemeChange)
  window.utools?.onPluginEnter?.(handlePluginEnter)
})

onUnmounted(() => {
  mediaQuery.removeEventListener('change', handleThemeChange)
})
</script>

<template>
  <main class="wm-app" :class="{ 'wm-dark': isDark }">
    <header class="wm-header">
      <div class="wm-brand">
        <span class="wm-brand-mark" aria-hidden="true">W</span>
        <div>
          <h1>盲水印</h1>
          <p>本地处理 · 跨端互通 · 批量完成</p>
        </div>
      </div>
      <span class="wm-format-badge">BWM2</span>
    </header>

    <nav class="wm-tabs" role="tablist" aria-label="水印操作">
      <button
        id="embed-tab"
        type="button"
        role="tab"
        :aria-selected="tab === 'embed'"
        aria-controls="embed-panel"
        :class="{ active: tab === 'embed' }"
        @click="tab = 'embed'"
      >嵌入水印</button>
      <button
        id="extract-tab"
        type="button"
        role="tab"
        :aria-selected="tab === 'extract'"
        aria-controls="extract-panel"
        :class="{ active: tab === 'extract' }"
        @click="tab = 'extract'"
      >提取水印</button>
    </nav>

    <section
      id="embed-panel"
      v-show="tab === 'embed'"
      class="wm-content"
      role="tabpanel"
      aria-labelledby="embed-tab"
    >
      <Embed />
    </section>
    <section
      id="extract-panel"
      v-show="tab === 'extract'"
      class="wm-content"
      role="tabpanel"
      aria-labelledby="extract-tab"
    >
      <Extract />
    </section>

    <footer class="wm-footer">图片仅在本机处理，不会上传</footer>
  </main>
</template>
