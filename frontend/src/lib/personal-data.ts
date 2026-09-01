import type { BreathingRecord } from '../features/breathing-storage'
import { ApiRequestError, requestJson, type CycleEventRecord, type CycleEventSaveResult, type CycleSettings, type DailyCheckIn } from './api'
import {
  dataSubjectKey,
  getActiveDataSubject,
  getOrCreateDeviceId,
  scopedStorageKey,
  type DataSubject,
} from './data-subject'

const PENDING_SYNC_STORAGE_KEY = 'lutealark.personal-data-pending.v2'
const LEGACY_PENDING_SYNC_STORAGE_KEY = 'lutealark.personal-data-pending.v1'
const PERSONAL_DATA_TIMEOUT_MS = 10_000

export { getOrCreateDeviceId }

export type PersonalDataSnapshot = {
  cycleSettings: CycleSettings | null
  dailyCheckins: DailyCheckIn[]
  breathingRecords: BreathingRecord[]
}

export type PendingPersonalData = {
  cycle: boolean
  checkinDates: string[]
  breathingRecordIds: string[]
  deletedCheckinDates: string[]
  deletedBreathingRecordIds: string[]
}

export type PersonalDataReconciliation = PersonalDataSnapshot & {
  checkinsToUpsert: DailyCheckIn[]
  breathingRecordsToUpsert: BreathingRecord[]
  checkinDatesToDelete: string[]
  breathingRecordIdsToDelete: string[]
  cycleToUpsert: CycleSettings | null
}

const snapshotRequests = new Map<string, Promise<PersonalDataSnapshot>>()
const pendingBySubject = new Map<string, PendingPersonalData>()
const syncVersions = new Map<string, number>()
const mutationQueues = new Map<string, Promise<void>>()

export function fetchPersonalData(subject: DataSubject = getActiveDataSubject()): Promise<PersonalDataSnapshot> {
  const key = dataSubjectKey(subject)
  const existing = snapshotRequests.get(key)
  if (existing) return existing
  const request = personalDataRequest<PersonalDataSnapshot>('/api/personal-data', undefined, subject)
    .finally(() => { snapshotRequests.delete(key) })
  snapshotRequests.set(key, request)
  return request
}

export async function syncCycleSettings(
  settings: CycleSettings,
  subject: DataSubject = getActiveDataSubject(),
): Promise<CycleSettings> {
  const syncKey = scopedMutationKey(subject, 'cycle')
  const syncVersion = beginSync(syncKey)
  markPersonalDataPending({ cycle: true }, subject)
  const result = await runMutation(syncKey, () => (
    personalDataRequest<CycleSettings>('/api/personal-data/cycle', settings, subject)
  ))
  if (isLatestSync(syncKey, syncVersion)) {
    updatePending(subject, (pending) => ({ ...pending, cycle: false }))
  }
  return result
}

export async function recordCycleEvent(
  event: CycleEventRecord,
  subject: DataSubject = getActiveDataSubject(),
): Promise<CycleEventSaveResult> {
  const syncKey = scopedMutationKey(subject, `cycle-event:${event.date}`)
  return runMutation(syncKey, () => (
    personalDataRequest<CycleEventSaveResult>('/api/personal-data/cycle-event', event, subject)
  ))
}

export async function syncDailyCheckin(
  checkin: DailyCheckIn,
  subject: DataSubject = getActiveDataSubject(),
): Promise<DailyCheckIn> {
  const syncKey = scopedMutationKey(subject, `checkin:${checkin.date}`)
  const syncVersion = beginSync(syncKey)
  markPersonalDataPending({ checkinDates: [checkin.date] }, subject)
  const result = await runMutation(syncKey, () => (
    personalDataRequest<DailyCheckIn>('/api/personal-data/checkin', checkin, subject)
  ))
  if (isLatestSync(syncKey, syncVersion)) {
    updatePending(subject, (pending) => ({
      ...pending,
      checkinDates: pending.checkinDates.filter((date) => date !== checkin.date),
    }))
  }
  return result
}

export async function syncBreathingRecord(
  record: BreathingRecord,
  subject: DataSubject = getActiveDataSubject(),
): Promise<BreathingRecord> {
  const syncKey = scopedMutationKey(subject, `breathing:${record.id}`)
  const syncVersion = beginSync(syncKey)
  markPersonalDataPending({ breathingRecordIds: [record.id] }, subject)
  const result = await runMutation(syncKey, () => (
    personalDataRequest<BreathingRecord>('/api/personal-data/breathing', record, subject)
  ))
  if (isLatestSync(syncKey, syncVersion)) {
    updatePending(subject, (pending) => ({
      ...pending,
      breathingRecordIds: pending.breathingRecordIds.filter((id) => id !== record.id),
    }))
  }
  return result
}

