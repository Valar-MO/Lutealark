import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVE_SUBJECT_STORAGE_KEY,
  accountDataSubject,
  dataSubjectKey,
  getActiveDataSubject,
  isSameDataSubject,
  resetDataSubjectMemoryForTests,
  scopedStorageKey,
  type DataSubject,
} from './data-subject'

const device: DataSubject = { kind: 'device', userId: '11111111-1111-4111-8111-111111111111' }
const account = accountDataSubject('22222222-2222-4222-8222-222222222222')

class MemoryStorage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetDataSubjectMemoryForTests()
})

describe('data subject keys', () => {
  it('isolates the same cache and date between device and account subjects', () => {
    expect(scopedStorageKey('lutealark.plan.v2', device, '2026-08-11'))
      .not.toBe(scopedStorageKey('lutealark.plan.v2', account, '2026-08-11'))
    expect(dataSubjectKey(device)).toBe('device:11111111-1111-4111-8111-111111111111')
  })

  it('normalizes account UUIDs and compares both kind and id', () => {
    const upper = accountDataSubject('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')
    expect(upper.userId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(isSameDataSubject(device, { ...device })).toBe(true)
    expect(isSameDataSubject(device, { kind: 'account', userId: device.userId })).toBe(false)
  })

  it('observes an active-subject change written by another tab after the first read', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    storage.setItem(ACTIVE_SUBJECT_STORAGE_KEY, JSON.stringify(device))
    expect(getActiveDataSubject()).toEqual(device)

    storage.setItem(ACTIVE_SUBJECT_STORAGE_KEY, JSON.stringify(account))
    expect(getActiveDataSubject()).toEqual(account)
  })
})
