import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { MemoryEntry } from "../src/contracts/memory.js";
import { DatabaseUnavailableError } from "../src/db/pool.js";
import type { MemoryRepository } from "../src/repositories/memory.js";
import {
  AGENT_MEMORY_ITEM_LIMIT,
  AGENT_MEMORY_QUERY_LIMIT,
  loadAgentMemoryContext,
  remoteAgentMemoryUserId,
  resolveAgentRequestUser,
  sanitizeAgentMemoryContext,
} from "../src/services/agent-memory.js";

const USER_A = "c598fcc4-98d4-4f66-b526-65d6ba73adaf";

function memory(
  summary: string,
  overrides: Partial<MemoryEntry> = {},
): MemoryEntry {
  return {
    id: randomUUID(),
    kind: "preference",
    summary,
    sourceConversationId: null,
    sourceTurnHash: randomUUID().replaceAll("-", "").repeat(2),
    consentedAt: "2026-08-11T00:00:00.000Z",
    archived: false,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

function repository(entries: MemoryEntry[] | Error): MemoryRepository {
  return {
    list: vi.fn(async () => {
      if (entries instanceof Error) throw entries;
      return entries;
    }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as MemoryRepository;
}

describe("trusted agent memory context", () => {
  it("loads only the requested subject and filters archived or sensitive notes", async () => {
    const repo = repository([
      memory("把  任务\n拆成十分钟步骤"),
      memory("已归档偏好", { archived: true }),
      memory("我最近睡不好"),
      memory("我今天状态很好"),
      memory("I am anxious today"),
      memory("我有抑郁症"),
      memory("我的检验结果和血压记录"),
    ]);

    await expect(loadAgentMemoryContext(
      repo,
      USER_A,
      "论文开始不了",
    )).resolves.toEqual([{
      kind: "preference",
      summary: "把 任务 拆成十分钟步骤",
    }]);
    expect(repo.list).toHaveBeenCalledWith(USER_A, {
      includeArchived: false,
      limit: AGENT_MEMORY_QUERY_LIMIT,
    });
  });

  it("enforces item and aggregate length bounds", () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      memory(`${index}`.repeat(210))
    );
    const result = sanitizeAgentMemoryContext(items);

    expect(result.length).toBeLessThanOrEqual(AGENT_MEMORY_ITEM_LIMIT);
    expect(result.reduce((sum, item) => sum + item.summary.length, 0))
      .toBeLessThanOrEqual(1_200);
  });

  it("does not query memory for crisis or an unresolved subject", async () => {
    const repo = repository([memory("安全偏好")]);

    await expect(loadAgentMemoryContext(repo, USER_A, "我不想活了"))
      .resolves.toEqual([]);
    await expect(loadAgentMemoryContext(repo, undefined, "论文开始不了"))
      .resolves.toEqual([]);
    expect(repo.list).not.toHaveBeenCalled();
  });

  it("degrades PostgreSQL unavailability to empty context only", async () => {
    const unavailable = repository(new DatabaseUnavailableError());
    await expect(loadAgentMemoryContext(
      unavailable,
      USER_A,
      "论文开始不了",
    )).resolves.toEqual([]);

    const unexpected = repository(new Error("programming failure"));
    await expect(loadAgentMemoryContext(
      unexpected,
      USER_A,
      "论文开始不了",
    )).rejects.toThrow("programming failure");
  });

  it("degrades only database failures during identity resolution", async () => {
    await expect(resolveAgentRequestUser(async () => {
      throw new DatabaseUnavailableError();
    })).resolves.toBeNull();
    await expect(resolveAgentRequestUser(async () => {
      throw new Error("authentication bug");
    })).rejects.toThrow("authentication bug");
  });

  it("sends only authenticated account ids to OpenTrek session memory", () => {
    expect(remoteAgentMemoryUserId({
      authType: "account",
      userId: USER_A,
    })).toBe(USER_A);
    expect(remoteAgentMemoryUserId({
      authType: "anonymous",
      userId: USER_A,
    })).toBeUndefined();
    expect(remoteAgentMemoryUserId(null)).toBeUndefined();
  });
});
