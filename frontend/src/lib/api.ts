type SessionResponse = {
  sessionCode: string
}

export type ChatResponse = {
  sessionCode: string
  content: string
  metadata: Record<string, unknown>
}

export type CycleSettings = {
  lastPeriodDate: string
  cycleLength: number
}

export type CycleResult = {
  currentPhase: string
  phaseName: string
  isBufferMode: boolean
  dayOfCycle: number
  daysToNextPeriod: number
  energyValue: number
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
let sessionPromise: Promise<string> | null = null

export function createAgentSession(forceNew = false): Promise<string> {
  if (forceNew) sessionPromise = null
  if (sessionPromise) return sessionPromise

  sessionPromise = request<SessionResponse>('/api/agent/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
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
) {
  return request<ChatResponse>('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      sessionCode,
      message,
      metadata: {},
      cycleSettings,
      attachments: [],
    }),
  })
}

export function calculateCycle(settings: CycleSettings) {
  return request<CycleResult>('/api/workflow/cycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(settings),
  })
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, init)
  } catch {
    throw new Error('无法连接后端，请确认后端已经在 3000 端口启动。')
  }

  const data = await response.json().catch(() => null) as (T & { message?: string }) | null
  if (!response.ok || !data) {
    throw new Error(data?.message || `请求失败（${response.status}）`)
  }
  return data
}
