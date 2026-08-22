import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  deleteAccount,
  exportAccountData,
  getAuthStatus,
  loginAccount,
  logoutAccount,
  normalizeAuthEmail,
  registerAccount,
  saveAccountExport,
  type AuthStatus,
} from '../lib/auth-api'
import { parseChatMetadata } from '../lib/chat-metadata'
import {
  createConversation,
  createMemory,
  deleteConversation,
  deleteDailyPlan,
  deleteMemory,
  getConversation,
  getDailyPlan,
  getPointsSummary,
  listConversations,
  listMemories,
  recordActivity,
  updateConversation,
  updateMemory,
  updateWeeklyPointsGoal,
  upsertDailyPlan,
  type Conversation,
  type MemoryEntry,
  type MemoryKind,
  type PointEventType,
  type PointsSummary,
} from '../lib/product-api'
import { useAppStore, type ChatMessage } from '../store/app-store'
import {
  flushActivityOutbox,
  loadActivityOutbox,
  loadDailyPlanCache,
  loadFocusDuration,
  loadToolEnergy,
  markDailyPlanSynced,
  persistFocusDuration,
  persistToolEnergy,
  queueActivity,
  reconcileDailyPlanCache,
  saveDailyPlanMutation,
  saveDailyPlanRemote,
  type QueuedActivity,
} from '../lib/product-local'
import { getActiveDataSubject } from '../lib/data-subject'
import {
  EnvironmentTuner,
  FocusTimer,
  MicroMovementTool,
  SensoryLoadReducer,
  TodayGentlePlan,
} from './gentle-tools'
import {
  normalizeGentlePlan,
  type FocusDurationMinutes,
  type GentlePlanItem,
} from './gentle-tools-logic'

const BUSINESS_TIME_ZONE = 'Asia/Shanghai'

type ToolTarget = 'plan' | 'focus' | 'environment' | 'movement' | null

