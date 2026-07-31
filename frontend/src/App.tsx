import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  calculateCycle,
  createAgentSession,
  sendAgentMessage,
  type CycleResult,
  type CycleSettings,
  type DailyCheckIn,
} from './lib/api'
import { BreathingPage } from './features/breathing'

type View = 'chat' | 'cycle' | 'breathing'
type Message = { id: string; role: 'user' | 'assistant'; content: string; intent?: string; action?: string }

const STORAGE_KEY = 'lutealark.cycle-settings.v1'
const DAILY_CHECKINS_STORAGE_KEY = 'lutealark.daily-checkins.v1'
const LEGACY_DAILY_CHECKIN_STORAGE_KEY = 'lutealark.daily-checkin.v1'
const quickPrompts = [
  { emoji: '🌱', label: '帮我开始', text: '事情有点多，我完全不知道该从哪里开始。' },
  { emoji: '🌙', label: '了解周期', text: '为什么经期前几天注意力会变差？' },
  { emoji: '🫧', label: '稳住情绪', text: '我现在有点乱，想先让情绪慢慢稳下来。' },
]

function App() {
  const [view, setView] = useState<View>('chat')
  const [sessionCode, setSessionCode] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isConnecting, setIsConnecting] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')
  const [cycleSettings, setCycleSettings] = useState<CycleSettings | null>(loadCycleSettings)
  const [cycleResult, setCycleResult] = useState<CycleResult | null>(null)
  const [dailyCheckins, setDailyCheckins] = useState<DailyCheckIn[]>(loadDailyCheckins)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    createAgentSession()
      .then((code) => active && setSessionCode(code))
      .catch((cause: unknown) => active && setError(getErrorMessage(cause)))
      .finally(() => active && setIsConnecting(false))
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!cycleSettings) return
    calculateCycle(cycleSettings)
      .then(setCycleResult)
      .catch((cause: unknown) => setError(getErrorMessage(cause)))
  }, [cycleSettings])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  const submitMessage = async (text: string) => {
    const message = text.trim()
    if (!message || isSending) return
    setInput('')
    setError('')
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: message }])
    setIsSending(true)
    try {
      const code = sessionCode || await createAgentSession()
      if (!sessionCode) setSessionCode(code)
      const reply = await sendAgentMessage(
        code,
        message,
        cycleSettings ?? undefined,
        dailyCheckins.find((checkin) => checkin.date === todayString()),
        dailyCheckins.filter((checkin) => checkin.shareWithChat),
      )
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply.content,
        intent: typeof reply.metadata.intent === 'string' ? reply.metadata.intent : undefined,
        action: typeof reply.metadata.action === 'string' ? reply.metadata.action : undefined,
      }])
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setIsSending(false)
    }
  }

  const startNewConversation = async () => {
    if (isSending) return
    setMessages([])
    setSessionCode('')
    setError('')
    setIsConnecting(true)
    try { setSessionCode(await createAgentSession(true)) }
    catch (cause) { setError(getErrorMessage(cause)) }
    finally { setIsConnecting(false) }
  }

  const saveCycle = async (settings: CycleSettings) => {
    const result = await calculateCycle(settings)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    setCycleSettings(settings)
    setCycleResult(result)
    setError('')
  }

  const saveDailyCheckin = (checkin: DailyCheckIn) => {
    setDailyCheckins((current) => {
      const next = [checkin, ...current.filter((item) => item.date !== checkin.date)]
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, 30)
      localStorage.setItem(DAILY_CHECKINS_STORAGE_KEY, JSON.stringify(next))
      localStorage.removeItem(LEGACY_DAILY_CHECKIN_STORAGE_KEY)
      return next
    })
  }

  return (
    <div className="h-dvh overflow-hidden bg-[#f4f0e8] text-[#34322f] md:p-3">
      <div className="mx-auto flex h-full max-w-[1480px] overflow-hidden bg-[#fbfaf7] shadow-[0_24px_80px_rgba(70,60,45,0.12)] md:rounded-[24px]">
        <Sidebar view={view} setView={setView} cycleResult={cycleResult} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Header
            view={view}
            isConnecting={isConnecting}
            error={error}
            onNewConversation={startNewConversation}
          />
          {view === 'chat' ? (
            <ChatView
              messages={messages}
              input={input}
              setInput={setInput}
              isSending={isSending}
              isConnecting={isConnecting}
              error={error}
              clearError={() => setError('')}
              submitMessage={submitMessage}
              onStartBreathing={() => setView('breathing')}
              cycleResult={cycleResult}
              dailyCheckin={dailyCheckins.find((checkin) => checkin.date === todayString()) ?? null}
              endRef={endRef}
            />
          ) : view === 'cycle' ? (
            <CycleView
              settings={cycleSettings}
              result={cycleResult}
              onSave={saveCycle}
              dailyCheckins={dailyCheckins}
              onSaveDailyCheckin={saveDailyCheckin}
              onBack={() => setView('chat')}
            />
          ) : (
            <BreathingPage
              cycleResult={cycleResult}
              onBack={() => setView('chat')}
            />
          )}
          <MobileNav view={view} setView={setView} />
        </main>
      </div>
    </div>
  )
}

