export type AgentOperation = "session" | "chat";

export interface AgentRateLimitRule {
  limit: number;
  windowMs: number;
}

export interface AgentTrafficLimits {
  session: AgentRateLimitRule;
  chat: AgentRateLimitRule;
  maxConcurrentTotal: number;
  maxConcurrentPerClient: number;
}

export const DEFAULT_AGENT_TRAFFIC_LIMITS: AgentTrafficLimits = Object.freeze({
  session: { limit: 20, windowMs: 15 * 60 * 1_000 },
  chat: { limit: 120, windowMs: 15 * 60 * 1_000 },
  maxConcurrentTotal: 16,
  maxConcurrentPerClient: 3,
});

type RateBucket = {
  attempts: number;
  limit: number;
  resetAt: number;
};

export type AgentTrafficLease = {
  allowed: true;
  release(): void;
};

export type AgentTrafficDenial = {
  allowed: false;
  retryAfterSeconds: number;
};

export interface AgentTrafficGuard {
  enter(operation: AgentOperation, clientKey: string): AgentTrafficLease | AgentTrafficDenial;
}

export class MemoryAgentTrafficGuard implements AgentTrafficGuard {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly activeByClient = new Map<string, number>();
  private activeTotal = 0;

  constructor(
    private readonly limits: AgentTrafficLimits = DEFAULT_AGENT_TRAFFIC_LIMITS,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries must be a positive safe integer");
    }
    for (const [name, value] of Object.entries({
      sessionLimit: limits.session.limit,
      sessionWindowMs: limits.session.windowMs,
      chatLimit: limits.chat.limit,
      chatWindowMs: limits.chat.windowMs,
      maxConcurrentTotal: limits.maxConcurrentTotal,
      maxConcurrentPerClient: limits.maxConcurrentPerClient,
    })) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive safe integer`);
      }
    }
  }

  enter(
    operation: AgentOperation,
    clientKey: string,
  ): AgentTrafficLease | AgentTrafficDenial {
    const now = this.now();
    const rule = this.limits[operation];
    const bucketKey = `${operation}:${clientKey}`;
    let bucket = this.buckets.get(bucketKey);

    if (!bucket || bucket.resetAt <= now) {
      if (!this.makeRoom(now, bucketKey)) {
        return { allowed: false, retryAfterSeconds: 1 };
      }
      bucket = { attempts: 0, limit: rule.limit, resetAt: now + rule.windowMs };
      this.buckets.set(bucketKey, bucket);
    }

    if (bucket.attempts >= rule.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
      };
    }
    const activeForClient = this.activeByClient.get(clientKey) ?? 0;
    if (
      this.activeTotal >= this.limits.maxConcurrentTotal
      || activeForClient >= this.limits.maxConcurrentPerClient
    ) {
      return { allowed: false, retryAfterSeconds: 1 };
    }

    bucket.attempts += 1;
    this.activeTotal += 1;
    this.activeByClient.set(clientKey, activeForClient + 1);
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        this.activeTotal -= 1;
        const current = this.activeByClient.get(clientKey) ?? 1;
        if (current <= 1) this.activeByClient.delete(clientKey);
        else this.activeByClient.set(clientKey, current - 1);
      },
    };
  }

  private makeRoom(now: number, incomingKey: string): boolean {
    if (this.buckets.has(incomingKey) || this.buckets.size < this.maxEntries) return true;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    if (this.buckets.size < this.maxEntries) return true;

    // Keep active rate-limit penalties intact. Evicting a limited bucket would
    // let the same caller immediately create a fresh bucket and bypass the ban.
    for (const [key, bucket] of this.buckets) {
      if (bucket.attempts < bucket.limit) {
        this.buckets.delete(key);
        return true;
      }
    }
    return false;
  }
}

export function agentClientKey(request: Request): string {
  // The local server has no trusted proxy layer. Keep this as a best-effort
  // per-client bucket only; it is not a network identity or distributed limit.
  return request.headers.get("X-Real-IP") ?? "unknown-client";
}
