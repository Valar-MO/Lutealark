import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OPENTREK_BASE_URL: z
    .string()
    .url()
    .default(
      "http://10.128.203.200:80/sfm-agent-studio/sfm-api-gateway/gateway/agent/api",
    ),
  OPENTREK_APP_KEY: z.string().min(1).optional(),
  OPENTREK_AGENT_CODE: z.string().min(1).optional(),
  OPENTREK_AGENT_VERSION: z.string().min(1).optional(),
  OPENTREK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  OPENTREK_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
});

export const env = envSchema.parse(process.env);

export function requireOpenTrekConfig() {
  const missing = [
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
    baseUrl: env.OPENTREK_BASE_URL.replace(/\/$/, ""),
    appKey: env.OPENTREK_APP_KEY!,
    agentCode: env.OPENTREK_AGENT_CODE!,
    agentVersion: env.OPENTREK_AGENT_VERSION!,
    timeoutMs: env.OPENTREK_TIMEOUT_MS,
    runTimeoutMs: env.OPENTREK_RUN_TIMEOUT_MS,
  };
}
