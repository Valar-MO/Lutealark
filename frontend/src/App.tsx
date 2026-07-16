import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  calculateCycle,
  createAgentSession,
  sendAgentMessage,
  type CycleResult,
  type CycleSettings,
} from './lib/api'

type View = 'chat' | 'cycle'
type Message = { id: string; role: 'user' | 'assistant'; content: string; intent?: string }

const STORAGE_KEY = 'lutealark.cycle-settings.v1'
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
      const reply = await sendAgentMessage(code, message, cycleSettings ?? undefined)
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply.content,
        intent: typeof reply.metadata.intent === 'string' ? reply.metadata.intent : undefined,
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

  return (
    <div className="min-h-screen bg-[#f4f0e8] text-[#34322f] lg:p-4">
      <div className="mx-auto flex min-h-screen max-w-[1480px] overflow-hidden bg-[#fbfaf7] shadow-[0_24px_80px_rgba(70,60,45,0.12)] lg:min-h-[calc(100vh-2rem)] lg:rounded-[30px]">
        <Sidebar view={view} setView={setView} cycleResult={cycleResult} />
        <main className="flex min-w-0 flex-1 flex-col">
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
              cycleResult={cycleResult}
              endRef={endRef}
            />
          ) : (
            <CycleView
              settings={cycleSettings}
              result={cycleResult}
              onSave={saveCycle}
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
    <aside className="hidden w-[270px] shrink-0 flex-col border-r border-[#ded8ce] bg-[#eee9df]/80 p-6 lg:flex">
      <div className="flex items-center gap-3 px-2 py-2">
        <div className="grid h-11 w-11 place-items-center rounded-[16px] bg-[#6d7d62] text-xl text-white">♩</div>
        <div><div className="font-serif text-[22px] font-semibold text-[#2f352c]">Lutealark</div><div className="text-[11px] tracking-[0.14em] text-[#858076]">温柔缓冲站</div></div>
      </div>
      <nav className="mt-10 space-y-2" aria-label="主要导航">
        <NavButton active={view === 'chat'} onClick={() => setView('chat')} icon="◌" label="聊一聊" />
        <NavButton active={view === 'cycle'} onClick={() => setView('cycle')} icon="↻" label="周期状态" badge={cycleResult ? `第 ${cycleResult.dayOfCycle} 天` : '待设置'} />
        <NavButton active={false} onClick={() => undefined} icon="♧" label="呼吸空间" badge="稍后" disabled />
      </nav>
      <div className="mt-auto rounded-[22px] border border-white/70 bg-white/55 p-4 text-sm leading-6 text-[#716c64]">
        <div className="mb-2 text-lg">🌿</div><p>不需要一次解决所有事。</p><p className="text-[#989188]">今天先轻一点，也算前进。</p>
      </div>
    </aside>
  )
}

function Header({ view, isConnecting, error, onNewConversation }: { view: View; isConnecting: boolean; error: string; onNewConversation: () => Promise<void> }) {
  return (
    <header className="flex h-[78px] shrink-0 items-center justify-between border-b border-[#e6e0d7] bg-[#fbfaf7]/90 px-5 md:px-8">
      <div>
        <h1 className="font-serif text-xl font-semibold text-[#343b31] md:text-2xl">{view === 'chat' ? '今天，想从哪里开始？' : '你的周期节奏'}</h1>
        <div className="mt-1 flex items-center gap-2 text-xs text-[#8a847b]"><span className={`h-2 w-2 rounded-full ${error ? 'bg-[#bd755f]' : isConnecting ? 'animate-pulse bg-[#c7a85a]' : 'bg-[#7d956f]'}`} />{error ? '连接需要检查' : isConnecting ? '正在连接缓冲站' : 'Lutealark 已准备好'}</div>
      </div>
      {view === 'chat' && <button type="button" onClick={() => void onNewConversation()} className="rounded-full border border-[#d8d1c6] bg-white/70 px-4 py-2 text-sm text-[#656159] hover:bg-white">＋ 新对话</button>}
    </header>
  )
}

