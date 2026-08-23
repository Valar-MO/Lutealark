import { z } from "zod";
import { personalDataUserIdSchema } from "./personal-data.js";

export const authEmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .regex(/^[\x21-\x7e]+$/, "邮箱地址只能包含 ASCII 字符")
  .email()
  .transform((email) => email.toLowerCase());

export const registrationPasswordSchema = z
  .string()
  .min(10, "密码至少需要 10 个字符")
  .max(128, "密码不能超过 128 个字符");

const loginPasswordSchema = z.string().min(1).max(128);

export const registerInputSchema = z.object({
  email: authEmailSchema,
  password: registrationPasswordSchema,
  deviceUserId: personalDataUserIdSchema.optional(),
}).strict();

export const loginInputSchema = z.object({
  email: authEmailSchema,
  password: loginPasswordSchema,
  deviceUserId: personalDataUserIdSchema.optional(),
}).strict();

export const deleteAccountInputSchema = z.object({
  email: authEmailSchema,
  password: loginPasswordSchema,
}).strict();

export const dataMergeStatusSchema = z.enum([
  "no_device",
  "same_user",
  "merged",
  "already_claimed",
  "registered_account",
]);

export const authUserSchema = z.object({
  userId: personalDataUserIdSchema,
  email: authEmailSchema,
});

export const authSessionResponseSchema = z.object({
  authenticated: z.literal(true),
  user: authUserSchema,
  expiresAt: z.string().datetime({ offset: true }),
  dataMerge: dataMergeStatusSchema,
});

export const authMeResponseSchema = z.discriminatedUnion("authenticated", [
  z.object({
    authenticated: z.literal(true),
    authType: z.literal("account"),
    user: authUserSchema,
  }),
  z.object({
    authenticated: z.literal(false),
    authType: z.literal("anonymous"),
    user: z.object({ userId: personalDataUserIdSchema }),
  }),
  z.object({
    authenticated: z.literal(false),
    authType: z.literal("none"),
    user: z.null(),
  }),
]);

export type RegisterInput = z.infer<typeof registerInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountInputSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type DataMergeStatus = z.infer<typeof dataMergeStatusSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;

export interface AccountDataSnapshot {
  account: {
    userId: string;
    email: string;
    createdAt: string;
    updatedAt: string;
    claimedDevices: Array<{
      deviceUserId: string;
      claimedAt: string;
    }>;
  };
  cycleSettings: null | {
    lastPeriodDate: string;
    cycleLength: number;
    createdAt: string;
    updatedAt: string;
  };
  dailyCheckins: Array<{
    date: string;
    energy: 1 | 2 | 3 | 4 | 5;
    mood: "calm" | "anxious" | "low" | "irritable" | "overwhelmed";
    bodyState: string[];
    note: string | null;
    shareWithChat: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  breathingRecords: Array<{
    id: string;
    modeId: string;
    modeName: string;
    completedAt: string;
    durationSeconds: number;
    rating: number | null;
    createdAt: string;
    updatedAt: string;
  }>;
  conversations: Array<{
    id: string;
    title: string | null;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      conversationId: string;
      role: "user" | "assistant" | "system";
      content: string;
      metadata: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    }>;
  }>;
  dailyPlans: Array<{
    id: string;
    date: string;
    title: string | null;
    energyLevel: number | null;
    createdAt: string;
    updatedAt: string;
    items: Array<{
      id: string;
      content: string;
      estimatedMinutes: number | null;
      sortOrder: number;
      completedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  }>;
  activities: Array<{
    id: string;
    type: "pomodoro" | "environment" | "micro_movement";
    completedAt: string;
    durationSeconds: number | null;
    note: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>;
  points: {
    weeklyGoal: number;
    preferenceCreatedAt: string | null;
    preferenceUpdatedAt: string | null;
    events: Array<{
      eventKey: string;
      type: "checkin" | "breathing" | "pomodoro" | "plan_item" | "environment" | "micro_movement";
      points: number;
      sourceId: string;
      occurredAt: string;
      createdAt: string;
    }>;
  };
  memories: Array<{
    id: string;
    kind: "preference" | "constraint" | "long_term_goal";
    summary: string;
    sourceConversationId: string | null;
    sourceTurnHash: string;
    consentedAt: string;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface AccountDataExport {
  format: "lutealark-account-data";
  schemaVersion: 1;
  exportedAt: string;
  data: AccountDataSnapshot;
}