export async function deleteDailyCheckin(
  date: string,
  subject: DataSubject = getActiveDataSubject(),
): Promise<void> {
  const syncKey = scopedMutationKey(subject, `checkin:${date}`)
  const syncVersion = beginSync(syncKey)
  markPersonalDataPending({ deletedCheckinDates: [date] }, subject)
  await runMutation(syncKey, () => (
    personalDataDelete(`/api/personal-data/checkin/${encodeURIComponent(date)}`, subject)
  ))
  if (isLatestSync(syncKey, syncVersion)) {
    updatePending(subject, (pending) => ({
      ...pending,
      deletedCheckinDates: pending.deletedCheckinDates.filter((value) => value !== date),
    }))
  }
}

export async function deleteBreathingRecord(
  recordId: string,
  subject: DataSubject = getActiveDataSubject(),
): Promise<void> {
  const syncKey = scopedMutationKey(subject, `breathing:${recordId}`)
  const syncVersion = beginSync(syncKey)
  markPersonalDataPending({ deletedBreathingRecordIds: [recordId] }, subject)
  await runMutation(syncKey, () => (
    personalDataDelete(`/api/personal-data/breathing/${encodeURIComponent(recordId)}`, subject)
  ))
  if (isLatestSync(syncKey, syncVersion)) {
    updatePending(subject, (pending) => ({
      ...pending,
      deletedBreathingRecordIds: pending.deletedBreathingRecordIds.filter((id) => id !== recordId),
    }))
  }
}

export function getPendingPersonalData(
  subject: DataSubject = getActiveDataSubject(),
): PendingPersonalData {
  return clonePending(getPending(subject))
}

export function hasPendingPersonalData(subject: DataSubject = getActiveDataSubject()): boolean {
  return hasAnyPending(getPending(subject))
}

/** Clears request memory for a subject while deliberately preserving its durable journal. */
export function resetPersonalDataSyncState(subject: DataSubject = getActiveDataSubject()) {
  const prefix = `${dataSubjectKey(subject)}:`
  snapshotRequests.delete(dataSubjectKey(subject))
  pendingBySubject.delete(dataSubjectKey(subject))
  for (const key of syncVersions.keys()) {
    if (key.startsWith(prefix)) syncVersions.delete(key)
  }
}

export function clearPersonalDataPending(subject: DataSubject) {
  const key = dataSubjectKey(subject)
  pendingBySubject.delete(key)
  try { window.localStorage.removeItem(pendingStorageKey(subject)) } catch { /* cleared in memory */ }
}

/** Copies a claimed device's durable mutation journal to its account partition. */
export function transferPendingPersonalData(from: DataSubject, to: DataSubject): boolean {
  if (dataSubjectKey(from) === dataSubjectKey(to)) return true
  const source = getPendingPersonalData(from)
  if (!hasAnyPending(source)) return true
  markPersonalDataPending(source, to)
  let target: PendingPersonalData
  try {
    const persisted = window.localStorage.getItem(pendingStorageKey(to))
    if (!persisted) return false
    target = normalizePending(JSON.parse(persisted))
  } catch {
    return false
  }
  return (!source.cycle || target.cycle)
    && source.checkinDates.every((value) => target.checkinDates.includes(value))
    && source.breathingRecordIds.every((value) => target.breathingRecordIds.includes(value))
    && source.deletedCheckinDates.every((value) => target.deletedCheckinDates.includes(value))
    && source.deletedBreathingRecordIds.every((value) => target.deletedBreathingRecordIds.includes(value))
}

