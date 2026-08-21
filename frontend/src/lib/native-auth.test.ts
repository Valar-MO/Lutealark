import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nativeMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn<() => boolean>(),
  get: vi.fn<(key: string) => Promise<unknown>>(),
  set: vi.fn<(key: string, value: unknown) => Promise<void>>(),
  remove: vi.fn<(key: string) => Promise<boolean>>(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: nativeMocks.isNativePlatform },
}))

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    get: nativeMocks.get,
    set: nativeMocks.set,
    remove: nativeMocks.remove,
  },
}))

const DEVICE_ID = '11111111-1111-4111-8111-111111111111'
const ACCESS_TOKEN = 'a'.repeat(43)

beforeEach(() => {
  vi.clearAllMocks()
  nativeMocks.isNativePlatform.mockReturnValue(true)
  nativeMocks.get.mockResolvedValue(null)
  nativeMocks.set.mockResolvedValue(undefined)
  nativeMocks.remove.mockResolvedValue(true)
})

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('native request authentication', () => {
  it('adds the Capacitor marker and stored bearer token to every native request', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
    nativeMocks.get.mockResolvedValue(ACCESS_TOKEN)
    stubWindow()
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { requestJson } = await import('./api')

    await expect(requestJson<{ ok: true }>('/api/personal-data', {
      method: 'GET',
      headers: { 'X-Lutealark-User-Id': DEVICE_ID },
    }, 1_000)).resolves.toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(url).toBe('https://api.example.com/api/personal-data')
    expect(headers.get('X-Lutealark-Client')).toBe('capacitor')
    expect(headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(headers.get('X-Lutealark-User-Id')).toBe(DEVICE_ID)
    expect(init?.credentials).toBe('include')
  })

  it.each([
    ['', '缺少后端地址'],
    ['http://api.example.com', '必须是无路径'],
    ['https://user:secret@api.example.com', '必须是无路径'],
    ['https://api.example.com/v1', '必须是无路径'],
    ['https://api.example.com?tenant=test', '必须是无路径'],
    ['https://api.example.com#fragment', '必须是无路径'],
  ])('rejects an unsafe native API base URL: %s', async (baseUrl, message) => {
    vi.stubEnv('VITE_API_BASE_URL', baseUrl)
    const { validateNativeApiConfiguration } = await import('./api')
    expect(() => validateNativeApiConfiguration()).toThrow(message)
  })

  it('does not touch secure storage or native headers in a web runtime', async () => {
    nativeMocks.isNativePlatform.mockReturnValue(false)
    vi.stubEnv('VITE_API_BASE_URL', '')
    stubWindow()
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { requestJson } = await import('./api')
    const { setNativeAccessToken } = await import('./native-auth')

    await setNativeAccessToken(ACCESS_TOKEN)
    await requestJson('/api/test', { method: 'GET' }, 1_000)

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.has('X-Lutealark-Client')).toBe(false)
    expect(headers.has('Authorization')).toBe(false)
    expect(nativeMocks.get).not.toHaveBeenCalled()
    expect(nativeMocks.set).not.toHaveBeenCalled()
  })

  it('uses a deployment-neutral message for network failures', async () => {
    nativeMocks.isNativePlatform.mockReturnValue(false)
    vi.stubEnv('VITE_API_BASE_URL', '')
    stubWindow()
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network unavailable')
    }))
    const { requestJson } = await import('./api')

    await expect(requestJson('/api/test', { method: 'GET' }, 1_000))
      .rejects.toThrow('无法连接服务，请检查网络后重试。')
  })
})

