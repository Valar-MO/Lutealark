/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const chatCss = readFileSync(new URL('./chat-ui.css', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const chatSource = readFileSync(new URL('./chat-ui.tsx', import.meta.url), 'utf8')

describe('watercolor surface contracts', () => {
  it('uses the supplied background on the visible application frame itself', () => {
    const frameRule = indexCss.match(/#root > div > div \{[\s\S]*?\n}/)?.[0] ?? ''

    expect(frameRule).toContain("url('/assets/background.jpg')")
    expect(frameRule).toContain('background-position: center 70%')
  })

  it('places the supplied background inside the cycle and Agent entry panels', () => {
    const surfaceRule = indexCss.match(/\.cycle-main-surface,[\s\S]*?\n}/)?.[0] ?? ''
    const cycleCardRule = indexCss.match(/\.cycle-design-home,[\s\S]*?\n}/)?.[0] ?? ''
    const agentCardRule = chatCss.match(/\.agent-entry-stage \.chat-welcome-card,[\s\S]*?\n}/)?.[0] ?? ''

    expect(surfaceRule).toContain('.agent-home-surface')
    expect(surfaceRule).toContain("url('/assets/background.jpg')")
    expect(surfaceRule).toContain('background-position: center 70%')
    expect(cycleCardRule).toContain("url('/assets/background.jpg')")
    expect(cycleCardRule).toContain('background-position: center 78%')
    expect(agentCardRule).toContain("url('/assets/background.jpg')")
    expect(agentCardRule).toContain('background-position: center 78%')
  })

  it('places the same background inside the full-screen chat panel', () => {
    const chatRule = chatCss.match(/\.chat-experience \{[\s\S]*?\n}/)?.[0] ?? ''

    expect(chatRule).toContain("url('/assets/background.jpg')")
    expect(chatRule).toContain('background-position: center 70%')
    expect(appSource).toContain('agent-home-back-button')
    expect(chatSource).toContain('className="chat-back-button"')
    expect(chatCss).toMatch(/\.chat-back-button \{[^}]*min-height: 44px/)
  })
})
