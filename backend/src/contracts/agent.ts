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

/**
 * OpenTrek session identifiers are opaque, but they are also sent upstream and
 * used as local binding keys. Restrict them to a small, header-safe alphabet so
 * control characters, path fragments and unbounded values cannot cross that
 * trust boundary.
 */
export const agentSessionCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Invalid agent session code");

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

export const memoryCandidateSchema = z.object({
  candidateId: z.uuid(),
  kind: z.enum(["preference", "constraint", "long_term_goal"]),
  summary: z.string().trim().min(1).max(300),
  requiresConsent: z.literal(true),
  sourceTurnHash: z.string().regex(/^[0-9a-f]{64}$/i),
});

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day!));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month! - 1
      && parsed.getUTCDate() === day;
  }, { message: "Invalid calendar date" });

export const dailyCheckinSchema = z.object({
  date: calendarDateSchema,
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
  sessionCode: agentSessionCodeSchema,
  message: z.string().trim().min(1).max(20_000),
  metadata: agentMetadataSchema.optional().default({}),
  cycleSettings: cycleSettingsSchema.optional(),
  dailyCheckin: dailyCheckinSchema.optional(),
  dailyCheckins: z.array(dailyCheckinSchema).max(30).optional(),
  // Attachments are not currently a supported product feature. Rejecting them
  // is safer than forwarding an unvalidated provider-specific object graph.
  attachments: z.array(z.never()).max(0).optional().default([]),
});

export type RunAgentInput = z.infer<typeof runAgentInputSchema>;

export interface RunAgentResult {
  sessionCode: string;
  content: string;
  metadata: Record<string, unknown>;
}
