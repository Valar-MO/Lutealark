import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

export const CORS_ALLOW_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

export const CORS_ALLOW_HEADERS = [
  "Content-Type",
  "X-Lutealark-User-Id",
] as const;

export function createCorsMiddleware(
  configuredOrigins: readonly string[],
): MiddlewareHandler {
  const allowedOrigins = new Set(configuredOrigins);
  const isAllowed = (origin: string, requestUrl: string) =>
    allowedOrigins.has(origin) || origin === new URL(requestUrl).origin;
  const applyCors = cors({
    origin: (origin, context) => isAllowed(origin, context.req.url) ? origin : null,
    allowMethods: [...CORS_ALLOW_METHODS],
    allowHeaders: [...CORS_ALLOW_HEADERS],
    exposeHeaders: ["Content-Disposition", "Retry-After"],
    credentials: true,
    maxAge: 600,
  });

  return async (context, next) => {
    const origin = context.req.header("Origin");
    if (origin && !isAllowed(origin, context.req.url)) {
      context.header("Vary", "Origin");
      return context.json(
        { error: "CORS_ORIGIN_DENIED", message: "请求来源不在允许列表中" },
        403,
      );
    }
    return applyCors(context, next);
  };
}