function Sidebar({ view, setView, cycleResult }: { view: View; setView: (view: View) => void; cycleResult: CycleResult | null }) {
  return (
    <aside className="hidden w-[200px] shrink-0 flex-col border-r border-[#ded8ce] bg-[#eee9df]/80 p-4 md:flex">
      <div className="flex items-center gap-3 px-2 py-2">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-[#6d7d62] text-lg text-white">🕊️</div>
        <div><div className="font-serif text-[20px] font-semibold text-[#2f352c]">Lutealark</div><div className="text-[10px] tracking-[0.12em] text-[#858076]">温柔缓冲站</div></div>
      </div>
      <nav className="mt-6 space-y-2" aria-label="主要导航">
        <NavButton active={view === 'chat'} onClick={() => setView('chat')} icon="◌" label="聊一聊" />
        <NavButton active={view === 'cycle'} onClick={() => setView('cycle')} icon="↻" label="周期状态" badge={cycleResult ? `第 ${cycleResult.dayOfCycle} 天` : '待设置'} />
        <NavButton active={view === 'breathing'} onClick={() => setView('breathing')} icon="♧" label="呼吸空间" />
      </nav>
      <div className="sidebar-note mt-auto rounded-[18px] border border-white/70 bg-white/55 p-3 text-xs leading-5 text-[#716c64]">
        <div className="mb-1 text-base">🌿</div><p>不需要一次解决所有事。今天轻一点，也算前进。</p>
      </div>
    </aside>
  )
}

function Header({ view, isConnecting, error, onNewConversation }: { view: View; isConnecting: boolean; error: string; onNewConversation: () => Promise<void> }) {
  const title = view === 'chat'
    ? '今天，想从哪里开始？'
    : view === 'cycle'
      ? '你的周期节奏'
      : '给自己几分钟呼吸'
  return (
    <header className="flex h-[62px] shrink-0 items-center justify-between border-b border-[#e6e0d7] bg-[#fbfaf7]/90 px-5 md:px-7">
      <div>
        <h1 className="font-serif text-lg font-semibold text-[#343b31] md:text-xl">{title}</h1>
        <div className="mt-1 flex items-center gap-2 text-xs text-[#8a847b]"><span className={`h-2 w-2 rounded-full ${error ? 'bg-[#bd755f]' : isConnecting ? 'animate-pulse bg-[#c7a85a]' : 'bg-[#7d956f]'}`} />{error ? '连接需要检查' : isConnecting ? '正在连接缓冲站' : 'Lutealark 已准备好'}</div>
      </div>
      {view === 'chat' && <button type="button" onClick={() => void onNewConversation()} className="rounded-full border border-[#d8d1c6] bg-white/70 px-4 py-2 text-sm text-[#656159] hover:bg-white">＋ 新对话</button>}
    </header>
  )
}

function ChatView(props: {
  messages: Message[]; input: string; setInput: (value: string) => void; isSending: boolean; isConnecting: boolean; error: string; clearError: () => void
  submitMessage: (text: string) => Promise<void>; onStartBreathing: () => void; cycleResult: CycleResult | null; dailyCheckin: DailyCheckIn | null; endRef: React.RefObject<HTMLDivElement | null>
}) {
  const handleSubmit = (event: FormEvent) => { event.preventDefault(); void props.submitMessage(props.input) }
  return (
    <section className="soft-grid relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className={`scrollbar mx-auto w-full max-w-4xl flex-1 px-5 py-4 md:px-8 ${props.messages.length === 0 ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {props.cycleResult && <CycleStrip result={props.cycleResult} checkin={props.dailyCheckin} />}
        {props.messages.length === 0 ? <Welcome onPrompt={props.submitMessage} disabled={props.isSending || props.isConnecting} /> : (
          <div className="space-y-7">{props.messages.map((message) => <MessageBubble key={message.id} message={message} onStartBreathing={props.onStartBreathing} />)}{props.isSending && <TypingBubble />}</div>
        )}
        <div ref={props.endRef} />
      </div>
      <div className="shrink-0 bg-gradient-to-t from-[#fbfaf7] via-[#fbfaf7] to-transparent px-4 pb-3 pt-4 md:px-8">
        <form onSubmit={handleSubmit} className="mx-auto max-w-4xl">
          {props.error && <div className="mb-3 flex justify-between rounded-2xl border border-[#e2b7a8] bg-[#fff5f0] px-4 py-3 text-sm text-[#8a5140]"><span>{props.error}</span><button type="button" onClick={props.clearError}>关闭</button></div>}
          <div className="flex items-end gap-3 rounded-[20px] border border-[#d8d2c8] bg-white p-2 pl-4 shadow-[0_12px_40px_rgba(70,60,45,0.10)] focus-within:border-[#91a087]">
            <textarea value={props.input} onChange={(event) => props.setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSubmit(event) } }} rows={1} placeholder="把脑海里的事放在这里……" className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2 text-sm outline-none" disabled={props.isSending} />
            <button type="submit" disabled={!props.input.trim() || props.isSending} className="grid h-10 w-10 place-items-center rounded-[15px] bg-[#687b60] text-white disabled:bg-[#c7c6bf]" aria-label="发送">➤</button>
          </div>
          <p className="mt-2 text-center text-[11px] text-[#a09a91]">周期信息仅用于个性化支持，不用于医疗诊断</p>
        </form>
      </div>
    </section>
  )
}

