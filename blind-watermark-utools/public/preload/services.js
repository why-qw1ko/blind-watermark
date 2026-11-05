/* global window */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const watermarkCore = require('./watermark-core.js')

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 300 * 1024 * 1024
const MAX_PIXELS = 25_000_000
const MAX_BATCH_FILES = 30
const DEFAULT_MAX_DIMENSION = 1600
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp'])
const DATA_URL_PATTERN = /^data:image\/(png|jpe?g|bmp|webp);base64,([A-Za-z0-9+/\r\n]+={0,2})$/i

class InputError extends Error {
  constructor (message, code = 'INPUT_INVALID') {
    super(message)
    this.name = 'InputError'
    this.code = code
  }
}

function ensurePassword (password) {
  const value = String(password ?? '')
  if (!value) throw new InputError('请输入密码')
  if (new TextEncoder().encode(value).length > 128) {
    throw new InputError('密码不能超过 128 字节')
  }
  return value
}

function ensureWatermark (watermark) {
  const value = String(watermark ?? '')
  if (!value.trim()) throw new InputError('请输入水印内容')
  const byteLength = new TextEncoder().encode(value).length
  if (byteLength > watermarkCore.MAX_PAYLOAD_BYTES) {
    throw new InputError(`水印内容不能超过 ${watermarkCore.MAX_PAYLOAD_BYTES} 字节`)
  }
  return value
}

function ensureOutputDirectory (directory) {
  const resolved = path.resolve(directory || window.utools.getPath('downloads'))
  let stats
  try {
    stats = fs.statSync(resolved)
  } catch {
    throw new InputError('输出目录不存在', 'OUTPUT_DIRECTORY_INVALID')
  }
  if (!stats.isDirectory()) throw new InputError('输出位置不是目录', 'OUTPUT_DIRECTORY_INVALID')
  return resolved
}

function estimateBase64Bytes (encoded) {
  const cleaned = encoded.replace(/[\r\n]/g, '')
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0
  return Math.floor(cleaned.length * 3 / 4) - padding
}

function normaliseSource (source, index) {
  const value = typeof source === 'string'
    ? (source.startsWith('data:') ? { dataUrl: source } : { path: source })
    : source
  if (!value || typeof value !== 'object') throw new InputError(`第 ${index + 1} 个文件无效`)

  if (typeof value.path === 'string' && value.path) {
    const resolved = path.resolve(value.path)
    const extension = path.extname(resolved).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new InputError('仅支持 PNG、JPG、BMP、WebP 图片', 'FILE_TYPE_INVALID')
    let stats
    try {
      stats = fs.statSync(resolved)
    } catch {
      throw new InputError('图片文件不存在', 'FILE_NOT_FOUND')
    }
    if (!stats.isFile()) throw new InputError('选择的内容不是文件', 'FILE_TYPE_INVALID')
    if (stats.size <= 0 || stats.size > MAX_FILE_BYTES) {
      throw new InputError('单张图片不能超过 20 MB', 'FILE_SIZE_EXCEEDED')
    }
    return { type: 'path', path: resolved, name: path.basename(resolved), size: stats.size }
  }

  if (typeof value.dataUrl === 'string') {
    const match = DATA_URL_PATTERN.exec(value.dataUrl)
    if (!match) throw new InputError('图片数据格式无效', 'FILE_TYPE_INVALID')
    const size = estimateBase64Bytes(match[2])
    if (size <= 0 || size > MAX_FILE_BYTES) {
      throw new InputError('单张图片不能超过 20 MB', 'FILE_SIZE_EXCEEDED')
    }
    const fallbackName = `image-${index + 1}.${match[1].toLowerCase().replace('jpeg', 'jpg')}`
    const name = path.basename(String(value.name || fallbackName))
    const extension = path.extname(name).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new InputError('仅支持 PNG、JPG、BMP、WebP 图片', 'FILE_TYPE_INVALID')
    return { type: 'data-url', dataUrl: value.dataUrl, name, size }
  }

  if (value.file && typeof value.file.arrayBuffer === 'function') {
    const name = path.basename(String(value.name || value.file.name || `image-${index + 1}.png`))
    const extension = path.extname(name).toLowerCase()
    const size = Number(value.file.size)
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new InputError('仅支持 PNG、JPG、BMP、WebP 图片', 'FILE_TYPE_INVALID')
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
      throw new InputError('单张图片不能超过 20 MB', 'FILE_SIZE_EXCEEDED')
    }
    return { type: 'blob', file: value.file, name, size }
  }

  throw new InputError('图片来源无效')
}

