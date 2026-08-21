import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isNativeRuntime: vi.fn<() => boolean>(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  canShare: vi.fn(),
  share: vi.fn(),
}))

vi.mock('./native-auth', () => ({
  isNativeRuntime: mocks.isNativeRuntime,
  getNativeAccessToken: vi.fn(async () => null),
  setNativeAccessToken: vi.fn(async () => undefined),
  clearNativeAccessToken: vi.fn(async () => undefined),
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: mocks.writeFile, deleteFile: mocks.deleteFile },
}))

vi.mock('@capacitor/share', () => ({
  Share: { canShare: mocks.canShare, share: mocks.share },
}))

import { saveAccountExport, serializeAccountExport, type AccountDataExport } from './auth-api'

const accountExport: AccountDataExport = {
  format: 'lutealark-account-data',
  schemaVersion: 1,
  exportedAt: '2026-08-20T10:00:00.000Z',
  data: { cycleSettings: [{ cycleLength: 28 }] },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isNativeRuntime.mockReturnValue(true)
  mocks.canShare.mockResolvedValue({ value: true })
  mocks.writeFile.mockResolvedValue({
    uri: 'file:///data/user/0/com.lutealark.app/cache/exports/lutealark-account-data-2026-08-20.json',
  })
  mocks.deleteFile.mockResolvedValue(undefined)
  mocks.share.mockResolvedValue({ activityType: 'android.intent.action.SEND' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('account data export delivery', () => {
  it('writes a native export to private cache and passes only its file URI to Android share', async () => {
    await expect(saveAccountExport(accountExport)).resolves.toBe('shared')

    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: 'exports/lutealark-account-data-2026-08-20.json',
      data: serializeAccountExport(accountExport),
      directory: 'CACHE',
      encoding: 'utf8',
      recursive: true,
    })
    expect(mocks.share).toHaveBeenCalledWith({
      title: 'Lutealark 账号数据',
      files: ['file:///data/user/0/com.lutealark.app/cache/exports/lutealark-account-data-2026-08-20.json'],
      dialogTitle: '导出 Lutealark 账号数据',
    })
    expect(mocks.deleteFile).toHaveBeenCalledWith({
      path: 'exports/lutealark-account-data-2026-08-20.json',
      directory: 'CACHE',
    })
  })

  it('keeps the browser Blob download and never calls native storage', async () => {
    mocks.isNativeRuntime.mockReturnValue(false)
    const anchor = {
      href: '',
      download: '',
      hidden: false,
      click: vi.fn(),
      remove: vi.fn(),
    }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:lutealark-export')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    await expect(saveAccountExport(accountExport)).resolves.toBe('downloaded')

    expect(anchor.download).toBe('lutealark-account-data-2026-08-20.json')
    expect(anchor.href).toBe('blob:lutealark-export')
    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.remove).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:lutealark-export')
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.deleteFile).not.toHaveBeenCalled()
    expect(mocks.share).not.toHaveBeenCalled()
  })

  it('reports cancellation without falling back to an unreliable WebView download', async () => {
    mocks.share.mockRejectedValueOnce(new Error('Share canceled'))

    await expect(saveAccountExport(accountExport)).rejects.toThrow('已取消账号数据导出')
    expect(mocks.writeFile).toHaveBeenCalledOnce()
    expect(mocks.deleteFile).toHaveBeenCalledWith({
      path: 'exports/lutealark-account-data-2026-08-20.json',
      directory: 'CACHE',
    })
  })

  it('does not let cache cleanup failure replace a successful share result', async () => {
    mocks.deleteFile.mockRejectedValueOnce(new Error('cache cleanup failed'))

    await expect(saveAccountExport(accountExport)).resolves.toBe('shared')
    expect(mocks.deleteFile).toHaveBeenCalledOnce()
  })

  it('does not let cache cleanup failure replace the original share error', async () => {
    mocks.share.mockRejectedValueOnce(new Error('share activity failed'))
    mocks.deleteFile.mockRejectedValueOnce(new Error('cache cleanup failed'))

    await expect(saveAccountExport(accountExport)).rejects.toThrow('无法打开系统导出面板')
    expect(mocks.deleteFile).toHaveBeenCalledOnce()
  })
})
