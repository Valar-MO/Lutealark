import { describe, expect, it, vi } from 'vitest'
import {
  CHAT_RETURN_VIEW,
  DEFAULT_APP_PATH,
  navigateBackToCycle,
  pathForView,
  viewFromPath,
} from './app-routes'

describe('application route contracts', () => {
  it('uses the cycle page as the default and chat return destination', () => {
    expect(DEFAULT_APP_PATH).toBe('/cycle')
    expect(CHAT_RETURN_VIEW).toBe('cycle')
    expect(pathForView(CHAT_RETURN_VIEW)).toBe('/cycle')
  })

  it('recognizes canonical routes and trailing slashes', () => {
    expect(viewFromPath('/cycle')).toBe('cycle')
    expect(viewFromPath('/agent/')).toBe('agent')
  })

  it('lets the router redirect root and unknown paths to the cycle default', () => {
    expect(viewFromPath('/')).toBeNull()
    expect(viewFromPath('/not-a-page')).toBeNull()
  })

  it('returns from chat through navigation without a conversation reset callback', () => {
    const openView = vi.fn()

    navigateBackToCycle(openView)

    expect(openView).toHaveBeenCalledTimes(1)
    expect(openView).toHaveBeenCalledWith('cycle')
  })
})
