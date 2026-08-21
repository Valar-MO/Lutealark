import "dotenv/config";
import { z } from "zod";

const optionalTrimmedString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().url().optional(),
);

const envSchema = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_SSL: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  OPENTREK_BASE_URL: optionalUrl,
  OPENTREK_APP_KEY: optionalTrimmedString,
  OPENTREK_AGENT_CODE: optionalTrimmedString,
  OPENTREK_AGENT_VERSION: optionalTrimmedString,
  OPENTREK_MODE: z.enum(["auto", "online", "offline"]).default("auto"),
  OPENTREK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  OPENTREK_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  OPENTREK_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(5_000)
    .default(250),
  // Comma-separated exact origins for native/cross-origin clients. An empty
  // value keeps the default same-origin deployment closed to CORS.
  CORS_ORIGINS: z.string().default(""),
});

export const env = envSchema.parse(process.env);

export function parseCorsOrigins(value: string = env.CORS_ORIGINS): string[] {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.origin !== origin
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash) {
      throw new Error(`CORS_ORIGINS must contain exact HTTP(S) origins: ${origin}`);
    }
  }
  return [...new Set(origins)];
}

export const corsOrigins = parseCorsOrigins();

export function openTrekHealth() {
  const configured = Boolean(
    env.OPENTREK_BASE_URL
      && env.OPENTREK_APP_KEY
      && env.OPENTREK_AGENT_CODE
      && env.OPENTREK_AGENT_VERSION,
  );
  return {
    mode: env.OPENTREK_MODE,
    configured,
    agentVersion: env.OPENTREK_AGENT_VERSION ?? null,
    // This is a configuration signal, not a claim that the VPN gateway has
    // answered. A real session request is the connectivity check.
    status: env.OPENTREK_MODE === "offline"
      ? "disabled"
      : configured
        ? "ready"
        : "misconfigured",
  } as const;
}

export function requireOpenTrekConfig() {
  const missing = [
    ["OPENTREK_BASE_URL", env.OPENTREK_BASE_URL],
    ["OPENTREK_APP_KEY", env.OPENTREK_APP_KEY],
    ["OPENTREK_AGENT_CODE", env.OPENTREK_AGENT_CODE],
    ["OPENTREK_AGENT_VERSION", env.OPENTREK_AGENT_VERSION],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`OpenTrek configuration is missing: ${missing.join(", ")}`);
  }

  return {
    baseUrl: env.OPENTREK_BASE_URL!.replace(/\/$/, ""),
    appKey: env.OPENTREK_APP_KEY!,
    agentCode: env.OPENTREK_AGENT_CODE!,
    agentVersion: env.OPENTREK_AGENT_VERSION!,
    timeoutMs: env.OPENTREK_TIMEOUT_MS,
    runTimeoutMs: env.OPENTREK_RUN_TIMEOUT_MS,
    retryDelayMs: env.OPENTREK_RETRY_DELAY_MS,
  };
}
