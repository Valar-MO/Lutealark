import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, setCookie } from "hono/cookie";
import { ZodError } from "zod";
import {
  deleteAccountInputSchema,
  loginInputSchema,
  registerInputSchema,
  type LoginInput,
  type RegisterInput,
} from "../contracts/auth.js";
import { personalDataUserIdSchema } from "../contracts/personal-data.js";
import { DatabaseUnavailableError } from "../db/pool.js";
import {
  AUTH_SESSION_COOKIE,
  AuthService,
  AuthServiceError,
  authService,
  isCapacitorClient,
  readBearerToken,
  readCookieValue,
  type AuthResult,
} from "../services/auth.js";

const KIB = 1024;

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface AuthRateLimits {
  loginByEmail: RateLimitRule;
  loginByClient: RateLimitRule;
  registerByEmail: RateLimitRule;
  registerByClient: RateLimitRule;
}

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = Object.freeze({
  loginByEmail: { limit: 10, windowMs: 15 * 60 * 1_000 },
  loginByClient: { limit: 60, windowMs: 15 * 60 * 1_000 },
  registerByEmail: { limit: 5, windowMs: 60 * 60 * 1_000 },
  registerByClient: { limit: 30, windowMs: 60 * 60 * 1_000 },
});

type RateBucket = { attempts: number; resetAt: number };

export class MemoryAuthRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 100) {
      throw new Error("maxEntries must be a safe integer of at least 100");
    }
  }

  consume(
    key: string,
    rule: RateLimitRule,
  ): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.makeRoom(now, key);
      bucket = { attempts: 0, resetAt: now + rule.windowMs };
      this.buckets.set(key, bucket);
    }
    if (bucket.attempts >= rule.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
      };
    }
    bucket.attempts += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private makeRoom(now: number, incomingKey: string): void {
    if (this.buckets.has(incomingKey) || this.buckets.size < this.maxEntries) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    while (this.buckets.size >= this.maxEntries) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.buckets.delete(oldestKey);
    }
  }
}

class AuthRouteError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 429,
    public readonly publicMessage: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(publicMessage);
    this.name = "AuthRouteError";
  }
}

export interface CreateAuthRoutesOptions {
  service?: AuthService;
  rateLimiter?: MemoryAuthRateLimiter;
  rateLimits?: AuthRateLimits;
  secureCookies?: boolean | ((request: Request) => boolean);
  clientKey?: (request: Request) => string;
}

function defaultClientKey(request: Request): string {
  // The bundled reverse proxies overwrite X-Real-IP. Do not trust provider-
  // specific headers supplied directly by a caller; that would let clients
  // rotate a forged value and bypass the per-client auth bucket.
  return request.headers.get("X-Real-IP") ?? "unknown-client";
}

function defaultSecureCookie(request: Request): boolean {
  const forwardedProtocol = request.headers
    .get("X-Forwarded-Proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  return new URL(request.url).protocol === "https:"
    || forwardedProtocol === "https"
    || process.env.NODE_ENV === "production";
}

function setSessionCookie(
  context: Parameters<typeof setCookie>[0],
  result: AuthResult,
  secure: boolean,
): void {
  const maxAge = Math.max(
    1,
    Math.floor((result.expiresAt.getTime() - Date.now()) / 1_000),
  );
  setCookie(context, AUTH_SESSION_COOKIE, result.sessionToken, {
    path: "/",
    httpOnly: true,
    sameSite: "Strict",
    secure,
    expires: result.expiresAt,
    maxAge,
    priority: "High",
  });
}

function clearSessionCookie(
  context: Parameters<typeof deleteCookie>[0],
  secure: boolean,
): void {
  deleteCookie(context, AUTH_SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    sameSite: "Strict",
    secure,
    priority: "High",
  });
}

async function jsonBody(context: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new AuthRouteError("INVALID_INPUT", 400, "请求参数不正确");
  }
}

function attachDeviceHeader<T extends RegisterInput | LoginInput>(
  input: T,
  request: Request,
): T {
  const rawHeader = request.headers.get("X-Lutealark-User-Id");
  if (!rawHeader) return input;
  const header = personalDataUserIdSchema.safeParse(rawHeader);
  if (!header.success) {
    throw new AuthRouteError("INVALID_INPUT", 400, "本机用户标识不正确");
  }
  if (input.deviceUserId && input.deviceUserId !== header.data) {
    throw new AuthRouteError("DEVICE_ID_MISMATCH", 400, "本机用户标识不一致");
  }
  return input.deviceUserId ? input : { ...input, deviceUserId: header.data };
}

function enforceRateLimit(
  limiter: MemoryAuthRateLimiter,
  checks: Array<[string, RateLimitRule]>,
): void {
  let retryAfter = 0;
  for (const [key, rule] of checks) {
    const result = limiter.consume(key, rule);
    if (!result.allowed) retryAfter = Math.max(retryAfter, result.retryAfterSeconds);
  }
  if (retryAfter > 0) {
    throw new AuthRouteError(
      "RATE_LIMITED",
      429,
      "尝试次数过多，请稍后再试",
      retryAfter,
    );
  }
}

