import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountDataSubject, resetDataSubjectMemoryForTests, setActiveDataSubject } from './data-subject'
import { getDailyPlan, listConversations } from './product-api'

const DEVICE_ID = '11111111-1111-4111-8111-111111111111'
const ACCOUNT_A = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_B = '33333333-3333-4333-8333-333333333333'

afterEach(() => {
  resetDataSubjectMemoryForTests()
  vi.unstubAllGlobals()
})

describe('product API subject isolation', () => {
  it('rejects a response that finishes after the active subject changes', async () => {
    const storage = memoryStorage({ 'lutealark.device-id.v1': DEVICE_ID })
    vi.stubGlobal('window', {
      localStorage: storage,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    setActiveDataSubject(accountDataSubject(ACCOUNT_A))

    let resolveFetch!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })))

    const pending = listConversations()
    setActiveDataSubject(accountDataSubject(ACCOUNT_B))
    resolveFetch(jsonResponse([]))

    await expect(pending).rejects.toThrow('数据主体已变更')
  })

  it('does not reinterpret a cross-subject 404 as an empty daily plan', async () => {
    const storage = memoryStorage({ 'lutealark.device-id.v1': DEVICE_ID })
    vi.stubGlobal('window', {
      localStorage: storage,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    setActiveDataSubject(accountDataSubject(ACCOUNT_A))

    let resolveFetch!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })))

    const pending = getDailyPlan('2026-08-22')
    setActiveDataSubject(accountDataSubject(ACCOUNT_B))
    resolveFetch(jsonResponse({ message: 'not found' }, 404))

    await expect(pending).rejects.toThrow('数据主体已变更')
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function memoryStorage(initial: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}
