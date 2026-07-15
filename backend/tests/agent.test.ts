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
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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
      delta: true,
      sessionId: "session-1",
      message: {
        text: "我不知道怎么开始",
        metadata: {},
        attachments: [],
      },
    });
  });
});
