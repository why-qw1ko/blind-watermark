import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = dirname(fileURLToPath(import.meta.url))

function copyWatermarkCore () {
  return {
    name: 'copy-watermark-core',
    closeBundle () {
      const source = resolve(projectDir, '../shared/watermark-core.js')
      const destination = resolve(projectDir, 'dist/preload/watermark-core.js')
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination)
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), copyWatermarkCore()],
  base: './'
})