describe('native auth token lifecycle', () => {
  it('persists login tokens and reports secure-storage failures accurately', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
    stubWindow()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(authSession())))
    const { loginAccount } = await import('./auth-api')

    await expect(loginAccount('person@example.com', 'password'))
      .resolves.toMatchObject({ accessToken: ACCESS_TOKEN })
    expect(nativeMocks.set).toHaveBeenCalledWith(
      'lutealark.access-token.v1',
      ACCESS_TOKEN,
    )

    vi.resetModules()
    nativeMocks.get.mockResolvedValue(null)
    nativeMocks.set.mockRejectedValueOnce(new Error('keystore unavailable'))
    const { loginAccount: loginWithStorageFailure } = await import('./auth-api')
    const { getNativeAccessToken } = await import('./native-auth')
    await expect(loginWithStorageFailure('person@example.com', 'password'))
      .rejects.toMatchObject({
        name: 'NativeAuthStorageError',
        message: expect.stringContaining('无法安全保存登录状态'),
      })
    await expect(getNativeAccessToken()).resolves.toBeNull()
  })

  it('rejects a native login response that omits the bearer token', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
    stubWindow()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      authenticated: true,
      user: { userId: DEVICE_ID, email: 'person@example.com' },
      expiresAt: '2030-01-01T00:00:00.000Z',
      dataMerge: 'no_device',
    })))
    const { loginAccount } = await import('./auth-api')

    await expect(loginAccount('person@example.com', 'password')).rejects.toMatchObject({
      name: 'NativeAuthStorageError',
      message: expect.stringContaining('未返回安全凭据'),
    })
    expect(nativeMocks.set).not.toHaveBeenCalled()
  })

  it('clears the token on logout and only after a successful account deletion', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
    nativeMocks.get.mockResolvedValue(ACCESS_TOKEN)
    stubWindow()
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/auth/logout') return jsonResponse({ authenticated: false })
      if (path === '/api/auth/account') return jsonResponse({ deleted: true })
      return jsonResponse({ error: 'NOT_FOUND', message: 'not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { logoutAccount } = await import('./auth-api')

    await logoutAccount()
    expect(nativeMocks.remove).toHaveBeenCalledTimes(1)

    vi.resetModules()
    nativeMocks.get.mockResolvedValue(ACCESS_TOKEN)
    nativeMocks.remove.mockClear()
    const { deleteAccount: deleteAfterReload } = await import('./auth-api')
    await deleteAfterReload('person@example.com', 'password')
    expect(nativeMocks.remove).toHaveBeenCalledTimes(1)

    vi.resetModules()
    nativeMocks.get.mockResolvedValue(ACCESS_TOKEN)
    nativeMocks.remove.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: 'INVALID_PASSWORD',
      message: '邮箱或密码错误，账号未删除',
    }, 401)))
    const { deleteAccount: failedDelete } = await import('./auth-api')
    await expect(failedDelete('person@example.com', 'wrong-password')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_PASSWORD',
    })
    expect(nativeMocks.remove).not.toHaveBeenCalled()
  })

  it('removes an expired bearer after /me returns none without touching an anonymous client', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
    nativeMocks.get.mockResolvedValue(ACCESS_TOKEN)
    stubWindow()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      authenticated: false,
      authType: 'none',
      user: null,
    })))
    const { getAuthStatus } = await import('./auth-api')

    await getAuthStatus()
    expect(nativeMocks.remove).toHaveBeenCalledTimes(1)

    vi.resetModules()
    nativeMocks.get.mockResolvedValue(null)
    nativeMocks.remove.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      authenticated: false,
      authType: 'anonymous',
      user: { userId: DEVICE_ID },
    })))
    const { getAuthStatus: getAnonymousStatus } = await import('./auth-api')
    await getAnonymousStatus()
    expect(nativeMocks.remove).not.toHaveBeenCalled()
  })
})

function authSession() {
  return {
    authenticated: true,
    user: { userId: DEVICE_ID, email: 'person@example.com' },
    expiresAt: '2030-01-01T00:00:00.000Z',
    dataMerge: 'no_device',
    accessToken: ACCESS_TOKEN,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubWindow() {
  vi.stubGlobal('window', {
    localStorage: memoryStorage(),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  })
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}
