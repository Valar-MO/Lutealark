import { z } from "zod";
import { cycleSettingsSchema } from "./cycle.js";

export const createAgentSessionInputSchema = z.object({
  memoryUserId: z.string().min(1).max(128).optional(),
});

export type CreateAgentSessionInput = z.infer<
  typeof createAgentSessionInputSchema
>;

export interface CreateAgentSessionResult {
  sessionCode: string;
}

export const agentMetadataSchema = z.record(z.string(), z.unknown());

export const dailyCheckinSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  energy: z.number().int().min(1).max(5),
  mood: z.enum(["calm", "anxious", "low", "irritable", "overwhelmed"]),
  bodyState: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  note: z.string().trim().max(200).optional(),
  shareWithChat: z.boolean().default(true),
});

export type DailyCheckin = z.infer<typeof dailyCheckinSchema>;

export const runAgentInputSchema = z.object({
  sessionCode: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(20_000),
  metadata: agentMetadataSchema.optional().default({}),
  cycleSettings: cycleSettingsSchema.optional(),
  dailyCheckin: dailyCheckinSchema.optional(),
  dailyCheckins: z.array(dailyCheckinSchema).max(30).optional(),
  attachments: z.array(z.unknown()).optional().default([]),
});

export type RunAgentInput = z.infer<typeof runAgentInputSchema>;

export interface RunAgentResult {
  sessionCode: string;
  content: string;
  metadata: Record<string, unknown>;
}
