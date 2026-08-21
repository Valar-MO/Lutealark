import { useEffect, useMemo, useRef, useState } from 'react'
import type { CycleResult } from '../lib/api'
import {
  createBreathingRecord,
  type BreathingRating,
  type BreathingRecord,
} from './breathing-storage'

type BreathingPhase = {
  name: '吸气' | '屏息' | '呼气'
  duration: number
  scale: number
}

type BreathingMode = {
  id: string
  name: string
  description: string
  durationSeconds: number
  rhythm: string
  tag: string
  phases: BreathingPhase[]
}

const BREATHING_MODES: BreathingMode[] = [
  {
    id: 'luteal_gentle',
    name: '黄体期温和呼吸',
    description: '节奏轻柔、屏息较短，适合低能量或缓冲模式。',
    durationSeconds: 180,
    rhythm: '3 · 2 · 4',
    tag: '温和减负',
    phases: [
      { name: '吸气', duration: 3, scale: 1.45 },
      { name: '屏息', duration: 2, scale: 1.45 },
      { name: '呼气', duration: 4, scale: 1 },
    ],
  },
  {
    id: 'box',
    name: '方块呼吸',
    description: '均匀的四段节奏，适合需要重新集中注意力时。',
    durationSeconds: 120,
    rhythm: '4 · 4 · 4 · 4',
    tag: '重新聚焦',
    phases: [
      { name: '吸气', duration: 4, scale: 1.45 },
      { name: '屏息', duration: 4, scale: 1.45 },
      { name: '呼气', duration: 4, scale: 1 },
      { name: '屏息', duration: 4, scale: 1 },
    ],
  },
  {
    id: 'resonance',
    name: '共振呼吸',
    description: '不需要屏息，用稳定的吸气和呼气慢慢放松。',
    durationSeconds: 300,
    rhythm: '5 · 5',
    tag: '日常放松',
    phases: [
      { name: '吸气', duration: 5, scale: 1.45 },
      { name: '呼气', duration: 5, scale: 1 },
    ],
  },
  {
    id: 'grounding',
    name: '感官接地呼吸',
    description: '让呼气比吸气更长，把注意力带回身体和当下。',
    durationSeconds: 240,
    rhythm: '4 · 2 · 6',
    tag: '稳定情绪',
    phases: [
      { name: '吸气', duration: 4, scale: 1.45 },
      { name: '屏息', duration: 2, scale: 1.45 },
      { name: '呼气', duration: 6, scale: 1 },
    ],
  },
  {
    id: 'relax_478',
    name: '4-7-8 放松呼吸',
    description: '较长的屏息与呼气节奏；第一次练习时不必追求吸得很深。',
    durationSeconds: 180,
    rhythm: '4 · 7 · 8',
    tag: '深度放松',
    phases: [
      { name: '吸气', duration: 4, scale: 1.45 },
      { name: '屏息', duration: 7, scale: 1.45 },
      { name: '呼气', duration: 8, scale: 1 },
    ],
  },
]

type BreathingScreen = 'select' | 'guide' | 'complete'