function ChatView(props: {
  messages: Message[]; input: string; setInput: (value: string) => void; isSending: boolean; isConnecting: boolean; error: string; clearError: () => void
  submitMessage: (text: string) => Promise<void>; cycleResult: CycleResult | null; endRef: React.RefObject<HTMLDivElement | null>
}) {
  const handleSubmit = (event: FormEvent) => { event.preventDefault(); void props.submitMessage(props.input) }
  return (
    <section className="soft-grid relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="scrollbar mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-5 py-8 md:px-10">
        {props.cycleResult && <CycleStrip result={props.cycleResult} />}
        {props.messages.length === 0 ? <Welcome onPrompt={props.submitMessage} disabled={props.isSending || props.isConnecting} /> : (
          <div className="space-y-7">{props.messages.map((message) => <MessageBubble key={message.id} message={message} />)}{props.isSending && <TypingBubble />}</div>
        )}
        <div ref={props.endRef} />
      </div>
      <div className="shrink-0 bg-gradient-to-t from-[#fbfaf7] via-[#fbfaf7] to-transparent px-4 pb-5 pt-8 md:px-8">
        <form onSubmit={handleSubmit} className="mx-auto max-w-4xl">
          {props.error && <div className="mb-3 flex justify-between rounded-2xl border border-[#e2b7a8] bg-[#fff5f0] px-4 py-3 text-sm text-[#8a5140]"><span>{props.error}</span><button type="button" onClick={props.clearError}>关闭</button></div>}
          <div className="flex items-end gap-3 rounded-[24px] border border-[#d8d2c8] bg-white p-2.5 pl-5 shadow-[0_12px_40px_rgba(70,60,45,0.10)] focus-within:border-[#91a087]">
            <textarea value={props.input} onChange={(event) => props.setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSubmit(event) } }} rows={1} placeholder="把脑海里的事放在这里……" className="max-h-36 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none" disabled={props.isSending} />
            <button type="submit" disabled={!props.input.trim() || props.isSending} className="grid h-11 w-11 place-items-center rounded-[17px] bg-[#687b60] text-white disabled:bg-[#c7c6bf]" aria-label="发送">➤</button>
          </div>
          <p className="mt-2 text-center text-[11px] text-[#a09a91]">周期信息仅用于个性化支持，不用于医疗诊断</p>
        </form>
      </div>
    </section>
  )
}

