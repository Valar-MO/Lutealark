import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { ZodError } from "zod";
import {
  createOpenTrekSession,
  OpenTrekError,
  runOpenTrekAgent,
} from "./clients/opentrek.js";
import {
  createAgentSessionInputSchema,
  runAgentInputSchema,
} from "./contracts/agent.js";
import { cycleInputSchema } from "./contracts/cycle.js";
import { calculateCycle } from "./services/cycle.js";
import { appRouter } from "./trpc/router.js";

export const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  const contentType = c.res.headers.get("Content-Type");
  if (contentType?.toLowerCase() === "application/json") {
    c.res.headers.set("Content-Type", "application/json; charset=utf-8");
  }
});

app.get("/", (c) =>
  c.json({
    status: "ok",
    service: "lutealark-backend",
    message: "Lutealark backend is running",
    endpoints: {
      health: "GET /health",
      createAgentSession: "POST /api/agent/session",
      runAgent: "POST /api/agent/chat",
      calculateCycle: "POST /api/workflow/cycle",
      trpc: "/trpc/*",
    },
  }),
);

app.get("/health", (c) =>
  c.json({ status: "ok", service: "lutealark-backend" }),
);

app.post("/api/agent/session", async (c) => {
  const input = createAgentSessionInputSchema.parse(await c.req.json().catch(() => ({})));
  const result = await createOpenTrekSession(input);
  return c.json(result, 201);
});

app.post("/api/agent/chat", async (c) => {
  const input = runAgentInputSchema.parse(await c.req.json());
  const result = await runOpenTrekAgent(input);
  return c.json(result);
});

app.post("/api/workflow/cycle", async (c) => {
  const input = cycleInputSchema.parse(await c.req.json());
  return c.json(calculateCycle(input));
});

app.all("/trpc/*", (c) =>
  fetchRequestHandler({
    endpoint: "/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({}),
  }),
);

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json(
      { error: "INVALID_INPUT", message: "请求参数不正确", details: error.issues },
      400,
    );
  }
  if (error instanceof OpenTrekError) {
    const status = error.status === 401 || error.status === 403 ? 502 : 503;
    return c.json(
      { error: "OPENTREK_ERROR", message: error.message, code: error.code },
      status,
    );
  }

  console.error(error);
  return c.json({ error: "INTERNAL_ERROR", message: "服务器内部错误" }, 500);
});
