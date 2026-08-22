import { z } from "zod";

export const cycleInputSchema = z.object({
  lastPeriodDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请使用 YYYY-MM-DD 格式"),
  cycleLength: z.number().int().min(21).max(35).default(28),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const cycleSettingsSchema = cycleInputSchema.omit({ today: true });
export type CycleSettings = z.infer<typeof cycleSettingsSchema>;

export type CycleInput = z.infer<typeof cycleInputSchema>;

export type CyclePhase =
  | "menstruation"
  | "follicular_early"
  | "follicular_late"
  | "ovulation"
  | "luteal_early"
  | "luteal_late";

export interface CycleResult {
  currentPhase: CyclePhase;
  phaseName: string;
  isBufferMode: boolean;
  dayOfCycle: number;
  daysToNextPeriod: number;
  energyValue: number;
}
