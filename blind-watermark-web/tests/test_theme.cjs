const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const script = fs.readFileSync(path.join(__dirname, '../static/theme.js'), 'utf8')

function setup ({ saved = null, dark = false, blocked = false } = {}) {
  const handlers = {}
  const button = {
    attrs: {},
    setAttribute (name, value) { this.attrs[name] = value },
    addEventListener (name, handler) { handlers[name] = handler }
  }
  const media = { matches: dark, addEventListener (name, handler) { handlers[`media:${name}`] = handler } }
  const storage = {
    value: saved,
    getItem () { if (blocked) throw new Error('storage blocked'); return this.value },
    setItem (key, value) { if (blocked) throw new Error('storage blocked'); this.value = value }
  }
  const document = {
    documentElement: { dataset: {} },
    getElementById: () => button,
    addEventListener (name, handler) { handlers[name] = handler }
  }
  vm.runInNewContext(script, { document, window: { matchMedia: () => media }, localStorage: storage })
  handlers.DOMContentLoaded()
  return { document, button, media, storage, handlers }
}

test('follows system theme until the user selects a theme', () => {
  const state = setup({ dark: true })
  assert.equal(state.document.documentElement.dataset.theme, 'dark')
  assert.equal(state.button.attrs['aria-label'], '切换至浅色模式')
  state.handlers.click()
  assert.equal(state.document.documentElement.dataset.theme, 'light')
  assert.equal(state.storage.value, 'light')
  state.media.matches = true
  state.handlers['media:change']()
  assert.equal(state.document.documentElement.dataset.theme, 'light')
})

test('restores a saved theme and works when storage is unavailable', () => {
  const saved = setup({ saved: 'dark' })
  assert.equal(saved.document.documentElement.dataset.theme, 'dark')
  const blocked = setup({ blocked: true })
  blocked.handlers.click()
  assert.equal(blocked.document.documentElement.dataset.theme, 'dark')
})

test('responds to system theme changes before a user selection', () => {
  const state = setup()
  state.media.matches = true
  state.handlers['media:change']()
  assert.equal(state.document.documentElement.dataset.theme, 'dark')
})
