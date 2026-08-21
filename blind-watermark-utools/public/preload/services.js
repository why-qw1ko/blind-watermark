/*
 * preload.js - 插件预加载脚本
 * 包含文件读写 + 盲水印算法 (DWT + QIM)
 * 运行于 Node.js 环境，通过 window.services 向前端暴露能力
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('crypto')

// ═══════════════════════════════════════════════════════
//  文件读写服务（原有功能）
// ═══════════════════════════════════════════════════════

// 读文件
function readFile (file) {
  return fs.readFileSync(file, { encoding: 'utf-8' })
}

// 文本写入到下载目录
function writeTextFile (text) {
  const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.txt')
  fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
  return filePath
}

// 图片写入到下载目录
function writeImageFile (base64Url) {
  const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
  if (!matchs) return
  const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
  fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
  return filePath
}

// ═══════════════════════════════════════════════════════
//  盲水印算法 (DWT + QIM)
// ═══════════════════════════════════════════════════════

const QUANT_STEP = 40
const REPETITION_FACTOR = 7
const DWT_LEVELS = 2

// ─── PRNG: 基于密码的伪随机数生成器 ────────────────────

function passwordRandomBytes(password, length) {
  const seed = String(password)
  const buf = Buffer.alloc(length)
  let hash = crypto.createHash('sha256').update(seed).digest()
  let offset = 0
  while (offset < length) {
    const copyLen = Math.min(hash.length, length - offset)
    hash.copy(buf, offset, 0, copyLen)
    offset += copyLen
    if (offset < length) hash = crypto.createHash('sha256').update(hash).digest()
  }
  return buf
}

/**
 * Fisher-Yates 确定性洗牌
 */
function deterministicShuffle(arr, password) {
  const totalBytes = Math.max(arr.length * 4 + 8, 16)
  const randBytes = passwordRandomBytes(password, totalBytes)
  const result = arr.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const offset = (i * 4) % (randBytes.length - 4)
    const r = randBytes.readUInt32LE(offset) % (i + 1)
    ;[result[i], result[r]] = [result[r], result[i]]
  }
  return result
}

/**
 * 生成确定性 bit 序列（用于 XOR 加密水印 bits）
 */
function deterministicBits(password, length) {
  const randBytes = passwordRandomBytes(password, Math.ceil(length / 8))
  const bits = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    bits[i] = (randBytes[i >> 3] >> (i & 7)) & 1
  }
  return bits
}

// ─── 错误纠正编码 ─────────────────────────────────────

function encodeRepetition(bits) {
  const encoded = new Uint8Array(bits.length * REPETITION_FACTOR)
  for (let i = 0; i < bits.length; i++) {
    const v = bits[i]
    for (let j = 0; j < REPETITION_FACTOR; j++) {
      encoded[i * REPETITION_FACTOR + j] = v
    }
  }
  return encoded
}

function decodeRepetition(encoded) {
  const count = Math.floor(encoded.length / REPETITION_FACTOR)
  const decoded = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    let sum = 0
    for (let j = 0; j < REPETITION_FACTOR; j++) {
      sum += encoded[i * REPETITION_FACTOR + j]
    }
    decoded[i] = sum > (REPETITION_FACTOR >> 1) ? 1 : 0
  }
  return decoded
}

// ─── 字符串 ↔ bits ─────────────────────────────────

function textToBits(text) {
  const bytes = new TextEncoder().encode(text)
  const bits = new Uint8Array(bytes.length * 8)
  for (let i = 0; i < bytes.length; i++) {
    for (let b = 0; b < 8; b++) {
      bits[i * 8 + b] = (bytes[i] >> (7 - b)) & 1
    }
  }
  return bits
}

function bitsToText(bits) {
  const len = bits.length - (bits.length % 8)
  const bytes = new Uint8Array(len / 8)
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i * 8 + b]
    }
    bytes[i] = byte
  }
  return new TextDecoder().decode(bytes)
}

// ─── 2D Haar DWT / IDWT ──────────────────────────────

/** 1D Haar DWT（原地变换，长度必须为偶数） */
function dwt1d(signal) {
  const n = signal.length
  if (n < 2 || n % 2 !== 0) return
  const half = n >> 1
  const tmp = new Float64Array(n)
  for (let i = 0; i < half; i++) {
    const a = signal[i * 2], b = signal[i * 2 + 1]
    tmp[i] = (a + b) / Math.SQRT2
    tmp[i + half] = (a - b) / Math.SQRT2
  }
  signal.set(tmp)
}

