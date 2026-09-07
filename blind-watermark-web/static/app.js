'use strict'

const LIMITS = Object.freeze({
    maxFiles: 10,
    maxFileBytes: 20 * 1024 * 1024,
    maxTotalBytes: 80 * 1024 * 1024,
    maxPixels: 25_000_000,
    maxExtractPixels: 12_000_000,
    maxTotalProcessedPixels: 26_000_000,
    maxDimension: 1600,
    maxPayloadBytes: 4096,
    maxPasswordBytes: 128
})

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'webp'])
const textEncoder = new TextEncoder()

function createElement (tag, className, text) {
    const element = document.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = text
    return element
}

function replaceChildren (element, ...children) {
    element.replaceChildren(...children.filter(Boolean))
}

function extensionOf (filename) {
    const dot = filename.lastIndexOf('.')
    return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

function formatBytes (bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function safeStem (filename) {
    const dot = filename.lastIndexOf('.')
    const raw = dot > 0 ? filename.slice(0, dot) : filename
    const stem = raw
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/g, '')
        .slice(0, 80)
    return stem || 'image'
}

function statusLabel (status) {
    return {
        pending: '等待',
        processing: '处理中',
        success: '完成',
        failed: '失败'
    }[status] || '等待'
}

function createQueue (prefix) {
    const input = document.getElementById(`${prefix}-files`)
    const dropzone = document.getElementById(`${prefix}-dropzone`)
    const list = document.getElementById(`${prefix}-list`)
    const summary = document.getElementById(`${prefix}-summary`)
    const error = document.getElementById(`${prefix}-file-error`)
    const clearButton = document.getElementById(`${prefix}-clear`)
    const items = []
    let locked = false

    function render () {
        const totalBytes = items.reduce((total, item) => total + item.file.size, 0)
        summary.textContent = items.length
            ? `${items.length} 张 · ${formatBytes(totalBytes)}`
            : ''
        clearButton.hidden = items.length === 0
        clearButton.disabled = locked
        input.disabled = locked
        dropzone.setAttribute('aria-disabled', String(locked))

        const rows = items.map((item, index) => {
            const row = createElement('li', 'file-row')
            const icon = createElement('span', 'file-icon', '▧')
            icon.setAttribute('aria-hidden', 'true')
            const name = createElement('span', 'file-name')
            const strong = createElement('strong', '', item.file.name)
            strong.title = item.file.name
            const detail = item.error
                ? `${formatBytes(item.file.size)} · ${item.error}`
                : formatBytes(item.file.size)
            name.append(strong, createElement('small', '', detail))
            const status = createElement('span', `status-pill is-${item.status}`, statusLabel(item.status))
            const remove = createElement('button', 'remove-button', '×')
            remove.type = 'button'
            remove.disabled = locked
            remove.setAttribute('aria-label', `移除 ${item.file.name}`)
            remove.addEventListener('click', () => {
                items.splice(index, 1)
                error.textContent = ''
                render()
            })
            row.append(icon, name, status, remove)
            return row
        })
        replaceChildren(list, ...rows)
    }

    function addFiles (files) {
        if (locked) return
        error.textContent = ''
        let rejected = 0
        let duplicates = 0
        for (const file of Array.from(files || [])) {
            if (items.length >= LIMITS.maxFiles) {
                rejected++
                continue
            }
            if (!ALLOWED_EXTENSIONS.has(extensionOf(file.name)) || file.size <= 0 || file.size > LIMITS.maxFileBytes) {
                rejected++
                continue
            }
            const key = `${file.name}\0${file.size}\0${file.lastModified}`
            if (items.some(item => item.key === key)) {
                duplicates++
                continue
            }
            const nextTotal = items.reduce((total, item) => total + item.file.size, 0) + file.size
            if (nextTotal > LIMITS.maxTotalBytes) {
                rejected++
                continue
            }
            items.push({ key, file, status: 'pending', error: '' })
        }
        if (rejected) error.textContent = `${rejected} 个文件因格式、大小或批次上限未添加`
        else if (duplicates) error.textContent = `${duplicates} 个重复文件未再次添加`
        input.value = ''
        render()
    }

    function clear () {
        if (locked) return
        items.splice(0)
        error.textContent = ''
        render()
    }

    function resetStatuses () {
        items.forEach(item => {
            item.status = 'pending'
            item.error = ''
        })
        render()
    }

    function setStatus (index, status, message = '') {
        if (!items[index]) return
        items[index].status = status
        items[index].error = message
        render()
    }

    function setLocked (value) {
        locked = value
        render()
    }

    input.addEventListener('change', () => addFiles(input.files))
    clearButton.addEventListener('click', clear)
    dropzone.addEventListener('dragenter', event => {
        event.preventDefault()
        if (!locked) dropzone.classList.add('is-dragging')
    })
    dropzone.addEventListener('dragover', event => event.preventDefault())
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'))
    dropzone.addEventListener('drop', event => {
        event.preventDefault()
        dropzone.classList.remove('is-dragging')
        addFiles(event.dataTransfer.files)
    })

    render()
    return { items, resetStatuses, setStatus, setLocked }
}

function createWorkerClient () {
    if (!('Worker' in window)) throw new Error('当前浏览器不支持后台图片处理，请升级浏览器')
    const worker = new Worker('/static/watermark-worker.js')
    const pending = new Map()
    let requestId = 0

    worker.addEventListener('message', event => {
        const handler = pending.get(event.data?.id)
        if (!handler) return
        pending.delete(event.data.id)
        if (event.data.ok) handler.resolve(event.data)
        else handler.reject(Object.assign(new Error(event.data.error?.message || '处理失败'), event.data.error))
    })
    worker.addEventListener('error', () => {
        for (const handler of pending.values()) handler.reject(new Error('图片处理线程异常，请刷新页面重试'))
        pending.clear()
    })

    return function runWorker (payload, transferable = []) {
        return new Promise((resolve, reject) => {
            const id = ++requestId
            pending.set(id, { resolve, reject })
            worker.postMessage({ id, ...payload }, transferable)
        })
    }
}

async function loadDrawable (file) {
    if ('createImageBitmap' in window) {
        try {
            const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
            return { drawable: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
        } catch {
            // The HTMLImageElement fallback below provides a clearer compatibility path.
        }
    }

    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'
    image.src = objectUrl
    try {
        await image.decode()
        return {
            drawable: image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            close: () => URL.revokeObjectURL(objectUrl)
        }
    } catch (error) {
        URL.revokeObjectURL(objectUrl)
        throw error
    }
}

async function decodeImage (file, { resize, pixelLimit }) {
    let loaded
    try {
        loaded = await loadDrawable(file)
    } catch {
        throw new Error('无法读取图片，请确认文件未损坏')
    }

    try {
        if (!loaded.width || !loaded.height || loaded.width * loaded.height > LIMITS.maxPixels) {
            throw new Error('图片像素过大，最高支持 2500 万像素')
        }
        if (!resize && loaded.width * loaded.height > pixelLimit) {
            throw new Error(`提取图片不能超过 ${Math.round(pixelLimit / 10_000)} 万像素`)
        }
        let width = loaded.width
        let height = loaded.height
        if (resize && Math.max(width, height) > LIMITS.maxDimension) {
            const scale = LIMITS.maxDimension / Math.max(width, height)
            width = Math.max(1, Math.round(width * scale))
            height = Math.max(1, Math.round(height * scale))
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('浏览器无法创建图片画布')
        context.drawImage(loaded.drawable, 0, 0, width, height)
        const imageData = context.getImageData(0, 0, width, height)
        return { rgba: imageData.data.buffer, width, height, pixels: width * height }
    } finally {
        loaded.close()
    }
}

function encodePng (rgba, width, height) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
            reject(new Error('浏览器无法创建图片画布'))
            return
        }
        context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
        canvas.toBlob(blob => {
            if (blob) resolve(blob)
            else reject(new Error('PNG 编码失败'))
        }, 'image/png')
    })
}

