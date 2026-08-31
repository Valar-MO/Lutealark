import type { ActivityType } from '@lutealark/contracts'
import {
  dataSubjectKey,
  getActiveDataSubject,
  isUuid,
  scopedStorageKey,
  type DataSubject,
} from './data-subject'
import {
  createToolId,
  isFocusDurationMinutes,
  normalizeGentlePlan,
  type FocusDurationMinutes,
  type GentlePlanItem,
} from '../features/gentle-tools-logic'

export const PLAN_STORAGE_KEY = 'lutealark.gentle-plan.v1'
export const TOOL_ENERGY_STORAGE_KEY = 'lutealark.tool-energy.v1'
export const FOCUS_DURATION_STORAGE_KEY = 'lutealark.focus-duration.v1'
const SCOPED_PLAN_STORAGE_KEY = 'lutealark.gentle-plan.v2'
const SCOPED_TOOL_ENERGY_STORAGE_KEY = 'lutealark.tool-energy.v2'
const SCOPED_FOCUS_DURATION_STORAGE_KEY = 'lutealark.focus-duration.v2'
const ACTIVITY_OUTBOX_STORAGE_KEY = 'lutealark.activity-outbox.v1'

export type LocalDailyPlanState = {
  version: 2
  subjectKey: string
  date: string
  items: GentlePlanItem[]
  dirty: boolean
  tombstone: boolean
  updatedAt: string
}

export type PlanReconciliation = {
  items: GentlePlanItem[]
  shouldSync: boolean
  shouldDelete: boolean
}

export type QueuedActivity = {
  id: string
  type: ActivityType
  completedAt: string
  durationSeconds?: number | null
  note?: string | null
  metadata?: Record<string, unknown>
}

export type ActivityOutboxEntry = {
  id: string
  activity: QueuedActivity
  createdAt: string
  attempts: number
}

export function loadDailyPlanCache(
  subject: DataSubject,
  date: string,
): LocalDailyPlanState | null {
  const storage = getLocalStorage()
  if (!storage) return null
  const key = planStorageKey(subject, date)
  try {
    const value = storage.getItem(key)
    if (value) {
      const parsed = parseDailyPlanState(JSON.parse(value), subject, date)
      if (parsed) storage.setItem(key, JSON.stringify(parsed))
      return parsed
    }

    // The unscoped v1 value belongs only to this physical anonymous device.
    // It is migrated as a clean cache, so a remote empty plan stays authoritative.
    if (subject.kind === 'device') {
      const legacy = parseLegacyPlan(storage.getItem(PLAN_STORAGE_KEY))
      if (legacy) {
        const migrated = createPlanState(subject, date, legacy, false, false)
        storage.setItem(key, JSON.stringify(migrated))
        storage.removeItem(PLAN_STORAGE_KEY)
        return migrated
      }
    }
  } catch {
    return null
  }
  return null
}

export function saveDailyPlanMutation(
  subject: DataSubject,
  date: string,
  items: readonly GentlePlanItem[],
): LocalDailyPlanState {
  const normalized = normalizeGentlePlan(items)
  const state = createPlanState(subject, date, normalized, true, normalized.length === 0)
  persistPlanState(subject, date, state)
  return state
}

export function saveDailyPlanRemote(
  subject: DataSubject,
  date: string,
  items: readonly GentlePlanItem[],
): LocalDailyPlanState {
  const state = createPlanState(subject, date, normalizeGentlePlan(items), false, false)
  persistPlanState(subject, date, state)
  return state
}

export function markDailyPlanSynced(subject: DataSubject, date: string): LocalDailyPlanState | null {
  const current = loadDailyPlanCache(subject, date)
  if (!current) return null
  const next = createPlanState(subject, date, current.items, false, false)
  persistPlanState(subject, date, next)
  return next
}

export function reconcileDailyPlanCache(
  local: LocalDailyPlanState | null,
  remoteItems: readonly GentlePlanItem[] | null,
): PlanReconciliation {
  if (local?.dirty) {
    return {
      items: local.tombstone ? [] : normalizePlanItems(local.items),
      shouldSync: true,
      shouldDelete: local.tombstone,
    }
  }
  return {
    items: normalizePlanItems(remoteItems ?? []),
    shouldSync: false,
    shouldDelete: false,
  }
}

export function loadToolEnergy(subject: DataSubject, date: string, fallback: number) {
  try {
    const parsed = JSON.parse(getLocalStorage()?.getItem(scopedStorageKey(SCOPED_TOOL_ENERGY_STORAGE_KEY, subject, date)) ?? 'null') as { energy?: unknown } | null
    const stored = parsed?.energy
    if (typeof stored === 'number' && stored >= 1 && stored <= 5) return stored
  } catch {
    // Fall through to today's recommendation.
  }
  return Math.max(1, Math.min(5, Math.round(fallback)))
}

