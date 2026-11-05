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
  removeItem,
  clearItems,
  resetStatuses,
  applyProgress,
  serviceSources
} = useImageQueue('extract')

const password = ref('1')
const showPassword = ref(true)
const mode = ref('auto')
const legacyLength = ref('')
const processing = ref(false)
const error = ref('')
const results = ref([])
const exportedPath = ref('')

const successCount = computed(() => results.value.filter(item => item.success).length)
const failureCount = computed(() => results.value.filter(item => !item.success).length)

async function handleExtract () {
  error.value = ''
  exportedPath.value = ''
  results.value = []
  if (!items.value.length) {
    error.value = '请先选择至少一张图片'
    return
  }
  if (!password.value) {
    error.value = '请输入密码'
    return
  }

  processing.value = true
  resetStatuses()
  try {
    const response = await window.services.extractBatch(
      serviceSources(),
      password.value,
      { mode: mode.value, legacyLength: legacyLength.value },
      applyProgress
    )
    results.value = response.results
  } catch (caught) {
    error.value = caught.message || '批量提取失败'
  } finally {
    processing.value = false
  }
}

function copyAll () {
  const text = results.value
    .filter(item => item.success)
    .map(item => `${item.name}\t${item.watermark}`)
    .join('\n')
  if (text) window.utools.copyText(text)
}

function exportCsv () {
  try {
    exportedPath.value = window.services.saveExtractionCsv(results.value, config.downloadsDirectory)
  } catch (caught) {
    error.value = caught.message || '导出失败'
  }
}

function revealExport () {
  if (exportedPath.value) window.services.revealInFolder(exportedPath.value)
}
</script>

<template>
  <form class="wm-workspace wm-workspace-extract" @submit.prevent="handleExtract">
    <FileQueue
      :items="items"
      :error="queueError"
      :max-files="config.maxBatchFiles"
      :total-size="totalSize"
      description="选择需要提取水印的图片"
      :disabled="processing"
      @choose="chooseFiles"
      @drop="addFiles"
      @remove="removeItem"
      @clear="clearItems"
    />

    <div class="wm-form-grid">
      <div class="wm-section-heading wm-field-wide">
        <span class="wm-step">02</span>
        <div><h2>提取设置</h2><p>使用嵌入时的格式与密码</p></div>
      </div>
      <fieldset class="wm-mode-field">
        <legend>图片来源</legend>
        <div class="wm-mode-options">
          <label class="wm-mode-option"><input v-model="mode" type="radio" name="extract-mode" value="auto" :disabled="processing"><span><strong>新版 BWM2</strong><small>自动读取并校验</small></span></label>
          <label class="wm-mode-option"><input v-model="mode" type="radio" name="extract-mode" value="legacy-utools" :disabled="processing"><span><strong>旧版 uTools</strong><small>需要填写长度</small></span></label>
        </div>
      </fieldset>

      <div class="wm-field">
        <label for="extract-password">密码</label>
        <div class="wm-password-field">
          <input
            id="extract-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="off"
            maxlength="128"
            :disabled="processing"
          />
          <button type="button" @click="showPassword = !showPassword">{{ showPassword ? '隐藏' : '显示' }}</button>
        </div>
      </div>

      <div v-if="mode === 'legacy-utools'" class="wm-field wm-field-wide">
        <label for="legacy-length">旧版水印 bit 长度</label>
        <input
          id="legacy-length"
          v-model="legacyLength"
          type="number"
          min="56"
          step="56"
          inputmode="numeric"
          placeholder="旧版嵌入完成时显示的数字"
          :disabled="processing"
        />
        <small>旧版结果没有完整性校验，只能作为候选文本。</small>
      </div>
    </div>

    <div class="wm-submit-row">
      <button type="submit" class="wm-primary-button" :disabled="processing || !items.length">
        <span v-if="processing" class="wm-spinner" aria-hidden="true"></span>
        {{ processing ? '正在逐张提取…' : `提取水印${items.length ? `（${items.length} 张）` : ''}` }}
      </button>
    </div>

    <p v-if="error" class="wm-callout is-error" role="alert">{{ error }}</p>

    <section v-if="results.length" class="wm-extract-results" aria-live="polite">
      <div class="wm-results-head">
        <div>
          <h2>提取结果</h2>
          <p>{{ successCount }} 张成功<template v-if="failureCount">，{{ failureCount }} 张失败</template></p>
        </div>
        <div class="wm-results-actions">
          <button type="button" class="wm-secondary-button" :disabled="!successCount" @click="copyAll">复制成功项</button>
          <button type="button" class="wm-secondary-button" @click="exportCsv">导出 CSV</button>
        </div>
      </div>

      <ul class="wm-output-list">
        <li v-for="item in results" :key="item.name + item.format">
          <div class="wm-output-title">
            <strong :title="item.name">{{ item.name }}</strong>
            <span :class="item.success ? 'is-success' : 'is-failed'">{{ item.success ? (item.verified ? '已校验' : '未校验') : '失败' }}</span>
          </div>
          <pre v-if="item.success">{{ item.watermark }}</pre>
          <p v-else>{{ item.error.message }}</p>
        </li>
      </ul>

      <button v-if="exportedPath" type="button" class="wm-export-link" @click="revealExport">CSV 已保存，点击查看</button>
    </section>
  </form>
</template>
