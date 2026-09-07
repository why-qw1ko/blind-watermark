const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const test = require('node:test')
const { Worker } = require('node:worker_threads')

const core = require('./watermark-core.js')

function fixture (width = 192, height = 192, fill = null) {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      rgba[offset] = fill ?? ((x * 3 + y * 5) % 256)
      rgba[offset + 1] = fill ?? ((x * 7 + y * 11) % 256)
      rgba[offset + 2] = fill ?? ((x * 13 + y * 17) % 256)
      rgba[offset + 3] = fill === null && (x + y) % 5 === 0 ? 160 : 255
    }
  }
  return { rgba, width, height }
}

test('SHA-256 implementation matches the standard vector', () => {
  const digest = Buffer.from(core.sha256(new TextEncoder().encode('abc'))).toString('hex')
  assert.equal(digest, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('BWM2 golden vector remains stable', () => {
  const image = fixture()
  const embedded = core.embedText(image.rgba, image.width, image.height, '跨端 compat 🚀', 'p@ss')

  assert.deepEqual(
    Array.from(core.deterministicIndices(1024, 'p@ss').slice(0, 12)),
    [199, 967, 400, 968, 96, 359, 36, 764, 858, 896, 927, 345]
  )
  assert.equal(embedded.encodedBits, 1680)
  assert.equal(embedded.capacityBits, 2304)
  assert.equal(
    crypto.createHash('sha256').update(embedded.rgba).digest('hex'),
    'baab42a57604ba2c686cac25d84bd51cf5341f87f35ebb7e5ce1d7b783c35dba'
  )
  assert.equal(core.extractText(embedded.rgba, image.width, image.height, 'p@ss'), '跨端 compat 🚀')
})

test('BWM2 handles saturated black and white images', () => {
  for (const luminance of [0, 255]) {
    const image = fixture(192, 192, luminance)
    const embedded = core.embedText(image.rgba, image.width, image.height, '版权 A-01', '亮暗测试')
    assert.equal(core.extractText(embedded.rgba, image.width, image.height, '亮暗测试'), '版权 A-01')
  }
})

test('wrong passwords and undersized images fail explicitly', () => {
  const image = fixture()
  const embedded = core.embedText(image.rgba, image.width, image.height, 'verified', 'correct')
  assert.throws(
    () => core.extractText(embedded.rgba, image.width, image.height, 'wrong'),
    error => error.code === 'FORMAT_INVALID'
  )

  const tiny = fixture(32, 32)
  assert.throws(
    () => core.embedText(tiny.rgba, tiny.width, tiny.height, 'too large', '1'),
    error => error.code === 'CAPACITY_EXCEEDED'
  )
})

test('legacy uTools payloads remain extractable with strict lengths', () => {
  const image = fixture()
  const embedded = core.embedLegacyText(image.rgba, image.width, image.height, '旧版文本', '01')
  assert.equal(embedded.encodedBits, new TextEncoder().encode('旧版文本').length * 8 * 7)
  assert.equal(
    core.extractLegacyText(embedded.rgba, image.width, image.height, embedded.encodedBits, '01'),
    '旧版文本'
  )
  assert.throws(
    () => core.extractLegacyText(embedded.rgba, image.width, image.height, 57, '01'),
    error => error.code === 'FORMAT_INVALID'
  )
})

test('legacy password stream remains compatible', () => {
  assert.equal(
    Buffer.from(core.passwordRandomBytesLegacy('1', 16)).toString('hex'),
    '6b86b273ff34fce19d6b804eff5a3f57'
  )
})

test('uTools worker performs BWM2 work off the renderer thread', async () => {
  const workerPath = path.resolve(__dirname, '../blind-watermark-utools/public/preload/watermark-worker.js')
  const worker = new Worker(workerPath)
  const image = fixture()
  try {
    const response = await new Promise((resolve, reject) => {
      worker.once('error', reject)
      worker.once('message', resolve)
      worker.postMessage({
        id: 1,
        action: 'embed',
        rgba: image.rgba.buffer,
        width: image.width,
        height: image.height,
        text: 'worker ok',
        password: '1'
      }, [image.rgba.buffer])
    })
    assert.equal(response.ok, true)
    assert.equal(
      core.extractText(new Uint8Array(response.rgba), response.width, response.height, '1'),
      'worker ok'
    )
  } finally {
    await worker.terminate()
  }
})
