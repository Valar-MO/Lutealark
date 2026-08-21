import { describe, expect, it } from 'vitest'
import { accountExportFilename, deleteAccountRequestBody, normalizeAuthEmail } from './auth-api'

describe('account data export helpers', () => {
  it('uses the server export date in a filesystem-safe JSON filename', () => {
    expect(accountExportFilename('2026-08-11T09:30:00.000Z'))
      .toBe('lutealark-account-data-2026-08-11.json')
  })

  it('normalizes account emails before identity-sensitive requests', () => {
    expect(normalizeAuthEmail('  User.Name@Example.COM  ')).toBe('user.name@example.com')
    expect(deleteAccountRequestBody('  User.Name@Example.COM  ', 'secret'))
      .toEqual({ email: 'user.name@example.com', password: 'secret' })
  })
})
