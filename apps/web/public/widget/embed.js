(function () {
  'use strict'

  if (window.__vibeagent_loaded) return
  window.__vibeagent_loaded = true

  var script = document.currentScript
  if (!script) return

  var agentId = script.getAttribute('data-agent-id')
  if (!agentId) {
    console.warn('VibeAgent: missing data-agent-id attribute')
    return
  }

  var position = script.getAttribute('data-position') || 'bottom-right'
  var theme = script.getAttribute('data-theme') || 'light'
  var accentColor = script.getAttribute('data-accent-color') || '#a7e26e'
  var origin = new URL(script.src).origin
  var isOpen = false
  var bubble, panel, iframe, overlay

  // Inject styles
  var style = document.createElement('style')
  style.textContent = [
    '.va-widget-bubble {',
    '  position: fixed;',
    '  bottom: 20px;',
    '  ' + (position === 'bottom-left' ? 'left' : 'right') + ': 20px;',
    '  width: 56px;',
    '  height: 56px;',
    '  border-radius: 50%;',
    '  background: ' + accentColor + ';',
    '  border: none;',
    '  cursor: pointer;',
    '  z-index: 2147483647;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  box-shadow: 0 4px 16px rgba(0,0,0,0.18);',
    '  transition: transform 0.2s ease, box-shadow 0.2s ease;',
    '  padding: 0;',
    '}',
    '.va-widget-bubble:hover {',
    '  transform: scale(1.08);',
    '  box-shadow: 0 6px 24px rgba(0,0,0,0.22);',
    '}',
    '.va-widget-bubble svg {',
    '  width: 26px;',
    '  height: 26px;',
    '  fill: none;',
    '  stroke: #1a1915;',
    '  stroke-width: 2;',
    '  stroke-linecap: round;',
    '  stroke-linejoin: round;',
    '}',
    '.va-widget-panel {',
    '  position: fixed;',
    '  bottom: 88px;',
    '  ' + (position === 'bottom-left' ? 'left' : 'right') + ': 20px;',
    '  width: 400px;',
    '  height: 600px;',
    '  max-height: calc(100vh - 108px);',
    '  border-radius: 16px;',
    '  overflow: hidden;',
    '  box-shadow: 0 8px 40px rgba(0,0,0,0.16);',
    '  z-index: 2147483646;',
    '  opacity: 0;',
    '  transform: translateY(12px) scale(0.96);',
    '  transition: opacity 0.25s ease, transform 0.25s ease;',
    '  pointer-events: none;',
    '  border: 1px solid #e4e3e3;',
    '}',
    '.va-widget-panel.va-open {',
    '  opacity: 1;',
    '  transform: translateY(0) scale(1);',
    '  pointer-events: auto;',
    '}',
    '.va-widget-panel iframe {',
    '  width: 100%;',
    '  height: 100%;',
    '  border: none;',
    '  background: #f7f7f5;',
    '}',
    '.va-widget-overlay {',
    '  display: none;',
    '}',
    '@media (max-width: 639px) {',
    '  .va-widget-panel {',
    '    position: fixed;',
    '    top: 0;',
    '    left: 0;',
    '    right: 0;',
    '    bottom: 0;',
    '    width: 100%;',
    '    height: 100%;',
    '    max-height: 100%;',
    '    border-radius: 0;',
    '    border: none;',
    '  }',
    '  .va-widget-overlay {',
    '    display: block;',
    '    position: fixed;',
    '    top: 0;',
    '    left: 0;',
    '    right: 0;',
    '    bottom: 0;',
    '    background: rgba(0,0,0,0.4);',
    '    z-index: 2147483645;',
    '    opacity: 0;',
    '    transition: opacity 0.25s ease;',
    '    pointer-events: none;',
    '  }',
    '  .va-widget-overlay.va-open {',
    '    opacity: 1;',
    '    pointer-events: auto;',
    '  }',
    '}'
  ].join('\n')
  document.head.appendChild(style)

  // Create overlay (mobile backdrop)
  overlay = document.createElement('div')
  overlay.className = 'va-widget-overlay'
  overlay.addEventListener('click', function () {
    toggleWidget()
  })
  document.body.appendChild(overlay)

  // Create panel with iframe
  panel = document.createElement('div')
  panel.className = 'va-widget-panel'

  iframe = document.createElement('iframe')
  iframe.title = 'Chat Widget'
  iframe.allow = 'clipboard-write'
  // Lazy-load: don't set src until first open
  panel.appendChild(iframe)
  document.body.appendChild(panel)

  // Create bubble button
  bubble = document.createElement('button')
  bubble.className = 'va-widget-bubble'
  bubble.setAttribute('aria-label', 'Open chat')
  bubble.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
  bubble.addEventListener('click', function () {
    toggleWidget()
  })
  document.body.appendChild(bubble)

  function toggleWidget() {
    isOpen = !isOpen

    if (isOpen) {
      // Load iframe on first open
      if (!iframe.src) {
        iframe.src =
          origin +
          '/widget/' +
          encodeURIComponent(agentId) +
          '?embed=true&theme=' +
          encodeURIComponent(theme)
      }
      panel.classList.add('va-open')
      overlay.classList.add('va-open')
      bubble.innerHTML =
        '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
      bubble.setAttribute('aria-label', 'Close chat')
    } else {
      panel.classList.remove('va-open')
      overlay.classList.remove('va-open')
      bubble.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
      bubble.setAttribute('aria-label', 'Open chat')
    }
  }

  // Listen for messages from the iframe
  window.addEventListener('message', function (e) {
    if (e.origin !== origin) return
    if (e.data && e.data.type === 'vibeagent:close') {
      if (isOpen) toggleWidget()
    }
  })
})()
