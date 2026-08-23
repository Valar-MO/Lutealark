import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openTrek = vi.hoisted(() => {
  class MockOpenTrekError extends Error {
    constructor(
      message: string,
      readonly status?: number,
      readonly code?: string,
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
