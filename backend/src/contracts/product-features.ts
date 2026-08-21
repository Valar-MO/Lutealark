import { z } from "zod";
import {
  completedAtInputSchema,
  personalDataUserIdSchema,
} from "./personal-data.js";

const uuidSchema = z.string().uuid();
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day!));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month! - 1
      && parsed.getUTCDate() === day;
  }, { message: "Invalid calendar date" });
const timestampSchema = z.string().datetime({ offset: true });
const metadataSchema = z.record(z.string(), z.unknown());

export const conversationRoleSchema = z.enum(["user", "assistant", "system"]);

export const conversationSchema = z.object({
  id: uuidSchema,
  title: z.string().trim().min(1).max(120).nullable(),
  archived: z.boolean(),
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const conversationMessageSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  role: conversationRoleSchema,
  content: z.string().trim().min(1).max(20_000),
  metadata: metadataSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const conversationDetailSchema = conversationSchema.extend({
  messages: z.array(conversationMessageSchema),
});

export const listConversationsInputSchema = z.object({
  includeArchived: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const createConversationInputSchema = z.object({
  id: uuidSchema.optional(),
  title: z.string().trim().min(1).max(120).nullable().optional(),
});

export const updateConversationInputSchema = z.object({
  title: z.string().trim().min(1).max(120).nullable().optional(),
  archived: z.boolean().optional(),
}).refine((input) => input.title !== undefined || input.archived !== undefined, {
  message: "At least one conversation field is required",
});

export const createConversationMessageInputSchema = z.object({
  id: uuidSchema.optional(),
  role: conversationRoleSchema,
  content: z.string().trim().min(1).max(20_000),
  metadata: metadataSchema.optional().default({}),
  createdAt: timestampSchema.optional(),
});

export const updateConversationMessageInputSchema = z.object({
  content: z.string().trim().min(1).max(20_000).optional(),
  metadata: metadataSchema.optional(),
}).refine((input) => input.content !== undefined || input.metadata !== undefined, {
  message: "At least one message field is required",
});

export const dailyPlanItemInputSchema = z.object({
  // A stable client-generated id makes offline retries and point awards idempotent.
  id: uuidSchema,
  content: z.string().trim().min(1).max(200),
  estimatedMinutes: z.number().int().min(1).max(240).nullable().optional(),
  completed: z.boolean().optional().default(false),
});

export const upsertDailyPlanInputSchema = z.object({
  id: uuidSchema.optional(),
  date: dateOnlySchema,
  title: z.string().trim().min(1).max(120).nullable().optional(),
  energyLevel: z.number().int().min(1).max(5).nullable().optional(),
  items: z.array(dailyPlanItemInputSchema).min(1).max(12),
});

export const dailyPlanItemSchema = z.object({
  id: uuidSchema,
  content: z.string(),
  estimatedMinutes: z.number().int().nullable(),
  sortOrder: z.number().int().min(0).max(11),
  completedAt: timestampSchema.nullable(),
});

export const dailyPlanSchema = z.object({
  id: uuidSchema,
  date: dateOnlySchema,
  title: z.string().nullable(),
  energyLevel: z.number().int().nullable(),
  items: z.array(dailyPlanItemSchema).max(12),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const activityTypeSchema = z.enum([
  "pomodoro",
  "environment",
  "micro_movement",
]);

export const upsertActivityInputSchema = z.object({
  id: uuidSchema.optional(),
  type: activityTypeSchema,
  completedAt: completedAtInputSchema,
  durationSeconds: z.number().int().min(1).max(86_400).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
  metadata: metadataSchema.optional().default({}),
});

export const activityRecordSchema = z.object({
  id: uuidSchema,
  type: activityTypeSchema,
  completedAt: timestampSchema,
  durationSeconds: z.number().int().nullable(),
  note: z.string().nullable(),
  metadata: metadataSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const activityMutationResultSchema = z.object({
  activity: activityRecordSchema,
  pointsAwarded: z.number().int().nonnegative(),
});

export const listActivitiesInputSchema = z.object({
  type: activityTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).optional().default(30),
});

export const pointEventTypeSchema = z.enum([
  "checkin",
  "breathing",
  "pomodoro",
  "plan_item",
  "environment",
  "micro_movement",
]);

export const pointEventSchema = z.object({
  eventKey: z.string(),
  type: pointEventTypeSchema,
  points: z.number().int().positive(),
  sourceId: z.string(),
  occurredAt: timestampSchema,
});

export const weeklyPointsGoalSchema = z.object({
  weeklyGoal: z.number().int().min(1).max(1000),
});

export const pointsSummarySchema = z.object({
  weekStart: dateOnlySchema,
  weekEnd: dateOnlySchema,
  weeklyGoal: z.number().int().positive(),
  weeklyPoints: z.number().int().nonnegative(),
  totalPoints: z.number().int().nonnegative(),
  remainingPoints: z.number().int().nonnegative(),
  breakdown: z.record(pointEventTypeSchema, z.number().int().nonnegative()),
  recentEvents: z.array(pointEventSchema),
});

export const pointsSummaryQuerySchema = z.object({
  date: dateOnlySchema.optional(),
});

export const userRequestSchema = z.object({ userId: personalDataUserIdSchema });
export const conversationIdRequestSchema = userRequestSchema.extend({
  conversationId: uuidSchema,
});
export const messageIdRequestSchema = conversationIdRequestSchema.extend({
  messageId: uuidSchema,
});
export const planDateRequestSchema = userRequestSchema.extend({ date: dateOnlySchema });
export const activityIdRequestSchema = userRequestSchema.extend({ activityId: uuidSchema });

export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
export type ListConversationsInput = z.infer<typeof listConversationsInputSchema>;
export type CreateConversationInput = z.infer<typeof createConversationInputSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationInputSchema>;
export type CreateConversationMessageInput = z.infer<typeof createConversationMessageInputSchema>;
export type UpdateConversationMessageInput = z.infer<typeof updateConversationMessageInputSchema>;
export type UpsertDailyPlanInput = z.infer<typeof upsertDailyPlanInputSchema>;
export type DailyPlan = z.infer<typeof dailyPlanSchema>;
export type ActivityType = z.infer<typeof activityTypeSchema>;
export type UpsertActivityInput = z.infer<typeof upsertActivityInputSchema>;
export type ActivityRecord = z.infer<typeof activityRecordSchema>;
export type ActivityMutationResult = z.infer<typeof activityMutationResultSchema>;
export type ListActivitiesInput = z.infer<typeof listActivitiesInputSchema>;
export type PointEventType = z.infer<typeof pointEventTypeSchema>;
export type PointEvent = z.infer<typeof pointEventSchema>;
export type PointsSummary = z.infer<typeof pointsSummarySchema>;
