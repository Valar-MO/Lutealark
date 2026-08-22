import { requestJson } from './api'
import { getOrCreateDeviceId } from './personal-data'
import type {
  AuthSessionResponse,
  AuthStatus as SharedAuthStatus,
} from '@lutealark/contracts'

const AUTH_TIMEOUT_MS = 10_000

export type AuthStatus = SharedAuthStatus
export type AuthSession = AuthSessionResponse
export type AccountExportDisposition = 'downloaded'

export type AccountDataExport = {
  format: 'lutealark-account-data'
  schemaVersion: 1
  exportedAt: string
  data: Record<string, unknown>
}

export function getAuthStatus() {
  return authRequest<AuthStatus>('/api/auth/me', { method: 'GET' })
}

export function registerAccount(email: string, password: string) {
  return authRequest<AuthSession>('/api/auth/register', {
    method: 'POST',
    body: { email: normalizeAuthEmail(email), password, deviceUserId: getOrCreateDeviceId() },
  })
}

export function loginAccount(email: string, password: string) {
  return authRequest<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: { email: normalizeAuthEmail(email), password, deviceUserId: getOrCreateDeviceId() },
  })
}

export function logoutAccount() {
  return authRequest<{ authenticated: false }>('/api/auth/logout', { method: 'POST' })
}

export function exportAccountData() {
  return authRequest<AccountDataExport>('/api/auth/export', { method: 'GET' })
}

export function deleteAccount(email: string, password: string) {
  return authRequest<{ deleted: true }>('/api/auth/account', {
    method: 'DELETE',
    body: deleteAccountRequestBody(email, password),
  })
}

export function deleteAccountRequestBody(email: string, password: string) {
  return { email: normalizeAuthEmail(email), password }
}

export function normalizeAuthEmail(email: string) {
  return email.trim().toLowerCase()
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
  downloadAccountExport(value)
  return 'downloaded'
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