function downloadBlob (blob, filename) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let index = 0; index < 256; index++) {
        let value = index
        for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
        table[index] = value >>> 0
    }
    return table
})()

function crc32 (bytes) {
    let value = 0xffffffff
    for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
    return (value ^ 0xffffffff) >>> 0
}

function zipDateTime (date) {
    const year = Math.max(1980, date.getFullYear())
    return {
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
    }
}

function writeZipHeader (size, writer) {
    const bytes = new Uint8Array(size)
    writer(new DataView(bytes.buffer), bytes)
    return bytes
}

async function createZip (entries) {
    const localParts = []
    const centralParts = []
    const timestamp = zipDateTime(new Date())
    let localOffset = 0

    for (const entry of entries) {
        const name = textEncoder.encode(entry.name)
        const data = new Uint8Array(await entry.blob.arrayBuffer())
        const checksum = crc32(data)
        const localHeader = writeZipHeader(30 + name.length, (view, bytes) => {
            view.setUint32(0, 0x04034b50, true)
            view.setUint16(4, 20, true)
            view.setUint16(6, 0x0800, true)
            view.setUint16(8, 0, true)
            view.setUint16(10, timestamp.time, true)
            view.setUint16(12, timestamp.date, true)
            view.setUint32(14, checksum, true)
            view.setUint32(18, data.length, true)
            view.setUint32(22, data.length, true)
            view.setUint16(26, name.length, true)
            view.setUint16(28, 0, true)
            bytes.set(name, 30)
        })
        localParts.push(localHeader, entry.blob)

        const centralHeader = writeZipHeader(46 + name.length, (view, bytes) => {
            view.setUint32(0, 0x02014b50, true)
            view.setUint16(4, 20, true)
            view.setUint16(6, 20, true)
            view.setUint16(8, 0x0800, true)
            view.setUint16(10, 0, true)
            view.setUint16(12, timestamp.time, true)
            view.setUint16(14, timestamp.date, true)
            view.setUint32(16, checksum, true)
            view.setUint32(20, data.length, true)
            view.setUint32(24, data.length, true)
            view.setUint16(28, name.length, true)
            view.setUint32(42, localOffset, true)
            bytes.set(name, 46)
        })
        centralParts.push(centralHeader)
        localOffset += localHeader.length + data.length
    }

    const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
    const end = writeZipHeader(22, view => {
        view.setUint32(0, 0x06054b50, true)
        view.setUint16(8, entries.length, true)
        view.setUint16(10, entries.length, true)
        view.setUint32(12, centralSize, true)
        view.setUint32(16, localOffset, true)
    })
    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' })
}

