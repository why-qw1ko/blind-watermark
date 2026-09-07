'use strict'

const { parentPort } = require('node:worker_threads')
const watermarkCore = require('./watermark-core.js')

parentPort.on('message', message => {
  const { id, action, rgba, width, height, text, password, legacyLength } = message
  try {
    const pixels = new Uint8Array(rgba)
    if (action === 'embed') {
      const embedded = watermarkCore.embedText(pixels, width, height, text, password)
      const verified = watermarkCore.extractText(embedded.rgba, width, height, password)
      if (verified !== text) throw new watermarkCore.IntegrityError('嵌入自检失败，未保存不可靠的结果')
      parentPort.postMessage({
        id,
        ok: true,
        rgba: embedded.rgba.buffer,
        format: embedded.format,
        encodedBits: embedded.encodedBits,
        capacityBits: embedded.capacityBits,
        width,
        height
      }, [embedded.rgba.buffer])
      return
    }

    if (action === 'embed-legacy') {
      const embedded = watermarkCore.embedLegacyText(pixels, width, height, text, password)
      const verified = watermarkCore.extractLegacyText(
        embedded.rgba,
        width,
        height,
        embedded.encodedBits,
        password
      )
      parentPort.postMessage({
        id,
        ok: true,
        rgba: embedded.rgba.buffer,
        format: embedded.format,
        encodedBits: embedded.encodedBits,
        capacityBits: embedded.capacityBits,
        verified,
        width,
        height
      }, [embedded.rgba.buffer])
      return
    }

    const watermark = action === 'extract-legacy'
      ? watermarkCore.extractLegacyText(pixels, width, height, legacyLength, password)
      : watermarkCore.extractText(pixels, width, height, password)
    parentPort.postMessage({
      id,
      ok: true,
      watermark,
      format: action === 'extract-legacy' ? watermarkCore.LEGACY_FORMAT : watermarkCore.FORMAT,
      verified: action !== 'extract-legacy'
    })
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: {
        code: error?.code || 'PROCESSING_FAILED',
        message: error instanceof watermarkCore.WatermarkError
          ? error.message
          : '图片处理失败，请检查文件后重试'
      }
    })
  }
})