function CycleView({ settings, result, onSave, dailyCheckins, onSaveDailyCheckin, onBack }: { settings: CycleSettings | null; result: CycleResult | null; onSave: (settings: CycleSettings) => Promise<void>; dailyCheckins: DailyCheckIn[]; onSaveDailyCheckin: (checkin: DailyCheckIn) => void; onBack: () => void }) {
  const [date, setDate] = useState(settings?.lastPeriodDate ?? '')
  const [length, setLength] = useState(settings?.cycleLength ?? 28)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setFormError('')
    try { await onSave({ lastPeriodDate: date, cycleLength: length }) }
    catch (cause) { setFormError(getErrorMessage(cause)) }
    finally { setSaving(false) }
  }
  return (
    <section className="soft-grid min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
          <div className="rounded-[24px] border border-[#dfd9cf] bg-white/80 p-5 shadow-[0_14px_45px_rgba(73,66,55,.07)] md:p-6">
            <p className="text-xs font-medium tracking-[.18em] text-[#829078]">CYCLE SETTINGS</p>
            <h2 className="mt-2 font-serif text-2xl font-semibold text-[#353c32]">告诉我你的周期起点</h2>
            <p className="mt-2 text-sm leading-6 text-[#7d776f]">这些设置只保存在当前浏览器中。聊天时，后端会重新计算周期状态，而不是相信前端传入的能量值。</p>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block"><span className="mb-2 block text-sm font-medium">末次月经开始日期</span><input type="date" required max={todayString()} value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-2xl border border-[#d9d2c8] bg-[#fbfaf7] px-4 py-3 outline-none focus:border-[#87997d]" /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium">平均周期长度：{length} 天</span><input type="range" min="21" max="35" value={length} onChange={(event) => setLength(Number(event.target.value))} className="w-full accent-[#687b60]" /><div className="mt-1 flex justify-between text-xs text-[#9a948b]"><span>21 天</span><span>35 天</span></div></label>
              {formError && <p className="rounded-xl bg-[#fff1ec] p-3 text-sm text-[#955842]">{formError}</p>}
              <button disabled={saving} className="w-full rounded-2xl bg-[#687b60] px-5 py-3.5 font-medium text-white hover:bg-[#586c51] disabled:opacity-60">{saving ? '正在计算…' : '保存并计算周期'}</button>
            </form>
          </div>
          <div>{result ? <CycleCard result={result} /> : <div className="grid min-h-[300px] place-items-center rounded-[24px] border border-dashed border-[#ccc5ba] bg-white/40 p-6 text-center text-[#8c867d]"><div><div className="text-4xl">🌙</div><p className="mt-3 font-serif text-lg text-[#555b50]">设置后会在这里看到周期状态</p><p className="mt-2 text-sm">你可以随时修改，不需要追求绝对准确。</p></div></div>}</div>
        </div>
        <DailyCheckinCard checkin={dailyCheckins.find((checkin) => checkin.date === todayString()) ?? null} onSave={onSaveDailyCheckin} />
        <CheckinInsights checkins={dailyCheckins} />
        <CheckinHistory checkins={dailyCheckins} />
        {result && <button type="button" onClick={onBack} className="mt-4 rounded-full border border-[#cfc8bd] bg-white/70 px-5 py-2 text-sm text-[#596254]">带着这个状态去聊天 →</button>}
      </div>
    </section>
  )
}

