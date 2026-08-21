import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { closeDatabasePool, withDatabaseClient } from "../src/db/pool.js";
import { postgresMemoryRepository } from "../src/repositories/memory.js";
import { postgresPersonalDataRepository } from "../src/repositories/personal-data.js";
import { postgresProductFeaturesRepository } from "../src/repositories/product-features.js";
import { businessDateOnly } from "../src/services/date.js";
import { createAppRouter } from "../src/trpc/router.js";

const describeWithDatabase = env.DATABASE_URL ? describe.sequential : describe.skip;
const testUsers = new Set<string>();

afterAll(async () => {
  if (env.DATABASE_URL && testUsers.size > 0) {
    await withDatabaseClient(async (client) => {
      await client.query("DELETE FROM app_users WHERE id = ANY($1::uuid[])", [
        [...testUsers],
      ]);
    });
  }
  await closeDatabasePool();
});

describeWithDatabase("PostgreSQL product features", () => {
  it("persists conversation/message CRUD and a lightweight daily plan", async () => {
    const userId = randomUUID();
    testUsers.add(userId);
    const conversationId = randomUUID();
    const messageId = randomUUID();

    const conversation = await postgresProductFeaturesRepository.createConversation(
      userId,
      { id: conversationId, title: "今天的支持" },
    );
    expect(conversation).toMatchObject({
      id: conversationId,
      title: "今天的支持",
      messageCount: 0,
    });

    await postgresProductFeaturesRepository.createMessage(userId, conversationId, {
      id: messageId,
      role: "user",
      content: "我有点难开始",
      metadata: { mode: "offline" },
    });
    await postgresProductFeaturesRepository.updateMessage(
      userId,
      conversationId,
      messageId,
      { content: "我现在很难开始" },
    );
    const detail = await postgresProductFeaturesRepository.getConversation(
      userId,
      conversationId,
    );
    expect(detail?.messageCount).toBe(1);
    expect(detail?.messages[0]).toMatchObject({
      id: messageId,
      content: "我现在很难开始",
      metadata: { mode: "offline" },
    });

    const itemIds = Array.from({ length: 4 }, () => randomUUID());
    const date = businessDateOnly();
    const plan = await postgresProductFeaturesRepository.upsertDailyPlan(userId, {
      date,
      energyLevel: 2,
      title: "轻量计划",
      items: itemIds.map((id, index) => ({
        id,
        content: `小步骤 ${index + 1}`,
        estimatedMinutes: 10,
        completed: true,
      })),
    });
    expect(plan.items).toHaveLength(4);
    expect(plan.items.every((item) => item.completedAt !== null)).toBe(true);

    const summary = await postgresProductFeaturesRepository.getPointsSummary(
      userId,
      date,
    );
    expect(summary.breakdown.plan_item).toBe(6);
    expect(summary.weeklyPoints).toBe(6);

    expect(await postgresProductFeaturesRepository.deleteMessage(
      userId,
      conversationId,
      messageId,
    )).toBe(true);
    expect(await postgresProductFeaturesRepository.deleteConversation(
      userId,
      conversationId,
    )).toBe(true);
  });

  it("scopes memory provenance, idempotency and message decisions by user", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    testUsers.add(userA);
    testUsers.add(userB);
    const conversationA = randomUUID();
    const conversationB = randomUUID();
    const messageId = randomUUID();
    const sourceTurnHash = "a".repeat(64);
    const candidate = {
      candidateId: randomUUID(),
      kind: "preference" as const,
      summary: "任务拆成十分钟步骤",
      requiresConsent: true,
      sourceTurnHash,
    };

    await postgresProductFeaturesRepository.createConversation(userA, {
      id: conversationA,
      title: "A 的会话",
    });
    await postgresProductFeaturesRepository.createConversation(userB, {
      id: conversationB,
      title: "B 的会话",
    });
    await postgresProductFeaturesRepository.createMessage(userA, conversationA, {
      id: messageId,
      role: "assistant",
      content: "请确认是否保存",
      metadata: { intent: "memory_request", memoryCandidate: candidate },
    });

    const firstA = await postgresMemoryRepository.create(userA, {
      id: candidate.candidateId,
      kind: candidate.kind,
      summary: candidate.summary,
      sourceConversationId: conversationA,
      sourceTurnHash,
      consent: true,
    });
    const retriedA = await postgresMemoryRepository.create(userA, {
      id: randomUUID(),
      kind: "preference",
      summary: "任务拆成更小步骤",
      sourceConversationId: conversationA,
      sourceTurnHash,
      consent: true,
    });
    const firstB = await postgresMemoryRepository.create(userB, {
      id: randomUUID(),
      kind: "preference",
      summary: "B 的独立偏好",
      sourceConversationId: conversationB,
      sourceTurnHash,
      consent: true,
    });

    expect(retriedA).toMatchObject({
      id: firstA!.id,
      summary: "任务拆成更小步骤",
      sourceConversationId: conversationA,
    });
    expect(firstB?.id).not.toBe(firstA?.id);
    await expect(postgresMemoryRepository.create(userA, {
      id: randomUUID(),
      kind: "preference",
      summary: "不应写入的跨用户来源",
      sourceConversationId: conversationB,
      sourceTurnHash: "b".repeat(64),
      consent: true,
    })).resolves.toBeNull();
    await expect(postgresMemoryRepository.create(userA, {
      id: randomUUID(),
      kind: "preference",
      summary: "不应写入的不存在来源",
      sourceConversationId: randomUUID(),
      sourceTurnHash: "c".repeat(64),
      consent: true,
    })).resolves.toBeNull();
    expect(await postgresMemoryRepository.list(userA, {
      includeArchived: true,
      limit: 50,
    })).toHaveLength(1);
    expect(await postgresMemoryRepository.list(userB, {
      includeArchived: true,
      limit: 50,
    })).toHaveLength(1);

    const app = createApp();
    const patchMetadata = async (userId: string, status: "saved" | "dismissed") =>
      app.request(
        `/api/conversations/${conversationA}/messages/${messageId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-Lutealark-User-Id": userId,
          },
          body: JSON.stringify({
            metadata: {
              intent: "memory_request",
              memoryCandidate: candidate,
              memoryCandidateStatus: status,
            },
          }),
        },
      );

    expect((await patchMetadata(userA, "dismissed")).status).toBe(200);
    expect((await postgresProductFeaturesRepository.getConversation(
      userA,
      conversationA,
    ))?.messages[0]?.metadata).toMatchObject({
      memoryCandidateStatus: "dismissed",
    });
    expect((await patchMetadata(userB, "saved")).status).toBe(404);
    expect((await postgresProductFeaturesRepository.getConversation(
      userA,
      conversationA,
    ))?.messages[0]?.metadata).toMatchObject({
      memoryCandidateStatus: "dismissed",
    });
    expect((await patchMetadata(userA, "saved")).status).toBe(200);
    expect((await postgresProductFeaturesRepository.getConversation(
      userA,
      conversationA,
    ))?.messages[0]?.metadata).toMatchObject({
      memoryCandidateStatus: "saved",
    });

    expect(await postgresProductFeaturesRepository.deleteConversation(
      userA,
      conversationA,
    )).toBe(true);
    expect((await postgresMemoryRepository.list(userA, {
      includeArchived: true,
      limit: 50,
    }))[0]?.sourceConversationId).toBeNull();
  });

  it("awards check-in, breathing and activity points once with daily caps", async () => {
    const userId = randomUUID();
    testUsers.add(userId);
    const date = businessDateOnly();
    const now = new Date().toISOString();

    const checkin = {
      date,
      energy: 3 as const,
      mood: "calm" as const,
      bodyState: [],
      shareWithChat: true,
    };
    await postgresPersonalDataRepository.upsertDailyCheckin(userId, checkin);
    await postgresPersonalDataRepository.upsertDailyCheckin(userId, checkin);

    for (let index = 0; index < 4; index += 1) {
      await postgresPersonalDataRepository.upsertBreathingRecord(userId, {
        id: randomUUID(),
        modeId: "box",
        modeName: "方块呼吸",
        completedAt: now,
        durationSeconds: 120,
        rating: null,
      });
    }

    const activityId = randomUUID();
    const first = await postgresProductFeaturesRepository.upsertActivity(userId, {
      id: activityId,
      type: "pomodoro",
      completedAt: now,
      durationSeconds: 1500,
      metadata: {},
    });
    const retry = await postgresProductFeaturesRepository.upsertActivity(userId, {
      id: activityId,
      type: "pomodoro",
      completedAt: now,
      durationSeconds: 1500,
      metadata: {},
    });
    expect(first.pointsAwarded).toBe(5);
    expect(retry.pointsAwarded).toBe(0);

    await postgresProductFeaturesRepository.updateWeeklyGoal(userId, 40);
    const summary = await postgresProductFeaturesRepository.getPointsSummary(
      userId,
      date,
    );
    expect(summary).toMatchObject({
      weeklyGoal: 40,
      weeklyPoints: 16,
      totalPoints: 16,
      remainingPoints: 24,
    });
    expect(summary.breakdown).toMatchObject({
      checkin: 2,
      breathing: 9,
      pomodoro: 5,
    });
  });

  it("serializes concurrent awards so the pomodoro daily cap cannot be bypassed", async () => {
    const userId = randomUUID();
    testUsers.add(userId);
    const completedAt = new Date().toISOString();
    const results = await Promise.all(
      Array.from({ length: 7 }, () =>
        postgresProductFeaturesRepository.upsertActivity(userId, {
          id: randomUUID(),
          type: "pomodoro",
          completedAt,
          durationSeconds: 1500,
          metadata: {},
        })
      ),
    );
    expect(results.reduce((sum, result) => sum + result.pointsAwarded, 0)).toBe(30);
    expect(results.filter((result) => result.pointsAwarded === 0)).toHaveLength(1);
  });

  it("deletes personal records through REST without allowing point farming", async () => {
    const userId = randomUUID();
    testUsers.add(userId);
    const date = businessDateOnly();
    const breathingId = randomUUID();
    const completedAt = new Date().toISOString();
    const app = createApp();
    const headers = {
      "Content-Type": "application/json",
      "X-Lutealark-User-Id": userId,
    };
    const checkin = {
      date,
      energy: 3,
      mood: "calm",
      bodyState: ["steady"],
      shareWithChat: true,
    };
    const breathing = {
      id: breathingId,
      modeId: "box",
      modeName: "方块呼吸",
      completedAt,
      durationSeconds: 120,
      rating: 4,
    };

    expect((await app.request("/api/personal-data/checkin", {
      method: "PUT",
      headers,
      body: JSON.stringify(checkin),
    })).status).toBe(200);
    expect((await app.request("/api/personal-data/breathing", {
      method: "PUT",
      headers,
      body: JSON.stringify(breathing),
    })).status).toBe(200);

    expect((await app.request(`/api/personal-data/checkin/${date}`, {
      method: "DELETE",
      headers,
    })).status).toBe(200);
    expect((await app.request(`/api/personal-data/breathing/${breathingId}`, {
      method: "DELETE",
      headers,
    })).status).toBe(200);
    const emptySnapshot = await app.request("/api/personal-data", { headers });
    expect(emptySnapshot.status).toBe(200);
    await expect(emptySnapshot.json()).resolves.toMatchObject({
      dailyCheckins: [],
      breathingRecords: [],
    });

    // Reusing the same stable date/id restores the record but not its reward.
    await app.request("/api/personal-data/checkin", {
      method: "PUT",
      headers,
      body: JSON.stringify(checkin),
    });
    await app.request("/api/personal-data/breathing", {
      method: "PUT",
      headers,
      body: JSON.stringify(breathing),
    });
    const summary = await postgresProductFeaturesRepository.getPointsSummary(
      userId,
      date,
    );
    expect(summary).toMatchObject({
      weeklyPoints: 5,
      totalPoints: 5,
      breakdown: { checkin: 2, breathing: 3 },
    });
    const pointEvents = await withDatabaseClient(async (client) =>
      client.query<{ eventKey: string; count: number }>(
        `SELECT event_key AS "eventKey", count(*)::int AS count
         FROM point_events
         WHERE user_id = $1 AND event_key = ANY($2::text[])
         GROUP BY event_key
         ORDER BY event_key`,
        [userId, [`checkin:${date}`, `breathing:${breathingId}`]],
      )
    );
    expect(pointEvents.rows).toEqual([
      { eventKey: `breathing:${breathingId}`, count: 1 },
      { eventKey: `checkin:${date}`, count: 1 },
    ]);

    await app.request(`/api/personal-data/checkin/${date}`, {
      method: "DELETE",
      headers,
    });
    await app.request(`/api/personal-data/breathing/${breathingId}`, {
      method: "DELETE",
      headers,
    });
    const finalSnapshot = await postgresPersonalDataRepository.getPersonalData(userId);
    expect(finalSnapshot.dailyCheckins).toEqual([]);
    expect(finalSnapshot.breathingRecords).toEqual([]);
  });

  it("serves the product REST contract and ignores client-supplied point amounts", async () => {
    const userId = randomUUID();
    testUsers.add(userId);
    const activityId = randomUUID();
    const app = createApp();
    const headers = {
      "Content-Type": "application/json",
      "X-Lutealark-User-Id": userId,
    };
    const input = {
      id: activityId,
      type: "environment",
      completedAt: new Date().toISOString(),
      note: "调暗灯光",
      metadata: { adjustment: "light" },
      points: 999,
    };
    const response = await app.request("/api/activities", {
      method: "PUT",
      headers,
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      activity: { id: activityId, type: "environment" },
      pointsAwarded: 1,
    });

    const retry = await app.request("/api/activities", {
      method: "PUT",
      headers,
      body: JSON.stringify(input),
    });
    await expect(retry.json()).resolves.toMatchObject({ pointsAwarded: 0 });

    const removed = await app.request(`/api/activities/${activityId}`, {
      method: "DELETE",
      headers,
    });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toEqual({ deleted: true });
  });

  it("exposes conversation, breathing, plans, activities and points through tRPC", async () => {
    const userId = randomUUID();
    testUsers.add(userId);
    const caller = createAppRouter().createCaller({});
    const conversationId = randomUUID();
    const conversation = await caller.conversations.create({
      userId,
      conversation: { id: conversationId, title: "tRPC 会话" },
    });
    await caller.conversations.createMessage({
      userId,
      conversationId,
      message: { role: "assistant", content: "我们先做一个小步骤" },
    });
    expect((await caller.conversations.get({
      userId,
      conversationId,
    })).messages).toHaveLength(1);

    const now = new Date().toISOString();
    const breathingId = randomUUID();
    await caller.breathing.upsert({
      userId,
      record: {
        id: breathingId,
        modeId: "box",
        modeName: "方块呼吸",
        completedAt: now,
        durationSeconds: 120,
        rating: 4,
      },
    });
    expect(await caller.breathing.list({ userId })).toHaveLength(1);

    const date = businessDateOnly();
    await expect(caller.checkins.delete({
      userId,
      date: "2026-02-30",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.checkins.upsert({
      userId,
      checkin: {
        date,
        energy: 3,
        mood: "calm",
        bodyState: [],
        shareWithChat: true,
      },
    });
    expect(await caller.checkins.list({ userId })).toHaveLength(1);
    await caller.plans.upsert({
      userId,
      plan: {
        date,
        items: [{ id: randomUUID(), content: "打开文档", completed: true }],
      },
    });
    await caller.activities.upsert({
      userId,
      activity: {
        id: randomUUID(),
        type: "micro_movement",
        completedAt: now,
      },
    });
    await caller.points.updateGoal({ userId, goal: { weeklyGoal: 20 } });
    const summary = await caller.points.summary({ userId, query: { date } });
    expect(summary).toMatchObject({ weeklyGoal: 20, weeklyPoints: 9 });

    expect(await caller.breathing.delete({ userId, recordId: breathingId }))
      .toEqual({ deleted: true });
    expect(await caller.checkins.delete({ userId, date }))
      .toEqual({ deleted: true });
    expect(await caller.breathing.list({ userId })).toHaveLength(0);
    expect(await caller.checkins.list({ userId })).toHaveLength(0);
    // Earned points remain immutable, so delete/recreate cannot farm rewards.
    expect(await caller.points.summary({ userId, query: { date } }))
      .toMatchObject({ weeklyPoints: 9 });

    await caller.breathing.upsert({
      userId,
      record: {
        id: breathingId,
        modeId: "box",
        modeName: "方块呼吸",
        completedAt: now,
        durationSeconds: 120,
        rating: 4,
      },
    });
    await caller.checkins.upsert({
      userId,
      checkin: {
        date,
        energy: 3,
        mood: "calm",
        bodyState: [],
        shareWithChat: true,
      },
    });
    expect(await caller.points.summary({ userId, query: { date } }))
      .toMatchObject({ weeklyPoints: 9 });
    expect(await caller.breathing.delete({ userId, recordId: breathingId }))
      .toEqual({ deleted: true });
    expect(await caller.checkins.delete({ userId, date }))
      .toEqual({ deleted: true });
    expect(await caller.breathing.list({ userId })).toHaveLength(0);
    expect(await caller.checkins.list({ userId })).toHaveLength(0);
  });
});
