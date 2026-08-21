import { describe, expect, it } from "vitest";
import type { DailyCheckin } from "../src/contracts/agent.js";
import { buildHistoryContext } from "../src/services/history.js";

const today = new Date("2026-07-29T12:00:00Z");

describe("history context", () => {
  it("creates a compact, weighted seven-day summary", () => {
    const context = buildHistoryContext(
      [
        { date: "2026-07-29", energy: 1, mood: "anxious", bodyState: ["fatigue"], shareWithChat: true },
        { date: "2026-07-28", energy: 2, mood: "anxious", bodyState: ["fatigue", "poor_sleep"], shareWithChat: true },
        { date: "2026-07-27", energy: 2, mood: "irritable", bodyState: ["fatigue"], shareWithChat: true },
        { date: "2026-07-25", energy: 4, mood: "calm", bodyState: ["headache"], shareWithChat: true },
        { date: "2026-07-24", energy: 4, mood: "calm", bodyState: [], shareWithChat: true },
      ],
      today,
    );

    expect(context).toEqual({
      windowDays: 7,
      recordCount: 5,
      coverage: "partial",
      latestCheckinDate: "2026-07-29",
      energy: {
        recentAverage: 2.3,
        lowEnergyDays: 3,
        trend: "down",
      },
      mood: {
        frequent: ["anxious", "calm"],
        counts: { anxious: 2, irritable: 1, calm: 2 },
      },
      bodyStateTop: ["fatigue", "headache", "poor_sleep"],
    });
  });

  it("excludes records the user chose not to share", () => {
    const context = buildHistoryContext(
      [
        { date: "2026-07-29", energy: 1, mood: "overwhelmed", bodyState: ["fatigue"], shareWithChat: false },
        { date: "2026-07-28", energy: 4, mood: "calm", bodyState: [], shareWithChat: true },
      ],
      today,
    );

    expect(context).toMatchObject({
      recordCount: 1,
      latestCheckinDate: "2026-07-28",
      energy: { recentAverage: 4, lowEnergyDays: 0, trend: "insufficient_data" },
      mood: { frequent: ["calm"] },
    });
  });

  it("returns no context when no shared check-in is in the recent window", () => {
    expect(buildHistoryContext([
      { date: "2026-07-20", energy: 3, mood: "calm", bodyState: [], shareWithChat: true },
    ], today)).toBeNull();
  });

  it("uses Shanghai midnight for today's record and the seven-day boundary", () => {
    const atShanghaiMidnight = new Date("2026-08-06T16:00:00Z");
    const records: DailyCheckin[] = [
      { date: "2026-08-07", energy: 2, mood: "anxious", bodyState: ["fatigue"], shareWithChat: true },
      { date: "2026-08-01", energy: 3, mood: "calm", bodyState: [], shareWithChat: true },
      { date: "2026-07-31", energy: 4, mood: "calm", bodyState: [], shareWithChat: true },
    ];

    const shanghaiContext = buildHistoryContext(records, atShanghaiMidnight);
    expect(shanghaiContext).toMatchObject({
      recordCount: 2,
      latestCheckinDate: "2026-08-07",
      mood: { counts: { anxious: 1, calm: 1 } },
    });

    const utcContext = buildHistoryContext(records, atShanghaiMidnight, "UTC");
    expect(utcContext).toMatchObject({
      recordCount: 2,
      latestCheckinDate: "2026-08-01",
      mood: { counts: { calm: 2 } },
    });
  });

  it("rejects a semantically invalid check-in date", () => {
    expect(() => buildHistoryContext([
      { date: "2026-02-30", energy: 3, mood: "calm", bodyState: [], shareWithChat: true },
    ], today)).toThrow("无效日期");
  });
});