function CycleView({ settings, result, onSave, onBack }: { settings: CycleSettings | null; result: CycleResult | null; onSave: (settings: CycleSettings) => Promise<void>; onBack: () => void }) {
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
    <section className="soft-grid min-h-0 flex-1 overflow-y-auto px-5 py-8 md:px-10">
      <div className="mx-auto max-w-4xl">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
          <div className="rounded-[28px] border border-[#dfd9cf] bg-white/80 p-6 shadow-[0_14px_45px_rgba(73,66,55,.07)] md:p-8">
            <p className="text-xs font-medium tracking-[.18em] text-[#829078]">CYCLE SETTINGS</p>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-[#353c32]">告诉我你的周期起点</h2>
            <p className="mt-3 text-sm leading-6 text-[#7d776f]">这些设置只保存在当前浏览器中。聊天时，后端会重新计算周期状态，而不是相信前端传入的能量值。</p>
            <form onSubmit={submit} className="mt-8 space-y-5">
              <label className="block"><span className="mb-2 block text-sm font-medium">末次月经开始日期</span><input type="date" required max={todayString()} value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-2xl border border-[#d9d2c8] bg-[#fbfaf7] px-4 py-3 outline-none focus:border-[#87997d]" /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium">平均周期长度：{length} 天</span><input type="range" min="21" max="35" value={length} onChange={(event) => setLength(Number(event.target.value))} className="w-full accent-[#687b60]" /><div className="mt-1 flex justify-between text-xs text-[#9a948b]"><span>21 天</span><span>35 天</span></div></label>
              {formError && <p className="rounded-xl bg-[#fff1ec] p-3 text-sm text-[#955842]">{formError}</p>}
              <button disabled={saving} className="w-full rounded-2xl bg-[#687b60] px-5 py-3.5 font-medium text-white hover:bg-[#586c51] disabled:opacity-60">{saving ? '正在计算…' : '保存并计算周期'}</button>
            </form>
          </div>
          <div>{result ? <CycleCard result={result} /> : <div className="grid min-h-[360px] place-items-center rounded-[28px] border border-dashed border-[#ccc5ba] bg-white/40 p-8 text-center text-[#8c867d]"><div><div className="text-5xl">🌙</div><p className="mt-4 font-serif text-xl text-[#555b50]">设置后会在这里看到周期状态</p><p className="mt-2 text-sm">你可以随时修改，不需要追求绝对准确。</p></div></div>}</div>
        </div>
        {result && <button type="button" onClick={onBack} className="mt-6 rounded-full border border-[#cfc8bd] bg-white/70 px-5 py-2.5 text-sm text-[#596254]">带着这个状态去聊天 →</button>}
      </div>
    </section>
  )
}

function CycleCard({ result }: { result: CycleResult }) {
  const progress = Math.min(100, Math.max(3, (result.dayOfCycle / (result.dayOfCycle + result.daysToNextPeriod - 1)) * 100))
  return <div className="overflow-hidden rounded-[28px] bg-[#66765f] p-6 text-white shadow-[0_18px_50px_rgba(66,84,60,.2)] md:p-8"><p className="text-xs tracking-[.18em] text-white/60">TODAY'S RHYTHM</p><div className="mt-5 flex items-end justify-between"><div><p className="text-sm text-white/70">当前阶段</p><h3 className="mt-1 font-serif text-3xl font-semibold">{result.phaseName}</h3></div><div className="text-right"><p className="text-3xl font-semibold">{result.energyValue}</p><p className="text-xs text-white/60">基础能量 / 10</p></div></div><div className="mt-7 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#e9dbc0]" style={{ width: `${progress}%` }} /></div><div className="mt-3 flex justify-between text-xs text-white/65"><span>周期第 {result.dayOfCycle} 天</span><span>约 {result.daysToNextPeriod} 天后进入下一周期</span></div><div className="mt-7 rounded-[20px] bg-white/10 p-4"><p className="font-medium">{result.isBufferMode ? '缓冲模式已开启' : '常规支持模式'}</p><p className="mt-1 text-sm leading-6 text-white/70">{result.isBufferMode ? '今天的建议会更轻、更短，并允许随时停下。' : '仍然以可持续和低压力的下一步为优先。'}</p></div></div>
}

function CycleStrip({ result }: { result: CycleResult }) {
  return <div className="mb-6 flex items-center justify-between rounded-2xl border border-[#d8dfd2] bg-[#f4f7f1] px-4 py-3 text-sm text-[#596653]"><span>🌙 {result.phaseName} · 周期第 {result.dayOfCycle} 天</span><span className="text-xs">能量 {result.energyValue}/10{result.isBufferMode ? ' · 缓冲模式' : ''}</span></div>
}

function Welcome({ onPrompt, disabled }: { onPrompt: (text: string) => Promise<void>; disabled: boolean }) {
  return <div className="mx-auto flex min-h-[480px] max-w-2xl flex-col justify-center text-center"><div className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-[28px] bg-[#e2e8dc] text-3xl">🕊️</div><p className="text-xs tracking-[.22em] text-[#829078]">WELCOME BACK</p><h2 className="mt-3 font-serif text-3xl font-semibold text-[#353c32] md:text-[42px]">不用整理好，<br />也可以从这里说起。</h2><p className="mx-auto mt-5 max-w-lg text-[15px] leading-7 text-[#7d776f]">我会结合你愿意提供的周期节奏，把下一步变轻一点。</p><div className="mt-8 grid gap-3 text-left sm:grid-cols-3">{quickPrompts.map((prompt) => <button key={prompt.label} disabled={disabled} onClick={() => void onPrompt(prompt.text)} className="rounded-[20px] border border-[#ddd7cd] bg-white/75 p-4 hover:border-[#aebba5] disabled:opacity-60"><span className="text-xl">{prompt.emoji}</span><span className="mt-3 block text-sm font-medium">{prompt.label}</span><span className="mt-1 block text-xs text-[#969087]">轻轻点一下就可以开始</span></button>)}</div></div>
}

function MessageBubble({ message }: { message: Message }) {
  return message.role === 'user' ? <div className="flex justify-end pl-10"><div className="max-w-[82%] rounded-[22px] rounded-br-md bg-[#66765f] px-5 py-3.5 text-[15px] leading-7 text-white">{message.content}</div></div> : <div className="flex items-start gap-3 pr-4 md:pr-12"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-[14px] bg-[#dfe7d9]">♩</div><div className="whitespace-pre-wrap rounded-[22px] rounded-tl-md border border-[#e0dbd2] bg-white/85 px-5 py-4 text-[15px] leading-7 text-[#4e4a44]">{message.content}</div></div>
}

function TypingBubble() { return <div className="flex gap-3"><div className="grid h-9 w-9 place-items-center rounded-[14px] bg-[#dfe7d9]">♩</div><div className="flex h-12 items-center gap-1.5 rounded-[20px] bg-white px-5">{[0, 1, 2].map((i) => <span key={i} style={{ animationDelay: `${i * 140}ms` }} className="typing-dot h-1.5 w-1.5 rounded-full bg-[#84927a]" />)}</div></div> }

function NavButton({ active, onClick, icon, label, badge, disabled }: { active: boolean; onClick: () => void; icon: string; label: string; badge?: string; disabled?: boolean }) { return <button type="button" disabled={disabled} onClick={onClick} className={`flex w-full items-center gap-3 rounded-[16px] px-4 py-3 text-sm ${active ? 'bg-white text-[#465341] shadow-sm' : 'text-[#8d877e]'}`}><span className="text-lg">{icon}</span><span>{label}</span>{badge && <span className="ml-auto rounded-full bg-[#e4dfd5] px-2 py-0.5 text-[10px]">{badge}</span>}</button> }

function MobileNav({ view, setView }: { view: View; setView: (view: View) => void }) { return <nav className="grid h-16 grid-cols-3 border-t border-[#ded8ce] bg-[#f5f1e9] lg:hidden"><button onClick={() => setView('chat')} className={view === 'chat' ? 'text-[#52614d]' : 'text-[#999]'}>◌<span className="block text-[10px]">聊一聊</span></button><button onClick={() => setView('cycle')} className={view === 'cycle' ? 'text-[#52614d]' : 'text-[#999]'}>↻<span className="block text-[10px]">周期</span></button><button disabled className="text-[#aaa]">♧<span className="block text-[10px]">呼吸</span></button></nav> }

function loadCycleSettings(): CycleSettings | null { try { const value = localStorage.getItem(STORAGE_KEY); if (!value) return null; const parsed = JSON.parse(value) as CycleSettings; return typeof parsed.lastPeriodDate === 'string' && Number.isInteger(parsed.cycleLength) ? parsed : null } catch { return null } }
function todayString() { const now = new Date(); const offset = now.getTimezoneOffset() * 60_000; return new Date(now.getTime() - offset).toISOString().slice(0, 10) }
function getErrorMessage(cause: unknown) { return cause instanceof Error ? cause.message : '暂时没有连接成功，请稍后再试。' }

export default App
