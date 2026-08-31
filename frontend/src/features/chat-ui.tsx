import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject, type ReactNode } from 'react'
import type { MemoryCandidate } from '@lutealark/contracts'
import type { CycleResult, DailyCheckIn } from '../lib/api'
import { labelForAction, orderQuickPrompts, quickPrompts, type QuickPromptCounts } from '../lib/word-checklist'
import type { ChatMessage, KnowledgeSource } from '../store/app-store'
import './chat-ui.css'

type SpeechRecognitionResultListLike = {
  readonly length: number
  readonly [index: number]: {
    readonly length: number
    readonly [index: number]: { readonly transcript: string }
  }
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onend: (() => void) | null
  onresult: ((event: { readonly results: SpeechRecognitionResultListLike }) => void) | null
  onerror: ((event: { readonly error: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructorLike
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike
}

export type ChatExperienceProps = {
  messages: ChatMessage[]
  input: string
  setInput: (value: string) => void
  isSending: boolean
  isConnecting: boolean
  isOfflineSession: boolean
  isReconnectingOpenTrek: boolean
  openTrekReconnectError?: string
  onReconnectOpenTrek: () => void
  error: string
  clearError: () => void
  submitMessage: (text: string) => Promise<void>
  retryFailedMessage?: () => void
  onAction: (action: string) => void
  cycleResult: CycleResult | null
  dailyCheckin: DailyCheckIn | null
  endRef: RefObject<HTMLDivElement | null>
  onMemoryCandidateDecision: (messageId: string, candidate: MemoryCandidate, decision: 'save' | 'dismiss') => Promise<void>
  onNewConversation?: () => Promise<void>
  onBack?: () => void | Promise<void>
  onRecordFeeling?: (feelings: string[]) => void | Promise<void>
  openFeelingPanel?: boolean
  onFeelingPanelOpened?: () => void
}

export type AgentEntryCardProps = {
  onOpen: () => void
  onPrompt: (text: string) => void
  onAction: (action: string) => void
  onRecordFeeling: () => void
}

const QUICK_PROMPT_COUNTS_KEY = 'lutealark.quick-prompt-counts.v1'
const forbiddenLanguage: Array<[RegExp, string]> = [
  [/你可以的/g, '我会陪你'],
  [/应该/g, '可以考虑'],
  [/必须/g, '可以先'],
  [/加油/g, '我在这里'],
  [/努力/g, '按自己的节奏'],
  [/坚持/g, '继续也可以，停下也可以'],
]

const feelings = [
  { label: '烦躁', emoji: '😣', tone: 'rose' },
  { label: '焦虑', emoji: '😰', tone: 'rose' },
  { label: '愤怒', emoji: '😠', tone: 'rose' },
  { label: '懵', emoji: '😵', tone: 'rose' },
  { label: '低落', emoji: '😔', tone: 'slate' },
  { label: '疲惫', emoji: '😫', tone: 'slate' },
  { label: '麻木', emoji: '😶', tone: 'slate' },
  { label: '放松', emoji: '😌', tone: 'mint' },
  { label: '平静', emoji: '😊', tone: 'mint' },
  { label: '开心', emoji: '😄', tone: 'mint' },
  { label: '专注', emoji: '🤓', tone: 'mint' },
  { label: '头痛', emoji: '🤕', tone: 'lilac' },
  { label: '紧绷', emoji: '🧘', tone: 'lilac' },
  { label: '超载', emoji: '🌀', tone: 'lilac' },
  { label: '痛经', emoji: '🩸', tone: 'lilac' },
] as const

const crisisInputPattern = /(想死|不想活|活不下去|自杀|轻生|伤害自己|结束生命)/
const emotionalPattern = /(烦|累|崩溃|难过|焦虑|低落|疲惫|压力|委屈|心慌|想哭|懵|超载)/

/** Home-page entry. The full chat is mounted only after this card is opened. */
export function AgentEntryCard({ onOpen, onPrompt, onAction, onRecordFeeling }: AgentEntryCardProps) {
  const [promptCounts, setPromptCounts] = useState<QuickPromptCounts>(loadPromptCounts)
  const [showQuickMenu, setShowQuickMenu] = useState(false)
  const longPressTimer = useRef<number | null>(null)
  const longPressTriggered = useRef(false)
  const orderedPrompts = useMemo(() => orderQuickPrompts(promptCounts), [promptCounts])
  const sendPrompt = (text: string) => {
    const prompt = quickPrompts.find((item) => item.text === text)
    if (prompt) {
      const nextCounts = { ...promptCounts, [prompt.id]: (promptCounts[prompt.id] ?? 0) + 1 }
      setPromptCounts(nextCounts)
      savePromptCounts(nextCounts)
    }
    onPrompt(text)
  }
  const clearLongPressTimer = () => {
    if (longPressTimer.current === null) return
    window.clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }
  const beginLongPress = () => {
    longPressTriggered.current = false
    clearLongPressTimer()
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null
      longPressTriggered.current = true
      if ('vibrate' in navigator) navigator.vibrate?.(20)
      setShowQuickMenu(true)
    }, 600)
  }
  const finishPress = () => {
    clearLongPressTimer()
  }
  useEffect(() => clearLongPressTimer, [])

  return (
    <section className="agent-entry-stage" aria-label="打开 Lutealark 对话">
      <div className="chat-welcome-prompts">
        {orderedPrompts.slice(0, 3).map(({ prompt }) => <button key={prompt.id} type="button" onClick={() => sendPrompt(prompt.text)}>{prompt.text.replace(/[。？！，、]/g, '')}</button>)}
      </div>
      <div className="relative">
      {showQuickMenu && <div className="agent-entry-menu" role="menu"><button type="button" onClick={() => { setShowQuickMenu(false); onRecordFeeling() }}>∿ <span>记录感受</span></button><button type="button" onClick={() => onAction('open_breathing')}>◌ <span>开始呼吸</span></button><button type="button" onClick={() => onAction('open_cycle')}>◒ <span>查看周期</span></button></div>}
      <button type="button" className="chat-welcome-card" onPointerDown={beginLongPress} onPointerUp={finishPress} onPointerCancel={finishPress} onPointerLeave={finishPress} onContextMenu={(event) => event.preventDefault()} onClick={() => {
        if (longPressTriggered.current) { longPressTriggered.current = false; return }
        onOpen()
      }}>
        <div className="chat-welcome-copy">
          <div className="chat-welcome-avatar"><img src="/assets/lutealark-bird.png" alt="" /></div>
          <div><h2>今天想聊聊什么？</h2><p>我在这里，不急着要答案</p></div>
        </div>
        <div className="chat-welcome-placeholder"><span className="chat-welcome-mic">◉</span><span>说点什么，或长按记录感受…</span><span className="chat-welcome-arrow">➤</span></div>
      </button>
      </div>
      <p className="chat-welcome-note">从一句话开始就好，剩下的我们慢慢来。</p>
    </section>
  )
}

export function ChatExperience(props: ChatExperienceProps) {
  const [showFeelings, setShowFeelings] = useState(false)
  const [showSafetySupport, setShowSafetySupport] = useState(false)
  const [showQuickMenu, setShowQuickMenu] = useState(false)
  const [showSources, setShowSources] = useState<KnowledgeSource[] | null>(null)
  const [selectedFeelings, setSelectedFeelings] = useState<string[]>([])
  const [customFeeling, setCustomFeeling] = useState('')
  const [showCustomFeeling, setShowCustomFeeling] = useState(false)
  const [recordedFeelings, setRecordedFeelings] = useState<string[]>([])
  const [feelingError, setFeelingError] = useState('')
  const [pointsNotice, setPointsNotice] = useState(false)
  const [promptCounts, setPromptCounts] = useState<QuickPromptCounts>(loadPromptCounts)
  const [isListening, setIsListening] = useState(false)
  const [speechStatus, setSpeechStatus] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const speechBaseInputRef = useRef('')
  const speechHadErrorRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const [speechSupported] = useState(() => getSpeechRecognitionConstructor() !== null)
  const { openFeelingPanel, onFeelingPanelOpened } = props

  const orderedPrompts = useMemo(() => orderQuickPrompts(promptCounts), [promptCounts])
  const crisisInput = crisisInputPattern.test(props.input)
  const emotionalInput = emotionalPattern.test(props.input)
  const phaseLabel = props.cycleResult
    ? `${props.cycleResult.phaseName}${props.cycleResult.isBufferMode ? ' · 缓冲模式' : ''}`
    : '今天的节奏'

  useEffect(() => () => {
    const recognition = recognitionRef.current
    if (!recognition) return
    recognition.onstart = null
    recognition.onend = null
    recognition.onresult = null
    recognition.onerror = null
    recognitionRef.current = null
    recognition.abort()
  }, [])

  useEffect(() => {
    if (props.messages.length === 0 && !props.isConnecting) textareaRef.current?.focus()
  }, [props.isConnecting, props.messages.length])

  useEffect(() => {
    if (!openFeelingPanel) return
    setShowFeelings(true)
    onFeelingPanelOpened?.()
  }, [openFeelingPanel, onFeelingPanelOpened])

  useEffect(() => {
    const node = messagesRef.current
    if (!node || props.messages.length === 0) return
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    if (distanceFromBottom <= 180 || props.isSending) {
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
    }
  }, [props.messages.length, props.isSending])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 40), 96)
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > 96 ? 'auto' : 'hidden'
  }, [props.input])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void props.submitMessage(props.input)
  }

  const sendPrompt = (text: string) => {
    const prompt = quickPrompts.find((item) => item.text === text)
    if (prompt) {
      const nextCounts = { ...promptCounts, [prompt.id]: (promptCounts[prompt.id] ?? 0) + 1 }
      setPromptCounts(nextCounts)
      savePromptCounts(nextCounts)
    }
    void props.submitMessage(text)
  }

  const toggleSpeech = () => {
    const active = recognitionRef.current
    if (active) {
      setSpeechStatus('正在停止语音输入…')
      try { active.stop() } catch {
        recognitionRef.current = null
        setIsListening(false)
      }
      return
    }
    const SpeechRecognition = getSpeechRecognitionConstructor()
    if (!SpeechRecognition) {
      setSpeechStatus('当前浏览器不支持语音输入，可以继续使用键盘。')
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = true
    speechBaseInputRef.current = props.input.trimEnd()
    speechHadErrorRef.current = false
    recognition.onstart = () => {
      setIsListening(true)
      setSpeechStatus('正在聆听中文…再次点击可停止。')
    }
    recognition.onresult = (event) => {
      let transcript = ''
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? ''
      }
      const normalized = transcript.trim()
      if (!normalized) return
      const base = speechBaseInputRef.current
      props.setInput(base ? `${base} ${normalized}` : normalized)
    }
    recognition.onerror = (event) => {
      speechHadErrorRef.current = true
      setIsListening(false)
      setSpeechStatus(speechErrorMessage(event.error))
    }
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null
      setIsListening(false)
      if (!speechHadErrorRef.current) setSpeechStatus('语音输入已结束，文字不会自动发送。')
    }
    recognitionRef.current = recognition
    setIsListening(true)
    try { recognition.start() } catch {
      recognitionRef.current = null
      setIsListening(false)
      setSpeechStatus('语音输入暂时无法启动，请稍后再试。')
    }
  }

  const toggleFeeling = (label: string) => {
    setSelectedFeelings((current) => current.includes(label)
      ? current.filter((item) => item !== label)
      : [...current, label])
  }

  const recordFeeling = () => {
    const custom = customFeeling.trim()
    const values = [...selectedFeelings, ...(custom ? [custom] : [])]
    if (values.length === 0) return
    setRecordedFeelings(values)
    setFeelingError('')
    setSelectedFeelings([])
    setCustomFeeling('')
    setShowCustomFeeling(false)
    setShowFeelings(false)
    void Promise.resolve().then(() => props.onRecordFeeling?.(values)).catch(() => {
      setFeelingError('感受已显示在本次对话中，但同步今天的状态失败了。')
    })
    setPointsNotice(true)
    window.setTimeout(() => setPointsNotice(false), 2200)
  }

  const focusComposer = () => textareaRef.current?.focus()
  const openFeelingSheet = () => {
    setShowQuickMenu(false)
    setShowFeelings(true)
  }

  return (
    <section className="chat-experience relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="chat-toolbar">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" className="chat-back-button" aria-label="返回周期" onClick={() => void (props.onBack ? props.onBack() : undefined)}><span aria-hidden="true">←</span><span>返回周期</span></button>
          <div className="chat-brand-mark" aria-hidden="true"><img src="/assets/lutealark-bird.png" alt="" /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><strong>Lutealark</strong><span className={`chat-phase-chip ${props.cycleResult?.isBufferMode ? 'is-buffer' : ''}`}>{phaseLabel}</span></div>
            <p>{props.isConnecting ? '正在连接缓冲站…' : '我在这里，不急着要答案'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {props.onNewConversation && <button type="button" className="chat-icon-button chat-new-button" onClick={() => void props.onNewConversation?.()} disabled={props.isSending} aria-label="新对话" title="新对话">＋</button>}
          <button type="button" className={`chat-feeling-button ${props.cycleResult?.isBufferMode ? 'is-warm' : ''}`} onClick={openFeelingSheet} aria-label="记录感受"><span>∿</span><small>感受</small></button>
        </div>
      </div>

      {props.isOfflineSession && (
        <div className="chat-reconnect-banner" role="status">
          <span><strong>OpenTrek 当前未连接</strong><small>现有离线回复会保留标识；重新连接只影响之后的消息。</small></span>
          <button type="button" onClick={props.onReconnectOpenTrek} disabled={props.isReconnectingOpenTrek || props.isConnecting}>
            {props.isReconnectingOpenTrek ? '正在连接…' : '重新连接 OpenTrek'}
          </button>
          {props.openTrekReconnectError && <small className="chat-reconnect-error">{props.openTrekReconnectError}</small>}
        </div>
      )}

      <div ref={messagesRef} className="chat-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:px-10" aria-live="polite">
        {props.messages.length === 0 ? (
          <WelcomeCard orderedPrompts={orderedPrompts} disabled={props.isSending || isListening} onPrompt={sendPrompt} onFocus={focusComposer} />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
            {props.cycleResult && <CyclePill result={props.cycleResult} checkin={props.dailyCheckin} />}
            {props.messages.map((message) => (
              <ChatMessageBubble key={message.id} message={message} isBufferMode={props.cycleResult?.isBufferMode ?? false} onAction={props.onAction} onSources={setShowSources} onMemoryCandidateDecision={props.onMemoryCandidateDecision} />
            ))}
            {recordedFeelings.length > 0 && <div className="chat-system-note"><span>✦</span> 你记录了：{recordedFeelings.map((item) => feelingDisplay(item)).join('、')}</div>}
            {props.isSending && <TypingBubble />}
            <div ref={props.endRef} />
          </div>
        )}
      </div>

      <div className="chat-composer-wrap">
        {(props.messages.length === 0 || props.isSending) && (
          <div className="chat-prompt-rail" aria-label="快捷短语">
            {orderedPrompts.slice(0, 5).map(({ prompt }) => <button key={prompt.id} type="button" disabled={props.isSending} onClick={() => sendPrompt(prompt.text)}>{prompt.text.replace(/[。？！，、]/g, '')}</button>)}
          </div>
        )}
        {emotionalInput && !crisisInput && <div className="chat-feeling-hint"><span>∿</span><span>想快速记录一下此刻的感受吗？</span><button type="button" onClick={openFeelingSheet}>打开记录</button></div>}
        {crisisInput && <div className="chat-safety-hint" role="alert"><span className="chat-safety-icon">!</span><span>你现在安全吗？如果需要，我可以帮你联系支持资源。</span><button type="button" onClick={() => setShowSafetySupport(true)}>查看资源</button></div>}
        {props.error && <div className="chat-error" role="alert"><span>{props.error}</span><div className="flex shrink-0 gap-3">{props.retryFailedMessage && <button type="button" onClick={props.retryFailedMessage}>重新发送</button>}<button type="button" onClick={props.clearError}>关闭</button></div></div>}
        {speechStatus && <p className="chat-speech-status" role="status">{speechStatus}</p>}
        <form onSubmit={submit} className="chat-composer-form">
          <div className="relative">
            {showQuickMenu && <div className="chat-quick-menu" role="menu"><button type="button" onClick={openFeelingSheet}>∿ <span>记录感受</span></button><button type="button" onClick={() => props.onAction('open_breathing')}>◌ <span>开始呼吸</span></button><button type="button" onClick={() => props.onAction('open_cycle')}>◒ <span>查看周期</span></button></div>}
            <button type="button" className={`chat-plus-button ${showQuickMenu ? 'is-open' : ''}`} onClick={() => setShowQuickMenu((current) => !current)} aria-label="快捷操作" aria-expanded={showQuickMenu}>+</button>
          </div>
          <textarea
            ref={textareaRef}
            value={props.input}
            onChange={(event) => props.setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(event) } }}
            rows={1}
            placeholder={isListening ? '正在聆听……' : '说点什么…'}
            className={`chat-textarea ${crisisInput ? 'is-crisis' : ''}`}
            disabled={props.isSending || isListening}
            aria-label="聊天输入"
          />
          {speechSupported && <button type="button" className={`chat-mic-button ${isListening ? 'is-listening' : ''}`} onClick={toggleSpeech} disabled={props.isSending} aria-label={isListening ? '停止语音输入' : '语音输入'} aria-pressed={isListening}>◉</button>}
          <button type="submit" className="chat-send-button" disabled={!props.input.trim() || props.isSending || isListening} aria-label="发送">➤</button>
        </form>
        <div className="chat-disclaimer">周期信息仅用于个性化支持，不用于医疗诊断 <span aria-hidden="true">·</span> 你可以随时停下或换个话题</div>
      </div>

      {showFeelings && <FeelingSheet selected={selectedFeelings} customFeeling={customFeeling} showCustom={showCustomFeeling} onToggle={toggleFeeling} onCustomChange={setCustomFeeling} onToggleCustom={() => setShowCustomFeeling((current) => !current)} onClose={() => setShowFeelings(false)} onRecord={recordFeeling} />}
      {showSources && <SourceSheet sources={showSources} onClose={() => setShowSources(null)} />}
      {showSafetySupport && <SafetySheet onClose={() => setShowSafetySupport(false)} />}
      {feelingError && <div className="chat-feeling-error" role="status">{feelingError}</div>}
      {pointsNotice && <div className="chat-points-notice" role="status">已记录感受 · 今天状态已更新</div>}
    </section>
  )
}

