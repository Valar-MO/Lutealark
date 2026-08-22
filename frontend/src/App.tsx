import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { MemoryCandidate } from '@lutealark/contracts'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  calculateCycle,
  clearAgentSessionCache,
  createAgentSession,
  isOfflineSessionCode,
  reconnectAgentSession,
  sendAgentMessageWithSessionRetry,
  type CycleResult,
  type CycleSettings,
  type DailyCheckIn,
} from './lib/api'
import { BreathingPage } from './features/breathing'
import { CycleDesignPanel } from './features/cycle-design'
import { AgentEntryCard, ChatExperience } from './features/chat-ui'
import { AccountPage, MemoryPage, PointsPage, ToolsPage } from './features/product-pages'
import {
  addBreathingRecord,
  clearBreathingRecordsCache,
  loadBreathingRecords,
  removeBreathingRecord,
  replaceBreathingRecords,
  type BreathingRecord,
} from './features/breathing-storage'
import {
  fetchPersonalData,
  clearPersonalDataPending,
  deleteBreathingRecord as deleteRemoteBreathingRecord,
  deleteDailyCheckin as deleteRemoteDailyCheckin,
  discardUnavailablePendingData,
  getPendingPersonalData,
  hasPendingPersonalData,
  reconcilePersonalDataCollections,
  resetPersonalDataSyncState,
  syncBreathingRecord,
  syncCycleSettings,
  syncDailyCheckin,
  transferPendingPersonalData,
} from './lib/personal-data'
import { getAuthStatus } from './lib/auth-api'
import {
  ACTIVE_SUBJECT_STORAGE_KEY,
  accountDataSubject,
  dataSubjectKey,
  deviceDataSubject,
  getActiveDataSubject,
  setActiveDataSubject,
  scopedStorageKey,
  type DataSubject,
} from './lib/data-subject'
import { parseAgentReplyMetadata, sanitizeAgentReplyMetadata } from './lib/chat-metadata'
import { createAsyncScope, hasCurrentAsyncOperation, isCurrentAsyncScope, type AsyncScope } from './lib/async-scope'
import {
  DEFAULT_APP_PATH,
  navigateBackToCycle,
  pathForView,
  viewFromPath,
} from './lib/app-routes'
import { clearLocalProductFeatureCache, transferPendingProductData } from './lib/product-local'
import { createConversation, createConversationMessage, createMemory, updateConversationMessage } from './lib/product-api'
import {
  bodyStateOptions,
  labelForAction,
  openAction,
  orderQuickPrompts,
  quickPrompts,
  type QuickPromptCounts,
} from './lib/word-checklist'
import { useAppStore, type AppView, type ChatMessage, type KnowledgeSource } from './store/app-store'

type PersonalDataSyncStatus = 'syncing' | 'synced' | 'local'
type ConversationSyncStatus = 'idle' | 'syncing' | 'synced' | 'local'
type PendingSyncState = { pending: number; failed: boolean }
type OpenTrekReconnectOperation = { scope: AsyncScope; promise: Promise<boolean> }
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

