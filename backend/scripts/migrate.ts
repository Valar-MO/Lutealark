import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { getDatabasePool, closeDatabasePool } from "../src/db/pool.js";

const migrationsDirectory = new URL("../migrations/", import.meta.url);
const pool = getDatabasePool();
let client: PoolClient | undefined;

try {
  client = await pool.connect();
  await client.query(
    "SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtext('lutealark_schema_migrations'))",
  );
  await client.query(
    "SELECT pg_catalog.set_config('search_path', 'public, pg_catalog', false)",
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text",
  );

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsDirectory), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const applied = await client.query<{ checksum: string | null }>(
      "SELECT checksum FROM schema_migrations WHERE name = $1",
      [file],
    );
    if (applied.rows[0]) {
      if (applied.rows[0].checksum && applied.rows[0].checksum !== checksum) {
        throw new Error(`Migration checksum mismatch: ${file}`);
      }
      if (!applied.rows[0].checksum) {
        await client.query(
          "UPDATE schema_migrations SET checksum = $2 WHERE name = $1",
          [file, checksum],
        );
      }
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
        [file, checksum],
      );
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
} finally {
  if (client) {
    await client
      .query(
        "SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtext('lutealark_schema_migrations'))",
      )
      .catch(() => undefined);
    client.release();
  }
  await closeDatabasePool();
}
