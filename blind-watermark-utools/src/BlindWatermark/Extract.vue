<script setup>
import { ref, onUnmounted } from 'vue'

// ─── 状态 ─────────────────────────────────────────────
const file = ref(null)
const previewUrl = ref('')
const dragOver = ref(false)
const wmLength = ref('')
const password = ref('1')
const loading = ref(false)
const result = ref(null)
const error = ref('')

// ─── 工具函数 ─────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
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

  // 从 data URL 创建 File 对象
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

// ─── 提取水印 ─────────────────────────────────────────
async function handleExtract(e) {
  e.preventDefault()
  error.value = ''
  result.value = null

  if (!file.value) { error.value = '请先上传图片'; return }
  if (!wmLength.value.trim()) { error.value = '请输入水印长度'; return }

  const wmLen = parseInt(wmLength.value, 10)
  if (isNaN(wmLen) || wmLen <= 0) { error.value = '水印长度必须为正整数'; return }

  loading.value = true
  try {
    const base64 = await fileToBase64(file.value)
    const watermarkText = await window.services.extractWatermark(base64, wmLen, password.value)
    result.value = watermarkText
  } catch (err) {
    error.value = err.message || '提取水印失败'
  } finally {
    loading.value = false
  }
}

function handleCopy() {
  if (result.value) window.utools?.copyText(result.value)
}

// ─── 清理 ────────────────────────────────────────────
onUnmounted(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})
</script>

<template>
  <form @submit="handleExtract">
    <!-- 上传区域 -->
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

    <!-- 水印长度 + 密码 -->
    <div class="wm-form-row">
      <div class="wm-form-group wm-flex-1">
        <label class="wm-label">水印长度（bit 数）</label>
        <input
          v-model="wmLength"
          type="text"
          inputmode="numeric"
          class="wm-input"
          placeholder="嵌入时显示的数字"
        />
      </div>
      <div class="wm-form-group wm-flex-1">
        <label class="wm-label">密码</label>
        <input
          v-model="password"
          type="text"
          inputmode="numeric"
          class="wm-input"
        />
      </div>
    </div>

    <!-- 提取按钮 -->
    <button type="submit" class="wm-btn wm-btn-primary" :disabled="loading">
      <template v-if="!loading">🔍 提取水印</template>
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
        <span>✓ 水印提取成功</span>
      </div>
      <div class="wm-result-body">
        <p class="wm-result-label">提取结果</p>
        <div class="wm-result-text">{{ result }}</div>
        <div class="wm-result-actions">
          <button type="button" class="wm-btn wm-btn-primary" @click="handleCopy">📋 复制水印</button>
          <span class="wm-result-hint">乱码说明密码错误或图片已损坏</span>
        </div>
      </div>
    </div>
  </form>
</template>