const LEGACY_CYCLE_STORAGE_KEY = 'lutealark.cycle-settings.v1'
const STORAGE_KEY = 'lutealark.cycle-settings.v2'
const LEGACY_DAILY_CHECKINS_STORAGE_KEY = 'lutealark.daily-checkins.v1'
const DAILY_CHECKINS_STORAGE_KEY = 'lutealark.daily-checkins.v2'
const LEGACY_DAILY_CHECKIN_STORAGE_KEY = 'lutealark.daily-checkin.v1'
const QUICK_PROMPT_COUNTS_STORAGE_KEY = 'lutealark.quick-prompt-counts.v1'
const BODY_STATE_LIMIT = 8
const MAX_AUTOMATIC_OPENTREK_RECONNECTS = 2
const BUSINESS_TIME_ZONE = 'Asia/Shanghai'
const businessDateFormatter = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const routeView = viewFromPath(location.pathname)
  const view = useAppStore((state) => state.view)
  const setViewState = useAppStore((state) => state.setView)
  const sessionCode = useAppStore((state) => state.sessionCode)
  const setSessionCode = useAppStore((state) => state.setSessionCode)
  const activeConversationId = useAppStore((state) => state.activeConversationId)
  const setActiveConversationId = useAppStore((state) => state.setActiveConversationId)
  const messages = useAppStore((state) => state.messages)
  const setMessages = useAppStore((state) => state.setMessages)
  const input = useAppStore((state) => state.input)
  const setInput = useAppStore((state) => state.setInput)
  const cycleSettings = useAppStore((state) => state.cycleSettings)
  const setCycleSettings = useAppStore((state) => state.setCycleSettings)
  const cycleResult = useAppStore((state) => state.cycleResult)
  const setCycleResult = useAppStore((state) => state.setCycleResult)
  const dailyCheckins = useAppStore((state) => state.dailyCheckins)
  const setDailyCheckins = useAppStore((state) => state.setDailyCheckins)
  const breathingRecords = useAppStore((state) => state.breathingRecords)
  const setBreathingRecords = useAppStore((state) => state.setBreathingRecords)
  const personalDataSubjectKey = useAppStore((state) => state.dataSubjectKey)
  const switchPersonalDataSubject = useAppStore((state) => state.switchPersonalDataSubject)
  const resetConversation = useAppStore((state) => state.resetConversation)
  const [isConnecting, setIsConnecting] = useState(true)
  const [subjectReady, setSubjectReady] = useState(false)
  const [currentBusinessDate, setCurrentBusinessDate] = useState(todayString)
  const [isSending, setIsSending] = useState(false)
  const [isReconnectingOpenTrek, setIsReconnectingOpenTrek] = useState(false)
  const [openTrekReconnectError, setOpenTrekReconnectError] = useState('')
  const [isChatOpen, setIsChatOpen] = useState(() => useAppStore.getState().messages.length > 0)
  const [openFeelingPanelOnChat, setOpenFeelingPanelOnChat] = useState(false)
  const [error, setError] = useState('')
  const [failedMessage, setFailedMessage] = useState('')
  const [personalDataSyncStatus, setPersonalDataSyncStatus] = useState<PersonalDataSyncStatus>('syncing')
  const [conversationSyncStatus, setConversationSyncStatus] = useState<ConversationSyncStatus>('idle')
  const endRef = useRef<HTMLDivElement>(null)
  const skipNextCycleCalculation = useRef<{ subjectKey: string; generation: number } | null>(null)
  const personalDataSyncs = useRef(new Map<string, PendingSyncState>())
  const personalDataMutationVersion = useRef(0)
  const subjectRefreshSequence = useRef(0)
  const subjectGeneration = useRef(0)
  const subjectTransitioning = useRef(true)
  const activeSubject = useRef(getActiveDataSubject())
  const conversationSyncs = useRef(new Map<string, PendingSyncState>())
  const automaticOpenTrekReconnects = useRef({ subjectKey: '', count: 0 })
  const openTrekReconnectOperation = useRef<OpenTrekReconnectOperation | null>(null)
  const agentSessionOperation = useRef<AsyncScope | null>(null)
  const chatSendOperation = useRef<AsyncScope | null>(null)

  const isCurrentSubjectKey = (subjectKey: string, generation = subjectGeneration.current) => (
    !subjectTransitioning.current
    && generation === subjectGeneration.current
    && useAppStore.getState().dataSubjectKey === subjectKey
    && dataSubjectKey(getActiveDataSubject()) === subjectKey
  )

  useEffect(() => {
    if (routeView) setViewState(routeView)
  }, [routeView, setViewState])

  useEffect(() => {
    const refreshBusinessDate = () => setCurrentBusinessDate(todayString())
    const timer = window.setInterval(refreshBusinessDate, 30_000)
    window.addEventListener('focus', refreshBusinessDate)
    window.addEventListener('pageshow', refreshBusinessDate)
    document.addEventListener('visibilitychange', refreshBusinessDate)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshBusinessDate)
      window.removeEventListener('pageshow', refreshBusinessDate)
      document.removeEventListener('visibilitychange', refreshBusinessDate)
    }
  }, [])

  const openView = (nextView: AppView, search = '') => {
    setViewState(nextView)
    navigate(`${pathForView(nextView)}${search}`)
  }

  const reconnectOpenTrek = useCallback((automatic = false): Promise<boolean> => {
    if (subjectTransitioning.current) return Promise.resolve(false)
    const reconnectSubjectKey = dataSubjectKey(getActiveDataSubject())
    const existingOperation = openTrekReconnectOperation.current
    if (existingOperation?.scope.subjectKey === reconnectSubjectKey
      && existingOperation.scope.generation === subjectGeneration.current) {
      return existingOperation.promise
    }
    if (automaticOpenTrekReconnects.current.subjectKey !== reconnectSubjectKey) {
      automaticOpenTrekReconnects.current = { subjectKey: reconnectSubjectKey, count: 0 }
    }
    if (automatic && automaticOpenTrekReconnects.current.count >= MAX_AUTOMATIC_OPENTREK_RECONNECTS) {
      return Promise.resolve(false)
    }
    if (automatic) automaticOpenTrekReconnects.current.count += 1
    const scope = createAsyncScope(reconnectSubjectKey, subjectGeneration.current)
    setIsReconnectingOpenTrek(true)
    setOpenTrekReconnectError('')
    const isCurrentReconnect = () => (
      !subjectTransitioning.current
      && isCurrentAsyncScope(
        openTrekReconnectOperation.current?.scope ?? null,
        scope,
        dataSubjectKey(getActiveDataSubject()),
        subjectGeneration.current,
      )
    )
    const operation = reconnectAgentSession()
      .then((replacementSessionCode) => {
        if (!isCurrentReconnect()) return false
        setSessionCode(replacementSessionCode)
        automaticOpenTrekReconnects.current = { subjectKey: reconnectSubjectKey, count: 0 }
        return true
      })
      .catch((cause: unknown) => {
        if (isCurrentReconnect()) setOpenTrekReconnectError(getErrorMessage(cause))
        return false
      })
      .finally(() => {
        if (openTrekReconnectOperation.current?.scope !== scope) return
        // The operation still owns the indicator, even if the subject began a
        // transition between the last callback and finally. Subject-change
        // handlers clear this ref before starting the replacement operation;
        // therefore this cannot turn off a newer subject's reconnect state.
        setIsReconnectingOpenTrek(false)
        openTrekReconnectOperation.current = null
      })
    openTrekReconnectOperation.current = { scope, promise: operation }
    return operation
  }, [setSessionCode])

  useEffect(() => {
    if (!subjectReady) return
    let active = true
    const sessionSubjectKey = dataSubjectKey(getActiveDataSubject())
    const scope = createAsyncScope(sessionSubjectKey, subjectGeneration.current)
    agentSessionOperation.current = scope
    const isCurrentSessionOperation = () => (
      active
      && !subjectTransitioning.current
      && isCurrentAsyncScope(
        agentSessionOperation.current,
        scope,
        dataSubjectKey(getActiveDataSubject()),
        subjectGeneration.current,
      )
    )
    const cachedSession = useAppStore.getState().sessionCode
    // Preserve the conversation and its honest offline labels while trying a
    // bounded replacement session. Clearing all messages here made recovery
    // look like data loss and still offered no retry if the first probe failed.
    if (cachedSession && !cachedSession.startsWith('offline:')) {
      setIsConnecting(false)
      if (agentSessionOperation.current === scope) agentSessionOperation.current = null
      return () => {
        active = false
        if (agentSessionOperation.current === scope) agentSessionOperation.current = null
      }
    }
    if (cachedSession?.startsWith('offline:')) {
      setIsConnecting(false)
      if (agentSessionOperation.current === scope) agentSessionOperation.current = null
      void reconnectOpenTrek(true)
      return () => {
        active = false
        if (agentSessionOperation.current === scope) agentSessionOperation.current = null
      }
    }
    setIsConnecting(true)
    createAgentSession()
      .then((code) => {
        if (!isCurrentSessionOperation()) return
        setSessionCode(code)
        if (isOfflineSessionCode(code)) void reconnectOpenTrek(true)
      })
      .catch((cause: unknown) => {
        if (isCurrentSessionOperation()) setError(getErrorMessage(cause))
      })
      .finally(() => {
        if (!isCurrentSessionOperation()) return
        setIsConnecting(false)
        agentSessionOperation.current = null
      })
    return () => {
      active = false
      if (agentSessionOperation.current === scope) agentSessionOperation.current = null
    }
  }, [personalDataSubjectKey, reconnectOpenTrek, setSessionCode, subjectReady])

  useEffect(() => {
    const retryWhenConnectivityReturns = () => {
      if (isOfflineSessionCode(useAppStore.getState().sessionCode)) {
        void reconnectOpenTrek(true)
      }
    }
    window.addEventListener('online', retryWhenConnectivityReturns)
    window.addEventListener('pageshow', retryWhenConnectivityReturns)
    return () => {
      window.removeEventListener('online', retryWhenConnectivityReturns)
      window.removeEventListener('pageshow', retryWhenConnectivityReturns)
    }
  }, [reconnectOpenTrek])

  useEffect(() => {
    let active = true
    const sequence = ++subjectRefreshSequence.current

    const bootstrap = async () => {
      setPersonalDataSyncStatus('syncing')
      let subject = getActiveDataSubject()
      try {
        const auth = await getAuthStatus()
        subject = auth.authenticated
          ? accountDataSubject(auth.user.userId)
          : deviceDataSubject()
        setActiveDataSubject(subject)
      } catch {
        // When offline, retain the last confirmed subject and its isolated cache.
      }
      if (!active || subjectRefreshSequence.current !== sequence) return

      activeSubject.current = subject
      const localCycleSettings = loadCycleSettings(subject)
      const localDailyCheckins = loadDailyCheckins(subject)
      const localBreathingRecords = loadBreathingRecords(subject)
      switchPersonalDataSubject(dataSubjectKey(subject), {
        cycleSettings: localCycleSettings,
        dailyCheckins: localDailyCheckins,
        breathingRecords: localBreathingRecords,
      })
      subjectTransitioning.current = false
      setSubjectReady(true)
      const bootstrapVersion = personalDataMutationVersion.current
      try {
        const synchronized = await reconcilePersonalData(
          localCycleSettings,
          localDailyCheckins,
          localBreathingRecords,
          subject,
          () => personalDataMutationVersion.current === bootstrapVersion,
        )
        if (!active || subjectRefreshSequence.current !== sequence) return
        if (synchronized.stale) return
        setCycleSettings(synchronized.cycleSettings)
        setDailyCheckins(synchronized.dailyCheckins)
        setBreathingRecords(synchronized.breathingRecords)
        setPersonalDataSyncStatus(synchronized.syncFailed || hasPendingPersonalData(subject) ? 'local' : 'synced')
      } catch {
        if (active) setPersonalDataSyncStatus('local')
      }
    }

    void bootstrap()
    return () => { active = false }
  }, [setBreathingRecords, setCycleSettings, setDailyCheckins, switchPersonalDataSubject])

  useEffect(() => {
    let refreshSequence = 0
    const handleAuthChanged = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<{
        authenticated?: boolean
        accountDeleted?: boolean
        userId?: string
        dataMerge?: 'no_device' | 'same_user' | 'merged' | 'already_claimed' | 'registered_account'
      }>
      const authenticated = event.detail?.authenticated === true
      const accountDeleted = event.detail?.accountDeleted === true
      const previousSubject = activeSubject.current
      const nextSubject = authenticated && event.detail?.userId
        ? accountDataSubject(event.detail.userId)
        : deviceDataSubject()
      subjectTransitioning.current = true
      subjectGeneration.current += 1
      setSubjectReady(false)
      agentSessionOperation.current = null
      chatSendOperation.current = null
      openTrekReconnectOperation.current = null
      automaticOpenTrekReconnects.current = { subjectKey: dataSubjectKey(nextSubject), count: 0 }
      setIsConnecting(true)
      setIsSending(false)
      setIsReconnectingOpenTrek(false)
      setOpenTrekReconnectError('')
      subjectRefreshSequence.current += 1
      if (event.detail?.dataMerge === 'merged') {
        const personalCopied = transferPendingPersonalDataCache(previousSubject, nextSubject)
        const productCopied = transferPendingProductData(previousSubject, nextSubject, todayString())
        if (personalCopied && productCopied) {
          clearPersonalDataPending(previousSubject)
          clearPersonalDataLocalCache(previousSubject)
          clearLocalProductFeatureCache(previousSubject)
        }
      }
      setActiveDataSubject(nextSubject)
      activeSubject.current = nextSubject
      refreshSequence += 1
      const sequence = refreshSequence
      personalDataMutationVersion.current += 1
      const mutationVersion = personalDataMutationVersion.current
      clearAgentSessionCache()
      resetConversation()
      setConversationSyncStatus('idle')
      resetPersonalDataSyncState(previousSubject)
      resetPersonalDataSyncState(nextSubject)

      if (accountDeleted) {
        clearLocalProductFeatureCache(previousSubject)
        clearPersonalDataLocalCache(previousSubject)
        clearPersonalDataPending(previousSubject)
        try {
          localStorage.removeItem(QUICK_PROMPT_COUNTS_STORAGE_KEY)
        } catch {
          // The account subject has still been switched below.
        }
      }

      const localCycleSettings = loadCycleSettings(nextSubject)
      const localDailyCheckins = loadDailyCheckins(nextSubject)
      const localBreathingRecords = loadBreathingRecords(nextSubject)
      switchPersonalDataSubject(dataSubjectKey(nextSubject), {
        cycleSettings: localCycleSettings,
        dailyCheckins: localDailyCheckins,
        breathingRecords: localBreathingRecords,
      })
      subjectTransitioning.current = false
      setSubjectReady(true)

      setPersonalDataSyncStatus('syncing')
      void reconcilePersonalData(
        localCycleSettings,
        localDailyCheckins,
        localBreathingRecords,
        nextSubject,
        () => refreshSequence === sequence && personalDataMutationVersion.current === mutationVersion,
      )
        .then((synchronized) => {
          if (refreshSequence !== sequence || personalDataMutationVersion.current !== mutationVersion) return
          if (synchronized.stale) return
          setCycleSettings(synchronized.cycleSettings)
          setDailyCheckins(synchronized.dailyCheckins)
          setBreathingRecords(synchronized.breathingRecords)
          setPersonalDataSyncStatus(synchronized.syncFailed || hasPendingPersonalData(nextSubject) ? 'local' : 'synced')
        })
        .catch(() => {
          if (refreshSequence === sequence) setPersonalDataSyncStatus('local')
        })
    }

    window.addEventListener('lutealark:auth-changed', handleAuthChanged)
    return () => window.removeEventListener('lutealark:auth-changed', handleAuthChanged)
  }, [resetConversation, setBreathingRecords, setCycleSettings, setDailyCheckins, setSessionCode, switchPersonalDataSubject])

  useEffect(() => {
    let storageRefreshSequence = 0

    const refreshCrossTabAuth = () => {
      const sequence = ++storageRefreshSequence
      subjectTransitioning.current = true
      subjectGeneration.current += 1
      setSubjectReady(false)
      agentSessionOperation.current = null
      chatSendOperation.current = null
      openTrekReconnectOperation.current = null
      automaticOpenTrekReconnects.current = { subjectKey: '', count: 0 }
      setIsConnecting(true)
      setIsSending(false)
      setIsReconnectingOpenTrek(false)
      setOpenTrekReconnectError('')
      personalDataMutationVersion.current += 1
      clearAgentSessionCache()
      resetConversation()
      useAppStore.getState().resetPersonalData()
      setConversationSyncStatus('idle')
      setPersonalDataSyncStatus('syncing')

      void getAuthStatus()
        .then((auth) => {
          if (storageRefreshSequence !== sequence) return
          window.dispatchEvent(new CustomEvent('lutealark:auth-changed', {
            detail: {
              authenticated: auth.authenticated,
              userId: auth.authenticated ? auth.user.userId : undefined,
            },
          }))
        })
        .catch(() => {
          if (storageRefreshSequence !== sequence) return
          setPersonalDataSyncStatus('local')
          setError('检测到其他标签页切换了账号，但暂时无法确认登录状态。请恢复连接后重新聚焦页面。')
        })
    }

    const handleStorage = (event: StorageEvent) => {
      // Only localStorage uses this key; avoiding a direct localStorage read
      // here keeps private-mode/storage-blocked browsers from throwing while
      // handling a cross-tab event.
      if (event.key !== ACTIVE_SUBJECT_STORAGE_KEY) return
      refreshCrossTabAuth()
    }
    const retryBlockedRefresh = () => {
      if (subjectTransitioning.current) refreshCrossTabAuth()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', retryBlockedRefresh)
    window.addEventListener('pageshow', retryBlockedRefresh)
    return () => {
      storageRefreshSequence += 1
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', retryBlockedRefresh)
      window.removeEventListener('pageshow', retryBlockedRefresh)
    }
  }, [resetConversation])

  useEffect(() => {
    if (!cycleSettings) return
    let active = true
    const cycleSubjectKey = personalDataSubjectKey
    const cycleGeneration = subjectGeneration.current
    const skippedCalculation = skipNextCycleCalculation.current
    skipNextCycleCalculation.current = null
    if (skippedCalculation?.subjectKey === cycleSubjectKey
      && skippedCalculation.generation === cycleGeneration) {
      return
    }
    calculateCycle(cycleSettings)
      .then((result) => {
        if (active && isCurrentSubjectKey(cycleSubjectKey, cycleGeneration)) setCycleResult(result)
      })
      .catch((cause: unknown) => {
        if (active && isCurrentSubjectKey(cycleSubjectKey, cycleGeneration)) setError(getErrorMessage(cause))
      })
    return () => { active = false }
  }, [cycleSettings, personalDataSubjectKey, setCycleResult])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  const currentMutationSubject = (): DataSubject | null => {
    const subject = getActiveDataSubject()
    if (isCurrentSubjectKey(dataSubjectKey(subject))) return subject
    setError('正在安全切换账号数据，请稍后再试。')
    return null
  }

  const submitMessage = async (text: string, appendUserMessage = true) => {
    const message = text.trim()
    if (!message || isSending) return
    const subject = currentMutationSubject()
    if (!subject) return
    const conversationSubjectKey = dataSubjectKey(subject)
    const sendGeneration = subjectGeneration.current
    // React state updates are asynchronous. The ref closes the small window
    // where two clicks can otherwise start two sends before `isSending` is
    // committed, while still allowing a fresh generation after account swap.
    const existingSend = chatSendOperation.current
    if (hasCurrentAsyncOperation(existingSend, conversationSubjectKey, sendGeneration)) return
    if (existingSend) chatSendOperation.current = null
    const sendScope = createAsyncScope(conversationSubjectKey, sendGeneration)
    chatSendOperation.current = sendScope
    setIsChatOpen(true)
    const createdAt = new Date().toISOString()
    const conversationId = activeConversationId || crypto.randomUUID()
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      createdAt,
    }
    let conversationReady: Promise<string>
    if (activeConversationId) {
      conversationReady = Promise.resolve(activeConversationId)
    } else {
      setActiveConversationId(conversationId)
      conversationReady = Promise.resolve().then(() => {
        if (!isCurrentSubjectKey(conversationSubjectKey, sendGeneration)) {
          throw new Error('数据主体已变更，已取消旧对话创建。')
        }
        return createConversation({
          id: conversationId,
          title: message.slice(0, 60),
        })
      }).then((conversation) => conversation.id)
    }
    // Keep a rejected lazy creation from becoming an unhandled rejection when
    // the subject changes before the chat transport returns.
    void conversationReady.catch(() => undefined)
    setInput('')
    setError('')
    setFailedMessage('')
    if (appendUserMessage) {
      setMessages((current) => [...current, userMessage])
      trackConversationSync(conversationReady.then((id) => {
        if (!isCurrentSubjectKey(conversationSubjectKey, sendGeneration)) throw new Error('数据主体已变更')
        return createConversationMessage(id, {
          id: userMessage.id,
          role: 'user',
          content: userMessage.content,
          createdAt,
          metadata: {},
        })
      }), conversationSubjectKey)
    }
    setIsSending(true)
    try {
      const reply = await sendAgentMessageWithSessionRetry({
        sessionCode,
        message,
        cycleSettings: cycleSettings ?? undefined,
        dailyCheckin: dailyCheckins.find((checkin) => checkin.date === todayString()),
        dailyCheckins: dailyCheckins.filter((checkin) => checkin.shareWithChat),
        onSessionCode: (code) => {
          if (isCurrentSubjectKey(conversationSubjectKey, sendGeneration)) setSessionCode(code)
        },
        isActive: () => isCurrentSubjectKey(conversationSubjectKey, sendGeneration),
      })
      if (!isCurrentSubjectKey(conversationSubjectKey, sendGeneration)) return
      if (isOfflineSessionCode(reply.sessionCode)) {
        setSessionCode(reply.sessionCode)
        void reconnectOpenTrek(true)
      } else {
        automaticOpenTrekReconnects.current = { subjectKey: conversationSubjectKey, count: 0 }
        setOpenTrekReconnectError('')
      }
      const persistedReplyMetadata = sanitizeAgentReplyMetadata(reply.metadata)
      const metadata = parseAgentReplyMetadata(persistedReplyMetadata)
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply.content,
        createdAt: new Date().toISOString(),
        ...metadata,
      }
      setMessages((current) => [...current, assistantMessage])
      trackConversationSync(conversationReady.then((id) => {
        if (!isCurrentSubjectKey(conversationSubjectKey, sendGeneration)) throw new Error('数据主体已变更')
        return createConversationMessage(id, {
          id: assistantMessage.id,
          role: 'assistant',
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
          metadata: persistedReplyMetadata,
        })
      }), conversationSubjectKey)
    } catch (cause) {
      if (!isCurrentSubjectKey(conversationSubjectKey, sendGeneration)) return
      setError(getErrorMessage(cause))
      setFailedMessage(message)
    } finally {
      if (isCurrentAsyncScope(
        chatSendOperation.current,
        sendScope,
        dataSubjectKey(getActiveDataSubject()),
        subjectGeneration.current,
      )) {
        setIsSending(false)
        chatSendOperation.current = null
      }
    }
  }

  const startNewConversation = async () => {
    if (isSending) return
    const subject = currentMutationSubject()
    if (!subject) return
    const conversationSubjectKey = dataSubjectKey(subject)
    const sessionGeneration = subjectGeneration.current
    const existingSession = agentSessionOperation.current
    if (hasCurrentAsyncOperation(existingSession, conversationSubjectKey, sessionGeneration)) return
    const sessionScope = createAsyncScope(conversationSubjectKey, sessionGeneration)
    agentSessionOperation.current = sessionScope
    resetConversation()
    setConversationSyncStatus('idle')
    setError('')
    setFailedMessage('')
    setOpenTrekReconnectError('')
    setIsConnecting(true)
    try {
      const code = await createAgentSession(true)
      if (isCurrentSubjectKey(conversationSubjectKey, sessionGeneration)
        && isCurrentAsyncScope(
          agentSessionOperation.current,
          sessionScope,
          conversationSubjectKey,
          sessionGeneration,
        )) {
        setSessionCode(code)
        if (isOfflineSessionCode(code)) void reconnectOpenTrek(true)
      }
    } catch (cause) {
      if (isCurrentSubjectKey(conversationSubjectKey, sessionGeneration)
        && isCurrentAsyncScope(
          agentSessionOperation.current,
          sessionScope,
          conversationSubjectKey,
          sessionGeneration,
        )) setError(getErrorMessage(cause))
    }
    finally {
      if (isCurrentAsyncScope(
        agentSessionOperation.current,
        sessionScope,
        dataSubjectKey(getActiveDataSubject()),
        subjectGeneration.current,
      )) {
        setIsConnecting(false)
        agentSessionOperation.current = null
      }
    }
  }

  const openChat = () => {
    setOpenFeelingPanelOnChat(false)
    setIsChatOpen(true)
  }

  const saveCycle = async (settings: CycleSettings) => {
    personalDataMutationVersion.current += 1
    const subject = currentMutationSubject()
    if (!subject) return
    const saveGeneration = subjectGeneration.current
    const saveSubjectKey = dataSubjectKey(subject)
    persistCycleSettings(settings, subject)
    skipNextCycleCalculation.current = {
      subjectKey: saveSubjectKey,
      generation: saveGeneration,
    }
    setCycleSettings(settings)
    setError('')
    trackPersonalDataSync(syncCycleSettings(settings, subject), subject)
    try {
      const result = await calculateCycle(settings)
      if (isCurrentSubjectKey(saveSubjectKey, saveGeneration)) setCycleResult(result)
    } catch (cause) {
      if (!isCurrentSubjectKey(saveSubjectKey, saveGeneration)) return
      setError(getErrorMessage(cause))
      throw cause instanceof Error ? cause : new Error(getErrorMessage(cause))
    }
  }

  const saveDailyCheckin = (checkin: DailyCheckIn) => {
    personalDataMutationVersion.current += 1
    const subject = currentMutationSubject()
    if (!subject) return
    const next = normalizeDailyCheckins([
      checkin,
      ...dailyCheckins.filter((item) => item.date !== checkin.date),
    ])
    persistDailyCheckins(next, subject)
    setDailyCheckins(next)
    trackPersonalDataSync(syncDailyCheckin(checkin, subject), subject)
  }

  const saveBreathingRecord = (record: BreathingRecord) => {
    personalDataMutationVersion.current += 1
    const subject = currentMutationSubject()
    if (!subject) return
    setBreathingRecords(addBreathingRecord(breathingRecords, record, subject))
    trackPersonalDataSync(syncBreathingRecord(record, subject), subject)
  }

  const deleteDailyCheckinRecord = async (date: string) => {
    personalDataMutationVersion.current += 1
    const subject = currentMutationSubject()
    if (!subject) return
    const operation = deleteRemoteDailyCheckin(date, subject)
    const next = dailyCheckins.filter((checkin) => checkin.date !== date)
    persistDailyCheckins(next, subject)
    setDailyCheckins(next)
    setError('')
    trackPersonalDataSync(operation, subject)
    await operation.catch(() => undefined)
  }

  const deleteBreathingRecordItem = async (recordId: string) => {
    personalDataMutationVersion.current += 1
    const subject = currentMutationSubject()
    if (!subject) return
    const operation = deleteRemoteBreathingRecord(recordId, subject)
    setBreathingRecords(removeBreathingRecord(breathingRecords, recordId, subject))
    setError('')
    trackPersonalDataSync(operation, subject)
    await operation.catch(() => undefined)
  }

  const retryPersonalDataSync = async () => {
    if (personalDataSyncStatus === 'syncing') return
    const subject = currentMutationSubject()
    if (!subject) return
    const syncGeneration = subjectGeneration.current
    const syncSubjectKey = dataSubjectKey(subject)
    setPersonalDataSyncStatus('syncing')
    try {
      const synchronized = await reconcilePersonalData(
        cycleSettings,
        dailyCheckins,
        breathingRecords,
        subject,
      )
      if (!isCurrentSubjectKey(syncSubjectKey, syncGeneration)) return
      setCycleSettings(synchronized.cycleSettings)
      setDailyCheckins(synchronized.dailyCheckins)
      setBreathingRecords(synchronized.breathingRecords)
      setPersonalDataSyncStatus(synchronized.syncFailed || hasPendingPersonalData(subject) ? 'local' : 'synced')
    } catch {
      if (isCurrentSubjectKey(syncSubjectKey, syncGeneration)) setPersonalDataSyncStatus('local')
    }
  }

  const trackPersonalDataSync = (operation: Promise<unknown>, subject: DataSubject = getActiveDataSubject()) => {
    const subjectKey = dataSubjectKey(subject)
    const generation = subjectGeneration.current
    const trackerKey = `${generation}:${subjectKey}`
    const state = personalDataSyncs.current.get(trackerKey) ?? { pending: 0, failed: false }
    state.pending += 1
    personalDataSyncs.current.set(trackerKey, state)
    if (isCurrentSubjectKey(subjectKey, generation)) {
      setPersonalDataSyncStatus('syncing')
    }
    void operation
      .catch(() => { state.failed = true })
      .finally(() => {
        state.pending -= 1
        if (state.pending > 0) return
        personalDataSyncs.current.delete(trackerKey)
        if (isCurrentSubjectKey(subjectKey, generation)) {
          setPersonalDataSyncStatus(state.failed || hasPendingPersonalData(subject) ? 'local' : 'synced')
        }
      })
  }

  const trackConversationSync = (operation: Promise<unknown>, subjectKey = dataSubjectKey(getActiveDataSubject())) => {
    const generation = subjectGeneration.current
    const trackerKey = `${generation}:${subjectKey}`
    const state = conversationSyncs.current.get(trackerKey) ?? { pending: 0, failed: false }
    state.pending += 1
    conversationSyncs.current.set(trackerKey, state)
    if (isCurrentSubjectKey(subjectKey, generation)) setConversationSyncStatus('syncing')
    void operation
      .catch(() => { state.failed = true })
      .finally(() => {
        state.pending -= 1
        if (state.pending > 0) return
        conversationSyncs.current.delete(trackerKey)
        if (isCurrentSubjectKey(subjectKey, generation)) {
          setConversationSyncStatus(state.failed ? 'local' : 'synced')
        }
      })
  }

  const retryConversationSync = async () => {
    if (!activeConversationId || messages.length === 0 || conversationSyncStatus === 'syncing') return
    const subject = currentMutationSubject()
    if (!subject) return
    const conversationSubjectKey = dataSubjectKey(subject)
    const syncGeneration = subjectGeneration.current
    const firstUserMessage = messages.find((message) => message.role === 'user')
    const operation = createConversation({
      id: activeConversationId,
      title: firstUserMessage?.content.slice(0, 60) || '未命名对话',
    }).then(() => {
      if (!isCurrentSubjectKey(conversationSubjectKey, syncGeneration)) throw new Error('数据主体已变更')
      return Promise.all(messages.map((message) => createConversationMessage(activeConversationId, {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        metadata: message.role === 'assistant' ? {
          intent: message.intent,
          action: message.action,
          mode: message.mode,
          ragUsed: message.ragUsed,
          sources: message.sources ?? [],
          memoryCandidate: message.memoryCandidate,
          memoryCandidateStatus: message.memoryCandidateStatus,
        } : {},
      })))
    })
    trackConversationSync(operation, conversationSubjectKey)
    await operation.catch(() => undefined)
  }

  const decideMemoryCandidate = async (
    messageId: string,
    candidate: MemoryCandidate,
    decision: 'save' | 'dismiss',
  ) => {
    const subject = currentMutationSubject()
    if (!subject) return
    const conversationSubjectKey = dataSubjectKey(subject)
    const memoryGeneration = subjectGeneration.current
    if (decision === 'save') {
      await createMemory({
        id: candidate.candidateId,
        kind: candidate.kind,
        summary: candidate.summary,
        sourceConversationId: activeConversationId || null,
        sourceTurnHash: candidate.sourceTurnHash,
        consent: true,
      })
    }
    if (!isCurrentSubjectKey(conversationSubjectKey, memoryGeneration)) return
    const status = decision === 'save' ? 'saved' as const : 'dismissed' as const
    setMessages((current) => current.map((message) => (
      message.id === messageId ? { ...message, memoryCandidateStatus: status } : message
    )))
    if (activeConversationId) {
      if (!isCurrentSubjectKey(conversationSubjectKey, memoryGeneration)) return
      const sourceMessage = useAppStore.getState().messages.find((message) => message.id === messageId)
      trackConversationSync(updateConversationMessage(activeConversationId, messageId, {
        metadata: {
          intent: sourceMessage?.intent,
          action: sourceMessage?.action,
          mode: sourceMessage?.mode,
          ragUsed: sourceMessage?.ragUsed,
          sources: sourceMessage?.sources ?? [],
          memoryCandidate: candidate,
          memoryCandidateStatus: status,
        },
      }), conversationSubjectKey)
    }
  }

  if (!routeView) return <Navigate to={DEFAULT_APP_PATH} replace />
  const activeView = routeView === view ? view : routeView
  const todayCheckin = dailyCheckins.find((checkin) => checkin.date === currentBusinessDate) ?? null
  const suggestedToolEnergy = todayCheckin?.energy
    ?? Math.max(1, Math.min(5, Math.round((cycleResult?.energyValue ?? 6) / 2)))
  const recordChatFeelings = (feelings: string[]) => {
    const current = dailyCheckins.find((checkin) => checkin.date === currentBusinessDate)
    saveDailyCheckin({
      date: currentBusinessDate,
      energy: current?.energy ?? 3,
      mood: moodFromFeelings(feelings, current?.mood),
      bodyState: Array.from(new Set([...feelings, ...(current?.bodyState ?? [])])).slice(0, BODY_STATE_LIMIT),
      note: current?.note,
      shareWithChat: current?.shareWithChat ?? true,
    })
  }

  return (
    <div className="h-dvh overflow-hidden bg-[#f4f0e8] text-[#34322f] md:p-3">
      <div className="mx-auto flex h-full max-w-[1480px] overflow-hidden bg-[#fbfaf7] shadow-[0_24px_80px_rgba(70,60,45,0.12)] md:rounded-[24px]">
        {activeView !== 'agent' && <Sidebar view={activeView} openView={openView} cycleResult={cycleResult} />}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {activeView !== 'agent' && <Header
            view={activeView}
            isConnecting={isConnecting}
            error={error}
            personalDataSyncStatus={personalDataSyncStatus}
            conversationSyncStatus={conversationSyncStatus}
            onRetryConversationSync={retryConversationSync}
            onRetryPersonalDataSync={retryPersonalDataSync}
            onNewConversation={startNewConversation}
          />}
          {!subjectReady ? (
            <section className="grid min-h-0 flex-1 place-items-center px-6 text-center" role="status">
              <div><p className="font-serif text-xl text-[#46513f]">正在安全确认当前账号…</p><p className="mt-2 text-sm text-[#7d776f]">确认完成前不会读写个人数据。</p></div>
            </section>
          ) : activeView === 'agent' && !isChatOpen ? (
            <AgentHome
              settings={cycleSettings}
              result={cycleResult}
              onSave={saveCycle}
              disabled={isSending || isConnecting}
              onOpenChat={openChat}
              onPrompt={(text) => { setIsChatOpen(true); void submitMessage(text) }}
              onAction={(action) => openAction(action, openView)}
              onRecordFeeling={() => { setOpenFeelingPanelOnChat(true); setIsChatOpen(true) }}
              onBack={() => navigateBackToCycle(openView)}
            />
          ) : activeView === 'agent' ? (
            <ChatExperience
              messages={messages}
              input={input}
              setInput={setInput}
              isSending={isSending}
              isConnecting={isConnecting}
              isOfflineSession={isOfflineSessionCode(sessionCode)}
              isReconnectingOpenTrek={isReconnectingOpenTrek}
              openTrekReconnectError={openTrekReconnectError}
              onReconnectOpenTrek={() => { void reconnectOpenTrek(false) }}
              error={error}
              clearError={() => {
                setError('')
                setFailedMessage('')
              }}
              submitMessage={submitMessage}
              retryFailedMessage={failedMessage ? () => { void submitMessage(failedMessage, false) } : undefined}
              onAction={(action) => openAction(action, openView)}
              onMemoryCandidateDecision={decideMemoryCandidate}
              cycleResult={cycleResult}
              dailyCheckin={todayCheckin}
              endRef={endRef}
              onNewConversation={startNewConversation}
              onBack={() => navigateBackToCycle(openView)}
              onRecordFeeling={recordChatFeelings}
              openFeelingPanel={openFeelingPanelOnChat}
              onFeelingPanelOpened={() => setOpenFeelingPanelOnChat(false)}
            />
          ) : activeView === 'cycle' ? (
            <CycleView
              settings={cycleSettings}
              result={cycleResult}
              onSave={saveCycle}
              dailyCheckins={dailyCheckins}
              onSaveDailyCheckin={saveDailyCheckin}
              onDeleteDailyCheckin={deleteDailyCheckinRecord}
              focusCheckin={new URLSearchParams(location.search).get('section') === 'checkin'}
              onBack={() => openView('agent')}
              onOpenTools={() => openView('tools')}
            />
          ) : activeView === 'breathing' ? (
            <BreathingPage
              cycleResult={cycleResult}
              records={breathingRecords}
              onUpsertRecord={saveBreathingRecord}
              onDeleteRecord={deleteBreathingRecordItem}
              onBack={() => openView('agent')}
            />
          ) : activeView === 'tools' ? (
            <ToolsPage
              key={`${personalDataSubjectKey}:${currentBusinessDate}`}
              target={toolTargetFromSearch(location.search)}
              suggestedEnergy={suggestedToolEnergy}
              isBufferMode={cycleResult?.isBufferMode ?? false}
            />
          ) : activeView === 'memory' ? (
            <MemoryPage key={personalDataSubjectKey} />
          ) : activeView === 'points' ? (
            <PointsPage key={`${personalDataSubjectKey}:${currentBusinessDate}`} />
          ) : (
            <AccountPage />
          )}
          {activeView !== 'agent' && <MobileNav view={activeView} openView={openView} />}
        </main>
      </div>
    </div>
  )
}