export function ToolsPage({
  target,
  suggestedEnergy,
  isBufferMode,
}: {
  target: ToolTarget
  suggestedEnergy: number
  isBufferMode: boolean
}) {
  const [subject] = useState(getActiveDataSubject)
  const today = businessDate()
  const [planItems, setPlanItems] = useState<GentlePlanItem[]>(() => (
    loadDailyPlanCache(subject, today)?.items ?? []
  ))
  const [syncStatus, setSyncStatus] = useState<'loading' | 'syncing' | 'synced' | 'local'>('loading')
  const [activityNotice, setActivityNotice] = useState('')
  const [manualEnergy, setManualEnergy] = useState(() => loadToolEnergy(subject, today, suggestedEnergy))
  const [focusDuration, setFocusDuration] = useState<FocusDurationMinutes>(() => (
    loadFocusDuration(subject, today) ?? recommendFocusDuration(suggestedEnergy, isBufferMode)
  ))
  const syncVersionRef = useRef(0)
  const planSyncQueueRef = useRef<Promise<void>>(Promise.resolve())
  const activityFlushRef = useRef<Promise<void> | null>(null)

  const enqueuePlanSync = useCallback((items: GentlePlanItem[]) => {
    const operation = planSyncQueueRef.current
      .catch(() => undefined)
      .then(() => syncPlan(items, today))
    planSyncQueueRef.current = operation.then(() => undefined, () => undefined)
    return operation
  }, [today])

  useEffect(() => {
    const element = target ? document.getElementById(`tool-${target}`) : null
    if (!element) return
    const frame = window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      element.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [target])

  useEffect(() => {
    let active = true
    const local = loadDailyPlanCache(subject, today)
    const initialVersion = syncVersionRef.current
    getDailyPlan(today)
      .then(async (remote) => {
        if (!active || syncVersionRef.current !== initialVersion) return
        const remoteItems = remote?.items.map((item) => ({
          id: item.id,
          text: item.content,
          completed: item.completedAt !== null,
        })) ?? null
        const reconciled = reconcileDailyPlanCache(local, remoteItems)
        setPlanItems(reconciled.items)
        if (reconciled.shouldSync) {
          await enqueuePlanSync(reconciled.items)
          if (active && syncVersionRef.current === initialVersion) {
            markDailyPlanSynced(subject, today)
          }
        } else {
          saveDailyPlanRemote(subject, today, reconciled.items)
        }
        if (active && syncVersionRef.current === initialVersion) setSyncStatus('synced')
      })
      .catch(() => active && setSyncStatus('local'))
    return () => { active = false }
  }, [enqueuePlanSync, subject, today])

  const changePlan = (next: GentlePlanItem[]) => {
    const normalized = normalizeGentlePlan(next)
    setPlanItems(normalized)
    saveDailyPlanMutation(subject, today, normalized)
    setSyncStatus('syncing')
    const version = ++syncVersionRef.current
    void enqueuePlanSync(normalized)
      .then(() => {
        if (syncVersionRef.current === version) {
          markDailyPlanSynced(subject, today)
          setSyncStatus('synced')
        }
      })
      .catch(() => {
        if (syncVersionRef.current === version) setSyncStatus('local')
      })
  }

  const flushActivities = useCallback(async (currentActivityId?: string) => {
    if (activityFlushRef.current) return activityFlushRef.current
    let currentResult: Awaited<ReturnType<typeof recordActivity>> | null = null
    const operation = flushActivityOutbox(subject, async (activity) => {
      const result = await recordActivity(activity)
      if (activity.id === currentActivityId) currentResult = result
    }).then(({ sent, remaining }) => {
      if (currentResult) {
        setActivityNotice(currentResult.pointsAwarded > 0
          ? `已记录，获得 ${currentResult.pointsAwarded} 积分。`
          : '已记录，今天的同类奖励已领取。')
      } else if (remaining > 0) {
        setActivityNotice('已在本机保留完成记录，恢复连接后会重试。')
      } else if (sent > 0) {
        setActivityNotice(`已补同步 ${sent} 条完成记录。`)
      }
    }).finally(() => { activityFlushRef.current = null })
    activityFlushRef.current = operation
    return operation
  }, [subject])

  useEffect(() => {
    if (loadActivityOutbox(subject).length > 0) void flushActivities()
  }, [flushActivities, subject])

  const saveActivity = async (input: QueuedActivity) => {
    setActivityNotice('正在保存完成记录…')
    const flushWasRunning = activityFlushRef.current !== null
    queueActivity(subject, input)
    await flushActivities(input.id)
    if (flushWasRunning && loadActivityOutbox(subject).some((entry) => entry.id === input.id)) {
      await flushActivities(input.id)
    }
  }

  const recommendedDuration = recommendFocusDuration(manualEnergy, isBufferMode)
  const adjustEnergy = (value: number) => {
    const nextEnergy = Math.max(1, Math.min(5, Math.round(value)))
    setManualEnergy(nextEnergy)
    persistToolEnergy(subject, today, nextEnergy)
    const nextDuration = recommendFocusDuration(nextEnergy, isBufferMode)
    setFocusDuration(nextDuration)
    persistFocusDuration(subject, today, nextDuration)
  }

  return (
    <section className="soft-grid scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[.18em] text-[#829078]">GENTLE TOOLKIT</p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-[#353c32]">今天可以用的小工具</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7d776f]">不需要全部做。选一个最能减轻当下负担的就好。</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs ${syncStatus === 'synced' ? 'bg-[#e5eee1] text-[#506747]' : syncStatus === 'local' ? 'bg-[#f7eadb] text-[#8b6341]' : 'bg-[#eeeae2] text-[#817a71]'}`} role="status">
            {syncStatus === 'loading' ? '正在读取计划' : syncStatus === 'syncing' ? '正在同步计划' : syncStatus === 'synced' ? '计划已同步' : '计划已保存在本机'}
          </span>
        </div>

        <section className="mb-5 rounded-[22px] border border-[#d8dfd2] bg-[#f4f7f1] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[#4d5b47]">今天的专注建议：{recommendedDuration} 分钟</p>
              <p className="mt-1 text-xs leading-5 text-[#7d8877]">根据你手动设置的能量和周期缓冲模式计算，随时可以自己选择时长。</p>
            </div>
            <label className="min-w-[220px] text-sm text-[#5f665b]">
              <span className="mb-2 flex justify-between"><span>手动微调能量</span><strong>{manualEnergy}/5</strong></span>
              <input type="range" min="1" max="5" value={manualEnergy} onChange={(event) => adjustEnergy(Number(event.target.value))} className="w-full accent-[#687b60]" />
            </label>
          </div>
        </section>

        {activityNotice && <p className="mb-4 rounded-2xl border border-[#d8dfd2] bg-white/75 px-4 py-3 text-sm text-[#5a6754]" role="status">{activityNotice}</p>}

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <div id="tool-plan" tabIndex={-1} className="scroll-mt-4 outline-none">
            <TodayGentlePlan items={planItems} onChange={changePlan} />
          </div>
          <div id="tool-focus" tabIndex={-1} className="scroll-mt-4 outline-none">
            <FocusTimer
              key={`focus-${focusDuration}`}
              initialDurationMinutes={focusDuration}
              onDurationChange={(minutes) => {
                setFocusDuration(minutes)
                persistFocusDuration(subject, today, minutes)
              }}
              onComplete={(completion) => void saveActivity({
                id: completion.id,
                type: 'pomodoro',
                completedAt: completion.completedAt,
                durationSeconds: completion.durationMinutes * 60,
                metadata: { durationMinutes: completion.durationMinutes, recommendedDuration },
              })}
            />
          </div>
          <div id="tool-environment" tabIndex={-1} className="scroll-mt-4 space-y-5 outline-none">
            <EnvironmentTuner onApply={(application) => void saveActivity({
              id: application.id,
              type: 'environment',
              completedAt: application.appliedAt,
              note: application.suggestion,
              metadata: { kind: 'environment', sceneId: application.sceneId },
            })} />
            <SensoryLoadReducer onApply={(application) => void saveActivity({
              id: application.id,
              type: 'environment',
              completedAt: application.appliedAt,
              note: application.suggestion,
              metadata: { kind: 'sensory', sceneId: application.sceneId },
            })} />
          </div>
          <div id="tool-movement" tabIndex={-1} className="scroll-mt-4 outline-none">
            <MicroMovementTool onComplete={(completion) => void saveActivity({
              id: completion.id,
              type: 'micro_movement',
              completedAt: completion.completedAt,
              durationSeconds: completion.durationSeconds,
              note: completion.movementName,
              metadata: { movementId: completion.movementId },
            })} />
          </div>
        </div>
      </div>
    </section>
  )
}

export function MemoryPage() {
  const navigate = useNavigate()
  const resetConversation = useAppStore((state) => state.resetConversation)
  const setActiveConversationId = useAppStore((state) => state.setActiveConversationId)
  const setMessages = useAppStore((state) => state.setMessages)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [includeArchived, setIncludeArchived] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setConversations(await listConversations(includeArchived))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [includeArchived])

  useEffect(() => { void load() }, [load])

  const openConversation = async (conversation: Conversation) => {
    setBusyId(conversation.id)
    setError('')
    try {
      const detail = await getConversation(conversation.id)
      const restored: ChatMessage[] = detail.messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          id: message.id,
          role: message.role as 'user' | 'assistant',
          content: message.content,
          createdAt: message.createdAt,
          ...parseChatMetadata(message.metadata),
        }))
      resetConversation()
      setActiveConversationId(detail.id)
      setMessages(restored)
      navigate('/agent')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  const startConversation = async () => {
    setBusyId('new')
    setError('')
    try {
      const conversation = await createConversation({ title: '新对话' })
      resetConversation()
      setActiveConversationId(conversation.id)
      navigate('/agent')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  const rename = async (conversation: Conversation) => {
    const title = window.prompt('输入新标题', conversation.title ?? '')?.trim()
    if (!title || title === conversation.title) return
    setBusyId(conversation.id)
    try {
      await updateConversation(conversation.id, { title })
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  const toggleArchive = async (conversation: Conversation) => {
    setBusyId(conversation.id)
    try {
      await updateConversation(conversation.id, { archived: !conversation.archived })
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  const remove = async (conversation: Conversation) => {
    if (!window.confirm(`确定删除“${conversation.title ?? '未命名对话'}”及其全部消息吗？此操作无法撤销。`)) return
    setBusyId(conversation.id)
    try {
      await deleteConversation(conversation.id)
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="soft-grid scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[.18em] text-[#829078]">MEMORY & CONVERSATIONS</p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-[#353c32]">记忆与对话档案</h2>
            <p className="mt-2 text-sm leading-6 text-[#7d776f]">长期记忆只保存你明确同意的偏好、限制和长期目标；即时情绪或危机内容不会被自动归档。</p>
          </div>
        </div>

        <LongTermMemorySection />

        <div className="mt-8 flex flex-wrap items-end justify-between gap-3 border-t border-[#ded8ce] pt-7">
          <div><p className="text-xs font-medium tracking-[.18em] text-[#829078]">CONVERSATION ARCHIVE</p><h3 className="mt-1 font-serif text-2xl font-semibold text-[#3e473a]">对话档案</h3></div>
          <button type="button" disabled={busyId === 'new'} onClick={() => void startConversation()} className="rounded-full bg-[#687b60] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">＋ 新对话</button>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-[#68635b]"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} className="accent-[#687b60]" />显示已归档</label>
          <button type="button" onClick={() => void load()} className="text-sm text-[#607157] underline underline-offset-2">刷新</button>
        </div>

        {error && <p className="mt-4 rounded-2xl border border-[#e2b7a8] bg-[#fff5f0] px-4 py-3 text-sm text-[#8a5140]" role="alert">{error}</p>}
        {loading ? <p className="mt-6 text-sm text-[#8a847b]">正在读取对话…</p> : conversations.length === 0 ? (
          <div className="mt-6 rounded-[24px] border border-dashed border-[#d5cec3] bg-white/50 px-5 py-12 text-center text-sm text-[#8b857c]">还没有保存的对话。</div>
        ) : (
          <ul className="mt-5 space-y-3">
            {conversations.map((conversation) => (
              <li key={conversation.id} className={`rounded-[20px] border bg-white/80 p-4 ${conversation.archived ? 'border-[#ded8ce] opacity-70' : 'border-[#d8dfd2]'}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" disabled={busyId === conversation.id} onClick={() => void openConversation(conversation)} className="min-w-0 flex-1 text-left disabled:opacity-50">
                    <span className="block truncate font-medium text-[#46513f]">{conversation.title ?? '未命名对话'}</span>
                    <span className="mt-1 block text-xs text-[#8d877e]">{conversation.messageCount} 条消息 · {formatDateTime(conversation.lastMessageAt ?? conversation.updatedAt)}{conversation.archived ? ' · 已归档' : ''}</span>
                  </button>
                  <div className="flex shrink-0 gap-2 text-xs">
                    <button type="button" disabled={busyId === conversation.id} onClick={() => void rename(conversation)} className="rounded-full border border-[#d6d0c6] px-3 py-1.5">重命名</button>
                    <button type="button" disabled={busyId === conversation.id} onClick={() => void toggleArchive(conversation)} className="rounded-full border border-[#d6d0c6] px-3 py-1.5">{conversation.archived ? '恢复' : '归档'}</button>
                    <button type="button" disabled={busyId === conversation.id} onClick={() => void remove(conversation)} className="rounded-full border border-[#e2c6bc] px-3 py-1.5 text-[#965d49]">删除</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  preference: '偏好',
  constraint: '需要照顾的限制',
  long_term_goal: '长期目标',
}

function LongTermMemorySection() {
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [kind, setKind] = useState<MemoryKind>('preference')
  const [summary, setSummary] = useState('')
  const [consent, setConsent] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setMemories(await listMemories(includeArchived))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [includeArchived])

  useEffect(() => { void load() }, [load])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalized = summary.trim()
    if (!normalized || !consent) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await createMemory({
        id: crypto.randomUUID(),
        kind,
        summary: normalized,
        sourceTurnHash: `manual:${crypto.randomUUID()}`,
        consent: true,
      })
      setSummary('')
      setConsent(false)
      setNotice('已经你同意保存这条长期记忆。')
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const edit = async (memory: MemoryEntry) => {
    const nextSummary = window.prompt('编辑这条记忆', memory.summary)?.trim()
    if (!nextSummary || nextSummary === memory.summary) return
    setBusyId(memory.id)
    try {
      await updateMemory(memory.id, { summary: nextSummary })
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  const toggleArchive = async (memory: MemoryEntry) => {
    setBusyId(memory.id)
    try {
      await updateMemory(memory.id, { archived: !memory.archived })
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  const remove = async (memory: MemoryEntry) => {
    if (!window.confirm('确定删除这条长期记忆吗？此操作无法撤销。')) return
    setBusyId(memory.id)
    try {
      await deleteMemory(memory.id)
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="mt-6 rounded-[24px] border border-[#d8dfd2] bg-[#f4f7f1] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-medium tracking-[.16em] text-[#728467]">CONSENTED LONG-TERM MEMORY</p><h3 className="mt-1 font-serif text-2xl font-semibold text-[#42503c]">经同意保存的长期记忆</h3></div>
        <label className="flex items-center gap-2 text-xs text-[#6f786a]"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} className="accent-[#687b60]" />显示已归档</label>
      </div>

      <form onSubmit={submit} className="mt-4 rounded-2xl bg-white/75 p-4">
        <div className="grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)]">
          <label className="text-sm"><span className="mb-1.5 block text-xs text-[#777f72]">类型</span><select value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)} className="w-full rounded-xl border border-[#d6dcd2] bg-white px-3 py-2.5"><option value="preference">偏好</option><option value="constraint">需要照顾的限制</option><option value="long_term_goal">长期目标</option></select></label>
          <label className="text-sm"><span className="mb-1.5 block text-xs text-[#777f72]">摘要（最多 300 字）</span><input value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={300} placeholder="例如：我更喜欢把任务拆成 10 分钟内的小步骤" className="w-full rounded-xl border border-[#d6dcd2] bg-white px-3 py-2.5 outline-none focus:border-[#829478]" /></label>
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-[#606b5b]"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 accent-[#687b60]" />我明确同意将这条信息保存为长期记忆，并知道可随时编辑、归档或删除。</label>
        <button disabled={saving || !summary.trim() || !consent} className="mt-3 rounded-xl bg-[#687b60] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-45">{saving ? '正在保存…' : '同意并保存'}</button>
      </form>

      {error && <p className="mt-3 rounded-xl border border-[#e2b7a8] bg-[#fff5f0] px-3 py-2 text-sm text-[#8a5140]" role="alert">{error}</p>}
      {notice && <p className="mt-3 text-sm text-[#596b52]" role="status">{notice}</p>}
      {loading ? <p className="mt-4 text-sm text-[#7d8877]">正在读取长期记忆…</p> : memories.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-[#cdd7c8] px-4 py-5 text-center text-sm text-[#7d8877]">还没有经同意保存的长期记忆。</p> : (
        <ul className="mt-4 space-y-2">{memories.map((memory) => <li key={memory.id} className={`rounded-2xl border border-[#d9e0d4] bg-white/75 p-3 ${memory.archived ? 'opacity-65' : ''}`}><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><span className="rounded-full bg-[#e8eee4] px-2.5 py-1 text-[11px] text-[#53634d]">{MEMORY_KIND_LABELS[memory.kind]}</span><p className="mt-2 break-words text-sm leading-6 text-[#555f50]">{memory.summary}</p><p className="mt-1 text-[11px] text-[#92988e]">同意于 {formatDateTime(memory.consentedAt)}{memory.archived ? ' · 已归档' : ''}</p></div><div className="flex shrink-0 gap-2 text-xs"><button type="button" disabled={busyId === memory.id} onClick={() => void edit(memory)} className="rounded-full border border-[#d6dcd2] px-3 py-1.5">编辑</button><button type="button" disabled={busyId === memory.id} onClick={() => void toggleArchive(memory)} className="rounded-full border border-[#d6dcd2] px-3 py-1.5">{memory.archived ? '恢复' : '归档'}</button><button type="button" disabled={busyId === memory.id} onClick={() => void remove(memory)} className="rounded-full border border-[#e2c6bc] px-3 py-1.5 text-[#965d49]">删除</button></div></div></li>)}</ul>
      )}
    </section>
  )
}

const POINT_LABELS: Record<PointEventType, string> = {
  checkin: '每日状态',
  breathing: '呼吸练习',
  pomodoro: '专注计时',
  plan_item: '轻计划',
  environment: '环境微调',
  micro_movement: '微运动',
}

export function AccountPage() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showDeleteAccount, setShowDeleteAccount] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setStatus(await getAuthStatus())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const session = mode === 'register'
        ? await registerAccount(email.trim(), password)
        : await loginAccount(email.trim(), password)
      setPassword('')
      setNotice(session.dataMerge === 'merged'
        ? '已登录，并将这台设备的匿名数据合并到账号。当前聊天视图已清空，已保存档案仍保留。'
        : session.dataMerge === 'already_claimed'
          ? '已登录。这台设备的匿名数据已归属其他账号，未进行合并。当前聊天视图已清空。'
          : '已安全登录。当前聊天视图已清空，已保存档案仍保留。')
      notifyAuthChanged(true, false, session.user.userId, session.dataMerge)
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const logout = async () => {
    setSaving(true)
    setError('')
    try {
      await logoutAccount()
      setNotice('已退出账号并清空当前聊天视图；服务器中已保存的对话档案仍保留。')
      notifyAuthChanged(false)
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const exportData = async () => {
    setExporting(true)
    setError('')
    setNotice('')
    try {
      const exported = await exportAccountData()
      const disposition = await saveAccountExport(exported)
      setNotice(disposition === 'shared'
        ? '已将完整账号数据交给系统分享。请将文件保存在信任的位置。'
        : '已下载完整账号数据 JSON。请将文件保存在信任的位置。')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setExporting(false)
    }
  }

  const removeAccount = async (event: FormEvent) => {
    event.preventDefault()
    if (!status?.authenticated || normalizeAuthEmail(deleteConfirmation) !== status.user.email) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await deleteAccount(status.user.email, deletePassword)
      setDeletePassword('')
      setDeleteConfirmation('')
      setShowDeleteAccount(false)
      setNotice('账号及服务器中的个人数据已永久删除，本机当前视图也已清空。')
      notifyAuthChanged(false, true)
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="soft-grid scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-medium tracking-[.18em] text-[#829078]">ACCOUNT & SYNC</p>
        <h2 className="mt-2 font-serif text-3xl font-semibold text-[#353c32]">账号与跨设备同步</h2>
        <p className="mt-2 text-sm leading-6 text-[#7d776f]">不登录也能使用。网页登录使用 HttpOnly 安全会话，App 登录凭据保存在系统安全存储中，便于在其他设备读取数据。</p>

        {error && <p className="mt-4 rounded-2xl border border-[#e2b7a8] bg-[#fff5f0] px-4 py-3 text-sm text-[#8a5140]" role="alert">{error}</p>}
        {notice && <p className="mt-4 rounded-2xl border border-[#d8dfd2] bg-[#f4f7f1] px-4 py-3 text-sm text-[#566451]" role="status">{notice}</p>}

        {loading ? <p className="mt-6 text-sm text-[#8a847b]">正在检查登录状态…</p> : status?.authenticated && status.user?.email ? (
          <section className="mt-6 rounded-[24px] border border-[#d8dfd2] bg-white/80 p-6">
            <span className="rounded-full bg-[#e5eee1] px-3 py-1 text-xs text-[#506747]">已登录</span>
            <h3 className="mt-4 font-serif text-2xl font-semibold text-[#42503c]">{status.user.email}</h3>
            <p className="mt-2 text-sm leading-6 text-[#7d776f]">账号数据可在登录后的设备之间同步。请不要在公共设备上保持登录。</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" disabled={saving || exporting} onClick={() => void exportData()} className="rounded-xl bg-[#687b60] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{exporting ? '正在整理数据…' : '导出我的全部数据'}</button>
              <button type="button" disabled={saving || exporting} onClick={() => void logout()} className="rounded-xl border border-[#d7c8bf] bg-white px-4 py-2.5 text-sm text-[#8b5c49] disabled:opacity-50">退出登录</button>
            </div>

            <section className="mt-6 border-t border-[#eaded7] pt-5">
              <h4 className="font-medium text-[#8b5140]">危险操作</h4>
              <p className="mt-2 text-sm leading-6 text-[#7d6b64]">删除账号会永久删除周期、每日状态、呼吸记录、对话与消息、计划、活动、积分和长期记忆，且无法恢复。建议先导出数据。</p>
              {!showDeleteAccount ? (
                <button type="button" disabled={saving || exporting} onClick={() => setShowDeleteAccount(true)} className="mt-3 rounded-xl border border-[#d9a794] bg-[#fff7f3] px-4 py-2.5 text-sm font-medium text-[#9a4f3b] disabled:opacity-50">删除账号及全部数据</button>
              ) : (
                <form onSubmit={removeAccount} className="mt-4 rounded-2xl border border-[#dfb7a8] bg-[#fff8f5] p-4">
                  <p className="text-sm font-medium text-[#8d4e3c]">请输入当前密码，并再输入账号邮箱以确认。</p>
                  <label className="mt-3 block text-sm"><span className="mb-1.5 block text-xs text-[#806c65]">当前密码</span><input type="password" required minLength={1} maxLength={128} autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} className="w-full rounded-xl border border-[#dfc8bf] bg-white px-3 py-2.5 outline-none focus:border-[#bd8069]" /></label>
                  <label className="mt-3 block text-sm"><span className="mb-1.5 block text-xs text-[#806c65]">输入 {status.user.email}</span><input type="email" required autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="w-full rounded-xl border border-[#dfc8bf] bg-white px-3 py-2.5 outline-none focus:border-[#bd8069]" /></label>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="submit" disabled={saving || !deletePassword || normalizeAuthEmail(deleteConfirmation) !== status.user.email} className="rounded-xl bg-[#a6533d] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">{saving ? '正在删除…' : '确认永久删除'}</button>
                    <button type="button" disabled={saving} onClick={() => { setShowDeleteAccount(false); setDeletePassword(''); setDeleteConfirmation('') }} className="rounded-xl border border-[#d7c8bf] bg-white px-4 py-2.5 text-sm text-[#71665f] disabled:opacity-50">取消</button>
                  </div>
                </form>
              )}
            </section>
          </section>
        ) : (
          <section className="mt-6 rounded-[24px] border border-[#ddd8ce] bg-white/80 p-5 sm:p-6">
            <div className="grid grid-cols-2 rounded-xl bg-[#f0ede6] p-1">
              <button type="button" onClick={() => setMode('login')} className={`rounded-lg px-3 py-2 text-sm ${mode === 'login' ? 'bg-white text-[#4d5b47] shadow-sm' : 'text-[#8a847b]'}`}>登录</button>
              <button type="button" onClick={() => setMode('register')} className={`rounded-lg px-3 py-2 text-sm ${mode === 'register' ? 'bg-white text-[#4d5b47] shadow-sm' : 'text-[#8a847b]'}`}>注册</button>
            </div>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block text-sm"><span className="mb-2 block font-medium">邮箱</span><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-[#d8d2c8] bg-[#fbfaf7] px-4 py-3 outline-none focus:border-[#829478]" /></label>
              <label className="block text-sm"><span className="mb-2 block font-medium">密码</span><input type="password" required minLength={mode === 'register' ? 10 : 1} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-[#d8d2c8] bg-[#fbfaf7] px-4 py-3 outline-none focus:border-[#829478]" />{mode === 'register' && <span className="mt-1.5 block text-xs text-[#8b857c]">至少 10 个字符，不要与其他网站共用密码。</span>}</label>
              <button disabled={saving} className="w-full rounded-xl bg-[#687b60] px-4 py-3 font-medium text-white disabled:opacity-50">{saving ? '正在处理…' : mode === 'register' ? '注册并合并本机数据' : '登录'}</button>
            </form>
            {status?.authType === 'anonymous' && <p className="mt-4 text-center text-xs text-[#8b857c]">当前为匿名设备模式，本机功能仍可正常使用。</p>}
          </section>
        )}
      </div>
    </section>
  )
}

export function PointsPage() {
  const [summary, setSummary] = useState<PointsSummary | null>(null)
  const [goal, setGoal] = useState(30)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await getPointsSummary(businessDate())
      setSummary(next)
      setGoal(next.weeklyGoal)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const saveGoal = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await updateWeeklyPointsGoal(goal)
      setNotice('本周目标已更新。')
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const progress = summary ? Math.min(100, Math.round(summary.weeklyPoints / summary.weeklyGoal * 100)) : 0
  return (
    <section className="soft-grid scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-medium tracking-[.18em] text-[#829078]">GENTLE PROGRESS</p><h2 className="mt-2 font-serif text-3xl font-semibold text-[#353c32]">积分与本周目标</h2></div>
          <button type="button" onClick={() => void load()} className="text-sm text-[#607157] underline underline-offset-2">刷新</button>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7d776f]">积分只记录已完成的照顾和小行动，不会因症状、情绪或未完成任务扣分。</p>

        {error && <p className="mt-4 rounded-2xl border border-[#e2b7a8] bg-[#fff5f0] px-4 py-3 text-sm text-[#8a5140]" role="alert">{error}</p>}
        {notice && <p className="mt-4 rounded-2xl border border-[#d8dfd2] bg-[#f4f7f1] px-4 py-3 text-sm text-[#566451]" role="status">{notice}</p>}
        {loading ? <p className="mt-6 text-sm text-[#8a847b]">正在读取积分…</p> : summary && (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-[22px] bg-[#66765f] p-5 text-white"><p className="text-xs text-white/65">本周积分</p><strong className="mt-2 block text-4xl">{summary.weeklyPoints}</strong><p className="mt-2 text-xs text-white/65">目标 {summary.weeklyGoal}</p></div>
              <div className="rounded-[22px] border border-[#ddd8ce] bg-white/80 p-5"><p className="text-xs text-[#8a847b]">距离目标</p><strong className="mt-2 block text-4xl text-[#53634d]">{summary.remainingPoints}</strong><p className="mt-2 text-xs text-[#8a847b]">分</p></div>
              <div className="rounded-[22px] border border-[#ddd8ce] bg-white/80 p-5"><p className="text-xs text-[#8a847b]">累计积分</p><strong className="mt-2 block text-4xl text-[#53634d]">{summary.totalPoints}</strong><p className="mt-2 text-xs text-[#8a847b]">从第一次记录开始</p></div>
            </div>
            <div className="mt-4 rounded-[22px] border border-[#ddd8ce] bg-white/80 p-5">
              <div className="flex justify-between text-sm"><span>本周进度</span><span>{progress}%</span></div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-[#ece8df]"><div className="h-full rounded-full bg-[#718368]" style={{ width: `${progress}%` }} /></div>
              <p className="mt-2 text-xs text-[#8b857c]">{summary.weekStart} 至 {summary.weekEnd}</p>
            </div>

            <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
              <section className="rounded-[22px] border border-[#ddd8ce] bg-white/80 p-5">
                <h3 className="font-serif text-xl font-semibold text-[#3e473a]">积分来源</h3>
                <ul className="mt-4 space-y-2">{(Object.keys(POINT_LABELS) as PointEventType[]).map((type) => <li key={type} className="flex justify-between rounded-xl bg-[#f7f5f0] px-3 py-2 text-sm"><span>{POINT_LABELS[type]}</span><strong>{summary.breakdown[type] ?? 0}</strong></li>)}</ul>
              </section>
              <section className="rounded-[22px] border border-[#ddd8ce] bg-white/80 p-5">
                <h3 className="font-serif text-xl font-semibold text-[#3e473a]">设置本周目标</h3>
                <form onSubmit={saveGoal} className="mt-4">
                  <label className="block text-sm"><span className="mb-2 flex justify-between"><span>目标积分</span><strong>{goal}</strong></span><input type="range" min="5" max="200" step="5" value={goal} onChange={(event) => setGoal(Number(event.target.value))} className="w-full accent-[#687b60]" /></label>
                  <button disabled={saving || goal === summary.weeklyGoal} className="mt-4 w-full rounded-xl bg-[#687b60] px-4 py-3 text-sm font-medium text-white disabled:opacity-45">{saving ? '正在保存…' : '保存目标'}</button>
                </form>
                <h3 className="mt-6 font-serif text-xl font-semibold text-[#3e473a]">最近获得</h3>
                {summary.recentEvents.length === 0 ? <p className="mt-3 text-sm text-[#8a847b]">还没有积分记录。</p> : <ul className="mt-3 space-y-2">{summary.recentEvents.slice(0, 6).map((event) => <li key={event.eventKey} className="flex justify-between text-sm"><span>{POINT_LABELS[event.type]} · {formatDateTime(event.occurredAt)}</span><strong className="text-[#607157]">+{event.points}</strong></li>)}</ul>}
              </section>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

async function syncPlan(items: GentlePlanItem[], date: string) {
  if (items.length === 0) {
    await deleteDailyPlan(date)
    return
  }
  await upsertDailyPlan({
    date,
    title: '今日轻计划',
    items: items.map((item) => ({
      id: item.id,
      content: item.text,
      estimatedMinutes: null,
      completed: item.completed,
    })),
  })
}

function recommendFocusDuration(energy: number, isBufferMode: boolean): FocusDurationMinutes {
  if (isBufferMode || energy <= 2) return 5
  if (energy === 3) return 10
  return 15
}

function businessDate() {
  return new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BUSINESS_TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : '暂时无法读取数据，请稍后重试。'
}

function notifyAuthChanged(
  authenticated: boolean,
  accountDeleted = false,
  userId?: string,
  dataMerge?: 'no_device' | 'same_user' | 'merged' | 'already_claimed' | 'registered_account',
) {
  window.dispatchEvent(new CustomEvent('lutealark:auth-changed', {
    detail: { authenticated, accountDeleted, userId, dataMerge },
  }))
}
