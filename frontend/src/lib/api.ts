import type {
  AgentChatResponse,
  CreateAgentSessionResponse,
  CycleResult as SharedCycleResult,
  CycleSettings as SharedCycleSettings,
  DailyCheckin,
} from '@lutealark/contracts'
import { getOrCreateDeviceId } from './data-subject'
import { getNativeAccessToken, isNativeRuntime } from './native-auth'

type SessionResponse = CreateAgentSessionResponse
export type ChatResponse = AgentChatResponse

export class ApiRequestError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

export type CycleSettings = SharedCycleSettings
export type CycleResult = SharedCycleResult
export type DailyCheckIn = DailyCheckin

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')
const SESSION_TIMEOUT_MS = 20_000
const CHAT_TIMEOUT_MS = 130_000
const CYCLE_TIMEOUT_MS = 10_000
const AGENT_SESSION_RECREATE_REQUIRED = 'AGENT_SESSION_RECREATE_REQUIRED'
let sessionPromise: Promise<string> | null = null

export function validateNativeApiConfiguration() {
  if (!isNativeRuntime()) return
  if (!apiBaseUrl) {
    throw new Error('原生应用缺少后端地址，请将 VITE_API_BASE_URL 设置为 HTTPS origin。')
  }
  let parsed: URL
  try {
    parsed = new URL(apiBaseUrl)
  } catch {
    throw new Error('原生应用的 VITE_API_BASE_URL 不是有效网址。')
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || parsed.origin !== apiBaseUrl
  ) {
    throw new Error('原生应用的 VITE_API_BASE_URL 必须是无路径、凭据、查询或片段的 HTTPS origin。')
  }
}

export function isOfflineSessionCode(sessionCode: string | null | undefined): boolean {
  return typeof sessionCode === 'string' && sessionCode.startsWith('offline:')
}

/**
 * Create a fresh session and require the OpenTrek-backed kind. In `auto`
 * mode the server may legitimately return an offline fallback; callers that
 * explicitly asked to reconnect must be able to distinguish that outcome.
 */
export async function reconnectAgentSession(): Promise<string> {
  const sessionCode = await createAgentSession(true)
  if (isOfflineSessionCode(sessionCode)) {
    throw new Error('OpenTrek 当前仍不可用，请确认 VPN 后再试。')
  }
  return sessionCode
}

type SendAgentMessageWithSessionRetryInput = {
  sessionCode: string
  message: string
  cycleSettings?: CycleSettings
  dailyCheckin?: DailyCheckIn
  dailyCheckins?: DailyCheckIn[]
  onSessionCode: (sessionCode: string) => void
}

export function clearAgentSessionCache() {
  sessionPromise = null
}

export function createAgentSession(forceNew = false): Promise<string> {
  if (forceNew) sessionPromise = null
  if (sessionPromise) return sessionPromise

  sessionPromise = requestJson<SessionResponse>('/api/agent/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Lutealark-User-Id': getOrCreateDeviceId(),
    },
    body: '{}',
  }, SESSION_TIMEOUT_MS)
    .then((result) => result.sessionCode)
    .catch((error) => {
      sessionPromise = null
      throw error
    })

  return sessionPromise
}

export function sendAgentMessage(
  sessionCode: string,
  message: string,
  cycleSettings?: CycleSettings,
  dailyCheckin?: DailyCheckIn,
  dailyCheckins?: DailyCheckIn[],
) {
  return requestJson<ChatResponse>('/api/agent/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Lutealark-User-Id': getOrCreateDeviceId(),
    },
    body: JSON.stringify({
      sessionCode,
      message,
      metadata: {},
      cycleSettings,
      dailyCheckin,
      dailyCheckins,
      attachments: [],
    }),
  }, CHAT_TIMEOUT_MS)
}

/**
 * Recreates a session only for the backend's stable stale-session error and
 * retries the same chat request once. UI message insertion and persistence stay
 * outside this function, so the transport retry cannot duplicate them.
 */
export async function sendAgentMessageWithSessionRetry({
  sessionCode,
  message,
  cycleSettings,
  dailyCheckin,
  dailyCheckins,
  onSessionCode,
}: SendAgentMessageWithSessionRetryInput): Promise<ChatResponse> {
  let activeSessionCode = sessionCode
  if (!activeSessionCode) {
    activeSessionCode = await createAgentSession()
    onSessionCode(activeSessionCode)
  }

  const send = async (code: string) => {
    const reply = await sendAgentMessage(
      code,
      message,
      cycleSettings,
      dailyCheckin,
      dailyCheckins,
    )
    if (reply.sessionCode !== code) onSessionCode(reply.sessionCode)
    return reply
  }

  try {
    return await send(activeSessionCode)
  } catch (cause) {
    if (!(cause instanceof ApiRequestError) || cause.code !== AGENT_SESSION_RECREATE_REQUIRED) {
      throw cause
    }
  }

  clearAgentSessionCache()
  onSessionCode('')
  const replacementSessionCode = await createAgentSession(true)
  onSessionCode(replacementSessionCode)
  return send(replacementSessionCode)
}

export function calculateCycle(settings: CycleSettings) {
  return requestJson<CycleResult>('/api/workflow/cycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(settings),
  }, CYCLE_TIMEOUT_MS)
}

export async function requestJson<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  validateNativeApiConfiguration()
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    const headers = new Headers(init.headers)
    if (isNativeRuntime()) {
      headers.set('X-Lutealark-Client', 'capacitor')
      const token = await getNativeAccessToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)
    }
    response = await fetch(`${apiBaseUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers,
      signal: controller.signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new Error('请求等待时间过长，请稍后重试。')
    }
    throw new Error('无法连接服务，请检查网络后重试。')
  } finally {
    window.clearTimeout(timeout)
  }

  const data = await response.json().catch(() => null) as (T & {
    message?: string
    error?: unknown
    code?: unknown
  }) | null
  if (!response.ok || !data) {
    const errorCode = typeof data?.error === 'string'
      ? data.error
      : typeof data?.code === 'string'
        ? data.code
        : undefined
    throw new ApiRequestError(data?.message || `请求失败（${response.status}）`, response.status, errorCode)
  }
  return data
}
