import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import {
  ENVIRONMENT_SCENES,
  FOCUS_DURATIONS,
  MAX_GENTLE_PLAN_ITEMS,
  MAX_GENTLE_PLAN_TEXT_LENGTH,
  MICRO_MOVEMENTS,
  SENSORY_SCENES,
  addGentlePlanItem,
  createToolId,
  formatCountdown,
  getMicroMovement,
  isFocusDurationMinutes,
  isPresetFocusDuration,
  MAX_FOCUS_DURATION_MINUTES,
  MIN_FOCUS_DURATION_MINUTES,
  normalizeGentlePlan,
  removeGentlePlanItem,
  toggleGentlePlanItem,
  type CountdownStatus,
  type EnvironmentSceneId,
  type FocusDurationMinutes,
  type FocusSessionCompletion,
  type GentlePlanItem,
  type MicroMovementCompletion,
  type SceneApplication,
  type SensorySceneId,
  type ToolScene,
} from './gentle-tools-logic'
import { useFocusTimerStore } from './focus-timer-store'

export type TodayGentlePlanProps = {
  items: readonly GentlePlanItem[]
  onChange: (items: GentlePlanItem[]) => void
  onItemCompleted?: (item: GentlePlanItem) => void
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

export function TodayGentlePlan({
  items,
  onChange,
  onItemCompleted,
  expanded = true,
  onExpandedChange,
}: TodayGentlePlanProps) {
  const normalizedItems = normalizeGentlePlan(items)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const completedCount = normalizedItems.filter((item) => item.completed).length
  const contentId = useId()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) {
      setNotice('先写下一个很小、能看懂的下一步。')
      return
    }
    if (normalizedItems.length >= MAX_GENTLE_PLAN_ITEMS) {
      setNotice('今天先留这 3 项就好，完成不代表还要继续加码。')
      return
    }
    const next = addGentlePlanItem(normalizedItems, text, createToolId())
    onChange(next)
    setDraft('')
    setNotice('')
  }

  const toggleItem = (id: string) => {
    const next = toggleGentlePlanItem(normalizedItems, id)
    onChange(next)
    const completedItem = next.find((item) => item.id === id)
    if (completedItem?.completed) onItemCompleted?.(completedItem)
  }

  return (
    <section className="gentle-tool-card rounded-[22px] border border-[#ddd8ce] bg-white/80 p-4 shadow-[0_12px_36px_rgba(73,66,55,.06)] sm:p-5">
      <button type="button" className="gentle-tool-toggle w-full text-left" aria-expanded={expanded} aria-controls={contentId} onClick={() => onExpandedChange?.(!expanded)}>
        <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-[.16em] text-[#7d8d74]">TODAY'S LIGHT PLAN</p>
          <h2 className="mt-1 font-serif text-xl font-semibold text-[#384035]">今日轻计划</h2>
        </div>
          <span className="flex items-center gap-3 text-xs text-[#8d877e]">已完成 {completedCount}/{normalizedItems.length}<span className="gentle-tool-toggle-label">{expanded ? '收起' : '展开'}</span></span>
        </div>
        <p className="mt-2 text-sm leading-6 text-[#7a756d]">只放今天真正需要的小步骤，可以随时删掉或改天再做。</p>
      </button>

      <div id={contentId} hidden={!expanded} className="mt-4">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_GENTLE_PLAN_TEXT_LENGTH}
          placeholder="例如：打开文档，写下第一句"
          aria-label="新的轻计划项"
          className="min-w-0 flex-1 rounded-xl border border-[#d8d2c8] bg-[#fbfaf7] px-3 py-2.5 text-sm outline-none focus:border-[#829478]"
        />
        <button
          type="submit"
          disabled={!draft.trim() || normalizedItems.length >= MAX_GENTLE_PLAN_ITEMS}
          className="shrink-0 rounded-xl bg-[#687b60] px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          添加
        </button>
      </form>

      {notice && <p className="mt-2 text-xs leading-5 text-[#8b6945]" role="status">{notice}</p>}

      {normalizedItems.length === 0 ? (
        <div className="gentle-tool-surface mt-4 rounded-2xl border border-dashed border-[#d8d2c8] bg-[#faf9f6] px-4 py-5 text-center text-sm text-[#918b82]">
          现在还是空的。先放进一件五分钟内能开始的事。
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {normalizedItems.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-2xl border border-[#e6e1d8] bg-[#fbfaf7] px-3 py-3">
              <button
                type="button"
                onClick={() => toggleItem(item.id)}
                aria-label={item.completed ? `将“${item.text}”标记为未完成` : `将“${item.text}”标记为已完成`}
                aria-pressed={item.completed}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-sm ${
                  item.completed ? 'border-[#687b60] bg-[#687b60] text-white' : 'border-[#bbb6ad] bg-white text-transparent'
                }`}
              >
                ✓
              </button>
              <span className={`min-w-0 flex-1 break-words text-sm leading-5 ${item.completed ? 'text-[#99938a] line-through' : 'text-[#514e48]'}`}>
                {item.text}
              </span>
              <button
                type="button"
                onClick={() => onChange(removeGentlePlanItem(normalizedItems, item.id))}
                aria-label={`删除“${item.text}”`}
                className="shrink-0 rounded-full px-2 py-1 text-sm text-[#a0968c] hover:bg-[#eeeae3] hover:text-[#746d64]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </section>
  )
}

export type FocusTimerProps = {
  initialDurationMinutes?: FocusDurationMinutes
  spotlight?: boolean
  onDurationChange?: (minutes: FocusDurationMinutes) => void
  onComplete?: (completion: FocusSessionCompletion) => void
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

export function FocusTimer({
  initialDurationMinutes = 15,
  spotlight = false,
  onDurationChange,
  onComplete,
  expanded = true,
  onExpandedChange,
}: FocusTimerProps) {
  const [customDurationInput, setCustomDurationInput] = useState(() => (
    isPresetFocusDuration(initialDurationMinutes) ? '' : String(initialDurationMinutes)
  ))
  const [customDurationError, setCustomDurationError] = useState('')
  const completionIdRef = useRef('')
  const contentId = useId()
  const timer = useFocusTimerStore((state) => state.timer)
  const configureTimer = useFocusTimerStore((state) => state.configure)
  const startGlobalTimer = useFocusTimerStore((state) => state.start)
  const pauseGlobalTimer = useFocusTimerStore((state) => state.pause)
  const resetGlobalTimer = useFocusTimerStore((state) => state.reset)
  const durationMinutes = timer.durationMinutes

  useEffect(() => {
    if (!timer.hasStarted) configureTimer(initialDurationMinutes)
  }, [configureTimer, initialDurationMinutes, timer.hasStarted])

  useEffect(() => {
    if (timer.status !== 'completed' || !timer.runId || completionIdRef.current === timer.runId) return
    completionIdRef.current = timer.runId
    onComplete?.({ id: timer.runId, durationMinutes: timer.durationMinutes, completedAt: new Date().toISOString() })
  }, [onComplete, timer.durationMinutes, timer.runId, timer.status])

  const startTimer = () => {
    startGlobalTimer()
  }

  const selectDuration = (minutes: FocusDurationMinutes) => {
    if (timer.status === 'running') return
    setCustomDurationInput(isPresetFocusDuration(minutes) ? '' : String(minutes))
    setCustomDurationError('')
    configureTimer(minutes)
    onDurationChange?.(minutes)
  }

  const applyCustomDuration = (event: FormEvent) => {
    event.preventDefault()
    const minutes = Number(customDurationInput)
    if (!isFocusDurationMinutes(minutes)) {
      setCustomDurationError(`请输入 ${MIN_FOCUS_DURATION_MINUTES} 到 ${MAX_FOCUS_DURATION_MINUTES} 之间的整数分钟。`)
      return
    }
    selectDuration(minutes)
  }

  return (
    <section className={`gentle-tool-card rounded-[22px] border bg-white/80 p-4 shadow-[0_12px_36px_rgba(73,66,55,.06)] sm:p-5 ${
      spotlight ? 'border-[#829478] bg-[#fbfdf9] ring-4 ring-[#dce8d8]/70' : 'border-[#ddd8ce]'
    }`}>
      <button type="button" className="gentle-tool-toggle w-full text-left" aria-expanded={expanded} aria-controls={contentId} onClick={() => onExpandedChange?.(!expanded)}>
        {spotlight && <span className="mb-3 inline-flex rounded-full bg-[#e5eee1] px-3 py-1 text-xs font-medium text-[#4d6245]">已为你展开专注计时</span>}
        <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-medium tracking-[.16em] text-[#7d8d74]">GENTLE FOCUS</p><h2 className="mt-1 font-serif text-xl font-semibold text-[#384035]">轻专注番茄钟{!expanded && <span className="font-sans text-base font-semibold text-[#4f6049]">{collapsedFocusSummary(durationMinutes, timer.remainingSeconds, timer.status)}</span>}</h2></div><span className="gentle-tool-toggle-label">{expanded ? '收起' : '展开'}</span></div>
        <p className="mt-2 text-sm leading-6 text-[#7a756d]">只承诺这一小段时间。时间到后可以停下，不会自动开始下一轮。</p>
      </button>

      <div id={contentId} hidden={!expanded} className="mt-4">
      <div className="flex gap-2" aria-label="番茄钟时长">
        {FOCUS_DURATIONS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            disabled={timer.status === 'running'}
            aria-pressed={durationMinutes === minutes}
            onClick={() => selectDuration(minutes)}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
              durationMinutes === minutes
                ? 'border-[#718368] bg-[#e9eee5] text-[#465540]'
                : 'border-[#ddd7cd] bg-white text-[#777168]'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {minutes} 分钟
          </button>
        ))}
      </div>

      <form onSubmit={applyCustomDuration} className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl border border-[#e1ddd4] bg-[#faf9f6] p-3">
        <label className="min-w-[150px] flex-1 text-sm text-[#5f5a52]">
          <span className="mb-1 block text-xs text-[#817b72]">自定义时长（1～90 分钟）</span>
          <input
            type="number"
            min={MIN_FOCUS_DURATION_MINUTES}
            max={MAX_FOCUS_DURATION_MINUTES}
            step="1"
            inputMode="numeric"
            value={customDurationInput}
            disabled={timer.status === 'running'}
            onChange={(event) => {
              setCustomDurationInput(event.target.value)
              setCustomDurationError('')
            }}
            aria-label="自定义专注时长（分钟）"
            className="w-full rounded-xl border border-[#d8d2c8] bg-white px-3 py-2 text-sm outline-none focus:border-[#829478] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <button
          type="submit"
          disabled={timer.status === 'running' || !customDurationInput.trim()}
          className="rounded-xl border border-[#cbd7c5] bg-white px-4 py-2 text-sm font-medium text-[#506047] disabled:cursor-not-allowed disabled:opacity-50"
        >
          使用此时长
        </button>
        {customDurationError && <p className="w-full text-xs text-[#9a624d]" role="alert">{customDurationError}</p>}
      </form>

      <div className="mt-4 rounded-[20px] bg-[#eef2eb] px-4 py-5 text-center">
        <time className="font-mono text-5xl font-semibold tracking-tight text-[#4f6049]" aria-live="off">
          {formatCountdown(timer.remainingSeconds)}
        </time>
        <p className="mt-2 text-xs text-[#7f8879]" role="status" aria-live="polite">{countdownStatusLabel(timer.status)}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {timer.status === 'running' ? (
          <button type="button" onClick={pauseGlobalTimer} className="rounded-xl bg-[#687b60] px-4 py-3 text-sm font-medium text-white">暂停</button>
        ) : (
          <button type="button" onClick={startTimer} className="rounded-xl bg-[#687b60] px-4 py-3 text-sm font-medium text-white">
            {timer.status === 'paused' ? '继续' : timer.status === 'completed' ? '再来一轮' : '开始'}
          </button>
        )}
        <button type="button" onClick={() => resetGlobalTimer(timer.durationMinutes)} className="rounded-xl border border-[#d4cec4] bg-white px-4 py-3 text-sm text-[#69645c]">重置</button>
      </div>
      </div>
    </section>
  )
}

function collapsedFocusSummary(durationMinutes: FocusDurationMinutes, remainingSeconds: number, status: CountdownStatus) {
  if (status === 'running') return ` · 剩余 ${formatCountdown(remainingSeconds)} · 进行中`
  if (status === 'paused') return ` · 剩余 ${formatCountdown(remainingSeconds)} · 已暂停`
  if (status === 'completed') return ` · ${durationMinutes} 分钟 · 已完成`
  return ` · ${durationMinutes} 分钟 · 未开始`
}

export type EnvironmentTunerProps = {
  initialSceneId?: EnvironmentSceneId
  onSceneChange?: (sceneId: EnvironmentSceneId) => void
  onApply?: (application: SceneApplication<EnvironmentSceneId>) => void
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

export function EnvironmentTuner({
  initialSceneId = 'start',
  onSceneChange,
  onApply,
  expanded,
  onExpandedChange,
}: EnvironmentTunerProps) {
  return (
    <SceneTool
      eyebrow="ENVIRONMENT RESET"
      title="环境微调"
      description="不用大整理，只改动一个对当下有帮助的细节。"
      scenes={ENVIRONMENT_SCENES}
      initialSceneId={initialSceneId}
      onSceneChange={onSceneChange}
      onApply={onApply}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
  )
}

export type SensoryLoadReducerProps = {
  initialSceneId?: SensorySceneId
  onSceneChange?: (sceneId: SensorySceneId) => void
  onApply?: (application: SceneApplication<SensorySceneId>) => void
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

export function SensoryLoadReducer({
  initialSceneId = 'visual',
  onSceneChange,
  onApply,
  expanded,
  onExpandedChange,
}: SensoryLoadReducerProps) {
  return (
    <SceneTool
      eyebrow="SENSORY LIGHTENING"
      title="感官降载"
      description="选一个最明显的负担，先试一项温和调整。不舒服时可以立即恢复原状。"
      scenes={SENSORY_SCENES}
      initialSceneId={initialSceneId}
      onSceneChange={onSceneChange}
      onApply={onApply}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
  )
}

type SceneToolProps<TId extends string> = {
  eyebrow: string
  title: string
  description: string
  scenes: readonly ToolScene<TId>[]
  initialSceneId: TId
  onSceneChange?: (sceneId: TId) => void
  onApply?: (application: SceneApplication<TId>) => void
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

function SceneTool<TId extends string>({
  eyebrow,
  title,
  description,
  scenes,
  initialSceneId,
  onSceneChange,
  onApply,
  expanded = true,
  onExpandedChange,
}: SceneToolProps<TId>) {
  const [sceneId, setSceneId] = useState<TId>(initialSceneId)
  const [application, setApplication] = useState<{ suggestion: string; id: string } | null>(null)
  const contentId = useId()
  const scene = scenes.find((candidate) => candidate.id === sceneId) ?? scenes[0]

  const selectScene = (nextSceneId: TId) => {
    setSceneId(nextSceneId)
    setApplication(null)
    onSceneChange?.(nextSceneId)
  }

  const applySuggestion = (suggestion: string) => {
    const id = application?.suggestion === suggestion ? application.id : createToolId()
    setApplication({ suggestion, id })
    onApply?.({ id, sceneId: scene.id, suggestion, appliedAt: new Date().toISOString() })
  }

  return (
    <section className="gentle-tool-card rounded-[22px] border border-[#ddd8ce] bg-white/80 p-4 shadow-[0_12px_36px_rgba(73,66,55,.06)] sm:p-5">
      <button type="button" className="gentle-tool-toggle w-full text-left" aria-expanded={expanded} aria-controls={contentId} onClick={() => onExpandedChange?.(!expanded)}>
        <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-medium tracking-[.16em] text-[#7d8d74]">{eyebrow}</p><h2 className="mt-1 font-serif text-xl font-semibold text-[#384035]">{title}</h2></div><span className="gentle-tool-toggle-label">{expanded ? '收起' : '展开'}</span></div>
        <p className="mt-2 text-sm leading-6 text-[#7a756d]">{description}</p>
      </button>

      <div id={contentId} hidden={!expanded} className="mt-4">
      <div className="scrollbar flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={`${title}场景`}>
        {scenes.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={scene.id === candidate.id}
            onClick={() => selectScene(candidate.id)}
            className={`shrink-0 rounded-full border px-3 py-2 text-sm ${
              scene.id === candidate.id
                ? 'border-[#718368] bg-[#e9eee5] text-[#465540]'
                : 'border-[#ddd7cd] bg-white text-[#777168]'
            }`}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      <div className="gentle-tool-surface mt-3 rounded-2xl bg-[#f6f5f1] p-3 sm:p-4">
        <p className="text-sm font-medium text-[#515c4c]">{scene.label}</p>
        <p className="mt-1 text-xs leading-5 text-[#89837b]">{scene.hint}</p>
        <ul className="mt-3 space-y-2">
          {scene.suggestions.map((suggestion) => (
            <li key={suggestion} className={`gentle-tool-option flex items-start gap-2 rounded-xl bg-white/85 p-3 ${
              application?.suggestion === suggestion ? 'gentle-tool-option-active' : ''
            }`}>
              <span className="mt-0.5 text-[#7d8f73]" aria-hidden="true">•</span>
              <span className="min-w-0 flex-1 text-sm leading-5 text-[#5e5952]">{suggestion}</span>
              <button
                type="button"
                onClick={() => applySuggestion(suggestion)}
                aria-pressed={application?.suggestion === suggestion}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${
                  application?.suggestion === suggestion
                    ? 'bg-[#687b60] text-white'
                    : 'border border-[#d6d0c6] bg-[#faf9f6] text-[#716b63]'
                }`}
              >
                {application?.suggestion === suggestion ? '已选' : '试一下'}
              </button>
            </li>
          ))}
        </ul>
      </div>
      </div>
    </section>
  )
}