function WelcomeCard({ orderedPrompts, disabled, onPrompt, onFocus }: { orderedPrompts: ReturnType<typeof orderQuickPrompts>; disabled: boolean; onPrompt: (text: string) => void; onFocus: () => void }) {
  return (
    <div className="chat-welcome-stage">
      <div className="chat-welcome-prompts">
        {orderedPrompts.slice(0, 3).map(({ prompt }) => <button key={prompt.id} type="button" disabled={disabled} onClick={() => onPrompt(prompt.text)}>{prompt.text.replace(/[。？！，、]/g, '')}</button>)}
      </div>
      <button type="button" className="chat-welcome-card" onClick={onFocus} disabled={disabled}>
        <div className="chat-welcome-copy">
          <div className="chat-welcome-avatar"><img src="/assets/lutealark-bird.png" alt="" /></div>
          <div><h2>今天想聊聊什么？</h2><p>我在这里，不急着要答案</p></div>
        </div>
        <div className="chat-welcome-placeholder"><span className="chat-welcome-mic">◉</span><span>说点什么，或长按记录感受…</span><span className="chat-welcome-arrow">➤</span></div>
      </button>
      <p className="chat-welcome-note">从一句话开始就好，剩下的我们慢慢来。</p>
    </div>
  )
}

function CyclePill({ result, checkin }: { result: CycleResult; checkin: DailyCheckIn | null }) {
  return <div className={`chat-cycle-pill ${result.isBufferMode ? 'is-buffer' : ''}`}><span>◒ {result.phaseName} · 周期第 {result.dayOfCycle} 天</span><span>{checkin ? `今日能量 ${checkin.energy}/5` : `能量 ${result.energyValue}/10`}</span></div>
}

