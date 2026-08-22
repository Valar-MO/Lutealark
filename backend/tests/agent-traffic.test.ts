import { describe, expect, it } from "vitest";
import {
  MemoryAgentTrafficGuard,
  type AgentTrafficLimits,
} from "../src/middleware/agent-traffic.js";

const limits: AgentTrafficLimits = {
  session: { limit: 2, windowMs: 60_000 },
  chat: { limit: 2, windowMs: 60_000 },
  maxConcurrentTotal: 2,
  maxConcurrentPerClient: 1,
};

describe("MemoryAgentTrafficGuard", () => {
  it("rate-limits each operation and reports a bounded retry delay", () => {
    const guard = new MemoryAgentTrafficGuard(limits, () => 10_000);
    const first = guard.enter("session", "client-a");
    expect(first.allowed).toBe(true);
    if (first.allowed) first.release();
    const second = guard.enter("session", "client-a");
    expect(second.allowed).toBe(true);
    if (second.allowed) second.release();

    expect(guard.enter("session", "client-a")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it("limits concurrent work and releases capacity exactly once", () => {
    const guard = new MemoryAgentTrafficGuard(limits, () => 10_000);
    const active = guard.enter("chat", "client-a");
    expect(active.allowed).toBe(true);
    expect(guard.enter("chat", "client-a")).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    const other = guard.enter("chat", "client-b");
    expect(other.allowed).toBe(true);

    if (!active.allowed) throw new Error("expected a traffic lease");
    active.release();
    active.release();
    if (other.allowed) other.release();
    expect(guard.enter("session", "client-a").allowed).toBe(true);
  });

  it("enforces the global concurrency ceiling across different clients", () => {
    const guard = new MemoryAgentTrafficGuard(limits, () => 10_000);
    const first = guard.enter("chat", "client-a");
    const second = guard.enter("chat", "client-b");
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(guard.enter("chat", "client-c")).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });

    if (first.allowed) first.release();
    if (second.allowed) second.release();
    expect(guard.enter("session", "client-c").allowed).toBe(true);
  });

  it("does not evict an unexpired limited bucket when capacity is full", () => {
    const guard = new MemoryAgentTrafficGuard(limits, () => 10_000, 1);
    for (let attempt = 0; attempt < limits.session.limit; attempt += 1) {
      const lease = guard.enter("session", "limited-client");
      expect(lease.allowed).toBe(true);
      if (lease.allowed) lease.release();
    }
    expect(guard.enter("session", "limited-client").allowed).toBe(false);

    expect(guard.enter("session", "new-client")).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(guard.enter("session", "limited-client")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });
});