function prepareSources (sources) {
  if (!Array.isArray(sources) || sources.length === 0) throw new InputError('请先选择图片')
  if (sources.length > MAX_BATCH_FILES) {
    throw new InputError(`每批最多处理 ${MAX_BATCH_FILES} 张图片`, 'BATCH_SIZE_EXCEEDED')
  }
  const prepared = sources.map(normaliseSource)
  const totalBytes = prepared.reduce((total, source) => total + source.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new InputError('整批图片不能超过 300 MB', 'BATCH_SIZE_EXCEEDED')
  }
  return prepared
}

async function loadSourceBuffer (source) {
  if (source.type === 'path') return fs.readFileSync(source.path)
  if (source.type === 'blob') return Buffer.from(await source.file.arrayBuffer())
  const match = DATA_URL_PATTERN.exec(source.dataUrl)
  return Buffer.from(match[2].replace(/[\r\n]/g, ''), 'base64')
}

async function decodeSource (source, options = {}) {
  const buffer = await loadSourceBuffer(source)
  const image = window.utools.sharp(buffer, {
    failOn: 'error',
    limitInputPixels: MAX_PIXELS,
    sequentialRead: true
  })

  let metadata
  try {
    metadata = await image.metadata()
  } catch {
    throw new InputError('无法读取图片，请确认文件未损坏', 'IMAGE_DECODE_FAILED')
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) {
    throw new InputError('图片像素过大，最高支持 2500 万像素', 'PIXEL_LIMIT_EXCEEDED')
  }

  const maxDimension = Number.isSafeInteger(options.maxDimension)
    ? Math.max(512, Math.min(4096, options.maxDimension))
    : DEFAULT_MAX_DIMENSION
  let pipeline = image.clone().rotate()
  if (options.resize !== false && Math.max(metadata.width, metadata.height) > maxDimension) {
    pipeline = pipeline.resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true
    })
  }

  try {
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (!info.width || !info.height || info.width * info.height > MAX_PIXELS) {
      throw new InputError('图片像素过大，最高支持 2500 万像素', 'PIXEL_LIMIT_EXCEEDED')
    }
    return { rgba: new Uint8Array(data), width: info.width, height: info.height }
  } catch (error) {
    if (error instanceof InputError) throw error
    throw new InputError('图片解码失败，请尝试转换为 PNG 后重试', 'IMAGE_DECODE_FAILED')
  }
}

function sanitiseStem (filename) {
  const stem = path.parse(path.basename(filename)).name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
  return stem || 'image'
}

function uniquePath (directory, preferredName) {
  const extension = path.extname(preferredName)
  const stem = path.basename(preferredName, extension)
  for (let suffix = 0; suffix < 10_000; suffix++) {
    const name = suffix === 0 ? preferredName : `${stem}-${suffix + 1}${extension}`
    const candidate = path.join(directory, name)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new InputError('无法生成不重复的输出文件名', 'OUTPUT_NAME_EXHAUSTED')
}

function writeBufferAtomic (targetPath, buffer) {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  )
  try {
    fs.writeFileSync(temporaryPath, buffer, { flag: 'wx' })
    fs.renameSync(temporaryPath, targetPath)
  } catch (error) {
    try { fs.unlinkSync(temporaryPath) } catch {}
    throw error
  }
}

async function encodePng (rgba, width, height) {
  return window.utools.sharp(Buffer.from(rgba), {
    raw: { width, height, channels: 4 }
  }).png({ compressionLevel: 9 }).toBuffer()
}

function publicError (error) {
  if (error instanceof InputError || error instanceof watermarkCore.WatermarkError) {
    return { code: error.code || 'PROCESSING_FAILED', message: error.message }
  }
  return { code: 'PROCESSING_FAILED', message: '处理失败，请检查图片后重试' }
}

function notifyProgress (callback, update) {
  if (typeof callback === 'function') {
    try { callback(update) } catch {}
  }
}

