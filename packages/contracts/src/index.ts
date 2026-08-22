/** Shared transport contracts. Runtime validation remains server-side. */

export type UUID = string
export type ISODate = string
export type ISODateTime = string

export type CycleSettings = {
  lastPeriodDate: ISODate
  cycleLength: number
}

export type CycleResult = {
  currentPhase:
    | 'menstruation'
    | 'follicular_early'
    | 'follicular_late'
    | 'ovulation'
    | 'luteal_early'
    | 'luteal_late'
  phaseName: string
  isBufferMode: boolean
  dayOfCycle: number
  daysToNextPeriod: number
  energyValue: number
}

export type DailyMood = 'calm' | 'anxious' | 'low' | 'irritable' | 'overwhelmed'

export type DailyCheckin = {
  date: ISODate
  energy: 1 | 2 | 3 | 4 | 5
  mood: DailyMood
  bodyState: string[]
  note?: string
  shareWithChat: boolean
}

export type BreathingRecord = {
  id: UUID
  modeId: string
  modeName: string
  completedAt: ISODateTime
  durationSeconds: number
  rating: number | null
}

export type KnowledgeSource = {
  sourceId?: string
  title: string
  url?: string
  chunkId?: string
  excerpt?: string
  score?: number
}

export type AgentMode = 'online' | 'offline'

export type MemoryCandidate = {
  candidateId: UUID
  kind: 'preference' | 'constraint' | 'long_term_goal'
  summary: string
  requiresConsent: true
  sourceTurnHash: string
}

export type AgentMetadata = Record<string, unknown> & {
  mode?: AgentMode
  intent?: string
  strategy?: string
  action?: string
  ragUsed?: boolean
  sources?: KnowledgeSource[]
  notice?: string
  memoryCandidate?: MemoryCandidate
}

export type CreateAgentSessionResponse = {
  sessionCode: string
  mode?: AgentMode
}

export type AgentChatResponse = {
  sessionCode: string
  content: string
  metadata: AgentMetadata
}

export type ConversationMessageRole = 'user' | 'assistant' | 'system'

export type ConversationMessage = {
  id: UUID
  conversationId: UUID
  role: ConversationMessageRole
  content: string
  metadata: AgentMetadata
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type Conversation = {
  id: UUID
  title: string | null
  archived: boolean
  messageCount: number
  lastMessageAt: ISODateTime | null
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type ConversationDetail = Conversation & {
  messages: ConversationMessage[]
}

export type DailyPlanItem = {
  id: UUID
  content: string
  estimatedMinutes: number | null
  sortOrder: number
  completedAt: ISODateTime | null
}

export type DailyPlan = {
  id: UUID
  date: ISODate
  title: string | null
  energyLevel: number | null
  items: DailyPlanItem[]
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type ActivityType = 'pomodoro' | 'environment' | 'micro_movement'

export type ActivityRecord = {
  id: UUID
  type: ActivityType
  completedAt: ISODateTime
  durationSeconds: number | null
  note: string | null
  metadata: Record<string, unknown>
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type PointEventType =
  | 'checkin'
  | 'breathing'
  | 'pomodoro'
  | 'plan_item'
  | 'environment'
  | 'micro_movement'

export type PointEvent = {
  eventKey: string
  type: PointEventType
  points: number
  sourceId: string
  occurredAt: ISODateTime
}

export type PointsSummary = {
  weekStart: ISODate
  weekEnd: ISODate
  weeklyGoal: number
  weeklyPoints: number
  totalPoints: number
  remainingPoints: number
  breakdown: Record<PointEventType, number>
  recentEvents: PointEvent[]
}

export type PersonalDataSnapshot = {
  cycleSettings: CycleSettings | null
  dailyCheckins: DailyCheckin[]
  breathingRecords: BreathingRecord[]
}

export type AccountUser = {
  userId: UUID
  email: string
}

export type DataMergeStatus =
  | 'no_device'
  | 'same_user'
  | 'merged'
  | 'already_claimed'
  | 'registered_account'

export type AuthSessionResponse = {
  authenticated: true
  user: AccountUser
  expiresAt: ISODateTime
  dataMerge: DataMergeStatus
  /** Present only for an explicitly identified Capacitor client. */
  accessToken?: string
}

export type DeleteAccountInput = {
  email: string
  password: string
}

export type AuthStatus =
  | { authenticated: true; authType: 'account'; user: AccountUser }
  | { authenticated: false; authType: 'anonymous'; user: { userId: UUID } }
  | { authenticated: false; authType: 'none'; user: null }

export type MemoryKind = 'preference' | 'constraint' | 'long_term_goal'

export type MemoryEntry = {
  id: UUID
  kind: MemoryKind
  summary: string
  sourceConversationId: UUID | null
  sourceTurnHash: string
  consentedAt: ISODateTime
  archived: boolean
  createdAt: ISODateTime
  updatedAt: ISODateTime
}