function ChatMessageBubble({ message, isBufferMode, onAction, onSources, onMemoryCandidateDecision }: { message: ChatMessage; isBufferMode: boolean; onAction: (action: string) => void; onSources: (sources: KnowledgeSource[]) => void; onMemoryCandidateDecision: (messageId: string, candidate: MemoryCandidate, decision: 'save' | 'dismiss') => Promise<void> }) {
  const [memoryConsent, setMemoryConsent] = useState(false)
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [memoryError, setMemoryError] = useState('')
  const timestamp = message.createdAt ? formatTime(message.createdAt) : ''
  if (message.role === 'user') {
    return <div className="chat-message-row is-user"><div><div className="chat-user-bubble">{message.content}</div>{timestamp && <time>{timestamp}</time>}</div></div>
  }

  const sources = message.mode === 'offline' ? [] : (message.sources ?? []).slice(0, 3)
  const verifiedRag = message.mode === 'online' && message.ragUsed === true && sources.length > 0
  const emotional = emotionalPattern.test(message.content)
  const actionLabel = message.action ? labelForAction(message.action) : null
  const decideMemory = async (decision: 'save' | 'dismiss') => {
    if (!message.memoryCandidate || (decision === 'save' && !memoryConsent)) return
    setMemoryBusy(true)
    setMemoryError('')
    try { await onMemoryCandidateDecision(message.id, message.memoryCandidate, decision) }
    catch (cause) { setMemoryError(cause instanceof Error ? cause.message : '暂时无法更新记忆，请稍后再试。') }
    finally { setMemoryBusy(false) }
  }

  return (
    <div className="chat-message-row is-agent">
          <div className="chat-agent-avatar" aria-hidden="true"><img src="/assets/lutealark-bird.png" alt="" /></div>
      <div className="min-w-0 max-w-[min(88%,640px)]">
        {message.mode === 'offline' && <div className="chat-offline-badge">● 离线基础支持 · 未使用 OpenTrek/RAG</div>}
        {message.mode === 'online' && <div className="chat-online-badge">● OpenTrek 在线 · {verifiedRag ? '已使用 RAG' : '未确认使用 RAG'}</div>}
        <div className={`chat-agent-bubble ${isBufferMode ? 'is-buffer' : ''}`}>
          <div className={`chat-agent-content ${emotional ? 'is-emotional' : ''}`}>
            <p>{renderPermissionText(message.content.trim() || '我听见了。我们可以从最轻的一步开始。')}</p>
          </div>
          {sources.length > 0 && <button type="button" className="chat-source-link" onClick={() => onSources(sources)}>参考来源 · {sources.length}</button>}
        </div>
        {message.memoryCandidate && <MemoryCandidateCard message={message} consent={memoryConsent} busy={memoryBusy} error={memoryError} setConsent={setMemoryConsent} decide={decideMemory} />}
        {actionLabel && <button type="button" className="chat-action-button" onClick={() => onAction(message.action!)}>{actionLabel} <span>→</span></button>}
        {(message.intent === 'safety_crisis' || message.intent === 'crisis_support') && <div className="chat-crisis-card"><strong>你现在并不孤单</strong><p>如果此刻有立即危险，请先远离危险物品或地点，并联系身边可信任的人陪伴。</p><div className="chat-crisis-actions"><a href="tel:120">拨打 120</a><a href="tel:110">拨打 110</a></div><small>也可以前往最近的急诊；离线支持不能替代紧急救援或专业医疗帮助。</small></div>}
        {timestamp && <time className="chat-agent-time">{timestamp}</time>}
      </div>
    </div>
  )
}