function uniqueOutputName (filename, usedNames) {
    const stem = safeStem(filename)
    let candidate = `${stem}.watermarked.png`
    let suffix = 2
    while (usedNames.has(candidate)) candidate = `${stem}.watermarked-${suffix++}.png`
    usedNames.add(candidate)
    return candidate
}

function renderBusy (region, title, detail) {
    const card = createElement('section', 'result-card')
    const head = createElement('div', 'result-head')
    const copy = createElement('div')
    copy.append(createElement('h3', '', title), createElement('p', '', detail))
    head.append(copy)
    const progress = createElement('div', 'progress-line')
    progress.append(createElement('span'))
    card.append(head, progress)
    replaceChildren(region, card)
}

function renderEmbedResults (region, results, download) {
    const successes = results.filter(result => result.success)
    const failures = results.length - successes.length
    const card = createElement('section', `result-card${successes.length ? '' : ' is-error'}`)
    const head = createElement('div', 'result-head')
    const copy = createElement('div')
    copy.append(
        createElement('h3', '', successes.length ? '嵌入完成' : '本批次未生成文件'),
        createElement('p', '', `${successes.length} 张成功${failures ? `，${failures} 张失败` : ''}`)
    )
    head.append(copy)
    if (download) {
        const action = createElement('button', 'secondary-button', '再次下载')
        action.type = 'button'
        action.addEventListener('click', () => downloadBlob(download.blob, download.name))
        const actions = createElement('div', 'result-actions')
        actions.append(action)
        head.append(actions)
    }
    card.append(head)

    const list = createElement('ul', 'result-list')
    for (const result of results) {
        const row = createElement('li')
        const title = createElement('div', 'result-title')
        const name = createElement('strong', '', result.name)
        name.title = result.name
        const status = createElement('span', result.success ? '' : 'is-failed', result.success ? '已校验' : '失败')
        title.append(name, status)
        row.append(title)
        if (result.success) row.append(createElement('p', 'result-output', result.outputName))
        else row.append(createElement('p', 'result-error', result.error))
        list.append(row)
    }
    card.append(list)
    replaceChildren(region, card)
}

