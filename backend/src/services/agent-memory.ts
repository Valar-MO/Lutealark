import type { MemoryEntry } from "../contracts/memory.js";
import { DatabaseUnavailableError } from "../db/pool.js";
import type { MemoryRepository } from "../repositories/memory.js";
import {
  isCrisisMessage,
  isSensitiveMemoryContent,
} from "./offline-assistant.js";

export const AGENT_MEMORY_QUERY_LIMIT = 20;
export const AGENT_MEMORY_ITEM_LIMIT = 6;
export const AGENT_MEMORY_TOTAL_CHAR_LIMIT = 1_200;

export type AgentMemoryContextItem = Pick<MemoryEntry, "kind" | "summary">;

export async function resolveAgentRequestUser<T extends { userId: string }>(
  resolveUser: () => Promise<T | null>,
): Promise<T | null> {
  try {
    return await resolveUser();
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return null;
    throw error;
  }
}

export function remoteAgentMemoryUserId(
  user: { authType: string; userId: string } | null,
): string | undefined {
  return user?.authType === "account" ? user.userId : undefined;
}

export async function loadAgentMemoryContext(
  repository: MemoryRepository,
  userId: string | undefined,
  message: string,
): Promise<AgentMemoryContextItem[]> {
  if (!userId || isCrisisMessage(message)) return [];

  let entries: MemoryEntry[];
  try {
    entries = await repository.list(userId, {
      includeArchived: false,
      limit: AGENT_MEMORY_QUERY_LIMIT,
    });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return [];
    throw error;
  }

  return sanitizeAgentMemoryContext(entries);
}

export function sanitizeAgentMemoryContext(
  entries: readonly Pick<MemoryEntry, "archived" | "kind" | "summary">[],
): AgentMemoryContextItem[] {
  const result: AgentMemoryContextItem[] = [];
  let totalCharacters = 0;

  for (const entry of entries) {
    if (entry.archived) continue;
    const summary = entry.summary.replace(/\s+/g, " ").trim();
    if (
      !summary
      || isSensitiveMemoryContent(summary)
      || isTransientMemoryContent(summary)
    ) continue;
    if (result.length >= AGENT_MEMORY_ITEM_LIMIT) break;
    if (totalCharacters + summary.length > AGENT_MEMORY_TOTAL_CHAR_LIMIT) break;
    result.push({ kind: entry.kind, summary });
    totalCharacters += summary.length;
  }

  return result;
}

function isTransientMemoryContent(summary: string): boolean {
  return /(今天|今日|现在|当前|此刻|刚刚|最近|这周|本周|昨晚|昨天|今晚|目前|\btoday\b|\bnow\b|\bcurrently\b|\brecently\b|\bthis\s+week\b|\byesterday\b|\btonight\b)/i
    .test(summary);
}

const OFFLINE_MEMORY_INTENTS = new Set([
  "breathing",
  "pomodoro",
  "environment_adjustment",
  "micro_movement",
  "lightweight_plan",
  "task_difficulty",
  "general_support",
]);

export function applyOfflineMemoryContext(
  response: { content: string; metadata: Record<string, unknown> },
  memories: readonly AgentMemoryContextItem[],
): void {
  const intent = typeof response.metadata.intent === "string"
    ? response.metadata.intent
    : "";
  if (!memories.length || !OFFLINE_MEMORY_INTENTS.has(intent)) return;

  const memory = memories[0]!;
  const kindLabel = memory.kind === "long_term_goal"
    ? "长期目标"
    : memory.kind === "constraint"
      ? "长期限制"
      : "长期偏好";
  response.content += `\n\n参考你主动保存的${kindLabel}：“${memory.summary}”。这只是你保存的记录；如果它已经变化，可以忽略或更新。`;
  response.metadata.memoryUsed = true;
  response.metadata.memoryCount = 1;
}
