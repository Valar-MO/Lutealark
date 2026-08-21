import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const sourceTurnHashInputSchema = z.string().trim().transform(
  (value) => value.toLowerCase(),
).refine(
  (value) => /^[0-9a-f]{64}$/.test(value)
    || (value.startsWith("manual:") && uuidSchema.safeParse(value.slice(7)).success),
  {
    message: "sourceTurnHash must be a SHA-256 hex digest or manual:<uuid>",
  },
);

export const memoryKindSchema = z.enum([
  "preference",
  "constraint",
  "long_term_goal",
]);

export const memoryEntrySchema = z.object({
  id: uuidSchema,
  kind: memoryKindSchema,
  summary: z.string().trim().min(1).max(300),
  sourceConversationId: uuidSchema.nullable(),
  sourceTurnHash: z.string().trim().min(16).max(128),
  consentedAt: timestampSchema,
  archived: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const listMemoriesInputSchema = z.object({
  includeArchived: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const createMemoryInputSchema = z.object({
  id: uuidSchema.optional(),
  kind: memoryKindSchema,
  summary: z.string().trim().min(1).max(300),
  sourceConversationId: uuidSchema.nullable().optional(),
  sourceTurnHash: sourceTurnHashInputSchema,
  consent: z.literal(true),
});

export const updateMemoryInputSchema = z.object({
  kind: memoryKindSchema.optional(),
  summary: z.string().trim().min(1).max(300).optional(),
  archived: z.boolean().optional(),
}).refine(
  (input) => input.kind !== undefined
    || input.summary !== undefined
    || input.archived !== undefined,
  { message: "At least one memory field is required" },
);

export type MemoryEntry = z.infer<typeof memoryEntrySchema>;
export type ListMemoriesInput = z.infer<typeof listMemoriesInputSchema>;
export type CreateMemoryInput = z.infer<typeof createMemoryInputSchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemoryInputSchema>;
