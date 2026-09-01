import { z } from "zod";
import { dailyCheckinSchema } from "./agent.js";
import { cycleSettingsSchema } from "./cycle.js";

export const personalDataUserIdSchema = z.string().uuid();

export const completedAtInputSchema = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => new Date(value).getTime() <= Date.now() + 5 * 60 * 1000,
    { message: "完成时间不能晚于服务器时间 5 分钟以上" },
  );

export const breathingRecordSchema = z.object({
  id: z.string().uuid(),
  modeId: z.string().trim().min(1).max(64),
  modeName: z.string().trim().min(1).max(100),
  completedAt: completedAtInputSchema,
  durationSeconds: z.number().int().min(1).max(86_400),
  rating: z.number().int().min(1).max(5).nullable(),
});

export const cycleEventSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请使用 YYYY-MM-DD 格式"),
  type: z.enum(["period_start", "period_end", "no_symptom"]),
});

export const cycleEventMutationResultSchema = z.object({
  event: cycleEventSchema,
  cycleSettings: cycleSettingsSchema.nullable(),
});

export const personalDataSnapshotSchema = z.object({
  cycleSettings: cycleSettingsSchema.nullable(),
  cycleEvents: z.array(cycleEventSchema).max(30).default([]),
  dailyCheckins: z.array(dailyCheckinSchema).max(30),
  breathingRecords: z.array(breathingRecordSchema).max(30),
});

export type PersonalDataUserId = z.infer<typeof personalDataUserIdSchema>;
export type BreathingRecord = z.infer<typeof breathingRecordSchema>;
export type CycleEvent = z.infer<typeof cycleEventSchema>;
export type CycleEventMutationResult = z.infer<typeof cycleEventMutationResultSchema>;
export type PersonalDataSnapshot = z.infer<typeof personalDataSnapshotSchema>;
