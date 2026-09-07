/* global BlindWatermarkCore, importScripts */
'use strict'

importScripts('/shared/watermark-core.js')

self.addEventListener('message', event => {
  const { id, action, rgba, width, height, text, password, legacyLength } = event.data || {}
  try {
    const pixels = new Uint8Array(rgba)
    if (action === 'embed') {
      const result = BlindWatermarkCore.embedText(pixels, width, height, text, password)
      const verifiedText = BlindWatermarkCore.extractText(result.rgba, width, height, password)
      if (verifiedText !== text) {
        throw new BlindWatermarkCore.IntegrityError('嵌入自检失败，未生成不可靠的结果')
      }
      self.postMessage({
        id,
        ok: true,
        rgba: result.rgba.buffer,
        width,
        height,
        format: result.format,
        encodedBits: result.encodedBits,
        capacityBits: result.capacityBits
      }, [result.rgba.buffer])
      return
    }

    const watermark = action === 'extract-legacy-utools'
      ? BlindWatermarkCore.extractLegacyText(pixels, width, height, legacyLength, password)
      : BlindWatermarkCore.extractText(pixels, width, height, password)
    self.postMessage({
      id,
      ok: true,
      watermark,
      format: action === 'extract-legacy-utools'
        ? BlindWatermarkCore.LEGACY_FORMAT
        : BlindWatermarkCore.FORMAT,
      verified: action !== 'extract-legacy-utools'
    })
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: {
        code: error?.code || 'PROCESSING_FAILED',
        message: error instanceof BlindWatermarkCore.WatermarkError
          ? error.message
          : '图片处理失败，请检查文件后重试'
      }
    })
  }
})
