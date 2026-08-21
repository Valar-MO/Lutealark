const DEVICE_ID_STORAGE_KEY = 'lutealark.device-id.v1'
const ACTIVE_SUBJECT_STORAGE_KEY = 'lutealark.active-data-subject.v1'

export type DataSubject = {
  kind: 'device' | 'account'
  userId: string
}

let inMemoryDeviceId = ''
let inMemorySubject: DataSubject | null = null

export function getOrCreateDeviceId(): string {
  if (inMemoryDeviceId) return inMemoryDeviceId
  const storage = getLocalStorage()
  try {
    const stored = storage?.getItem(DEVICE_ID_STORAGE_KEY)
    if (stored && isUuid(stored)) {
      inMemoryDeviceId = stored
      return stored
    }
  } catch {
    // Continue with an in-memory identity when storage is unavailable.
  }

  inMemoryDeviceId = createUuid()
  try { storage?.setItem(DEVICE_ID_STORAGE_KEY, inMemoryDeviceId) } catch { /* keep in memory */ }
  return inMemoryDeviceId
}

export function getActiveDataSubject(): DataSubject {
  if (inMemorySubject) return { ...inMemorySubject }
  const storage = getLocalStorage()
  try {
    const value = storage?.getItem(ACTIVE_SUBJECT_STORAGE_KEY)
    if (value) {
      const parsed = JSON.parse(value) as unknown
      if (isDataSubject(parsed)) {
        inMemorySubject = parsed
        return { ...parsed }
      }
    }
  } catch {
    // Fall through to this browser's anonymous subject.
  }
  inMemorySubject = deviceDataSubject()
  return { ...inMemorySubject }
}

export function setActiveDataSubject(subject: DataSubject): DataSubject {
  const normalized = normalizeDataSubject(subject)
  inMemorySubject = normalized
  try { getLocalStorage()?.setItem(ACTIVE_SUBJECT_STORAGE_KEY, JSON.stringify(normalized)) } catch { /* keep in memory */ }
  return { ...normalized }
}

export function deviceDataSubject(): DataSubject {
  return { kind: 'device', userId: getOrCreateDeviceId() }
}

export function accountDataSubject(userId: string): DataSubject {
  return normalizeDataSubject({ kind: 'account', userId })
}

export function dataSubjectKey(subject: DataSubject): string {
  const normalized = normalizeDataSubject(subject)
  return `${normalized.kind}:${normalized.userId}`
}

export function scopedStorageKey(baseKey: string, subject: DataSubject, suffix?: string): string {
  const subjectToken = dataSubjectKey(subject).replace(':', '.')
  return `${baseKey}.${subjectToken}${suffix ? `.${suffix}` : ''}`
}

export function isSameDataSubject(left: DataSubject, right: DataSubject): boolean {
  return left.kind === right.kind && left.userId === right.userId
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function normalizeDataSubject(subject: DataSubject): DataSubject {
  if ((subject.kind !== 'device' && subject.kind !== 'account') || !isUuid(subject.userId)) {
    throw new Error('Invalid data subject')
  }
  return { kind: subject.kind, userId: subject.userId.toLowerCase() }
}

function isDataSubject(value: unknown): value is DataSubject {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DataSubject>
  return (candidate.kind === 'device' || candidate.kind === 'account')
    && typeof candidate.userId === 'string'
    && isUuid(candidate.userId)
}

function createUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

export function resetDataSubjectMemoryForTests() {
  inMemoryDeviceId = ''
  inMemorySubject = null
}
