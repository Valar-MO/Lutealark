import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { KnowledgeSource as SharedKnowledgeSource, MemoryCandidate } from '@lutealark/contracts'
import type { CycleResult, CycleSettings, DailyCheckIn } from '../lib/api'
import type { BreathingRecord } from '../features/breathing-storage'

export type AppView = 'agent' | 'cycle' | 'breathing' | 'tools' | 'memory' | 'points' | 'account'

export type KnowledgeSource = SharedKnowledgeSource

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  intent?: string
  action?: string
  mode?: 'online' | 'offline'
  ragUsed?: boolean
  sources?: KnowledgeSource[]
  memoryCandidate?: MemoryCandidate
  memoryCandidateStatus?: 'saved' | 'dismissed'
  createdAt?: string
}

export type AppStore = {
  view: AppView
  sessionCode: string
  activeConversationId: string
  messages: ChatMessage[]
  input: string
  dataSubjectKey: string
  cycleSettings: CycleSettings | null
  cycleResult: CycleResult | null
  dailyCheckins: DailyCheckIn[]
  breathingRecords: BreathingRecord[]
  setView: (view: AppView) => void
  setSessionCode: (sessionCode: string) => void
  setActiveConversationId: (conversationId: string) => void
  setMessages: (messages: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => void
  setInput: (input: string) => void
  setCycleSettings: (value: CycleSettings | null) => void
  setCycleResult: (value: CycleResult | null) => void
  setDailyCheckins: (value: DailyCheckIn[] | ((current: DailyCheckIn[]) => DailyCheckIn[])) => void
  setBreathingRecords: (value: BreathingRecord[] | ((current: BreathingRecord[]) => BreathingRecord[])) => void
  switchPersonalDataSubject: (subjectKey: string, value?: {
    cycleSettings: CycleSettings | null
    cycleResult?: CycleResult | null
    dailyCheckins: DailyCheckIn[]
    breathingRecords: BreathingRecord[]
  }) => void
  resetPersonalData: () => void
  resetConversation: () => void
}

export function persistedAppSession(state: AppStore) {
  return {
    dataSubjectKey: state.dataSubjectKey,
    sessionCode: state.sessionCode,
    activeConversationId: state.activeConversationId,
    messages: state.messages,
    input: state.input,
  }
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      view: 'agent',
      sessionCode: '',
      activeConversationId: '',
      messages: [],
      input: '',
      dataSubjectKey: '',
      cycleSettings: null,
      cycleResult: null,
      dailyCheckins: [],
      breathingRecords: [],
      setView: (view) => set({ view }),
      setSessionCode: (sessionCode) => set({ sessionCode }),
      setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
      setMessages: (messages) => set((state) => ({
        messages: typeof messages === 'function' ? messages(state.messages) : messages,
      })),
      setInput: (input) => set({ input }),
      setCycleSettings: (cycleSettings) => set({ cycleSettings }),
      setCycleResult: (cycleResult) => set({ cycleResult }),
      setDailyCheckins: (dailyCheckins) => set((state) => ({
        dailyCheckins: typeof dailyCheckins === 'function' ? dailyCheckins(state.dailyCheckins) : dailyCheckins,
      })),
      setBreathingRecords: (breathingRecords) => set((state) => ({
        breathingRecords: typeof breathingRecords === 'function'
          ? breathingRecords(state.breathingRecords)
          : breathingRecords,
      })),
      switchPersonalDataSubject: (dataSubjectKey, value) => set((state) => {
        if (state.dataSubjectKey === dataSubjectKey && !value) return state
        const subjectChanged = state.dataSubjectKey !== dataSubjectKey
        return {
          dataSubjectKey,
          cycleSettings: value?.cycleSettings ?? null,
          cycleResult: value?.cycleResult ?? null,
          dailyCheckins: value?.dailyCheckins ?? [],
          breathingRecords: value?.breathingRecords ?? [],
          // The persisted chat belongs to the persisted dataSubjectKey. This
          // also rejects legacy, unbound session data on the first bootstrap.
          ...(subjectChanged ? {
            sessionCode: '',
            activeConversationId: '',
            messages: [],
            input: '',
          } : {}),
        }
      }),
      resetPersonalData: () => set({
        cycleSettings: null,
        cycleResult: null,
        dailyCheckins: [],
        breathingRecords: [],
      }),
      resetConversation: () => set({
        sessionCode: '',
        activeConversationId: '',
        messages: [],
        input: '',
      }),
    }),
    {
      name: 'lutealark.app-session.v1',
      storage: createJSONStorage(() => sessionStorage),
      partialize: persistedAppSession,
    },
  ),
)