function MemoryCandidateCard({ message, consent, busy, error, setConsent, decide }: { message: ChatMessage; consent: boolean; busy: boolean; error: string; setConsent: (value: boolean) => void; decide: (decision: 'save' | 'dismiss') => Promise<void> }) {
  if (!message.memoryCandidate) return null
  return <div className="chat-memory-card"><p className="chat-memory-kicker">LONG-TERM MEMORY CANDIDATE</p><p>{message.memoryCandidate.summary}</p>{message.memoryCandidateStatus === 'saved' ? <small>✓ 已保存，可在“对话档案”中编辑或删除。</small> : message.memoryCandidateStatus === 'dismissed' ? <small>未保存这条候选记忆。</small> : <><label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />我已核对摘要，并明确同意保存。</label><div><button type="button" disabled={!consent || busy} onClick={() => void decide('save')}>{busy ? '处理中…' : '同意并保存'}</button><button type="button" disabled={busy} onClick={() => void decide('dismiss')}>不保存</button></div>{error && <small className="text-[#a24d3c]">{error}</small>}</>}</div>
}

function TypingBubble() {
  return <div className="chat-message-row is-agent"><div className="chat-agent-avatar" aria-hidden="true"><img src="/assets/lutealark-bird.png" alt="" /></div><div className="chat-typing-wrap"><div className="chat-typing-bubble">{[0, 1, 2].map((item) => <i key={item} style={{ animationDelay: `${item * 180}ms` }} />)}</div><small>缓冲带正在整理思绪…</small></div></div>
}