export function createAuthRoutes(options: CreateAuthRoutesOptions = {}): Hono {
  const routes = new Hono();
  const service = options.service ?? authService;
  const limiter = options.rateLimiter ?? new MemoryAuthRateLimiter();
  const limits = options.rateLimits ?? DEFAULT_AUTH_RATE_LIMITS;
  const getClientKey = options.clientKey ?? defaultClientKey;
  const isSecure = typeof options.secureCookies === "function"
    ? options.secureCookies
    : options.secureCookies === undefined
      ? defaultSecureCookie
      : () => options.secureCookies as boolean;

  routes.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });
  routes.use(
    "*",
    bodyLimit({
      maxSize: 32 * KIB,
      onError: (c) => c.json(
        { error: "PAYLOAD_TOO_LARGE", message: "请求内容过大" },
        413,
      ),
    }),
  );

  routes.post("/register", async (c) => {
    const parsed = registerInputSchema.parse(await jsonBody(c));
    const input = attachDeviceHeader(parsed, c.req.raw);
    const client = getClientKey(c.req.raw);
    enforceRateLimit(limiter, [
      [`register:email:${input.email}`, limits.registerByEmail],
      [`register:client:${client}`, limits.registerByClient],
    ]);
    const result = await service.register(input);
    const nativeClient = isCapacitorClient(c.req.raw);
    if (!nativeClient) setSessionCookie(c, result, isSecure(c.req.raw));
    return c.json({
      authenticated: true as const,
      user: result.user,
      expiresAt: result.expiresAt.toISOString(),
      dataMerge: result.dataMerge,
      ...(nativeClient ? { accessToken: result.sessionToken } : {}),
    }, 201);
  });

  routes.post("/login", async (c) => {
    const parsed = loginInputSchema.parse(await jsonBody(c));
    const input = attachDeviceHeader(parsed, c.req.raw);
    const client = getClientKey(c.req.raw);
    enforceRateLimit(limiter, [
      [`login:email:${input.email}`, limits.loginByEmail],
      [`login:client:${client}`, limits.loginByClient],
    ]);
    const result = await service.login(input);
    const nativeClient = isCapacitorClient(c.req.raw);
    if (!nativeClient) setSessionCookie(c, result, isSecure(c.req.raw));
    return c.json({
      authenticated: true as const,
      user: result.user,
      expiresAt: result.expiresAt.toISOString(),
      dataMerge: result.dataMerge,
      ...(nativeClient ? { accessToken: result.sessionToken } : {}),
    });
  });

  routes.post("/logout", async (c) => {
    const bearer = readBearerToken(c.req.raw);
    const token = bearer.present
      ? bearer.token
      : readCookieValue(c.req.raw.headers.get("Cookie"), AUTH_SESSION_COOKIE);
    await service.logout(token);
    clearSessionCookie(c, isSecure(c.req.raw));
    return c.json({ authenticated: false as const });
  });

  routes.get("/export", async (c) => {
    const result = await service.exportAccountData(c.req.raw);
    const exportDate = result.exportedAt.slice(0, 10);
    c.header(
      "Content-Disposition",
      `attachment; filename="lutealark-data-${exportDate}.json"`,
    );
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
    c.header("X-Content-Type-Options", "nosniff");
    return c.json(result);
  });

  routes.delete("/account", async (c) => {
    const user = await service.requireAccountRequestUser(c.req.raw);
    const input = deleteAccountInputSchema.parse(await jsonBody(c));
    const client = getClientKey(c.req.raw);
    enforceRateLimit(limiter, [
      [`delete:account:${user.userId}`, limits.loginByEmail],
      [`delete:client:${client}`, limits.loginByClient],
    ]);
    await service.deleteAccount(user, input);
    clearSessionCookie(c, isSecure(c.req.raw));
    return c.json({ deleted: true as const });
  });

  routes.get("/me", async (c) => {
    const user = await service.resolveRequestUser(c.req.raw);
    if (!user) {
      return c.json({ authenticated: false as const, authType: "none" as const, user: null });
    }
    if (user.authType === "anonymous") {
      return c.json({
        authenticated: false as const,
        authType: "anonymous" as const,
        user: { userId: user.userId },
      });
    }
    return c.json({
      authenticated: true as const,
      authType: "account" as const,
      user: { userId: user.userId, email: user.email },
    });
  });

  routes.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json(
        { error: "INVALID_INPUT", message: "请求参数不正确", details: error.issues },
        400,
      );
    }
    if (error instanceof AuthRouteError) {
      if (error.retryAfterSeconds) {
        c.header("Retry-After", String(error.retryAfterSeconds));
      }
      return c.json(
        { error: error.code, message: error.publicMessage },
        error.status,
      );
    }
    if (error instanceof AuthServiceError) {
      return c.json(
        { error: error.code, message: error.publicMessage },
        error.status,
      );
    }
    if (error instanceof DatabaseUnavailableError) {
      return c.json(
        { error: "DATABASE_UNAVAILABLE", message: "账号服务暂时不可用" },
        503,
      );
    }
    // Do not log request bodies, passwords, session tokens, or database detail.
    return c.json({ error: "INTERNAL_ERROR", message: "服务器内部错误" }, 500);
  });

  return routes;
}

export const authRoutes = createAuthRoutes();