/** 1D 逆 Haar DWT */
function idwt1d(signal) {
  const n = signal.length
  const half = n >> 1
  const tmp = new Float64Array(n)
  for (let i = 0; i < half; i++) {
    const lo = signal[i], hi = signal[i + half]
    tmp[i * 2] = (lo + hi) / Math.SQRT2
    tmp[i * 2 + 1] = (lo - hi) / Math.SQRT2
  }
  signal.set(tmp)
}

/** 2D DWT：先对每一行，再对每一列做 1D DWT */
function dwt2d(matrix, width, height) {
  for (let y = 0; y < height; y++) {
    dwt1d(matrix.subarray(y * width, (y + 1) * width))
  }
  const colBuf = new Float64Array(height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) colBuf[y] = matrix[y * width + x]
    dwt1d(colBuf)
    for (let y = 0; y < height; y++) matrix[y * width + x] = colBuf[y]
  }
}

/** 2D 逆 DWT */
function idwt2d(matrix, width, height) {
  const colBuf = new Float64Array(height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) colBuf[y] = matrix[y * width + x]
    idwt1d(colBuf)
    for (let y = 0; y < height; y++) matrix[y * width + x] = colBuf[y]
  }
  for (let y = 0; y < height; y++) {
    idwt1d(matrix.subarray(y * width, (y + 1) * width))
  }
}

// ─── LL 子带复制 ──────────────────────────────────────

function copyLLFrom(fullDwt, fullW, fullH) {
  const hw = fullW >> 1, hh = fullH >> 1
  const dst = new Float64Array(hw * hh)
  for (let y = 0; y < hh; y++) {
    const srcOff = y * fullW
    dst.set(fullDwt.subarray(srcOff, srcOff + hw), y * hw)
  }
  return dst
}

function copyLLTo(fullDwt, fullW, fullH, src) {
  const hw = fullW >> 1, hh = fullH >> 1
  for (let y = 0; y < hh; y++) {
    const dstOff = y * fullW
    fullDwt.set(src.subarray(y * hw, (y + 1) * hw), dstOff)
  }
}

// ─── 图像处理辅助 ────────────────────────────────────

function extractYChannel(rgbaData, width, height) {
  const n = width * height
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const off = i * 4
    y[i] = 0.299 * rgbaData[off] + 0.587 * rgbaData[off + 1] + 0.114 * rgbaData[off + 2]
  }
  return y
}