function FeelingSheet({ selected, customFeeling, showCustom, onToggle, onCustomChange, onToggleCustom, onClose, onRecord }: { selected: string[]; customFeeling: string; showCustom: boolean; onToggle: (label: string) => void; onCustomChange: (value: string) => void; onToggleCustom: () => void; onClose: () => void; onRecord: () => void }) {
  return <div className="chat-sheet-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="chat-bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="feeling-sheet-title"><div className="chat-sheet-handle" /><div className="flex items-start justify-between"><div><h2 id="feeling-sheet-title">此刻的感受</h2><p>可以多选，没有标准答案</p></div><button type="button" className="chat-sheet-close" onClick={onClose} aria-label="关闭">×</button></div><div className="chat-feeling-grid">{feelings.map((feeling) => <button key={feeling.label} type="button" className={`chat-feeling-chip tone-${feeling.tone} ${selected.includes(feeling.label) ? 'is-selected' : ''}`} onClick={() => onToggle(feeling.label)}>{feeling.emoji} {feeling.label}</button>)}</div><button type="button" className="chat-custom-feeling" onClick={onToggleCustom}>＋ 自定义感受…</button>{showCustom && <input autoFocus value={customFeeling} onChange={(event) => onCustomChange(event.target.value)} placeholder="写下此刻的感受" className="chat-custom-input" maxLength={40} /> }<button type="button" className="chat-record-button" disabled={selected.length === 0 && !customFeeling.trim()} onClick={onRecord}>记录感受</button></section></div>
}

