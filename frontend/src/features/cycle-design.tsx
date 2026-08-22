import { useMemo, useState, type FormEvent } from 'react'
import type { CycleResult, CycleSettings } from '../lib/api'

type CycleDesignViewProps = {
  settings: CycleSettings | null
  result: CycleResult | null
  onSave: (settings: CycleSettings) => Promise<void>
  /** Hide the record form toggle when the curve is embedded in the product home. */
  showRecordButton?: boolean
}

type DatePoint = {
  date: string
  label: string
  day: number
  isToday: boolean
}

const BUSINESS_TIME_ZONE = 'Asia/Shanghai'
const businessDateFormatter = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const PHASE_COLORS = {
  menstruation: '#F29B9D',
  follicular: '#A8D5BA',
  ovulation: '#F1B36D',
  luteal: '#E5A04B',
} as const

function dateOnly(date = new Date()) {
  const parts = businessDateFormatter.formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function displayDate(value: string) {
  const [, month, day] = value.split('-')
  return `${Number(month)}/${Number(day)}`
}

function phaseKey(result: CycleResult | null) {
  if (!result) return 'follicular' as const
  if (result.currentPhase === 'menstruation') return 'menstruation' as const
  if (result.currentPhase === 'ovulation') return 'ovulation' as const
  if (result.currentPhase.startsWith('luteal')) return 'luteal' as const
  return 'follicular' as const
}

function phaseDescription(result: CycleResult | null) {
  if (!result) return '记录周期后，这里会显示你的温柔节奏。'
  if (result.currentPhase.startsWith('luteal')) return '孕酮水平上升，启动困难可能增加。给自己一点余地与照顾。'
  if (result.currentPhase === 'ovulation') return '能量可能处于高点，也可以把节奏留给身体自己。'
  if (result.currentPhase === 'menstruation') return '身体正在更新，适合把任务缩小，先照顾好基本需要。'
  return '身体正在逐渐恢复能量，按自己的速度推进即可。'
}

function phaseLabel(result: CycleResult | null) {
  return result?.phaseName ?? '周期尚未记录'
}

function LarkMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.82} viewBox="0 0 44 36" aria-hidden="true" className="shrink-0">
      <path d="M2 25c8-1 12-5 15-11-1-5 1-9 4-12 1 5 4 8 8 10 3-4 7-5 12-3-3 2-5 5-6 9-1 7-7 12-16 14 4-3 6-6 7-9-6 3-13 4-24 2Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="34.5" cy="10.5" r="1.4" fill="currentColor" />
    </svg>
  )
}

