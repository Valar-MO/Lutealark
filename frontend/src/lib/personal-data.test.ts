import { describe, expect, it } from 'vitest'
import {
  reconcilePersonalDataCollections,
  type PendingPersonalData,
  type PersonalDataSnapshot,
} from './personal-data'

const emptyPending: PendingPersonalData = {
  cycle: false,
  checkinDates: [],
  breathingRecordIds: [],
  deletedCheckinDates: [],
  deletedBreathingRecordIds: [],
}

const checkin = {
  date: '2026-08-11',
  energy: 3 as const,
  mood: 'calm' as const,
  bodyState: [],
  shareWithChat: true,
}

const breathing = {
  id: '11111111-1111-4111-8111-111111111111',
  modeId: 'box',
  modeName: '方块呼吸',
  completedAt: '2026-08-11T02:00:00.000Z',
  durationSeconds: 120,
  rating: null,
}

function snapshot(overrides: Partial<PersonalDataSnapshot> = {}): PersonalDataSnapshot {
  return { cycleSettings: null, dailyCheckins: [], breathingRecords: [], ...overrides }
}

describe('personal-data reconciliation', () => {
  it('does not resurrect clean local rows when the remote collection is empty', () => {
    const result = reconcilePersonalDataCollections(
      snapshot({ dailyCheckins: [checkin], breathingRecords: [breathing] }),
      snapshot(),
      emptyPending,
    )
    expect(result.dailyCheckins).toEqual([])
    expect(result.breathingRecords).toEqual([])
    expect(result.checkinsToUpsert).toEqual([])
    expect(result.breathingRecordsToUpsert).toEqual([])
  })

  it('uploads only explicitly dirty local entities', () => {
    const result = reconcilePersonalDataCollections(
      snapshot({ dailyCheckins: [checkin], breathingRecords: [breathing] }),
      snapshot(),
      { ...emptyPending, checkinDates: [checkin.date], breathingRecordIds: [breathing.id] },
    )
    expect(result.checkinsToUpsert).toEqual([checkin])
    expect(result.breathingRecordsToUpsert).toEqual([breathing])
    expect(result.dailyCheckins).toEqual([checkin])
    expect(result.breathingRecords).toEqual([breathing])
  })

  it('keeps delete tombstones authoritative over stale remote rows', () => {
    const result = reconcilePersonalDataCollections(
      snapshot(),
      snapshot({ dailyCheckins: [checkin], breathingRecords: [breathing] }),
      {
        ...emptyPending,
        deletedCheckinDates: [checkin.date],
        deletedBreathingRecordIds: [breathing.id],
      },
    )
    expect(result.dailyCheckins).toEqual([])
    expect(result.breathingRecords).toEqual([])
    expect(result.checkinDatesToDelete).toEqual([checkin.date])
    expect(result.breathingRecordIdsToDelete).toEqual([breathing.id])
  })
})