function SourceSheet({ sources, onClose }: { sources: KnowledgeSource[]; onClose: () => void }) {
  return <div className="chat-sheet-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="chat-source-sheet" role="dialog" aria-modal="true" aria-labelledby="source-sheet-title"><div className="chat-sheet-handle" /><div className="flex items-center justify-between"><h2 id="source-sheet-title">参考来源</h2><button type="button" className="chat-sheet-close" onClick={onClose} aria-label="关闭">×</button></div><ol>{sources.map((source, index) => <li key={`${source.sourceId ?? source.title}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{source.title}</strong>{source.excerpt && <p>{source.excerpt}</p>}{source.url && <a href={source.url} target="_blank" rel="noreferrer">打开来源 ↗</a>}</div></li>)}</ol><button type="button" className="chat-source-close-button" onClick={onClose}>关闭</button></section></div>
}

function SafetySheet({ onClose }: { onClose: () => void }) {
  return <div className="chat-sheet-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="chat-safety-sheet" role="dialog" aria-modal="true" aria-labelledby="safety-sheet-title"><div className="chat-sheet-handle" /><div className="flex items-start justify-between gap-3"><div><h2 id="safety-sheet-title">你现在并不孤单</h2><p>如果此刻有立即危险，请先把危险物品放远，并联系一个可信任的人陪伴。</p></div><button type="button" className="chat-sheet-close" onClick={onClose} aria-label="关闭">×</button></div><div className="chat-safety-actions"><a href="tel:120">拨打 120</a><a href="tel:110">拨打 110</a></div><p className="chat-safety-footnote">也可以直接前往最近的急诊。Lutealark 不能替代紧急救援或专业医疗帮助。</p><button type="button" className="chat-source-close-button" onClick={onClose}>继续对话</button></section></div>
}

