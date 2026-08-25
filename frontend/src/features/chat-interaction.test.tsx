import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentEntryCard, ChatExperience } from './chat-ui'

describe('chat interaction availability', () => {
  it('keeps the Agent entry interactive while a background session connects', () => {
    const markup = renderToStaticMarkup(createElement(AgentEntryCard, {
      onOpen: vi.fn(),
      onPrompt: vi.fn(),
      onAction: vi.fn(),
      onRecordFeeling: vi.fn(),
    }))

    expect(markup).toContain('今天想聊聊什么？')
    expect(markup).not.toContain('disabled=""')
  })

  it('keeps prompts, input and send available while connection runs in the background', () => {
    const markup = renderToStaticMarkup(createElement(ChatExperience, {
      messages: [],
      input: '有个任务启动不了',
      setInput: vi.fn(),
      isSending: false,
      isConnecting: true,
      isOfflineSession: false,
      isReconnectingOpenTrek: false,
      onReconnectOpenTrek: vi.fn(),
      error: '',
      clearError: vi.fn(),
      submitMessage: vi.fn(async () => undefined),
      onAction: vi.fn(),
      cycleResult: null,
      dailyCheckin: null,
      endRef: { current: null },
      onMemoryCandidateDecision: vi.fn(async () => undefined),
      onNewConversation: vi.fn(async () => undefined),
      onRecordFeeling: vi.fn(),
    }))

    expect(markup).toContain('正在连接缓冲站…')
    expect(markup).toContain('aria-label="聊天输入"')
    expect(markup).toContain('aria-label="发送"')
    expect(markup).not.toContain('disabled=""')
  })

  it('shows the new-conversation action as disabled while a message is sending', () => {
    const markup = renderToStaticMarkup(createElement(ChatExperience, {
      messages: [],
      input: '',
      setInput: vi.fn(),
      isSending: true,
      isConnecting: false,
      isOfflineSession: false,
      isReconnectingOpenTrek: false,
      onReconnectOpenTrek: vi.fn(),
      error: '',
      clearError: vi.fn(),
      submitMessage: vi.fn(async () => undefined),
      onAction: vi.fn(),
      cycleResult: null,
      dailyCheckin: null,
      endRef: { current: null },
      onMemoryCandidateDecision: vi.fn(async () => undefined),
      onNewConversation: vi.fn(async () => undefined),
      onRecordFeeling: vi.fn(),
    }))

    const newConversationButton = markup
      .match(/<button\b[^>]*>/g)
      ?.find((tag) => tag.includes('aria-label="新对话"'))

    expect(newConversationButton).toContain('disabled=""')
  })
})
