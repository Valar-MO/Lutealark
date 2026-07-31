import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("OpenTrek agent client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("OPENTREK_BASE_URL", "http://opentrek.test/agent/api");
    vi.stubEnv("OPENTREK_APP_KEY", "test-app-key");
    vi.stubEnv("OPENTREK_AGENT_CODE", "test-agent-code");
    vi.stubEnv("OPENTREK_AGENT_VERSION", "test-version");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("calculates trusted cycle metadata and removes spoofed values", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));
    const { buildAgentMetadata } = await import("../src/clients/opentrek.js");

    const metadata = buildAgentMetadata({
      sessionCode: "session-1",
      message: "今天很难开始",
      metadata: { intentHint: "task", energyValue: 10 },
      cycleSettings: { lastPeriodDate: "2026-07-01", cycleLength: 28 },
      attachments: [],
    });

    expect(metadata).toEqual({
      intentHint: "task",
      currentPhase: "luteal_early",
      phaseName: "黄体早期",
      isBufferMode: false,
      dayOfCycle: 16,
      daysToNextPeriod: 13,
      energyValue: 6,
      cycleLength: 28,
    });
  });

  it("runs an agent and normalizes text and metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            message: {
              role: "assistant",
              content: [
                { type: "text", text: { value: "先做一件" } },
                { type: "text", text: { value: "最小的事情。" } },
              ],
              metadata: { intent: "task_difficulty" },
            },
            error: null,
          },
          errorCode: null,
          errorMsg: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { runOpenTrekAgent } = await import("../src/clients/opentrek.js");
    const result = await runOpenTrekAgent({
      sessionCode: "session-1",
      message: "我不知道怎么开始",
      metadata: {},
      attachments: [],
    });

    expect(result).toEqual({
      sessionCode: "session-1",
      content: "先做一件最小的事情。",
      metadata: { intent: "task_difficulty" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://opentrek.test/agent/api/run");
    expect(JSON.parse(String(options.body))).toEqual({
      stream: false,
      delta: false,
      sessionId: "session-1",
      message: {
        text: JSON.stringify({
          input: "我不知道怎么开始",
          currentPhase: null,
          phaseName: null,
          isBufferMode: false,
          dayOfCycle: null,
          daysToNextPeriod: null,
          energyValue: null,
          cycleLength: null,
          checkinDate: null,
          selfReportedEnergy: null,
          mood: null,
          bodyState: [],
          checkinNote: "",
          historyContext: "",
        }),
        metadata: {},
        attachments: [],
      },
    });
  });

  it("packs user input and calculated cycle state into the workflow text", async () => {
    const { buildAgentInputText } = await import("../src/clients/opentrek.js");
    expect(JSON.parse(buildAgentInputText("帮我开始", {
      currentPhase: "luteal_late",
      phaseName: "黄体晚期",
      isBufferMode: true,
      dayOfCycle: 25,
      daysToNextPeriod: 4,
      energyValue: 2,
      cycleLength: 28,
    }))).toEqual({
      input: "帮我开始",
      currentPhase: "luteal_late",
      phaseName: "黄体晚期",
      isBufferMode: true,
      dayOfCycle: 25,
      daysToNextPeriod: 4,
      energyValue: 2,
      cycleLength: 28,
      checkinDate: null,
      selfReportedEnergy: null,
      mood: null,
      bodyState: [],
      checkinNote: "",
      historyContext: "",
    });
  });

  it("adds a shared daily check-in without replacing cycle metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));
    const { buildAgentMetadata, buildAgentInputText } = await import("../src/clients/opentrek.js");
    const metadata = buildAgentMetadata({
      sessionCode: "session-1",
      message: "test",
      metadata: {},
      cycleSettings: { lastPeriodDate: "2026-07-01", cycleLength: 28 },
      dailyCheckin: {
        date: "2026-07-16",
        energy: 2,
        mood: "anxious",
        bodyState: ["fatigue"],
        note: "hard to start",
        shareWithChat: true,
      },
      dailyCheckins: [
        {
          date: "2026-07-16",
          energy: 2,
          mood: "anxious",
          bodyState: ["fatigue"],
          note: "hard to start",
          shareWithChat: true,
        },
      ],
      attachments: [],
    });

    const workflowInput = JSON.parse(buildAgentInputText("test", metadata));
    expect(workflowInput).toMatchObject({
      energyValue: 6,
      selfReportedEnergy: 2,
      mood: "anxious",
      bodyState: ["fatigue"],
      checkinNote: "hard to start",
    });
    expect(JSON.parse(workflowInput.historyContext)).toMatchObject({
      recordCount: 1,
      energy: { recentAverage: 2, trend: "insufficient_data" },
      mood: { frequent: ["anxious"] },
    });
  });
});
