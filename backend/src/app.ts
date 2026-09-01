import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError } from "zod";
import { OpenTrekError } from "./clients/opentrek.js";
import {
  corsOrigins,
  OpenTrekConfigurationError,
  openTrekHealth,
} from "./config/env.js";
import {
  createAgentSessionInputSchema,
  dailyCheckinSchema,
  runAgentInputSchema,
} from "./contracts/agent.js";
import { cycleInputSchema, cycleSettingsSchema } from "./contracts/cycle.js";
import {
  createMemoryInputSchema,
  listMemoriesInputSchema,
  updateMemoryInputSchema,
} from "./contracts/memory.js";
import {
  breathingRecordSchema,
  cycleEventSchema,
  personalDataUserIdSchema,
} from "./contracts/personal-data.js";
import {
  createConversationInputSchema,
  createConversationMessageInputSchema,
  listActivitiesInputSchema,
  listConversationsInputSchema,
  pointsSummaryQuerySchema,
  updateConversationInputSchema,
  updateConversationMessageInputSchema,
  upsertActivityInputSchema,
  upsertDailyPlanInputSchema,
  weeklyPointsGoalSchema,
} from "./contracts/product-features.js";
import { DatabaseUnavailableError } from "./db/pool.js";
import { createCorsMiddleware } from "./middleware/cors.js";
import {
  agentClientKey,
  type AgentOperation,
  type AgentTrafficGuard,
  MemoryAgentTrafficGuard,
} from "./middleware/agent-traffic.js";
import {
  MemoryAgentSessionBindingRepository,
  postgresAgentSessionBindingRepository,
  type AgentSessionBindingRepository,
} from "./repositories/agent-sessions.js";
import {
  postgresMemoryRepository,
  type MemoryRepository,
} from "./repositories/memory.js";
import {
  postgresPersonalDataRepository,
  type PersonalDataRepository,
} from "./repositories/personal-data.js";
import {
  postgresProductFeaturesRepository,
  ResourceConflictError,
  ResourceNotFoundError,
  type ProductFeaturesRepository,
} from "./repositories/product-features.js";
import { calculateCycle } from "./services/cycle.js";
import { dateOnlyTimestamp, DateInputError } from "./services/date.js";
import { createAgentSession, runAgent } from "./services/agent.js";
import {
  loadAgentMemoryContext,
  remoteAgentMemoryUserId,
} from "./services/agent-memory.js";
import {
  agentSessionSubject,
  AgentSessionBindingService,
  AgentSessionBindingUnavailableError,
  AgentSessionRecreateRequiredError,
  resolveAgentRequestIdentity,
} from "./services/agent-session-bindings.js";
import { createAppRouter } from "./trpc/router.js";
import { createAuthRoutes } from "./routes/auth.js";
import {
  AuthService,
  AuthServiceError,
  authService,
  resolveAuthenticatedUser,
} from "./services/auth.js";

export interface AppDependencies {
  personalDataRepository: PersonalDataRepository;
  productFeaturesRepository?: ProductFeaturesRepository;
  memoryRepository?: MemoryRepository;
  agentSessionBindingRepository?: AgentSessionBindingRepository;
  authenticationService?: AuthService;
  corsOrigins?: readonly string[];
  agentTrafficGuard?: AgentTrafficGuard;
  agentClientKey?: (request: Request) => string;
}

const defaultDependencies: AppDependencies = {
  personalDataRepository: postgresPersonalDataRepository,
  productFeaturesRepository: postgresProductFeaturesRepository,
  memoryRepository: postgresMemoryRepository,
  agentSessionBindingRepository: postgresAgentSessionBindingRepository,
  authenticationService: authService,
  corsOrigins,
};