async function copyText (text) {
    try {
        await navigator.clipboard.writeText(text)
    } catch {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        document.body.append(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
    }
}

function csvCell (value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function extractionCsv (results) {
    const rows = [['文件名', '状态', '水印内容', '格式', '错误']]
    for (const result of results) {
        rows.push([
            result.name,
            result.success ? '成功' : '失败',
            result.success ? result.watermark : '',
            result.format || '',
            result.error || ''
        ])
    }
    return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}

function renderExtractResults (region, results) {
    const successes = results.filter(result => result.success)
    const failures = results.length - successes.length
    const card = createElement('section', `result-card${successes.length ? '' : ' is-error'}`)
    const head = createElement('div', 'result-head')
    const copy = createElement('div')
    copy.append(
        createElement('h3', '', successes.length ? '提取完成' : '未提取到可信结果'),
        createElement('p', '', `${successes.length} 张成功${failures ? `，${failures} 张失败` : ''}`)
    )
    head.append(copy)

    const actions = createElement('div', 'result-actions')
    const copyButton = createElement('button', 'secondary-button', '复制成功项')
    copyButton.type = 'button'
    copyButton.disabled = successes.length === 0
    copyButton.addEventListener('click', () => {
        copyText(successes.map(result => `${result.name}\t${result.watermark}`).join('\n'))
    })
    const csvButton = createElement('button', 'secondary-button', '下载 CSV')
    csvButton.type = 'button'
    csvButton.addEventListener('click', () => {
        downloadBlob(new Blob([extractionCsv(results)], { type: 'text/csv;charset=utf-8' }), 'blind-watermark-results.csv')
    })
    actions.append(copyButton, csvButton)
    head.append(actions)
    card.append(head)

    const list = createElement('ul', 'result-list')
    for (const result of results) {
        const row = createElement('li')
        const title = createElement('div', 'result-title')
        const name = createElement('strong', '', result.name)
        name.title = result.name
        const statusText = result.success ? (result.verified ? '已校验' : '未校验') : '失败'
        title.append(name, createElement('span', result.success ? '' : 'is-failed', statusText))
        row.append(title)
        if (result.success) row.append(createElement('pre', 'result-output', result.watermark))
        else row.append(createElement('p', 'result-error', result.error))
        list.append(row)
    }
    card.append(list)
    replaceChildren(region, card)
}

async function extractLegacyWeb (file, password, watermarkLength) {
    const formData = new FormData()
    formData.append('image', file, file.name)
    formData.append('password', password)
    formData.append('wm_length', watermarkLength)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 180_000)
    try {
        const response = await fetch('/api/extract', {
            method: 'POST',
            body: formData,
            signal: controller.signal
        })
        const contentType = response.headers.get('content-type') || ''
        const payload = contentType.includes('application/json') ? await response.json() : null
        if (!response.ok) throw new Error(payload?.error || '旧版服务器提取失败')
        return {
            watermark: payload.watermark,
            format: payload.algorithm || 'python-blind-watermark-v1',
            verified: false
        }
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('旧版服务器处理超时')
        throw error
    } finally {
        window.clearTimeout(timeout)
    }
}

function setupTabs () {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
    function activate (target) {
        for (const tab of tabs) {
            const active = tab === target
            tab.setAttribute('aria-selected', String(active))
            tab.tabIndex = active ? 0 : -1
            document.getElementById(tab.getAttribute('aria-controls')).hidden = !active
        }
        target.focus()
    }
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activate(tab))
        tab.addEventListener('keydown', event => {
            let next = null
            if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length]
            if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length]
            if (event.key === 'Home') next = tabs[0]
            if (event.key === 'End') next = tabs[tabs.length - 1]
            if (next) {
                event.preventDefault()
                activate(next)
            }
        })
    })
}

function setupPasswordToggles () {
    document.querySelectorAll('[data-toggle-password]').forEach(button => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.togglePassword)
            const showing = input.type === 'text'
            input.type = showing ? 'password' : 'text'
            button.textContent = showing ? '显示' : '隐藏'
        })
    })
}

const embedQueue = createQueue('embed')
const extractQueue = createQueue('extract')
let runWorker
try {
    runWorker = createWorkerClient()
} catch (error) {
    document.getElementById('embed-result').textContent = error.message
    document.getElementById('extract-result').textContent = error.message
}

setupTabs()
setupPasswordToggles()

const watermarkInput = document.getElementById('watermark')
const watermarkCount = document.getElementById('watermark-count')
watermarkInput.addEventListener('input', () => {
    const length = textEncoder.encode(watermarkInput.value).length
    watermarkCount.textContent = `${length} / ${LIMITS.maxPayloadBytes} 字节`
    watermarkCount.classList.toggle('is-over', length > LIMITS.maxPayloadBytes)
})

const extractMode = document.getElementById('extract-mode')
const legacyLengthField = document.getElementById('legacy-length-field')
const legacyLength = document.getElementById('legacy-length')
const legacyWarning = document.getElementById('legacy-warning')
const extractPrivacy = document.getElementById('extract-privacy')

