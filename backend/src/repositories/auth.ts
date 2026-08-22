import { randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  AccountDataSnapshot,
  AuthUser,
  DataMergeStatus,
} from "../contracts/auth.js";
import type { PersonalDataUserId } from "../contracts/personal-data.js";
import { withDatabaseClient } from "../db/pool.js";

export interface AuthCredential extends AuthUser {
  passwordHash: Buffer;
  passwordSalt: Buffer;
}

export interface StoredSession extends AuthUser {
  expiresAt: Date;
}

export interface SessionWrite {
  id: string;
  tokenHash: Buffer;
  expiresAt: Date;
}

export interface RegisterAccountWrite {
  userId: PersonalDataUserId;
  email: string;
  passwordHash: Buffer;
  passwordSalt: Buffer;
  session: SessionWrite;
  deviceUserId?: PersonalDataUserId;
}

export interface AccountSessionWrite {
  userId: PersonalDataUserId;
  session: SessionWrite;
  deviceUserId?: PersonalDataUserId;
}

export interface AuthRepository {
  findAccountByEmail(email: string): Promise<AuthCredential | null>;
  findAccountByUserId(userId: PersonalDataUserId): Promise<AuthCredential | null>;
  registerAccount(input: RegisterAccountWrite): Promise<DataMergeStatus>;
  createAccountSession(input: AccountSessionWrite): Promise<DataMergeStatus>;
  findActiveSession(tokenHash: Buffer, now: Date): Promise<StoredSession | null>;
  deleteSession(tokenHash: Buffer): Promise<void>;
  getAccountData(userId: PersonalDataUserId): Promise<AccountDataSnapshot | null>;
  deleteAccount(
    userId: PersonalDataUserId,
    expectedPasswordHash: Buffer,
  ): Promise<boolean>;
}

export class DuplicateAuthEmailError extends Error {
  constructor() {
    super("An account already exists for this email");
    this.name = "DuplicateAuthEmailError";
  }
}

type AccountRow = {
  userId: string;
  email: string;
  passwordHash: Buffer;
  passwordSalt: Buffer;
};

type SessionRow = {
  userId: string;
  email: string;
  expiresAt: Date | string;
};

