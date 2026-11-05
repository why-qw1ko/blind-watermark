<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import Embed from './Embed.vue'
import Extract from './Extract.vue'

const tab = ref('embed')
const expandedHelp = ref([])
const helpItems = [
  { question: '如何嵌入和提取水印？', answer: '选择或拖入图片，输入水印内容和密码后嵌入。提取时选择生成的图片，填写相同密码；新版 BWM2 会自动识别长度并校验结果。' },
  { question: '生成的图片保存在哪里？', answer: '默认保存到系统下载目录，嵌入前可更改输出目录。批量处理会额外生成结果清单；提取结果可复制或导出 CSV 到下载目录。' },
  { question: '支持多少张图片，图片会上传吗？', answer: '每批最多 30 张，单张最多 20 MB，整批最多 300 MB。图片、水印和密码均在本机处理，不会上传。' },
  { question: 'Web 和 uTools 的水印能互相提取吗？', answer: '新版 BWM2 图片支持两端互相提取。旧版 uTools 图片请选择旧版模式并填写原始 bit 长度；旧版 Web 图片需要在网页版选择旧版 Web 兼容模式。' },
  { question: '密码和盲水印能保护原图吗？', answer: '密码用于水印的位置选择和扰码，不是加密。裁剪、强压缩、截图、滤镜或大幅缩放可能导致提取失败；请保留原图和生成的 PNG，盲水印不能替代版权登记或原始证据。' }
]

function toggleHelp (index) {
  expandedHelp.value = expandedHelp.value.includes(index)
    ? expandedHelp.value.filter(item => item !== index)
    : [...expandedHelp.value, index]
}

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
const themeKey = 'blind-watermark-utools-theme'
let themePreference = null
try {
  const saved = localStorage.getItem(themeKey)
  if (saved === 'light' || saved === 'dark') themePreference = saved
} catch {}
const isDark = ref(themePreference ? themePreference === 'dark' : (window.utools?.isDarkColors?.() ?? mediaQuery.matches))

function handleThemeChange (event) {
  if (!themePreference) isDark.value = window.utools?.isDarkColors?.() ?? event.matches
}

function toggleTheme () {
  isDark.value = !isDark.value
  themePreference = isDark.value ? 'dark' : 'light'
  try { localStorage.setItem(themeKey, themePreference) } catch {}
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
        <div>
          <h1>盲水印</h1>
          <p>本地处理 · 跨端互通 · 批量完成</p>
        </div>
      </div>
      <div class="wm-header-actions">
        <span class="wm-format-badge">BWM2</span>
        <button type="button" class="wm-theme-toggle" :aria-label="isDark ? '切换至浅色模式' : '切换至深色模式'" @click="toggleTheme">
          <svg v-if="isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.9 13.2A8.6 8.6 0 0 1 10.8 3.1 8.6 8.6 0 1 0 20.9 13.2Z"/></svg>
        </button>
      </div>
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
      <button
        id="help-tab"
        type="button"
        role="tab"
        :aria-selected="tab === 'help'"
        aria-controls="help-panel"
        :class="{ active: tab === 'help' }"
        @click="tab = 'help'"
      >使用帮助</button>
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
      id="help-panel"
      v-show="tab === 'help'"
      class="wm-content"
      role="tabpanel"
      aria-labelledby="help-tab"
    >
      <div class="wm-help">
        <div class="wm-help-intro"><h2>使用帮助</h2><p>关于水印的嵌入、提取和保存。</p></div>
        <div class="wm-help-list">
          <div v-for="(item, index) in helpItems" :key="item.question" class="wm-help-item" :class="{ 'is-open': expandedHelp.includes(index) }">
            <h3><button type="button" class="wm-help-toggle" :aria-expanded="expandedHelp.includes(index)" :aria-controls="`wm-help-answer-${index}`" @click="toggleHelp(index)">{{ item.question }}<span class="wm-help-state" aria-hidden="true"></span></button></h3>
            <div :id="`wm-help-answer-${index}`" class="wm-help-answer" :inert="!expandedHelp.includes(index)"><div><p>{{ item.answer }}</p></div></div>
          </div>
        </div>
      </div>
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
