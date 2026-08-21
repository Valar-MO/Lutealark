import { Pool, type PoolClient } from "pg";
import { env } from "../config/env.js";

export class DatabaseUnavailableError extends Error {
  constructor(
    message = "PostgreSQL is not configured or unavailable",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DatabaseUnavailableError";
  }
}

let pool: Pool | null = null;

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
]);

export function isDatabaseUnavailableCause(error: unknown): boolean {
  if (error instanceof DatabaseUnavailableError) return true;
  if (!(error instanceof Error)) return false;
  if (error.message === "Connection terminated unexpectedly") return true;
  if (!("code" in error)) return false;
  const code = String(error.code);
  return NETWORK_ERROR_CODES.has(code)
    || code.startsWith("08")
    || ["53300", "57P01", "57P02", "57P03", "57P04"].includes(code);
}

export function getDatabasePool(): Pool {
  if (!env.DATABASE_URL) {
    throw new DatabaseUnavailableError("DATABASE_URL is not configured");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL,
      max: env.DATABASE_POOL_MAX,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", () => {
      // Individual requests surface a sanitized DatabaseUnavailableError.
    });
  }
  return pool;
}

export async function withDatabaseClient<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient;
  try {
    client = await getDatabasePool().connect();
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(undefined, { cause: error });
  }

  let releaseError: Error | undefined;
  try {
    return await operation(client);
  } catch (error) {
    if (isDatabaseUnavailableCause(error)) {
      releaseError = error instanceof Error ? error : new Error(String(error));
      throw new DatabaseUnavailableError(undefined, { cause: error });
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

export async function closeDatabasePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
