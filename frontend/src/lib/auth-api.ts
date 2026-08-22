import { requestJson } from './api'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import {
  clearNativeAccessToken,
  getNativeAccessToken,
  isNativeRuntime,
  NativeAuthStorageError,
  setNativeAccessToken,
} from './native-auth'
import { getOrCreateDeviceId } from './personal-data'
import type {
  AuthSessionResponse,
  AuthStatus as SharedAuthStatus,
} from '@lutealark/contracts'

const AUTH_TIMEOUT_MS = 10_000

export type AuthStatus = SharedAuthStatus
export type AuthSession = AuthSessionResponse
export type AccountExportDisposition = 'downloaded' | 'shared'

export type AccountDataExport = {
  format: 'lutealark-account-data'
  schemaVersion: 1
  exportedAt: string
  data: Record<string, unknown>
}

export function getAuthStatus() {
  return authRequest<AuthStatus>('/api/auth/me', { method: 'GET' }).then(async (status) => {
    if (
      isNativeRuntime()
      && !status.authenticated
      && status.authType === 'none'
      && await getNativeAccessToken()
    ) {
      await clearNativeAccessToken()
    }
    return status
  })
}

export function registerAccount(email: string, password: string) {
  return authRequest<AuthSession>('/api/auth/register', {
    method: 'POST',
    body: { email: normalizeAuthEmail(email), password, deviceUserId: getOrCreateDeviceId() },
  }).then(async (session) => {
    requireNativeAccessToken(session)
    await setNativeAccessToken(session.accessToken)
    return session
  })
}

export function loginAccount(email: string, password: string) {
  return authRequest<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: { email: normalizeAuthEmail(email), password, deviceUserId: getOrCreateDeviceId() },
  }).then(async (session) => {
    requireNativeAccessToken(session)
    await setNativeAccessToken(session.accessToken)
    return session
  })
}

export async function logoutAccount() {
  try {
    return await authRequest<{ authenticated: false }>('/api/auth/logout', { method: 'POST' })
  } finally {
    await clearNativeAccessToken()
  }
}

export function exportAccountData() {
  return authRequest<AccountDataExport>('/api/auth/export', { method: 'GET' })
}

export async function deleteAccount(email: string, password: string) {
  const result = await authRequest<{ deleted: true }>('/api/auth/account', {
    method: 'DELETE',
    body: deleteAccountRequestBody(email, password),
  })
  await clearNativeAccessToken()
  return result
}

export function deleteAccountRequestBody(email: string, password: string) {
  return { email: normalizeAuthEmail(email), password }
}

export function normalizeAuthEmail(email: string) {
  return email.trim().toLowerCase()
}

function requireNativeAccessToken(session: AuthSession) {
  if (isNativeRuntime() && !session.accessToken) {
    throw new NativeAuthStorageError('原生登录未返回安全凭据，请检查 API 与 CORS 配置后重试。')
  }
}

export function accountExportFilename(exportedAt: string) {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(exportedAt)?.[0]
    ?? new Date().toISOString().slice(0, 10)
  return `lutealark-account-data-${date}.json`
}

export function downloadAccountExport(value: AccountDataExport) {
  const blob = new Blob([serializeAccountExport(value)], {
    type: 'application/json;charset=utf-8',
  })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = accountExportFilename(value.exportedAt)
  anchor.hidden = true
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

export async function saveAccountExport(value: AccountDataExport): Promise<AccountExportDisposition> {
  if (!isNativeRuntime()) {
    downloadAccountExport(value)
    return 'downloaded'
  }

  const exportPath = `exports/${accountExportFilename(value.exportedAt)}`
  let exportWasWritten = false
  try {
    const shareSupport = await Share.canShare()
    if (!shareSupport.value) throw new Error('native sharing is unavailable')

    const result = await Filesystem.writeFile({
      path: exportPath,
      data: serializeAccountExport(value),
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    })
    exportWasWritten = true
    await Share.share({
      title: 'Lutealark 账号数据',
      files: [result.uri],
      dialogTitle: '导出 Lutealark 账号数据',
    })
    return 'shared'
  } catch (cause) {
    if (cause instanceof Error && /cancel(?:ed|led)?/i.test(cause.message)) {
      throw new Error('已取消账号数据导出。', { cause })
    }
    throw new Error('无法打开系统导出面板，请检查设备存储后重试。', { cause })
  } finally {
    if (exportWasWritten) {
      try {
        await Filesystem.deleteFile({ path: exportPath, directory: Directory.Cache })
      } catch {
        // Cache cleanup is best-effort and must not replace the share result.
      }
    }
  }
}

export function serializeAccountExport(value: AccountDataExport) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function authRequest<T>(path: string, options: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown }) {
  const headers: Record<string, string> = {
    'X-Lutealark-User-Id': getOrCreateDeviceId(),
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8'
  return requestJson<T>(path, {
    method: options.method,
    credentials: 'include',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }, AUTH_TIMEOUT_MS)
}
