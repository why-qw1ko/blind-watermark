/*
 * BWM2 cross-platform blind watermark core.
 *
 * This file has no DOM, Node.js, or uTools dependency. It is loaded directly
 * by the Web Worker and required by the uTools preload script. Keep the public
 * format stable; see docs/FORMAT.md before changing constants or byte order.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.BlindWatermarkCore = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const MAGIC = new Uint8Array([0x42, 0x57, 0x4d, 0x32]) // "BWM2"
  const FORMAT = 'BWM2'
  const LEGACY_FORMAT = 'DWT-QIM-JS-V1'
  const HEADER_BYTES = 12
  const QUANT_STEP = 40
  const REPETITION_FACTOR = 7
  const DWT_LEVELS = 2
  const MAX_PAYLOAD_BYTES = 4096

  class WatermarkError extends Error {
    constructor (message, code = 'WATERMARK_ERROR') {
      super(message)
      this.name = this.constructor.name
      this.code = code
    }
  }

  class CapacityError extends WatermarkError {
    constructor (message) {
      super(message, 'CAPACITY_EXCEEDED')
    }
  }

  class FormatError extends WatermarkError {
    constructor (message) {
      super(message, 'FORMAT_INVALID')
    }
  }

  class IntegrityError extends WatermarkError {
    constructor (message) {
      super(message, 'INTEGRITY_FAILED')
    }
  }

  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ])

  function rotateRight (value, count) {
    return (value >>> count) | (value << (32 - count))
  }

  function sha256 (input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
    const bitLength = bytes.length * 8
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
    const padded = new Uint8Array(paddedLength)
    padded.set(bytes)
    padded[bytes.length] = 0x80
    const paddedView = new DataView(padded.buffer)
    paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
    paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false)

    let h0 = 0x6a09e667
    let h1 = 0xbb67ae85
    let h2 = 0x3c6ef372
    let h3 = 0xa54ff53a
    let h4 = 0x510e527f
    let h5 = 0x9b05688c
    let h6 = 0x1f83d9ab
    let h7 = 0x5be0cd19
    const words = new Uint32Array(64)

    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let index = 0; index < 16; index++) {
        words[index] = paddedView.getUint32(offset + index * 4, false)
      }
      for (let index = 16; index < 64; index++) {
        const value15 = words[index - 15]
        const value2 = words[index - 2]
        const sigma0 = rotateRight(value15, 7) ^ rotateRight(value15, 18) ^ (value15 >>> 3)
        const sigma1 = rotateRight(value2, 17) ^ rotateRight(value2, 19) ^ (value2 >>> 10)
        words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0
      }

      let a = h0
      let b = h1
      let c = h2
      let d = h3
      let e = h4
      let f = h5
      let g = h6
      let h = h7

      for (let index = 0; index < 64; index++) {
        const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
        const choice = (e & f) ^ (~e & g)
        const temporary1 = (h + bigSigma1 + choice + SHA256_K[index] + words[index]) >>> 0
        const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
        const majority = (a & b) ^ (a & c) ^ (b & c)
        const temporary2 = (bigSigma0 + majority) >>> 0
        h = g
        g = f
        f = e
        e = (d + temporary1) >>> 0
        d = c
        c = b
        b = a
        a = (temporary1 + temporary2) >>> 0
      }

      h0 = (h0 + a) >>> 0
      h1 = (h1 + b) >>> 0
      h2 = (h2 + c) >>> 0
      h3 = (h3 + d) >>> 0
      h4 = (h4 + e) >>> 0
      h5 = (h5 + f) >>> 0
      h6 = (h6 + g) >>> 0
      h7 = (h7 + h) >>> 0
    }

    const output = new Uint8Array(32)
    const outputView = new DataView(output.buffer)
    ;[h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, index) => {
      outputView.setUint32(index * 4, value, false)
    })
    return output
  }

  function utf8Bytes (value) {
    return new TextEncoder().encode(String(value))
  }

  function concatBytes (...arrays) {
    const length = arrays.reduce((total, value) => total + value.length, 0)
    const output = new Uint8Array(length)
    let offset = 0
    for (const value of arrays) {
      output.set(value, offset)
      offset += value.length
    }
    return output
  }

  function createXoshiro (password, domain) {
    const seedBytes = sha256(concatBytes(utf8Bytes(`BWM2/${domain}\0`), utf8Bytes(password)))
    const view = new DataView(seedBytes.buffer, seedBytes.byteOffset, seedBytes.byteLength)
    let state0 = view.getUint32(0, true)
    let state1 = view.getUint32(4, true)
    let state2 = view.getUint32(8, true)
    let state3 = view.getUint32(12, true)

    function rotateLeft (value, count) {
      return ((value << count) | (value >>> (32 - count))) >>> 0
    }

    return function nextUint32 () {
      const result = Math.imul(rotateLeft(Math.imul(state1, 5) >>> 0, 7), 9) >>> 0
      const temporary = (state1 << 9) >>> 0
      state2 = (state2 ^ state0) >>> 0
      state3 = (state3 ^ state1) >>> 0
      state1 = (state1 ^ state2) >>> 0
      state0 = (state0 ^ state3) >>> 0
      state2 = (state2 ^ temporary) >>> 0
      state3 = rotateLeft(state3, 11)
      return result
    }
  }

  function deterministicIndices (capacity, password) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError('capacity must be a non-negative integer')
    const indexes = new Uint32Array(capacity)
    for (let index = 0; index < capacity; index++) indexes[index] = index
    const random = createXoshiro(password, 'positions')
    for (let index = capacity - 1; index > 0; index--) {
      const swapIndex = random() % (index + 1)
      const temporary = indexes[index]
      indexes[index] = indexes[swapIndex]
      indexes[swapIndex] = temporary
    }
    return indexes
  }

  function passwordRandomBytesLegacy (password, length) {
    const output = new Uint8Array(length)
    let block = sha256(utf8Bytes(password))
    let offset = 0
    while (offset < length) {
      const copyLength = Math.min(block.length, length - offset)
      output.set(block.subarray(0, copyLength), offset)
      offset += copyLength
      if (offset < length) block = sha256(block)
    }
    return output
  }

  function deterministicIndicesLegacy (capacity, password) {
    const indexes = new Uint32Array(capacity)
    for (let index = 0; index < capacity; index++) indexes[index] = index
    const randomBytes = passwordRandomBytesLegacy(password, Math.max(capacity * 4 + 8, 16))
    const view = new DataView(randomBytes.buffer, randomBytes.byteOffset, randomBytes.byteLength)
    for (let index = capacity - 1; index > 0; index--) {
      const offset = (index * 4) % (randomBytes.length - 4)
      const swapIndex = view.getUint32(offset, true) % (index + 1)
      const temporary = indexes[index]
      indexes[index] = indexes[swapIndex]
      indexes[swapIndex] = temporary
    }
    return indexes
  }

  function bytesToBits (bytes) {
    const bits = new Uint8Array(bytes.length * 8)
    for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
      for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
        bits[byteIndex * 8 + bitIndex] = (bytes[byteIndex] >> (7 - bitIndex)) & 1
      }
    }
    return bits
  }

  function bitsToBytes (bits) {
    const usableLength = bits.length - (bits.length % 8)
    const bytes = new Uint8Array(usableLength / 8)
    for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
      let value = 0
      for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
        value = (value << 1) | bits[byteIndex * 8 + bitIndex]
      }
      bytes[byteIndex] = value
    }
    return bytes
  }

  function encodeRepetition (bits) {
    const encoded = new Uint8Array(bits.length * REPETITION_FACTOR)
    for (let index = 0; index < bits.length; index++) {
      encoded.fill(bits[index], index * REPETITION_FACTOR, (index + 1) * REPETITION_FACTOR)
    }
    return encoded
  }

  function decodeRepetition (encoded) {
    const count = Math.floor(encoded.length / REPETITION_FACTOR)
    const decoded = new Uint8Array(count)
    for (let index = 0; index < count; index++) {
      let sum = 0
      for (let repeat = 0; repeat < REPETITION_FACTOR; repeat++) {
        sum += encoded[index * REPETITION_FACTOR + repeat]
      }
      decoded[index] = sum > (REPETITION_FACTOR >> 1) ? 1 : 0
    }
    return decoded
  }

  function xorBits (bits, password) {
    const output = new Uint8Array(bits)
    const random = createXoshiro(password, 'payload')
    let randomWord = 0
    for (let index = 0; index < output.length; index++) {
      if ((index & 31) === 0) randomWord = random()
      output[index] ^= (randomWord >>> (index & 31)) & 1
    }
    return output
  }

  function xorBitsLegacy (bits, password) {
    const output = new Uint8Array(bits)
    const randomBytes = passwordRandomBytesLegacy(password, Math.ceil(output.length / 8))
    for (let index = 0; index < output.length; index++) {
      output[index] ^= (randomBytes[index >> 3] >> (index & 7)) & 1
    }
    return output
  }

  function buildFrame (text) {
    const payload = utf8Bytes(text)
    if (payload.length === 0) throw new FormatError('水印内容不能为空')
    if (payload.length > MAX_PAYLOAD_BYTES) {
      throw new CapacityError(`水印内容不能超过 ${MAX_PAYLOAD_BYTES} 字节`)
    }
    const frame = new Uint8Array(HEADER_BYTES + payload.length)
    frame.set(MAGIC, 0)
    new DataView(frame.buffer).setUint32(4, payload.length, false)
    frame.set(sha256(payload).subarray(0, 4), 8)
    frame.set(payload, HEADER_BYTES)
    return frame
  }

  function parseFrame (frame) {
    if (frame.length < HEADER_BYTES || !MAGIC.every((value, index) => frame[index] === value)) {
      throw new FormatError('未识别到新版水印，请检查密码或选择旧版兼容模式')
    }
    const payloadLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(4, false)
    if (payloadLength === 0 || payloadLength > MAX_PAYLOAD_BYTES) throw new FormatError('水印长度信息无效')
    if (frame.length !== HEADER_BYTES + payloadLength) throw new FormatError('水印数据不完整')
    const payload = frame.subarray(HEADER_BYTES)
    const checksum = sha256(payload)
    for (let index = 0; index < 4; index++) {
      if (frame[8 + index] !== checksum[index]) {
        throw new IntegrityError('水印校验失败，请检查密码或图片完整性')
      }
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(payload)
    } catch (error) {
      throw new IntegrityError('水印文本编码无效')
    }
  }

  function dwt1d (signal) {
    const length = signal.length
    if (length < 2 || length % 2 !== 0) return
    const half = length >> 1
    const temporary = new Float64Array(length)
    for (let index = 0; index < half; index++) {
      const first = signal[index * 2]
      const second = signal[index * 2 + 1]
      temporary[index] = (first + second) / Math.SQRT2
      temporary[index + half] = (first - second) / Math.SQRT2
    }
    signal.set(temporary)
  }

  function idwt1d (signal) {
    const length = signal.length
    const half = length >> 1
    const temporary = new Float64Array(length)
    for (let index = 0; index < half; index++) {
      const low = signal[index]
      const high = signal[index + half]
      temporary[index * 2] = (low + high) / Math.SQRT2
      temporary[index * 2 + 1] = (low - high) / Math.SQRT2
    }
    signal.set(temporary)
  }

  function dwt2d (matrix, width, height) {
    for (let row = 0; row < height; row++) {
      dwt1d(matrix.subarray(row * width, (row + 1) * width))
    }
    const column = new Float64Array(height)
    for (let col = 0; col < width; col++) {
      for (let row = 0; row < height; row++) column[row] = matrix[row * width + col]
      dwt1d(column)
      for (let row = 0; row < height; row++) matrix[row * width + col] = column[row]
    }
  }

  function idwt2d (matrix, width, height) {
    const column = new Float64Array(height)
    for (let col = 0; col < width; col++) {
      for (let row = 0; row < height; row++) column[row] = matrix[row * width + col]
      idwt1d(column)
      for (let row = 0; row < height; row++) matrix[row * width + col] = column[row]
    }
    for (let row = 0; row < height; row++) {
      idwt1d(matrix.subarray(row * width, (row + 1) * width))
    }
  }

  function copyLLFrom (fullDwt, fullWidth, fullHeight) {
    const halfWidth = fullWidth >> 1
    const halfHeight = fullHeight >> 1
    const output = new Float64Array(halfWidth * halfHeight)
    for (let row = 0; row < halfHeight; row++) {
      output.set(fullDwt.subarray(row * fullWidth, row * fullWidth + halfWidth), row * halfWidth)
    }
    return output
  }

  function copyLLTo (fullDwt, fullWidth, fullHeight, source) {
    const halfWidth = fullWidth >> 1
    const halfHeight = fullHeight >> 1
    for (let row = 0; row < halfHeight; row++) {
      fullDwt.set(source.subarray(row * halfWidth, (row + 1) * halfWidth), row * fullWidth)
    }
  }

  function normaliseRgba (rgba, width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('invalid image dimensions')
    }
    const input = rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray
      ? rgba
      : new Uint8Array(rgba)
    if (input.length !== width * height * 4) throw new RangeError('RGBA data size does not match image dimensions')
    const output = new Uint8Array(input)
    for (let offset = 0; offset < output.length; offset += 4) {
      if (output[offset + 3] === 0) {
        output[offset] = 255
        output[offset + 1] = 255
        output[offset + 2] = 255
      }
    }
    return output
  }

  function extractYChannel (rgba, width, height) {
    const output = new Float64Array(width * height)
    for (let index = 0; index < output.length; index++) {
      const offset = index * 4
      output[index] = 0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2]
    }
    return output
  }

  function applyYDelta (rgba, newY, oldY) {
    const output = new Uint8Array(rgba)
    for (let index = 0; index < oldY.length; index++) {
      const delta = Math.round(newY[index] - oldY[index])
      if (delta === 0) continue
      for (let channel = 0; channel < 3; channel++) {
        const offset = index * 4 + channel
        output[offset] = Math.max(0, Math.min(255, output[offset] + delta))
      }
    }
    return output
  }

  function padToMultiple (matrix, width, height, multiple) {
    const paddedWidth = Math.ceil(width / multiple) * multiple
    const paddedHeight = Math.ceil(height / multiple) * multiple
    const output = new Float64Array(paddedWidth * paddedHeight)
    for (let row = 0; row < paddedHeight; row++) {
      const sourceRow = Math.min(row, height - 1)
      for (let col = 0; col < paddedWidth; col++) {
        output[row * paddedWidth + col] = matrix[sourceRow * width + Math.min(col, width - 1)]
      }
    }
    return { data: output, width: paddedWidth, height: paddedHeight }
  }

  function cropMatrix (matrix, paddedWidth, width, height) {
    const output = new Float64Array(width * height)
    for (let row = 0; row < height; row++) {
      output.set(matrix.subarray(row * paddedWidth, row * paddedWidth + width), row * width)
    }
    return output
  }

  function prepareCoefficients (rgba, width, height) {
    const oldY = extractYChannel(rgba, width, height)
    const padded = padToMultiple(oldY, width, height, 1 << DWT_LEVELS)
    dwt2d(padded.data, padded.width, padded.height)
    const firstWidth = padded.width >> 1
    const firstHeight = padded.height >> 1
    const firstLevel = copyLLFrom(padded.data, padded.width, padded.height)
    dwt2d(firstLevel, firstWidth, firstHeight)
    return { oldY, padded, firstLevel, firstWidth, firstHeight }
  }

  function chooseQuantisedValue (coefficient, bit) {
    const base = Math.round(coefficient / QUANT_STEP)
    const maximumLuminanceCoefficient = 255 * (1 << DWT_LEVELS)
    const preferDown = coefficient > maximumLuminanceCoefficient * 0.85
    const preferUp = coefficient < maximumLuminanceCoefficient * 0.15
    let selected = base
    let selectedScore = Number.POSITIVE_INFINITY

    for (let candidate = base - 4; candidate <= base + 4; candidate++) {
      if (Math.abs(candidate) % 2 !== bit) continue
      const target = candidate * QUANT_STEP
      let score = Math.abs(coefficient - target)
      if (preferDown && target > coefficient) score += maximumLuminanceCoefficient
      if (preferUp && target < coefficient) score += maximumLuminanceCoefficient
      if (score < selectedScore) {
        selected = candidate
        selectedScore = score
      }
    }
    return selected
  }

  function embedEncodedBits (rgba, width, height, encodedBits, password, legacy) {
    const prepared = prepareCoefficients(rgba, width, height)
    const capacity = (prepared.firstWidth >> 1) * (prepared.firstHeight >> 1)
    if (encodedBits.length > capacity) {
      throw new CapacityError(`图片容量不足：需要 ${encodedBits.length} bit，可用 ${capacity} bit`)
    }

    const encrypted = legacy ? xorBitsLegacy(encodedBits, password) : xorBits(encodedBits, password)
    const positions = legacy
      ? deterministicIndicesLegacy(capacity, password)
      : deterministicIndices(capacity, password)
    const secondWidth = prepared.firstWidth >> 1
    for (let bitIndex = 0; bitIndex < encrypted.length; bitIndex++) {
      const coefficientIndex = positions[bitIndex]
      const row = Math.floor(coefficientIndex / secondWidth)
      const col = coefficientIndex % secondWidth
      const position = row * prepared.firstWidth + col
      const quantised = chooseQuantisedValue(prepared.firstLevel[position], encrypted[bitIndex])
      prepared.firstLevel[position] = quantised * QUANT_STEP
    }

    idwt2d(prepared.firstLevel, prepared.firstWidth, prepared.firstHeight)
    copyLLTo(prepared.padded.data, prepared.padded.width, prepared.padded.height, prepared.firstLevel)
    idwt2d(prepared.padded.data, prepared.padded.width, prepared.padded.height)
    const newY = cropMatrix(prepared.padded.data, prepared.padded.width, width, height)
    return {
      rgba: applyYDelta(rgba, newY, prepared.oldY),
      capacityBits: capacity
    }
  }

  function extractEncryptedBits (firstLevel, firstWidth, positions, bitCount) {
    const secondWidth = firstWidth >> 1
    const bits = new Uint8Array(bitCount)
    for (let bitIndex = 0; bitIndex < bitCount; bitIndex++) {
      const coefficientIndex = positions[bitIndex]
      const row = Math.floor(coefficientIndex / secondWidth)
      const col = coefficientIndex % secondWidth
      const coefficient = firstLevel[row * firstWidth + col]
      bits[bitIndex] = Math.abs(Math.round(coefficient / QUANT_STEP)) % 2
    }
    return bits
  }

  function calculateCapacity (width, height) {
    const multiple = 1 << DWT_LEVELS
    const paddedWidth = Math.ceil(width / multiple) * multiple
    const paddedHeight = Math.ceil(height / multiple) * multiple
    return (paddedWidth >> DWT_LEVELS) * (paddedHeight >> DWT_LEVELS)
  }

  function calculateMaxPayloadBytes (width, height) {
    const rawBytes = Math.floor(calculateCapacity(width, height) / (8 * REPETITION_FACTOR))
    return Math.max(0, Math.min(MAX_PAYLOAD_BYTES, rawBytes - HEADER_BYTES))
  }

  function embedText (rgbaInput, width, height, text, password) {
    const rgba = normaliseRgba(rgbaInput, width, height)
    const frame = buildFrame(text)
    const encoded = encodeRepetition(bytesToBits(frame))
    const result = embedEncodedBits(rgba, width, height, encoded, String(password), false)
    return {
      rgba: result.rgba,
      width,
      height,
      format: FORMAT,
      encodedBits: encoded.length,
      capacityBits: result.capacityBits,
      payloadBytes: frame.length - HEADER_BYTES
    }
  }

  function extractText (rgbaInput, width, height, password) {
    const rgba = normaliseRgba(rgbaInput, width, height)
    const prepared = prepareCoefficients(rgba, width, height)
    const capacity = (prepared.firstWidth >> 1) * (prepared.firstHeight >> 1)
    const headerBitCount = HEADER_BYTES * 8 * REPETITION_FACTOR
    if (capacity < headerBitCount) throw new CapacityError('图片尺寸太小，无法包含新版水印头')

    const positions = deterministicIndices(capacity, String(password))
    const encryptedHeader = extractEncryptedBits(
      prepared.firstLevel,
      prepared.firstWidth,
      positions,
      headerBitCount
    )
    const header = bitsToBytes(decodeRepetition(xorBits(encryptedHeader, String(password))))
    if (header.length !== HEADER_BYTES || !MAGIC.every((value, index) => header[index] === value)) {
      throw new FormatError('未识别到新版水印，请检查密码或选择旧版兼容模式')
    }

    const payloadLength = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(4, false)
    if (payloadLength === 0 || payloadLength > MAX_PAYLOAD_BYTES) throw new FormatError('水印长度信息无效')
    const totalBitCount = (HEADER_BYTES + payloadLength) * 8 * REPETITION_FACTOR
    if (totalBitCount > capacity) throw new FormatError('水印长度信息超过图片容量')

    const encrypted = extractEncryptedBits(
      prepared.firstLevel,
      prepared.firstWidth,
      positions,
      totalBitCount
    )
    const frame = bitsToBytes(decodeRepetition(xorBits(encrypted, String(password))))
    return parseFrame(frame)
  }

  function embedLegacyText (rgbaInput, width, height, text, password) {
    const rgba = normaliseRgba(rgbaInput, width, height)
    const payload = utf8Bytes(text)
    if (payload.length === 0) throw new FormatError('水印内容不能为空')
    const encoded = encodeRepetition(bytesToBits(payload))
    const result = embedEncodedBits(rgba, width, height, encoded, String(password), true)
    return {
      rgba: result.rgba,
      width,
      height,
      format: LEGACY_FORMAT,
      encodedBits: encoded.length,
      capacityBits: result.capacityBits,
      payloadBytes: payload.length
    }
  }

  function extractLegacyText (rgbaInput, width, height, encodedBitCount, password) {
    if (!Number.isSafeInteger(encodedBitCount) || encodedBitCount <= 0 || encodedBitCount % 56 !== 0) {
      throw new FormatError('旧版水印长度必须是 56 的正整数倍')
    }
    const rgba = normaliseRgba(rgbaInput, width, height)
    const prepared = prepareCoefficients(rgba, width, height)
    const capacity = (prepared.firstWidth >> 1) * (prepared.firstHeight >> 1)
    if (encodedBitCount > capacity) {
      throw new CapacityError(`水印长度 ${encodedBitCount} 超过图片容量 ${capacity}`)
    }
    const positions = deterministicIndicesLegacy(capacity, String(password))
    const encrypted = extractEncryptedBits(
      prepared.firstLevel,
      prepared.firstWidth,
      positions,
      encodedBitCount
    )
    const payload = bitsToBytes(decodeRepetition(xorBitsLegacy(encrypted, String(password))))
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(payload)
    } catch (error) {
      throw new IntegrityError('提取结果不是有效文本，请检查密码和水印长度')
    }
  }

  return Object.freeze({
    FORMAT,
    LEGACY_FORMAT,
    HEADER_BYTES,
    QUANT_STEP,
    REPETITION_FACTOR,
    MAX_PAYLOAD_BYTES,
    WatermarkError,
    CapacityError,
    FormatError,
    IntegrityError,
    sha256,
    passwordRandomBytesLegacy,
    deterministicIndices,
    deterministicIndicesLegacy,
    calculateCapacity,
    calculateMaxPayloadBytes,
    buildFrame,
    parseFrame,
    embedText,
    extractText,
    embedLegacyText,
    extractLegacyText
  })
})
