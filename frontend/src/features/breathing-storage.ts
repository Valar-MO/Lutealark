import { getActiveDataSubject, scopedStorageKey, type DataSubject } from '../lib/data-subject'

const LEGACY_STORAGE_KEY = 'lutealark.breathing-records.v1'
const STORAGE_KEY = 'lutealark.breathing-records.v2'
const MAX_RECORDS = 30

export type BreathingRating = 1 | 2 | 3 | 4 | 5

export type BreathingRecord = {
  id: string
  modeId: string
  modeName: string
  completedAt: string
  durationSeconds: number
  rating: BreathingRating | null
}

export function createBreathingRecord(
  mode: { id: string; name: string; durationSeconds: number },
  now = new Date(),
): BreathingRecord {
  return {
    id: createRecordId(),
    modeId: mode.id,
    modeName: mode.name,
    completedAt: now.toISOString(),
    durationSeconds: mode.durationSeconds,
    rating: null,
  }
}

export function loadBreathingRecords(subject: DataSubject = getActiveDataSubject()): BreathingRecord[] {
  const storage = getLocalStorage()
  if (!storage) return []

  try {
    const key = scopedStorageKey(STORAGE_KEY, subject)
    const scopedValue = storage.getItem(key)
    const legacyValue = subject.kind === 'device' && !scopedValue
      ? storage.getItem(LEGACY_STORAGE_KEY)
      : null
    const value = scopedValue ?? legacyValue
    if (!value) return []
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []

    const seenLegacyIds = new Set<string>()
    const normalized = parsed
      .filter(isBreathingRecord)
      .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
      .filter((record) => {
        if (seenLegacyIds.has(record.id)) return false
        seenLegacyIds.add(record.id)
        return true
      })
      .map((record) => isUuid(record.id) ? record : { ...record, id: createRecordId() })
      .slice(0, MAX_RECORDS)
    persistBreathingRecords(normalized, subject)
    if (legacyValue) storage.removeItem(LEGACY_STORAGE_KEY)
    return normalized
  } catch {
    return []
  }
}

export function addBreathingRecord(
  records: readonly BreathingRecord[],
  record: BreathingRecord,
  subject: DataSubject = getActiveDataSubject(),
): BreathingRecord[] {
  const next = [record, ...records.filter((item) => item.id !== record.id)]
    .slice(0, MAX_RECORDS)
  persistBreathingRecords(next, subject)
  return next
}

export function updateBreathingRecordRating(
  records: readonly BreathingRecord[],
  recordId: string,
  rating: BreathingRating,
  subject: DataSubject = getActiveDataSubject(),
): BreathingRecord[] {
  const next = records
    .map((record) => record.id === recordId ? { ...record, rating } : record)
    .slice(0, MAX_RECORDS)
  persistBreathingRecords(next, subject)
  return next
}

export function replaceBreathingRecords(
  records: readonly BreathingRecord[],
  subject: DataSubject = getActiveDataSubject(),
): BreathingRecord[] {
  const seen = new Set<string>()
  const next = [...records]
    .filter(isBreathingRecord)
    .filter((record) => isUuid(record.id))
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
    .filter((record) => {
      if (seen.has(record.id)) return false
      seen.add(record.id)
      return true
    })
    .slice(0, MAX_RECORDS)
  persistBreathingRecords(next, subject)
  return next
}

export function removeBreathingRecord(
  records: readonly BreathingRecord[],
  recordId: string,
  subject: DataSubject = getActiveDataSubject(),
): BreathingRecord[] {
  const next = records.filter((record) => record.id !== recordId).slice(0, MAX_RECORDS)
  persistBreathingRecords(next, subject)
  return next
}

export function clearBreathingRecordsCache(subject: DataSubject = getActiveDataSubject()) {
  try { getLocalStorage()?.removeItem(scopedStorageKey(STORAGE_KEY, subject)) } catch { /* cleared in memory by caller */ }
}

function persistBreathingRecords(records: readonly BreathingRecord[], subject: DataSubject) {
  const storage = getLocalStorage()
  if (!storage) return

  try {
    storage.setItem(scopedStorageKey(STORAGE_KEY, subject), JSON.stringify(records.slice(0, MAX_RECORDS)))
  } catch {
    // Storage can be unavailable or full. Keep the in-memory UI usable.
  }
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isBreathingRecord(value: unknown): value is BreathingRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<BreathingRecord>
  return typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.modeId === 'string'
    && record.modeId.length > 0
    && typeof record.modeName === 'string'
    && record.modeName.length > 0
    && typeof record.completedAt === 'string'
    && Number.isFinite(Date.parse(record.completedAt))
    && Number.isInteger(record.durationSeconds)
    && Number(record.durationSeconds) > 0
    && Number(record.durationSeconds) <= 86_400
    && (record.rating === null || isBreathingRating(record.rating))
}

function isBreathingRating(value: unknown): value is BreathingRating {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5
}

function createRecordId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
