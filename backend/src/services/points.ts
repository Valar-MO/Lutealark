import type { PoolClient } from "pg";
import type { PointEventType } from "../contracts/product-features.js";

export const POINT_RULES = Object.freeze({
  checkin: 2,
  breathing: 3,
  pomodoro: 5,
  plan_item: 2,
  environment: 1,
  micro_movement: 2,
} satisfies Record<PointEventType, number>);

export const DAILY_POINT_LIMITS = Object.freeze({
  checkin: 1,
  breathing: 3,
  pomodoro: 6,
  plan_item: 3,
  environment: 3,
  micro_movement: 3,
} satisfies Record<PointEventType, number>);

export async function awardPoints(
  client: PoolClient,
  input: {
    userId: string;
    eventKey: string;
    type: PointEventType;
    sourceId: string;
    occurredAt: string;
  },
): Promise<number> {
  const points = POINT_RULES[input.type];
  // Serialize awards per user so concurrent offline retries cannot bypass caps.
  await client.query("SELECT id FROM app_users WHERE id = $1 FOR UPDATE", [
    input.userId,
  ]);
  const existing = await client.query(
    `SELECT 1 FROM point_events
     WHERE user_id = $1 AND event_key = $2`,
    [input.userId, input.eventKey],
  );
  if (existing.rowCount === 1) return 0;

  const awardedToday = await client.query<{ count: number | string }>(
    `SELECT count(*)::int AS count
     FROM point_events
     WHERE user_id = $1
       AND event_type = $2
       AND (occurred_at AT TIME ZONE 'Asia/Shanghai')::date
         = ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::date`,
    [input.userId, input.type, input.occurredAt],
  );
  if (Number(awardedToday.rows[0]?.count ?? 0) >= DAILY_POINT_LIMITS[input.type]) {
    return 0;
  }

  const result = await client.query(
    `INSERT INTO point_events
       (user_id, event_key, event_type, points, source_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
     ON CONFLICT (user_id, event_key) DO NOTHING
     RETURNING points`,
    [
      input.userId,
      input.eventKey,
      input.type,
      points,
      input.sourceId,
      input.occurredAt,
    ],
  );
  return result.rowCount === 1 ? points : 0;
}