export function BreathingPage({
  cycleResult,
  onBack,
  records,
  onUpsertRecord,
  onDeleteRecord,
}: {
  cycleResult: CycleResult | null
  onBack: () => void
  records: BreathingRecord[]
  onUpsertRecord: (record: BreathingRecord) => void
  onDeleteRecord: (recordId: string) => Promise<void>
}) {
  const recommendedId = cycleResult?.isBufferMode ? 'luteal_gentle' : 'resonance'
  const orderedModes = useMemo(
    () => [...BREATHING_MODES].sort((a, b) => Number(b.id === recommendedId) - Number(a.id === recommendedId)),
    [recommendedId],
  )
  const [screen, setScreen] = useState<BreathingScreen>('select')
  const [selectedMode, setSelectedMode] = useState<BreathingMode>(orderedModes[0])
  const [activeRecord, setActiveRecord] = useState<BreathingRecord | null>(null)
  const [rating, setRating] = useState<BreathingRating | null>(null)

  const startMode = (mode: BreathingMode) => {
    setSelectedMode(mode)
    setActiveRecord(null)
    setRating(null)
    setScreen('guide')
  }

  const completeMode = () => {
    const record = createBreathingRecord(selectedMode)
    onUpsertRecord(record)
    setActiveRecord(record)
    setRating(null)
    setScreen('complete')
  }

  const rateCompletedMode = (value: BreathingRating) => {
    setRating(value)
    if (!activeRecord) return
    const updated = { ...activeRecord, rating: value }
    setActiveRecord(updated)
    onUpsertRecord(updated)
  }

  const resetCompletedMode = (nextScreen: BreathingScreen) => {
    setActiveRecord(null)
    setRating(null)
    setScreen(nextScreen)
  }

  if (screen === 'guide') {
    return (
      <BreathingGuide
        mode={selectedMode}
        onStop={() => resetCompletedMode('select')}
        onComplete={completeMode}
      />
    )
  }

  if (screen === 'complete') {
    return (
      <CompletionView
        mode={selectedMode}
        rating={rating}
        onRate={rateCompletedMode}
        onAgain={() => resetCompletedMode('guide')}
        onChooseAnother={() => resetCompletedMode('select')}
        onBack={onBack}
      />
    )
  }

  return (
    <section className="soft-grid min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 rounded-full border border-[#d2cbc0] bg-white/70 px-4 py-2 text-sm text-[#62685d] hover:bg-white"
        >
          ← 返回聊天
        </button>

        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-[.2em] text-[#7c8d72]">BREATHING SPACE</p>
          <h2 className="mt-2 font-serif text-3xl font-semibold text-[#343b31] md:text-[34px]">
            选一个此刻最舒服的节奏
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#77736c]">
            不需要吸得很深，也不需要做到完美。感到头晕、胸闷或不舒服时，请恢复自然呼吸并停止训练。
          </p>
        </div>

        <BreathingRecordSummary records={records} onDeleteRecord={onDeleteRecord} />

        <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {orderedModes.map((mode) => {
            const recommended = mode.id === recommendedId
            return (
              <button
                type="button"
                key={mode.id}
                onClick={() => startMode(mode)}
                className={`group relative min-h-0 overflow-hidden rounded-[22px] border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_16px_45px_rgba(69,77,62,.12)] ${
                  recommended
                    ? 'border-[#8fa083] bg-[#eef3ea]'
                    : 'border-[#ded8ce] bg-white/80 hover:border-[#b5c0ad]'
                }`}
              >
                {recommended && (
                  <span className="absolute right-5 top-5 rounded-full bg-[#65775d] px-3 py-1 text-[11px] text-white">
                    适合你当前状态
                  </span>
                )}
                <span className="inline-flex rounded-full bg-white/75 px-3 py-1 text-xs text-[#6d7766]">
                  {mode.tag}
                </span>
                <h3 className="mt-3 font-serif text-xl font-semibold text-[#394036]">{mode.name}</h3>
                <p className="mt-1 max-w-md text-sm leading-5 text-[#7b766e]">{mode.description}</p>
                <div className="mt-3 flex items-center gap-3 text-sm">
                  <span className="font-medium text-[#53604e]">{mode.rhythm}</span>
                  <span className="text-[#c0b9af]">·</span>
                  <span className="text-[#8b857c]">{formatMinutes(mode.durationSeconds)}</span>
                  <span className="ml-auto text-[#66785f] transition group-hover:translate-x-1">开始 →</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function BreathingGuide({
  mode,
  onStop,
  onComplete,
}: {
  mode: BreathingMode
  onStop: () => void
  onComplete: () => void
}) {
  const totalMs = mode.durationSeconds * 1000
  const cycleMs = mode.phases.reduce((sum, phase) => sum + phase.duration * 1000, 0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [running, setRunning] = useState(true)
  const completionCalled = useRef(false)
  const resumeElapsedRef = useRef(0)

  useEffect(() => {
    if (!running) return
    const startedAt = performance.now() - resumeElapsedRef.current
    const timer = window.setInterval(() => {
      setElapsedMs(Math.min(totalMs, performance.now() - startedAt))
    }, 100)
    return () => window.clearInterval(timer)
  }, [running, totalMs])

  useEffect(() => {
    if (elapsedMs < totalMs || completionCalled.current) return
    completionCalled.current = true
    setRunning(false)
    onComplete()
  }, [elapsedMs, onComplete, totalMs])

  const cycleElapsed = elapsedMs % cycleMs
  let phaseStart = 0
  let phaseIndex = 0
  for (let index = 0; index < mode.phases.length; index += 1) {
    const phaseEnd = phaseStart + mode.phases[index].duration * 1000
    if (cycleElapsed < phaseEnd) {
      phaseIndex = index
      break
    }
    phaseStart = phaseEnd
  }
  const phase = mode.phases[phaseIndex]
  const phaseRemaining = Math.max(1, Math.ceil((phaseStart + phase.duration * 1000 - cycleElapsed) / 1000))
  const remainingSeconds = Math.max(0, Math.ceil((totalMs - elapsedMs) / 1000))
  const progress = Math.min(100, (elapsedMs / totalMs) * 100)

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#e9eee5]">
      <div className="absolute inset-0 breathing-ambient" aria-hidden="true" />
      <div className="relative z-10 flex shrink-0 items-center justify-between px-5 py-3 md:px-8">
        <button
          type="button"
          onClick={onStop}
          className="rounded-full border border-white/70 bg-white/50 px-4 py-2 text-sm text-[#5e6858] backdrop-blur"
        >
          结束训练
        </button>
        <div className="text-right">
          <p className="text-sm font-medium text-[#53604e]">{mode.name}</p>
          <p className="mt-0.5 text-xs text-[#7f8979]">剩余 {formatClock(remainingSeconds)}</p>
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-5">
        <div className="breathing-stage relative grid shrink place-items-center">
          <div className="breathing-ring absolute rounded-full border border-white/60" />
          <div
            className="breathing-circle grid place-items-center rounded-full bg-[#718469] text-white shadow-[0_30px_80px_rgba(80,105,73,.28)]"
            style={{
              transform: `scale(${phase.scale})`,
              transitionDuration: running ? `${phase.duration}s` : '0s',
            }}
          >
            <div className="text-center">
              <p className="font-serif text-3xl font-semibold">{phase.name}</p>
              <p className="mt-2 text-xl text-white/80">{phaseRemaining}</p>
            </div>
          </div>
        </div>

        <p className="mt-3 text-center text-sm leading-6 text-[#697364]">
          {running ? phaseHint(phase.name) : '已经暂停，准备好时再继续。'}
        </p>

        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={() => {
              if (!running) resumeElapsedRef.current = elapsedMs
              setRunning((value) => !value)
            }}
            className="min-w-32 rounded-full bg-[#64755d] px-6 py-3 font-medium text-white shadow-sm hover:bg-[#56674f]"
          >
            {running ? '暂停' : '继续'}
          </button>
          <button
            type="button"
            onClick={onStop}
            className="rounded-full border border-[#bdc7b7] bg-white/55 px-6 py-3 text-[#5f6959]"
          >
            停止
          </button>
        </div>
      </div>

      <div className="relative z-10 shrink-0 px-5 pb-4 pt-2 md:px-10">
        <div className="mx-auto max-w-3xl">
          <div className="mb-3 flex justify-between text-xs text-[#778171]">
            <span>{formatClock(Math.floor(elapsedMs / 1000))}</span>
            <span>{formatClock(mode.durationSeconds)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/65">
            <div className="h-full rounded-full bg-[#73866a] transition-[width] duration-100" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {mode.phases.map((item, index) => (
              <span
                key={`${item.name}-${index}`}
                className={`rounded-full px-3 py-1 text-xs ${
                  index === phaseIndex ? 'bg-[#66795e] text-white' : 'bg-white/55 text-[#7c8676]'
                }`}
              >
                {item.name} {item.duration}s
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function CompletionView({
  mode,
  rating,
  onRate,
  onAgain,
  onChooseAnother,
  onBack,
}: {
  mode: BreathingMode
  rating: BreathingRating | null
  onRate: (rating: BreathingRating) => void
  onAgain: () => void
  onChooseAnother: () => void
  onBack: () => void
}) {
  return (
    <section className="soft-grid grid min-h-0 flex-1 place-items-center overflow-y-auto px-5 py-5">
      <div className="w-full max-w-xl rounded-[26px] border border-[#dbe1d6] bg-white/80 p-6 text-center shadow-[0_24px_70px_rgba(70,82,64,.12)] md:p-7">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#e5ede0] text-3xl">✓</div>
        <p className="mt-4 text-xs font-medium tracking-[.2em] text-[#7e9074]">SESSION COMPLETE</p>
        <h2 className="mt-2 font-serif text-2xl font-semibold text-[#343c31]">这一轮已经完成了</h2>
        <p className="mt-2 text-sm leading-6 text-[#79746d]">
          你完成了 {formatMinutes(mode.durationSeconds)}的“{mode.name}”。不需要立刻变得很好，能停下来照顾自己已经很重要。
        </p>

        <div className="mt-5 rounded-[20px] bg-[#f1f4ee] p-4">
          <p className="text-sm font-medium text-[#596454]">现在的放松程度</p>
          <div className="mt-3 flex justify-center gap-2" aria-label="放松程度评分">
            {([1, 2, 3, 4, 5] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`${value} 分`}
                aria-pressed={rating === value}
                onClick={() => onRate(value)}
                className={`grid h-10 w-10 place-items-center rounded-full text-base transition ${
                  rating !== null && value <= rating
                    ? 'bg-[#6c7e64] text-white'
                    : 'bg-white text-[#9aa294] hover:bg-[#e5ebe1]'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-[#92998d]">1 表示变化不明显，5 表示明显放松</p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onAgain} className="rounded-full bg-[#66785f] px-5 py-3 font-medium text-white">
            再做一轮
          </button>
          <button type="button" onClick={onChooseAnother} className="rounded-full border border-[#d1cbc1] bg-white px-5 py-3 text-[#62675d]">
            选择其他模式
          </button>
        </div>
        <button type="button" onClick={onBack} className="mt-4 text-sm text-[#7d8677] underline decoration-[#b7beb1] underline-offset-4">
          返回聊天
        </button>
        <p className="mt-3 text-[11px] text-[#a19c94]">记录会先保存在本机，并在连接可用时同步。</p>
      </div>
    </section>
  )
}

function BreathingRecordSummary({ records, onDeleteRecord }: { records: BreathingRecord[]; onDeleteRecord: (recordId: string) => Promise<void> }) {
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const totalMinutes = Math.round(
    records.reduce((total, record) => total + record.durationSeconds, 0) / 60,
  )
  const remove = async (record: BreathingRecord) => {
    if (!window.confirm(`确定删除 ${formatRecordTime(record.completedAt)} 的“${record.modeName}”记录吗？`)) return
    setBusyId(record.id)
    setError('')
    try {
      await onDeleteRecord(record.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除记录失败，请稍后再试。')
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="mt-5 rounded-[20px] border border-[#dce2d7] bg-white/65 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[.16em] text-[#7c8d72]">PRACTICE HISTORY</p>
          <p className="mt-1 text-sm text-[#5f6859]">
            {records.length > 0
              ? `当前保存 ${records.length} 次·合计 ${totalMinutes} 分钟`
              : '完整做完一轮后，会在这里留下记录。'}
          </p>
        </div>
        <p className="max-w-xs text-xs leading-5 text-[#918b82]">本机优先·最多 30 条·可删除</p>
      </div>

      {error && <p className="mt-3 rounded-xl border border-[#e2b7a8] bg-[#fff5f0] px-3 py-2 text-xs text-[#8a5140]" role="alert">{error}</p>}

      {records.length > 0 && (
        <div className="scrollbar mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
          {records.map((record) => (
            <div key={record.id} className="rounded-2xl bg-[#f5f7f2] px-3 py-2.5">
              <p className="truncate text-sm font-medium text-[#4f5d49]">{record.modeName}</p>
              <p className="mt-1 text-xs text-[#858078]">
                <time dateTime={record.completedAt}>{formatRecordTime(record.completedAt)}</time>
                {' · '}{formatMinutes(record.durationSeconds)}
              </p>
              <p className="mt-1 text-xs text-[#788272]">
                {record.rating === null ? '还没评分' : `放松程度 ${record.rating}/5`}
              </p>
              <button type="button" disabled={busyId === record.id} onClick={() => void remove(record)} className="mt-2 text-xs text-[#965d49] underline decoration-[#d7bbb0] underline-offset-2 disabled:opacity-50">{busyId === record.id ? '正在删除…' : '删除记录'}</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function formatMinutes(seconds: number) {
  return `${Math.round(seconds / 60)} 分钟`
}

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function formatRecordTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function phaseHint(phase: BreathingPhase['name']) {
  if (phase === '吸气') return '慢慢吸气，不用刻意吸得很满。'
  if (phase === '呼气') return '轻轻呼气，让肩膀和下颌松一点。'
  return '舒服地停留；如果憋气不适，可以直接自然呼吸。'
}