function Sidebar({ view, openView, cycleResult }: { view: AppView; openView: (view: AppView) => void; cycleResult: CycleResult | null }) {
  return (
    <aside className="hidden w-[200px] shrink-0 flex-col border-r border-[#ded8ce] bg-[#eee9df]/80 p-4 md:flex">
      <div className="flex items-center gap-3 px-2 py-2">
        <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-white/80 p-1"><img src="/assets/lutealark-logo.png" alt="Lutealark" className="h-full w-full object-contain" /></div>
        <div><div className="font-serif text-[20px] font-semibold text-[#2f352c]">Lutealark</div><div className="text-[10px] tracking-[0.12em] text-[#858076]">温柔缓冲站</div></div>
      </div>
      <nav className="mt-6 space-y-2" aria-label="主要导航">
        <NavButton active={view === 'agent'} onClick={() => openView('agent')} icon="◌" label="聊一聊" />
        <NavButton active={view === 'cycle'} onClick={() => openView('cycle')} icon="↻" label="周期状态" badge={cycleResult ? `第 ${cycleResult.dayOfCycle} 天` : '待设置'} />
        <NavButton active={view === 'breathing'} onClick={() => openView('breathing')} icon="♧" label="呼吸空间" />
        <NavButton active={view === 'tools'} onClick={() => openView('tools')} icon="✿" label="轻支持工具" />
        <NavButton active={view === 'memory'} onClick={() => openView('memory')} icon="▤" label="对话档案" />
        <NavButton active={view === 'points'} onClick={() => openView('points')} icon="☆" label="积分目标" />
        <NavButton active={view === 'account'} onClick={() => openView('account')} icon="○" label="账号同步" />
      </nav>
      <div className="sidebar-note mt-auto rounded-[18px] border border-white/70 bg-white/55 p-3 text-xs leading-5 text-[#716c64]">
        <div className="mb-1 text-base">🌿</div><p>不需要一次解决所有事。今天轻一点，也算前进。</p>
      </div>
    </aside>
  )
}

