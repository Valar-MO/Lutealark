import { describe, expect, it } from 'vitest'
import {
  parseAgentReplyMetadata,
  parseChatMetadata,
  parseKnowledgeSources,
  parseMemoryCandidate,
  sanitizeAgentReplyMetadata,
} from './chat-metadata'

describe('chat metadata', () => {
  it('labels offline mode and never invents sources', () => {
    expect(parseChatMetadata({ mode: 'offline', intent: 'pomodoro' })).toEqual({
      mode: 'offline',
      ragUsed: false,
      intent: 'pomodoro',
      action: undefined,
      sources: [],
      memoryCandidate: undefined,
      memoryCandidateStatus: undefined,
    })
  })

  it('preserves explicit online RAG status without inventing it', () => {
    expect(parseChatMetadata({
      mode: 'online',
      intent: 'cycle_question',
      ragUsed: true,
      sources: [{ sourceId: 'source-1', title: '资料' }],
    }).ragUsed).toBe(true)
    expect(parseChatMetadata({ mode: 'online', ragUsed: true }).ragUsed).toBeUndefined()
    expect(parseChatMetadata({ mode: 'online' }).ragUsed).toBeUndefined()
    expect(parseChatMetadata({ mode: 'offline', ragUsed: true }).ragUsed).toBe(false)
    expect(parseChatMetadata({
      mode: 'online',
      sources: [{ title: '没有 sourceId 的标题' }],
    }).sources).toEqual([])
  })

  it.each([
    'daily_checkin',
    'memory_request',
    'smalltalk',
    'safety_crisis',
    'unknown_intent',
    undefined,
  ])('does not trust RAG metadata for a non-retrieval intent: %s', (intent) => {
    const parsed = parseChatMetadata({
      mode: 'online',
      intent,
      ragUsed: true,
      sources: [{ sourceId: 'source-1', title: '不应显示' }],
    })

    expect(parsed.ragUsed).toBe(intent === 'safety_crisis' ? false : undefined)
    expect(parsed.sources).toEqual([])
  })

  it.each(['safety_crisis', 'crisis_support'])(
    'never exposes sources from a %s response',
    (intent) => {
      expect(parseChatMetadata({
        intent,
        sources: [{ sourceId: 'one', title: '不应显示', url: 'https://example.org/source' }],
      }).sources).toEqual([])
    },
  )

  it('deduplicates and caps safe sources at three', () => {
    const sources = parseKnowledgeSources([
      { sourceId: 'one', title: '一', url: 'https://example.org/one' },
      { sourceId: 'one', title: '一', url: 'https://example.org/one' },
      { sourceId: 'two', title: '二' },
      { sourceId: 'three', title: '三' },
      { sourceId: 'four', title: '四' },
    ])
    expect(sources.map((source) => source.sourceId)).toEqual(['one', 'two', 'three'])
  })

  it.each([
    'http://example.org/file',
    'https://localhost/file',
    'https://10.0.0.8/file',
    'https://100.64.0.8/file',
    'https://[::1]/file',
    'https://[fd00::8]/file',
    'https://[fec0::1]/file',
    'https://example.org/file?token=secret',
    'https://user:password@example.org/file',
  ])('drops an unsafe source URL: %s', (url) => {
    expect(parseKnowledgeSources([{ sourceId: 'one', title: '资料', url }]))
      .toEqual([{ sourceId: 'one', title: '资料', url: undefined, chunkId: undefined, excerpt: undefined, score: undefined }])
  })

  it('accepts only explicit, bounded long-term memory candidates', () => {
    const candidate = {
      candidateId: '934fb086-2917-465b-933f-bbb5a1b96081',
      kind: 'preference',
      summary: '更喜欢十分钟以内的小步骤',
      requiresConsent: true,
      sourceTurnHash: 'a'.repeat(64),
    }
    expect(parseMemoryCandidate(candidate)).toEqual(candidate)
    expect(parseMemoryCandidate({ ...candidate, requiresConsent: false })).toBeUndefined()
    expect(parseMemoryCandidate({ ...candidate, kind: 'medical_fact' })).toBeUndefined()
    expect(parseMemoryCandidate({ ...candidate, summary: '我今天很焦虑' })).toBeUndefined()
    expect(parseMemoryCandidate({ ...candidate, sourceTurnHash: 'a'.repeat(63) })).toBeUndefined()
    expect(parseMemoryCandidate({ ...candidate, sourceTurnHash: `${'a'.repeat(63)}g` })).toBeUndefined()
    expect(parseChatMetadata({ intent: 'safety_crisis', memoryCandidate: candidate }).memoryCandidate).toBeUndefined()
    expect(parseChatMetadata({ intent: 'memory_request', memoryCandidate: candidate }).memoryCandidate).toEqual(candidate)
  })

  it.each([
    '我现在很难过',
    '我最近压力很大、很紧张',
    '我这会儿心慌想哭',
    '我最近很疲惫、睡不好',
  ])('rejects transient emotional or physical state: %s', (summary) => {
    expect(parseMemoryCandidate({
      candidateId: '934fb086-2917-465b-933f-bbb5a1b96081',
      kind: 'preference',
      summary,
      requiresConsent: true,
      sourceTurnHash: 'c'.repeat(64),
    })).toBeUndefined()
  })

  it('never trusts a fresh agent response to claim a user memory decision', () => {
    const candidate = {
      candidateId: '934fb086-2917-465b-933f-bbb5a1b96081',
      kind: 'preference' as const,
      summary: '更喜欢十分钟以内的小步骤',
      requiresConsent: true as const,
      sourceTurnHash: 'b'.repeat(64),
    }
    const metadata = {
      intent: 'memory_request',
      memoryCandidate: candidate,
      memoryCandidateStatus: 'saved',
    }

    expect(parseAgentReplyMetadata(metadata)).toMatchObject({
      memoryCandidate: candidate,
      memoryCandidateStatus: undefined,
    })
    expect(sanitizeAgentReplyMetadata(metadata)).toEqual({
      intent: 'memory_request',
      memoryCandidate: candidate,
    })
    expect(parseChatMetadata(metadata).memoryCandidateStatus).toBe('saved')
  })

  it('never persists platform-returned long-term memory context aliases', () => {
    const sanitized = sanitizeAgentReplyMetadata({
      intent: 'task_support',
      action: 'open_focus_timer',
      memoryContext: [{ summary: '私密记忆 A' }],
      memory_context: [{ summary: '私密记忆 B' }],
      'Saved-Memory_Context': '私密记忆 C',
      LONG_TERM_MEMORY_CONTEXT: '私密记忆 D',
      'Long Term Memory Context': '私密记忆 E',
      memoryItems: [{ summary: '私密记忆 F' }],
      MEMORY_ITEMS: [{ summary: '私密记忆 G' }],
      'Usage-Policy': '不应写入',
      memory_usage_policy: '不应写入',
      'Saved Memory Usage Policy': '不应写入',
      MEMORY_CANDIDATE_STATUS: 'saved',
    })

    expect(sanitized).toEqual({
      intent: 'task_support',
      action: 'open_focus_timer',
    })
  })

  it.each(['safety_crisis', 'crisis_support'])(
    'does not persist sources, candidates or memory context for %s',
    (intent) => {
      expect(sanitizeAgentReplyMetadata({
        intent,
        sources: [{ title: '不应写入' }],
        memory_candidate: { summary: '不应写入' },
        saved_memory_context: [{ summary: '不应写入' }],
        mode: 'offline',
      })).toEqual({ intent, mode: 'offline' })
    },
  )
})
