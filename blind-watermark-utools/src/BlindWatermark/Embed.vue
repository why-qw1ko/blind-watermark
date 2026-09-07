<script setup>
import { computed, ref } from 'vue'
import FileQueue from './FileQueue.vue'
import { useImageQueue } from './useImageQueue.js'

const {
  config,
  items,
  queueError,
  totalSize,
  addFiles,
  chooseFiles,
  chooseOutputDirectory,
  removeItem,
  clearItems,
  resetStatuses,
  applyProgress,
  serviceSources
} = useImageQueue('embed')

const watermark = ref('')
const password = ref('1')
const showPassword = ref(false)
const resize = ref(true)
const outputDirectory = ref(config.downloadsDirectory)
const processing = ref(false)
const error = ref('')
const batchResult = ref(null)

const watermarkBytes = computed(() => new TextEncoder().encode(watermark.value).length)
const successCount = computed(() => batchResult.value?.results.filter(item => item.success).length || 0)
const failureCount = computed(() => batchResult.value?.results.filter(item => !item.success).length || 0)

function selectOutputDirectory () {
  outputDirectory.value = chooseOutputDirectory(outputDirectory.value)
}

async function handleEmbed () {
  error.value = ''
  batchResult.value = null
  if (!items.value.length) {
    error.value = '请先选择至少一张图片'
    return
  }
  if (!watermark.value.trim()) {
    error.value = '请输入水印内容'
    return
  }
  if (watermarkBytes.value > config.maxPayloadBytes && config.maxPayloadBytes) {
    error.value = `水印内容不能超过 ${config.maxPayloadBytes} 字节`
    return
  }

  processing.value = true
  resetStatuses()
  try {
    batchResult.value = await window.services.embedBatch(
      serviceSources(),
      watermark.value,
      password.value,
      {
        resize: resize.value,
        maxDimension: config.defaultMaxDimension,
        outputDirectory: outputDirectory.value
      },
      applyProgress
    )
  } catch (caught) {
    error.value = caught.message || '批量嵌入失败'
  } finally {
    processing.value = false
  }
}

function revealResults () {
  const firstOutput = batchResult.value?.results.find(item => item.outputPath)?.outputPath
  if (firstOutput) window.services.revealInFolder(firstOutput)
}
</script>

<template>
  <form class="wm-workspace" @submit.prevent="handleEmbed">
    <FileQueue
      :items="items"
      :error="queueError"
      :max-files="config.maxBatchFiles"
      :total-size="totalSize"
      :disabled="processing"
      @choose="chooseFiles"
      @drop="addFiles"
      @remove="removeItem"
      @clear="clearItems"
    />

    <div class="wm-form-grid">
      <div class="wm-field wm-field-wide">
        <div class="wm-label-row">
          <label for="embed-watermark">水印内容</label>
          <span>{{ watermarkBytes }} / 4096 字节</span>
        </div>
        <textarea
          id="embed-watermark"
          v-model="watermark"
          rows="3"
          placeholder="同一内容将嵌入本批次的所有图片"
          :disabled="processing"
        ></textarea>
      </div>

      <div class="wm-field">
        <label for="embed-password">密码</label>
        <div class="wm-password-field">
          <input
            id="embed-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="off"
            maxlength="128"
            :disabled="processing"
          />
          <button type="button" @click="showPassword = !showPassword">{{ showPassword ? '隐藏' : '显示' }}</button>
        </div>
      </div>

      <div class="wm-field">
        <label>输出目录</label>
        <button type="button" class="wm-directory-button" :disabled="processing" @click="selectOutputDirectory">
          <span :title="outputDirectory">{{ outputDirectory }}</span>
          <strong>更改</strong>
        </button>
      </div>
    </div>

    <label class="wm-check-row">
      <input v-model="resize" type="checkbox" :disabled="processing" />
      <span>
        <strong>限制长边为 {{ config.defaultMaxDimension }}px</strong>
        <small>推荐开启，可控制内存占用并提升批量速度</small>
      </span>
    </label>

    <button type="submit" class="wm-primary-button" :disabled="processing || !items.length">
      <span v-if="processing" class="wm-spinner" aria-hidden="true"></span>
      {{ processing ? '正在逐张处理…' : `嵌入水印${items.length ? `（${items.length} 张）` : ''}` }}
    </button>

    <p v-if="error" class="wm-callout is-error" role="alert">{{ error }}</p>

    <section v-if="batchResult" class="wm-result-card" aria-live="polite">
      <div>
        <span class="wm-result-mark" aria-hidden="true">✓</span>
        <div>
          <h2>处理完成</h2>
          <p>{{ successCount }} 张成功<template v-if="failureCount">，{{ failureCount }} 张失败</template>。新版图片可在 Web 与 uTools 间直接互提。</p>
        </div>
      </div>
      <button v-if="successCount" type="button" class="wm-secondary-button" @click="revealResults">在文件夹中显示</button>
    </section>
  </form>
</template>
