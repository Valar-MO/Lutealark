import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAgentSessionBindingRepository } from "../src/repositories/agent-sessions.js";
import type { PersonalDataRepository } from "../src/repositories/personal-data.js";

function personalRepository(): PersonalDataRepository {
  return {
    getPersonalData: vi.fn(),
    upsertCycleSettings: vi.fn(),
    upsertDailyCheckin: vi.fn(),
    deleteDailyCheckin: vi.fn(),
    upsertBreathingRecord: vi.fn(),
    deleteBreathingRecord: vi.fn(),
    checkHealth: vi.fn(),
  } as unknown as PersonalDataRepository;
}

describe("offline HTTP assistant", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("OPENTREK_MODE", "offline");
  });

  it("creates a local session and answers without a network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { createApp } = await import("../src/app.js");
    const app = createApp({
      personalDataRepository: personalRepository(),
      agentSessionBindingRepository: new MemoryAgentSessionBindingRepository(),
    });

    const sessionResponse = await app.request("/api/agent/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(sessionResponse.status).toBe(201);
    const session = await sessionResponse.json() as {
      sessionCode: string;
      mode: string;
    };
    expect(session).toMatchObject({ mode: "offline" });
    expect(session.sessionCode).toMatch(/^offline:/);

    const chatResponse = await app.request("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionCode: session.sessionCode,
        message: "给我一个短番茄钟",
        metadata: {},
        attachments: [],
      }),
    });

    expect(chatResponse.status).toBe(200);
    await expect(chatResponse.json()).resolves.toMatchObject({
      sessionCode: session.sessionCode,
      metadata: {
        mode: "offline",
        intent: "pomodoro",
        action: "offer_focus_timer",
        ragUsed: false,
        sources: [],
      },
    });
    expect(chatResponse.headers.get("Cache-Control")).toBe("no-store");
    const confirmationResponse = await app.request("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionCode: session.sessionCode,
        message: "好",
        metadata: {},
        attachments: [],
      }),
    });
    expect(confirmationResponse.status).toBe(200);
    await expect(confirmationResponse.json()).resolves.toMatchObject({
      metadata: { action: "open_focus_timer" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
