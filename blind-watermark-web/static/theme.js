'use strict'

;(() => {
    const storageKey = 'blind-watermark-theme'
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    let preference = null
    try {
        const saved = localStorage.getItem(storageKey)
        if (saved === 'light' || saved === 'dark') preference = saved
    } catch {}

    function applyTheme (theme) {
        document.documentElement.dataset.theme = theme
        const button = document.getElementById('theme-toggle')
        if (!button) return
        const next = theme === 'dark' ? '浅色' : '深色'
        button.setAttribute('aria-label', `切换至${next}模式`)
    }

    const currentTheme = () => preference || (systemTheme.matches ? 'dark' : 'light')
    applyTheme(currentTheme())
    systemTheme.addEventListener('change', () => {
        if (!preference) applyTheme(currentTheme())
    })
    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(currentTheme())
        document.getElementById('theme-toggle').addEventListener('click', () => {
            preference = currentTheme() === 'dark' ? 'light' : 'dark'
            try { localStorage.setItem(storageKey, preference) } catch {}
            applyTheme(preference)
        })
    })
})()