function renderPermissionText(text: string) {
  const matches: Array<{ start: number; end: number; value: string; replacement: string }> = []
  forbiddenLanguage.forEach(([pattern, replacement]) => {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) matches.push({ start: match.index, end: match.index + match[0].length, value: match[0], replacement })
  })
  if (matches.length === 0) return text
  matches.sort((left, right) => left.start - right.start || right.end - left.end)
  const nonOverlapping = matches.filter((match, index) => index === 0 || match.start >= matches[index - 1].end)
  const nodes: ReactNode[] = []
  let cursor = 0
  nonOverlapping.forEach((match, index) => {
    if (match.start > cursor) nodes.push(text.slice(cursor, match.start))
    nodes.push(<del key={`del-${index}`}>{match.value}</del>)
    nodes.push(<span key={`replace-${index}`} className="chat-permission-replacement">{match.replacement}</span>)
    cursor = match.end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function feelingDisplay(value: string) {
  const known = feelings.find((feeling) => feeling.label === value)
  return known ? `${known.emoji} ${known.label}` : value
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function loadPromptCounts(): QuickPromptCounts {
  try {
    const raw = localStorage.getItem(QUICK_PROMPT_COUNTS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).filter(([id, value]) => quickPrompts.some((prompt) => prompt.id === id) && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) as QuickPromptCounts
  } catch { return {} }
}

function savePromptCounts(value: QuickPromptCounts) {
  try { localStorage.setItem(QUICK_PROMPT_COUNTS_KEY, JSON.stringify(value)) } catch { /* browser storage may be unavailable */ }
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructorLike | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function speechErrorMessage(error: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') return '没有获得麦克风权限，可以在浏览器设置中允许后再试。'
  if (error === 'audio-capture') return '暂时找不到可用的麦克风，请检查设备后再试。'
  if (error === 'no-speech') return '没有听到语音，可以靠近麦克风后再试一次。'
  if (error === 'network') return '语音识别服务暂时无法连接，请稍后再试。'
  return '语音输入已停止，可以继续使用键盘。'
}
