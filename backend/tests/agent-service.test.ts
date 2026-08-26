import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openTrek = vi.hoisted(() => {
  class MockOpenTrekError extends Error {
    constructor(
      message: string,
      readonly status?: number,
      readonly code?: string,
      readonly retryable = false,
    ) {
      super(message);
      this.name = "OpenTrekError";
    }
  }

  return {
    createSession: vi.fn(),
    runAgent: vi.fn(),
    OpenTrekError: MockOpenTrekError,
  };
});

vi.mock("../src/clients/opentrek.js", () => ({
  createOpenTrekSession: openTrek.createSession,
  runOpenTrekAgent: openTrek.runAgent,
  OpenTrekError: openTrek.OpenTrekError,
}));

const runInput = {
  sessionCode: "online-session",
  message: "论文完全开始不了",
  metadata: {},
  attachments: [],
};

async function loadService(mode: "offline" | "auto" | "online") {
  vi.resetModules();
  vi.stubEnv("OPENTREK_MODE", mode);
  return import("../src/services/agent.js");
}

describe("agent service OpenTrek degradation boundary", () => {
  beforeEach(() => {
    openTrek.createSession.mockReset();
    openTrek.runAgent.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never calls OpenTrek when offline mode is explicit", async () => {
    const { createAgentSession, runAgent } = await loadService("offline");

    const session = await createAgentSession();
    const reply = await runAgent({ ...runInput, sessionCode: session.sessionCode });

    expect(session).toMatchObject({ mode: "offline" });
    expect(session.sessionCode).toMatch(/^offline:/);
    expect(reply).toMatchObject({
      sessionCode: session.sessionCode,
      metadata: { mode: "offline", ragUsed: false, sources: [] },
    });
    expect(openTrek.createSession).not.toHaveBeenCalled();
    expect(openTrek.runAgent).not.toHaveBeenCalled();
  });

  it("uses trusted saved memory in eligible offline replies without creating sources", async () => {
    const { createAgentSession, runAgent } = await loadService("offline");
    const session = await createAgentSession();

    const reply = await runAgent(
      { ...runInput, sessionCode: session.sessionCode },
      {
        memories: [{
          kind: "preference",
          summary: "把任务拆成十分钟步骤",
        }],
      },
    );

    expect(reply.content).toContain("把任务拆成十分钟步骤");
    expect(reply.metadata).toMatchObject({
      memoryUsed: true,
      ragUsed: false,
      sources: [],
    });
  });

  it("never applies trusted memory to an offline crisis reply", async () => {
    const { createAgentSession, runAgent } = await loadService("offline");
    const session = await createAgentSession();
    const reply = await runAgent(
      {
        ...runInput,
        sessionCode: session.sessionCode,
        message: "手边有药，我怕控制不住",
      },
      {
        memories: [{ kind: "preference", summary: "不应出现的记忆" }],
      },
    );

    expect(reply.content).not.toContain("不应出现的记忆");
    expect(reply.metadata).toMatchObject({ intent: "crisis_support", sources: [] });
    expect(reply.metadata.memoryUsed).toBeUndefined();
  });

  it("does not apply a stored transient or sensitive note offline", async () => {
    const { createAgentSession, runAgent } = await loadService("offline");
    const session = await createAgentSession();
    const reply = await runAgent(
      { ...runInput, sessionCode: session.sessionCode },
      {
        memories: [{ kind: "preference", summary: "我今天很难过" }],
      },
    );

    expect(reply.content).not.toContain("我今天很难过");
    expect(reply.metadata.memoryUsed).toBeUndefined();
  });

  it.each([
    new openTrek.OpenTrekError("network unavailable"),
    new openTrek.OpenTrekError("gateway unavailable", 503),
    new Error("OpenTrek configuration is missing: OPENTREK_APP_KEY"),
  ])("falls back during session creation for connectivity/configuration failure", async (failure) => {
    openTrek.createSession.mockRejectedValueOnce(failure);
    const { createAgentSession } = await loadService("auto");

    await expect(createAgentSession()).resolves.toMatchObject({ mode: "offline" });
    expect(openTrek.createSession).toHaveBeenCalledOnce();
  });

  it("moves an interrupted online chat into a new offline session", async () => {
    openTrek.runAgent.mockRejectedValueOnce(
      new openTrek.OpenTrekError("gateway unavailable", 503),
    );
    const { runAgent } = await loadService("auto");

    const reply = await runAgent(runInput);

    expect(reply.sessionCode).toMatch(/^offline:/);
    expect(reply.sessionCode).not.toBe(runInput.sessionCode);
    expect(reply.metadata).toMatchObject({
      mode: "offline",
      intent: "task_difficulty",
      ragUsed: false,
      sources: [],
      notice: expect.any(String),
    });
  });

  it("falls back when OpenTrek exhausts a transient HTTP 200 response", async () => {
    openTrek.runAgent.mockRejectedValueOnce(
      new openTrek.OpenTrekError(
        "OpenTrek run returned success=false (failed after 2 attempts)",
        200,
        "UPSTREAM_PENDING",
        true,
      ),
    );
    const { runAgent } = await loadService("auto");

    const reply = await runAgent(runInput);

    expect(reply.content).not.toHaveLength(0);
    expect(reply.metadata).toMatchObject({
      mode: "offline",
      ragUsed: false,
      sources: [],
      notice: expect.any(String),
    });
  });

  it("keeps trusted memory when auto mode safely falls back offline", async () => {
    openTrek.runAgent.mockRejectedValueOnce(
      new openTrek.OpenTrekError("gateway unavailable", 503),
    );
    const { runAgent } = await loadService("auto");

    const reply = await runAgent(runInput, {
      memories: [{ kind: "preference", summary: "先写一个标题" }],
    });

    expect(reply.content).toContain("先写一个标题");
    expect(reply.metadata).toMatchObject({
      memoryUsed: true,
      ragUsed: false,
      sources: [],
    });
  });

  it("passes only the trusted memory argument to the online client", async () => {
    openTrek.runAgent.mockResolvedValueOnce({
      sessionCode: runInput.sessionCode,
      content: "online reply",
      metadata: { sources: [] },
    });
    const { runAgent } = await loadService("online");
    const memories = [{
      kind: "preference" as const,
      summary: "把任务拆成十分钟步骤",
    }];

    await expect(runAgent(runInput, { memories })).resolves.toMatchObject({
      content: "online reply",
    });
    expect(openTrek.runAgent).toHaveBeenCalledWith(runInput, memories);
  });

  it("uses a stateless action-free fallback when a generic online emotion reply fails the quality gate", async () => {
    openTrek.runAgent.mockResolvedValueOnce({
      sessionCode: runInput.sessionCode,
      content: "如果愿意，可以试试戴上耳塞或播放白噪音。",
      metadata: {
        mode: "online",
        intent: "emotion_support",
        strategy: "none",
        ragUsed: true,
        sources: [{ sourceId: "emotion-doc", title: "情绪支持资料" }],
      },
    });
    const { runAgent } = await loadService("auto");

    const reply = await runAgent({
      ...runInput,
      message: "我很焦虑，脑子停不下来",
    });

    expect(reply.sessionCode).toMatch(/^offline:/);
    expect(reply.content).not.toContain("白噪音");
    expect(reply.metadata).toMatchObject({
      mode: "offline",
      intent: "emotion_support",
      strategy: "none",
      ragUsed: false,
      sources: [],
      notice: expect.any(String),
    });
    expect(reply.metadata.action).toBeUndefined();

    const followup = await runAgent({
      ...runInput,
      sessionCode: reply.sessionCode,
      message: "好",
      dailyCheckin: {
        date: "2026-08-26",
        energy: 3,
        mood: "anxious",
        bodyState: [],
        shareWithChat: true,
      },
    });

    expect(followup.metadata.action).not.toBe("open_breathing");
    expect(followup.metadata.action).not.toBe("offer_breathing");
  });

  it("fails closed in online mode when an emotion reply violates the quality gate", async () => {
    openTrek.runAgent.mockResolvedValueOnce({
      sessionCode: runInput.sessionCode,
      content: "如果愿意，可以试试4-7-8呼吸练习。",
      metadata: {
        mode: "online",
        intent: "emotion_support",
        strategy: "none",
        ragUsed: true,
        sources: [{ sourceId: "emotion-doc", title: "情绪支持资料" }],
      },
    });
    const { runAgent } = await loadService("online");

    await expect(runAgent({
      ...runInput,
      message: "我很焦虑",
    })).rejects.toMatchObject({
      name: "OpenTrekError",
      status: 200,
      code: "E_BREATHING_GUIDANCE",
    });
  });

  it.each(["auto", "online"] as const)(
    "labels a successful %s session as online",
    async (mode) => {
      openTrek.createSession.mockResolvedValueOnce({ sessionCode: "online-session" });
      const { createAgentSession } = await loadService(mode);

      await expect(createAgentSession()).resolves.toEqual({
        sessionCode: "online-session",
        mode: "online",
      });
    },
  );

  it.each([401, 403, 422, 200])(
    "does not disguise an OpenTrek HTTP %i business/authentication error as offline success",
    async (status) => {
      const failure = new openTrek.OpenTrekError("request rejected", status, "REJECTED");
      openTrek.runAgent.mockRejectedValueOnce(failure);
      const { runAgent } = await loadService("auto");

      await expect(runAgent(runInput)).rejects.toBe(failure);
    },
  );

  it("never falls back when online mode is explicitly required", async () => {
    const failure = new openTrek.OpenTrekError("network unavailable");
    openTrek.createSession.mockRejectedValueOnce(failure);
    const { createAgentSession } = await loadService("online");

    await expect(createAgentSession()).rejects.toBe(failure);
  });
});