export function persistToolEnergy(subject: DataSubject, date: string, energy: number) {
  try {
    getLocalStorage()?.setItem(
      scopedStorageKey(SCOPED_TOOL_ENERGY_STORAGE_KEY, subject, date),
      JSON.stringify({ energy: Math.max(1, Math.min(5, Math.round(energy))) }),
    )
  } catch { /* keep in memory */ }
}

export function loadFocusDuration(subject: DataSubject, date: string): FocusDurationMinutes | null {
  try {
    const parsed = JSON.parse(getLocalStorage()?.getItem(scopedStorageKey(SCOPED_FOCUS_DURATION_STORAGE_KEY, subject, date)) ?? 'null') as { minutes?: unknown } | null
    const value = parsed?.minutes
    return isFocusDurationMinutes(value) ? value : null
  } catch {
    return null
  }
}

export function persistFocusDuration(subject: DataSubject, date: string, minutes: FocusDurationMinutes) {
  try {
    getLocalStorage()?.setItem(
      scopedStorageKey(SCOPED_FOCUS_DURATION_STORAGE_KEY, subject, date),
      JSON.stringify({ minutes }),
    )
  } catch { /* keep in memory */ }
}

export function loadActivityOutbox(subject: DataSubject): ActivityOutboxEntry[] {
  try {
    return normalizeActivityOutbox(JSON.parse(
      getLocalStorage()?.getItem(scopedStorageKey(ACTIVITY_OUTBOX_STORAGE_KEY, subject)) ?? 'null',
    ))
  } catch {
    return []
  }
}

export function queueActivity(subject: DataSubject, activity: QueuedActivity): ActivityOutboxEntry[] {
  const next = enqueueActivityEntry(loadActivityOutbox(subject), {
    id: activity.id,
    activity,
    createdAt: new Date().toISOString(),
    attempts: 0,
  })
  persistActivityOutbox(subject, next)
  return next
}

export async function flushActivityOutbox(
  subject: DataSubject,
  send: (activity: QueuedActivity) => Promise<unknown>,
): Promise<{ sent: number; remaining: number }> {
  const initial = loadActivityOutbox(subject)
  let sent = 0
  for (const entry of initial) {
    try {
      await send(entry.activity)
      persistActivityOutbox(subject, removeActivityEntry(loadActivityOutbox(subject), entry.id))
      sent += 1
    } catch {
      const current = loadActivityOutbox(subject)
      persistActivityOutbox(subject, current.map((candidate) => (
        candidate.id === entry.id ? { ...candidate, attempts: candidate.attempts + 1 } : candidate
      )))
    }
  }
  return { sent, remaining: loadActivityOutbox(subject).length }
}

export function normalizeActivityOutbox(value: unknown): ActivityOutboxEntry[] {
  if (!Array.isArray(value)) return []
  const entries: ActivityOutboxEntry[] = []
  for (const candidate of value) {
    if (!isActivityOutboxEntry(candidate)) continue
    const normalized = {
      ...candidate,
      attempts: Math.max(0, Math.floor(candidate.attempts)),
    }
    const existingIndex = entries.findIndex((entry) => entry.id === normalized.id)
    if (existingIndex >= 0) entries[existingIndex] = normalized
    else entries.push(normalized)
  }
  return entries.slice(-100)
}

export function enqueueActivityEntry(
  entries: readonly ActivityOutboxEntry[],
  entry: ActivityOutboxEntry,
): ActivityOutboxEntry[] {
  return normalizeActivityOutbox([...entries.filter((candidate) => candidate.id !== entry.id), entry])
}

export function removeActivityEntry(
  entries: readonly ActivityOutboxEntry[],
  id: string,
): ActivityOutboxEntry[] {
  return entries.filter((entry) => entry.id !== id)
}

export function transferPendingProductData(
  from: DataSubject,
  to: DataSubject,
  date: string,
): boolean {
  if (dataSubjectKey(from) === dataSubjectKey(to)) return true
  const sourcePlan = loadDailyPlanCache(from, date)
  const targetPlan = loadDailyPlanCache(to, date)
  const sourcePlanWins = sourcePlan?.dirty === true
    && (targetPlan?.dirty !== true || Date.parse(sourcePlan.updatedAt) > Date.parse(targetPlan.updatedAt))
  if (sourcePlanWins && sourcePlan) {
    persistPlanState(to, date, createPlanState(
      to,
      date,
      sourcePlan.items,
      true,
      sourcePlan.tombstone,
      sourcePlan.updatedAt,
    ))
  }
  const mergedOutbox = normalizeActivityOutbox([
    ...loadActivityOutbox(to),
    ...loadActivityOutbox(from),
  ])
  persistActivityOutbox(to, mergedOutbox)
  const resolvedTargetPlan = loadDailyPlanCache(to, date)
  const copiedPlan = !sourcePlan?.dirty
    || (resolvedTargetPlan?.dirty === true
      && (sourcePlanWins
        ? resolvedTargetPlan.updatedAt === sourcePlan.updatedAt
        : Date.parse(resolvedTargetPlan.updatedAt) >= Date.parse(sourcePlan.updatedAt)))
  const targetOutboxIds = new Set(loadActivityOutbox(to).map((entry) => entry.id))
  const copiedOutbox = loadActivityOutbox(from).every((entry) => targetOutboxIds.has(entry.id))
  return copiedPlan && copiedOutbox
}

