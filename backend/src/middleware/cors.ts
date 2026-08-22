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
  "Authorization",
  "Content-Type",
  "X-Lutealark-Client",
  "X-Lutealark-User-Id",
] as const;

export function createCorsMiddleware(
  configuredOrigins: readonly string[],
): MiddlewareHandler {
  const allowedOrigins = new Set(configuredOrigins);
  const applyCors = cors({
    origin: (origin) => allowedOrigins.has(origin) ? origin : null,
    allowMethods: [...CORS_ALLOW_METHODS],
    allowHeaders: [...CORS_ALLOW_HEADERS],
    exposeHeaders: ["Content-Disposition", "Retry-After"],
    credentials: true,
    maxAge: 600,
  });

  return async (context, next) => {
    const origin = context.req.header("Origin");
    if (context.req.method === "OPTIONS" && origin && !allowedOrigins.has(origin)) {
      context.header("Vary", "Origin");
      return context.json(
        { error: "CORS_ORIGIN_DENIED", message: "请求来源不在允许列表中" },
        403,
      );
    }
    return applyCors(context, next);
  };
}
