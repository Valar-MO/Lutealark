import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MemoryAgentSessionBindingRepository,
  type AgentSessionBindingRepository,
  type AgentSessionSubject,
} from "../src/repositories/agent-sessions.js";
import { DatabaseUnavailableError } from "../src/db/pool.js";
import {
  AgentSessionBindingService,
  AgentSessionBindingUnavailableError,
  AgentSessionRecreateRequiredError,
  hashAgentSessionCode,
} from "../src/services/agent-session-bindings.js";

const ACCOUNT_A: AgentSessionSubject = {
  type: "account",
  id: "c598fcc4-98d4-4f66-b526-65d6ba73adaf",
};
const ACCOUNT_B: AgentSessionSubject = {
  type: "account",
  id: "a77e8c50-57cf-4a23-8bf5-7a1fd92d31a5",
};

function sessionHash(sessionCode: string): Buffer {
  return createHash("sha256").update(sessionCode).digest();
}

describe("agent session binding repository invariants", () => {
  it("touches a live binding only after it is found successfully", async () => {
    const repository = new MemoryAgentSessionBindingRepository();
    const hash = sessionHash("online-session-a");
    const createdAt = new Date("2026-08-11T00:00:00.000Z");
    const touchedAt = new Date("2026-08-11T00:05:00.000Z");

    await expect(repository.bind({
      sessionHash: hash,
      subject: ACCOUNT_A,
      mode: "online",
      expiresAt: new Date("2026-08-12T00:00:00.000Z"),
      lastSeenAt: createdAt,
    })).resolves.toBe(true);

    await expect(repository.findActiveAndTouch(hash, touchedAt)).resolves
      .toMatchObject({
        subject: ACCOUNT_A,
        mode: "online",
        lastSeenAt: touchedAt,
      });
    expect(repository.bindings[0]?.lastSeenAt).toEqual(touchedAt);

    await expect(repository.findActiveAndTouch(
      sessionHash("unknown-session"),
      new Date("2026-08-11T00:10:00.000Z"),
    )).resolves.toBeNull();
    expect(repository.bindings[0]?.lastSeenAt).toEqual(touchedAt);
  });

  it("treats expiresAt equal to now as expired without touching it", async () => {
    const repository = new MemoryAgentSessionBindingRepository();
    const hash = sessionHash("expired-session");
    const lastSeenAt = new Date("2026-08-10T23:00:00.000Z");
    const expiresAt = new Date("2026-08-11T00:00:00.000Z");
    await repository.bind({
      sessionHash: hash,
      subject: ACCOUNT_A,
      mode: "online",
      expiresAt,
      lastSeenAt,
    });

    await expect(repository.findActiveAndTouch(hash, expiresAt)).resolves.toBeNull();
    expect(repository.bindings[0]?.lastSeenAt).toEqual(lastSeenAt);
  });

  it("never reassigns an existing hash to another subject or mode", async () => {
    const repository = new MemoryAgentSessionBindingRepository();
    const hash = sessionHash("shared-session");
    const firstExpiry = new Date("2026-08-12T00:00:00.000Z");
    const firstSeen = new Date("2026-08-11T00:00:00.000Z");
    await repository.bind({
      sessionHash: hash,
      subject: ACCOUNT_A,
      mode: "online",
      expiresAt: firstExpiry,
      lastSeenAt: firstSeen,
    });

    await expect(repository.bind({
      sessionHash: hash,
      subject: ACCOUNT_B,
      mode: "online",
      expiresAt: new Date("2026-08-13T00:00:00.000Z"),
      lastSeenAt: new Date("2026-08-11T01:00:00.000Z"),
    })).resolves.toBe(false);
    await expect(repository.bind({
      sessionHash: hash,
      subject: ACCOUNT_A,
      mode: "offline",
      expiresAt: new Date("2026-08-13T00:00:00.000Z"),
      lastSeenAt: new Date("2026-08-11T01:00:00.000Z"),
    })).resolves.toBe(false);

    expect(repository.bindings).toHaveLength(1);
    expect(repository.bindings[0]).toMatchObject({
      subject: ACCOUNT_A,
      mode: "online",
      expiresAt: firstExpiry,
      lastSeenAt: firstSeen,
    });
  });
});

describe("agent session binding service", () => {
  it("stores only a SHA-256 hash and rejects another subject without revealing why", async () => {
    const repository = new MemoryAgentSessionBindingRepository();
    const now = new Date("2026-08-11T00:00:00.000Z");
    const service = new AgentSessionBindingService(repository, { now: () => now });
    const sessionCode = "online-secret-session-code";

    await expect(service.bindCreatedSession(sessionCode, ACCOUNT_A)).resolves.toBe(true);
    expect(repository.bindings).toHaveLength(1);
    expect(repository.bindings[0]?.sessionHash).toEqual(hashAgentSessionCode(sessionCode));
    expect(repository.bindings[0]?.sessionHash.toString("utf8"))
      .not.toContain(sessionCode);

    await expect(service.authorizeSession(sessionCode, ACCOUNT_B))
      .rejects.toBeInstanceOf(AgentSessionRecreateRequiredError);
  });

  it("binds an auto fallback offline code to the same subject", async () => {
    const repository = new MemoryAgentSessionBindingRepository();
    const service = new AgentSessionBindingService(repository, {
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });
    const onlineCode = "online-session";
    const offlineCode = "offline:934fb086-2917-465b-933f-bbb5a1b96081";
    await service.bindCreatedSession(onlineCode, ACCOUNT_A);
    await service.authorizeSession(onlineCode, ACCOUNT_A);

    await expect(service.bindReplacementSession(
      onlineCode,
      offlineCode,
      ACCOUNT_A,
    )).resolves.toBe(true);
    await expect(service.authorizeSession(offlineCode, ACCOUNT_A)).resolves
      .toMatchObject({ bound: true, mode: "offline" });
    await expect(service.authorizeSession(offlineCode, ACCOUNT_B))
      .rejects.toBeInstanceOf(AgentSessionRecreateRequiredError);
  });

  it("fails closed for online database outages but permits unbound memory-free offline use", async () => {
    const unavailable: AgentSessionBindingRepository = {
      bind: async () => { throw new DatabaseUnavailableError(); },
      findActiveAndTouch: async () => { throw new DatabaseUnavailableError(); },
    };
    const service = new AgentSessionBindingService(unavailable);
    const offlineCode = "offline:934fb086-2917-465b-933f-bbb5a1b96081";

    await expect(service.bindCreatedSession("online-session", ACCOUNT_A))
      .rejects.toBeInstanceOf(AgentSessionBindingUnavailableError);
    await expect(service.authorizeSession("online-session", ACCOUNT_A))
      .rejects.toBeInstanceOf(AgentSessionBindingUnavailableError);
    await expect(service.bindCreatedSession(offlineCode, ACCOUNT_A))
      .resolves.toBe(false);
    await expect(service.authorizeSession(offlineCode, ACCOUNT_A))
      .resolves.toEqual({ bound: false, mode: "offline" });
  });

  it("never treats an identity database outage as a public online subject", async () => {
    const repository = new MemoryAgentSessionBindingRepository();
    const service = new AgentSessionBindingService(repository);

    await expect(service.bindCreatedSession(
      "online-session",
      { type: "public", id: null },
      true,
    )).rejects.toBeInstanceOf(AgentSessionBindingUnavailableError);
    expect(repository.bindings).toHaveLength(0);
  });
});
