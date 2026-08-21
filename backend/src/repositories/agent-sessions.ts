import { timingSafeEqual } from "node:crypto";
import { withDatabaseClient } from "../db/pool.js";

export type AgentSessionSubjectType = "account" | "anonymous" | "public";
export type AgentSessionMode = "online" | "offline";

export type AgentSessionSubject =
  | { type: "account" | "anonymous"; id: string }
  | { type: "public"; id: null };

export interface AgentSessionBinding {
  subject: AgentSessionSubject;
  mode: AgentSessionMode;
  expiresAt: Date;
  lastSeenAt: Date;
}

export interface BindAgentSessionInput extends AgentSessionBinding {
  sessionHash: Buffer;
}

export interface AgentSessionBindingRepository {
  bind(input: BindAgentSessionInput): Promise<boolean>;
  findActiveAndTouch(sessionHash: Buffer, now: Date): Promise<AgentSessionBinding | null>;
}

type BindingRow = {
  subjectType: AgentSessionSubjectType;
  subjectId: string | null;
  mode: AgentSessionMode;
  expiresAt: Date | string;
  lastSeenAt: Date | string;
};

function bindingFromRow(row: BindingRow): AgentSessionBinding {
  const subject: AgentSessionSubject = row.subjectType === "public"
    ? { type: "public", id: null }
    : { type: row.subjectType, id: row.subjectId! };
  return {
    subject,
    mode: row.mode,
    expiresAt: new Date(row.expiresAt),
    lastSeenAt: new Date(row.lastSeenAt),
  };
}

export const postgresAgentSessionBindingRepository: AgentSessionBindingRepository = {
  async bind(input) {
    return withDatabaseClient(async (client) => {
      const result = await client.query(
        `INSERT INTO agent_session_bindings
           (session_hash, subject_type, subject_id, account_user_id,
            session_mode, expires_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_hash) DO UPDATE SET
           expires_at = GREATEST(
             agent_session_bindings.expires_at,
             EXCLUDED.expires_at
           ),
           last_seen_at = EXCLUDED.last_seen_at
         WHERE agent_session_bindings.subject_type = EXCLUDED.subject_type
           AND agent_session_bindings.subject_id IS NOT DISTINCT FROM EXCLUDED.subject_id
           AND agent_session_bindings.session_mode = EXCLUDED.session_mode
         RETURNING session_hash`,
        [
          input.sessionHash,
          input.subject.type,
          input.subject.id,
          input.subject.type === "account" ? input.subject.id : null,
          input.mode,
          input.expiresAt,
          input.lastSeenAt,
        ],
      );
      return result.rowCount === 1;
    });
  },

  async findActiveAndTouch(sessionHash, now) {
    return withDatabaseClient(async (client) => {
      const result = await client.query<BindingRow>(
        `UPDATE agent_session_bindings
         SET last_seen_at = $2
         WHERE session_hash = $1
           AND expires_at > $2
         RETURNING subject_type AS "subjectType",
                   subject_id AS "subjectId",
                   session_mode AS mode,
                   expires_at AS "expiresAt",
                   last_seen_at AS "lastSeenAt"`,
        [sessionHash, now],
      );
      const row = result.rows[0];
      return row ? bindingFromRow(row) : null;
    });
  },
};

type MemoryBinding = AgentSessionBinding & { sessionHash: Buffer };

/** Deterministic repository for unit tests; production uses PostgreSQL. */
export class MemoryAgentSessionBindingRepository
implements AgentSessionBindingRepository {
  readonly bindings: MemoryBinding[] = [];

  async bind(input: BindAgentSessionInput): Promise<boolean> {
    const existing = this.bindings.find((binding) =>
      hashesEqual(binding.sessionHash, input.sessionHash)
    );
    if (existing) {
      if (!sameSubject(existing.subject, input.subject) || existing.mode !== input.mode) {
        return false;
      }
      existing.expiresAt = new Date(Math.max(
        existing.expiresAt.getTime(),
        input.expiresAt.getTime(),
      ));
      existing.lastSeenAt = new Date(input.lastSeenAt);
      return true;
    }
    this.bindings.push({
      sessionHash: Buffer.from(input.sessionHash),
      subject: input.subject.type === "public"
        ? { type: "public", id: null }
        : { ...input.subject },
      mode: input.mode,
      expiresAt: new Date(input.expiresAt),
      lastSeenAt: new Date(input.lastSeenAt),
    });
    return true;
  }

  async findActiveAndTouch(
    sessionHash: Buffer,
    now: Date,
  ): Promise<AgentSessionBinding | null> {
    const existing = this.bindings.find((binding) =>
      hashesEqual(binding.sessionHash, sessionHash)
    );
    if (!existing || existing.expiresAt <= now) return null;
    existing.lastSeenAt = new Date(now);
    return {
      subject: existing.subject.type === "public"
        ? { type: "public", id: null }
        : { ...existing.subject },
      mode: existing.mode,
      expiresAt: new Date(existing.expiresAt),
      lastSeenAt: new Date(existing.lastSeenAt),
    };
  }
}

export function sameSubject(
  left: AgentSessionSubject,
  right: AgentSessionSubject,
): boolean {
  return left.type === right.type && left.id === right.id;
}

function hashesEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
