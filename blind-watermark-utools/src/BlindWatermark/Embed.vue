<script setup>
import { ref, onUnmounted } from 'vue'

const MAX_FILE_SIZE = 20 * 1024 * 1024

// ─── 状态 ─────────────────────────────────────────────
const file = ref(null)
const previewUrl = ref('')
const dragOver = ref(false)
const watermark = ref('')
const password = ref('1')
const compress = ref(true)
const loading = ref(false)
const result = ref(null)
const error = ref('')
const downloadUrl = ref('')

// ─── 工具函数 ─────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

function compressImage(file, maxDim = 1024) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let w = img.width, h = img.height
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h)
        w = Math.round(w * ratio); h = Math.round(h * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob((blob) => {
        resolve(new File([blob], file.name, { type: 'image/png' }))
      }, 'image/png')
    }
    URL.revokeObjectURL(img.src = URL.createObjectURL(file))
  })
}

// ─── 文件选择 ─────────────────────────────────────────
function handleFileSelect(f) {
  error.value = ''
  result.value = null
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
  if (downloadUrl.value) {
    URL.revokeObjectURL(downloadUrl.value)
    downloadUrl.value = ''
  }
  if (f) {
    file.value = f
    previewUrl.value = URL.createObjectURL(f)
  } else {
    file.value = null
  }
}

// 点击上传 → uTools 文件对话框
async function handleClickUpload() {
  const files = window.utools.showOpenDialog({
    title: '选择图片',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }],
    properties: ['openFile']
  })
  if (!files || !files.length) return

  const filePath = files[0]
  const dataUrl = window.services.readImageAsBase64(filePath)
  const info = window.services.getFileInfo(filePath)

  // 从 data URL 创建 File 对象，兼容后续处理
  const resp = await fetch(dataUrl)
  const blob = await resp.blob()
  const f = new File([blob], info.name, { type: blob.type })
  handleFileSelect(f)
}

// 拖拽上传
function handleDrop(e) {
  e.preventDefault()
  dragOver.value = false
  if (e.dataTransfer.files?.length) handleFileSelect(e.dataTransfer.files[0])
}

// ─── 嵌入水印 ─────────────────────────────────────────
async function handleEmbed(e) {
  e.preventDefault()
  error.value = ''
  result.value = null

  if (!file.value) { error.value = '请先上传图片'; return }
  if (!watermark.value.trim()) { error.value = '请输入水印内容'; return }
  if (file.value.size > MAX_FILE_SIZE) { error.value = '图片过大'; return }

  loading.value = true
  try {
    let processingFile = file.value
    if (compress.value && file.value.size > 2 * 1024 * 1024) {
      processingFile = await compressImage(file.value, 1024)
    }
    const base64 = await fileToBase64(processingFile)
    const resp = await window.services.embedWatermark(base64, watermark.value, password.value)

    const blob = new Blob(
      [Uint8Array.from(atob(resp.image), c => c.charCodeAt(0))],
      { type: 'image/png' }
    )
    const url = URL.createObjectURL(blob)
    downloadUrl.value = url

    // 自动下载
    const a = document.createElement('a')
    a.href = url; a.download = 'watermarked.png'; a.click()

    result.value = { wmSize: resp.wmSize, _selfTest: resp._selfTest, _extracted: resp._extracted, _expected: resp._expected }
  } catch (err) {
    error.value = err.message || '嵌入水印失败'
  } finally {
    loading.value = false
  }
}

function handleCopyWmSize() {
  if (result.value?.wmSize) window.utools?.copyText(String(result.value.wmSize))
}

function handleDownload() {
  if (downloadUrl.value) {
    const a = document.createElement('a')
    a.href = downloadUrl.value
    a.download = 'watermarked.png'
    a.click()
  }
}

// ─── 清理 ────────────────────────────────────────────
onUnmounted(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value)
})
</script>

<template>
  <form @submit="handleEmbed">
    <!-- 上传区域 -->
    <!-- 有图片 → 预览模式 -->
    <div v-if="previewUrl" class="wm-upload-preview" :class="{ 'wm-drag-over': dragOver }"
      @drop="handleDrop"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
    >
      <img :src="previewUrl" :alt="file?.name" class="wm-upload-img" />
      <div class="wm-upload-img-overlay"></div>
      <span class="wm-upload-img-name">{{ file?.name }} ({{ (file?.size / 1024).toFixed(0) }} KB)</span>
      <button type="button" class="wm-upload-remove" @click="handleFileSelect(null)">✕</button>
    </div>

    <!-- 无图片 → 上传区域（点击调用 uTools 对话框，拖拽直接处理） -->
    <div v-else class="wm-upload-zone" :class="{ 'wm-drag-over': dragOver }"
      @click="handleClickUpload"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop="handleDrop"
    >
      <div class="wm-upload-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
      </div>
      <p class="wm-upload-text">点击选择图片，或拖拽图片到此处</p>
      <p class="wm-upload-hint">支持 PNG / JPG / BMP / WebP</p>
    </div>

    <!-- 水印内容 -->
    <div class="wm-form-group">
      <label class="wm-label">水印内容</label>
      <input
        v-model="watermark"
        type="text"
        class="wm-input"
        placeholder="输入要嵌入的文字水印..."
      />
    </div>

    <!-- 密码 -->
    <div class="wm-form-group">
      <label class="wm-label">密码</label>
      <input
        v-model="password"
        type="text"
        inputmode="numeric"
        class="wm-input"
      />
      <p class="wm-helper">嵌入和提取需使用相同密码</p>
    </div>

    <!-- 压缩开关 -->
    <label class="wm-switch">
      <input type="checkbox" v-model="compress" />
      <span class="wm-switch-track">
        <span class="wm-switch-thumb"></span>
      </span>
      <span class="wm-switch-label">压缩大图</span>
    </label>

    <!-- 嵌入按钮 -->
    <button type="submit" class="wm-btn wm-btn-primary" :disabled="loading">
      <template v-if="!loading">🔒 嵌入水印</template>
      <template v-else>处理中...</template>
    </button>

    <!-- 进度条 -->
    <div v-if="loading" class="wm-progress">
      <div class="wm-progress-bar"></div>
    </div>

    <!-- 错误 -->
    <div v-if="error" class="wm-error">
      <strong>错误</strong>
      <p>{{ error }}</p>
      <button type="button" class="wm-error-close" @click="error = ''">✕</button>
    </div>

    <!-- 成功结果 -->
    <div v-if="result" class="wm-result">
      <div class="wm-result-header wm-result-success">
        <span>✓ 水印嵌入成功</span>
      </div>
      <div class="wm-result-body">
        <p class="wm-result-label">水印 bit 长度 — 提取时必须填写</p>
        <p class="wm-result-value">{{ result.wmSize }}</p>
        <p class="wm-result-warn">请妥善保存此数值</p>

        <!-- 自检结果 -->
        <div v-if="result._selfTest !== undefined" class="wm-selftest" :class="result._selfTest ? 'wm-selftest-ok' : 'wm-selftest-fail'">
          <strong>{{ result._selfTest ? '✓ 算法自检通过' : '✗ 算法自检失败' }}</strong>
          <template v-if="!result._selfTest">
            <p>期望: {{ result._expected }}</p>
            <p>实际: {{ result._extracted }}</p>
          </template>
        </div>

        <div class="wm-result-actions">
          <button type="button" class="wm-btn wm-btn-outline" @click="handleCopyWmSize">📋 复制长度</button>
          <button type="button" class="wm-btn wm-btn-primary" @click="handleDownload">⬇ 下载图片</button>
        </div>
      </div>
    </div>
  </form>
</template>