function updateExtractMode () {
    const isLegacy = extractMode.value !== 'auto'
    legacyLengthField.hidden = !isLegacy
    legacyLength.step = extractMode.value === 'legacy-utools' ? '56' : '1'
    legacyLength.min = extractMode.value === 'legacy-utools' ? '56' : '1'
    legacyWarning.hidden = !isLegacy
    if (extractMode.value === 'legacy-web') {
        legacyWarning.textContent = '旧版 Web 算法只能由服务器兼容提取。所选图片会上传到当前站点，请仅在 HTTPS 和可信部署上使用。结果无法校验真伪。'
        extractPrivacy.textContent = '兼容模式：旧版 Web 图片会上传到当前服务器。'
    } else if (extractMode.value === 'legacy-utools') {
        legacyWarning.textContent = '旧版 uTools 格式没有自动长度和完整性校验，提取内容仅作为候选结果。'
        extractPrivacy.textContent = '全程本地：旧版 uTools 图片不会上传。'
    } else {
        legacyWarning.textContent = ''
        extractPrivacy.textContent = '全程本地：新版图片不会上传。'
    }
}

extractMode.addEventListener('change', updateExtractMode)
updateExtractMode()

document.getElementById('embed-form').addEventListener('submit', async event => {
    event.preventDefault()
    const region = document.getElementById('embed-result')
    const submit = document.getElementById('embed-submit')
    const text = watermarkInput.value
    const password = document.getElementById('embed-password').value
    const resize = document.getElementById('embed-resize').checked
    const textBytes = textEncoder.encode(text).length
    const passwordBytes = textEncoder.encode(password).length

    if (!embedQueue.items.length) {
        renderEmbedResults(region, [{ name: '批次', success: false, error: '请先选择至少一张图片' }], null)
        return
    }
    if (!text.trim() || textBytes > LIMITS.maxPayloadBytes) {
        renderEmbedResults(region, [{ name: '水印内容', success: false, error: textBytes ? '水印内容不能超过 4096 字节' : '请输入水印内容' }], null)
        return
    }
    if (!password || passwordBytes > LIMITS.maxPasswordBytes) {
        renderEmbedResults(region, [{ name: '密码', success: false, error: password ? '密码不能超过 128 字节' : '请输入密码' }], null)
        return
    }
    if (!runWorker) return

    embedQueue.setLocked(true)
    embedQueue.resetStatuses()
    submit.disabled = true
    const originalLabel = submit.textContent
    const results = []
    const outputNames = new Set()
    let processedPixels = 0
    renderBusy(region, '正在嵌入水印', `准备处理 ${embedQueue.items.length} 张图片`)

    try {
        for (let index = 0; index < embedQueue.items.length; index++) {
            const item = embedQueue.items[index]
            submit.textContent = `处理中 ${index + 1} / ${embedQueue.items.length}`
            embedQueue.setStatus(index, 'processing')
            try {
                const decoded = await decodeImage(item.file, { resize, pixelLimit: LIMITS.maxPixels })
                processedPixels += decoded.pixels
                if (processedPixels > LIMITS.maxTotalProcessedPixels) {
                    throw new Error('本批次解码后的总像素过大，请减少图片数量')
                }
                const response = await runWorker({
                    action: 'embed',
                    rgba: decoded.rgba,
                    width: decoded.width,
                    height: decoded.height,
                    text,
                    password
                }, [decoded.rgba])
                const blob = await encodePng(response.rgba, response.width, response.height)
                const outputName = uniqueOutputName(item.file.name, outputNames)
                results.push({
                    name: item.file.name,
                    success: true,
                    outputName,
                    blob,
                    format: response.format,
                    encodedBits: response.encodedBits,
                    capacityBits: response.capacityBits
                })
                embedQueue.setStatus(index, 'success')
            } catch (error) {
                const message = error.message || '图片处理失败'
                results.push({ name: item.file.name, success: false, error: message })
                embedQueue.setStatus(index, 'failed', message)
            }
        }

        const successes = results.filter(result => result.success)
        let download = null
        if (successes.length === 1 && results.length === 1) {
            download = { blob: successes[0].blob, name: successes[0].outputName }
        } else if (successes.length) {
            const manifest = {
                schemaVersion: 1,
                algorithmVersion: 'BWM2',
                createdAt: new Date().toISOString(),
                results: results.map(result => ({
                    originalName: result.name,
                    outputName: result.outputName || null,
                    status: result.success ? 'success' : 'failed',
                    encodedBits: result.encodedBits || null,
                    capacityBits: result.capacityBits || null,
                    error: result.success ? null : result.error
                }))
            }
            const entries = successes.map(result => ({ name: result.outputName, blob: result.blob }))
            entries.push({
                name: 'blind-watermark-manifest.json',
                blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
            })
            download = { blob: await createZip(entries), name: 'blind-watermark-results.zip' }
        }
        if (download) downloadBlob(download.blob, download.name)
        renderEmbedResults(region, results, download)
    } catch (error) {
        const message = error.message || '批量处理失败'
        renderEmbedResults(region, [
            ...results,
            { name: '批次', success: false, error: message }
        ], null)
    } finally {
        submit.disabled = false
        submit.textContent = originalLabel
        embedQueue.setLocked(false)
    }
})

