import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { breathingRecordSchema } from "../src/contracts/personal-data.js";
import { upsertActivityInputSchema } from "../src/contracts/product-features.js";
import {
  awardPoints,
  DAILY_POINT_LIMITS,
  POINT_RULES,
} from "../src/services/points.js";

function fakeClient(results: Array<{ rowCount: number; rows: unknown[] }>) {
  const query = vi.fn(async (..._args: unknown[]) =>
    results.shift() ?? { rowCount: 0, rows: [] }
  );
  return { query } as unknown as PoolClient & { query: typeof query };
}

describe("server-derived points", () => {
  it("keeps reward values and daily caps on the server", () => {
    expect(POINT_RULES).toEqual({
      checkin: 2,
      breathing: 3,
      pomodoro: 5,
      plan_item: 2,
      environment: 1,
      micro_movement: 2,
    });
    expect(DAILY_POINT_LIMITS).toEqual({
      checkin: 1,
      breathing: 3,
      pomodoro: 6,
      plan_item: 3,
      environment: 3,
      micro_movement: 3,
    });
  });

  it("returns zero before inserting when an event key already exists", async () => {
    const client = fakeClient([
      { rowCount: 1, rows: [{ id: "user" }] },
      { rowCount: 1, rows: [{ exists: 1 }] },
    ]);

    await expect(awardPoints(client, {
      userId: "c598fcc4-98d4-4f66-b526-65d6ba73adaf",
      eventKey: "activity:one",
      type: "pomodoro",
      sourceId: "one",
      occurredAt: "2026-08-11T01:00:00.000Z",
    })).resolves.toBe(0);
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("returns zero when the daily cap has been reached", async () => {
    const client = fakeClient([
      { rowCount: 1, rows: [{ id: "user" }] },
      { rowCount: 0, rows: [] },
      { rowCount: 1, rows: [{ count: 3 }] },
    ]);

    await expect(awardPoints(client, {
      userId: "c598fcc4-98d4-4f66-b526-65d6ba73adaf",
      eventKey: "breathing:new",
      type: "breathing",
      sourceId: "new",
      occurredAt: "2026-08-11T01:00:00.000Z",
    })).resolves.toBe(0);
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it("awards only the fixed amount after locking and checking the cap", async () => {
    const client = fakeClient([
      { rowCount: 1, rows: [{ id: "user" }] },
      { rowCount: 0, rows: [] },
      { rowCount: 1, rows: [{ count: 0 }] },
      { rowCount: 1, rows: [{ points: 1 }] },
    ]);

    await expect(awardPoints(client, {
      userId: "c598fcc4-98d4-4f66-b526-65d6ba73adaf",
      eventKey: "activity:env",
      type: "environment",
      sourceId: "env",
      occurredAt: "2026-08-11T01:00:00.000Z",
    })).resolves.toBe(1);
    const insertParameters = client.query.mock.calls[3]?.[1];
    expect(insertParameters).toEqual(expect.arrayContaining(["environment", 1]));
  });

  it("rejects activity and breathing completion times over five minutes ahead", () => {
    const future = new Date(Date.now() + 6 * 60 * 1000).toISOString();
    expect(upsertActivityInputSchema.safeParse({
      type: "pomodoro",
      completedAt: future,
    }).success).toBe(false);
    expect(breathingRecordSchema.safeParse({
      id: "934fb086-2917-465b-933f-bbb5a1b96081",
      modeId: "box",
      modeName: "方块呼吸",
      completedAt: future,
      durationSeconds: 120,
      rating: null,
    }).success).toBe(false);
  });
});
