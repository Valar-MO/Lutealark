import { z } from "zod";

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

export const runAgentInputSchema = z.object({
  sessionCode: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(20_000),
  metadata: agentMetadataSchema.optional().default({}),
  attachments: z.array(z.unknown()).optional().default([]),
});

export type RunAgentInput = z.infer<typeof runAgentInputSchema>;

export interface RunAgentResult {
  sessionCode: string;
  content: string;
  metadata: Record<string, unknown>;
}
