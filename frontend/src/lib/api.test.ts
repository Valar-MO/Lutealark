import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearAgentSessionCache,
  createAgentSession,
  isOfflineSessionCode,
  reconnectAgentSession,
  sendAgentMessage,
  sendAgentMessageWithSessionRetry,
} from './api'
import {
  accountDataSubject,
  resetDataSubjectMemoryForTests,
  setActiveDataSubject,
} from './data-subject'

const DEVICE_ID = '11111111-1111-4111-8111-111111111111'
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'

afterEach(() => {
  clearAgentSessionCache()
  resetDataSubjectMemoryForTests()
  vi.unstubAllGlobals()
})

describe('Agent identity headers', () => {
  it('sends the same device UUID for session and chat even when the active cache subject is an account', async () => {
    const storage = memoryStorage({ 'lutealark.device-id.v1': DEVICE_ID })
    vi.stubGlobal('window', {
      localStorage: storage,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    setActiveDataSubject(accountDataSubject(ACCOUNT_ID))

    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      const body = url.endsWith('/api/agent/session')
        ? { sessionCode: 'session-1' }
        : { sessionCode: 'session-1', content: '好的', metadata: {} }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const sessionCode = await createAgentSession(true)
    await sendAgentMessage(sessionCode, '你好')

    expect(calls.map((call) => call.url)).toEqual([
      '/api/agent/session',
      '/api/agent/chat',
    ])
    const identityHeaders = calls.map((call) => new Headers(call.init?.headers).get('X-Lutealark-User-Id'))
    expect(identityHeaders).toEqual([DEVICE_ID, DEVICE_ID])
    expect(identityHeaders).not.toContain(ACCOUNT_ID)
  })
})

describe('Agent session recreation', () => {
  it('clears the cached session, creates a replacement and retries the same message once', async () => {
    const storage = memoryStorage({ 'lutealark.device-id.v1': DEVICE_ID })
    vi.stubGlobal('window', {
      localStorage: storage,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })

    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (calls.length === 1) return jsonResponse({ sessionCode: 'stale-session' })
      if (calls.length === 2) {
        return jsonResponse({
          error: 'AGENT_SESSION_RECREATE_REQUIRED',
          message: '会话需要重建',
        }, 409)
      }
      if (calls.length === 3) return jsonResponse({ sessionCode: 'replacement-session' })
      return jsonResponse({
        sessionCode: 'replacement-session',
        content: '重试成功',
        metadata: {},
      })
    }))

    const staleSessionCode = await createAgentSession(true)
    const changedSessionCodes: string[] = []
    const reply = await sendAgentMessageWithSessionRetry({
      sessionCode: staleSessionCode,
      message: '请帮我拆解今天的任务',
      onSessionCode: (code) => changedSessionCodes.push(code),
    })

    expect(reply.content).toBe('重试成功')
    expect(calls.map((call) => call.url)).toEqual([
      '/api/agent/session',
      '/api/agent/chat',
      '/api/agent/session',
      '/api/agent/chat',
    ])
    expect(changedSessionCodes).toEqual(['', 'replacement-session'])

    const chatPayloads = calls
      .filter((call) => call.url.endsWith('/api/agent/chat'))
      .map((call) => JSON.parse(String(call.init?.body)) as Record<string, unknown>)
    expect(chatPayloads).toHaveLength(2)
    expect(chatPayloads[0]).toMatchObject({
      sessionCode: 'stale-session',
      message: '请帮我拆解今天的任务',
    })
    expect(chatPayloads[1]).toEqual({
      ...chatPayloads[0],
      sessionCode: 'replacement-session',
    })
  })

  it('does not recreate a replacement session more than once', async () => {
    const storage = memoryStorage({ 'lutealark.device-id.v1': DEVICE_ID })
    vi.stubGlobal('window', {
      localStorage: storage,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })

    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      if (calls.length === 1) {
        return jsonResponse({
          code: 'AGENT_SESSION_RECREATE_REQUIRED',
          message: '会话需要重建',
        }, 409)
      }
      if (calls.length === 2) return jsonResponse({ sessionCode: 'replacement-session' })
      return jsonResponse({
        error: 'AGENT_SESSION_RECREATE_REQUIRED',
        message: '新会话仍无效',
      }, 409)
    }))

    await expect(sendAgentMessageWithSessionRetry({
      sessionCode: 'stale-session',
      message: '你好',
      onSessionCode: () => undefined,
    })).rejects.toMatchObject({
      code: 'AGENT_SESSION_RECREATE_REQUIRED',
      message: '新会话仍无效',
    })

    expect(calls).toEqual([
      '/api/agent/chat',
      '/api/agent/session',
      '/api/agent/chat',
    ])
  })

  it('does not retry unrelated chat errors', async () => {
    const storage = memoryStorage({ 'lutealark.device-id.v1': DEVICE_ID })
    vi.stubGlobal('window', {
      localStorage: storage,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })

    const fetchMock = vi.fn(async () => jsonResponse({
      error: 'AGENT_CHAT_FAILED',
      message: '暂时无法回复',
    }, 503))
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendAgentMessageWithSessionRetry({
      sessionCode: 'current-session',
      message: '你好',
      onSessionCode: () => undefined,
    })).rejects.toMatchObject({ code: 'AGENT_CHAT_FAILED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('OpenTrek reconnection', () => {
  it('recognizes only the reserved offline session prefix', () => {
    expect(isOfflineSessionCode('offline:session-1')).toBe(true)
    expect(isOfflineSessionCode('online-session')).toBe(false)
    expect(isOfflineSessionCode('')).toBe(false)
  })

  it('forces a fresh session and rejects a repeated offline fallback', async () => {
    const storage = memoryStorage({ 'lutealark.device-id.v1': DEVICE_ID })
    vi.stubGlobal('window', {
      localStorage: storage,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    const fetchMock = vi.fn(async () => jsonResponse({
      sessionCode: 'offline:fallback-session',
      mode: 'offline',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(reconnectAgentSession()).rejects.toThrow('OpenTrek 当前仍不可用')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns the fresh online session after connectivity is restored', async () => {
    const storage = memoryStorage({ 'lutealark.device-id.v1': DEVICE_ID })
    vi.stubGlobal('window', {
      localStorage: storage,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      sessionCode: 'online-session',
      mode: 'online',
    })))

    await expect(reconnectAgentSession()).resolves.toBe('online-session')
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function memoryStorage(initial: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}
