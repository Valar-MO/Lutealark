import type { AppView } from '../store/app-store'

export const DEFAULT_APP_PATH = '/cycle'
export const CHAT_RETURN_VIEW: AppView = 'cycle'
export type NativeBackAction = 'exit-app' | 'go-cycle' | 'history-back'

const VIEW_BY_PATH: Record<string, AppView> = {
  '/agent': 'agent',
  '/cycle': 'cycle',
  '/breathing': 'breathing',
  '/tools': 'tools',
  '/memory': 'memory',
  '/points': 'points',
  '/account': 'account',
}

export function viewFromPath(pathname: string): AppView | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return VIEW_BY_PATH[normalized] ?? null
}

export function pathForView(view: AppView) {
  return ({
    agent: '/agent',
    cycle: '/cycle',
    breathing: '/breathing',
    tools: '/tools',
    memory: '/memory',
    points: '/points',
    account: '/account',
  } as const)[view]
}

export function navigateBackToCycle(openView: (view: AppView) => void) {
  openView(CHAT_RETURN_VIEW)
}

export function resolveNativeBackAction(pathname: string, canGoBack: boolean): NativeBackAction {
  const view = viewFromPath(pathname)
  if (!view || view === 'cycle') return 'exit-app'
  if (view === 'agent') return 'go-cycle'
  return canGoBack ? 'history-back' : 'go-cycle'
}