export function clearLocalProductFeatureCache(subject: DataSubject = getActiveDataSubject()) {
  const storage = getLocalStorage()
  if (!storage) return
  const subjectMarker = dataSubjectKey(subject).replace(':', '.')
  const scopedBases = [
    SCOPED_PLAN_STORAGE_KEY,
    SCOPED_TOOL_ENERGY_STORAGE_KEY,
    SCOPED_FOCUS_DURATION_STORAGE_KEY,
    ACTIVITY_OUTBOX_STORAGE_KEY,
  ]
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => typeof key === 'string')
    for (const key of keys) {
      if (scopedBases.some((base) => key.startsWith(`${base}.${subjectMarker}`))) storage.removeItem(key)
    }
    if (subject.kind === 'device') {
      storage.removeItem(PLAN_STORAGE_KEY)
      storage.removeItem(TOOL_ENERGY_STORAGE_KEY)
      storage.removeItem(FOCUS_DURATION_STORAGE_KEY)
    }
  } catch {
    // The page starts with an empty in-memory cache when it is next mounted.
  }
}

function parseDailyPlanState(value: unknown, subject: DataSubject, date: string): LocalDailyPlanState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<LocalDailyPlanState>
  if (candidate.version !== 2
    || candidate.subjectKey !== dataSubjectKey(subject)
    || candidate.date !== date
    || !Array.isArray(candidate.items)
    || typeof candidate.dirty !== 'boolean'
    || typeof candidate.tombstone !== 'boolean') return null
  return createPlanState(
    subject,
    date,
    candidate.items as GentlePlanItem[],
    candidate.dirty,
    candidate.tombstone,
    typeof candidate.updatedAt === 'string' ? candidate.updatedAt : undefined,
  )
}

function parseLegacyPlan(value: string | null): GentlePlanItem[] | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? normalizePlanItems(parsed as GentlePlanItem[]) : null
  } catch {
    return null
  }
}

function createPlanState(
  subject: DataSubject,
  date: string,
  items: readonly GentlePlanItem[],
  dirty: boolean,
  tombstone: boolean,
  updatedAt = new Date().toISOString(),
): LocalDailyPlanState {
  return {
    version: 2,
    subjectKey: dataSubjectKey(subject),
    date,
    items: normalizePlanItems(items),
    dirty,
    tombstone: dirty && tombstone,
    updatedAt,
  }
}

function planStorageKey(subject: DataSubject, date: string) {
  return scopedStorageKey(SCOPED_PLAN_STORAGE_KEY, subject, date)
}

function normalizePlanItems(items: readonly GentlePlanItem[]): GentlePlanItem[] {
  return normalizeGentlePlan(items).map((item) => ({
    ...item,
    id: isUuid(item.id) ? item.id : createToolId(),
  }))
}

function persistPlanState(subject: DataSubject, date: string, state: LocalDailyPlanState) {
  try { getLocalStorage()?.setItem(planStorageKey(subject, date), JSON.stringify(state)) } catch { /* keep in memory */ }
}

function persistActivityOutbox(subject: DataSubject, entries: readonly ActivityOutboxEntry[]) {
  try {
    getLocalStorage()?.setItem(
      scopedStorageKey(ACTIVITY_OUTBOX_STORAGE_KEY, subject),
      JSON.stringify(normalizeActivityOutbox(entries)),
    )
  } catch { /* caller still retains the current page state */ }
}

function isActivityOutboxEntry(value: unknown): value is ActivityOutboxEntry {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ActivityOutboxEntry>
  const activity = candidate.activity as Partial<QueuedActivity> | undefined
  return typeof candidate.id === 'string'
    && isUuid(candidate.id)
    && candidate.id === activity?.id
    && typeof candidate.createdAt === 'string'
    && Number.isFinite(Date.parse(candidate.createdAt))
    && typeof candidate.attempts === 'number'
    && Number.isFinite(candidate.attempts)
    && activity !== undefined
    && (activity.type === 'pomodoro' || activity.type === 'environment' || activity.type === 'micro_movement')
    && typeof activity.completedAt === 'string'
    && Number.isFinite(Date.parse(activity.completedAt))
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}
