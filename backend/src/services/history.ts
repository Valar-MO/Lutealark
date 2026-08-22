import type { DailyCheckin } from "../contracts/agent.js";
import {
  businessDateOnly,
  calendarDayDifference,
  DEFAULT_BUSINESS_TIME_ZONE,
} from "./date.js";

export type EnergyTrend = "up" | "down" | "stable" | "insufficient_data";

export interface HistoryContext {
  windowDays: 7;
  recordCount: number;
  coverage: "insufficient" | "partial" | "good";
  latestCheckinDate: string;
  energy: {
    recentAverage: number;
    lowEnergyDays: number;
    trend: EnergyTrend;
  };
  mood: {
    frequent: DailyCheckin["mood"][];
    counts: Partial<Record<DailyCheckin["mood"], number>>;
  };
  bodyStateTop: string[];
}

const HISTORY_WINDOW_DAYS = 7;

/**
 * Turns locally stored daily check-ins into a small, deterministic context for
 * the agent. It does not persist records and intentionally avoids diagnosis.
 */
export function buildHistoryContext(
  records: readonly DailyCheckin[],
  now = new Date(),
  timeZone = DEFAULT_BUSINESS_TIME_ZONE,
): HistoryContext | null {
  const byDate = new Map<string, DailyCheckin>();

  for (const record of records) {
    if (record.shareWithChat) {
      byDate.set(record.date, record);
    }
  }

  const today = businessDateOnly(now, timeZone);
  const recent = [...byDate.values()]
    .map((record) => ({
      record,
      daysAgo: calendarDayDifference(today, record.date),
    }))
    .filter(({ daysAgo }) => daysAgo >= 0 && daysAgo < HISTORY_WINDOW_DAYS)
    .sort((left, right) => left.daysAgo - right.daysAgo);

  if (recent.length === 0) {
    return null;
  }

  const weightedEnergy = weightedAverage(recent);
  const moodCounts = countValues(recent.map(({ record }) => record.mood));
  const bodyStateCounts = countValues(
    recent.flatMap(({ record }) => record.bodyState),
  );
  const highestMoodCount = Math.max(...Object.values(moodCounts));
  const frequentMoods = (Object.keys(moodCounts) as DailyCheckin["mood"][])
    .filter((mood) => moodCounts[mood] === highestMoodCount)
    .sort();

  return {
    windowDays: HISTORY_WINDOW_DAYS,
    recordCount: recent.length,
    coverage: coverageFor(recent.length),
    latestCheckinDate: recent[0]!.record.date,
    energy: {
      recentAverage: roundToOneDecimal(weightedEnergy),
      lowEnergyDays: recent.filter(({ record }) => record.energy <= 2).length,
      trend: energyTrend(recent),
    },
    mood: {
      frequent: frequentMoods,
      counts: moodCounts,
    },
    bodyStateTop: Object.entries(bodyStateCounts)
      .sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0) || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .map(([bodyState]) => bodyState),
  };
}

function weightedAverage(
  records: readonly { record: DailyCheckin; daysAgo: number }[],
): number {
  const weighted = records.reduce(
    (total, { record, daysAgo }) => {
      const weight = 1 / (1 + daysAgo * 0.2);
      return {
        energy: total.energy + record.energy * weight,
        weight: total.weight + weight,
      };
    },
    { energy: 0, weight: 0 },
  );

  return weighted.energy / weighted.weight;
}

function energyTrend(
  records: readonly { record: DailyCheckin; daysAgo: number }[],
): EnergyTrend {
  const latest = records.filter(({ daysAgo }) => daysAgo <= 2);
  const earlier = records.filter(({ daysAgo }) => daysAgo >= 3);
  if (latest.length < 2 || earlier.length < 2) {
    return "insufficient_data";
  }

  const difference = weightedAverage(latest) - weightedAverage(earlier);
  if (difference >= 0.6) return "up";
  if (difference <= -0.6) return "down";
  return "stable";
}

function countValues<T extends string>(values: readonly T[]): Partial<Record<T, number>> {
  return values.reduce<Partial<Record<T, number>>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function coverageFor(recordCount: number): HistoryContext["coverage"] {
  if (recordCount < 3) return "insufficient";
  if (recordCount < 6) return "partial";
  return "good";
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
