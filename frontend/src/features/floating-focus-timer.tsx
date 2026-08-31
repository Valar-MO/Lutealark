import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { formatCountdown } from './gentle-tools-logic'
import { useFocusTimerStore } from './focus-timer-store'

export function FloatingFocusTimer() {
  const navigate = useNavigate()
  const location = useLocation()
  const timer = useFocusTimerStore((state) => state.timer)
  const tick = useFocusTimerStore((state) => state.tick)
  const pause = useFocusTimerStore((state) => state.pause)
  const start = useFocusTimerStore((state) => state.start)

  useEffect(() => {
    if (timer.status !== 'running') return
    tick()
    const interval = window.setInterval(tick, 250)
    return () => window.clearInterval(interval)
  }, [tick, timer.status])

  if (location.pathname === '/tools' || (timer.status !== 'running' && timer.status !== 'paused')) return null

  return (
    <aside className="floating-focus-timer" aria-label="正在进行的轻专注番茄钟">
      <button type="button" className="floating-focus-open" onClick={() => navigate('/tools?tool=focus')}>
        <span className="text-xs font-medium tracking-[.12em] text-[#74856c]">GENTLE FOCUS</span>
        <strong className="mt-1 block font-mono text-2xl tracking-tight text-[#42533d]">{formatCountdown(timer.remainingSeconds)}</strong>
        <span className="mt-0.5 block text-xs text-[#697262]">{timer.status === 'running' ? '进行中 · 点击回到番茄钟' : '已暂停 · 点击回到番茄钟'}</span>
      </button>
      <button
        type="button"
        className="floating-focus-control"
        onClick={() => (timer.status === 'running' ? pause() : start())}
        aria-label={timer.status === 'running' ? '暂停专注计时' : '继续专注计时'}
      >
        {timer.status === 'running' ? '暂停' : '继续'}
      </button>
    </aside>
  )
}
