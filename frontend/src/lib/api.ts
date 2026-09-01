import type {
  AgentChatResponse,
  CreateAgentSessionResponse,
  CycleResult as SharedCycleResult,
  CycleSettings as SharedCycleSettings,
  CycleEvent,
  CycleEventMutationResult,
  DailyCheckin,
} from '@lutealark/contracts'
import { getOrCreateDeviceId } from './data-subject'

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
export type CycleEventRecord = CycleEvent
export type CycleEventSaveResult = CycleEventMutationResult

const SESSION_TIMEOUT_MS = 20_000
const CHAT_TIMEOUT_MS = 130_000
const CYCLE_TIMEOUT_MS = 10_000
const AGENT_SESSION_RECREATE_REQUIRED = 'AGENT_SESSION_RECREATE_REQUIRED'
let sessionPromise: Promise<string> | null = null

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
  isActive?: () => boolean
}

export function clearAgentSessionCache() {
  sessionPromise = null
}

export function createAgentSession(forceNew = false): Promise<string> {
  if (forceNew) sessionPromise = null
  if (sessionPromise) return sessionPromise

  const operation = requestJson<SessionResponse>('/api/agent/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Lutealark-User-Id': getOrCreateDeviceId(),
    },
    body: '{}',
  }, SESSION_TIMEOUT_MS)
    .then((result) => result.sessionCode)
    .catch((error) => {
      // A force-new request can replace this operation while it is still in
      // flight. A late failure from the old request must not clear the newer
      // subject's cached Session promise.
      if (sessionPromise === operation) sessionPromise = null
      throw error
    })
  sessionPromise = operation
  return operation
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
  isActive = () => true,
}: SendAgentMessageWithSessionRetryInput): Promise<ChatResponse> {
  const assertActive = () => {
    if (!isActive()) throw new Error('数据主体已变更，已取消旧对话重试。')
  }
  assertActive()
  let activeSessionCode = sessionCode
  if (!activeSessionCode) {
    activeSessionCode = await createAgentSession()
    assertActive()
    onSessionCode(activeSessionCode)
  }

  const send = async (code: string) => {
    assertActive()
    const reply = await sendAgentMessage(
      code,
      message,
      cycleSettings,
      dailyCheckin,
      dailyCheckins,
    )
    assertActive()
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

  assertActive()
  clearAgentSessionCache()
  onSessionCode('')
  const replacementSessionCode = await createAgentSession(true)
  assertActive()
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
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'include',
      ...init,
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
