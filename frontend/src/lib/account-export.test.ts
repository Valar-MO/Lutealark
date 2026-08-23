import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveAccountExport, type AccountDataExport } from './auth-api'

const accountExport: AccountDataExport = {
  format: 'lutealark-account-data',
  schemaVersion: 1,
  exportedAt: '2026-08-20T10:00:00.000Z',
  data: { cycleSettings: [{ cycleLength: 28 }] },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('account data export', () => {
  it('downloads an account JSON file in the browser', async () => {
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
  })
})