function createCoreWorker () {
  const workerUrl = new URL('./preload/watermark-worker.js', window.location.href)
  const worker = new window.Worker(workerUrl)
  const pending = new Map()
  let requestId = 0
  let closed = false
  let failure = null

  function failPending (error) {
    failure = error
    for (const handler of pending.values()) handler.reject(error)
    pending.clear()
  }

  worker.addEventListener('message', event => {
    const message = event.data
    const handler = pending.get(message.id)
    if (!handler) return
    pending.delete(message.id)
    if (message.ok) {
      handler.resolve(message)
      return
    }
    handler.reject(new watermarkCore.WatermarkError(
      message.error?.message || '图片处理失败',
      message.error?.code || 'PROCESSING_FAILED'
    ))
  })
  worker.addEventListener('error', () => {
    failPending(new Error('图片处理线程启动或运行失败'))
  })
  worker.addEventListener('messageerror', () => {
    failPending(new Error('图片处理线程通信失败'))
  })

  return {
    run (payload, transferable = []) {
      if (closed || failure) return Promise.reject(failure || new Error('图片处理线程已关闭'))
      return new Promise((resolve, reject) => {
        const id = ++requestId
        pending.set(id, { resolve, reject })
        try {
          worker.postMessage({ id, ...payload }, transferable)
        } catch (error) {
          pending.delete(id)
          reject(error)
        }
      })
    },
    async close () {
      closed = true
      worker.terminate()
      failPending(new Error('图片处理线程已关闭'))
    }
  }
}

