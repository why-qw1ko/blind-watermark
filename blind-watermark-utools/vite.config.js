import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

function inlinePluginAssets () {
  return {
    name: 'inline-utools-assets',
    apply: 'build',
    closeBundle () {
      const htmlPath = resolve(projectDir, 'dist/index.html')
      const scriptPath = resolve(projectDir, 'dist/assets/index.js')
      const stylePath = resolve(projectDir, 'dist/assets/style.css')
      let html = readFileSync(htmlPath, 'utf8')
      const script = readFileSync(scriptPath, 'utf8').replace(/<\/script/gi, '<\\/script')
      const style = readFileSync(stylePath, 'utf8').replace(/<\/style/gi, '<\\/style')
      const scriptTag = /<script\b[^>]*\bsrc="\.\/assets\/index\.js"[^>]*><\/script>/
      const styleTag = /<link\b[^>]*\bhref="\.\/assets\/style\.css"[^>]*>/
      if (!scriptTag.test(html) || !styleTag.test(html)) throw new Error('无法找到 uTools 构建入口资源')
      html = html.replace(styleTag, () => `<style>${style}</style>`)
      html = html.replace(scriptTag, '')
      const bodyEnd = html.lastIndexOf('</body>')
      if (bodyEnd < 0) throw new Error('无法找到 uTools 页面 body')
      html = `${html.slice(0, bodyEnd)}<script>${script}</script>\n  ${html.slice(bodyEnd)}`
      writeFileSync(htmlPath, html)
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), copyWatermarkCore(), inlinePluginAssets()],
  base: './',
  build: {
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
})
