const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_BUSINESS_TIME_ZONE = "Asia/Shanghai";

export class DateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DateInputError";
  }
}

export function businessDateOnly(
  now = new Date(),
  timeZone = DEFAULT_BUSINESS_TIME_ZONE,
): string {
  if (Number.isNaN(now.getTime())) {
    throw new DateInputError("无效的计算时间");
  }

  const parts = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type === "year" || type === "month" || type === "day")
      .map(({ type, value }) => [type, value]),
  );

  if (!values.year || !values.month || !values.day) {
    throw new Error(`Unable to calculate business date for ${timeZone}`);
  }

  return `${values.year}-${values.month}-${values.day}`;
}

export function dateOnlyTimestamp(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new DateInputError(`无效日期：${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new DateInputError(`无效日期：${value}`);
  }

  return timestamp;
}

export function calendarDayDifference(later: string, earlier: string): number {
  return Math.round((dateOnlyTimestamp(later) - dateOnlyTimestamp(earlier)) / DAY_MS);
}
