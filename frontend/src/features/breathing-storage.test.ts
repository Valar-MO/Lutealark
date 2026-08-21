import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataSubject } from '../lib/data-subject'
import {
  addBreathingRecord,
  createBreathingRecord,
  loadBreathingRecords,
  removeBreathingRecord,
  replaceBreathingRecords,
  updateBreathingRecordRating,
  type BreathingRecord,
} from './breathing-storage'

const device: DataSubject = { kind: 'device', userId: '11111111-1111-4111-8111-111111111111' }
const account: DataSubject = { kind: 'account', userId: '22222222-2222-4222-8222-222222222222' }

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

function record(index: number, overrides: Partial<BreathingRecord> = {}): BreathingRecord {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    modeId: 'box',
    modeName: '方块呼吸',
    completedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
    durationSeconds: 120,
    rating: null,
    ...overrides,
  }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('window', { localStorage: storage })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('breathing record storage', () => {
  it('creates a stable record shape at the supplied completion time', () => {
    const completedAt = new Date('2026-08-19T01:02:03.000Z')
    const created = createBreathingRecord({
      id: 'resonance',
      name: '共振呼吸',
      durationSeconds: 300,
    }, completedAt)

    expect(created).toMatchObject({
      modeId: 'resonance',
      modeName: '共振呼吸',
      completedAt: completedAt.toISOString(),
      durationSeconds: 300,
      rating: null,
    })
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('migrates the device legacy cache, keeps the newest duplicate and removes malformed rows', () => {
    const duplicateId = record(1).id
    storage.setItem('lutealark.breathing-records.v1', JSON.stringify([
      record(1, { completedAt: '2026-08-01T00:00:00.000Z' }),
      record(2, { id: duplicateId, completedAt: '2026-08-03T00:00:00.000Z', rating: 4 }),
      record(3, { completedAt: 'not-a-date' }),
      record(4, { id: 'legacy-id', completedAt: '2026-08-02T00:00:00.000Z' }),
    ]))

    const loaded = loadBreathingRecords(device)

    expect(loaded).toHaveLength(2)
    expect(loaded[0]).toMatchObject({ id: duplicateId, rating: 4 })
    expect(loaded[1].id).not.toBe('legacy-id')
    expect(storage.getItem('lutealark.breathing-records.v1')).toBeNull()
    expect(storage.getItem('lutealark.breathing-records.v2.device.11111111-1111-4111-8111-111111111111')).not.toBeNull()
  })

  it('isolates account and device caches while sorting, deduplicating and capping history', () => {
    const accountRecords = Array.from({ length: 31 }, (_, index) => record(index + 1))
    const accountResult = replaceBreathingRecords([
      ...accountRecords,
      { ...accountRecords[30], rating: 5 },
    ], account)
    addBreathingRecord([], record(99), device)

    expect(accountResult).toHaveLength(30)
    expect(accountResult[0].id).toBe(record(31).id)
    expect(loadBreathingRecords(account)).toEqual(accountResult)
    expect(loadBreathingRecords(device)).toEqual([record(99)])
  })

  it('updates ratings and removes only the selected record', () => {
    const initial = replaceBreathingRecords([record(1), record(2)], account)
    const rated = updateBreathingRecordRating(initial, record(1).id, 5, account)
    const remaining = removeBreathingRecord(rated, record(2).id, account)

    expect(rated.find((item) => item.id === record(1).id)?.rating).toBe(5)
    expect(remaining).toEqual([{ ...record(1), rating: 5 }])
    expect(loadBreathingRecords(account)).toEqual(remaining)
  })
})
