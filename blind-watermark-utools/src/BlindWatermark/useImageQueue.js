import { computed, onMounted, onUnmounted, ref } from 'vue'

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'webp'])

function extensionOf (name) {
  const index = String(name).lastIndexOf('.')
  return index >= 0 ? String(name).slice(index + 1).toLowerCase() : ''
}

export function formatBytes (bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function useImageQueue (queueMode) {
  const config = window.services.getConfig()
  const items = ref([])
  const queueError = ref('')
  const totalSize = computed(() => items.value.reduce((total, item) => total + item.size, 0))

  function addItem (item) {
    if (items.value.length >= config.maxBatchFiles) {
      queueError.value = `每批最多添加 ${config.maxBatchFiles} 张图片`
      return false
    }
    const duplicate = items.value.some(existing => {
      if (item.path && existing.path) return item.path === existing.path
      return !item.path && !existing.path && existing.name === item.name && existing.size === item.size
    })
    if (duplicate) return false
    items.value.push({
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: 'pending',
      error: ''
    })
    return true
  }

  function addPaths (paths) {
    queueError.value = ''
    try {
      const described = window.services.describeFiles(paths)
      let added = 0
      described.forEach(file => { if (addItem(file)) added++ })
      if (added === 0 && !queueError.value) queueError.value = '所选图片已在列表中'
    } catch (error) {
      queueError.value = error.message || '无法添加所选图片'
    }
  }

  function addFiles (files) {
    queueError.value = ''
    let rejected = 0
    let added = 0
    Array.from(files || []).forEach(file => {
      if (!ALLOWED_EXTENSIONS.has(extensionOf(file.name)) || file.size <= 0 || file.size > config.maxFileBytes) {
        rejected++
        return
      }
      const path = typeof file.path === 'string' && file.path ? file.path : null
      if (addItem(path ? { path, name: file.name, size: file.size } : { file, name: file.name, size: file.size })) added++
    })
    if (rejected) queueError.value = `${rejected} 个文件格式不支持或超过 20 MB`
    else if (added === 0 && files?.length) queueError.value = '所选图片已在列表中'
  }

  function chooseFiles () {
    const paths = window.utools.showOpenDialog({
      title: '选择图片',
      filters: [{ name: '图片', extensions: [...ALLOWED_EXTENSIONS] }],
      properties: ['openFile', 'multiSelections']
    })
    if (paths?.length) addPaths(paths)
  }

  function chooseOutputDirectory (currentDirectory) {
    const paths = window.utools.showOpenDialog({
      title: '选择输出目录',
      defaultPath: currentDirectory || config.downloadsDirectory,
      properties: ['openDirectory', 'createDirectory']
    })
    return paths?.[0] || currentDirectory
  }

  function removeItem (id) {
    items.value = items.value.filter(item => item.id !== id)
  }

  function clearItems () {
    items.value = []
    queueError.value = ''
  }

  function resetStatuses () {
    items.value.forEach(item => {
      item.status = 'pending'
      item.error = ''
    })
  }

  function applyProgress (update) {
    const item = items.value[update.index]
    if (!item) return
    item.status = update.status
    item.error = update.error?.message || ''
  }

  function serviceSources () {
    return items.value.map(item => item.path
      ? { path: item.path }
      : { file: item.file, name: item.name })
  }

  function handlePluginFiles (event) {
    if (event.detail?.mode !== queueMode || !Array.isArray(event.detail?.paths)) return
    addPaths(event.detail.paths)
  }

  onMounted(() => window.addEventListener('blind-watermark:add-files', handlePluginFiles))
  onUnmounted(() => window.removeEventListener('blind-watermark:add-files', handlePluginFiles))

  return {
    config,
    items,
    queueError,
    totalSize,
    addPaths,
    addFiles,
    chooseFiles,
    chooseOutputDirectory,
    removeItem,
    clearItems,
    resetStatuses,
    applyProgress,
    serviceSources
  }
}
