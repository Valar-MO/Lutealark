import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { PersonalDataUserId } from "../contracts/personal-data.js";
import type {
  ActivityMutationResult,
  ActivityRecord,
  ActivityType,
  Conversation,
  ConversationDetail,
  ConversationMessage,
  CreateConversationInput,
  CreateConversationMessageInput,
  DailyPlan,
  ListActivitiesInput,
  ListConversationsInput,
  PointsSummary,
  UpdateConversationInput,
  UpdateConversationMessageInput,
  UpsertActivityInput,
  UpsertDailyPlanInput,
} from "../contracts/product-features.js";
import { withDatabaseClient } from "../db/pool.js";
import { awardPoints, POINT_RULES } from "../services/points.js";

export class ResourceNotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} not found`);
    this.name = "ResourceNotFoundError";
  }
}

export class ResourceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceConflictError";
  }
}

export interface ProductFeaturesRepository {
  listConversations(
    userId: PersonalDataUserId,
    input: ListConversationsInput,
  ): Promise<Conversation[]>;
  getConversation(
    userId: PersonalDataUserId,
    conversationId: string,
  ): Promise<ConversationDetail | null>;
  createConversation(
    userId: PersonalDataUserId,
    input: CreateConversationInput,
  ): Promise<Conversation>;
  updateConversation(
    userId: PersonalDataUserId,
    conversationId: string,
    input: UpdateConversationInput,
  ): Promise<Conversation | null>;
  deleteConversation(
    userId: PersonalDataUserId,
    conversationId: string,
  ): Promise<boolean>;
  createMessage(
    userId: PersonalDataUserId,
    conversationId: string,
    input: CreateConversationMessageInput,
  ): Promise<ConversationMessage>;
  updateMessage(
    userId: PersonalDataUserId,
    conversationId: string,
    messageId: string,
    input: UpdateConversationMessageInput,
  ): Promise<ConversationMessage | null>;
  deleteMessage(
    userId: PersonalDataUserId,
    conversationId: string,
    messageId: string,
  ): Promise<boolean>;
  getDailyPlan(
    userId: PersonalDataUserId,
    date: string,
  ): Promise<DailyPlan | null>;
  upsertDailyPlan(
    userId: PersonalDataUserId,
    input: UpsertDailyPlanInput,
  ): Promise<DailyPlan>;
  deleteDailyPlan(userId: PersonalDataUserId, date: string): Promise<boolean>;
  listActivities(
    userId: PersonalDataUserId,
    input: ListActivitiesInput,
  ): Promise<ActivityRecord[]>;
  upsertActivity(
    userId: PersonalDataUserId,
    input: UpsertActivityInput,
  ): Promise<ActivityMutationResult>;
  deleteActivity(userId: PersonalDataUserId, activityId: string): Promise<boolean>;
  getPointsSummary(
    userId: PersonalDataUserId,
    referenceDate?: string,
  ): Promise<PointsSummary>;
  updateWeeklyGoal(
    userId: PersonalDataUserId,
    weeklyGoal: number,
  ): Promise<{ weeklyGoal: number }>;
}

type ConversationRow = {
  id: string;
  title: string | null;
  archived: boolean;
  messageCount: number | string;
  lastMessageAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type MessageRow = {
  id: string;
  conversationId: string;
  role: ConversationMessage["role"];
  content: string;
  metadata: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type PlanRow = {
  id: string;
  date: string;
  title: string | null;
  energyLevel: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type PlanItemRow = {
  id: string;
  content: string;
  estimatedMinutes: number | null;
  sortOrder: number;
  completedAt: Date | string | null;
};

type ActivityRow = {
  id: string;
  type: ActivityType;
  completedAt: Date | string;
  durationSeconds: number | null;
  note: string | null;
  metadata: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function objectMetadata(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    archived: row.archived,
    messageCount: Number(row.messageCount),
    lastMessageAt: row.lastMessageAt ? toIso(row.lastMessageAt) : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function mapMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    metadata: objectMetadata(row.metadata),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function mapActivity(row: ActivityRow): ActivityRecord {
  return {
    id: row.id,
    type: row.type,
    completedAt: toIso(row.completedAt),
    durationSeconds: row.durationSeconds,
    note: row.note,
    metadata: objectMetadata(row.metadata),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function ensureUser(client: PoolClient, userId: PersonalDataUserId) {
  await client.query(
    `INSERT INTO app_users (id) VALUES ($1)
     ON CONFLICT (id) DO UPDATE SET updated_at = now()`,
    [userId],
  );
}

async function inUserTransaction<T>(
  userId: PersonalDataUserId,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withDatabaseClient(async (client) => {
    await client.query("BEGIN");
    try {
      await ensureUser(client, userId);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

const conversationSelect = `
  SELECT c.id,
         c.title,
         c.archived,
         count(m.id)::int AS "messageCount",
         max(m.created_at) AS "lastMessageAt",
         c.created_at AS "createdAt",
         c.updated_at AS "updatedAt"
  FROM conversations c
  LEFT JOIN conversation_messages m
    ON m.user_id = c.user_id AND m.conversation_id = c.id`;

async function selectConversation(
  client: PoolClient,
  userId: PersonalDataUserId,
  conversationId: string,
): Promise<Conversation | null> {
  const result = await client.query<ConversationRow>(
    `${conversationSelect}
     WHERE c.user_id = $1 AND c.id = $2
     GROUP BY c.user_id, c.id`,
    [userId, conversationId],
  );
  return result.rows[0] ? mapConversation(result.rows[0]) : null;
}

async function selectPlan(
  client: PoolClient,
  userId: PersonalDataUserId,
  date: string,
): Promise<DailyPlan | null> {
  const planResult = await client.query<PlanRow>(
    `SELECT id,
            plan_date::text AS date,
            title,
            energy_level::int AS "energyLevel",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM daily_plans
     WHERE user_id = $1 AND plan_date = $2::date`,
    [userId, date],
  );
  const plan = planResult.rows[0];
  if (!plan) return null;
  const itemResult = await client.query<PlanItemRow>(
    `SELECT id,
            content,
            estimated_minutes::int AS "estimatedMinutes",
            sort_order::int AS "sortOrder",
            completed_at AS "completedAt"
     FROM daily_plan_items
     WHERE user_id = $1 AND plan_id = $2
     ORDER BY sort_order, id`,
    [userId, plan.id],
  );
  return {
    id: plan.id,
    date: plan.date,
    title: plan.title,
    energyLevel: plan.energyLevel,
    items: itemResult.rows.map((item) => ({
      ...item,
      completedAt: item.completedAt ? toIso(item.completedAt) : null,
    })),
    createdAt: toIso(plan.createdAt),
    updatedAt: toIso(plan.updatedAt),
  };
}

export const postgresProductFeaturesRepository: ProductFeaturesRepository = {
  async listConversations(userId, input) {
    return withDatabaseClient(async (client) => {
      const result = await client.query<ConversationRow>(
        `${conversationSelect}
         WHERE c.user_id = $1 AND ($2::boolean OR NOT c.archived)
         GROUP BY c.user_id, c.id
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT $3`,
        [userId, input.includeArchived, input.limit],
      );
      return result.rows.map(mapConversation);
    });
  },

  async getConversation(userId, conversationId) {
    return withDatabaseClient(async (client) => {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        const conversation = await selectConversation(client, userId, conversationId);
        if (!conversation) {
          await client.query("COMMIT");
          return null;
        }
        const messages = await client.query<MessageRow>(
          `SELECT id,
                  conversation_id AS "conversationId",
                  role,
                  content,
                  metadata,
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM (
             SELECT *
             FROM conversation_messages
             WHERE user_id = $1 AND conversation_id = $2
             ORDER BY created_at DESC, id DESC
             LIMIT 500
           ) recent
           ORDER BY created_at, id`,
          [userId, conversationId],
        );
        await client.query("COMMIT");
        return { ...conversation, messages: messages.rows.map(mapMessage) };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
  },

  async createConversation(userId, input) {
    return inUserTransaction(userId, async (client) => {
      const id = input.id ?? randomUUID();
      await client.query(
        `INSERT INTO conversations (user_id, id, title)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, id) DO UPDATE SET
           title = COALESCE(EXCLUDED.title, conversations.title),
           updated_at = now()`,
        [userId, id, input.title ?? null],
      );
      return (await selectConversation(client, userId, id))!;
    });
  },

  async updateConversation(userId, conversationId, input) {
    return inUserTransaction(userId, async (client) => {
      const updated = await client.query(
        `UPDATE conversations
         SET title = CASE WHEN $3::boolean THEN $4 ELSE title END,
             archived = COALESCE($5::boolean, archived),
             updated_at = now()
         WHERE user_id = $1 AND id = $2`,
        [
          userId,
          conversationId,
          input.title !== undefined,
          input.title ?? null,
          input.archived ?? null,
        ],
      );
      return updated.rowCount === 1
        ? selectConversation(client, userId, conversationId)
        : null;
    });
  },

  async deleteConversation(userId, conversationId) {
    return inUserTransaction(userId, async (client) => {
      // Delete first so this row lock serializes against memory.create's
      // FOR KEY SHARE. The following update then sees every memory that won
      // the race, while a later create can no longer validate the source.
      const result = await client.query(
        "DELETE FROM conversations WHERE user_id = $1 AND id = $2",
        [userId, conversationId],
      );
      if (result.rowCount === 1) {
        // Long-term memories outlive chat history; only provenance is cleared.
        await client.query(
          `UPDATE memory_entries
           SET source_conversation_id = NULL,
               updated_at = now()
           WHERE user_id = $1 AND source_conversation_id = $2`,
          [userId, conversationId],
        );
      }
      return result.rowCount === 1;
    });
  },

  async createMessage(userId, conversationId, input) {
    return inUserTransaction(userId, async (client) => {
      const id = input.id ?? randomUUID();
      const result = await client.query<MessageRow>(
        `INSERT INTO conversation_messages
           (user_id, id, conversation_id, role, content, metadata, created_at)
         SELECT $1, $3, id, $4, $5, $6::jsonb, COALESCE($7::timestamptz, now())
         FROM conversations
         WHERE user_id = $1 AND id = $2
         ON CONFLICT (user_id, id) DO UPDATE SET
           role = EXCLUDED.role,
           content = EXCLUDED.content,
           metadata = EXCLUDED.metadata,
           updated_at = now()
         WHERE conversation_messages.conversation_id = EXCLUDED.conversation_id
         RETURNING id,
                   conversation_id AS "conversationId",
                   role,
                   content,
                   metadata,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [
          userId,
          conversationId,
          id,
          input.role,
          input.content,
          JSON.stringify(input.metadata),
          input.createdAt ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        const exists = await selectConversation(client, userId, conversationId);
        if (!exists) throw new ResourceNotFoundError("conversation");
        throw new ResourceConflictError("message id belongs to another conversation");
      }
      await client.query(
        "UPDATE conversations SET updated_at = now() WHERE user_id = $1 AND id = $2",
        [userId, conversationId],
      );
      return mapMessage(row);
    });
  },

  async updateMessage(userId, conversationId, messageId, input) {
    return inUserTransaction(userId, async (client) => {
      const result = await client.query<MessageRow>(
        `UPDATE conversation_messages
         SET content = COALESCE($4, content),
             metadata = CASE WHEN $5::boolean THEN $6::jsonb ELSE metadata END,
             updated_at = now()
         WHERE user_id = $1 AND conversation_id = $2 AND id = $3
         RETURNING id,
                   conversation_id AS "conversationId",
                   role,
                   content,
                   metadata,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [
          userId,
          conversationId,
          messageId,
          input.content ?? null,
          input.metadata !== undefined,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      if (!result.rows[0]) return null;
      await client.query(
        "UPDATE conversations SET updated_at = now() WHERE user_id = $1 AND id = $2",
        [userId, conversationId],
      );
      return mapMessage(result.rows[0]);
    });
  },

  async deleteMessage(userId, conversationId, messageId) {
    return inUserTransaction(userId, async (client) => {
      const result = await client.query(
        `DELETE FROM conversation_messages
         WHERE user_id = $1 AND conversation_id = $2 AND id = $3`,
        [userId, conversationId, messageId],
      );
      if (result.rowCount === 1) {
        await client.query(
          "UPDATE conversations SET updated_at = now() WHERE user_id = $1 AND id = $2",
          [userId, conversationId],
        );
      }
      return result.rowCount === 1;
    });
  },

  async getDailyPlan(userId, date) {
    return withDatabaseClient((client) => selectPlan(client, userId, date));
  },

  async upsertDailyPlan(userId, input) {
    return inUserTransaction(userId, async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM daily_plans
         WHERE user_id = $1 AND plan_date = $2::date
         FOR UPDATE`,
        [userId, input.date],
      );
      const planId = existing.rows[0]?.id ?? input.id ?? randomUUID();
      await client.query(
        `INSERT INTO daily_plans
           (user_id, id, plan_date, title, energy_level)
         VALUES ($1, $2, $3::date, $4, $5)
         ON CONFLICT (user_id, plan_date) DO UPDATE SET
           title = EXCLUDED.title,
           energy_level = EXCLUDED.energy_level,
           updated_at = now()`,
        [userId, planId, input.date, input.title ?? null, input.energyLevel ?? null],
      );

      const completed = await client.query<{ id: string; completedAt: Date | string }>(
        `SELECT id, completed_at AS "completedAt"
         FROM daily_plan_items
         WHERE user_id = $1 AND plan_id = $2 AND completed_at IS NOT NULL`,
        [userId, planId],
      );
      const priorCompleted = new Map(
        completed.rows.map((row) => [row.id, toIso(row.completedAt)]),
      );
      await client.query(
        "DELETE FROM daily_plan_items WHERE user_id = $1 AND plan_id = $2",
        [userId, planId],
      );

      for (const [sortOrder, item] of input.items.entries()) {
        const completedAt = item.completed
          ? priorCompleted.get(item.id) ?? new Date().toISOString()
          : null;
        await client.query(
          `INSERT INTO daily_plan_items
             (user_id, id, plan_id, content, estimated_minutes, sort_order, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
          [
            userId,
            item.id,
            planId,
            item.content,
            item.estimatedMinutes ?? null,
            sortOrder,
            completedAt,
          ],
        );
        if (completedAt) {
          await awardPoints(client, {
            userId,
            eventKey: `plan-item:${item.id}`,
            type: "plan_item",
            sourceId: item.id,
            occurredAt: completedAt,
          });
        }
      }
      return (await selectPlan(client, userId, input.date))!;
    });
  },

  async deleteDailyPlan(userId, date) {
    return inUserTransaction(userId, async (client) => {
      const result = await client.query(
        "DELETE FROM daily_plans WHERE user_id = $1 AND plan_date = $2::date",
        [userId, date],
      );
      return result.rowCount === 1;
    });
  },

  async listActivities(userId, input) {
    return withDatabaseClient(async (client) => {
      const result = await client.query<ActivityRow>(
        `SELECT id,
                activity_type AS type,
                completed_at AS "completedAt",
                duration_seconds::int AS "durationSeconds",
                note,
                metadata,
                created_at AS "createdAt",
                updated_at AS "updatedAt"
         FROM activity_records
         WHERE user_id = $1 AND ($2::text IS NULL OR activity_type = $2)
         ORDER BY completed_at DESC, id DESC
         LIMIT $3`,
        [userId, input.type ?? null, input.limit],
      );
      return result.rows.map(mapActivity);
    });
  },

  async upsertActivity(userId, input) {
    return inUserTransaction(userId, async (client) => {
      const id = input.id ?? randomUUID();
      const result = await client.query<ActivityRow>(
        `INSERT INTO activity_records
           (user_id, id, activity_type, completed_at, duration_seconds, note, metadata)
         VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7::jsonb)
         ON CONFLICT (user_id, id) DO UPDATE SET
           duration_seconds = EXCLUDED.duration_seconds,
           note = EXCLUDED.note,
           metadata = EXCLUDED.metadata,
           updated_at = now()
         WHERE activity_records.activity_type = EXCLUDED.activity_type
         RETURNING id,
                   activity_type AS type,
                   completed_at AS "completedAt",
                   duration_seconds::int AS "durationSeconds",
                   note,
                   metadata,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [
          userId,
          id,
          input.type,
          input.completedAt,
          input.durationSeconds ?? null,
          input.note ?? null,
          JSON.stringify(input.metadata),
        ],
      );
      const row = result.rows[0];
      if (!row) throw new ResourceConflictError("activity type cannot be changed");
      const pointsAwarded = await awardPoints(client, {
        userId,
        eventKey: `activity:${id}`,
        type: row.type,
        sourceId: id,
        occurredAt: toIso(row.completedAt),
      });
      return { activity: mapActivity(row), pointsAwarded };
    });
  },

  async deleteActivity(userId, activityId) {
    return inUserTransaction(userId, async (client) => {
      const result = await client.query(
        "DELETE FROM activity_records WHERE user_id = $1 AND id = $2",
        [userId, activityId],
      );
      // Earned point events deliberately remain immutable and idempotent.
      return result.rowCount === 1;
    });
  },

  async getPointsSummary(userId, referenceDate) {
    return withDatabaseClient(async (client) => {
      const date = referenceDate ?? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const totals = await client.query<{
        weekStart: string;
        weekEnd: string;
        weeklyGoal: number;
        weeklyPoints: number | string;
        totalPoints: number | string;
      }>(
        `WITH bounds AS (
           SELECT date_trunc('week', $2::date::timestamp)::date AS week_start
         )
         SELECT b.week_start::text AS "weekStart",
                (b.week_start + 6)::text AS "weekEnd",
                COALESCE(pref.weekly_goal, 30)::int AS "weeklyGoal",
                COALESCE(sum(e.points) FILTER (
                  WHERE e.occurred_at >= b.week_start::timestamp AT TIME ZONE 'Asia/Shanghai'
                    AND e.occurred_at < (b.week_start + 7)::timestamp AT TIME ZONE 'Asia/Shanghai'
                ), 0)::int AS "weeklyPoints",
                COALESCE(sum(e.points), 0)::int AS "totalPoints"
         FROM bounds b
         LEFT JOIN point_preferences pref ON pref.user_id = $1
         LEFT JOIN point_events e ON e.user_id = $1
         GROUP BY b.week_start, pref.weekly_goal`,
        [userId, date],
      );
      const total = totals.rows[0]!;
      const breakdownResult = await client.query<{
        type: keyof typeof POINT_RULES;
        points: number | string;
      }>(
        `WITH bounds AS (
           SELECT date_trunc('week', $2::date::timestamp)::date AS week_start
         )
         SELECT event_type AS type, sum(points)::int AS points
         FROM point_events, bounds
         WHERE user_id = $1
           AND occurred_at >= bounds.week_start::timestamp AT TIME ZONE 'Asia/Shanghai'
           AND occurred_at < (bounds.week_start + 7)::timestamp AT TIME ZONE 'Asia/Shanghai'
         GROUP BY event_type`,
        [userId, date],
      );
      const breakdown = Object.fromEntries(
        Object.keys(POINT_RULES).map((type) => [type, 0]),
      ) as Record<keyof typeof POINT_RULES, number>;
      for (const row of breakdownResult.rows) breakdown[row.type] = Number(row.points);
      const events = await client.query<{
        eventKey: string;
        type: keyof typeof POINT_RULES;
        points: number;
        sourceId: string;
        occurredAt: Date | string;
      }>(
        `SELECT event_key AS "eventKey",
                event_type AS type,
                points::int AS points,
                source_id AS "sourceId",
                occurred_at AS "occurredAt"
         FROM point_events
         WHERE user_id = $1
         ORDER BY occurred_at DESC, event_key DESC
         LIMIT 20`,
        [userId],
      );
      const weeklyPoints = Number(total.weeklyPoints);
      return {
        weekStart: total.weekStart,
        weekEnd: total.weekEnd,
        weeklyGoal: total.weeklyGoal,
        weeklyPoints,
        totalPoints: Number(total.totalPoints),
        remainingPoints: Math.max(0, total.weeklyGoal - weeklyPoints),
        breakdown,
        recentEvents: events.rows.map((event) => ({
          ...event,
          occurredAt: toIso(event.occurredAt),
        })),
      };
    });
  },

  async updateWeeklyGoal(userId, weeklyGoal) {
    return inUserTransaction(userId, async (client) => {
      const result = await client.query<{ weeklyGoal: number }>(
        `INSERT INTO point_preferences (user_id, weekly_goal)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           weekly_goal = EXCLUDED.weekly_goal,
           updated_at = now()
         RETURNING weekly_goal::int AS "weeklyGoal"`,
        [userId, weeklyGoal],
      );
      return result.rows[0]!;
    });
  },
};
