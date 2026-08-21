import type { CycleInput, CycleResult } from "../contracts/cycle.js";
import {
  businessDateOnly,
  calendarDayDifference,
  DateInputError,
  DEFAULT_BUSINESS_TIME_ZONE,
} from "./date.js";

export interface CycleCalculationOptions {
  now?: Date;
  timeZone?: string;
}

export function calculateCycle(
  input: CycleInput,
  options: CycleCalculationOptions = {},
): CycleResult {
  const today = input.today ?? businessDateOnly(
    options.now ?? new Date(),
    options.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE,
  );
  const elapsedDays = calendarDayDifference(today, input.lastPeriodDate);

  if (elapsedDays < 0) {
    throw new DateInputError("末次月经日期不能晚于计算日期");
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
