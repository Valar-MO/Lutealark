import { describe, expect, it } from 'vitest'
import {
  enqueueActivityEntry,
  normalizeActivityOutbox,
  reconcileDailyPlanCache,
  removeActivityEntry,
  type ActivityOutboxEntry,
  type LocalDailyPlanState,
} from './product-local'

const item = { id: '11111111-1111-4111-8111-111111111111', text: '打开文档', completed: false }
const cleanLocal: LocalDailyPlanState = {
  version: 2,
  subjectKey: 'device:22222222-2222-4222-8222-222222222222',
  date: '2026-08-11',
  items: [item],
  dirty: false,
  tombstone: false,
  updatedAt: '2026-08-11T01:00:00.000Z',
}

const outboxEntry: ActivityOutboxEntry = {
  id: '33333333-3333-4333-8333-333333333333',
  activity: {
    id: '33333333-3333-4333-8333-333333333333',
    type: 'environment',
    completedAt: '2026-08-11T02:00:00.000Z',
  },
  createdAt: '2026-08-11T02:00:00.000Z',
  attempts: 0,
}

describe('daily plan offline reconciliation', () => {
  it('lets an explicit remote empty plan replace a clean legacy/local cache', () => {
    expect(reconcileDailyPlanCache(cleanLocal, null)).toEqual({
      items: [],
      shouldSync: false,
      shouldDelete: false,
    })
  })

  it('keeps a dirty empty plan as a deletion tombstone', () => {
    const dirtyDelete = { ...cleanLocal, items: [], dirty: true, tombstone: true }
    expect(reconcileDailyPlanCache(dirtyDelete, [item])).toEqual({
      items: [],
      shouldSync: true,
      shouldDelete: true,
    })
  })
})

describe('activity outbox', () => {
  it('uses the activity UUID as an idempotent key across retries', () => {
    const once = enqueueActivityEntry([], outboxEntry)
    const twice = enqueueActivityEntry(once, { ...outboxEntry, attempts: 1 })
    expect(twice).toHaveLength(1)
    expect(twice[0]?.attempts).toBe(1)
    expect(removeActivityEntry(twice, outboxEntry.id)).toEqual([])
  })

  it('drops malformed persisted entries', () => {
    expect(normalizeActivityOutbox([{ ...outboxEntry, id: 'not-a-uuid' }])).toEqual([])
  })
})
