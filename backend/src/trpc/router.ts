import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createAgentSessionInputSchema,
  dailyCheckinSchema,
  runAgentInputSchema,
} from "../contracts/agent.js";
import { cycleInputSchema } from "../contracts/cycle.js";
import {
  createMemoryInputSchema,
  listMemoriesInputSchema,
  updateMemoryInputSchema,
} from "../contracts/memory.js";
import {
  breathingRecordSchema,
  personalDataUserIdSchema,
} from "../contracts/personal-data.js";
import {
  activityIdRequestSchema,
  conversationIdRequestSchema,
  createConversationInputSchema,
  createConversationMessageInputSchema,
  listActivitiesInputSchema,
  listConversationsInputSchema,
  messageIdRequestSchema,
  planDateRequestSchema,
  pointsSummaryQuerySchema,
  updateConversationInputSchema,
  updateConversationMessageInputSchema,
  upsertActivityInputSchema,
  upsertDailyPlanInputSchema,
  userRequestSchema,
  weeklyPointsGoalSchema,
} from "../contracts/product-features.js";
import {
  MemoryAgentSessionBindingRepository,
  postgresAgentSessionBindingRepository,
  type AgentSessionBindingRepository,
} from "../repositories/agent-sessions.js";
import {
  postgresMemoryRepository,
  type MemoryRepository,
} from "../repositories/memory.js";
import {
  postgresPersonalDataRepository,
  type PersonalDataRepository,
} from "../repositories/personal-data.js";
import {
  postgresProductFeaturesRepository,
  type ProductFeaturesRepository,
} from "../repositories/product-features.js";
import { calculateCycle } from "../services/cycle.js";
import { createAgentSession, runAgent } from "../services/agent.js";
import {
  loadAgentMemoryContext,
  remoteAgentMemoryUserId,
} from "../services/agent-memory.js";
import {
  agentSessionSubject,
  AgentSessionBindingService,
  AgentSessionBindingUnavailableError,
  AgentSessionRecreateRequiredError,
} from "../services/agent-session-bindings.js";
import { publicProcedure, router, type TrpcContext } from "./core.js";

export interface TrpcDependencies {
  personalDataRepository: PersonalDataRepository;
  productFeaturesRepository: ProductFeaturesRepository;
  memoryRepository: MemoryRepository;
  agentSessionBindingRepository?: AgentSessionBindingRepository;
}

const defaultDependencies: TrpcDependencies = {
  personalDataRepository: postgresPersonalDataRepository,
  productFeaturesRepository: postgresProductFeaturesRepository,
  memoryRepository: postgresMemoryRepository,
  agentSessionBindingRepository: postgresAgentSessionBindingRepository,
};

function notFound(resource: string): never {
  throw new TRPCError({ code: "NOT_FOUND", message: `${resource} not found` });
}

function scopedUserId(context: TrpcContext, requestedUserId: string): string {
  if (context.resolvedUserId) return context.resolvedUserId;
  if (context.identityDatabaseUnavailable) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Identity database unavailable",
    });
  }
  if (context.enforceResolvedUser) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  }
  // Direct createCaller() tests and trusted in-process callers remain usable.
  return requestedUserId;
}

async function withAgentSessionErrorMapping<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AgentSessionRecreateRequiredError) {
      throw new TRPCError({
        code: "CONFLICT",
        message: error.code,
        cause: error,
      });
    }
    if (error instanceof AgentSessionBindingUnavailableError) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: error.code,
        cause: error,
      });
    }
    throw error;
  }
}

