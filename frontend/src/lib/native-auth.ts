import { Capacitor } from '@capacitor/core'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'

const ACCESS_TOKEN_KEY = 'lutealark.access-token.v1'

export class NativeAuthStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NativeAuthStorageError'
  }
}

export function isNativeRuntime() {
  return Capacitor.isNativePlatform()
}

let accessToken: string | null = null
let accessTokenLoaded = false
let accessTokenLoad: Promise<string | null> | null = null

export async function getNativeAccessToken(): Promise<string | null> {
  if (!isNativeRuntime()) return null
  if (accessTokenLoaded) return accessToken
  if (!accessTokenLoad) {
    accessTokenLoad = SecureStorage.get(ACCESS_TOKEN_KEY, false)
      .then((value) => {
        accessToken = typeof value === 'string' ? value : null
        accessTokenLoaded = true
        return accessToken
      })
      .catch(() => {
        // A corrupt/unavailable token must never prevent the app from showing
        // its login state. The next successful auth request can replace it.
        accessToken = null
        accessTokenLoaded = true
        return null
      })
      .finally(() => {
        accessTokenLoad = null
      })
  }
  return accessTokenLoad
}

export async function setNativeAccessToken(token: string | null | undefined) {
  if (!isNativeRuntime()) return
  const nextToken = token || null
  if (nextToken) {
    try {
      await SecureStorage.set(ACCESS_TOKEN_KEY, nextToken)
    } catch (cause) {
      throw new NativeAuthStorageError(
        '账号已登录，但无法安全保存登录状态。请检查设备安全设置后重试。',
        { cause },
      )
    }
    accessToken = nextToken
    accessTokenLoaded = true
    return
  }

  // Clear memory first so a failed keystore removal cannot keep authorizing
  // requests in the current process.
  accessToken = null
  accessTokenLoaded = true
  try {
    await SecureStorage.remove(ACCESS_TOKEN_KEY)
  } catch (cause) {
    throw new NativeAuthStorageError(
      '账号操作已完成，但无法清理设备上的登录凭据。请重启应用后重试。',
      { cause },
    )
  }
}

export async function clearNativeAccessToken() {
  await setNativeAccessToken(null)
}

export function resetNativeAuthForTests() {
  accessToken = null
  accessTokenLoaded = false
  accessTokenLoad = null
}
