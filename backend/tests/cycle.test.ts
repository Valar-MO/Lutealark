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
});
