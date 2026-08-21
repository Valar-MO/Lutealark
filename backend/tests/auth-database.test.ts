import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { withDatabaseClient } from "../src/db/pool.js";
import { postgresAgentSessionBindingRepository } from "../src/repositories/agent-sessions.js";
import { postgresAuthRepository } from "../src/repositories/auth.js";
import {
  PERSONAL_DATA_WINDOW_SIZE,
  postgresPersonalDataRepository,
} from "../src/repositories/personal-data.js";
import { createAuthRoutes } from "../src/routes/auth.js";
import { AuthService } from "../src/services/auth.js";
import { hashAgentSessionCode } from "../src/services/agent-session-bindings.js";

const runDatabaseTests = process.env.RUN_AUTH_DB_TESTS === "true"
  && Boolean(env.DATABASE_URL);

function session(byte: number) {
  return {
    id: randomUUID(),
    tokenHash: Buffer.alloc(32, byte),
    expiresAt: new Date("2035-01-01T00:00:00.000Z"),
  };
}

describe.runIf(runDatabaseTests)("PostgreSQL account claim", () => {
  it("atomically merges legacy and product data with deterministic conflicts", async () => {
    const accountUserId = randomUUID();
    const secondAccountUserId = randomUUID();
    const deviceUserId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const accountPlanId = randomUUID();
    const sourcePlanId = randomUUID();
    const accountItemId = randomUUID();
    const sourceItemId = randomUUID();
    const secondSourceItemId = randomUUID();
    const breathingId = randomUUID();
    const activityId = randomUUID();
    const accountMemoryId = randomUUID();
    const sourceMemoryId = randomUUID();
    const legacyForeignConversationId = randomUUID();
    const sourceHash = "1234567890abcdef-source-turn";
    const createdUsers = [deviceUserId, accountUserId, secondAccountUserId];

    try {
      await postgresAuthRepository.registerAccount({
        userId: accountUserId,
        email: `auth-db-${accountUserId}@example.com`,
        passwordHash: Buffer.alloc(64, 1),
        passwordSalt: Buffer.alloc(16, 1),
        session: session(1),
      });
      await postgresAuthRepository.registerAccount({
        userId: secondAccountUserId,
        email: `auth-db-${secondAccountUserId}@example.com`,
        passwordHash: Buffer.alloc(64, 2),
        passwordSalt: Buffer.alloc(16, 2),
        session: session(2),
      });

      await withDatabaseClient(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query("INSERT INTO app_users (id) VALUES ($1)", [deviceUserId]);
          await client.query(
            `INSERT INTO cycle_settings
               (user_id, last_period_date, cycle_length, created_at, updated_at)
             VALUES
               ($1, '2026-07-01', 28, '2026-07-01Z', '2026-07-01Z'),
               ($2, '2026-07-05', 30, '2026-07-02Z', '2026-07-02Z')`,
            [accountUserId, deviceUserId],
          );
          await client.query(
            `INSERT INTO daily_checkins
               (user_id, checkin_date, energy, mood, body_state, note,
                share_with_chat, created_at, updated_at)
             VALUES
               ($1, '2026-08-01', 2, 'anxious', '["fatigue"]', 'source',
                true, '2026-08-01Z', '2026-08-02Z')`,
            [deviceUserId],
          );
          await client.query(
            `INSERT INTO breathing_records
               (user_id, id, mode_id, mode_name, completed_at,
                duration_seconds, rating, created_at, updated_at)
             VALUES ($1, $2, 'box', '方块呼吸', '2026-08-02Z', 120, 4,
                     '2026-08-02Z', '2026-08-02Z')`,
            [deviceUserId, breathingId],
          );
          await client.query(
            `INSERT INTO conversations
               (user_id, id, title, archived, created_at, updated_at)
             VALUES ($1, $2, '匿名会话', false, '2026-08-01Z', '2026-08-02Z')`,
            [deviceUserId, conversationId],
          );
          await client.query(
            `INSERT INTO conversation_messages
               (user_id, id, conversation_id, role, content, metadata,
                created_at, updated_at)
             VALUES ($1, $2, $3, 'user', '需要帮助', '{}',
                     '2026-08-01Z', '2026-08-01Z')`,
            [deviceUserId, messageId, conversationId],
          );
          await client.query(
            `INSERT INTO daily_plans
               (user_id, id, plan_date, title, energy_level, created_at, updated_at)
             VALUES
               ($1, $2, '2026-08-03', '账号旧计划', 4,
                '2026-08-01Z', '2026-08-01Z'),
               ($3, $4, '2026-08-03', '匿名新计划', 2,
                '2026-08-01Z', '2026-08-03Z')`,
            [accountUserId, accountPlanId, deviceUserId, sourcePlanId],
          );
          await client.query(
            `INSERT INTO daily_plan_items
               (user_id, id, plan_id, content, estimated_minutes, sort_order,
                completed_at, created_at, updated_at)
             VALUES
               ($1, $2, $3, '账号旧项', 20, 0, NULL,
                '2026-08-01Z', '2026-08-01Z'),
               ($4, $5, $6, '匿名新项', 10, 0, '2026-08-03Z',
                '2026-08-01Z', '2026-08-03Z'),
               ($4, $7, $6, '匿名第二项', 5, 1, NULL,
                '2026-08-01Z', '2026-08-03Z')`,
            [
              accountUserId,
              accountItemId,
              accountPlanId,
              deviceUserId,
              sourceItemId,
              sourcePlanId,
              secondSourceItemId,
            ],
          );
          await client.query(
            `INSERT INTO activity_records
               (user_id, id, activity_type, completed_at, duration_seconds,
                note, metadata, created_at, updated_at)
             VALUES ($1, $2, 'pomodoro', '2026-08-03Z', 1500,
                     '完成', '{}', '2026-08-03Z', '2026-08-03Z')`,
            [deviceUserId, activityId],
          );
          await client.query(
            `INSERT INTO point_events
               (user_id, event_key, event_type, points, source_id,
                occurred_at, created_at)
             VALUES ($1, $2, 'plan_item', 2, $3, '2026-08-03Z', '2026-08-03Z')`,
            [deviceUserId, `plan-item:${sourceItemId}`, sourceItemId],
          );
          await client.query(
            `INSERT INTO point_preferences
               (user_id, weekly_goal, created_at, updated_at)
             VALUES
               ($1, 30, '2026-08-01Z', '2026-08-01Z'),
               ($2, 50, '2026-08-01Z', '2026-08-03Z')`,
            [accountUserId, deviceUserId],
          );
          await client.query(
            `INSERT INTO memory_entries
               (user_id, id, memory_kind, summary, source_conversation_id,
                source_turn_hash,
                consented_at, archived, created_at, updated_at)
             VALUES
               ($1, $2, 'preference', '账号旧记忆', NULL, $3,
                '2026-08-01Z', false, '2026-08-01Z', '2026-08-01Z'),
               ($4, $5, 'preference', '匿名新记忆', $6, $3,
                '2026-08-02Z', false, '2026-08-01Z', '2026-08-03Z')`,
            [
              accountUserId,
              accountMemoryId,
              sourceHash,
              deviceUserId,
              sourceMemoryId,
              legacyForeignConversationId,
            ],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      });

      const status = await postgresAuthRepository.createAccountSession({
        userId: accountUserId,
        deviceUserId,
        session: session(3),
      });
      expect(status).toBe("merged");

      const result = await withDatabaseClient(async (client) => {
        const sourceRows = await client.query<{ count: number }>(
          `SELECT (
             (SELECT count(*) FROM cycle_settings WHERE user_id = $1)
             + (SELECT count(*) FROM daily_checkins WHERE user_id = $1)
             + (SELECT count(*) FROM breathing_records WHERE user_id = $1)
             + (SELECT count(*) FROM conversations WHERE user_id = $1)
             + (SELECT count(*) FROM daily_plans WHERE user_id = $1)
             + (SELECT count(*) FROM activity_records WHERE user_id = $1)
             + (SELECT count(*) FROM point_events WHERE user_id = $1)
             + (SELECT count(*) FROM point_preferences WHERE user_id = $1)
             + (SELECT count(*) FROM memory_entries WHERE user_id = $1)
           )::int AS count`,
          [deviceUserId],
        );
        const cycle = await client.query(
          "SELECT last_period_date::text AS date, cycle_length::int AS length FROM cycle_settings WHERE user_id = $1",
          [accountUserId],
        );
        const conversation = await client.query(
          `SELECT c.title, count(m.id)::int AS messages
           FROM conversations c
           LEFT JOIN conversation_messages m
             ON m.user_id = c.user_id AND m.conversation_id = c.id
           WHERE c.user_id = $1 AND c.id = $2
           GROUP BY c.user_id, c.id`,
          [accountUserId, conversationId],
        );
        const plan = await client.query(
          `SELECT p.id, p.title, array_agg(i.content ORDER BY i.sort_order) AS items
           FROM daily_plans p
           JOIN daily_plan_items i ON i.user_id = p.user_id AND i.plan_id = p.id
           WHERE p.user_id = $1 AND p.plan_date = '2026-08-03'
           GROUP BY p.user_id, p.id`,
          [accountUserId],
        );
        const points = await client.query(
          `SELECT event_key AS "eventKey", source_id AS "sourceId"
           FROM point_events WHERE user_id = $1`,
          [accountUserId],
        );
        const preference = await client.query(
          "SELECT weekly_goal::int AS goal FROM point_preferences WHERE user_id = $1",
          [accountUserId],
        );
        const memory = await client.query(
          `SELECT id,
                  summary,
                  source_conversation_id AS "sourceConversationId"
           FROM memory_entries
           WHERE user_id = $1 AND source_turn_hash = $2`,
          [accountUserId, sourceHash],
        );
        return {
          sourceCount: sourceRows.rows[0]!.count,
          cycle: cycle.rows[0],
          conversation: conversation.rows[0],
          plan: plan.rows[0],
          point: points.rows[0],
          goal: preference.rows[0]?.goal,
          memory: memory.rows[0],
        };
      });

      expect(result.sourceCount).toBe(0);
      expect(result.cycle).toEqual({ date: "2026-07-05", length: 30 });
      expect(result.conversation).toMatchObject({ title: "匿名会话", messages: 1 });
      expect(result.plan).toMatchObject({
        id: accountPlanId,
        title: "匿名新计划",
        items: ["匿名新项", "匿名第二项"],
      });
      expect(result.point).toEqual({
        eventKey: `plan-item:${accountItemId}`,
        sourceId: accountItemId,
      });
      expect(result.goal).toBe(50);
      expect(result.memory).toEqual({
        id: accountMemoryId,
        summary: "匿名新记忆",
        sourceConversationId: null,
      });

      await expect(postgresAuthRepository.createAccountSession({
        userId: accountUserId,
        deviceUserId,
        session: session(4),
      })).resolves.toBe("merged");
      await expect(postgresAuthRepository.createAccountSession({
        userId: secondAccountUserId,
        deviceUserId,
        session: session(5),
      })).resolves.toBe("already_claimed");
      await expect(postgresAuthRepository.createAccountSession({
        userId: secondAccountUserId,
        deviceUserId: accountUserId,
        session: session(6),
      })).resolves.toBe("registered_account");

      const portableData = await postgresAuthRepository.getAccountData(accountUserId);
      expect(portableData).toMatchObject({
        account: {
          userId: accountUserId,
          claimedDevices: [{ deviceUserId }],
        },
        cycleSettings: { lastPeriodDate: "2026-07-05", cycleLength: 30 },
        dailyCheckins: [{ date: "2026-08-01", note: "source" }],
        breathingRecords: [{ id: breathingId, modeId: "box" }],
        conversations: [{
          id: conversationId,
          messages: [{ id: messageId, content: "需要帮助" }],
        }],
        dailyPlans: [{
          id: accountPlanId,
          items: [
            { id: accountItemId, content: "匿名新项" },
            { id: secondSourceItemId, content: "匿名第二项" },
          ],
        }],
        activities: [{ id: activityId, type: "pomodoro" }],
        points: {
          weeklyGoal: 50,
          events: [{ sourceId: accountItemId, type: "plan_item", points: 2 }],
        },
        memories: [{ id: accountMemoryId, summary: "匿名新记忆" }],
      });
      const serialized = JSON.stringify(portableData);
      for (const forbiddenKey of [
        "passwordHash",
        "passwordSalt",
        "tokenHash",
        "sessionToken",
      ]) {
        expect(serialized).not.toContain(`\"${forbiddenKey}\"`);
      }

      const credential = await postgresAuthRepository.findAccountByUserId(accountUserId);
      expect(credential).not.toBeNull();
      await expect(postgresAuthRepository.deleteAccount(
        accountUserId,
        Buffer.alloc(64, 99),
      )).resolves.toBe(false);
      await expect(postgresAuthRepository.deleteAccount(
        accountUserId,
        credential!.passwordHash,
      )).resolves.toBe(true);

      const remaining = await withDatabaseClient(async (client) => {
        const result = await client.query<{ count: number }>(
          `SELECT (
             (SELECT count(*) FROM app_users WHERE id = $1)
             + (SELECT count(*) FROM auth_accounts WHERE user_id = $1)
             + (SELECT count(*) FROM auth_sessions WHERE user_id = $1)
             + (SELECT count(*) FROM auth_device_claims WHERE account_user_id = $1)
             + (SELECT count(*) FROM cycle_settings WHERE user_id = $1)
             + (SELECT count(*) FROM daily_checkins WHERE user_id = $1)
             + (SELECT count(*) FROM breathing_records WHERE user_id = $1)
             + (SELECT count(*) FROM conversations WHERE user_id = $1)
             + (SELECT count(*) FROM conversation_messages WHERE user_id = $1)
             + (SELECT count(*) FROM daily_plans WHERE user_id = $1)
             + (SELECT count(*) FROM daily_plan_items WHERE user_id = $1)
             + (SELECT count(*) FROM activity_records WHERE user_id = $1)
             + (SELECT count(*) FROM point_events WHERE user_id = $1)
             + (SELECT count(*) FROM point_preferences WHERE user_id = $1)
             + (SELECT count(*) FROM memory_entries WHERE user_id = $1)
           )::int AS count`,
          [accountUserId],
        );
        return result.rows[0]!.count;
      });
      expect(remaining).toBe(0);
    } finally {
      await withDatabaseClient(async (client) => {
        await client.query("DELETE FROM app_users WHERE id = ANY($1::uuid[])", [createdUsers]);
      }).catch(() => undefined);
    }
  });

  it("exports and permanently deletes an account through the real HTTP routes", async () => {
    const routes = createAuthRoutes({
      service: new AuthService(postgresAuthRepository),
      secureCookies: false,
    });
    const email = `auth-portability-${randomUUID()}@example.com`;
    const password = "portable account password";
    let userId: string | undefined;
    try {
      const registration = await routes.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect(registration.status).toBe(201);
      const registrationBody = await registration.json() as {
        user: { userId: string };
      };
      userId = registrationBody.user.userId;
      const cookie = registration.headers.get("Set-Cookie")!.split(";", 1)[0]!;
      const agentSessionCode = `offline:${randomUUID()}`;
      const agentSessionHash = hashAgentSessionCode(agentSessionCode);

      await expect(postgresAgentSessionBindingRepository.bind({
        sessionHash: agentSessionHash,
        subject: { type: "account", id: userId },
        mode: "offline",
        expiresAt: new Date("2035-01-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-08-11T00:00:00.000Z"),
      })).resolves.toBe(true);
      const storedBinding = await withDatabaseClient(async (client) => {
        const result = await client.query<{ hashHex: string }>(
          `SELECT encode(session_hash, 'hex') AS "hashHex"
           FROM agent_session_bindings
           WHERE account_user_id = $1`,
          [userId],
        );
        return result.rows[0];
      });
      expect(storedBinding?.hashHex).toBe(agentSessionHash.toString("hex"));
      expect(JSON.stringify(storedBinding)).not.toContain(agentSessionCode);

      await withDatabaseClient(async (client) => {
        await client.query(
          `INSERT INTO daily_checkins
             (user_id, checkin_date, energy, mood, body_state, note, share_with_chat)
           VALUES ($1, '2026-08-10', 3, 'calm', '["steady"]', 'portable', true)`,
          [userId],
        );
      });

      const exported = await routes.request("/export", { headers: { Cookie: cookie } });
      expect(exported.status).toBe(200);
      expect(exported.headers.get("Content-Disposition")).toContain("attachment;");
      const exportBody = await exported.json() as Record<string, unknown>;
      expect(exportBody).toMatchObject({
        format: "lutealark-account-data",
        schemaVersion: 1,
        data: {
          account: { userId, email },
          dailyCheckins: [{ date: "2026-08-10", note: "portable" }],
        },
      });
      const serialized = JSON.stringify(exportBody);
      expect(serialized).not.toContain("\"passwordHash\"");
      expect(serialized).not.toContain("\"passwordSalt\"");
      expect(serialized).not.toContain("\"tokenHash\"");

      const refused = await routes.request("/account", {
        method: "DELETE",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "incorrect-password" }),
      });
      expect(refused.status).toBe(401);
      expect(await postgresAuthRepository.findAccountByUserId(userId)).not.toBeNull();

      const deleted = await routes.request("/account", {
        method: "DELETE",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect(deleted.status).toBe(200);
      expect(deleted.headers.get("Set-Cookie")).toContain("Max-Age=0");
      expect(await postgresAuthRepository.findAccountByUserId(userId)).toBeNull();
      const remainingBindings = await withDatabaseClient(async (client) => {
        const result = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM agent_session_bindings
           WHERE account_user_id = $1`,
          [userId],
        );
        return result.rows[0]!.count;
      });
      expect(remainingBindings).toBe(0);

      const oldSession = await routes.request("/me", { headers: { Cookie: cookie } });
      await expect(oldSession.json()).resolves.toEqual({
        authenticated: false,
        authType: "none",
        user: null,
      });
    } finally {
      if (userId) {
        await withDatabaseClient(async (client) => {
          await client.query("DELETE FROM app_users WHERE id = $1", [userId]);
        }).catch(() => undefined);
      }
    }
  });

  it("keeps complete check-in and breathing history while serving a recent product window", async () => {
    const routes = createAuthRoutes({
      service: new AuthService(postgresAuthRepository),
      secureCookies: false,
    });
    const email = `auth-retention-${randomUUID()}@example.com`;
    const password = "complete retention password";
    const initialBreathingIds = Array.from(
      { length: PERSONAL_DATA_WINDOW_SIZE },
      () => randomUUID(),
    );
    const latestBreathingId = randomUUID();
    let userId: string | undefined;

    try {
      const registration = await routes.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect(registration.status).toBe(201);
      const registrationBody = await registration.json() as {
        user: { userId: string };
      };
      userId = registrationBody.user.userId;
      const cookie = registration.headers.get("Set-Cookie")!.split(";", 1)[0]!;

      await withDatabaseClient(async (client) => {
        await client.query(
          `INSERT INTO daily_checkins
             (user_id, checkin_date, energy, mood, body_state, note, share_with_chat)
           SELECT $1,
                  day::date,
                  3,
                  'calm',
                  '["steady"]'::jsonb,
                  'retained-' || to_char(day, 'YYYY-MM-DD'),
                  true
           FROM generate_series(
             '2020-01-01'::date,
             '2020-01-30'::date,
             interval '1 day'
           ) AS day`,
          [userId],
        );
        await client.query(
          `INSERT INTO breathing_records
             (user_id, id, mode_id, mode_name, completed_at,
              duration_seconds, rating)
           SELECT $1,
                  record_id,
                  'box',
                  '方块呼吸',
                  '2020-01-01T00:00:00Z'::timestamptz
                    + (ordinality - 1) * interval '1 day',
                  120,
                  NULL
           FROM unnest($2::uuid[]) WITH ORDINALITY
             AS record(record_id, ordinality)`,
          [userId, initialBreathingIds],
        );
      });

      // These writes used to delete the oldest row as soon as the 31st row
      // was inserted. They must now leave the complete PostgreSQL history.
      await postgresPersonalDataRepository.upsertDailyCheckin(userId, {
        date: "2020-01-31",
        energy: 4,
        mood: "calm",
        bodyState: ["steady"],
        note: "latest",
        shareWithChat: true,
      });
      await postgresPersonalDataRepository.upsertBreathingRecord(userId, {
        id: latestBreathingId,
        modeId: "box",
        modeName: "方块呼吸",
        completedAt: "2020-01-31T00:00:00.000Z",
        durationSeconds: 120,
        rating: 5,
      });

      const productSnapshot = await postgresPersonalDataRepository.getPersonalData(userId);
      expect(productSnapshot.dailyCheckins).toHaveLength(PERSONAL_DATA_WINDOW_SIZE);
      expect(productSnapshot.dailyCheckins[0]?.date).toBe("2020-01-31");
      expect(productSnapshot.dailyCheckins.some(({ date }) => date === "2020-01-01"))
        .toBe(false);
      expect(productSnapshot.breathingRecords).toHaveLength(PERSONAL_DATA_WINDOW_SIZE);
      expect(productSnapshot.breathingRecords[0]?.id).toBe(latestBreathingId);
      expect(productSnapshot.breathingRecords.some(
        ({ id }) => id === initialBreathingIds[0],
      )).toBe(false);

      const storedCounts = await withDatabaseClient(async (client) => {
        const result = await client.query<{
          checkins: number;
          breathing: number;
        }>(
          `SELECT
             (SELECT count(*)::int FROM daily_checkins WHERE user_id = $1) AS checkins,
             (SELECT count(*)::int FROM breathing_records WHERE user_id = $1) AS breathing`,
          [userId],
        );
        return result.rows[0]!;
      });
      expect(storedCounts).toEqual({ checkins: 31, breathing: 31 });

      const exported = await routes.request("/export", { headers: { Cookie: cookie } });
      expect(exported.status).toBe(200);
      const exportBody = await exported.json() as {
        data: {
          dailyCheckins: Array<{ date: string }>;
          breathingRecords: Array<{ id: string }>;
        };
      };
      expect(exportBody.data.dailyCheckins).toHaveLength(31);
      expect(exportBody.data.dailyCheckins.map(({ date }) => date)).toEqual(
        expect.arrayContaining(["2020-01-01", "2020-01-31"]),
      );
      expect(exportBody.data.breathingRecords).toHaveLength(31);
      expect(exportBody.data.breathingRecords.map(({ id }) => id)).toEqual(
        expect.arrayContaining([initialBreathingIds[0], latestBreathingId]),
      );
    } finally {
      if (userId) {
        await withDatabaseClient(async (client) => {
          await client.query("DELETE FROM app_users WHERE id = $1", [userId]);
        }).catch(() => undefined);
      }
    }
  });
});
