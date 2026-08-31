import { create } from 'zustand'
import { createToolId, type CountdownStatus, type FocusDurationMinutes } from './gentle-tools-logic'

export type GlobalFocusTimer = {
  durationMinutes: FocusDurationMinutes
  remainingSeconds: number
  status: CountdownStatus
  deadlineMs: number | null
  runId: string
  hasStarted: boolean
}

type FocusTimerStore = {
  timer: GlobalFocusTimer
  configure: (durationMinutes: FocusDurationMinutes) => void
  start: () => void
  pause: () => void
  reset: (durationMinutes?: FocusDurationMinutes) => void
  tick: (now?: number) => void
}

const DEFAULT_DURATION_MINUTES = 15

function initialTimer(): GlobalFocusTimer {
  return {
    durationMinutes: DEFAULT_DURATION_MINUTES,
    remainingSeconds: DEFAULT_DURATION_MINUTES * 60,
    status: 'idle',
    deadlineMs: null,
    runId: '',
    hasStarted: false,
  }
}

export const useFocusTimerStore = create<FocusTimerStore>()((set) => ({
  timer: initialTimer(),
  configure: (durationMinutes) => set((state) => {
    if (state.timer.status === 'running') return state
    return {
      timer: {
        ...state.timer,
        durationMinutes,
        remainingSeconds: durationMinutes * 60,
        status: 'idle',
        deadlineMs: null,
      },
    }
  }),
  start: () => set((state) => {
    const remainingSeconds = state.timer.status === 'completed' || state.timer.remainingSeconds <= 0
      ? state.timer.durationMinutes * 60
      : state.timer.remainingSeconds
    return {
      timer: {
        ...state.timer,
        remainingSeconds,
        status: 'running',
        deadlineMs: Date.now() + remainingSeconds * 1000,
        runId: state.timer.status === 'idle' || state.timer.status === 'completed' ? createToolId() : state.timer.runId,
        hasStarted: true,
      },
    }
  }),
  pause: () => set((state) => {
    if (state.timer.status !== 'running' || state.timer.deadlineMs === null) return state
    const remainingSeconds = Math.max(0, Math.ceil((state.timer.deadlineMs - Date.now()) / 1000))
    return {
      timer: {
        ...state.timer,
        remainingSeconds,
        status: remainingSeconds > 0 ? 'paused' : 'completed',
        deadlineMs: null,
      },
    }
  }),
  reset: (durationMinutes) => set((state) => {
    const nextDuration = durationMinutes ?? state.timer.durationMinutes
    return {
      timer: {
        ...state.timer,
        durationMinutes: nextDuration,
        remainingSeconds: nextDuration * 60,
        status: 'idle',
        deadlineMs: null,
      },
    }
  }),
  tick: (now = Date.now()) => set((state) => {
    if (state.timer.status !== 'running' || state.timer.deadlineMs === null) return state
    const remainingSeconds = Math.max(0, Math.ceil((state.timer.deadlineMs - now) / 1000))
    return {
      timer: {
        ...state.timer,
        remainingSeconds,
        status: remainingSeconds > 0 ? 'running' : 'completed',
        deadlineMs: remainingSeconds > 0 ? state.timer.deadlineMs : null,
      },
    }
  }),
}))
