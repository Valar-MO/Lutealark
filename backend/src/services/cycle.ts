import type { CycleInput, CycleResult } from "../contracts/cycle.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year!, month! - 1, day!);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`无效日期：${value}`);
  }

  return timestamp;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function calculateCycle(input: CycleInput): CycleResult {
  const lastPeriod = parseDateOnly(input.lastPeriodDate);
  const today = parseDateOnly(input.today ?? utcToday());
  const elapsedDays = Math.floor((today - lastPeriod) / DAY_MS);

  if (elapsedDays < 0) {
    throw new Error("末次月经日期不能晚于计算日期");
  }

  const dayOfCycle = (elapsedDays % input.cycleLength) + 1;
  const ovulationDay = Math.floor(input.cycleLength / 2);
  const lutealLateStart = input.cycleLength - 6;
  const daysToNextPeriod = input.cycleLength - dayOfCycle + 1;

  if (dayOfCycle <= 5) {
    return {
      currentPhase: "menstruation",
      phaseName: "月经期",
      isBufferMode: true,
      dayOfCycle,
      daysToNextPeriod,
      energyValue: 3,
    };
  }
  if (dayOfCycle <= ovulationDay - 4) {
    return {
      currentPhase: "follicular_early",
      phaseName: "卵泡早期",
      isBufferMode: false,
      dayOfCycle,
      daysToNextPeriod,
      energyValue: 6,
    };
  }
  if (dayOfCycle < ovulationDay) {
    return {
      currentPhase: "follicular_late",
      phaseName: "卵泡晚期",
      isBufferMode: false,
      dayOfCycle,
      daysToNextPeriod,
      energyValue: 8,
    };
  }
  if (dayOfCycle <= ovulationDay + 1) {
    return {
      currentPhase: "ovulation",
      phaseName: "排卵期",
      isBufferMode: false,
      dayOfCycle,
      daysToNextPeriod,
      energyValue: 9,
    };
  }
  if (dayOfCycle < lutealLateStart) {
    return {
      currentPhase: "luteal_early",
      phaseName: "黄体早期",
      isBufferMode: false,
      dayOfCycle,
      daysToNextPeriod,
      energyValue: 6,
    };
  }
  return {
    currentPhase: "luteal_late",
    phaseName: "黄体晚期",
    isBufferMode: true,
    dayOfCycle,
    daysToNextPeriod,
    energyValue: 2,
  };
}
