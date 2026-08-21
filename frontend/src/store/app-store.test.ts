import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from './app-store'

const subjectA = 'device:11111111-1111-4111-8111-111111111111'
const subjectB = 'account:22222222-2222-4222-8222-222222222222'
const checkin = {
  date: '2026-08-11',
  energy: 3 as const,
  mood: 'calm' as const,
  bodyState: [],
  shareWithChat: true,
}

afterEach(() => {
  useAppStore.getState().switchPersonalDataSubject('', {
    cycleSettings: null,
    dailyCheckins: [],
    breathingRecords: [],
  })
})

describe('shared personal-data store', () => {
  it('retains shared data while the data subject stays the same', () => {
    const store = useAppStore.getState()
    store.switchPersonalDataSubject(subjectA, {
      cycleSettings: { lastPeriodDate: '2026-08-01', cycleLength: 28 },
      dailyCheckins: [checkin],
      breathingRecords: [],
    })
    useAppStore.getState().switchPersonalDataSubject(subjectA)
    expect(useAppStore.getState().dailyCheckins).toEqual([checkin])
  })

  it('clears one subject before switching to another and supports explicit reset', () => {
    useAppStore.getState().switchPersonalDataSubject(subjectA, {
      cycleSettings: { lastPeriodDate: '2026-08-01', cycleLength: 28 },
      dailyCheckins: [checkin],
      breathingRecords: [],
    })
    useAppStore.getState().switchPersonalDataSubject(subjectB)
    expect(useAppStore.getState().cycleSettings).toBeNull()
    expect(useAppStore.getState().dailyCheckins).toEqual([])

    useAppStore.getState().setDailyCheckins([checkin])
    useAppStore.getState().resetPersonalData()
    expect(useAppStore.getState().dailyCheckins).toEqual([])
    expect(useAppStore.getState().dataSubjectKey).toBe(subjectB)
  })
})
