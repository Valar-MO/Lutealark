import { ApiRequestError, requestJson } from './api'
import { getOrCreateDeviceId } from './personal-data'
import type {
  ActivityRecord,
  ActivityType,
  Conversation,
  ConversationDetail,
  ConversationMessage,
  DailyPlan,
  MemoryEntry,
  MemoryKind,
  PointsSummary,
} from '@lutealark/contracts'

export type {
  ActivityType,
  Conversation,
  ConversationDetail,
  ConversationMessage,
  DailyPlan,
  MemoryEntry,
  MemoryKind,
  PointEventType,
  PointsSummary,
} from '@lutealark/contracts'

const PRODUCT_TIMEOUT_MS = 10_000

export type ActivityMutationResult = {
  activity: ActivityRecord
  pointsAwarded: number
}

export function listConversations(includeArchived = true) {
  const search = new URLSearchParams({ includeArchived: String(includeArchived), limit: '100' })
  return productRequest<Conversation[]>(`/api/conversations?${search.toString()}`)
}

export function createConversation(input: { id?: string; title?: string | null } = {}) {
  return productRequest<Conversation>('/api/conversations', { method: 'POST', body: input })
}

export function getConversation(conversationId: string) {
  return productRequest<ConversationDetail>(`/api/conversations/${encodeURIComponent(conversationId)}`)
}

export function updateConversation(conversationId: string, input: { title?: string | null; archived?: boolean }) {
  return productRequest<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: 'PATCH', body: input })
}

export function deleteConversation(conversationId: string) {
  return productRequest<{ deleted: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
}

export function createConversationMessage(conversationId: string, input: {
  id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata?: Record<string, unknown>
  createdAt?: string
}) {
  return productRequest<ConversationMessage>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: 'POST', body: input },
  )
}

export function updateConversationMessage(
  conversationId: string,
  messageId: string,
  input: { content?: string; metadata?: Record<string, unknown> },
) {
  return productRequest<ConversationMessage>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'PATCH', body: input },
  )
}

export async function getDailyPlan(date: string): Promise<DailyPlan | null> {
  try {
    return await productRequest<DailyPlan>(`/api/plans/${encodeURIComponent(date)}`)
  } catch (cause) {
    if (cause instanceof ApiRequestError && cause.status === 404) return null
    throw cause
  }
}

export function upsertDailyPlan(input: {
  id?: string
  date: string
  title?: string | null
  energyLevel?: number | null
  items: Array<{ id: string; content: string; estimatedMinutes?: number | null; completed?: boolean }>
}) {
  return productRequest<DailyPlan>(`/api/plans/${encodeURIComponent(input.date)}`, { method: 'PUT', body: input })
}

export function deleteDailyPlan(date: string) {
  return productRequest<{ deleted: boolean }>(`/api/plans/${encodeURIComponent(date)}`, { method: 'DELETE' })
}

export function recordActivity(input: {
  id?: string
  type: ActivityType
  completedAt: string
  durationSeconds?: number | null
  note?: string | null
  metadata?: Record<string, unknown>
}) {
  return productRequest<ActivityMutationResult>('/api/activities', { method: 'PUT', body: input })
}

export function getPointsSummary(date?: string) {
  const query = date ? `?${new URLSearchParams({ date }).toString()}` : ''
  return productRequest<PointsSummary>(`/api/points/summary${query}`)
}

export function updateWeeklyPointsGoal(weeklyGoal: number) {
  return productRequest<{ weeklyGoal: number }>('/api/points/goal', { method: 'PUT', body: { weeklyGoal } })
}

export function listMemories(includeArchived = true) {
  const search = new URLSearchParams({ includeArchived: String(includeArchived), limit: '50' })
  return productRequest<MemoryEntry[]>(`/api/memories?${search.toString()}`)
}

export function createMemory(input: {
  id?: string
  kind: MemoryKind
  summary: string
  sourceConversationId?: string | null
  sourceTurnHash: string
  consent: true
}) {
  return productRequest<MemoryEntry>('/api/memories', { method: 'POST', body: input })
}

export function updateMemory(memoryId: string, input: { kind?: MemoryKind; summary?: string; archived?: boolean }) {
  return productRequest<MemoryEntry>(`/api/memories/${encodeURIComponent(memoryId)}`, { method: 'PATCH', body: input })
}

export function deleteMemory(memoryId: string) {
  return productRequest<{ deleted: boolean }>(`/api/memories/${encodeURIComponent(memoryId)}`, { method: 'DELETE' })
}

type ProductRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

async function productRequest<T>(path: string, options: ProductRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'X-Lutealark-User-Id': getOrCreateDeviceId(),
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8'
  return requestJson<T>(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }, PRODUCT_TIMEOUT_MS)
}
