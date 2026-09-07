<script setup>
import { ref } from 'vue'
import { formatBytes } from './useImageQueue.js'

defineProps({
  items: { type: Array, required: true },
  error: { type: String, default: '' },
  maxFiles: { type: Number, required: true },
  totalSize: { type: Number, default: 0 },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['choose', 'drop', 'remove', 'clear'])
const dragging = ref(false)

function handleDrop (event) {
  event.preventDefault()
  dragging.value = false
  if (event.dataTransfer?.files?.length) emit('drop', event.dataTransfer.files)
}

function statusLabel (status) {
  return {
    pending: '等待',
    processing: '处理中',
    success: '完成',
    failed: '失败'
  }[status] || '等待'
}
</script>

<template>
  <section class="wm-picker" aria-label="图片列表">
    <button
      type="button"
      class="wm-dropzone"
      :class="{ 'is-dragging': dragging }"
      :disabled="disabled"
      @click="emit('choose')"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop="handleDrop"
    >
      <span class="wm-dropzone-icon" aria-hidden="true">＋</span>
      <span>
        <strong>选择或拖入图片</strong>
        <small>PNG / JPG / BMP / WebP，最多 {{ maxFiles }} 张</small>
      </span>
    </button>

    <div v-if="items.length" class="wm-queue-head">
      <span>{{ items.length }} 张 · {{ formatBytes(totalSize) }}</span>
      <button type="button" class="wm-text-button" :disabled="disabled" @click="emit('clear')">清空</button>
    </div>

    <ul v-if="items.length" class="wm-file-list">
      <li v-for="item in items" :key="item.id" class="wm-file-row">
        <span class="wm-file-icon" aria-hidden="true">▧</span>
        <span class="wm-file-main">
          <strong :title="item.name">{{ item.name }}</strong>
          <small>{{ formatBytes(item.size) }}<template v-if="item.error"> · {{ item.error }}</template></small>
        </span>
        <span class="wm-file-status" :class="`is-${item.status}`">{{ statusLabel(item.status) }}</span>
        <button
          type="button"
          class="wm-remove-button"
          :disabled="disabled"
          :aria-label="`移除 ${item.name}`"
          @click="emit('remove', item.id)"
        >×</button>
      </li>
    </ul>

    <p v-if="error" class="wm-inline-error" role="alert">{{ error }}</p>
  </section>
</template>