function writeManifest (directory, results) {
  const manifest = {
    schemaVersion: 1,
    algorithmVersion: watermarkCore.FORMAT,
    createdAt: new Date().toISOString(),
    results: results.map(result => ({
      originalName: result.name,
      outputName: result.outputPath ? path.basename(result.outputPath) : null,
      status: result.success ? 'success' : 'failed',
      encodedBits: result.encodedBits || null,
      capacityBits: result.capacityBits || null,
      sha256: result.sha256 || null,
      errorCode: result.error?.code || null
    }))
  }
  const manifestPath = uniquePath(directory, 'blind-watermark-manifest.json')
  writeBufferAtomic(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
  return manifestPath
}

async function embedBatch (sources, watermark, password, options = {}, onProgress) {
  const prepared = prepareSources(sources)
  const safeWatermark = ensureWatermark(watermark)
  const safePassword = ensurePassword(password)
  const outputDirectory = ensureOutputDirectory(options.outputDirectory)
  const results = []
  const coreWorker = createCoreWorker()

  try {
    for (let index = 0; index < prepared.length; index++) {
      const source = prepared[index]
      notifyProgress(onProgress, { index, total: prepared.length, name: source.name, status: 'processing' })
      try {
        const decoded = await decodeSource(source, options)
        const embedded = await coreWorker.run({
          action: 'embed',
          rgba: decoded.rgba.buffer,
          width: decoded.width,
          height: decoded.height,
          text: safeWatermark,
          password: safePassword
        }, [decoded.rgba.buffer])

        const png = await encodePng(new Uint8Array(embedded.rgba), embedded.width, embedded.height)
        const outputPath = uniquePath(outputDirectory, `${sanitiseStem(source.name)}.watermarked.png`)
        writeBufferAtomic(outputPath, png)
        const result = {
          name: source.name,
          success: true,
          outputPath,
          format: embedded.format,
          encodedBits: embedded.encodedBits,
          capacityBits: embedded.capacityBits,
          sha256: crypto.createHash('sha256').update(png).digest('hex')
        }
        results.push(result)
        notifyProgress(onProgress, { index, total: prepared.length, name: source.name, status: 'success' })
      } catch (error) {
        const result = { name: source.name, success: false, error: publicError(error) }
        results.push(result)
        notifyProgress(onProgress, { index, total: prepared.length, name: source.name, status: 'failed', error: result.error })
      }
    }
  } finally {
    await coreWorker.close()
  }

  const manifestPath = prepared.length > 1 ? writeManifest(outputDirectory, results) : null
  return { results, manifestPath, outputDirectory }
}

async function extractBatch (sources, password, options = {}, onProgress) {
  const prepared = prepareSources(sources)
  const safePassword = ensurePassword(password)
  const mode = options.mode === 'legacy-utools' ? 'legacy-utools' : 'auto'
  let legacyLength = null
  if (mode === 'legacy-utools') {
    legacyLength = Number(options.legacyLength)
    if (!Number.isSafeInteger(legacyLength) || legacyLength <= 0 || legacyLength % 56 !== 0) {
      throw new InputError('旧版水印长度必须是 56 的正整数倍', 'LEGACY_LENGTH_INVALID')
    }
  }

  const results = []
  const coreWorker = createCoreWorker()
  try {
    for (let index = 0; index < prepared.length; index++) {
      const source = prepared[index]
      notifyProgress(onProgress, { index, total: prepared.length, name: source.name, status: 'processing' })
      try {
        const decoded = await decodeSource(source, { resize: false })
        const extracted = await coreWorker.run({
          action: mode === 'legacy-utools' ? 'extract-legacy' : 'extract',
          rgba: decoded.rgba.buffer,
          width: decoded.width,
          height: decoded.height,
          legacyLength,
          password: safePassword
        }, [decoded.rgba.buffer])
        const result = {
          name: source.name,
          success: true,
          watermark: extracted.watermark,
          format: extracted.format,
          verified: extracted.verified
        }
        results.push(result)
        notifyProgress(onProgress, { index, total: prepared.length, name: source.name, status: 'success' })
      } catch (error) {
        const result = { name: source.name, success: false, error: publicError(error) }
        results.push(result)
        notifyProgress(onProgress, { index, total: prepared.length, name: source.name, status: 'failed', error: result.error })
      }
    }
  } finally {
    await coreWorker.close()
  }
  return { results }
}

function csvCell (value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function saveExtractionCsv (results, outputDirectory) {
  if (!Array.isArray(results) || results.length === 0) throw new InputError('没有可导出的结果')
  const directory = ensureOutputDirectory(outputDirectory)
  const rows = [['文件名', '状态', '水印内容', '格式', '错误']]
  for (const result of results) {
    rows.push([
      result.name,
      result.success ? '成功' : '失败',
      result.success ? result.watermark : '',
      result.format || '',
      result.error?.message || ''
    ])
  }
  const csv = '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
  const targetPath = uniquePath(directory, 'blind-watermark-results.csv')
  writeBufferAtomic(targetPath, Buffer.from(csv, 'utf8'))
  return targetPath
}

async function embedWatermark (imageData, text, password) {
  const source = normaliseSource(
    typeof imageData === 'string' && imageData.startsWith('data:')
      ? { dataUrl: imageData, name: 'image.png' }
      : { path: imageData },
    0
  )
  const decoded = await decodeSource(source, { resize: false })
  const coreWorker = createCoreWorker()
  try {
    const embedded = await coreWorker.run({
      action: 'embed-legacy',
      rgba: decoded.rgba.buffer,
      width: decoded.width,
      height: decoded.height,
      text: ensureWatermark(text),
      password: ensurePassword(password)
    }, [decoded.rgba.buffer])
    const png = await encodePng(new Uint8Array(embedded.rgba), embedded.width, embedded.height)
    return {
      image: png.toString('base64'),
      wmSize: embedded.encodedBits,
      _selfTest: embedded.verified === text,
      _extracted: embedded.verified,
      _expected: text
    }
  } finally {
    await coreWorker.close()
  }
}

async function extractWatermark (imageData, encodedBitCount, password) {
  const source = normaliseSource(
    typeof imageData === 'string' && imageData.startsWith('data:')
      ? { dataUrl: imageData, name: 'image.png' }
      : { path: imageData },
    0
  )
  const decoded = await decodeSource(source, { resize: false })
  const coreWorker = createCoreWorker()
  try {
    const extracted = await coreWorker.run({
      action: 'extract-legacy',
      rgba: decoded.rgba.buffer,
      width: decoded.width,
      height: decoded.height,
      legacyLength: Number(encodedBitCount),
      password: ensurePassword(password)
    }, [decoded.rgba.buffer])
    return extracted.watermark
  } finally {
    await coreWorker.close()
  }
}

function describeFiles (filePaths) {
  if (!Array.isArray(filePaths)) throw new InputError('文件列表无效')
  return prepareSources(filePaths.map(filePath => ({ path: filePath }))).map(source => ({
    path: source.path,
    name: source.name,
    size: source.size
  }))
}

function revealInFolder (filePath) {
  if (typeof filePath !== 'string' || !filePath) return false
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) return false
  window.utools.shellShowItemInFolder(resolved)
  return true
}

window.services = Object.freeze({
  getConfig: () => ({
    maxFileBytes: MAX_FILE_BYTES,
    maxTotalBytes: MAX_TOTAL_BYTES,
    maxPixels: MAX_PIXELS,
    maxBatchFiles: MAX_BATCH_FILES,
    maxPayloadBytes: watermarkCore.MAX_PAYLOAD_BYTES,
    defaultMaxDimension: DEFAULT_MAX_DIMENSION,
    downloadsDirectory: window.utools.getPath('downloads'),
    format: watermarkCore.FORMAT
  }),
  describeFiles,
  embedBatch,
  extractBatch,
  saveExtractionCsv,
  revealInFolder,
  embedWatermark,
  extractWatermark
})