export type MicroMovementToolProps = {
  initialMovementId?: string
  onMovementChange?: (movementId: string) => void
  onComplete?: (completion: MicroMovementCompletion) => void
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

export function MicroMovementTool({
  initialMovementId = MICRO_MOVEMENTS[0].id,
  onMovementChange,
  onComplete,
  expanded = true,
  onExpandedChange,
}: MicroMovementToolProps) {
  const [movementId, setMovementId] = useState(initialMovementId)
  const movement = getMicroMovement(movementId)
  const completionIdRef = useRef(createToolId())
  const contentId = useId()
  const timer = useCountdown(movement.durationSeconds, () => {
    onComplete?.({
      id: completionIdRef.current,
      movementId: movement.id,
      movementName: movement.name,
      durationSeconds: movement.durationSeconds,
      completedAt: new Date().toISOString(),
    })
  })

  const startMovement = () => {
    if (timer.status === 'idle' || timer.status === 'completed') completionIdRef.current = createToolId()
    timer.start()
  }

  const selectMovement = (nextMovementId: string) => {
    if (timer.status === 'running') return
    const nextMovement = getMicroMovement(nextMovementId)
    setMovementId(nextMovement.id)
    timer.reset(nextMovement.durationSeconds)
    onMovementChange?.(nextMovement.id)
  }

  return (
    <section className="gentle-tool-card rounded-[22px] border border-[#ddd8ce] bg-white/80 p-4 shadow-[0_12px_36px_rgba(73,66,55,.06)] sm:p-5">
      <button type="button" className="gentle-tool-toggle w-full text-left" aria-expanded={expanded} aria-controls={contentId} onClick={() => onExpandedChange?.(!expanded)}>
        <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-medium tracking-[.16em] text-[#7d8d74]">MICRO MOVEMENT</p><h2 className="mt-1 font-serif text-xl font-semibold text-[#384035]">一到三分钟微运动</h2></div><span className="gentle-tool-toggle-label">{expanded ? '收起' : '展开'}</span></div>
        <p className="mt-2 text-sm leading-6 text-[#7a756d]">这些是日常活动提示，不是治疗或医疗建议。只做对你安全、舒服的部分。</p>
      </button>

      <div id={contentId} hidden={!expanded} className="mt-4">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-[#57534d]">选择动作</span>
        <select
          value={movement.id}
          disabled={timer.status === 'running'}
          onChange={(event) => selectMovement(event.target.value)}
          className="w-full rounded-xl border border-[#d8d2c8] bg-[#fbfaf7] px-3 py-2.5 text-sm text-[#57534d] outline-none focus:border-[#829478] disabled:opacity-60"
        >
          {MICRO_MOVEMENTS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} · {candidate.durationSeconds / 60} 分钟
            </option>
          ))}
        </select>
      </label>

      <div className="gentle-tool-surface mt-3 rounded-2xl bg-[#f3f5f0] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-[#4d5a47]">{movement.name}</h3>
            <p className="mt-1 text-xs leading-5 text-[#7d8278]">{movement.summary}</p>
          </div>
          <time className="shrink-0 font-mono text-3xl font-semibold text-[#53634d]" aria-live="off">
            {formatCountdown(timer.remainingSeconds)}
          </time>
        </div>
        <ol className="mt-3 space-y-2">
          {movement.steps.map((step, index) => (
            <li key={step} className="flex gap-2 text-sm leading-5 text-[#5f5a53]">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-[11px] text-[#718068]">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 rounded-xl border border-[#e4d7c7] bg-[#fffaf3] px-3 py-2 text-xs leading-5 text-[#816b51]">安全提醒：{movement.safetyNote}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {timer.status === 'running' ? (
          <button type="button" onClick={timer.pause} className="rounded-xl bg-[#687b60] px-4 py-3 text-sm font-medium text-white">暂停</button>
        ) : (
          <button type="button" onClick={startMovement} className="rounded-xl bg-[#687b60] px-4 py-3 text-sm font-medium text-white">
            {timer.status === 'paused' ? '继续' : timer.status === 'completed' ? '再做一次' : '开始'}
          </button>
        )}
        <button type="button" onClick={() => timer.reset(movement.durationSeconds)} className="rounded-xl border border-[#d4cec4] bg-white px-4 py-3 text-sm text-[#69645c]">重置</button>
      </div>
      <p className="mt-2 text-center text-xs text-[#878178]" role="status" aria-live="polite">{countdownStatusLabel(timer.status)}</p>
      </div>
    </section>
  )
}

type CountdownController = {
  remainingSeconds: number
  status: CountdownStatus
  start: () => void
  pause: () => void
  reset: (durationSeconds?: number) => void
}

function useCountdown(initialDurationSeconds: number, onFinish: () => void): CountdownController {
  const [durationSeconds, setDurationSeconds] = useState(initialDurationSeconds)
  const [remainingSeconds, setRemainingSeconds] = useState(initialDurationSeconds)
  const [status, setStatus] = useState<CountdownStatus>('idle')
  const deadlineRef = useRef<number | null>(null)
  const notifiedRef = useRef(false)
  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish

  useEffect(() => {
    if (status !== 'running') return

    const tick = () => {
      const deadline = deadlineRef.current
      if (deadline === null) return
      const nextRemaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setRemainingSeconds(nextRemaining)
      if (nextRemaining > 0) return
      deadlineRef.current = null
      setStatus('completed')
      if (notifiedRef.current) return
      notifiedRef.current = true
      onFinishRef.current()
    }

    tick()
    const interval = window.setInterval(tick, 250)
    return () => window.clearInterval(interval)
  }, [status])

  const start = () => {
    const nextRemaining = status === 'completed' || remainingSeconds <= 0
      ? durationSeconds
      : remainingSeconds
    notifiedRef.current = false
    setRemainingSeconds(nextRemaining)
    deadlineRef.current = Date.now() + nextRemaining * 1000
    setStatus('running')
  }

  const pause = () => {
    if (status !== 'running') return
    const deadline = deadlineRef.current
    const nextRemaining = deadline === null
      ? remainingSeconds
      : Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    deadlineRef.current = null
    setRemainingSeconds(nextRemaining)
    setStatus(nextRemaining > 0 ? 'paused' : 'completed')
  }

  const reset = (nextDurationSeconds = durationSeconds) => {
    const safeDuration = Math.max(1, Math.floor(nextDurationSeconds))
    deadlineRef.current = null
    notifiedRef.current = false
    setDurationSeconds(safeDuration)
    setRemainingSeconds(safeDuration)
    setStatus('idle')
  }

  return { remainingSeconds, status, start, pause, reset }
}

function countdownStatusLabel(status: CountdownStatus) {
  if (status === 'running') return '正在计时，只关注眼前这一小段。'
  if (status === 'paused') return '已暂停，准备好再继续。'
  if (status === 'completed') return '这一轮已完成，可以到此为止。'
  return '还没开始。'
}