export function createApp(
  dependencies: AppDependencies = defaultDependencies,
): Hono {
  const app = new Hono();
  const { personalDataRepository } = dependencies;
  const productFeaturesRepository = dependencies.productFeaturesRepository
    ?? postgresProductFeaturesRepository;
  const memoryRepository = dependencies.memoryRepository
    ?? postgresMemoryRepository;
  const agentSessionBindingRepository = dependencies.agentSessionBindingRepository
    ?? (dependencies === defaultDependencies
      ? postgresAgentSessionBindingRepository
      : new MemoryAgentSessionBindingRepository());
  const agentSessionBindings = new AgentSessionBindingService(
    agentSessionBindingRepository,
  );
  const authenticationService = dependencies.authenticationService
    ?? authService;
  const allowedCorsOrigins = dependencies.corsOrigins ?? corsOrigins;
  const agentTrafficGuard = dependencies.agentTrafficGuard
    ?? new MemoryAgentTrafficGuard();
  const getAgentClientKey = dependencies.agentClientKey ?? agentClientKey;
  const trpcRouter = createAppRouter({
    personalDataRepository,
    productFeaturesRepository,
    memoryRepository,
    agentSessionBindingRepository,
  });

  app.use("*", createCorsMiddleware(allowedCorsOrigins));

  app.use("*", async (c, next) => {
    await next();
    const contentType = c.res.headers.get("Content-Type");
    if (contentType?.toLowerCase() === "application/json") {
      c.res.headers.set("Content-Type", "application/json; charset=utf-8");
    }
  });

  const preventPersonalDataCaching: MiddlewareHandler = async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  };
  app.use("/api/personal-data", preventPersonalDataCaching);
  app.use("/api/personal-data/*", preventPersonalDataCaching);
  app.use("/api/agent/*", preventPersonalDataCaching);
  app.use("/api/conversations", preventPersonalDataCaching);
  app.use("/api/conversations/*", preventPersonalDataCaching);
  app.use("/api/plans/*", preventPersonalDataCaching);
  app.use("/api/activities", preventPersonalDataCaching);
  app.use("/api/activities/*", preventPersonalDataCaching);
  app.use("/api/points/*", preventPersonalDataCaching);
  app.use("/api/memories", preventPersonalDataCaching);
  app.use("/api/memories/*", preventPersonalDataCaching);
  app.use("/trpc/*", preventPersonalDataCaching);
  const apiBodyLimit = bodyLimit({
    maxSize: 256 * 1024,
    onError: (context) => context.json(
      { error: "PAYLOAD_TOO_LARGE", message: "请求内容过大" },
      413,
    ),
  });
  app.use("/api/*", apiBodyLimit);
  app.use("/trpc/*", apiBodyLimit);

  app.route("/api/auth", createAuthRoutes({ service: authenticationService }));

  class InvalidJsonBodyError extends Error {}
  class AgentTrafficLimitError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super("Agent request limit exceeded");
    }
  }
  const jsonBody = async (context: { req: { json(): Promise<unknown> } }) => {
    try {
      return await context.req.json();
    } catch {
      throw new InvalidJsonBodyError();
    }
  };
  const withAgentTrafficGuard = async <T>(
    operation: AgentOperation,
    request: Request,
    action: () => Promise<T>,
  ): Promise<T> => {
    const lease = agentTrafficGuard.enter(operation, getAgentClientKey(request));
    if (!lease.allowed) throw new AgentTrafficLimitError(lease.retryAfterSeconds);
    try {
      return await action();
    } finally {
      lease.release();
    }
  };

  app.get("/", (c) =>
    c.json({
      status: "ok",
      service: "lutealark-backend",
      message: "Lutealark backend is running",
      endpoints: {
        health: "GET /health",
        openTrekHealth: "GET /health/opentrek",
        databaseHealth: "GET /health/database",
        personalData: "GET /api/personal-data",
        conversations: "GET|POST /api/conversations",
        dailyPlans: "GET|PUT|DELETE /api/plans/:date",
        activities: "GET|PUT /api/activities",
        points: "GET /api/points/summary",
        memories: "GET|POST /api/memories",
        createAgentSession: "POST /api/agent/session",
        runAgent: "POST /api/agent/chat",
        calculateCycle: "POST /api/workflow/cycle",
        trpc: "/trpc/*",
      },
    }),
  );

  app.get("/health", (c) =>
    c.json({ status: "ok", service: "lutealark-backend", opentrek: openTrekHealth() }),
  );

  app.get("/health/opentrek", (c) => c.json(openTrekHealth()));

  app.get("/health/database", async (c) => {
    await personalDataRepository.checkHealth();
    return c.json({ status: "ok", service: "lutealark-database" });
  });

  app.get("/api/personal-data", async (c) => {
    const userId = (await resolveAuthenticatedUser(
      c.req.raw,
      authenticationService,
    )).userId;
    return c.json(await personalDataRepository.getPersonalData(userId));
  });

  app.put("/api/personal-data/cycle", async (c) => {
    const userId = (await resolveAuthenticatedUser(
      c.req.raw,
      authenticationService,
    )).userId;
    const input = cycleSettingsSchema.parse(
      await c.req.json().catch(() => undefined),
    );
    calculateCycle(input);
    return c.json(await personalDataRepository.upsertCycleSettings(userId, input));
  });

  app.put("/api/personal-data/cycle-event", async (c) => {
    const userId = (await resolveAuthenticatedUser(
      c.req.raw,
      authenticationService,
    )).userId;
    const input = cycleEventSchema.parse(
      await c.req.json().catch(() => undefined),
    );
    dateOnlyTimestamp(input.date);
    return c.json(await personalDataRepository.recordCycleEvent(userId, input));
  });

  app.put("/api/personal-data/checkin", async (c) => {
    const userId = (await resolveAuthenticatedUser(
      c.req.raw,
      authenticationService,
    )).userId;
    const input = dailyCheckinSchema.parse(
      await c.req.json().catch(() => undefined),
    );
    dateOnlyTimestamp(input.date);
    return c.json(await personalDataRepository.upsertDailyCheckin(userId, input));
  });

  app.delete("/api/personal-data/checkin/:date", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const date = c.req.param("date");
    dateOnlyTimestamp(date);
    const deleted = await personalDataRepository.deleteDailyCheckin(userId, date);
    if (!deleted) throw new ResourceNotFoundError("daily check-in");
    return c.json({ deleted: true });
  });

  app.put("/api/personal-data/breathing", async (c) => {
    const userId = (await resolveAuthenticatedUser(
      c.req.raw,
      authenticationService,
    )).userId;
    const input = breathingRecordSchema.parse(
      await c.req.json().catch(() => undefined),
    );
    return c.json(await personalDataRepository.upsertBreathingRecord(userId, input));
  });

  app.delete("/api/personal-data/breathing/:recordId", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const recordId = personalDataUserIdSchema.parse(c.req.param("recordId"));
    const deleted = await personalDataRepository.deleteBreathingRecord(
      userId,
      recordId,
    );
    if (!deleted) throw new ResourceNotFoundError("breathing record");
    return c.json({ deleted: true });
  });

  const requestUserId = async (request: Request) =>
    (await resolveAuthenticatedUser(request, authenticationService)).userId;

  app.get("/api/conversations", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const includeArchivedValue = c.req.query("includeArchived");
    const includeArchived = includeArchivedValue === undefined
      ? undefined
      : includeArchivedValue === "true"
        ? true
        : includeArchivedValue === "false"
          ? false
          : includeArchivedValue;
    const limitValue = c.req.query("limit");
    const input = listConversationsInputSchema.parse({
      includeArchived,
      limit: limitValue === undefined ? undefined : Number(limitValue),
    });
    return c.json(await productFeaturesRepository.listConversations(userId, input));
  });

  app.post("/api/conversations", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const input = createConversationInputSchema.parse(
      await c.req.json().catch(() => undefined),
    );
    return c.json(
      await productFeaturesRepository.createConversation(userId, input),
      201,
    );
  });

  app.get("/api/conversations/:conversationId", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const conversationId = personalDataUserIdSchema.parse(
      c.req.param("conversationId"),
    );
    const result = await productFeaturesRepository.getConversation(
      userId,
      conversationId,
    );
    if (!result) throw new ResourceNotFoundError("conversation");
    return c.json(result);
  });

  app.patch("/api/conversations/:conversationId", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const conversationId = personalDataUserIdSchema.parse(
      c.req.param("conversationId"),
    );
    const input = updateConversationInputSchema.parse(
      await c.req.json().catch(() => undefined),
    );
    const result = await productFeaturesRepository.updateConversation(
      userId,
      conversationId,
      input,
    );
    if (!result) throw new ResourceNotFoundError("conversation");
    return c.json(result);
  });

  app.delete("/api/conversations/:conversationId", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const conversationId = personalDataUserIdSchema.parse(
      c.req.param("conversationId"),
    );
    const deleted = await productFeaturesRepository.deleteConversation(
      userId,
      conversationId,
    );
    if (!deleted) throw new ResourceNotFoundError("conversation");
    return c.json({ deleted: true });
  });

  app.post("/api/conversations/:conversationId/messages", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const conversationId = personalDataUserIdSchema.parse(
      c.req.param("conversationId"),
    );
    const input = createConversationMessageInputSchema.parse(
      await c.req.json().catch(() => undefined),
    );
    return c.json(
      await productFeaturesRepository.createMessage(userId, conversationId, input),
      201,
    );
  });

  app.patch(
    "/api/conversations/:conversationId/messages/:messageId",
    async (c) => {
      const userId = await requestUserId(c.req.raw);
      const conversationId = personalDataUserIdSchema.parse(
        c.req.param("conversationId"),
      );
      const messageId = personalDataUserIdSchema.parse(c.req.param("messageId"));
      const input = updateConversationMessageInputSchema.parse(
        await c.req.json().catch(() => undefined),
      );
      const result = await productFeaturesRepository.updateMessage(
        userId,
        conversationId,
        messageId,
        input,
      );
      if (!result) throw new ResourceNotFoundError("message");
      return c.json(result);
    },
  );

  app.delete(
    "/api/conversations/:conversationId/messages/:messageId",
    async (c) => {
      const userId = await requestUserId(c.req.raw);
      const conversationId = personalDataUserIdSchema.parse(
        c.req.param("conversationId"),
      );
      const messageId = personalDataUserIdSchema.parse(c.req.param("messageId"));
      const deleted = await productFeaturesRepository.deleteMessage(
        userId,
        conversationId,
        messageId,
      );
      if (!deleted) throw new ResourceNotFoundError("message");
      return c.json({ deleted: true });
    },
  );

  app.get("/api/plans/:date", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const date = c.req.param("date");
    dateOnlyTimestamp(date);
    const plan = await productFeaturesRepository.getDailyPlan(userId, date);
    if (!plan) throw new ResourceNotFoundError("daily plan");
    return c.json(plan);
  });

  app.put("/api/plans/:date", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const date = c.req.param("date");
    dateOnlyTimestamp(date);
    const input = upsertDailyPlanInputSchema.parse({
      ...await c.req.json().catch(() => undefined),
      date,
    });
    return c.json(await productFeaturesRepository.upsertDailyPlan(userId, input));
  });

  app.delete("/api/plans/:date", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const date = c.req.param("date");
    dateOnlyTimestamp(date);
    const deleted = await productFeaturesRepository.deleteDailyPlan(userId, date);
    if (!deleted) throw new ResourceNotFoundError("daily plan");
    return c.json({ deleted: true });
  });

  app.get("/api/activities", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const limitValue = c.req.query("limit");
    const input = listActivitiesInputSchema.parse({
      type: c.req.query("type"),
      limit: limitValue === undefined ? undefined : Number(limitValue),
    });
    return c.json(await productFeaturesRepository.listActivities(userId, input));
  });

  app.put("/api/activities", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const input = upsertActivityInputSchema.parse(
      await c.req.json().catch(() => undefined),
    );
    return c.json(await productFeaturesRepository.upsertActivity(userId, input));
  });

  app.delete("/api/activities/:activityId", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const activityId = personalDataUserIdSchema.parse(c.req.param("activityId"));
    const deleted = await productFeaturesRepository.deleteActivity(userId, activityId);
    if (!deleted) throw new ResourceNotFoundError("activity");
    return c.json({ deleted: true });
  });

  app.get("/api/points/summary", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const query = pointsSummaryQuerySchema.parse({ date: c.req.query("date") });
    if (query.date) dateOnlyTimestamp(query.date);
    return c.json(
      await productFeaturesRepository.getPointsSummary(userId, query.date),
    );
  });

  app.put("/api/points/goal", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const input = weeklyPointsGoalSchema.parse(
      await c.req.json().catch(() => undefined),
    );
    return c.json(
      await productFeaturesRepository.updateWeeklyGoal(userId, input.weeklyGoal),
    );
  });

  app.get("/api/memories", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const includeArchivedValue = c.req.query("includeArchived");
    const includeArchived = includeArchivedValue === undefined
      ? undefined
      : includeArchivedValue === "true"
        ? true
        : includeArchivedValue === "false"
          ? false
          : includeArchivedValue;
    const limitValue = c.req.query("limit");
    const input = listMemoriesInputSchema.parse({
      includeArchived,
      limit: limitValue === undefined ? undefined : Number(limitValue),
    });
    return c.json(await memoryRepository.list(userId, input));
  });

  app.post("/api/memories", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const input = createMemoryInputSchema.parse(
      await c.req.json().catch(() => undefined),
    );
    const memory = await memoryRepository.create(userId, input);
    if (!memory) throw new ResourceNotFoundError("source conversation");
    return c.json(memory, 201);
  });

  app.patch("/api/memories/:memoryId", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const memoryId = personalDataUserIdSchema.parse(c.req.param("memoryId"));
    const input = updateMemoryInputSchema.parse(
      await c.req.json().catch(() => undefined),
    );
    const result = await memoryRepository.update(userId, memoryId, input);
    if (!result) throw new ResourceNotFoundError("memory");
    return c.json(result);
  });

  app.delete("/api/memories/:memoryId", async (c) => {
    const userId = await requestUserId(c.req.raw);
    const memoryId = personalDataUserIdSchema.parse(c.req.param("memoryId"));
    const deleted = await memoryRepository.delete(userId, memoryId);
    if (!deleted) throw new ResourceNotFoundError("memory");
    return c.json({ deleted: true });
  });

  app.post("/api/agent/session", async (c) => {
    return withAgentTrafficGuard("session", c.req.raw, async () => {
      const requestedInput = createAgentSessionInputSchema.parse(await jsonBody(c));
      const identity = await resolveAgentRequestIdentity(
        () => authenticationService.resolveRequestUser(c.req.raw),
      );
      const input = {
        ...requestedInput,
        memoryUserId: remoteAgentMemoryUserId(identity.user),
      };
      const result = await createAgentSession(input);
      await agentSessionBindings.bindCreatedSession(
        result.sessionCode,
        agentSessionSubject(identity.user),
        identity.databaseUnavailable,
      );
      return c.json(result, 201);
    });
  });

  app.post("/api/agent/chat", async (c) => {
    return withAgentTrafficGuard("chat", c.req.raw, async () => {
      const input = runAgentInputSchema.parse(await jsonBody(c));
      const identity = await resolveAgentRequestIdentity(
        () => authenticationService.resolveRequestUser(c.req.raw),
      );
      const subject = agentSessionSubject(identity.user);
      const authorization = await agentSessionBindings.authorizeSession(
        input.sessionCode,
        subject,
        identity.databaseUnavailable,
      );
      const memories = authorization.bound
        ? await loadAgentMemoryContext(
          memoryRepository,
          identity.user?.userId,
          input.message,
        )
        : [];
      const result = await runAgent(input, { memories });
      await agentSessionBindings.bindReplacementSession(
        input.sessionCode,
        result.sessionCode,
        subject,
        identity.databaseUnavailable,
      );
      return c.json(result);
    });
  });

  app.post("/api/workflow/cycle", async (c) => {
    const input = cycleInputSchema.parse(await jsonBody(c));
    return c.json(calculateCycle(input));
  });

  app.all("/trpc/*", (c) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: trpcRouter,
      createContext: async () => {
        try {
          const user = await authenticationService.resolveRequestUser(c.req.raw);
          return {
            enforceResolvedUser: true,
            ...(user
              ? { resolvedUserId: user.userId, authType: user.authType }
              : {}),
          };
        } catch (error) {
          if (error instanceof DatabaseUnavailableError) {
            return {
              enforceResolvedUser: true,
              identityDatabaseUnavailable: true,
            };
          }
          throw error;
        }
      },
    }),
  );

  app.onError((error, c) => {
    if (error instanceof InvalidJsonBodyError) {
      return c.json({ error: "INVALID_JSON", message: "请求内容不是有效 JSON" }, 400);
    }
    if (error instanceof AgentTrafficLimitError) {
      c.header("Retry-After", String(error.retryAfterSeconds));
      return c.json({ error: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" }, 429);
    }
    if (error instanceof ZodError) {
      return c.json(
        { error: "INVALID_INPUT", message: "请求参数不正确", details: error.issues },
        400,
      );
    }
    if (error instanceof DateInputError) {
      return c.json(
        { error: "INVALID_INPUT", message: error.message },
        400,
      );
    }
    if (error instanceof DatabaseUnavailableError) {
      return c.json(
        { error: "DATABASE_UNAVAILABLE", message: "个人数据服务暂时不可用" },
        503,
      );
    }
    if (error instanceof AgentSessionRecreateRequiredError) {
      return c.json({ error: error.code, message: error.message }, 409);
    }
    if (error instanceof AgentSessionBindingUnavailableError) {
      return c.json({ error: error.code, message: error.message }, 503);
    }
    if (error instanceof ResourceNotFoundError) {
      return c.json({ error: "NOT_FOUND", message: error.message }, 404);
    }
    if (error instanceof ResourceConflictError) {
      return c.json({ error: "CONFLICT", message: error.message }, 409);
    }
    if (error instanceof AuthServiceError) {
      return c.json(
        { error: error.code, message: error.publicMessage },
        error.status,
      );
    }
    if (error instanceof OpenTrekError) {
      const status = error.status === 401 || error.status === 403 ? 502 : 503;
      return c.json(
        { error: "OPENTREK_ERROR", message: error.message, code: error.code },
        status,
      );
    }
    if (error instanceof OpenTrekConfigurationError) {
      return c.json(
        { error: "OPENTREK_UNAVAILABLE", message: "OpenTrek 在线服务尚未正确配置" },
        503,
      );
    }

    console.error(error);
    return c.json({ error: "INTERNAL_ERROR", message: "服务器内部错误" }, 500);
  });

  return app;
}

export const app = createApp();
