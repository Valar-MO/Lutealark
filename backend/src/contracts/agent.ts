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
  mode?: "online" | "offline";
}

export const agentMetadataSchema = z.record(z.string(), z.unknown());

export const knowledgeSourceSchema = z.object({
  sourceId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  url: z.string().url().max(2_000).optional(),
  chunkId: z.string().trim().max(200).optional(),
  excerpt: z.string().trim().max(600).optional(),
  score: z.number().min(0).max(1).optional(),
});

export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

export const dailyCheckinSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  energy: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
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
