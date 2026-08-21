import { createHash } from "node:crypto";
import { DatabaseUnavailableError } from "../db/pool.js";
import type {
  AgentSessionBindingRepository,
  AgentSessionMode,
  AgentSessionSubject,
} from "../repositories/agent-sessions.js";
import type { ResolvedUser } from "./auth.js";
import { isOfflineSession } from "./offline-assistant.js";

export const AGENT_SESSION_BINDING_TTL_MS = 24 * 60 * 60 * 1_000;

export class AgentSessionRecreateRequiredError extends Error {
  readonly code = "AGENT_SESSION_RECREATE_REQUIRED";

  constructor() {
    super("智能体会话已过期或不属于当前用户，请重新创建会话");
    this.name = "AgentSessionRecreateRequiredError";
  }
}

export class AgentSessionBindingUnavailableError extends Error {
  readonly code = "AGENT_SESSION_BINDING_UNAVAILABLE";

  constructor() {
    super("智能体会话安全校验暂时不可用，请稍后重试");
    this.name = "AgentSessionBindingUnavailableError";
  }
}

export type AgentRequestIdentity<T extends { userId: string } = ResolvedUser> = {
  user: T | null;
  databaseUnavailable: boolean;
};

export type AgentSessionAuthorization = {
  bound: boolean;
  mode: AgentSessionMode;
};

export async function resolveAgentRequestIdentity<T extends { userId: string }>(
  resolveUser: () => Promise<T | null>,
): Promise<AgentRequestIdentity<T>> {
  try {
    return { user: await resolveUser(), databaseUnavailable: false };
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      return { user: null, databaseUnavailable: true };
    }
    throw error;
  }
}

export function agentSessionSubject(
  user: Pick<ResolvedUser, "authType" | "userId"> | null,
): AgentSessionSubject {
  if (!user) return { type: "public", id: null };
  return { type: user.authType, id: user.userId };
}

export function hashAgentSessionCode(sessionCode: string): Buffer {
  return createHash("sha256").update(sessionCode, "utf8").digest();
}

export function agentSessionMode(sessionCode: string): AgentSessionMode {
  return isOfflineSession(sessionCode) ? "offline" : "online";
}

export class AgentSessionBindingService {
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(
    private readonly repository: AgentSessionBindingRepository,
    options: { now?: () => Date; ttlMs?: number } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? AGENT_SESSION_BINDING_TTL_MS;
  }

  async bindCreatedSession(
    sessionCode: string,
    subject: AgentSessionSubject,
    identityDatabaseUnavailable = false,
  ): Promise<boolean> {
    const mode = agentSessionMode(sessionCode);
    if (identityDatabaseUnavailable) {
      if (mode === "offline") return false;
      throw new AgentSessionBindingUnavailableError();
    }

    const now = this.now();
    try {
      const bound = await this.repository.bind({
        sessionHash: hashAgentSessionCode(sessionCode),
        subject,
        mode,
        expiresAt: new Date(now.getTime() + this.ttlMs),
        lastSeenAt: now,
      });
      if (!bound) throw new AgentSessionBindingUnavailableError();
      return true;
    } catch (error) {
      if (error instanceof AgentSessionBindingUnavailableError) throw error;
      if (error instanceof DatabaseUnavailableError) {
        if (mode === "offline") return false;
        throw new AgentSessionBindingUnavailableError();
      }
      throw error;
    }
  }

  async authorizeSession(
    sessionCode: string,
    subject: AgentSessionSubject,
    identityDatabaseUnavailable = false,
  ): Promise<AgentSessionAuthorization> {
    const mode = agentSessionMode(sessionCode);
    if (identityDatabaseUnavailable) {
      if (mode === "offline") return { bound: false, mode };
      throw new AgentSessionBindingUnavailableError();
    }

    let binding;
    try {
      binding = await this.repository.findActiveAndTouch(
        hashAgentSessionCode(sessionCode),
        this.now(),
      );
    } catch (error) {
      if (error instanceof DatabaseUnavailableError) {
        if (mode === "offline") return { bound: false, mode };
        throw new AgentSessionBindingUnavailableError();
      }
      throw error;
    }

    if (
      !binding
      || binding.mode !== mode
      || binding.subject.type !== subject.type
      || binding.subject.id !== subject.id
    ) {
      throw new AgentSessionRecreateRequiredError();
    }
    return { bound: true, mode };
  }

  async bindReplacementSession(
    previousSessionCode: string,
    returnedSessionCode: string,
    subject: AgentSessionSubject,
    identityDatabaseUnavailable = false,
  ): Promise<boolean> {
    if (returnedSessionCode === previousSessionCode) return true;
    return this.bindCreatedSession(
      returnedSessionCode,
      subject,
      identityDatabaseUnavailable,
    );
  }
}