type ExportAccountRow = {
  userId: string;
  email: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ExportConversation = AccountDataSnapshot["conversations"][number];
type ExportMessage = ExportConversation["messages"][number];
type ExportPlan = AccountDataSnapshot["dailyPlans"][number];
type ExportPlanItem = ExportPlan["items"][number];

type SourcePlanRow = {
  id: string;
  planDate: string;
  title: string | null;
  energyLevel: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type SourcePlanItemRow = {
  id: string;
  planId: string;
  content: string;
  estimatedMinutes: number | null;
  sortOrder: number;
  completedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type SourceMemoryRow = {
  id: string;
  memoryKind: string;
  summary: string;
  sourceConversationId: string | null;
  sourceTurnHash: string;
  consentedAt: Date | string;
  archived: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type PgConstraintError = Error & {
  code?: string;
  constraint?: string;
};

function isDuplicateEmail(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const pgError = error as PgConstraintError;
  return pgError.code === "23505"
    && pgError.constraint === "auth_accounts_email_unique";
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function objectMetadata(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function inTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withDatabaseClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

async function unusedPlanId(
  client: PoolClient,
  accountUserId: PersonalDataUserId,
  preferredId: string,
): Promise<string> {
  let candidate = preferredId;
  while (true) {
    const existing = await client.query(
      "SELECT 1 FROM daily_plans WHERE user_id = $1 AND id = $2",
      [accountUserId, candidate],
    );
    if (!existing.rowCount) return candidate;
    candidate = randomUUID();
  }
}

async function unusedPlanItemId(
  client: PoolClient,
  accountUserId: PersonalDataUserId,
  preferredId: string,
): Promise<string> {
  let candidate = preferredId;
  while (true) {
    const existing = await client.query(
      "SELECT 1 FROM daily_plan_items WHERE user_id = $1 AND id = $2",
      [accountUserId, candidate],
    );
    if (!existing.rowCount) return candidate;
    candidate = randomUUID();
  }
}

async function unusedMemoryId(
  client: PoolClient,
  accountUserId: PersonalDataUserId,
  preferredId: string,
): Promise<string> {
  let candidate = preferredId;
  while (true) {
    const existing = await client.query(
      "SELECT 1 FROM memory_entries WHERE user_id = $1 AND id = $2",
      [accountUserId, candidate],
    );
    if (!existing.rowCount) return candidate;
    candidate = randomUUID();
  }
}

async function mergeMemoryArchiveData(
  client: PoolClient,
  deviceUserId: PersonalDataUserId,
  accountUserId: PersonalDataUserId,
): Promise<void> {
  const sourceMemories = await client.query<SourceMemoryRow>(
    `SELECT id,
            memory_kind AS "memoryKind",
            summary,
            source_conversation_id AS "sourceConversationId",
            source_turn_hash AS "sourceTurnHash",
            consented_at AS "consentedAt",
            archived,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM memory_entries
     WHERE user_id = $1
     ORDER BY created_at, id`,
    [deviceUserId],
  );
  for (const source of sourceMemories.rows) {
    const target = await client.query<{ id: string }>(
      `SELECT id
       FROM memory_entries
       WHERE user_id = $1 AND source_turn_hash = $2
       FOR UPDATE`,
      [accountUserId, source.sourceTurnHash],
    );
    const targetId = target.rows[0]?.id;
    if (targetId) {
      await client.query(
        `UPDATE memory_entries
         SET memory_kind = $3,
             summary = $4,
             source_conversation_id = (
               SELECT id
               FROM conversations
               WHERE user_id = $1 AND id = $5::uuid
             ),
             consented_at = $6,
             archived = $7,
             created_at = LEAST(created_at, $8),
             updated_at = $9
         WHERE user_id = $1 AND id = $2
           AND updated_at < $9`,
        [
          accountUserId,
          targetId,
          source.memoryKind,
          source.summary,
          source.sourceConversationId,
          source.consentedAt,
          source.archived,
          source.createdAt,
          source.updatedAt,
        ],
      );
      continue;
    }
    const id = await unusedMemoryId(client, accountUserId, source.id);
    await client.query(
      `INSERT INTO memory_entries
       (user_id, id, memory_kind, summary, source_conversation_id,
          source_turn_hash, consented_at, archived, created_at, updated_at)
       VALUES (
         $1, $2, $3, $4,
         (SELECT id FROM conversations WHERE user_id = $1 AND id = $5::uuid),
         $6, $7, $8, $9, $10
       )`,
      [
        accountUserId,
        id,
        source.memoryKind,
        source.summary,
        source.sourceConversationId,
        source.sourceTurnHash,
        source.consentedAt,
        source.archived,
        source.createdAt,
        source.updatedAt,
      ],
    );
  }
  await client.query("DELETE FROM memory_entries WHERE user_id = $1", [deviceUserId]);
}

/** Merge tables introduced by 002_product_features.sql. */
async function mergeProductFeatureData(
  client: PoolClient,
  deviceUserId: PersonalDataUserId,
  accountUserId: PersonalDataUserId,
): Promise<void> {
  await client.query(
    `INSERT INTO conversations
       (user_id, id, title, archived, created_at, updated_at)
     SELECT $2, id, title, archived, created_at, updated_at
     FROM conversations
     WHERE user_id = $1
     ON CONFLICT (user_id, id) DO UPDATE SET
       title = EXCLUDED.title,
       archived = EXCLUDED.archived,
       created_at = LEAST(conversations.created_at, EXCLUDED.created_at),
       updated_at = EXCLUDED.updated_at
     WHERE EXCLUDED.updated_at > conversations.updated_at`,
    [deviceUserId, accountUserId],
  );
  await client.query(
    `INSERT INTO conversation_messages
       (user_id, id, conversation_id, role, content, metadata,
        created_at, updated_at)
     SELECT $2, id, conversation_id, role, content, metadata,
            created_at, updated_at
     FROM conversation_messages
     WHERE user_id = $1
     ON CONFLICT (user_id, id) DO UPDATE SET
       conversation_id = EXCLUDED.conversation_id,
       role = EXCLUDED.role,
       content = EXCLUDED.content,
       metadata = EXCLUDED.metadata,
       created_at = LEAST(conversation_messages.created_at, EXCLUDED.created_at),
       updated_at = EXCLUDED.updated_at
     WHERE EXCLUDED.updated_at > conversation_messages.updated_at`,
    [deviceUserId, accountUserId],
  );

  // Plans have both an id key and one-plan-per-date key. Merge by date, then
  // merge items by their stable sort position so neither constraint can abort
  // an account claim. UUIDs are retained unless they collide elsewhere.
  const sourcePlans = await client.query<SourcePlanRow>(
    `SELECT id,
            plan_date::text AS "planDate",
            title,
            energy_level::int AS "energyLevel",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM daily_plans
     WHERE user_id = $1
     ORDER BY plan_date, id`,
    [deviceUserId],
  );
  const itemIdMap = new Map<string, string>();
  for (const sourcePlan of sourcePlans.rows) {
    const target = await client.query<{ id: string }>(
      `SELECT id
       FROM daily_plans
       WHERE user_id = $1 AND plan_date = $2::date
       FOR UPDATE`,
      [accountUserId, sourcePlan.planDate],
    );
    let targetPlanId = target.rows[0]?.id;
    if (!targetPlanId) {
      targetPlanId = await unusedPlanId(client, accountUserId, sourcePlan.id);
      await client.query(
        `INSERT INTO daily_plans
           (user_id, id, plan_date, title, energy_level, created_at, updated_at)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7)`,
        [
          accountUserId,
          targetPlanId,
          sourcePlan.planDate,
          sourcePlan.title,
          sourcePlan.energyLevel,
          sourcePlan.createdAt,
          sourcePlan.updatedAt,
        ],
      );
    } else {
      await client.query(
        `UPDATE daily_plans
         SET title = $3,
             energy_level = $4,
             created_at = LEAST(created_at, $5),
             updated_at = $6
         WHERE user_id = $1 AND id = $2
           AND updated_at < $6`,
        [
          accountUserId,
          targetPlanId,
          sourcePlan.title,
          sourcePlan.energyLevel,
          sourcePlan.createdAt,
          sourcePlan.updatedAt,
        ],
      );
    }

    const sourceItems = await client.query<SourcePlanItemRow>(
      `SELECT id,
              plan_id AS "planId",
              content,
              estimated_minutes::int AS "estimatedMinutes",
              sort_order::int AS "sortOrder",
              completed_at AS "completedAt",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM daily_plan_items
       WHERE user_id = $1 AND plan_id = $2
       ORDER BY sort_order, id`,
      [deviceUserId, sourcePlan.id],
    );
    for (const sourceItem of sourceItems.rows) {
      const targetItem = await client.query<{ id: string }>(
        `SELECT id
         FROM daily_plan_items
         WHERE user_id = $1 AND plan_id = $2 AND sort_order = $3
         FOR UPDATE`,
        [accountUserId, targetPlanId, sourceItem.sortOrder],
      );
      let targetItemId = targetItem.rows[0]?.id;
      if (!targetItemId) {
        targetItemId = await unusedPlanItemId(client, accountUserId, sourceItem.id);
        await client.query(
          `INSERT INTO daily_plan_items
             (user_id, id, plan_id, content, estimated_minutes, sort_order,
              completed_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            accountUserId,
            targetItemId,
            targetPlanId,
            sourceItem.content,
            sourceItem.estimatedMinutes,
            sourceItem.sortOrder,
            sourceItem.completedAt,
            sourceItem.createdAt,
            sourceItem.updatedAt,
          ],
        );
      } else {
        await client.query(
          `UPDATE daily_plan_items
           SET content = $4,
               estimated_minutes = $5,
               completed_at = $6,
               created_at = LEAST(created_at, $7),
               updated_at = $8
           WHERE user_id = $1 AND id = $2 AND plan_id = $3
             AND updated_at < $8`,
          [
            accountUserId,
            targetItemId,
            targetPlanId,
            sourceItem.content,
            sourceItem.estimatedMinutes,
            sourceItem.completedAt,
            sourceItem.createdAt,
            sourceItem.updatedAt,
          ],
        );
      }
      itemIdMap.set(sourceItem.id, targetItemId);
    }
  }

  await client.query(
    `INSERT INTO activity_records
       (user_id, id, activity_type, completed_at, duration_seconds, note,
        metadata, created_at, updated_at)
     SELECT $2, id, activity_type, completed_at, duration_seconds, note,
            metadata, created_at, updated_at
     FROM activity_records
     WHERE user_id = $1
     ON CONFLICT (user_id, id) DO UPDATE SET
       activity_type = EXCLUDED.activity_type,
       completed_at = EXCLUDED.completed_at,
       duration_seconds = EXCLUDED.duration_seconds,
       note = EXCLUDED.note,
       metadata = EXCLUDED.metadata,
       created_at = LEAST(activity_records.created_at, EXCLUDED.created_at),
       updated_at = EXCLUDED.updated_at
     WHERE EXCLUDED.updated_at > activity_records.updated_at`,
    [deviceUserId, accountUserId],
  );

  const sourcePoints = await client.query<{
    eventKey: string;
    eventType: string;
    points: number;
    sourceId: string;
    occurredAt: Date | string;
    createdAt: Date | string;
  }>(
    `SELECT event_key AS "eventKey",
            event_type AS "eventType",
            points::int AS points,
            source_id AS "sourceId",
            occurred_at AS "occurredAt",
            created_at AS "createdAt"
     FROM point_events
     WHERE user_id = $1
     ORDER BY occurred_at, event_key`,
    [deviceUserId],
  );
  for (const point of sourcePoints.rows) {
    const remappedItemId = point.eventType === "plan_item"
      ? itemIdMap.get(point.sourceId)
      : undefined;
    const sourceId = remappedItemId ?? point.sourceId;
    const eventKey = remappedItemId
      ? `plan-item:${remappedItemId}`
      : point.eventKey;
    await client.query(
      `INSERT INTO point_events
         (user_id, event_key, event_type, points, source_id, occurred_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, event_key) DO NOTHING`,
      [
        accountUserId,
        eventKey,
        point.eventType,
        point.points,
        sourceId,
        point.occurredAt,
        point.createdAt,
      ],
    );
  }

  await client.query(
    `INSERT INTO point_preferences
       (user_id, weekly_goal, created_at, updated_at)
     SELECT $2, weekly_goal, created_at, updated_at
     FROM point_preferences
     WHERE user_id = $1
     ON CONFLICT (user_id) DO UPDATE SET
       weekly_goal = EXCLUDED.weekly_goal,
       created_at = LEAST(point_preferences.created_at, EXCLUDED.created_at),
       updated_at = EXCLUDED.updated_at
     WHERE EXCLUDED.updated_at > point_preferences.updated_at`,
    [deviceUserId, accountUserId],
  );

  await client.query("DELETE FROM conversations WHERE user_id = $1", [deviceUserId]);
  await client.query("DELETE FROM daily_plans WHERE user_id = $1", [deviceUserId]);
  await client.query("DELETE FROM activity_records WHERE user_id = $1", [deviceUserId]);
  await client.query("DELETE FROM point_events WHERE user_id = $1", [deviceUserId]);
  await client.query("DELETE FROM point_preferences WHERE user_id = $1", [deviceUserId]);
}

/**
 * Claims and merges the three legacy personal-data collections atomically.
 * Conflicts use the row with the later updated_at; ties keep the account row.
 * A UUID belonging to another registered account is never eligible for merge.
 */
async function mergeAnonymousPersonalData(
  client: PoolClient,
  deviceUserId: PersonalDataUserId | undefined,
  accountUserId: PersonalDataUserId,
): Promise<DataMergeStatus> {
  if (!deviceUserId) return "no_device";
  if (deviceUserId === accountUserId) return "same_user";

  // Serializes both identity rows with normal feature writes. The order keeps
  // concurrent claims of two devices/accounts from taking opposite locks.
  await client.query(
    `SELECT id
     FROM app_users
     WHERE id = ANY($1::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [[deviceUserId, accountUserId]],
  );

  const registeredSource = await client.query(
    `SELECT 1
     FROM auth_accounts
     WHERE user_id = $1`,
    [deviceUserId],
  );
  if (registeredSource.rowCount) return "registered_account";

  await client.query(
    `INSERT INTO auth_device_claims (device_user_id, account_user_id)
     VALUES ($1, $2)
     ON CONFLICT (device_user_id) DO NOTHING`,
    [deviceUserId, accountUserId],
  );
  const claim = await client.query<{ accountUserId: string }>(
    `SELECT account_user_id AS "accountUserId"
     FROM auth_device_claims
     WHERE device_user_id = $1
     FOR UPDATE`,
    [deviceUserId],
  );
  if (claim.rows[0]?.accountUserId !== accountUserId) {
    return "already_claimed";
  }

  await client.query(
    `INSERT INTO cycle_settings
       (user_id, last_period_date, cycle_length, created_at, updated_at)
     SELECT $2, last_period_date, cycle_length, created_at, updated_at
     FROM cycle_settings
     WHERE user_id = $1
     ON CONFLICT (user_id) DO UPDATE SET
       last_period_date = EXCLUDED.last_period_date,
       cycle_length = EXCLUDED.cycle_length,
       created_at = LEAST(cycle_settings.created_at, EXCLUDED.created_at),
       updated_at = EXCLUDED.updated_at
     WHERE EXCLUDED.updated_at > cycle_settings.updated_at`,
    [deviceUserId, accountUserId],
  );

  await client.query(
    `INSERT INTO daily_checkins
       (user_id, checkin_date, energy, mood, body_state, note,
        share_with_chat, created_at, updated_at)
     SELECT $2, checkin_date, energy, mood, body_state, note,
            share_with_chat, created_at, updated_at
     FROM daily_checkins
     WHERE user_id = $1
     ON CONFLICT (user_id, checkin_date) DO UPDATE SET
       energy = EXCLUDED.energy,
       mood = EXCLUDED.mood,
       body_state = EXCLUDED.body_state,
       note = EXCLUDED.note,
       share_with_chat = EXCLUDED.share_with_chat,
       created_at = LEAST(daily_checkins.created_at, EXCLUDED.created_at),
       updated_at = EXCLUDED.updated_at
     WHERE EXCLUDED.updated_at > daily_checkins.updated_at`,
    [deviceUserId, accountUserId],
  );

  await client.query(
    `INSERT INTO breathing_records
       (user_id, id, mode_id, mode_name, completed_at, duration_seconds,
        rating, created_at, updated_at)
     SELECT $2, id, mode_id, mode_name, completed_at, duration_seconds,
            rating, created_at, updated_at
     FROM breathing_records
     WHERE user_id = $1
     ON CONFLICT (user_id, id) DO UPDATE SET
       mode_id = EXCLUDED.mode_id,
       mode_name = EXCLUDED.mode_name,
       completed_at = EXCLUDED.completed_at,
       duration_seconds = EXCLUDED.duration_seconds,
       rating = EXCLUDED.rating,
       created_at = LEAST(breathing_records.created_at, EXCLUDED.created_at),
       updated_at = EXCLUDED.updated_at
     WHERE EXCLUDED.updated_at > breathing_records.updated_at`,
    [deviceUserId, accountUserId],
  );

  await mergeProductFeatureData(client, deviceUserId, accountUserId);
  await mergeMemoryArchiveData(client, deviceUserId, accountUserId);

  await client.query("DELETE FROM cycle_settings WHERE user_id = $1", [deviceUserId]);
  await client.query("DELETE FROM daily_checkins WHERE user_id = $1", [deviceUserId]);
  await client.query("DELETE FROM breathing_records WHERE user_id = $1", [deviceUserId]);
  await client.query(
    "UPDATE app_users SET updated_at = now() WHERE id = $1",
    [accountUserId],
  );
  return "merged";
}

async function deleteExpiredSessions(client: PoolClient): Promise<void> {
  await client.query("DELETE FROM auth_sessions WHERE expires_at <= now()");
}

export const postgresAuthRepository: AuthRepository = {
  async findAccountByEmail(email) {
    return withDatabaseClient(async (client) => {
      const result = await client.query<AccountRow>(
        `SELECT user_id AS "userId",
                email,
                password_hash AS "passwordHash",
                password_salt AS "passwordSalt"
         FROM auth_accounts
         WHERE email = $1`,
        [email],
      );
      return result.rows[0] ?? null;
    });
  },

  async findAccountByUserId(userId) {
    return withDatabaseClient(async (client) => {
      const result = await client.query<AccountRow>(
        `SELECT user_id AS "userId",
                email,
                password_hash AS "passwordHash",
                password_salt AS "passwordSalt"
         FROM auth_accounts
         WHERE user_id = $1`,
        [userId],
      );
      return result.rows[0] ?? null;
    });
  },

  async registerAccount(input) {
    try {
      return await inTransaction(async (client) => {
        await client.query(
          `INSERT INTO app_users (id)
           VALUES ($1)`,
          [input.userId],
        );
        await client.query(
          `INSERT INTO auth_accounts
             (user_id, email, password_hash, password_salt)
           VALUES ($1, $2, $3, $4)`,
          [input.userId, input.email, input.passwordHash, input.passwordSalt],
        );
        const mergeStatus = await mergeAnonymousPersonalData(
          client,
          input.deviceUserId,
          input.userId,
        );
        await deleteExpiredSessions(client);
        await client.query(
          `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [input.session.id, input.userId, input.session.tokenHash, input.session.expiresAt],
        );
        return mergeStatus;
      });
    } catch (error) {
      if (isDuplicateEmail(error)) throw new DuplicateAuthEmailError();
      throw error;
    }
  },

  async createAccountSession(input) {
    return inTransaction(async (client) => {
      const account = await client.query(
        `SELECT 1
         FROM auth_accounts
         WHERE user_id = $1
         FOR UPDATE`,
        [input.userId],
      );
      if (!account.rowCount) {
        throw new Error("Authenticated account no longer exists");
      }
      const mergeStatus = await mergeAnonymousPersonalData(
        client,
        input.deviceUserId,
        input.userId,
      );
      await deleteExpiredSessions(client);
      await client.query(
        `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [input.session.id, input.userId, input.session.tokenHash, input.session.expiresAt],
      );
      return mergeStatus;
    });
  },

  async findActiveSession(tokenHash, now) {
    return withDatabaseClient(async (client) => {
      const result = await client.query<SessionRow>(
        `UPDATE auth_sessions AS session
         SET last_seen_at = $2
         FROM auth_accounts AS account
         WHERE session.token_hash = $1
           AND session.expires_at > $2
           AND account.user_id = session.user_id
         RETURNING account.user_id AS "userId",
                   account.email,
                   session.expires_at AS "expiresAt"`,
        [tokenHash, now],
      );
      const row = result.rows[0];
      return row
        ? { ...row, expiresAt: new Date(row.expiresAt) }
        : null;
    });
  },

  async deleteSession(tokenHash) {
    await withDatabaseClient(async (client) => {
      await client.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
    });
  },

  async getAccountData(userId) {
    return withDatabaseClient(async (client) => {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        const accountResult = await client.query<ExportAccountRow>(
          `SELECT user_id AS "userId",
                  email,
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM auth_accounts
           WHERE user_id = $1`,
          [userId],
        );
        const account = accountResult.rows[0];
        if (!account) {
          await client.query("COMMIT");
          return null;
        }

        const claims = await client.query<{
          deviceUserId: string;
          claimedAt: Date | string;
        }>(
          `SELECT device_user_id AS "deviceUserId",
                  claimed_at AS "claimedAt"
           FROM auth_device_claims
           WHERE account_user_id = $1
           ORDER BY claimed_at, device_user_id`,
          [userId],
        );
        const cycle = await client.query<{
          lastPeriodDate: string;
          cycleLength: number;
          createdAt: Date | string;
          updatedAt: Date | string;
        }>(
          `SELECT last_period_date::text AS "lastPeriodDate",
                  cycle_length::int AS "cycleLength",
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM cycle_settings
           WHERE user_id = $1`,
          [userId],
        );
        const checkins = await client.query<{
          date: string;
          energy: number;
          mood: AccountDataSnapshot["dailyCheckins"][number]["mood"];
          bodyState: unknown;
          note: string | null;
          shareWithChat: boolean;
          createdAt: Date | string;
          updatedAt: Date | string;
        }>(
          `SELECT checkin_date::text AS date,
                  energy::int AS energy,
                  mood,
                  body_state AS "bodyState",
                  note,
                  share_with_chat AS "shareWithChat",
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM daily_checkins
           WHERE user_id = $1
           ORDER BY checkin_date`,
          [userId],
        );
        const breathing = await client.query<{
          id: string;
          modeId: string;
          modeName: string;
          completedAt: Date | string;
          durationSeconds: number;
          rating: number | null;
          createdAt: Date | string;
          updatedAt: Date | string;
        }>(
          `SELECT id,
                  mode_id AS "modeId",
                  mode_name AS "modeName",
                  completed_at AS "completedAt",
                  duration_seconds::int AS "durationSeconds",
                  rating::int AS rating,
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM breathing_records
           WHERE user_id = $1
           ORDER BY completed_at, id`,
          [userId],
        );
        const conversations = await client.query<
          Omit<ExportConversation, "createdAt" | "updatedAt" | "messages"> & {
            createdAt: Date | string;
            updatedAt: Date | string;
          }
        >(
          `SELECT id, title, archived,
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM conversations
           WHERE user_id = $1
           ORDER BY created_at, id`,
          [userId],
        );
        const messages = await client.query<
          Omit<ExportMessage, "metadata" | "createdAt" | "updatedAt"> & {
            metadata: unknown;
            createdAt: Date | string;
            updatedAt: Date | string;
          }
        >(
          `SELECT id,
                  conversation_id AS "conversationId",
                  role,
                  content,
                  metadata,
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM conversation_messages
           WHERE user_id = $1
           ORDER BY created_at, id`,
          [userId],
        );
        const plans = await client.query<
          Omit<ExportPlan, "date" | "createdAt" | "updatedAt" | "items"> & {
            date: string;
            createdAt: Date | string;
            updatedAt: Date | string;
          }
        >(
          `SELECT id,
                  plan_date::text AS date,
                  title,
                  energy_level::int AS "energyLevel",
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM daily_plans
           WHERE user_id = $1
           ORDER BY plan_date, id`,
          [userId],
        );
        const planItems = await client.query<
          Omit<ExportPlanItem, "completedAt" | "createdAt" | "updatedAt"> & {
            planId: string;
            completedAt: Date | string | null;
            createdAt: Date | string;
            updatedAt: Date | string;
          }
        >(
          `SELECT id,
                  plan_id AS "planId",
                  content,
                  estimated_minutes::int AS "estimatedMinutes",
                  sort_order::int AS "sortOrder",
                  completed_at AS "completedAt",
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM daily_plan_items
           WHERE user_id = $1
           ORDER BY plan_id, sort_order, id`,
          [userId],
        );
        const activities = await client.query<{
          id: string;
          type: AccountDataSnapshot["activities"][number]["type"];
          completedAt: Date | string;
          durationSeconds: number | null;
          note: string | null;
          metadata: unknown;
          createdAt: Date | string;
          updatedAt: Date | string;
        }>(
          `SELECT id,
                  activity_type AS type,
                  completed_at AS "completedAt",
                  duration_seconds::int AS "durationSeconds",
                  note,
                  metadata,
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM activity_records
           WHERE user_id = $1
           ORDER BY completed_at, id`,
          [userId],
        );
        const pointPreference = await client.query<{
          weeklyGoal: number;
          createdAt: Date | string;
          updatedAt: Date | string;
        }>(
          `SELECT weekly_goal::int AS "weeklyGoal",
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM point_preferences
           WHERE user_id = $1`,
          [userId],
        );
        const pointEvents = await client.query<{
          eventKey: string;
          type: AccountDataSnapshot["points"]["events"][number]["type"];
          points: number;
          sourceId: string;
          occurredAt: Date | string;
          createdAt: Date | string;
        }>(
          `SELECT event_key AS "eventKey",
                  event_type AS type,
                  points::int AS points,
                  source_id AS "sourceId",
                  occurred_at AS "occurredAt",
                  created_at AS "createdAt"
           FROM point_events
           WHERE user_id = $1
           ORDER BY occurred_at, event_key`,
          [userId],
        );
        const memories = await client.query<{
          id: string;
          kind: AccountDataSnapshot["memories"][number]["kind"];
          summary: string;
          sourceConversationId: string | null;
          sourceTurnHash: string;
          consentedAt: Date | string;
          archived: boolean;
          createdAt: Date | string;
          updatedAt: Date | string;
        }>(
          `SELECT id,
                  memory_kind AS kind,
                  summary,
                  source_conversation_id AS "sourceConversationId",
                  source_turn_hash AS "sourceTurnHash",
                  consented_at AS "consentedAt",
                  archived,
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM memory_entries
           WHERE user_id = $1
           ORDER BY created_at, id`,
          [userId],
        );

        const messagesByConversation = new Map<string, ExportMessage[]>();
        for (const message of messages.rows) {
          const mapped: ExportMessage = {
            ...message,
            metadata: objectMetadata(message.metadata),
            createdAt: toIso(message.createdAt),
            updatedAt: toIso(message.updatedAt),
          };
          const existing = messagesByConversation.get(message.conversationId) ?? [];
          existing.push(mapped);
          messagesByConversation.set(message.conversationId, existing);
        }
        const itemsByPlan = new Map<string, ExportPlanItem[]>();
        for (const item of planItems.rows) {
          const mapped: ExportPlanItem = {
            id: item.id,
            content: item.content,
            estimatedMinutes: item.estimatedMinutes,
            sortOrder: item.sortOrder,
            completedAt: item.completedAt ? toIso(item.completedAt) : null,
            createdAt: toIso(item.createdAt),
            updatedAt: toIso(item.updatedAt),
          };
          const existing = itemsByPlan.get(item.planId) ?? [];
          existing.push(mapped);
          itemsByPlan.set(item.planId, existing);
        }
        const preference = pointPreference.rows[0];
        const cycleRow = cycle.rows[0];
        const snapshot: AccountDataSnapshot = {
          account: {
            userId: account.userId,
            email: account.email,
            createdAt: toIso(account.createdAt),
            updatedAt: toIso(account.updatedAt),
            claimedDevices: claims.rows.map((claim) => ({
              deviceUserId: claim.deviceUserId,
              claimedAt: toIso(claim.claimedAt),
            })),
          },
          cycleSettings: cycleRow
            ? {
                ...cycleRow,
                createdAt: toIso(cycleRow.createdAt),
                updatedAt: toIso(cycleRow.updatedAt),
              }
            : null,
          dailyCheckins: checkins.rows.map((checkin) => ({
            date: checkin.date,
            energy: checkin.energy as 1 | 2 | 3 | 4 | 5,
            mood: checkin.mood,
            bodyState: Array.isArray(checkin.bodyState)
              ? checkin.bodyState.filter(
                  (value): value is string => typeof value === "string",
                )
              : [],
            note: checkin.note,
            shareWithChat: checkin.shareWithChat,
            createdAt: toIso(checkin.createdAt),
            updatedAt: toIso(checkin.updatedAt),
          })),
          breathingRecords: breathing.rows.map((record) => ({
            ...record,
            completedAt: toIso(record.completedAt),
            createdAt: toIso(record.createdAt),
            updatedAt: toIso(record.updatedAt),
          })),
          conversations: conversations.rows.map((conversation) => ({
            ...conversation,
            createdAt: toIso(conversation.createdAt),
            updatedAt: toIso(conversation.updatedAt),
            messages: messagesByConversation.get(conversation.id) ?? [],
          })),
          dailyPlans: plans.rows.map((plan) => ({
            ...plan,
            createdAt: toIso(plan.createdAt),
            updatedAt: toIso(plan.updatedAt),
            items: itemsByPlan.get(plan.id) ?? [],
          })),
          activities: activities.rows.map((activity) => ({
            ...activity,
            completedAt: toIso(activity.completedAt),
            metadata: objectMetadata(activity.metadata),
            createdAt: toIso(activity.createdAt),
            updatedAt: toIso(activity.updatedAt),
          })),
          points: {
            weeklyGoal: preference?.weeklyGoal ?? 30,
            preferenceCreatedAt: preference ? toIso(preference.createdAt) : null,
            preferenceUpdatedAt: preference ? toIso(preference.updatedAt) : null,
            events: pointEvents.rows.map((event) => ({
              ...event,
              occurredAt: toIso(event.occurredAt),
              createdAt: toIso(event.createdAt),
            })),
          },
          memories: memories.rows.map((memory) => ({
            ...memory,
            consentedAt: toIso(memory.consentedAt),
            createdAt: toIso(memory.createdAt),
            updatedAt: toIso(memory.updatedAt),
          })),
        };
        await client.query("COMMIT");
        return snapshot;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
  },

  async deleteAccount(userId, expectedPasswordHash) {
    return inTransaction(async (client) => {
      const credential = await client.query<{ passwordHash: Buffer }>(
        `SELECT password_hash AS "passwordHash"
         FROM auth_accounts
         WHERE user_id = $1
         FOR UPDATE`,
        [userId],
      );
      const currentHash = credential.rows[0]?.passwordHash;
      if (!currentHash
        || currentHash.length !== expectedPasswordHash.length
        || !timingSafeEqual(currentHash, expectedPasswordHash)) {
        return false;
      }
      const deleted = await client.query(
        "DELETE FROM app_users WHERE id = $1",
        [userId],
      );
      return deleted.rowCount === 1;
    });
  },
};
