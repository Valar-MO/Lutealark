/**
 * Compile-time guard that keeps server-validated schemas compatible with the
 * transport types consumed by the browser. This file emits no runtime code.
 */
import type {
  AgentChatResponse,
  AuthSessionResponse as SharedAuthSessionResponse,
  BreathingRecord as SharedBreathingRecord,
  Conversation as SharedConversation,
  ConversationDetail as SharedConversationDetail,
  ConversationMessage as SharedConversationMessage,
  CreateAgentSessionResponse,
  CycleResult as SharedCycleResult,
  CycleSettings as SharedCycleSettings,
  DailyCheckin as SharedDailyCheckin,
  DailyPlan as SharedDailyPlan,
  MemoryEntry as SharedMemoryEntry,
  PointEvent as SharedPointEvent,
  PointsSummary as SharedPointsSummary,
} from "@lutealark/contracts";
import type {
  CreateAgentSessionResult,
  DailyCheckin,
  RunAgentResult,
} from "./agent.js";
import type { AuthSessionResponse } from "./auth.js";
import type { CycleResult, CycleSettings } from "./cycle.js";
import type { MemoryEntry } from "./memory.js";
import type { BreathingRecord } from "./personal-data.js";
import type {
  Conversation,
  ConversationDetail,
  ConversationMessage,
  DailyPlan,
  PointEvent,
  PointsSummary,
} from "./product-features.js";

type IsAssignable<Left, Right> = [Left] extends [Right] ? true : false;
type IsEquivalent<Left, Right> = IsAssignable<Left, Right> extends true
  ? IsAssignable<Right, Left>
  : false;
type Assert<Condition extends true> = Condition;

type _CycleSettings = Assert<IsEquivalent<CycleSettings, SharedCycleSettings>>;
type _CycleResult = Assert<IsEquivalent<CycleResult, SharedCycleResult>>;
type _DailyCheckin = Assert<IsEquivalent<DailyCheckin, SharedDailyCheckin>>;
type _BreathingRecord = Assert<IsEquivalent<BreathingRecord, SharedBreathingRecord>>;
type _CreateSession = Assert<
  IsEquivalent<CreateAgentSessionResult, CreateAgentSessionResponse>
>;
type _AgentChat = Assert<IsEquivalent<RunAgentResult, AgentChatResponse>>;
type _Conversation = Assert<IsEquivalent<Conversation, SharedConversation>>;
type _ConversationMessage = Assert<
  IsEquivalent<ConversationMessage, SharedConversationMessage>
>;
type _ConversationDetail = Assert<
  IsEquivalent<ConversationDetail, SharedConversationDetail>
>;
type _DailyPlan = Assert<IsEquivalent<DailyPlan, SharedDailyPlan>>;
type _PointEvent = Assert<IsEquivalent<PointEvent, SharedPointEvent>>;
type _PointsSummary = Assert<IsEquivalent<PointsSummary, SharedPointsSummary>>;
type _AuthSession = Assert<
  IsEquivalent<AuthSessionResponse, SharedAuthSessionResponse>
>;
type _Memory = Assert<IsEquivalent<MemoryEntry, SharedMemoryEntry>>;