function AgentHome({ settings, result, onSave, disabled, onOpenChat, onPrompt, onAction, onRecordFeeling, onBack }: {
  settings: CycleSettings | null
  result: CycleResult | null
  onSave: (settings: CycleSettings) => Promise<void>
  disabled: boolean
  onOpenChat: () => void
  onPrompt: (text: string) => void
  onAction: (action: string) => void
  onRecordFeeling: () => void
  onBack: () => void
}) {
  return (
    <section className="agent-home-surface soft-grid min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <button type="button" className="agent-home-back-button inline-flex min-h-[44px] w-fit items-center gap-2 rounded-full border border-white/80 bg-white/80 px-4 text-sm font-semibold text-[#435a51] shadow-sm backdrop-blur-sm hover:bg-white" onClick={onBack} aria-label="返回周期">
          <span aria-hidden="true">←</span><span>返回周期</span>
        </button>
        <CycleDesignPanel settings={settings} result={result} onSave={onSave} showRecordButton={false} />
        <AgentEntryCard disabled={disabled} onOpen={onOpenChat} onPrompt={onPrompt} onAction={onAction} onRecordFeeling={onRecordFeeling} />
      </div>
    </section>
  )
}

function Header({ view, isConnecting, error, personalDataSyncStatus, conversationSyncStatus, onRetryPersonalDataSync, onRetryConversationSync, onNewConversation }: { view: AppView; isConnecting: boolean; error: string; personalDataSyncStatus: PersonalDataSyncStatus; conversationSyncStatus: ConversationSyncStatus; onRetryPersonalDataSync: () => Promise<void>; onRetryConversationSync: () => Promise<void>; onNewConversation: () => Promise<void> }) {
  const title = view === 'agent'
    ? '今天，想从哪里开始？'
    : view === 'cycle'
      ? '你的周期节奏'
      : view === 'breathing'
        ? '给自己几分钟呼吸'
        : view === 'tools'
          ? '今天的轻支持工具'
          : view === 'memory'
            ? '你的对话档案'
            : view === 'points'
              ? '记录已经完成的小步骤'
              : '账号与跨设备同步'
  return (
    <header className="flex h-[62px] shrink-0 items-center justify-between border-b border-[#e6e0d7] bg-[#fbfaf7]/90 px-5 md:px-7">
      <div>
        <h1 className="font-serif text-lg font-semibold text-[#343b31] md:text-xl">{title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#8a847b]">
          <span className={`h-2 w-2 rounded-full ${error ? 'bg-[#bd755f]' : isConnecting ? 'animate-pulse bg-[#c7a85a]' : 'bg-[#7d956f]'}`} />
          <span>{error ? '连接需要检查' : isConnecting ? '正在连接缓冲站' : 'Lutealark 已准备好'}</span>
          <span aria-hidden="true">·</span>
          <span className={personalDataSyncStatus === 'local' ? 'text-[#9a6849]' : ''} role="status" aria-live="polite">
            {personalDataSyncStatus === 'syncing' ? '个人数据正在同步' : personalDataSyncStatus === 'synced' ? '个人数据已同步' : '个人数据仅本地保存'}
          </span>
          {personalDataSyncStatus === 'local' && (
            <button type="button" onClick={() => void onRetryPersonalDataSync()} className="text-[#8b5c40] underline underline-offset-2">
              重试同步
            </button>
          )}
          {view === 'agent' && conversationSyncStatus !== 'idle' && (
            <>
              <span aria-hidden="true">·</span>
              <span className={conversationSyncStatus === 'local' ? 'text-[#9a6849]' : ''} role="status">
                {conversationSyncStatus === 'syncing' ? '对话正在保存' : conversationSyncStatus === 'synced' ? '对话已保存' : '对话保留在本页，待同步'}
              </span>
              {conversationSyncStatus === 'local' && <button type="button" onClick={() => void onRetryConversationSync()} className="text-[#8b5c40] underline underline-offset-2">重试保存</button>}
            </>
          )}
        </div>
      </div>
      {view === 'agent' && <button type="button" onClick={() => void onNewConversation()} className="rounded-full border border-[#d8d1c6] bg-white/70 px-4 py-2 text-sm text-[#656159] hover:bg-white">＋ 新对话</button>}
    </header>
  )
}

export function ChatView(props: {
  messages: ChatMessage[]; input: string; setInput: (value: string) => void; isSending: boolean; isConnecting: boolean; error: string; clearError: () => void
  submitMessage: (text: string) => Promise<void>; retryFailedMessage?: () => void; onAction: (action: string) => void; cycleResult: CycleResult | null; dailyCheckin: DailyCheckIn | null; endRef: React.RefObject<HTMLDivElement | null>
  onMemoryCandidateDecision: (messageId: string, candidate: MemoryCandidate, decision: 'save' | 'dismiss') => Promise<void>
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const speechBaseInputRef = useRef('')
  const speechHadErrorRef = useRef(false)
  const [speechSupported] = useState(() => getSpeechRecognitionConstructor() !== null)
  const [isListening, setIsListening] = useState(false)
  const [speechStatus, setSpeechStatus] = useState('')

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

  const toggleSpeechInput = () => {
    const activeRecognition = recognitionRef.current
    if (activeRecognition) {
      setSpeechStatus('正在停止语音输入…')
      try {
        activeRecognition.stop()
      } catch {
        recognitionRef.current = null
        setIsListening(false)
        setSpeechStatus('语音输入已结束，可以编辑后再发送。')
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
      const normalizedTranscript = transcript.trim()
      if (!normalizedTranscript) return
      const baseInput = speechBaseInputRef.current
      props.setInput(baseInput ? `${baseInput} ${normalizedTranscript}` : normalizedTranscript)
    }
    recognition.onerror = (event) => {
      speechHadErrorRef.current = true
      setIsListening(false)
      setSpeechStatus(getSpeechRecognitionErrorMessage(event.error))
    }
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null
      setIsListening(false)
      if (!speechHadErrorRef.current) {
        setSpeechStatus('语音输入已结束，文字不会自动发送。')
      }
    }
    recognitionRef.current = recognition
    setIsListening(true)
    setSpeechStatus('正在启动中文语音输入…')
    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setIsListening(false)
      setSpeechStatus('语音输入暂时无法启动，请稍后再试。')
    }
  }

  const handleSubmit = (event: FormEvent) => { event.preventDefault(); void props.submitMessage(props.input) }
  return (
    <section className="soft-grid relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className={`scrollbar mx-auto w-full max-w-4xl flex-1 px-5 py-4 md:px-8 ${props.messages.length === 0 ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {props.cycleResult && <CycleStrip result={props.cycleResult} checkin={props.dailyCheckin} />}
        {props.messages.length === 0 ? <Welcome onPrompt={props.submitMessage} disabled={props.isSending || props.isConnecting || isListening} /> : (
          <div className="space-y-7">{props.messages.map((message) => <MessageBubble key={message.id} message={message} onAction={props.onAction} onMemoryCandidateDecision={props.onMemoryCandidateDecision} />)}{props.isSending && <TypingBubble />}</div>
        )}
        <div ref={props.endRef} />
      </div>
      <div className="shrink-0 bg-gradient-to-t from-[#fbfaf7] via-[#fbfaf7] to-transparent px-4 pb-3 pt-4 md:px-8">
        <form onSubmit={handleSubmit} className="mx-auto max-w-4xl">
          {props.error && <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-[#e2b7a8] bg-[#fff5f0] px-4 py-3 text-sm text-[#8a5140]"><span>{props.error}</span><div className="flex shrink-0 gap-3">{props.retryFailedMessage && <button type="button" className="font-medium underline underline-offset-2" onClick={props.retryFailedMessage}>重新发送</button>}<button type="button" onClick={props.clearError}>关闭</button></div></div>}
          <div className="flex items-end gap-2 rounded-[20px] border border-[#d8d2c8] bg-white p-2 pl-4 shadow-[0_12px_40px_rgba(70,60,45,0.10)] focus-within:border-[#91a087]">
            <textarea value={props.input} onChange={(event) => props.setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSubmit(event) } }} rows={1} placeholder={isListening ? '正在聆听……' : '把脑海里的事放在这里……'} className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2 text-sm outline-none disabled:text-[#676b63]" disabled={props.isSending || isListening} />
            {speechSupported && <button type="button" onClick={toggleSpeechInput} disabled={props.isSending} aria-label={isListening ? '停止语音输入' : '开始中文语音输入'} aria-pressed={isListening} className={`grid h-10 w-10 shrink-0 place-items-center rounded-[15px] border text-base transition ${isListening ? 'border-[#687b60] bg-[#e5ece1] text-[#4b5e45]' : 'border-[#ddd7cd] bg-[#faf9f6] text-[#737068] hover:bg-[#f0eee8]'} disabled:opacity-50`}>🎙️</button>}
            <button type="submit" disabled={!props.input.trim() || props.isSending || isListening} className="grid h-10 w-10 shrink-0 place-items-center rounded-[15px] bg-[#687b60] text-white disabled:bg-[#c7c6bf]" aria-label="发送">➤</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[11px] text-[#a09a91]">
            <span>周期信息仅用于个性化支持，不用于医疗诊断</span>
            <span className={isListening ? 'font-medium text-[#607157]' : ''} role="status" aria-live="polite">
              {speechSupported ? (speechStatus || '语音只会转成文字，不会自动发送') : '当前浏览器不支持语音输入，可继续使用键盘'}
            </span>
          </div>
        </form>
      </div>
    </section>
  )
}

function CycleView({ settings, result, onSave, dailyCheckins, onSaveDailyCheckin, onDeleteDailyCheckin, focusCheckin, onBack, onOpenTools }: { settings: CycleSettings | null; result: CycleResult | null; onSave: (settings: CycleSettings) => Promise<void>; dailyCheckins: DailyCheckIn[]; onSaveDailyCheckin: (checkin: DailyCheckIn) => void; onDeleteDailyCheckin: (date: string) => Promise<void>; focusCheckin: boolean; onBack: () => void; onOpenTools: () => void }) {
  const today = todayString()
  const [editingCheckinDate, setEditingCheckinDate] = useState(today)
  const [checkinBusyDate, setCheckinBusyDate] = useState('')
  const [checkinError, setCheckinError] = useState('')
  useEffect(() => {
    if (!focusCheckin) return
    setEditingCheckinDate(today)
    const element = document.getElementById('cycle-daily-checkin')
    const frame = window.requestAnimationFrame(() => {
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      element?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusCheckin, today])
  const editingCheckin = dailyCheckins.find((checkin) => checkin.date === editingCheckinDate) ?? null
  const removeCheckin = async (checkin: DailyCheckIn) => {
    if (!window.confirm(`确定删除 ${formatShortDate(checkin.date)} 的状态记录吗？此操作无法撤销。`)) return
    setCheckinBusyDate(checkin.date)
    setCheckinError('')
    try {
      await onDeleteDailyCheckin(checkin.date)
      if (editingCheckinDate === checkin.date) setEditingCheckinDate(today)
    } catch (cause) {
      setCheckinError(getErrorMessage(cause))
    } finally {
      setCheckinBusyDate('')
    }
  }
  return (
    <section className="cycle-main-surface soft-grid min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
      <div className="mx-auto max-w-4xl">
        <CycleDesignPanel settings={settings} result={result} onSave={onSave} />
        <div id="cycle-daily-checkin" tabIndex={-1} className="scroll-mt-4 outline-none">
          <DailyCheckinCard
            key={`${editingCheckinDate}:${JSON.stringify(editingCheckin)}`}
            recordDate={editingCheckinDate}
            checkin={editingCheckin}
            onSave={(checkin) => {
              onSaveDailyCheckin(checkin)
              setEditingCheckinDate(today)
              setCheckinError('')
            }}
            onCancel={editingCheckinDate === today ? undefined : () => setEditingCheckinDate(today)}
          />
        </div>
        {checkinError && <p className="mt-3 rounded-2xl border border-[#e2b7a8] bg-[#fff5f0] px-4 py-3 text-sm text-[#8a5140]" role="alert">{checkinError}</p>}
        <CheckinInsights checkins={dailyCheckins} />
        <CheckinHistory checkins={dailyCheckins} busyDate={checkinBusyDate} onEdit={(checkin) => {
          setEditingCheckinDate(checkin.date)
          setCheckinError('')
          document.getElementById('cycle-daily-checkin')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }} onDelete={(checkin) => void removeCheckin(checkin)} />
        {result && <div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={onBack} className="rounded-full border border-[#cfc8bd] bg-white/70 px-5 py-2 text-sm text-[#596254]">带着这个状态去聊天 →</button><button type="button" onClick={onOpenTools} className="rounded-full border border-[#bdcbb7] bg-[#eef3eb] px-5 py-2 text-sm text-[#52634c]">去工具页手动微调能量</button></div>}
      </div>
    </section>
  )
}

function DailyCheckinCard({ recordDate, checkin, onSave, onCancel }: { recordDate: string; checkin: DailyCheckIn | null; onSave: (checkin: DailyCheckIn) => void; onCancel?: () => void }) {
  const existing = checkin?.date === recordDate ? checkin : null
  const isToday = recordDate === todayString()
  const [energy, setEnergy] = useState<DailyCheckIn['energy']>(existing?.energy ?? 3)
  const [mood, setMood] = useState<DailyCheckIn['mood']>(existing?.mood ?? 'calm')
  const [bodyState, setBodyState] = useState<string[]>(() => existing?.bodyState.slice(0, BODY_STATE_LIMIT) ?? [])
  const [customBodyState, setCustomBodyState] = useState('')
  const [bodyStateNotice, setBodyStateNotice] = useState('')
  const [note, setNote] = useState(existing?.note ?? '')
  const [shareWithChat, setShareWithChat] = useState(existing?.shareWithChat ?? true)

  const toggleBodyState = (value: string) => {
    if (bodyState.includes(value)) {
      setBodyState(bodyState.filter((item) => item !== value))
      setBodyStateNotice('')
      return
    }
    if (bodyState.length >= BODY_STATE_LIMIT) {
      setBodyStateNotice('先选这 8 项就好，可以取消一项后再添加新感受。')
      return
    }
    setBodyState([...bodyState, value])
    setBodyStateNotice('')
  }

  const addCustomBodyState = () => {
    const value = customBodyState.trim()
    if (!value) return
    if (bodyState.includes(value)) {
      setCustomBodyState('')
      setBodyStateNotice('这个感受已经选好了。')
      return
    }
    if (bodyState.length >= BODY_STATE_LIMIT) {
      setBodyStateNotice('先选这 8 项就好，可以取消一项后再添加新感受。')
      return
    }
    setBodyState([...bodyState, value])
    setCustomBodyState('')
    setBodyStateNotice('')
  }

  const customBodyStates = bodyState.filter((value) => !bodyStateOptions.some((option) => option === value))
  const save = () => onSave({ date: recordDate, energy, mood, bodyState: bodyState.slice(0, BODY_STATE_LIMIT), note: note.trim() || undefined, shareWithChat })

  return <section className="mt-6 rounded-[24px] border border-[#dfd9cf] bg-white/80 p-5 shadow-[0_14px_45px_rgba(73,66,55,.07)] md:p-6">
    <p className="text-xs font-medium tracking-[.18em] text-[#829078]">{isToday ? "TODAY'S CHECK-IN" : 'EDIT CHECK-IN'}</p>
    <h2 className="mt-2 font-serif text-2xl font-semibold text-[#353c32]">{isToday ? '今天的状态' : `编辑 ${formatShortDate(recordDate)} 的状态`}</h2>
    <p className="mt-2 text-sm leading-6 text-[#7d776f]">{isToday ? '只记录一点此刻的感受。你可以选择是否让聊天助手使用它。' : '你可以修正这一天主动留下的记录；保存后会同步更新。'}</p>
    <div className="mt-5 space-y-5">
      <div><p className="mb-2 text-sm font-medium">此刻能量如何？</p><div className="grid grid-cols-5 gap-2">{([1, 2, 3, 4, 5] as const).map((value) => <button key={value} type="button" onClick={() => setEnergy(value)} className={`rounded-xl border px-2 py-2 text-sm ${energy === value ? 'border-[#687b60] bg-[#e8eee3] text-[#405039]' : 'border-[#ddd7cd] bg-white text-[#7d776f]'}`}>{value}</button>)}</div><p className="mt-1 text-xs text-[#999188]">1 很低 · 5 很足</p></div>
      <div><p className="mb-2 text-sm font-medium">情绪更接近哪一种？</p><div className="flex flex-wrap gap-2">{(['calm', 'anxious', 'low', 'irritable', 'overwhelmed'] as const).map((value) => <button key={value} type="button" onClick={() => setMood(value)} className={`rounded-full border px-3 py-1.5 text-sm ${mood === value ? 'border-[#687b60] bg-[#e8eee3] text-[#405039]' : 'border-[#ddd7cd] bg-white text-[#7d776f]'}`}>{moodLabel(value)}</button>)}</div></div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3"><p className="text-sm font-medium">身体或感受（可选）</p><span className="text-xs text-[#928c83]">已选 {bodyState.length}/{BODY_STATE_LIMIT}</span></div>
        <div className="flex flex-wrap gap-2">{bodyStateOptions.map((value) => <button key={value} type="button" aria-pressed={bodyState.includes(value)} title={bodyState.includes(value) ? '点击取消' : '点击选择'} onClick={() => toggleBodyState(value)} className={`rounded-full border px-3 py-1.5 text-sm ${bodyState.includes(value) ? 'border-[#687b60] bg-[#e8eee3] text-[#405039]' : 'border-[#ddd7cd] bg-white text-[#7d776f]'}`}>{value}</button>)}</div>
        {customBodyStates.length > 0 && <div className="mt-2 flex flex-wrap gap-2" aria-label="已添加的自定义感受">{customBodyStates.map((value) => <button key={value} type="button" onClick={() => toggleBodyState(value)} className="rounded-full border border-[#8c9c82] bg-[#f0f4ed] px-3 py-1.5 text-sm text-[#4b5b45]" title="点击取消">{value} <span aria-hidden="true">×</span></button>)}</div>}
        <div className="mt-3 flex gap-2">
          <input value={customBodyState} onChange={(event) => setCustomBodyState(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomBodyState() } }} maxLength={40} placeholder="添加自己的感受" className="min-w-0 flex-1 rounded-xl border border-[#d9d2c8] bg-[#fbfaf7] px-3 py-2 text-sm outline-none focus:border-[#87997d]" />
          <button type="button" onClick={addCustomBodyState} disabled={!customBodyState.trim()} className="shrink-0 rounded-xl border border-[#cbd4c5] bg-[#edf2e9] px-4 py-2 text-sm text-[#506048] disabled:cursor-not-allowed disabled:opacity-50">添加</button>
        </div>
        {bodyStateNotice && <p className="mt-2 text-xs leading-5 text-[#8a6b45]" role="status" aria-live="polite">{bodyStateNotice}</p>}
      </div>
      <label className="block"><span className="mb-2 block text-sm font-medium">想留一句话吗？（可选）</span><textarea value={note} maxLength={200} rows={3} onChange={(event) => setNote(event.target.value)} placeholder="例如：论文没开始，脑子停不下来。" className="w-full resize-none rounded-2xl border border-[#d9d2c8] bg-[#fbfaf7] px-4 py-3 text-sm outline-none focus:border-[#87997d]" /></label>
      <label className="flex items-center gap-2 text-sm text-[#656159]"><input type="checkbox" checked={shareWithChat} onChange={(event) => setShareWithChat(event.target.checked)} className="accent-[#687b60]" />聊天时让 Lutealark 参考今天的状态</label>
      <div className="flex flex-wrap gap-3"><button type="button" onClick={save} className="rounded-2xl bg-[#687b60] px-5 py-3 text-sm font-medium text-white hover:bg-[#586c51]">{existing ? `更新${isToday ? '今天' : '这天'}的状态` : '保存今天的状态'}</button>{onCancel && <button type="button" onClick={onCancel} className="rounded-2xl border border-[#d6d0c6] bg-white px-5 py-3 text-sm text-[#6f6961]">取消编辑</button>}</div>
    </div>
  </section>
}

function CheckinHistory({ checkins, busyDate, onEdit, onDelete }: { checkins: DailyCheckIn[]; busyDate: string; onEdit: (checkin: DailyCheckIn) => void; onDelete: (checkin: DailyCheckIn) => void }) {
  const recent = [...checkins].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 30)
  if (recent.length === 0) return null

  return <section className="mt-6 rounded-[24px] border border-[#dfd9cf] bg-white/80 p-5 shadow-[0_14px_45px_rgba(73,66,55,.07)] md:p-6">
    <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-medium tracking-[.18em] text-[#829078]">CHECK-IN HISTORY</p><h2 className="mt-2 font-serif text-2xl font-semibold text-[#353c32]">状态记录</h2></div><p className="text-xs text-[#8b847b]">可编辑、删除 · 最多 30 天</p></div>
    <div className="mt-5 space-y-2">
      {recent.map((checkin) => <div key={checkin.date} className="flex items-center gap-3 rounded-2xl border border-[#e7e1d8] bg-[#fbfaf7] px-4 py-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${moodDotClass(checkin.mood)}`} aria-hidden="true" />
        <span className="w-10 shrink-0 text-sm text-[#79736a]">{formatShortDate(checkin.date)}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${moodTagClass(checkin.mood)}`}>{moodLabel(checkin.mood)}</span>
        <span className="ml-auto shrink-0 text-xs text-[#6f6a62]">能量 {checkin.energy}/5</span>
        {checkin.bodyState.length > 0 && <span className="hidden text-xs text-[#938c82] sm:inline">{checkin.bodyState.join(' · ')}</span>}
        <div className="flex shrink-0 gap-2 text-xs"><button type="button" disabled={busyDate === checkin.date} onClick={() => onEdit(checkin)} className="rounded-full border border-[#d6d0c6] px-2.5 py-1 disabled:opacity-50">编辑</button><button type="button" disabled={busyDate === checkin.date} onClick={() => onDelete(checkin)} className="rounded-full border border-[#e2c6bc] px-2.5 py-1 text-[#965d49] disabled:opacity-50">删除</button></div>
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
    <p className="mt-3 text-xs leading-5 text-[#7d8877]">这只是你主动留下的记录趋势，不代表诊断。</p>
  </section>
}

function CycleStrip({ result, checkin }: { result: CycleResult; checkin: DailyCheckIn | null }) {
  const todayCheckin = checkin?.date === todayString() ? checkin : null
  return <div className="mb-3 flex items-center justify-between rounded-xl border border-[#d8dfd2] bg-[#f4f7f1] px-4 py-2 text-xs text-[#596653]"><span>🌙 {result.phaseName} · 周期第 {result.dayOfCycle} 天</span><span className="text-[11px]">{todayCheckin ? `自评能量 ${todayCheckin.energy}/5 · ${moodLabel(todayCheckin.mood)}` : `能量 ${result.energyValue}/10`}{result.isBufferMode ? ' · 缓冲模式' : ''}</span></div>
}

function Welcome({ onPrompt, disabled }: { onPrompt: (text: string) => Promise<void>; disabled: boolean }) {
  const [promptCounts, setPromptCounts] = useState<QuickPromptCounts>(loadQuickPromptCounts)
  const orderedPrompts = orderQuickPrompts(promptCounts)

  const handlePrompt = (prompt: typeof quickPrompts[number]) => {
    const nextCounts = { ...promptCounts, [prompt.id]: (promptCounts[prompt.id] ?? 0) + 1 }
    setPromptCounts(nextCounts)
    saveQuickPromptCounts(nextCounts)
    void onPrompt(prompt.text)
  }

  return <div className="welcome-shell scrollbar mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col justify-center overflow-y-auto py-2 text-center"><div className="welcome-mark mx-auto mb-2 grid h-12 w-12 shrink-0 place-items-center rounded-[18px] bg-[#e2e8dc] text-lg">🕊️</div><p className="welcome-kicker text-[10px] tracking-[.2em] text-[#829078]">WELCOME BACK</p><h2 className="mt-1.5 font-serif text-[27px] font-semibold leading-tight text-[#353c32]">不用整理好，也可以从这里说起。</h2><p className="welcome-description mx-auto mt-1.5 max-w-lg text-xs leading-5 text-[#7d776f]">我会结合你愿意提供的周期节奏，把下一步变轻一点。</p><div className="welcome-actions mt-3 grid grid-cols-2 gap-2 text-left sm:grid-cols-4">{orderedPrompts.map(({ prompt }) => <button key={prompt.id} disabled={disabled} onClick={() => handlePrompt(prompt)} className="flex min-h-[66px] items-center gap-2 rounded-[14px] border border-[#ddd7cd] bg-white/75 px-3 py-2 hover:border-[#aebba5] disabled:opacity-60"><span className="shrink-0 text-base">{prompt.emoji}</span><span className="min-w-0"><span className="block text-xs font-medium text-[#514f49]">{prompt.label}</span><span className="mt-0.5 block text-[10px] leading-4 text-[#969087]">{prompt.hint}</span></span></button>)}</div></div>
}

function MessageBubble({ message, onAction, onMemoryCandidateDecision }: { message: ChatMessage; onAction: (action: string) => void; onMemoryCandidateDecision: (messageId: string, candidate: MemoryCandidate, decision: 'save' | 'dismiss') => Promise<void> }) {
  const [memoryConsent, setMemoryConsent] = useState(false)
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [memoryError, setMemoryError] = useState('')
  if (message.role === 'user') {
    return <div className="flex justify-end pl-10"><div className="max-w-[82%] rounded-[22px] rounded-br-md bg-[#66765f] px-5 py-3.5 text-[15px] leading-7 text-white">{message.content}</div></div>
  }

  const actionLabel = message.action ? labelForAction(message.action) : null
  const sources = message.mode === 'offline' ? [] : (message.sources ?? []).slice(0, 3)
  const decideMemory = async (decision: 'save' | 'dismiss') => {
    if (!message.memoryCandidate || (decision === 'save' && !memoryConsent)) return
    setMemoryBusy(true)
    setMemoryError('')
    try {
      await onMemoryCandidateDecision(message.id, message.memoryCandidate, decision)
    } catch (cause) {
      setMemoryError(getErrorMessage(cause))
    } finally {
      setMemoryBusy(false)
    }
  }
  return (
    <div className="flex items-start gap-3 pr-4 md:pr-12">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[14px] bg-[#dfe7d9]">♩</div>
      <div className="min-w-0 max-w-full">
        {message.mode === 'offline' && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[#d8ad7e] bg-[#fff3df] px-3 py-1 text-xs font-medium text-[#875d31]" role="status">
            <span aria-hidden="true">●</span> 离线基础支持 · 未使用 OpenTrek/RAG
          </div>
        )}
        <div className={`whitespace-pre-wrap rounded-[22px] rounded-tl-md border px-5 py-4 text-[15px] leading-7 ${message.mode === 'offline' ? 'border-[#e5cba9] bg-[#fffaf0] text-[#554c41]' : 'border-[#e0dbd2] bg-white/85 text-[#4e4a44]'}`}>{message.content}</div>
        {sources.length > 0 && <KnowledgeSources sources={sources} />}
        {message.memoryCandidate && (
          <div className="mt-3 rounded-2xl border border-[#cfd9c9] bg-[#f3f7f0] p-4 text-sm text-[#52604d]">
            <p className="text-xs font-medium tracking-[.12em] text-[#718169]">LONG-TERM MEMORY CANDIDATE</p>
            <p className="mt-2 leading-6">{message.memoryCandidate.summary}</p>
            {message.memoryCandidateStatus === 'saved' ? (
              <p className="mt-3 text-xs font-medium text-[#58704f]">✓ 已经你明确同意保存，可在“对话档案”中编辑、归档或删除。</p>
            ) : message.memoryCandidateStatus === 'dismissed' ? (
              <p className="mt-3 text-xs text-[#7f7b73]">未保存这条候选记忆。</p>
            ) : (
              <>
                <label className="mt-3 flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={memoryConsent} onChange={(event) => setMemoryConsent(event.target.checked)} className="mt-1 accent-[#687b60]" />我已核对摘要，并明确同意把它保存为长期记忆。</label>
                <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={memoryBusy || !memoryConsent} onClick={() => void decideMemory('save')} className="rounded-full bg-[#687b60] px-4 py-2 text-xs font-medium text-white disabled:opacity-40">{memoryBusy ? '正在处理…' : '同意并保存'}</button><button type="button" disabled={memoryBusy} onClick={() => void decideMemory('dismiss')} className="rounded-full border border-[#cfd5cb] bg-white px-4 py-2 text-xs disabled:opacity-50">不保存</button></div>
                {memoryError && <p className="mt-2 text-xs text-[#9a4f3b]" role="alert">{memoryError}</p>}
              </>
            )}
          </div>
        )}
        {message.action && actionLabel && (
          <button
            type="button"
            onClick={() => onAction(message.action!)}
            className="mt-3 rounded-full bg-[#687b60] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#596c52]"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

function KnowledgeSources({ sources }: { sources: KnowledgeSource[] }) {
  return (
    <details className="mt-2 rounded-2xl border border-[#e1ddd5] bg-white/65 px-4 py-2.5 text-sm text-[#68635b]">
      <summary className="cursor-pointer select-none font-medium text-[#596653]">参考来源（{sources.length}）</summary>
      <ol className="mt-3 space-y-3 border-t border-[#e8e3da] pt-3">
        {sources.map((source, index) => (
          <li key={`${source.sourceId ?? source.title}-${index}`} className="leading-5">
            <div className="flex gap-2">
              <span className="shrink-0 text-xs text-[#899383]">{index + 1}.</span>
              <div className="min-w-0">
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer" className="break-words font-medium text-[#586b51] underline decoration-[#aebba5] underline-offset-2">{source.title}</a>
                ) : <span className="break-words font-medium text-[#555f50]">{source.title}</span>}
                {source.excerpt && <p className="mt-1 line-clamp-3 text-xs leading-5 text-[#89837b]">{source.excerpt}</p>}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </details>
  )
}

function TypingBubble() { return <div className="flex gap-3"><div className="grid h-9 w-9 place-items-center rounded-[14px] bg-[#dfe7d9]">♩</div><div className="flex h-12 items-center gap-1.5 rounded-[20px] bg-white px-5">{[0, 1, 2].map((i) => <span key={i} style={{ animationDelay: `${i * 140}ms` }} className="typing-dot h-1.5 w-1.5 rounded-full bg-[#84927a]" />)}</div></div> }

function NavButton({ active, onClick, icon, label, badge, disabled }: { active: boolean; onClick: () => void; icon: string; label: string; badge?: string; disabled?: boolean }) { return <button type="button" disabled={disabled} onClick={onClick} className={`flex w-full items-center gap-2 rounded-[14px] px-3 py-2.5 text-xs ${active ? 'bg-white text-[#465341] shadow-sm' : 'text-[#8d877e]'}`}><span className="shrink-0 text-base">{icon}</span><span className="min-w-0 flex-1 whitespace-nowrap text-left">{label}</span>{badge && <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-[#e4dfd5] px-2 py-0.5 text-[9px]">{badge}</span>}</button> }

function MobileNav({ view, openView }: { view: AppView; openView: (view: AppView) => void }) {
  return (
    <nav className="grid h-14 grid-cols-7 border-t border-[#ded8ce] bg-[#f5f1e9] md:hidden">
      <button onClick={() => openView('agent')} className={view === 'agent' ? 'text-[#52614d]' : 'text-[#999]'}>
        ◌<span className="block text-[10px]">聊一聊</span>
      </button>
      <button onClick={() => openView('cycle')} className={view === 'cycle' ? 'text-[#52614d]' : 'text-[#999]'}>
        ↻<span className="block text-[10px]">周期</span>
      </button>
      <button onClick={() => openView('breathing')} className={view === 'breathing' ? 'text-[#52614d]' : 'text-[#999]'}>
        ♧<span className="block text-[10px]">呼吸</span>
      </button>
      <button onClick={() => openView('tools')} className={view === 'tools' ? 'text-[#52614d]' : 'text-[#999]'}>✿<span className="block text-[10px]">工具</span></button>
      <button onClick={() => openView('memory')} className={view === 'memory' ? 'text-[#52614d]' : 'text-[#999]'}>▤<span className="block text-[10px]">档案</span></button>
      <button onClick={() => openView('points')} className={view === 'points' ? 'text-[#52614d]' : 'text-[#999]'}>☆<span className="block text-[10px]">积分</span></button>
      <button onClick={() => openView('account')} className={view === 'account' ? 'text-[#52614d]' : 'text-[#999]'}>○<span className="block text-[10px]">账号</span></button>
    </nav>
  )
}

function moodLabel(mood: DailyCheckIn['mood']) {
  return ({ calm: '平稳', anxious: '焦虑', low: '低落', irritable: '烦躁', overwhelmed: '很乱' } as const)[mood]
}

function moodFromFeelings(feelings: string[], fallback: DailyCheckIn['mood'] = 'calm'): DailyCheckIn['mood'] {
  const value = feelings.join('')
  if (/(崩溃|超载|懵|麻木)/.test(value)) return 'overwhelmed'
  if (/(焦虑|紧绷)/.test(value)) return 'anxious'
  if (/(低落|疲惫|痛经|头痛)/.test(value)) return 'low'
  if (/(烦躁|愤怒)/.test(value)) return 'irritable'
  if (/(平静|放松|开心|专注)/.test(value)) return 'calm'
  return fallback
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
  const today = todayString()
  const cutoff = addDateOnlyDays(today, 1 - days)
  return checkins.filter((checkin) => checkin.date >= cutoff && checkin.date <= today)
}

function isValidDailyCheckin(value: unknown): value is DailyCheckIn {
  if (!value || typeof value !== 'object') return false
  const checkin = value as DailyCheckIn
  return isValidDateOnly(checkin.date)
    && Number.isInteger(checkin.energy)
    && checkin.energy >= 1
    && checkin.energy <= 5
    && ['calm', 'anxious', 'low', 'irritable', 'overwhelmed'].includes(checkin.mood)
    && Array.isArray(checkin.bodyState)
    && checkin.bodyState.length <= BODY_STATE_LIMIT
    && checkin.bodyState.every((item) => typeof item === 'string' && item.trim().length >= 1 && item.length <= 40)
    && (checkin.note === undefined || (typeof checkin.note === 'string' && checkin.note.trim().length <= 200))
    && typeof checkin.shareWithChat === 'boolean'
}

function loadQuickPromptCounts(): QuickPromptCounts {
  try {
    const value = localStorage.getItem(QUICK_PROMPT_COUNTS_STORAGE_KEY)
    if (!value) return {}
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([id, count]) => (
      quickPrompts.some((prompt) => prompt.id === id)
      && typeof count === 'number'
      && Number.isSafeInteger(count)
      && count >= 0
    )))
  } catch { return {} }
}

function saveQuickPromptCounts(counts: QuickPromptCounts) {
  try { localStorage.setItem(QUICK_PROMPT_COUNTS_STORAGE_KEY, JSON.stringify(counts)) } catch { /* localStorage may be unavailable */ }
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructorLike | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function getSpeechRecognitionErrorMessage(error: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') return '没有获得麦克风权限，可以在浏览器设置中允许后再试。'
  if (error === 'audio-capture') return '暂时找不到可用的麦克风，请检查设备后再试。'
  if (error === 'no-speech') return '没有听到语音，可以靠近麦克风后再试一次。'
  if (error === 'network') return '语音识别服务暂时无法连接，请稍后再试。'
  return '语音输入已停止，可以继续使用键盘。'
}

function loadDailyCheckins(subject: DataSubject = getActiveDataSubject()): DailyCheckIn[] {
  try {
    const key = scopedStorageKey(DAILY_CHECKINS_STORAGE_KEY, subject)
    const scopedValue = localStorage.getItem(key)
    const legacyHistory = subject.kind === 'device' && !scopedValue
      ? localStorage.getItem(LEGACY_DAILY_CHECKINS_STORAGE_KEY)
      : null
    const historyValue = scopedValue ?? legacyHistory
    if (historyValue) {
      const parsed = JSON.parse(historyValue) as unknown
      if (Array.isArray(parsed)) {
        const normalized = normalizeDailyCheckins(parsed.filter(isValidDailyCheckin))
        if (legacyHistory) {
          persistDailyCheckins(normalized, subject)
          localStorage.removeItem(LEGACY_DAILY_CHECKINS_STORAGE_KEY)
        }
        return normalized
      }
    }

    const legacyValue = subject.kind === 'device'
      ? localStorage.getItem(LEGACY_DAILY_CHECKIN_STORAGE_KEY)
      : null
    if (!legacyValue) return []
    const legacy = JSON.parse(legacyValue) as unknown
    const normalized = isValidDailyCheckin(legacy) ? [legacy] : []
    persistDailyCheckins(normalized, subject)
    return normalized
  } catch { return [] }
}

async function reconcilePersonalData(
  localCycleSettings: CycleSettings | null,
  localDailyCheckins: DailyCheckIn[],
  localBreathingRecords: BreathingRecord[],
  subject: DataSubject,
  isCurrent: () => boolean = () => true,
) {
  const remote = await fetchPersonalData(subject)
  if (!isCurrent()) {
    return {
      cycleSettings: localCycleSettings,
      dailyCheckins: localDailyCheckins,
      breathingRecords: localBreathingRecords,
      syncFailed: false,
      stale: true,
    }
  }
  discardUnavailablePendingData({
    hasCycleSettings: localCycleSettings !== null,
    checkinDates: localDailyCheckins.map((checkin) => checkin.date),
    breathingRecordIds: localBreathingRecords.map((record) => record.id),
  }, subject)
  const pending = getPendingPersonalData(subject)
  const reconciled = reconcilePersonalDataCollections({
    cycleSettings: localCycleSettings,
    dailyCheckins: localDailyCheckins,
    breathingRecords: localBreathingRecords,
  }, remote, pending)

  persistCycleSettings(reconciled.cycleSettings, subject)
  const nextDailyCheckins = normalizeDailyCheckins(reconciled.dailyCheckins)
  persistDailyCheckins(nextDailyCheckins, subject)
  const nextBreathingRecords = replaceBreathingRecords(reconciled.breathingRecords, subject)

  // Durable tombstones are submitted before upserts so stale server rows cannot
  // reappear after a refresh. Per-entity mutation queues preserve later user edits.
  const deletionFailed = await runSyncTasks([
    ...reconciled.checkinDatesToDelete.map((date) => () => deleteRemoteDailyCheckin(date, subject)),
    ...reconciled.breathingRecordIdsToDelete.map((id) => () => deleteRemoteBreathingRecord(id, subject)),
  ])
  const uploadFailed = await runSyncTasks([
    ...(reconciled.cycleToUpsert ? [() => syncCycleSettings(reconciled.cycleToUpsert as CycleSettings, subject)] : []),
    ...reconciled.checkinsToUpsert.map((checkin) => () => syncDailyCheckin(checkin, subject)),
    ...reconciled.breathingRecordsToUpsert.map((record) => () => syncBreathingRecord(record, subject)),
  ])
  const stale = !isCurrent()
  return {
    cycleSettings: reconciled.cycleSettings,
    dailyCheckins: nextDailyCheckins,
    breathingRecords: nextBreathingRecords,
    syncFailed: deletionFailed || uploadFailed,
    stale,
  }
}

async function runSyncTasks(tasks: Array<() => Promise<unknown>>) {
  let nextTask = 0
  let failed = false
  const worker = async () => {
    while (nextTask < tasks.length) {
      const task = tasks[nextTask]
      nextTask += 1
      try { await task() } catch { failed = true }
    }
  }
  const workers = Array.from({ length: Math.min(4, tasks.length) }, () => worker())
  await Promise.all(workers)
  return failed
}

function normalizeDailyCheckins(checkins: DailyCheckIn[]): DailyCheckIn[] {
  const seen = new Set<string>()
  return checkins
    .filter(isValidDailyCheckin)
    .sort((left, right) => right.date.localeCompare(left.date))
    .filter((checkin) => {
      if (seen.has(checkin.date)) return false
      seen.add(checkin.date)
      return true
    })
    .slice(0, 30)
}

function persistDailyCheckins(checkins: DailyCheckIn[], subject: DataSubject = getActiveDataSubject()) {
  try {
    localStorage.setItem(scopedStorageKey(DAILY_CHECKINS_STORAGE_KEY, subject), JSON.stringify(checkins.slice(0, 30)))
    if (subject.kind === 'device') {
      localStorage.removeItem(LEGACY_DAILY_CHECKINS_STORAGE_KEY)
      localStorage.removeItem(LEGACY_DAILY_CHECKIN_STORAGE_KEY)
    }
  } catch {
    // Keep the in-memory state usable when browser storage is unavailable.
  }
}

function persistCycleSettings(settings: CycleSettings | null, subject: DataSubject = getActiveDataSubject()) {
  try {
    const key = scopedStorageKey(STORAGE_KEY, subject)
    if (settings) localStorage.setItem(key, JSON.stringify(settings))
    else localStorage.removeItem(key)
    if (subject.kind === 'device') localStorage.removeItem(LEGACY_CYCLE_STORAGE_KEY)
  } catch { /* keep in memory */ }
}

function loadCycleSettings(subject: DataSubject = getActiveDataSubject()): CycleSettings | null {
  try {
    const key = scopedStorageKey(STORAGE_KEY, subject)
    const scopedValue = localStorage.getItem(key)
    const legacyValue = subject.kind === 'device' && !scopedValue
      ? localStorage.getItem(LEGACY_CYCLE_STORAGE_KEY)
      : null
    const value = scopedValue ?? legacyValue
    if (!value) return null
    const parsed = JSON.parse(value) as CycleSettings
    const normalized = isValidDateOnly(parsed.lastPeriodDate)
      && Number.isInteger(parsed.cycleLength)
      && parsed.cycleLength >= 21
      && parsed.cycleLength <= 35
      ? parsed
      : null
    if (legacyValue) persistCycleSettings(normalized, subject)
    return normalized
  } catch { return null }
}

function clearPersonalDataLocalCache(subject: DataSubject) {
  try {
    localStorage.removeItem(scopedStorageKey(STORAGE_KEY, subject))
    localStorage.removeItem(scopedStorageKey(DAILY_CHECKINS_STORAGE_KEY, subject))
  } catch {
    // The Zustand subject switch still clears the visible in-memory state.
  }
  clearBreathingRecordsCache(subject)
}

function transferPendingPersonalDataCache(from: DataSubject, to: DataSubject): boolean {
  if (dataSubjectKey(from) === dataSubjectKey(to)) return true
  const sourcePending = getPendingPersonalData(from)
  const targetPending = getPendingPersonalData(to)
  const source = {
    cycleSettings: loadCycleSettings(from),
    dailyCheckins: loadDailyCheckins(from),
    breathingRecords: loadBreathingRecords(from),
  }
  const target = {
    cycleSettings: loadCycleSettings(to),
    dailyCheckins: loadDailyCheckins(to),
    breathingRecords: loadBreathingRecords(to),
  }
  const sourceCheckinDates = new Set(sourcePending.checkinDates)
  const sourceBreathingIds = new Set(sourcePending.breathingRecordIds)
  const sourceDeletedCheckins = new Set(sourcePending.deletedCheckinDates)
  const sourceDeletedBreathing = new Set(sourcePending.deletedBreathingRecordIds)
  const combinedPending = {
    cycle: sourcePending.cycle || targetPending.cycle,
    checkinDates: [...new Set([...targetPending.checkinDates, ...sourcePending.checkinDates])]
      .filter((date) => !sourceDeletedCheckins.has(date)),
    breathingRecordIds: [...new Set([...targetPending.breathingRecordIds, ...sourcePending.breathingRecordIds])]
      .filter((id) => !sourceDeletedBreathing.has(id)),
    deletedCheckinDates: [...new Set([...targetPending.deletedCheckinDates, ...sourcePending.deletedCheckinDates])]
      .filter((date) => !sourceCheckinDates.has(date)),
    deletedBreathingRecordIds: [...new Set([
      ...targetPending.deletedBreathingRecordIds,
      ...sourcePending.deletedBreathingRecordIds,
    ])].filter((id) => !sourceBreathingIds.has(id)),
  }
  const combinedLocal = {
    cycleSettings: sourcePending.cycle ? source.cycleSettings : target.cycleSettings,
    dailyCheckins: normalizeDailyCheckins([
      ...source.dailyCheckins.filter((checkin) => sourceCheckinDates.has(checkin.date)),
      ...target.dailyCheckins.filter((checkin) => !sourceCheckinDates.has(checkin.date)),
    ]),
    breathingRecords: [
      ...source.breathingRecords.filter((record) => sourceBreathingIds.has(record.id)),
      ...target.breathingRecords.filter((record) => !sourceBreathingIds.has(record.id)),
    ],
  }
  const migrated = reconcilePersonalDataCollections(combinedLocal, target, combinedPending)
  persistCycleSettings(migrated.cycleSettings, to)
  persistDailyCheckins(migrated.dailyCheckins, to)
  replaceBreathingRecords(migrated.breathingRecords, to)

  const verifiedCycle = JSON.stringify(loadCycleSettings(to)) === JSON.stringify(migrated.cycleSettings)
  const verifiedCheckins = migrated.dailyCheckins.every((checkin) => (
    loadDailyCheckins(to).some((candidate) => candidate.date === checkin.date)
  ))
  const verifiedBreathing = migrated.breathingRecords.every((record) => (
    loadBreathingRecords(to).some((candidate) => candidate.id === record.id)
  ))
  return verifiedCycle && verifiedCheckins && verifiedBreathing
    && transferPendingPersonalData(from, to)
}

function todayString() {
  const parts = businessDateFormatter.formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addDateOnlyDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function getErrorMessage(cause: unknown) { return cause instanceof Error ? cause.message : '暂时没有连接成功，请稍后再试。' }

function toolTargetFromSearch(search: string): 'plan' | 'focus' | 'environment' | 'movement' | null {
  const target = new URLSearchParams(search).get('tool')
  return target === 'plan' || target === 'focus' || target === 'environment' || target === 'movement' ? target : null
}

export default App