export function markPersonalDataPending(
  values: Partial<PendingPersonalData>,
  subject: DataSubject = getActiveDataSubject(),
) {
  updatePending(subject, (pending) => {
    const checkinDates = unique([...pending.checkinDates, ...(values.checkinDates ?? [])])
    const breathingRecordIds = unique([...pending.breathingRecordIds, ...(values.breathingRecordIds ?? [])])
    const deletedCheckinDates = unique([
      ...pending.deletedCheckinDates,
      ...(values.deletedCheckinDates ?? []),
    ])
    const deletedBreathingRecordIds = unique([
      ...pending.deletedBreathingRecordIds,
      ...(values.deletedBreathingRecordIds ?? []),
    ])
    const requestedCheckinUpserts = new Set(values.checkinDates ?? [])
    const requestedBreathingUpserts = new Set(values.breathingRecordIds ?? [])
    const requestedCheckinDeletes = new Set(values.deletedCheckinDates ?? [])
    const requestedBreathingDeletes = new Set(values.deletedBreathingRecordIds ?? [])
    return {
      cycle: pending.cycle || values.cycle === true,
      checkinDates: checkinDates.filter((date) => !requestedCheckinDeletes.has(date)),
      breathingRecordIds: breathingRecordIds.filter((id) => !requestedBreathingDeletes.has(id)),
      deletedCheckinDates: deletedCheckinDates.filter((date) => !requestedCheckinUpserts.has(date)),
      deletedBreathingRecordIds: deletedBreathingRecordIds.filter((id) => !requestedBreathingUpserts.has(id)),
    }
  })
}

export function discardUnavailablePendingData(
  values: { hasCycleSettings: boolean; checkinDates: string[]; breathingRecordIds: string[] },
  subject: DataSubject = getActiveDataSubject(),
) {
  const availableCheckins = new Set(values.checkinDates)
  const availableBreathing = new Set(values.breathingRecordIds)
  updatePending(subject, (pending) => ({
    ...pending,
    cycle: pending.cycle && values.hasCycleSettings,
    checkinDates: pending.checkinDates.filter((date) => availableCheckins.has(date)),
    breathingRecordIds: pending.breathingRecordIds.filter((id) => availableBreathing.has(id)),
    // Delete tombstones intentionally survive while their local entity is absent.
  }))
}

/**
 * Remote state is authoritative except for explicit local mutations. In particular,
 * an empty remote collection clears clean cached rows instead of re-uploading them.
 */
export function reconcilePersonalDataCollections(
  local: PersonalDataSnapshot,
  remote: PersonalDataSnapshot,
  pending: PendingPersonalData,
): PersonalDataReconciliation {
  const deletedCheckins = new Set(pending.deletedCheckinDates)
  const dirtyCheckins = new Set(pending.checkinDates)
  const localCheckinsByDate = new Map(local.dailyCheckins.map((checkin) => [checkin.date, checkin]))
  const checkinsToUpsert = pending.checkinDates
    .map((date) => localCheckinsByDate.get(date))
    .filter((checkin): checkin is DailyCheckIn => checkin !== undefined)
    .filter((checkin) => !deletedCheckins.has(checkin.date))
  const dailyCheckins = uniqueBy(
    [
      ...checkinsToUpsert,
      ...remote.dailyCheckins.filter((checkin) => !dirtyCheckins.has(checkin.date) && !deletedCheckins.has(checkin.date)),
    ],
    (checkin) => checkin.date,
  ).sort((left, right) => right.date.localeCompare(left.date)).slice(0, 30)

  const deletedBreathing = new Set(pending.deletedBreathingRecordIds)
  const dirtyBreathing = new Set(pending.breathingRecordIds)
  const localBreathingById = new Map(local.breathingRecords.map((record) => [record.id, record]))
  const breathingRecordsToUpsert = pending.breathingRecordIds
    .map((id) => localBreathingById.get(id))
    .filter((record): record is BreathingRecord => record !== undefined)
    .filter((record) => !deletedBreathing.has(record.id))
  const breathingRecords = uniqueBy(
    [
      ...breathingRecordsToUpsert,
      ...remote.breathingRecords.filter((record) => !dirtyBreathing.has(record.id) && !deletedBreathing.has(record.id)),
    ],
    (record) => record.id,
  ).sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt)).slice(0, 30)

  const cycleToUpsert = pending.cycle ? local.cycleSettings : null
  return {
    cycleSettings: cycleToUpsert ?? remote.cycleSettings,
    dailyCheckins,
    breathingRecords,
    cycleToUpsert,
    checkinsToUpsert,
    breathingRecordsToUpsert,
    checkinDatesToDelete: [...pending.deletedCheckinDates],
    breathingRecordIdsToDelete: [...pending.deletedBreathingRecordIds],
  }
}

async function personalDataRequest<T>(
  path: string,
  body: unknown | undefined,
  subject: DataSubject,
): Promise<T> {
  assertSubjectCurrent(subject)
  const headers: Record<string, string> = { 'X-Lutealark-User-Id': getOrCreateDeviceId() }
  const init: RequestInit = body === undefined
    ? { method: 'GET', headers }
    : {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      }
  return requestJson<T>(path, init, PERSONAL_DATA_TIMEOUT_MS)
}