document.getElementById('extract-form').addEventListener('submit', async event => {
    event.preventDefault()
    const region = document.getElementById('extract-result')
    const submit = document.getElementById('extract-submit')
    const mode = extractMode.value
    const password = document.getElementById('extract-password').value
    const passwordBytes = textEncoder.encode(password).length
    const lengthText = legacyLength.value

    if (!extractQueue.items.length) {
        renderExtractResults(region, [{ name: '批次', success: false, error: '请先选择至少一张图片' }])
        return
    }
    if (!password || passwordBytes > LIMITS.maxPasswordBytes) {
        renderExtractResults(region, [{ name: '密码', success: false, error: password ? '密码不能超过 128 字节' : '请输入密码' }])
        return
    }
    if (mode !== 'auto' && !/^[1-9]\d*$/.test(lengthText)) {
        renderExtractResults(region, [{ name: '旧版长度', success: false, error: '请输入有效的正整数长度' }])
        return
    }
    const parsedLength = mode === 'auto' ? null : Number(lengthText)
    if (mode === 'legacy-utools' && (!Number.isSafeInteger(parsedLength) || parsedLength % 56 !== 0)) {
        renderExtractResults(region, [{ name: '旧版长度', success: false, error: '旧版 uTools 长度必须是 56 的正整数倍' }])
        return
    }
    if (mode === 'legacy-web' && !/^\d+$/.test(password)) {
        renderExtractResults(region, [{ name: '旧版 Web 密码', success: false, error: '旧版 Web 密码必须是非负整数' }])
        return
    }
    if (!runWorker && mode !== 'legacy-web') return

    extractQueue.setLocked(true)
    extractQueue.resetStatuses()
    submit.disabled = true
    const originalLabel = submit.textContent
    const results = []
    let processedPixels = 0
    renderBusy(region, '正在提取水印', `准备处理 ${extractQueue.items.length} 张图片`)

    try {
        for (let index = 0; index < extractQueue.items.length; index++) {
            const item = extractQueue.items[index]
            submit.textContent = `处理中 ${index + 1} / ${extractQueue.items.length}`
            extractQueue.setStatus(index, 'processing')
            try {
                let response
                if (mode === 'legacy-web') {
                    response = await extractLegacyWeb(item.file, password, lengthText)
                } else {
                    const decoded = await decodeImage(item.file, { resize: false, pixelLimit: LIMITS.maxExtractPixels })
                    processedPixels += decoded.pixels
                    if (processedPixels > LIMITS.maxTotalProcessedPixels) {
                        throw new Error('本批次解码后的总像素过大，请减少图片数量')
                    }
                    response = await runWorker({
                        action: mode === 'legacy-utools' ? 'extract-legacy-utools' : 'extract',
                        rgba: decoded.rgba,
                        width: decoded.width,
                        height: decoded.height,
                        password,
                        legacyLength: parsedLength
                    }, [decoded.rgba])
                }
                results.push({
                    name: item.file.name,
                    success: true,
                    watermark: response.watermark,
                    format: response.format,
                    verified: response.verified
                })
                extractQueue.setStatus(index, 'success')
            } catch (error) {
                const message = error.message || '水印提取失败'
                results.push({ name: item.file.name, success: false, error: message })
                extractQueue.setStatus(index, 'failed', message)
            }
        }
        renderExtractResults(region, results)
    } catch (error) {
        const message = error.message || '批量提取失败'
        renderExtractResults(region, [
            ...results,
            { name: '批次', success: false, error: message }
        ])
    } finally {
        submit.disabled = false
        submit.textContent = originalLabel
        extractQueue.setLocked(false)
    }
})