function DailyCheckinCard({ checkin, onSave }: { checkin: DailyCheckIn | null; onSave: (checkin: DailyCheckIn) => void }) {
  const today = todayString()
  const existing = checkin?.date === today ? checkin : null
  const [energy, setEnergy] = useState<DailyCheckIn['energy']>(existing?.energy ?? 3)
  const [mood, setMood] = useState<DailyCheckIn['mood']>(existing?.mood ?? 'calm')
  const [bodyState, setBodyState] = useState<string[]>(existing?.bodyState ?? [])
  const [note, setNote] = useState(existing?.note ?? '')
  const [shareWithChat, setShareWithChat] = useState(existing?.shareWithChat ?? true)

  const toggleBodyState = (value: string) => {
    setBodyState((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  }

  const save = () => onSave({ date: today, energy, mood, bodyState, note: note.trim() || undefined, shareWithChat })

  return <section className="mt-6 rounded-[24px] border border-[#dfd9cf] bg-white/80 p-5 shadow-[0_14px_45px_rgba(73,66,55,.07)] md:p-6">
    <p className="text-xs font-medium tracking-[.18em] text-[#829078]">TODAY'S CHECK-IN</p>
    <h2 className="mt-2 font-serif text-2xl font-semibold text-[#353c32]">今天的状态</h2>
    <p className="mt-2 text-sm leading-6 text-[#7d776f]">只记录一点此刻的感受。你可以选择是否让聊天助手使用它。</p>
    <div className="mt-5 space-y-5">
      <div><p className="mb-2 text-sm font-medium">此刻能量如何？</p><div className="grid grid-cols-5 gap-2">{([1, 2, 3, 4, 5] as const).map((value) => <button key={value} type="button" onClick={() => setEnergy(value)} className={`rounded-xl border px-2 py-2 text-sm ${energy === value ? 'border-[#687b60] bg-[#e8eee3] text-[#405039]' : 'border-[#ddd7cd] bg-white text-[#7d776f]'}`}>{value}</button>)}</div><p className="mt-1 text-xs text-[#999188]">1 很低 · 5 很足</p></div>
      <div><p className="mb-2 text-sm font-medium">情绪更接近哪一种？</p><div className="flex flex-wrap gap-2">{(['calm', 'anxious', 'low', 'irritable', 'overwhelmed'] as const).map((value) => <button key={value} type="button" onClick={() => setMood(value)} className={`rounded-full border px-3 py-1.5 text-sm ${mood === value ? 'border-[#687b60] bg-[#e8eee3] text-[#405039]' : 'border-[#ddd7cd] bg-white text-[#7d776f]'}`}>{moodLabel(value)}</button>)}</div></div>
      <div><p className="mb-2 text-sm font-medium">身体或感受（可选）</p><div className="flex flex-wrap gap-2">{['疲惫', '睡不好', '疼痛', '注意力飘'].map((value) => <button key={value} type="button" onClick={() => toggleBodyState(value)} className={`rounded-full border px-3 py-1.5 text-sm ${bodyState.includes(value) ? 'border-[#687b60] bg-[#e8eee3] text-[#405039]' : 'border-[#ddd7cd] bg-white text-[#7d776f]'}`}>{value}</button>)}</div></div>
      <label className="block"><span className="mb-2 block text-sm font-medium">想留一句话吗？（可选）</span><textarea value={note} maxLength={200} rows={3} onChange={(event) => setNote(event.target.value)} placeholder="例如：论文没开始，脑子停不下来。" className="w-full resize-none rounded-2xl border border-[#d9d2c8] bg-[#fbfaf7] px-4 py-3 text-sm outline-none focus:border-[#87997d]" /></label>
      <label className="flex items-center gap-2 text-sm text-[#656159]"><input type="checkbox" checked={shareWithChat} onChange={(event) => setShareWithChat(event.target.checked)} className="accent-[#687b60]" />聊天时让 Lutealark 参考今天的状态</label>
      <button type="button" onClick={save} className="rounded-2xl bg-[#687b60] px-5 py-3 text-sm font-medium text-white hover:bg-[#586c51]">{existing ? '更新今天的状态' : '保存今天的状态'}</button>
    </div>
  </section>
}

function CheckinHistory({ checkins }: { checkins: DailyCheckIn[] }) {
  const recent = checkinsWithinLastDays(checkins, 7)
  if (recent.length === 0) return null

  return <section className="mt-6 rounded-[24px] border border-[#dfd9cf] bg-white/80 p-5 shadow-[0_14px_45px_rgba(73,66,55,.07)] md:p-6">
    <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-medium tracking-[.18em] text-[#829078]">RECENT CHECK-INS</p><h2 className="mt-2 font-serif text-2xl font-semibold text-[#353c32]">最近 7 天</h2></div><p className="text-xs text-[#8b847b]">本地保存 · 最多 30 天</p></div>
    <div className="mt-5 space-y-2">
      {recent.map((checkin) => <div key={checkin.date} className="flex items-center gap-3 rounded-2xl border border-[#e7e1d8] bg-[#fbfaf7] px-4 py-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${moodDotClass(checkin.mood)}`} aria-hidden="true" />
        <span className="w-10 shrink-0 text-sm text-[#79736a]">{formatShortDate(checkin.date)}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${moodTagClass(checkin.mood)}`}>{moodLabel(checkin.mood)}</span>
        <span className="ml-auto shrink-0 text-xs text-[#6f6a62]">能量 {checkin.energy}/5</span>
        {checkin.bodyState.length > 0 && <span className="hidden text-xs text-[#938c82] sm:inline">{checkin.bodyState.join(' · ')}</span>}
      </div>)}
    </div>
  </section>
}

function CheckinInsights({ checkins }: { checkins: DailyCheckIn[] }) {
  const recent = checkinsWithinLastDays(checkins, 7)
  if (recent.length < 3) return null

  const insights: string[] = []
  const lowEnergyDays = recent.filter((checkin) => checkin.energy <= 2).length
  if (lowEnergyDays >= 3) {
    insights.push(`最近 7 天中，你有 ${lowEnergyDays} 天记录了低能量。`)
  }

  const moodCounts = recent.reduce<Record<DailyCheckIn['mood'], number>>(
    (counts, checkin) => ({ ...counts, [checkin.mood]: counts[checkin.mood] + 1 }),
    { calm: 0, anxious: 0, low: 0, irritable: 0, overwhelmed: 0 },
  )
  const mostFrequentMood = (Object.keys(moodCounts) as DailyCheckIn['mood'][])
    .sort((left, right) => moodCounts[right] - moodCounts[left])[0]
  if (mostFrequentMood && moodCounts[mostFrequentMood] >= 3) {
    insights.push(`最近 7 天里，“${moodLabel(mostFrequentMood)}”出现了 ${moodCounts[mostFrequentMood]} 次。`)
  }

  if (insights.length === 0) return null

  return <section className="mt-6 rounded-[24px] border border-[#d8dfd2] bg-[#f4f7f1] p-5 md:p-6">
    <p className="text-xs font-medium tracking-[.18em] text-[#728467]">GENTLE OBSERVATION</p>
    <h2 className="mt-2 font-serif text-2xl font-semibold text-[#42503c]">最近观察到</h2>
    <div className="mt-4 space-y-2 text-sm leading-6 text-[#5d6a56]">{insights.slice(0, 2).map((insight) => <p key={insight} className="rounded-2xl bg-white/65 px-4 py-3">{insight}</p>)}</div>
    <p className="mt-3 text-xs leading-5 text-[#7d8877]">这只是你在当前浏览器中留下的记录趋势，不代表诊断。</p>
  </section>
}

function CycleCard({ result }: { result: CycleResult }) {
  const progress = Math.min(100, Math.max(3, (result.dayOfCycle / (result.dayOfCycle + result.daysToNextPeriod - 1)) * 100))
  return <div className="overflow-hidden rounded-[24px] bg-[#66765f] p-5 text-white shadow-[0_18px_50px_rgba(66,84,60,.2)] md:p-6"><p className="text-xs tracking-[.18em] text-white/60">TODAY'S RHYTHM</p><div className="mt-4 flex items-end justify-between"><div><p className="text-sm text-white/70">当前阶段</p><h3 className="mt-1 font-serif text-2xl font-semibold">{result.phaseName}</h3></div><div className="text-right"><p className="text-2xl font-semibold">{result.energyValue}</p><p className="text-xs text-white/60">基础能量 / 10</p></div></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#e9dbc0]" style={{ width: `${progress}%` }} /></div><div className="mt-3 flex justify-between text-xs text-white/65"><span>周期第 {result.dayOfCycle} 天</span><span>约 {result.daysToNextPeriod} 天后进入下一周期</span></div><div className="mt-5 rounded-[18px] bg-white/10 p-4"><p className="font-medium">{result.isBufferMode ? '缓冲模式已开启' : '常规支持模式'}</p><p className="mt-1 text-sm leading-6 text-white/70">{result.isBufferMode ? '今天的建议会更轻、更短，并允许随时停下。' : '仍然以可持续和低压力的下一步为优先。'}</p></div></div>
}

function CycleStrip({ result, checkin }: { result: CycleResult; checkin: DailyCheckIn | null }) {
  const todayCheckin = checkin?.date === todayString() ? checkin : null
  return <div className="mb-3 flex items-center justify-between rounded-xl border border-[#d8dfd2] bg-[#f4f7f1] px-4 py-2 text-xs text-[#596653]"><span>🌙 {result.phaseName} · 周期第 {result.dayOfCycle} 天</span><span className="text-[11px]">{todayCheckin ? `自评能量 ${todayCheckin.energy}/5 · ${moodLabel(todayCheckin.mood)}` : `能量 ${result.energyValue}/10`}{result.isBufferMode ? ' · 缓冲模式' : ''}</span></div>
}

function Welcome({ onPrompt, disabled }: { onPrompt: (text: string) => Promise<void>; disabled: boolean }) {
  return <div className="welcome-shell mx-auto flex h-full min-h-0 max-w-2xl flex-col justify-center text-center"><div className="welcome-mark mx-auto mb-3 grid h-14 w-14 place-items-center rounded-[20px] bg-[#e2e8dc] text-xl">🕊️</div><p className="welcome-kicker text-[10px] tracking-[.2em] text-[#829078]">WELCOME BACK</p><h2 className="mt-2 font-serif text-[30px] font-semibold leading-tight text-[#353c32]">不用整理好，<br />也可以从这里说起。</h2><p className="welcome-description mx-auto mt-2 max-w-lg text-xs leading-5 text-[#7d776f]">我会结合你愿意提供的周期节奏，把下一步变轻一点。</p><div className="welcome-actions mt-4 grid gap-2 text-left sm:grid-cols-3">{quickPrompts.map((prompt) => <button key={prompt.label} disabled={disabled} onClick={() => void onPrompt(prompt.text)} className="rounded-[16px] border border-[#ddd7cd] bg-white/75 p-3 hover:border-[#aebba5] disabled:opacity-60"><span className="text-base">{prompt.emoji}</span><span className="mt-1.5 block text-xs font-medium">{prompt.label}</span><span className="mt-1 block text-[11px] text-[#969087]">轻轻点一下就可以开始</span></button>)}</div></div>
}

function MessageBubble({ message, onStartBreathing }: { message: Message; onStartBreathing: () => void }) {
  if (message.role === 'user') {
    return <div className="flex justify-end pl-10"><div className="max-w-[82%] rounded-[22px] rounded-br-md bg-[#66765f] px-5 py-3.5 text-[15px] leading-7 text-white">{message.content}</div></div>
  }

  return (
    <div className="flex items-start gap-3 pr-4 md:pr-12">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[14px] bg-[#dfe7d9]">♩</div>
      <div>
        <div className="whitespace-pre-wrap rounded-[22px] rounded-tl-md border border-[#e0dbd2] bg-white/85 px-5 py-4 text-[15px] leading-7 text-[#4e4a44]">{message.content}</div>
        {message.action === 'open_breathing' && (
          <button
            type="button"
            onClick={onStartBreathing}
            className="mt-3 rounded-full bg-[#687b60] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#596c52]"
          >
            开始呼吸训练
          </button>
        )}
      </div>
    </div>
  )
}

function TypingBubble() { return <div className="flex gap-3"><div className="grid h-9 w-9 place-items-center rounded-[14px] bg-[#dfe7d9]">♩</div><div className="flex h-12 items-center gap-1.5 rounded-[20px] bg-white px-5">{[0, 1, 2].map((i) => <span key={i} style={{ animationDelay: `${i * 140}ms` }} className="typing-dot h-1.5 w-1.5 rounded-full bg-[#84927a]" />)}</div></div> }

function NavButton({ active, onClick, icon, label, badge, disabled }: { active: boolean; onClick: () => void; icon: string; label: string; badge?: string; disabled?: boolean }) { return <button type="button" disabled={disabled} onClick={onClick} className={`flex w-full items-center gap-2 rounded-[14px] px-3 py-2.5 text-xs ${active ? 'bg-white text-[#465341] shadow-sm' : 'text-[#8d877e]'}`}><span className="shrink-0 text-base">{icon}</span><span className="min-w-0 flex-1 whitespace-nowrap text-left">{label}</span>{badge && <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-[#e4dfd5] px-2 py-0.5 text-[9px]">{badge}</span>}</button> }

function MobileNav({ view, setView }: { view: View; setView: (view: View) => void }) {
  return (
    <nav className="grid h-14 grid-cols-3 border-t border-[#ded8ce] bg-[#f5f1e9] md:hidden">
      <button onClick={() => setView('chat')} className={view === 'chat' ? 'text-[#52614d]' : 'text-[#999]'}>
        ◌<span className="block text-[10px]">聊一聊</span>
      </button>
      <button onClick={() => setView('cycle')} className={view === 'cycle' ? 'text-[#52614d]' : 'text-[#999]'}>
        ↻<span className="block text-[10px]">周期</span>
      </button>
      <button onClick={() => setView('breathing')} className={view === 'breathing' ? 'text-[#52614d]' : 'text-[#999]'}>
        ♧<span className="block text-[10px]">呼吸</span>
      </button>
    </nav>
  )
}

function moodLabel(mood: DailyCheckIn['mood']) {
  return ({ calm: '平稳', anxious: '焦虑', low: '低落', irritable: '烦躁', overwhelmed: '很乱' } as const)[mood]
}

function moodDotClass(mood: DailyCheckIn['mood']) {
  return ({ calm: 'bg-[#7d956f]', anxious: 'bg-[#c49a58]', low: 'bg-[#8393a3]', irritable: 'bg-[#c97862]', overwhelmed: 'bg-[#9683a4]' } as const)[mood]
}

function moodTagClass(mood: DailyCheckIn['mood']) {
  return ({ calm: 'bg-[#e6eee1] text-[#506747]', anxious: 'bg-[#f7ecd6] text-[#8d682d]', low: 'bg-[#e5ebf0] text-[#506679]', irritable: 'bg-[#f6e3dd] text-[#91513f]', overwhelmed: 'bg-[#eee7f1] text-[#67566f]' } as const)[mood]
}

function formatShortDate(date: string) {
  const [, month, day] = date.split('-')
  return `${Number(month)}/${Number(day)}`
}

function checkinsWithinLastDays(checkins: DailyCheckIn[], days: number) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  today.setDate(today.getDate() - days + 1)
  const cutoff = formatLocalDate(today)
  return checkins.filter((checkin) => checkin.date >= cutoff && checkin.date <= todayString())
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isValidDailyCheckin(value: unknown): value is DailyCheckIn {
  if (!value || typeof value !== 'object') return false
  const checkin = value as DailyCheckIn
  return typeof checkin.date === 'string'
    && Number.isInteger(checkin.energy)
    && checkin.energy >= 1
    && checkin.energy <= 5
    && ['calm', 'anxious', 'low', 'irritable', 'overwhelmed'].includes(checkin.mood)
    && Array.isArray(checkin.bodyState)
    && typeof checkin.shareWithChat === 'boolean'
}

function loadDailyCheckins(): DailyCheckIn[] {
  try {
    const historyValue = localStorage.getItem(DAILY_CHECKINS_STORAGE_KEY)
    if (historyValue) {
      const parsed = JSON.parse(historyValue) as unknown
      if (Array.isArray(parsed)) {
        return parsed.filter(isValidDailyCheckin)
          .sort((left, right) => right.date.localeCompare(left.date))
          .slice(0, 30)
      }
    }

    const legacyValue = localStorage.getItem(LEGACY_DAILY_CHECKIN_STORAGE_KEY)
    if (!legacyValue) return []
    const legacy = JSON.parse(legacyValue) as unknown
    return isValidDailyCheckin(legacy) ? [legacy] : []
  } catch { return [] }
}

function loadCycleSettings(): CycleSettings | null { try { const value = localStorage.getItem(STORAGE_KEY); if (!value) return null; const parsed = JSON.parse(value) as CycleSettings; return typeof parsed.lastPeriodDate === 'string' && Number.isInteger(parsed.cycleLength) ? parsed : null } catch { return null } }
function todayString() { const now = new Date(); const offset = now.getTimezoneOffset() * 60_000; return new Date(now.getTime() - offset).toISOString().slice(0, 10) }
function getErrorMessage(cause: unknown) { return cause instanceof Error ? cause.message : '暂时没有连接成功，请稍后再试。' }

export default App