async function personalDataDelete(path: string, subject: DataSubject): Promise<void> {
  try {
    assertSubjectCurrent(subject)
    await requestJson<{ deleted: true }>(path, {
      method: 'DELETE',
      headers: { 'X-Lutealark-User-Id': getOrCreateDeviceId() },
    }, PERSONAL_DATA_TIMEOUT_MS)
  } catch (cause) {
    if (cause instanceof ApiRequestError && cause.status === 404) return
    throw cause
  }
}

function assertSubjectCurrent(subject: DataSubject) {
  if (dataSubjectKey(getActiveDataSubject()) !== dataSubjectKey(subject)) {
    throw new Error('数据主体已变更，已取消旧数据同步。')
  }
}

function getPending(subject: DataSubject): PendingPersonalData {
  const subjectKey = dataSubjectKey(subject)
  const cached = pendingBySubject.get(subjectKey)
  if (cached) return cached
  const empty = emptyPending()
  try {
    const storage = window.localStorage
    const key = pendingStorageKey(subject)
    const scopedValue = storage.getItem(key)
    const legacyValue = subject.kind === 'device' && !scopedValue
      ? storage.getItem(LEGACY_PENDING_SYNC_STORAGE_KEY)
      : null
    const parsed = JSON.parse(scopedValue ?? legacyValue ?? 'null') as unknown
    const normalized = normalizePending(parsed)
    pendingBySubject.set(subjectKey, normalized)
    if (legacyValue) {
      storage.setItem(key, JSON.stringify(normalized))
      storage.removeItem(LEGACY_PENDING_SYNC_STORAGE_KEY)
    }
    return normalized
  } catch {
    pendingBySubject.set(subjectKey, empty)
    return empty
  }
}

function updatePending(subject: DataSubject, update: (current: PendingPersonalData) => PendingPersonalData) {
  const key = dataSubjectKey(subject)
  const next = normalizePending(update(getPending(subject)))
  pendingBySubject.set(key, next)
  try { window.localStorage.setItem(pendingStorageKey(subject), JSON.stringify(next)) } catch { /* keep in memory */ }
}

function normalizePending(value: unknown): PendingPersonalData {
  if (!value || typeof value !== 'object') return emptyPending()
  const parsed = value as Partial<PendingPersonalData>
  return {
    cycle: parsed.cycle === true,
    checkinDates: stringArray(parsed.checkinDates),
    breathingRecordIds: stringArray(parsed.breathingRecordIds),
    deletedCheckinDates: stringArray(parsed.deletedCheckinDates),
    deletedBreathingRecordIds: stringArray(parsed.deletedBreathingRecordIds),
  }
}

function emptyPending(): PendingPersonalData {
  return {
    cycle: false,
    checkinDates: [],
    breathingRecordIds: [],
    deletedCheckinDates: [],
    deletedBreathingRecordIds: [],
  }
}

function hasAnyPending(pending: PendingPersonalData): boolean {
  return pending.cycle
    || pending.checkinDates.length > 0
    || pending.breathingRecordIds.length > 0
    || pending.deletedCheckinDates.length > 0
    || pending.deletedBreathingRecordIds.length > 0
}

function pendingStorageKey(subject: DataSubject) {
  return scopedStorageKey(PENDING_SYNC_STORAGE_KEY, subject)
}

function scopedMutationKey(subject: DataSubject, mutation: string) {
  return `${dataSubjectKey(subject)}:${mutation}`
}

function clonePending(pending: PendingPersonalData): PendingPersonalData {
  return {
    ...pending,
    checkinDates: [...pending.checkinDates],
    breathingRecordIds: [...pending.breathingRecordIds],
    deletedCheckinDates: [...pending.deletedCheckinDates],
    deletedBreathingRecordIds: [...pending.deletedBreathingRecordIds],
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? unique(value.filter((item): item is string => typeof item === 'string' && item.length > 0))
    : []
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function uniqueBy<T>(values: T[], keyFor: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = keyFor(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function beginSync(key: string): number {
  const version = (syncVersions.get(key) ?? 0) + 1
  syncVersions.set(key, version)
  return version
}

function isLatestSync(key: string, version: number): boolean {
  return syncVersions.get(key) === version
}

async function runMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(key) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  mutationQueues.set(key, tail)
  try {
    return await result
  } finally {
    if (mutationQueues.get(key) === tail) mutationQueues.delete(key)
  }
}