function buildCurve(values: number[], width: number, top: number, height: number) {
  if (values.length === 0) return ''
  const points = values.map((value, index) => ({
    x: (index / Math.max(1, values.length - 1)) * width,
    y: top + (1 - value) * height,
  }))
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  const commands = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`]
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]
    const current = points[index]
    const next = points[index + 1]
    const afterNext = points[index + 2] ?? next
    const control1 = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    }
    const control2 = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: next.y - (afterNext.y - current.y) / 6,
    }
    commands.push(`C ${control1.x.toFixed(1)} ${control1.y.toFixed(1)}, ${control2.x.toFixed(1)} ${control2.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`)
  }
  return commands.join(' ')
}

function hormoneValues(index: number, kind: 'estrogen' | 'progesterone') {
  // A calm, illustrative relative curve. It communicates rhythm without suggesting a medical measurement.
  const x = index / 7
  if (kind === 'estrogen') return Math.max(0.06, 0.08 + 0.56 * Math.exp(-((x - 0.35) ** 2) / 0.035) + 0.40 * Math.exp(-((x - 0.72) ** 2) / 0.06))
  return Math.max(0.05, 0.05 + 0.42 * Math.exp(-((x - 0.46) ** 2) / 0.045) + 0.48 * Math.exp(-((x - 0.73) ** 2) / 0.07))
}

function CycleCurve({ result, onSelectDate }: { result: CycleResult | null; onSelectDate: (point: DatePoint) => void }) {
  const today = dateOnly()
  const points = useMemo<DatePoint[]>(() => Array.from({ length: 8 }, (_, index) => {
    const offset = index - 3
    const date = addDays(today, offset)
    return { date, label: offset === 0 ? '今天' : displayDate(date), day: offset, isToday: offset === 0 }
  }), [today])
  const currentIndex = 3
  const width = 760
  const chartTop = 30
  const chartHeight = 190
  const estrogen = points.map((_, index) => hormoneValues(index, 'estrogen'))
  const progesterone = points.map((_, index) => hormoneValues(index, 'progesterone'))
  const flight = points.map((_, index) => 0.76 + 0.06 * Math.sin(index * 0.75))
  const xFor = (index: number) => (index / 7) * width
  const currentY = chartTop + (1 - flight[currentIndex]) * chartHeight
  const activePhase = phaseKey(result)
  const pastCurveWidth = xFor(currentIndex)

  return (
    <section className="cycle-design-home rounded-[28px] border border-[#eadfce] bg-[#fffaf2] px-4 pb-5 pt-5 shadow-[0_18px_50px_rgba(155,117,67,.08)] sm:px-7 sm:pt-6">
      <div className="mb-4 text-center">
        <p className="text-[11px] font-medium tracking-[.2em] text-[#b5874d]">SUN · 生理曲线 · 温柔陪伴</p>
        <h2 className="mt-1 font-serif text-xl font-semibold text-[#654e38] sm:text-2xl">记录每一次波动，看见身体的节律</h2>
      </div>
      <div className="relative overflow-x-auto pb-1">
        <div className="min-w-[650px] px-2">
          <div className="mb-1 flex items-center gap-3 pl-0 text-xs font-medium text-[#6b5a48]">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#e8a35f]" />雌激素</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#c88f5e]" />孕酮</span>
          </div>
          <svg viewBox={`0 0 ${width + 72} 280`} className="h-[250px] w-full min-w-[650px]" role="img" aria-label="前后三天的相对激素水平与云雀轨迹">
            <g transform="translate(52 0)">
              {[0, 0.25, 0.5, 0.75, 1].map((value) => {
                const y = chartTop + (1 - value) * chartHeight
                return <g key={value}><line x1="0" x2={width} y1={y} y2={y} stroke="#8f816f" strokeOpacity=".12" strokeWidth="1" /><text x="-12" y={y + 4} textAnchor="end" fontSize="11" fill="#6b5a48">{Math.round(value * 100)}%</text></g>
              })}
              <text transform={`translate(-42 ${chartTop + chartHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill="#6b5a48">相对激素水平</text>
              <defs><clipPath id="cycle-past-clip"><rect x="0" y="0" width={pastCurveWidth} height="280" /></clipPath><linearGradient id="lark-flight-gradient" x1="0" x2="1"><stop offset="0" stopColor="#A8D5BA" /><stop offset="1" stopColor="#70C7C5" /></linearGradient></defs>
              <g clipPath="url(#cycle-past-clip)"><path d={buildCurve(estrogen, width, chartTop, chartHeight)} fill="none" stroke="#E8A15D" strokeWidth="3.5" strokeLinecap="round" /><path d={buildCurve(progesterone, width, chartTop, chartHeight)} fill="none" stroke="#C9905D" strokeWidth="3.5" strokeLinecap="round" opacity=".86" /></g>
              <path d={buildCurve(estrogen, width, chartTop, chartHeight)} fill="none" stroke="#E8A15D" strokeWidth="3.5" strokeLinecap="round" opacity=".45" />
              <path d={buildCurve(progesterone, width, chartTop, chartHeight)} fill="none" stroke="#C9905D" strokeWidth="3.5" strokeLinecap="round" opacity=".38" />
              <path d={buildCurve(flight, width, chartTop, chartHeight)} fill="none" stroke="#A8D5BA" strokeWidth="2.2" strokeDasharray="2 8" strokeLinecap="round" opacity=".32" />
              <g clipPath="url(#cycle-past-clip)"><path d={buildCurve(flight, width, chartTop, chartHeight)} fill="none" stroke="url(#lark-flight-gradient)" strokeWidth="2.2" strokeDasharray="2 6" strokeLinecap="round" opacity=".9" /></g>
              <line x1={xFor(currentIndex)} x2={xFor(currentIndex)} y1={chartTop + chartHeight + 4} y2={chartTop + chartHeight + 13} stroke="#75c9c5" strokeWidth="3" strokeLinecap="round" />
              <circle cx={xFor(currentIndex)} cy={currentY} r="4" fill="#72c9c5" stroke="#fffaf2" strokeWidth="2" />
              <g transform={`translate(${xFor(currentIndex) - 17} ${currentY - 31})`} className="text-[#6ec8c5]"><LarkMark size={34} /></g>
              {points.map((point, index) => <g key={point.date} className="cursor-pointer" onClick={() => onSelectDate(point)} role="button" aria-label={`查看 ${point.label} 的周期说明`}>
                <rect x={xFor(index) - 35} y={chartTop + chartHeight + 12} width="70" height="42" fill="transparent" />
                <text x={xFor(index)} y={chartTop + chartHeight + 30} textAnchor="middle" fontSize={point.isToday ? '12' : '11'} fontWeight={point.isToday ? '700' : '500'} fill={point.isToday ? '#b8782f' : '#6b5a48'}>{point.label}</text>
              </g>)}
            </g>
          </svg>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[#f0e1ce] bg-white/70 px-4 py-3">
        <div className="min-w-0"><p className="text-base font-semibold text-[#ba7528]">{phaseLabel(result)} · {result ? `第 ${result.dayOfCycle} 天` : '等待记录'}</p><p className="mt-1 text-sm leading-6 text-[#806e5d]">{phaseDescription(result)}</p></div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-[#8b7761]"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PHASE_COLORS[activePhase] }} />当前阶段</div>
      </div>
    </section>
  )
}

function CycleDots({ result, cycleLength }: { result: CycleResult | null; cycleLength: number }) {
  const activeDay = result?.dayOfCycle ?? 1
  const dots = Array.from({ length: cycleLength }, (_, index) => index + 1)
  const center = 50
  const radius = 42
  return <div className="relative mx-auto aspect-square w-full max-w-[310px]" role="img" aria-label={`${cycleLength} 天周期环，当前第 ${activeDay} 天`}>
    {dots.map((day) => {
      const angle = ((day - 1) / cycleLength) * Math.PI * 2 - Math.PI / 2
      const left = center + radius * Math.cos(angle)
      const top = center + radius * Math.sin(angle)
      const phase = day <= Math.max(4, Math.round(cycleLength * .14)) ? 'menstruation' : day <= Math.round(cycleLength * .5) ? 'follicular' : day <= Math.round(cycleLength * .62) ? 'ovulation' : 'luteal'
      const current = day === activeDay
      return <span key={day} className="absolute grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition-transform sm:h-[18px] sm:w-[18px]" style={{ left: `${left}%`, top: `${top}%`, backgroundColor: PHASE_COLORS[phase], boxShadow: current ? '0 0 0 4px rgba(113,202,177,.22), 0 3px 7px rgba(81,131,107,.28)' : undefined, transform: current ? 'translate(-50%,-50%) scale(1.35)' : undefined }} aria-hidden="true" />
    })}
    <div className="absolute inset-[19%] grid place-items-center rounded-full bg-[#fffaf2] text-center"><div><p className="text-sm font-medium text-[#8a6540]">{result?.phaseName ?? '周期记录'}</p><p className="mt-1 font-serif text-2xl font-semibold text-[#b57228]">{result ? `预计 ${result.daysToNextPeriod} 天后` : '从今天开始'}</p><p className="mt-1 text-[11px] text-[#ad947d]">基于您的记录</p></div></div>
    {result && <div className="pointer-events-none absolute left-1/2 top-[3%] -translate-x-1/2 text-[#63bfa9]"><LarkMark size={38} /></div>}
  </div>
}

function CycleRecordForm({ settings, result, onSave, onBack }: { settings: CycleSettings | null; result: CycleResult | null; onSave: (settings: CycleSettings) => Promise<void>; onBack: () => void }) {
  const today = dateOnly()
  const [date, setDate] = useState(settings?.lastPeriodDate ?? '')
  const [length, setLength] = useState(settings?.cycleLength ?? 28)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const nextPeriod = result ? addDays(today, result.daysToNextPeriod) : date ? addDays(date, length) : ''
  const ovulation = nextPeriod ? addDays(nextPeriod, -Math.round(length / 2)) : ''
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!date) { setError('请先选择末次月经日期。'); return }
    setSaving(true); setError('')
    try { await onSave({ lastPeriodDate: date, cycleLength: length }) } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请稍后重试。') } finally { setSaving(false) }
  }
  return <section className="cycle-record-page rounded-[28px] border border-[#eadfce] bg-[#fffaf2] px-4 pb-6 pt-4 shadow-[0_18px_50px_rgba(155,117,67,.08)] sm:px-8">
    <div className="mb-2 flex items-center gap-3"><button type="button" onClick={onBack} aria-label="返回周期曲线" className="grid h-9 w-9 place-items-center rounded-full text-xl text-[#668b8c] hover:bg-[#edf6f1]">←</button><h2 className="font-serif text-xl font-semibold text-[#654e38]">周期记录与预测</h2></div>
    <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:items-center">
      <CycleDots result={result} cycleLength={length} />
      <div>
        <div className="rounded-[20px] border border-[#f0e1ce] bg-white/85 p-4 shadow-[0_8px_22px_rgba(155,117,67,.06)]"><p className="text-sm text-[#795f47]">下次月经预测日期：<strong className="font-medium text-[#a86d2d]">{nextPeriod ? displayDate(nextPeriod) : '记录后生成'}</strong></p><p className="mt-2 text-sm text-[#9a866f]">预测排卵期：{ovulation ? `${displayDate(ovulation)}–${displayDate(addDays(ovulation, 1))}` : '记录后生成'}</p><p className="mt-2 text-sm text-[#9a866f]">当前周期进度：第 {result?.dayOfCycle ?? 0} 天 / 平均 {length} 天</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#f2eadf]"><div className="h-full rounded-full bg-[#eaa34f] transition-all" style={{ width: `${Math.min(100, ((result?.dayOfCycle ?? 0) / length) * 100)}%` }} /></div></div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="flex items-center justify-between gap-4 text-sm text-[#624e3b]"><span className="shrink-0 font-medium">末次月经</span><input required type="date" max={today} value={date} onChange={(event) => setDate(event.target.value)} className="min-w-0 flex-1 rounded-full border border-[#e7d9c6] bg-white/80 px-4 py-2.5 text-right text-sm text-[#826b55] outline-none focus:border-[#dc9d57]" /></label>
          <label className="flex items-center justify-between gap-4 text-sm text-[#624e3b]"><span className="shrink-0 font-medium">平均周期</span><span className="flex min-w-0 items-center rounded-full border border-[#e7d9c6] bg-white/80"><input type="number" min={21} max={35} value={length} onChange={(event) => setLength(Math.max(21, Math.min(35, Number(event.target.value) || 28)))} className="w-20 bg-transparent px-4 py-2.5 text-right outline-none" /><span className="pr-4 text-[#9b866e]">天</span></span></label>
          <div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => setDate(today)} className="rounded-xl bg-[#f5a6a7] px-2 py-2.5 text-xs font-medium text-white">月经开始</button><button type="button" onClick={() => setDate(addDays(today, -3))} className="rounded-xl bg-[#c9ead8] px-2 py-2.5 text-xs font-medium text-[#4c8b70]">月经结束</button><button type="button" onClick={() => setError('已记录今天无异常。')} className="rounded-xl bg-[#f0ece7] px-2 py-2.5 text-xs font-medium text-[#83776d]">无异常</button></div>
          {error && <p className="rounded-xl bg-[#fff0eb] px-3 py-2 text-xs text-[#a45b45]" role="alert">{error}</p>}
          <button type="submit" disabled={saving} className="w-full rounded-full bg-[#e99025] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(223,139,34,.2)] hover:bg-[#d97e16] disabled:opacity-60">{saving ? '正在保存…' : '保存记录'}</button>
        </form>
      </div>
    </div>
  </section>
}

export function CycleDesignPanel({ settings, result, onSave, showRecordButton = true }: CycleDesignViewProps) {
  const [recording, setRecording] = useState(false)
  const [selectedDate, setSelectedDate] = useState<DatePoint | null>(null)
  const today = dateOnly()
  return <div className="space-y-4">
    {recording && showRecordButton ? <CycleRecordForm settings={settings} result={result} onSave={onSave} onBack={() => setRecording(false)} /> : <>
      <CycleCurve result={result} onSelectDate={setSelectedDate} />
      {showRecordButton && <div className="-mt-1 flex justify-end pr-1"><button type="button" onClick={() => setRecording(true)} className="inline-flex items-center gap-2 rounded-full border border-[#ebdfcf] bg-[#f7f1e8] px-4 py-2 text-xs font-medium text-[#6c5a47] shadow-sm hover:bg-white"><span className="h-2 w-2 rounded-full bg-[#e9a052]" />记录</button></div>}
    </>}
    {selectedDate && <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-3xl animate-[cycle-sheet-in_.28s_ease-out] px-3 pb-3" role="dialog" aria-label={`${selectedDate.label} 周期说明`}><div className="rounded-[24px] border border-white/70 bg-[#fffdf8]/95 p-5 shadow-[0_-12px_45px_rgba(90,67,45,.16)] backdrop-blur"><div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#d6c9ba]" /><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-[#a1886d]">{selectedDate.date === today ? '今天' : selectedDate.label} · {phaseLabel(result)}</p><h3 className="mt-1 font-serif text-xl font-semibold text-[#895b31]">{selectedDate.date === today ? '启动困难可能增加' : '给身体一点温柔的空间'}</h3><p className="mt-2 text-sm leading-6 text-[#7a695a]">{phaseDescription(result)}</p></div><button type="button" onClick={() => setSelectedDate(null)} aria-label="关闭日期说明" className="text-xl text-[#9c8872]">×</button></div></div></div>}
  </div>
}
