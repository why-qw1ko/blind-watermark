document.querySelectorAll('.faq-toggle').forEach(button => {
    button.addEventListener('click', () => {
        const expanded = button.getAttribute('aria-expanded') === 'true'
        button.setAttribute('aria-expanded', String(!expanded))
        document.getElementById(button.getAttribute('aria-controls')).inert = expanded
    })
})
