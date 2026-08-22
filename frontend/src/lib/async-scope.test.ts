import { describe, expect, it } from 'vitest'
import { createAsyncScope, hasCurrentAsyncOperation, isCurrentAsyncScope } from './async-scope'

describe('subject-scoped async operations', () => {
  it('rejects an old operation after the active subject changes', () => {
    const operation = createAsyncScope('account:a', 1)

    expect(isCurrentAsyncScope(operation, operation, 'account:b', 2)).toBe(false)
  })

  it('rejects a previous operation when a newer operation owns the same subject', () => {
    const previous = createAsyncScope('account:a', 1)
    const current = createAsyncScope('account:a', 1)

    expect(isCurrentAsyncScope(current, previous, 'account:a', 1)).toBe(false)
    expect(isCurrentAsyncScope(current, current, 'account:a', 1)).toBe(true)
  })

  it('rejects work from a previous login generation even when the account is the same', () => {
    const previousLogin = createAsyncScope('account:a', 1)

    expect(isCurrentAsyncScope(previousLogin, previousLogin, 'account:a', 2)).toBe(false)
  })

  it('blocks a duplicate operation before a React state update commits', () => {
    const active = createAsyncScope('account:a', 4)

    expect(hasCurrentAsyncOperation(active, 'account:a', 4)).toBe(true)
    expect(hasCurrentAsyncOperation(active, 'account:a', 5)).toBe(false)
    expect(hasCurrentAsyncOperation(null, 'account:a', 4)).toBe(false)
  })
})
