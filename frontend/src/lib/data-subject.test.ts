import { describe, expect, it } from 'vitest'
import {
  accountDataSubject,
  dataSubjectKey,
  isSameDataSubject,
  scopedStorageKey,
  type DataSubject,
} from './data-subject'

const device: DataSubject = { kind: 'device', userId: '11111111-1111-4111-8111-111111111111' }
const account = accountDataSubject('22222222-2222-4222-8222-222222222222')

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
})
