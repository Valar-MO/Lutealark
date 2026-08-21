import type { PoolClient } from "pg";
import type { DailyCheckin } from "../contracts/agent.js";
import type { CycleSettings } from "../contracts/cycle.js";
import type {
  BreathingRecord,
  PersonalDataSnapshot,
  PersonalDataUserId,
} from "../contracts/personal-data.js";
import { withDatabaseClient } from "../db/pool.js";
import { businessDateOnly, dateOnlyTimestamp, DateInputError } from "../services/date.js";
import { awardPoints } from "../services/points.js";

// Product screens only need the most recent records. This is a read window,
// not a retention limit: PostgreSQL keeps the complete history for account
// export and future features.
export const PERSONAL_DATA_WINDOW_SIZE = 30;

export interface PersonalDataRepository {
  getPersonalData(userId: PersonalDataUserId): Promise<PersonalDataSnapshot>;
  upsertCycleSettings(
    userId: PersonalDataUserId,
    settings: CycleSettings,
  ): Promise<CycleSettings>;
  upsertDailyCheckin(
    userId: PersonalDataUserId,
    checkin: DailyCheckin,
  ): Promise<DailyCheckin>;
  deleteDailyCheckin(
    userId: PersonalDataUserId,
    date: string,
  ): Promise<boolean>;
  upsertBreathingRecord(
    userId: PersonalDataUserId,
    record: BreathingRecord,
  ): Promise<BreathingRecord>;
  deleteBreathingRecord(
    userId: PersonalDataUserId,
    recordId: string,
  ): Promise<boolean>;
  checkHealth(): Promise<void>;
}

type CycleRow = { lastPeriodDate: string; cycleLength: number };
type CheckinRow = {
  date: string;
  energy: number;
  mood: DailyCheckin["mood"];
  bodyState: unknown;
  note: string | null;
  shareWithChat: boolean;
};
type BreathingRow = Omit<BreathingRecord, "completedAt"> & {
  completedAt: Date | string;
};

async function ensureUser(client: PoolClient, userId: PersonalDataUserId) {
  await client.query(
    `INSERT INTO app_users (id)
     VALUES ($1)
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

export const postgresPersonalDataRepository: PersonalDataRepository = {
  async getPersonalData(userId) {
    return withDatabaseClient(async (client) => {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        const cycle = await client.query<CycleRow>(
          `SELECT last_period_date::text AS "lastPeriodDate",
                cycle_length::int AS "cycleLength"
         FROM cycle_settings
         WHERE user_id = $1`,
          [userId],
        );
        const checkins = await client.query<CheckinRow>(
          `SELECT checkin_date::text AS date,
                energy::int AS energy,
                mood,
                body_state AS "bodyState",
                note,
                share_with_chat AS "shareWithChat"
         FROM daily_checkins
         WHERE user_id = $1
         ORDER BY checkin_date DESC
         LIMIT $2`,
          [userId, PERSONAL_DATA_WINDOW_SIZE],
        );
        const breathing = await client.query<BreathingRow>(
          `SELECT id,
                mode_id AS "modeId",
                mode_name AS "modeName",
                completed_at AS "completedAt",
                duration_seconds::int AS "durationSeconds",
                rating::int AS rating
         FROM breathing_records
         WHERE user_id = $1
         ORDER BY completed_at DESC, id DESC
         LIMIT $2`,
          [userId, PERSONAL_DATA_WINDOW_SIZE],
        );

        const snapshot = {
          cycleSettings: cycle.rows[0] ?? null,
          dailyCheckins: checkins.rows.map((row) => ({
            date: row.date,
            energy: row.energy as DailyCheckin["energy"],
            mood: row.mood,
            bodyState: Array.isArray(row.bodyState)
              ? row.bodyState.filter((value): value is string => typeof value === "string")
              : [],
            ...(row.note ? { note: row.note } : {}),
            shareWithChat: row.shareWithChat,
          })),
          breathingRecords: breathing.rows.map((row) => ({
            ...row,
            completedAt: new Date(row.completedAt).toISOString(),
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

  async upsertCycleSettings(userId, settings) {
    return inUserTransaction(userId, async (client) => {
      await client.query(
        `INSERT INTO cycle_settings
           (user_id, last_period_date, cycle_length)
         VALUES ($1, $2::date, $3)
         ON CONFLICT (user_id) DO UPDATE SET
           last_period_date = EXCLUDED.last_period_date,
           cycle_length = EXCLUDED.cycle_length,
           updated_at = now()`,
        [userId, settings.lastPeriodDate, settings.cycleLength],
      );
      return settings;
    });
  },

  async upsertDailyCheckin(userId, checkin) {
    if (checkin.date > businessDateOnly()) {
      throw new DateInputError("签到日期不能晚于今天");
    }
    return inUserTransaction(userId, async (client) => {
      await client.query(
        `INSERT INTO daily_checkins
           (user_id, checkin_date, energy, mood, body_state, note, share_with_chat)
         VALUES ($1, $2::date, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (user_id, checkin_date) DO UPDATE SET
           energy = EXCLUDED.energy,
           mood = EXCLUDED.mood,
           body_state = EXCLUDED.body_state,
           note = EXCLUDED.note,
           share_with_chat = EXCLUDED.share_with_chat,
           updated_at = now()`,
        [
          userId,
          checkin.date,
          checkin.energy,
          checkin.mood,
          JSON.stringify(checkin.bodyState),
          checkin.note ?? null,
          checkin.shareWithChat,
        ],
      );
      await awardPoints(client, {
        userId,
        eventKey: `checkin:${checkin.date}`,
        type: "checkin",
        sourceId: checkin.date,
        occurredAt: `${checkin.date}T12:00:00+08:00`,
      });
      return checkin;
    });
  },

  async upsertBreathingRecord(userId, record) {
    return inUserTransaction(userId, async (client) => {
      await client.query(
        `INSERT INTO breathing_records
           (user_id, id, mode_id, mode_name, completed_at, duration_seconds, rating)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7)
         ON CONFLICT (user_id, id) DO UPDATE SET
           mode_id = EXCLUDED.mode_id,
           mode_name = EXCLUDED.mode_name,
           completed_at = EXCLUDED.completed_at,
           duration_seconds = EXCLUDED.duration_seconds,
           rating = EXCLUDED.rating,
           updated_at = now()`,
        [
          userId,
          record.id,
          record.modeId,
          record.modeName,
          record.completedAt,
          record.durationSeconds,
          record.rating,
        ],
      );
      await awardPoints(client, {
        userId,
        eventKey: `breathing:${record.id}`,
        type: "breathing",
        sourceId: record.id,
        occurredAt: record.completedAt,
      });
      return record;
    });
  },

  async deleteDailyCheckin(userId, date) {
    dateOnlyTimestamp(date);
    return withDatabaseClient(async (client) => {
      const result = await client.query(
        "DELETE FROM daily_checkins WHERE user_id = $1 AND checkin_date = $2::date",
        [userId, date],
      );
      // Earned point events remain immutable to prevent delete/recreate farming.
      return result.rowCount === 1;
    });
  },

  async deleteBreathingRecord(userId, recordId) {
    return withDatabaseClient(async (client) => {
      const result = await client.query(
        "DELETE FROM breathing_records WHERE user_id = $1 AND id = $2",
        [userId, recordId],
      );
      // Earned point events remain immutable to prevent delete/recreate farming.
      return result.rowCount === 1;
    });
  },

  async checkHealth() {
    await withDatabaseClient(async (client) => {
      await client.query("SELECT 1");
    });
  },
};
