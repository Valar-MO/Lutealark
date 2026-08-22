import { describe, expect, it } from "vitest";
import { calculateCycle } from "../src/services/cycle.js";

describe("calculateCycle", () => {
  const atDay = (day: number) =>
    calculateCycle({
      lastPeriodDate: "2026-07-01",
      cycleLength: 28,
      today: `2026-07-${String(day).padStart(2, "0")}`,
    });

  it.each([
    [1, "menstruation", true, 3],
    [5, "menstruation", true, 3],
    [6, "follicular_early", false, 6],
    [10, "follicular_early", false, 6],
    [11, "follicular_late", false, 8],
    [13, "follicular_late", false, 8],
    [14, "ovulation", false, 9],
    [15, "ovulation", false, 9],
    [16, "luteal_early", false, 6],
    [21, "luteal_early", false, 6],
    [22, "luteal_late", true, 2],
    [28, "luteal_late", true, 2],
  ] as const)("maps cycle day %i", (day, phase, buffer, energy) => {
    const result = atDay(day);
    expect(result.currentPhase).toBe(phase);
    expect(result.isBufferMode).toBe(buffer);
    expect(result.energyValue).toBe(energy);
    expect(result.dayOfCycle).toBe(day);
  });

  it("wraps to day one after a full cycle", () => {
    const result = calculateCycle({
      lastPeriodDate: "2026-07-01",
      cycleLength: 28,
      today: "2026-07-29",
    });
    expect(result.dayOfCycle).toBe(1);
  });

  it.each([
    [21, "2026-07-15", 15],
    [35, "2026-07-29", 29],
  ] as const)(
    "uses the final seven days as late luteal for a %i-day cycle",
    (cycleLength, today, expectedDay) => {
      const result = calculateCycle({
        lastPeriodDate: "2026-07-01",
        cycleLength,
        today,
      });
      expect(result.dayOfCycle).toBe(expectedDay);
      expect(result.currentPhase).toBe("luteal_late");
      expect(result.isBufferMode).toBe(true);
    },
  );

  it("rejects a future last-period date", () => {
    expect(() =>
      calculateCycle({
        lastPeriodDate: "2026-07-14",
        cycleLength: 28,
        today: "2026-07-13",
      }),
    ).toThrow("不能晚于");
  });

  it("uses the Shanghai calendar date before the UTC date rolls over", () => {
    const input = {
      lastPeriodDate: "2026-08-01",
      cycleLength: 28,
    };
    const justBeforeShanghaiMidnight = new Date("2026-08-06T15:59:59Z");
    const atShanghaiMidnight = new Date("2026-08-06T16:00:00Z");

    expect(calculateCycle(input, { now: justBeforeShanghaiMidnight }).dayOfCycle)
      .toBe(6);
    expect(calculateCycle(input, { now: atShanghaiMidnight }).dayOfCycle).toBe(7);
    expect(
      calculateCycle(input, { now: atShanghaiMidnight, timeZone: "UTC" })
        .dayOfCycle,
    ).toBe(6);
  });

  it("rejects a semantically invalid date", () => {
    expect(() =>
      calculateCycle({
        lastPeriodDate: "2026-02-30",
        cycleLength: 28,
        today: "2026-03-01",
      }),
    ).toThrow("无效日期");
  });
});