export function createAppRouter(
  dependencies: TrpcDependencies = defaultDependencies,
) {
  const {
    personalDataRepository,
    productFeaturesRepository,
    memoryRepository,
  } = dependencies;
  const agentSessionBindingRepository = dependencies.agentSessionBindingRepository
    ?? (dependencies === defaultDependencies
      ? postgresAgentSessionBindingRepository
      : new MemoryAgentSessionBindingRepository());
  const agentSessionBindings = new AgentSessionBindingService(
    agentSessionBindingRepository,
  );

  return router({
    agent: router({
      createSession: publicProcedure
        .input(createAgentSessionInputSchema)
        .mutation(({ input, ctx }) => withAgentSessionErrorMapping(async () => {
          const user = ctx.resolvedUserId && ctx.authType
            ? { userId: ctx.resolvedUserId, authType: ctx.authType }
            : null;
          const result = await createAgentSession({
            ...input,
            memoryUserId: remoteAgentMemoryUserId(user),
          });
          await agentSessionBindings.bindCreatedSession(
            result.sessionCode,
            agentSessionSubject(user),
            ctx.identityDatabaseUnavailable === true,
          );
          return result;
        })),
      chat: publicProcedure
        .input(runAgentInputSchema)
        .mutation(({ input, ctx }) => withAgentSessionErrorMapping(async () => {
          const user = ctx.resolvedUserId && ctx.authType
            ? { userId: ctx.resolvedUserId, authType: ctx.authType }
            : null;
          const subject = agentSessionSubject(user);
          const authorization = await agentSessionBindings.authorizeSession(
            input.sessionCode,
            subject,
            ctx.identityDatabaseUnavailable === true,
          );
          const memories = authorization.bound
            ? await loadAgentMemoryContext(
              memoryRepository,
              ctx.resolvedUserId,
              input.message,
            )
            : [];
          const result = await runAgent(input, { memories });
          await agentSessionBindings.bindReplacementSession(
            input.sessionCode,
            result.sessionCode,
            subject,
            ctx.identityDatabaseUnavailable === true,
          );
          return result;
        })),
    }),
    cycle: router({
      calculate: publicProcedure
        .input(cycleInputSchema)
        .query(({ input }) => calculateCycle(input)),
    }),
    breathing: router({
      list: publicProcedure
        .input(userRequestSchema)
        .query(async ({ input, ctx }) =>
          (await personalDataRepository.getPersonalData(
            scopedUserId(ctx, input.userId),
          )).breathingRecords
        ),
      upsert: publicProcedure
        .input(z.object({
          userId: personalDataUserIdSchema,
          record: breathingRecordSchema,
        }))
        .mutation(({ input, ctx }) =>
          personalDataRepository.upsertBreathingRecord(
            scopedUserId(ctx, input.userId),
            input.record,
          )
        ),
      delete: publicProcedure
        .input(z.object({
          userId: personalDataUserIdSchema,
          recordId: personalDataUserIdSchema,
        }))
        .mutation(async ({ input, ctx }) => ({
          deleted: await personalDataRepository.deleteBreathingRecord(
            scopedUserId(ctx, input.userId),
            input.recordId,
          ),
        })),
    }),
    checkins: router({
      list: publicProcedure
        .input(userRequestSchema)
        .query(async ({ input, ctx }) =>
          (await personalDataRepository.getPersonalData(
            scopedUserId(ctx, input.userId),
          )).dailyCheckins
        ),
      upsert: publicProcedure
        .input(z.object({
          userId: personalDataUserIdSchema,
          checkin: dailyCheckinSchema,
        }))
        .mutation(({ input, ctx }) =>
          personalDataRepository.upsertDailyCheckin(
            scopedUserId(ctx, input.userId),
            input.checkin,
          )
        ),
      delete: publicProcedure
        .input(z.object({
          userId: personalDataUserIdSchema,
          date: planDateRequestSchema.shape.date,
        }))
        .mutation(async ({ input, ctx }) => ({
          deleted: await personalDataRepository.deleteDailyCheckin(
            scopedUserId(ctx, input.userId),
            input.date,
          ),
        })),
    }),
    conversations: router({
      list: publicProcedure
        .input(userRequestSchema.extend({
          options: listConversationsInputSchema.optional(),
        }))
        .query(({ input, ctx }) =>
          productFeaturesRepository.listConversations(
            scopedUserId(ctx, input.userId),
            listConversationsInputSchema.parse(input.options ?? {}),
          )
        ),
      get: publicProcedure
        .input(conversationIdRequestSchema)
        .query(async ({ input, ctx }) =>
          await productFeaturesRepository.getConversation(
            scopedUserId(ctx, input.userId),
            input.conversationId,
          ) ?? notFound("conversation")
        ),
      create: publicProcedure
        .input(z.object({
          userId: personalDataUserIdSchema,
          conversation: createConversationInputSchema,
        }))
        .mutation(({ input, ctx }) =>
          productFeaturesRepository.createConversation(
            scopedUserId(ctx, input.userId),
            input.conversation,
          )
        ),
      update: publicProcedure
        .input(conversationIdRequestSchema.extend({
          changes: updateConversationInputSchema,
        }))
        .mutation(async ({ input, ctx }) =>
          await productFeaturesRepository.updateConversation(
            scopedUserId(ctx, input.userId),
            input.conversationId,
            input.changes,
          ) ?? notFound("conversation")
        ),
      delete: publicProcedure
        .input(conversationIdRequestSchema)
        .mutation(async ({ input, ctx }) => ({
          deleted: await productFeaturesRepository.deleteConversation(
            scopedUserId(ctx, input.userId),
            input.conversationId,
          ),
        })),
      createMessage: publicProcedure
        .input(conversationIdRequestSchema.extend({
          message: createConversationMessageInputSchema,
        }))
        .mutation(({ input, ctx }) =>
          productFeaturesRepository.createMessage(
            scopedUserId(ctx, input.userId),
            input.conversationId,
            input.message,
          )
        ),
      updateMessage: publicProcedure
        .input(messageIdRequestSchema.extend({
          changes: updateConversationMessageInputSchema,
        }))
        .mutation(async ({ input, ctx }) =>
          await productFeaturesRepository.updateMessage(
            scopedUserId(ctx, input.userId),
            input.conversationId,
            input.messageId,
            input.changes,
          ) ?? notFound("message")
        ),
      deleteMessage: publicProcedure
        .input(messageIdRequestSchema)
        .mutation(async ({ input, ctx }) => ({
          deleted: await productFeaturesRepository.deleteMessage(
            scopedUserId(ctx, input.userId),
            input.conversationId,
            input.messageId,
          ),
        })),
    }),
    plans: router({
      get: publicProcedure
        .input(planDateRequestSchema)
        .query(async ({ input, ctx }) =>
          await productFeaturesRepository.getDailyPlan(
            scopedUserId(ctx, input.userId),
            input.date,
          )
            ?? notFound("daily plan")
        ),
      upsert: publicProcedure
        .input(z.object({
          userId: personalDataUserIdSchema,
          plan: upsertDailyPlanInputSchema,
        }))
        .mutation(({ input, ctx }) =>
          productFeaturesRepository.upsertDailyPlan(
            scopedUserId(ctx, input.userId),
            input.plan,
          )
        ),
      delete: publicProcedure
        .input(planDateRequestSchema)
        .mutation(async ({ input, ctx }) => ({
          deleted: await productFeaturesRepository.deleteDailyPlan(
            scopedUserId(ctx, input.userId),
            input.date,
          ),
        })),
    }),
    activities: router({
      list: publicProcedure
        .input(userRequestSchema.extend({
          options: listActivitiesInputSchema.optional(),
        }))
        .query(({ input, ctx }) =>
          productFeaturesRepository.listActivities(
            scopedUserId(ctx, input.userId),
            listActivitiesInputSchema.parse(input.options ?? {}),
          )
        ),
      upsert: publicProcedure
        .input(z.object({
          userId: personalDataUserIdSchema,
          activity: upsertActivityInputSchema,
        }))
        .mutation(({ input, ctx }) =>
          productFeaturesRepository.upsertActivity(
            scopedUserId(ctx, input.userId),
            input.activity,
          )
        ),
      delete: publicProcedure
        .input(activityIdRequestSchema)
        .mutation(async ({ input, ctx }) => ({
          deleted: await productFeaturesRepository.deleteActivity(
            scopedUserId(ctx, input.userId),
            input.activityId,
          ),
        })),
    }),
    points: router({
      summary: publicProcedure
        .input(userRequestSchema.extend({
          query: pointsSummaryQuerySchema.optional(),
        }))
        .query(({ input, ctx }) =>
          productFeaturesRepository.getPointsSummary(
            scopedUserId(ctx, input.userId),
            input.query?.date,
          )
        ),
      updateGoal: publicProcedure
        .input(userRequestSchema.extend({ goal: weeklyPointsGoalSchema }))
        .mutation(({ input, ctx }) =>
          productFeaturesRepository.updateWeeklyGoal(
            scopedUserId(ctx, input.userId),
            input.goal.weeklyGoal,
          )
        ),
    }),
    memories: router({
      list: publicProcedure
        .input(userRequestSchema.extend({
          options: listMemoriesInputSchema.optional(),
        }))
        .query(({ input, ctx }) =>
          memoryRepository.list(
            scopedUserId(ctx, input.userId),
            listMemoriesInputSchema.parse(input.options ?? {}),
          )
        ),
      create: publicProcedure
        .input(z.object({
          userId: personalDataUserIdSchema,
          memory: createMemoryInputSchema,
        }))
        .mutation(async ({ input, ctx }) =>
          await memoryRepository.create(
            scopedUserId(ctx, input.userId),
            input.memory,
          ) ?? notFound("source conversation")
        ),
      update: publicProcedure
        .input(z.object({
          userId: personalDataUserIdSchema,
          memoryId: personalDataUserIdSchema,
          changes: updateMemoryInputSchema,
        }))
        .mutation(async ({ input, ctx }) =>
          await memoryRepository.update(
            scopedUserId(ctx, input.userId),
            input.memoryId,
            input.changes,
          ) ?? notFound("memory")
        ),
      delete: publicProcedure
        .input(z.object({
          userId: personalDataUserIdSchema,
          memoryId: personalDataUserIdSchema,
        }))
        .mutation(async ({ input, ctx }) => ({
          deleted: await memoryRepository.delete(
            scopedUserId(ctx, input.userId),
            input.memoryId,
          ),
        })),
    }),
  });
}

export const appRouter = createAppRouter();
export type AppRouter = typeof appRouter;
