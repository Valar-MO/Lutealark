import { describe, expect, it } from "vitest";
import {
  createOfflineSession,
  isOfflineSession,
  runOfflineAssistant,
} from "../src/services/offline-assistant.js";

function run(message: string, sessionCode = createOfflineSession().sessionCode) {
  return runOfflineAssistant({
    sessionCode,
    message,
    metadata: {},
    attachments: [],
  });
}

describe("offline assistant", () => {
  it("creates an explicitly offline session", () => {
    const session = createOfflineSession();

    expect(isOfflineSession(session.sessionCode)).toBe(true);
    expect(session).toMatchObject({ mode: "offline" });
  });

  it.each([
    ["给我一个番茄钟", "pomodoro", "offer_focus_timer"],
    ["周围太吵而且屏幕太亮", "environment_adjustment", "open_environment_reset"],
    ["我久坐后肩颈很僵，想动一动", "micro_movement", "open_micro_movement"],
    ["帮我安排一个今日轻计划", "lightweight_plan", "open_light_plan"],
    ["我想记录一下今天的状态", "daily_checkin", "open_daily_checkin"],
    ["为什么经期前注意力会变差", "cycle_question", "open_cycle"],
    ["论文完全开始不了", "task_difficulty", "open_light_plan"],
  ])("routes %s to a local tool", (message, intent, action) => {
    const response = run(message);

    expect(response.metadata).toMatchObject({
      mode: "offline",
      intent,
      action,
      ragUsed: false,
      sources: [],
    });
  });

  it("supports breathing confirmation across an offline session", () => {
    const sessionCode = createOfflineSession().sessionCode;
    const invitation = run("我现在很焦虑", sessionCode);
    const confirmation = run("好", sessionCode);

    expect(invitation.metadata).toMatchObject({
      intent: "emotional_support",
      action: "offer_breathing",
    });
    expect(confirmation.metadata).toMatchObject({
      intent: "breathing",
      action: "open_breathing",
    });
  });

  it("explains an offered action without losing its pending confirmation", () => {
    const sessionCode = createOfflineSession().sessionCode;
    run("我现在很焦虑", sessionCode);
    const explanation = run("这是什么？", sessionCode);
    const confirmation = run("好", sessionCode);

    expect(explanation.metadata).toMatchObject({ action: "offer_breathing" });
    expect(explanation.content).toContain("不是医疗治疗");
    expect(confirmation.metadata).toMatchObject({ action: "open_breathing" });
  });

  it("clears a pending action when the user changes to a new request", () => {
    const sessionCode = createOfflineSession().sessionCode;
    run("我现在很焦虑", sessionCode);
    const changedTopic = run("论文启动不了怎么办", sessionCode);
    const laterAffirmation = run("好", sessionCode);

    expect(changedTopic.metadata).toMatchObject({ action: "open_light_plan" });
    expect(laterAffirmation.metadata.action).not.toBe("open_breathing");
  });

  it("opens the focus timer only after confirmation", () => {
    const sessionCode = createOfflineSession().sessionCode;
    const invitation = run("给我一个番茄钟", sessionCode);
    const confirmation = run("好", sessionCode);

    expect(invitation.metadata).toMatchObject({ action: "offer_focus_timer" });
    expect(confirmation.metadata).toMatchObject({ action: "open_focus_timer" });
  });

  it("proactively offers an optional daily check-in and remembers the confirmation", () => {
    const sessionCode = createOfflineSession().sessionCode;
    const invitation = run("想随便聊聊", sessionCode);
    const confirmation = run("好", sessionCode);

    expect(invitation.metadata).toMatchObject({
      intent: "general_support",
      action: "offer_daily_checkin",
    });
    expect(confirmation.metadata).toMatchObject({
      intent: "daily_checkin",
      action: "open_daily_checkin",
    });
  });

  it("returns a consent-gated long-term memory candidate without saving it", () => {
    const response = run("请记住我更喜欢把任务拆成十分钟以内的小步骤");

    expect(response.metadata).toMatchObject({
      intent: "memory_request",
      memoryCandidate: {
        kind: "preference",
        summary: "我更喜欢把任务拆成十分钟以内的小步骤",
        requiresConsent: true,
      },
    });
    expect(response.metadata.memoryCandidate).toMatchObject({
      candidateId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      sourceTurnHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("keeps the source-turn hash stable for a retried turn in one session", () => {
    const sessionCode = createOfflineSession().sessionCode;
    const first = run("请记住我更喜欢十分钟的小步骤", sessionCode);
    const retry = run("请记住我更喜欢十分钟的小步骤", sessionCode);
    const firstCandidate = first.metadata.memoryCandidate as
      | { sourceTurnHash?: unknown }
      | undefined;
    const retryCandidate = retry.metadata.memoryCandidate as
      | { sourceTurnHash?: unknown }
      | undefined;

    expect(firstCandidate?.sourceTurnHash).toMatch(/^[0-9a-f]{64}$/);
    expect(firstCandidate?.sourceTurnHash).toBe(retryCandidate?.sourceTurnHash);
  });

  it.each([
    "请记住我今天非常焦虑",
    "请记住我现在很难过",
    "请记住我最近睡不好",
    "请记住我现在压力大、紧张、害怕又委屈",
    "请记住我心慌、想哭、很疲惫",
    "请记住我的黄体期症状和用药",
    "请记住我有抑郁症",
    "请记住我的检验结果和血压记录",
  ])("does not create memory candidates from transient or health content: %s", (message) => {
    const response = run(message);

    expect(response.metadata.intent).toBe("memory_request");
    expect(response.metadata.memoryCandidate).toBeUndefined();
    expect(response.content).toContain("不会");
  });

  it("gives conservative emergency guidance before any other intent", () => {
    const response = run("请记住：论文做不下去，我不想活了");

    expect(response.metadata).toMatchObject({
      intent: "crisis_support",
      strategy: "none",
    });
    expect(response.content).toContain("120");
    expect(response.content).toContain("110");
    expect(response.content).toContain("不能替代紧急救援");
    expect(response.metadata.memoryCandidate).toBeUndefined();
  });

  it.each([
    "我想死",
    "我准备跳楼",
    "我不安全",
    "手边有药，我怕控制不住",
    "我已经准备伤害自己，现在一个人在房间里",
    "I want to die",
  ])("recognizes an explicit crisis statement: %s", (message) => {
    const response = run(message);

    expect(response.metadata).toMatchObject({
      intent: "crisis_support",
      strategy: "none",
      ragUsed: false,
      sources: [],
    });
  });

  it.each([
    "这个环境不安全，我先离开",
    "I feel not motivated today",
    "药放在身边，但我会按医嘱服用",
  ])("does not turn a non-crisis safety phrase into a crisis: %s", (message) => {
    expect(run(message).metadata.intent).not.toBe("crisis_support");
  });

  it("prioritizes crisis safety over a pending tool confirmation", () => {
    const sessionCode = createOfflineSession().sessionCode;
    run("我现在很焦虑", sessionCode);

    const response = run("好，但我准备跳楼", sessionCode);

    expect(response.metadata).toMatchObject({
      intent: "crisis_support",
      strategy: "none",
    });
  });

  it("never claims to have retrieved RAG sources", () => {
    const response = run("随便聊聊");

    expect(response.metadata).toMatchObject({
      mode: "offline",
      ragUsed: false,
      sources: [],
    });
    expect(response.metadata.notice).toContain("未检索知识库");
  });
});