function applyYDelta(rgbaData, newY, oldY, width, height) {
  const n = width * height
  const result = new Uint8Array(rgbaData)
  for (let i = 0; i < n; i++) {
    const delta = Math.round(newY[i] - oldY[i])
    if (delta === 0) continue
    for (let c = 0; c < 3; c++) {
      const v = result[i * 4 + c] + delta
      result[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
  return result
}

function padToMultiple(matrix, width, height, multiple) {
  const newW = Math.ceil(width / multiple) * multiple
  const newH = Math.ceil(height / multiple) * multiple
  // 始终复制，避免修改原始 Y 通道（后续 applyYDelta 需要原始值计算差值）
  const padded = new Float64Array(newW * newH)
  for (let y = 0; y < newH; y++) {
    const srcY = y < height ? y : height - 1
    const srcOff = srcY * width
    const dstOff = y * newW
    for (let x = 0; x < newW; x++) {
      padded[dstOff + x] = matrix[srcOff + (x < width ? x : width - 1)]
    }
  }
  return { data: padded, width: newW, height: newH, origW: width, origH: height }
}

function cropMatrix(padded, padW, padH, origW, origH) {
  const result = new Float64Array(origW * origH)
  for (let y = 0; y < origH; y++) {
    result.set(padded.subarray(y * padW, y * padW + origW), y * origW)
  }
  return result
}

// ─── 盲水印核心 ──────────────────────────────────────

async function embedWatermark(imageBuffer, text, password) {
  // 1. 读取图片 → raw RGBA
  const sharp = window.utools.sharp(imageBuffer, { failOn: 'none' })
  const { data: rgbaData, info } = await sharp.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info

  // 2. 提取 Y 通道
  const yChannel = extractYChannel(rgbaData, width, height)

  // 3. 文本 → bits → 纠错编码 → XOR 加密
  let textBits = textToBits(text)
  const wmSize = textBits.length * REPETITION_FACTOR
  textBits = encodeRepetition(textBits)
  const keyBits = deterministicBits(password, textBits.length)
  for (let i = 0; i < textBits.length; i++) textBits[i] ^= keyBits[i]

  // 4. Pad
  const minSize = 1 << DWT_LEVELS
  const padded = padToMultiple(yChannel, width, height, minSize)
  const padW = padded.width, padH = padded.height
  const origW = padded.origW, origH = padded.origH

  // 5. 容量检查
  const dwtW = padW >> DWT_LEVELS, dwtH = padH >> DWT_LEVELS
  const capacity = dwtW * dwtH
  if (textBits.length > capacity) {
    throw new Error('水印文本过长，请缩减内容或使用更大图片')
  }

  // 6. 密码确定性选择嵌入位置
  const allIndices = Array.from({ length: capacity }, (_, i) => i)
  const selectedIndices = deterministicShuffle(allIndices, password).slice(0, textBits.length)
  const indexMap = new Map()
  for (let i = 0; i < selectedIndices.length; i++) {
    indexMap.set(selectedIndices[i], i)
  }

  // 7. Level-0 DWT → 提取 LL1 → Level-1 DWT → 修改 LL2 → 逆
  const matrix = padded.data
  dwt2d(matrix, padW, padH)

  const ll1W = padW >> 1, ll1H = padH >> 1
  const ll1 = copyLLFrom(matrix, padW, padH)

  dwt2d(ll1, ll1W, ll1H)

  const ll2W = ll1W >> 1, ll2H = ll1H >> 1

  // 8. QIM 嵌入
  for (let y = 0; y < ll2H; y++) {
    for (let x = 0; x < ll2W; x++) {
      const ll2Idx = y * ll2W + x
      if (!indexMap.has(ll2Idx)) continue
      const bitIdx = indexMap.get(ll2Idx)
      const bit = textBits[bitIdx]
      const pos = y * ll1W + x
      const c = ll1[pos]
      const q = Math.round(c / QUANT_STEP)
      if ((Math.abs(q) % 2) === bit) {
        ll1[pos] = q * QUANT_STEP
      } else {
        ll1[pos] = q >= 0 ? (q + 1) * QUANT_STEP : (q - 1) * QUANT_STEP
      }
    }
  }

  // 9. 逆 Level-1 DWT on LL1
  idwt2d(ll1, ll1W, ll1H)
  copyLLTo(matrix, padW, padH, ll1)

  // 10. 逆 Level-0 DWT
  idwt2d(matrix, padW, padH)

  // 11. Crop & 应用到 RGB
  const newYChannel = cropMatrix(matrix, padW, padH, origW, origH)
  const resultRGBA = applyYDelta(rgbaData, newYChannel, yChannel, origW, origH)

  // 12. 编码为 PNG
  const output = await window.utools.sharp(Buffer.from(resultRGBA), {
    raw: { width: origW, height: origH, channels: 4 }
  }).png().toBuffer()

  return { image: output.toString('base64'), wmSize }
}

async function extractWatermark(imageBuffer, wmSize, password) {
  // 1. 读取图片 → raw RGBA
  const sharp = window.utools.sharp(imageBuffer, { failOn: 'none' })
  const { data: rgbaData, info } = await sharp.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info

  // 2. 提取 Y 通道
  const yChannel = extractYChannel(rgbaData, width, height)

  // 3. Pad
  const minSize = 1 << DWT_LEVELS
  const padded = padToMultiple(yChannel, width, height, minSize)
  const padW = padded.width, padH = padded.height

  // 4. 容量检查
  const dwtW = padW >> DWT_LEVELS, dwtH = padH >> DWT_LEVELS
  const capacity = dwtW * dwtH
  if (wmSize > capacity) throw new Error(`水印长度 ${wmSize} 超过图像容量 ${capacity}`)

  // 5. 生成提取位置
  const allIndices = Array.from({ length: capacity }, (_, i) => i)
  const selectedIndices = deterministicShuffle(allIndices, password).slice(0, wmSize)

  // 6. Level-0 DWT → 提取 LL1 → Level-1 DWT → 读取 LL2
  const matrix = padded.data
  dwt2d(matrix, padW, padH)

  const ll1W = padW >> 1, ll1H = padH >> 1
  const ll1 = copyLLFrom(matrix, padW, padH)

  dwt2d(ll1, ll1W, ll1H)

  const ll2W = ll1W >> 1

  // 7. 从 LL2 提取 bits
  const bits = new Uint8Array(wmSize)
  for (let i = 0; i < selectedIndices.length; i++) {
    const idx = selectedIndices[i]
    const y = Math.floor(idx / ll2W)
    const x = idx % ll2W
    const pos = y * ll1W + x
    const c = ll1[pos]
    const q = Math.round(c / QUANT_STEP)
    bits[i] = Math.abs(q) % 2
  }

  // 8. XOR 解密
  const keyBits = deterministicBits(password, wmSize)
  for (let i = 0; i < wmSize; i++) bits[i] ^= keyBits[i]

  // 9. 纠错解码 → 文本
  const decodedBits = decodeRepetition(bits)
  return bitsToText(decodedBits)
}

// ═══════════════════════════════════════════════════════
//  暴露给前端
// ═══════════════════════════════════════════════════════

window.services = {
  // 文件读写（原有）
  readFile,
  writeTextFile,
  writeImageFile,

  // 盲水印（新增）
  embedWatermark: async (imageBase64, text, password) => {
    let buffer
    if (/^data:image\/[a-z0-9]+;base64,/i.test(imageBase64)) {
      buffer = Buffer.from(imageBase64.replace(/^data:image\/[a-z0-9]+;base64,/i, ''), 'base64')
    } else if (fs.existsSync(imageBase64)) {
      buffer = fs.readFileSync(imageBase64)
    } else {
      throw new Error('无效的图片数据')
    }
    const result = await embedWatermark(buffer, text, password)

    // 自检：从嵌入结果中立即提取，验证算法闭环
    const outputBuffer = Buffer.from(result.image, 'base64')
    const extracted = await extractWatermark(outputBuffer, result.wmSize, password)
    result._selfTest = extracted === text
    result._extracted = extracted
    result._expected = text
    return result
  },

  extractWatermark: async (imageBase64, wmSize, password) => {
    let buffer
    if (/^data:image\/[a-z0-9]+;base64,/i.test(imageBase64)) {
      buffer = Buffer.from(imageBase64.replace(/^data:image\/[a-z0-9]+;base64,/i, ''), 'base64')
    } else if (fs.existsSync(imageBase64)) {
      buffer = fs.readFileSync(imageBase64)
    } else {
      throw new Error('无效的图片数据')
    }
    return extractWatermark(buffer, wmSize, password)
  },

  readImageAsBase64: (filePath) => {
    const buf = fs.readFileSync(filePath)
    const ext = filePath.split('.').pop().toLowerCase()
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', webp: 'image/webp' }
    return `data:${mime[ext] || 'image/png'};base64,${buf.toString('base64')}`
  },

  getFileInfo: (filePath) => {
    const stat = fs.statSync(filePath)
    return { name: path.basename(filePath), size: stat.size }
  },

  // 调试：验证加密/解密循环（不涉及图片）
  _debugCrypto(text, password) {
    const bits = textToBits(text)
    const enc = encodeRepetition(bits)
    const wmSize = enc.length
    const key = deterministicBits(password, wmSize)
    const xored = new Uint8Array(enc)
    for (let i = 0; i < xored.length; i++) xored[i] ^= key[i]
    const decrypted = new Uint8Array(xored)
    for (let i = 0; i < decrypted.length; i++) decrypted[i] ^= key[i]
    const decoded = decodeRepetition(decrypted)
    const result = bitsToText(decoded)

    const keyHash = crypto.createHash('md5').update(Buffer.from(key)).digest('hex')
    const shuf = deterministicShuffle([0,1,2,3,4,5,6,7,8,9], password)

    return {
      text, password: String(password),
      rawBitsLen: bits.length,
      wmSize,
      keyFirst10: Array.from(key.slice(0, 10)),
      keyHash,
      shuffleFirst10: shuf.slice(0, 10),
      xoredFirst10: Array.from(xored.slice(0, 10)),
      decryptedFirst10: Array.from(decrypted.slice(0, 10)),
      decodedFirst10: Array.from(decoded.slice(0, 10)),
      result,
      ok: result === text
    }
  }
}
