import { describe, expect, it } from "vitest";
import { evaluateAgentResponseQuality } from "../src/services/agent-response-quality.js";

function response(
  content: string,
  metadata: Record<string, unknown> = {},
) {
  return {
    sessionCode: "test-session",
    content,
    metadata: {
      intent: "emotion_support",
      strategy: "none",
      ragUsed: true,
      sources: [{ sourceId: "doc", title: "资料" }],
      ...metadata,
    },
  };
}

describe("generic emotional-support response quality", () => {
  it("accepts support with one atomic suggestion", () => {
    expect(evaluateAgentResponseQuality(response(
      "这份焦虑正在占用你很多力气。如果愿意，可以试试关掉一个声音来源。现在不做也完全可以。",
    ))).toEqual({ ok: true, reasons: [] });
  });

  it("does not mistake a reported breathing symptom for guidance", () => {
    expect(evaluateAgentResponseQuality(response(
      "你说自己现在呼吸困难，这听起来很不容易。你不需要现在就把它解决。",
    ))).toEqual({ ok: true, reasons: [] });
  });

  it.each([
    ["action", "这很不容易。", { action: "offer_breathing" }, "E_ACTION_PRESENT"],
    ["named breathing", "如果愿意，可以试试4-7-8呼吸练习。", {}, "E_BREATHING_GUIDANCE"],
    ["timed breathing", "可以试试吸气4秒，呼气8秒。", {}, "E_BREATHING_GUIDANCE"],
    ["alternatives", "如果愿意，可以试试只处理一个感官维度——比如戴上耳塞或播放白噪音。", {}, "E_ALTERNATIVES"],
    ["multi-step", "如果愿意，可以先关掉顶灯，再放下手机。", {}, "E_MULTI_STEP"],
    ["multiple suggestions", "你可以关掉顶灯。也可以试试戴上耳塞。", {}, "E_MULTIPLE_SUGGESTIONS"],
    ["suggestion list", "- 你可以关掉顶灯\n- 你可以戴上耳塞", {}, "E_SUGGESTION_LIST"],
    ["multiple questions", "你现在最难受的是哪部分？需要我继续听吗？", {}, "E_MULTIPLE_QUESTIONS"],
  ] as const)("rejects %s", (_name, content, metadata, reason) => {
    expect(evaluateAgentResponseQuality(response(content, metadata))).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([reason]),
    });
  });

  it.each([
    ["missing", { strategy: undefined }],
    ["specialized", { strategy: "breathing", action: "offer_breathing" }],
  ])("fails closed for a %s emotional-support strategy until its validator exists", (
    _name,
    metadata,
  ) => {
    expect(evaluateAgentResponseQuality(response(
      "要不要先试一次温和呼吸练习？",
      metadata,
    ))).toEqual({
      ok: false,
      reasons: ["E_UNSUPPORTED_STRATEGY"],
    });
  });

  it("does not apply the emotional-support gate to another intent", () => {
    expect(evaluateAgentResponseQuality(response(
      "可以先打开文档。",
      { intent: "task_difficulty", strategy: "task_breakdown" },
    ))).toEqual({ ok: true, reasons: [] });
  });
});
