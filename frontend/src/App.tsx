import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createAgentSession, sendAgentMessage } from './lib/api'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  intent?: string
}

const quickPrompts = [
  { emoji: '🌱', label: '帮我开始', text: '事情有点多，我完全不知道该从哪里开始。' },
  { emoji: '🌙', label: '了解周期', text: '为什么经期前几天注意力会变差？' },
  { emoji: '🫧', label: '稳住情绪', text: '我现在有点乱，想先让情绪慢慢稳下来。' },
]

function Icon({ name }: { name: 'chat' | 'cycle' | 'breath' | 'send' | 'plus' }) {
  const paths = {
    chat: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />,
    cycle: <><path d="M20 7h-5V2" /><path d="M20 2v5h-5" /><path d="M20 7a8 8 0 1 0 1.3 8.4" /></>,
    breath: <><path d="M12 5c-1.5-2.6-5-2.7-6.7-.5-2 2.7-.1 6.5 3.2 6.5H12Z" /><path d="M12 5c1.5-2.6 5-2.7 6.7-.5 2 2.7.1 6.5-3.2 6.5H12Z" /><path d="M12 11v10" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function App() {
  const [sessionCode, setSessionCode] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isConnecting, setIsConnecting] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let active = true
    createAgentSession()
      .then((code) => active && setSessionCode(code))
      .catch((cause: unknown) => active && setError(getErrorMessage(cause)))
      .finally(() => active && setIsConnecting(false))
    return () => { active = false }
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  const submitMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isSending) return

    setError('')
    setInput('')
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    }
    setMessages((current) => [...current, userMessage])
    setIsSending(true)

    try {
      const code = sessionCode || await createAgentSession()
      if (!sessionCode) setSessionCode(code)
      const reply = await sendAgentMessage(code, trimmed)
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply.content,
          intent: typeof reply.metadata.intent === 'string' ? reply.metadata.intent : undefined,
        },
      ])
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setIsSending(false)
      textareaRef.current?.focus()
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submitMessage(input)
  }

  const startNewConversation = async () => {
    if (isSending) return
    setError('')
    setMessages([])
    setSessionCode('')
    setIsConnecting(true)
    try {
      setSessionCode(await createAgentSession(true))
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f0e8] text-[#34322f] lg:p-4">
      <div className="mx-auto flex min-h-screen max-w-[1480px] overflow-hidden bg-[#fbfaf7] shadow-[0_24px_80px_rgba(70,60,45,0.12)] lg:min-h-[calc(100vh-2rem)] lg:rounded-[30px]">
        <aside className="hidden w-[270px] shrink-0 flex-col border-r border-[#ded8ce] bg-[#eee9df]/80 p-6 lg:flex">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="grid h-11 w-11 place-items-center rounded-[16px] bg-[#6d7d62] text-xl text-white shadow-[0_8px_20px_rgba(75,94,67,0.24)]">♩</div>
            <div>
              <div className="font-serif text-[22px] font-semibold tracking-[-0.02em] text-[#2f352c]">Lutealark</div>
              <div className="text-[11px] tracking-[0.14em] text-[#858076]">温柔缓冲站</div>
            </div>
          </div>

          <nav className="mt-10 space-y-2" aria-label="主要导航">
            <NavItem icon="chat" label="聊一聊" active />
            <NavItem icon="cycle" label="周期状态" badge="稍后" />
            <NavItem icon="breath" label="呼吸空间" badge="稍后" />
          </nav>

          <div className="mt-auto rounded-[22px] border border-white/70 bg-white/55 p-4 text-sm leading-6 text-[#716c64]">
            <div className="mb-2 text-lg">🌿</div>
            <p>不需要一次解决所有事。</p>
            <p className="text-[#989188]">今天先轻一点，也算前进。</p>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[78px] shrink-0 items-center justify-between border-b border-[#e6e0d7] bg-[#fbfaf7]/90 px-5 backdrop-blur md:px-8">
            <div>
              <h1 className="font-serif text-xl font-semibold text-[#343b31] md:text-2xl">今天，想从哪里开始？</h1>
              <div className="mt-1 flex items-center gap-2 text-xs text-[#8a847b]">
                <span className={`h-2 w-2 rounded-full ${error ? 'bg-[#bd755f]' : isConnecting ? 'animate-pulse bg-[#c7a85a]' : 'bg-[#7d956f]'}`} />
                {error ? '连接需要检查' : isConnecting ? '正在连接缓冲站' : 'Lutealark 已准备好'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void startNewConversation()}
              className="flex h-10 items-center gap-2 rounded-full border border-[#d8d1c6] bg-white/70 px-3.5 text-sm text-[#656159] transition hover:border-[#a8b39f] hover:bg-white"
            >
              <span className="h-4 w-4"><Icon name="plus" /></span>
              <span className="hidden sm:inline">新对话</span>
            </button>
          </header>

          <section className="soft-grid relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="scrollbar mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-5 py-8 md:px-10 md:py-10">
              {messages.length === 0 ? (
                <Welcome onPrompt={submitMessage} disabled={isSending || isConnecting} />
              ) : (
                <div className="space-y-7">
                  {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
                  {isSending && <TypingBubble />}
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="shrink-0 bg-gradient-to-t from-[#fbfaf7] via-[#fbfaf7] to-transparent px-4 pb-4 pt-8 md:px-8 md:pb-7">
              <form onSubmit={handleSubmit} className="mx-auto max-w-4xl">
                {error && (
                  <div className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-[#e2b7a8] bg-[#fff5f0] px-4 py-3 text-sm text-[#8a5140]">
                    <span>{error}</span>
                    <button type="button" className="shrink-0 underline" onClick={() => setError('')}>知道了</button>
                  </div>
                )}
                <div className="flex items-end gap-3 rounded-[24px] border border-[#d8d2c8] bg-white p-2.5 pl-5 shadow-[0_12px_40px_rgba(70,60,45,0.10)] transition focus-within:border-[#91a087] focus-within:shadow-[0_14px_44px_rgba(82,103,73,0.14)]">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        handleSubmit(event)
                      }
                    }}
                    rows={1}
                    maxLength={20_000}
                    placeholder="把脑海里的事放在这里……"
                    className="max-h-36 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-6 text-[#34322f] outline-none placeholder:text-[#aaa49a]"
                    disabled={isSending}
                    aria-label="输入消息"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isSending}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-[17px] bg-[#687b60] text-white shadow-[0_6px_16px_rgba(75,94,67,0.25)] transition hover:bg-[#586c51] disabled:cursor-not-allowed disabled:bg-[#c7c6bf] disabled:shadow-none"
                    aria-label="发送消息"
                  >
                    <span className="h-[18px] w-[18px]"><Icon name="send" /></span>
                  </button>
                </div>
                <p className="mt-2.5 text-center text-[11px] text-[#a09a91]">Enter 发送 · Shift + Enter 换行 · 回复仅作支持与信息参考</p>
              </form>
            </div>
          </section>

          <MobileNav />
        </main>
      </div>
    </div>
  )
}

function Welcome({ onPrompt, disabled }: { onPrompt: (text: string) => Promise<void>; disabled: boolean }) {
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center pb-10 pt-4 text-center">
      <div className="mx-auto mb-7 grid h-20 w-20 place-items-center rounded-[28px] border border-white bg-[#e2e8dc] text-3xl shadow-[0_14px_35px_rgba(74,92,67,0.13)]">🕊️</div>
      <p className="mb-3 text-xs font-medium tracking-[0.22em] text-[#829078]">WELCOME BACK</p>
      <h2 className="font-serif text-3xl font-semibold leading-tight tracking-[-0.025em] text-[#353c32] md:text-[42px]">不用整理好，<br />也可以从这里说起。</h2>
      <p className="mx-auto mt-5 max-w-lg text-[15px] leading-7 text-[#7d776f]">无论是任务卡住、周期变化，还是只想有人陪你缓一缓，我会和你一起把下一步变轻。</p>

      <div className="mt-9 grid gap-3 text-left sm:grid-cols-3">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            disabled={disabled}
            onClick={() => void onPrompt(prompt.text)}
            className="group rounded-[20px] border border-[#ddd7cd] bg-white/75 p-4 transition hover:-translate-y-0.5 hover:border-[#aebba5] hover:bg-white hover:shadow-[0_10px_30px_rgba(80,73,61,0.08)] disabled:cursor-wait disabled:opacity-60"
          >
            <span className="text-xl">{prompt.emoji}</span>
            <span className="mt-3 block text-sm font-medium text-[#4c5148]">{prompt.label}</span>
            <span className="mt-1 block text-xs leading-5 text-[#969087]">轻轻点一下就可以开始</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end pl-10">
        <div className="max-w-[82%] rounded-[22px] rounded-br-md bg-[#66765f] px-5 py-3.5 text-[15px] leading-7 text-white shadow-[0_8px_24px_rgba(71,88,65,0.15)]">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 pr-4 md:gap-4 md:pr-12">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[14px] bg-[#dfe7d9] text-base">♩</div>
      <div className="max-w-[88%] rounded-[22px] rounded-tl-md border border-[#e0dbd2] bg-white/85 px-5 py-4 text-[15px] leading-7 text-[#4e4a44] shadow-[0_8px_30px_rgba(75,68,57,0.06)] whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="flex items-start gap-3 md:gap-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[14px] bg-[#dfe7d9] text-base">♩</div>
      <div className="flex h-12 items-center gap-1.5 rounded-[20px] rounded-tl-md border border-[#e0dbd2] bg-white/85 px-5" aria-label="Lutealark 正在回复">
        {[0, 1, 2].map((item) => <span key={item} style={{ animationDelay: `${item * 140}ms` }} className="typing-dot h-1.5 w-1.5 rounded-full bg-[#84927a]" />)}
      </div>
    </div>
  )
}

function NavItem({ icon, label, active, badge }: { icon: 'chat' | 'cycle' | 'breath'; label: string; active?: boolean; badge?: string }) {
  return (
    <button type="button" disabled={!active} className={`flex w-full items-center gap-3 rounded-[16px] px-4 py-3 text-sm transition ${active ? 'bg-white text-[#465341] shadow-[0_8px_24px_rgba(70,63,52,0.07)]' : 'cursor-default text-[#8d877e]'}`}>
      <span className="h-5 w-5"><Icon name={icon} /></span>
      <span>{label}</span>
      {badge && <span className="ml-auto rounded-full bg-[#e4dfd5] px-2 py-0.5 text-[10px] text-[#918a80]">{badge}</span>}
    </button>
  )
}

function MobileNav() {
  return (
    <nav className="grid h-16 shrink-0 grid-cols-3 border-t border-[#ded8ce] bg-[#f5f1e9] lg:hidden" aria-label="移动端导航">
      <button type="button" className="flex flex-col items-center justify-center gap-1 text-[10px] text-[#52614d]"><span className="h-5 w-5"><Icon name="chat" /></span>聊一聊</button>
      <button type="button" disabled className="flex flex-col items-center justify-center gap-1 text-[10px] text-[#a09a91]"><span className="h-5 w-5"><Icon name="cycle" /></span>周期</button>
      <button type="button" disabled className="flex flex-col items-center justify-center gap-1 text-[10px] text-[#a09a91]"><span className="h-5 w-5"><Icon name="breath" /></span>呼吸</button>
    </nav>
  )
}

function getErrorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : '暂时没有连接成功，请稍后再试。'
}

export default App
