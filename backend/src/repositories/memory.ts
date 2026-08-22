import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { PersonalDataUserId } from "../contracts/personal-data.js";
import type {
  CreateMemoryInput,
  ListMemoriesInput,
  MemoryEntry,
  UpdateMemoryInput,
} from "../contracts/memory.js";
import { withDatabaseClient } from "../db/pool.js";

type MemoryRow = {
  id: string;
  kind: MemoryEntry["kind"];
  summary: string;
  sourceConversationId: string | null;
  sourceTurnHash: string;
  consentedAt: Date | string;
  archived: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export interface MemoryRepository {
  list(userId: PersonalDataUserId, input: ListMemoriesInput): Promise<MemoryEntry[]>;
  create(
    userId: PersonalDataUserId,
    input: CreateMemoryInput,
  ): Promise<MemoryEntry | null>;
  update(
    userId: PersonalDataUserId,
    memoryId: string,
    input: UpdateMemoryInput,
  ): Promise<MemoryEntry | null>;
  delete(userId: PersonalDataUserId, memoryId: string): Promise<boolean>;
}

const selectColumns = `
  SELECT id,
         memory_kind AS kind,
         summary,
         source_conversation_id AS "sourceConversationId",
         source_turn_hash AS "sourceTurnHash",
         consented_at AS "consentedAt",
         archived,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
  FROM memory_entries`;

function mapMemory(row: MemoryRow): MemoryEntry {
  return {
    ...row,
    consentedAt: new Date(row.consentedAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

async function ensureUser(client: PoolClient, userId: PersonalDataUserId) {
  await client.query(
    `INSERT INTO app_users (id) VALUES ($1)
     ON CONFLICT (id) DO UPDATE SET updated_at = now()`,
    [userId],
  );
}

async function withUserTransaction<T>(
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

export const postgresMemoryRepository: MemoryRepository = {
  async list(userId, input) {
    return withDatabaseClient(async (client) => {
      const result = await client.query<MemoryRow>(
        `${selectColumns}
         WHERE user_id = $1 AND ($2::boolean OR NOT archived)
         ORDER BY updated_at DESC, id DESC
         LIMIT $3`,
        [userId, input.includeArchived, input.limit],
      );
      return result.rows.map(mapMemory);
    });
  },

  async create(userId, input) {
    return withUserTransaction(userId, async (client) => {
      if (input.sourceConversationId) {
        const sourceConversation = await client.query(
          `SELECT 1
           FROM conversations
           WHERE user_id = $1 AND id = $2
           FOR KEY SHARE`,
          [userId, input.sourceConversationId],
        );
        if (sourceConversation.rowCount !== 1) return null;
      }
      const result = await client.query<MemoryRow>(
        `INSERT INTO memory_entries
           (user_id, id, memory_kind, summary, source_conversation_id,
            source_turn_hash, consented_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (user_id, source_turn_hash) DO UPDATE SET
           memory_kind = EXCLUDED.memory_kind,
           summary = EXCLUDED.summary,
           source_conversation_id = EXCLUDED.source_conversation_id,
           archived = false,
           updated_at = now()
         RETURNING id,
                   memory_kind AS kind,
                   summary,
                   source_conversation_id AS "sourceConversationId",
                   source_turn_hash AS "sourceTurnHash",
                   consented_at AS "consentedAt",
                   archived,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [
          userId,
          input.id ?? randomUUID(),
          input.kind,
          input.summary,
          input.sourceConversationId ?? null,
          input.sourceTurnHash,
        ],
      );
      return mapMemory(result.rows[0]!);
    });
  },

  async update(userId, memoryId, input) {
    return withUserTransaction(userId, async (client) => {
      const result = await client.query<MemoryRow>(
        `UPDATE memory_entries
         SET memory_kind = COALESCE($3, memory_kind),
             summary = COALESCE($4, summary),
             archived = COALESCE($5, archived),
             updated_at = now()
         WHERE user_id = $1 AND id = $2
         RETURNING id,
                   memory_kind AS kind,
                   summary,
                   source_conversation_id AS "sourceConversationId",
                   source_turn_hash AS "sourceTurnHash",
                   consented_at AS "consentedAt",
                   archived,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [
          userId,
          memoryId,
          input.kind ?? null,
          input.summary ?? null,
          input.archived ?? null,
        ],
      );
      return result.rows[0] ? mapMemory(result.rows[0]) : null;
    });
  },

  async delete(userId, memoryId) {
    return withUserTransaction(userId, async (client) => {
      const result = await client.query(
        "DELETE FROM memory_entries WHERE user_id = $1 AND id = $2",
        [userId, memoryId],
      );
      return result.rowCount === 1;
    });
  },
};
