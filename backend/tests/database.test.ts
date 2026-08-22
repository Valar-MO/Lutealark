import { describe, expect, it } from "vitest";
import {
  DatabaseUnavailableError,
  isDatabaseUnavailableCause,
} from "../src/db/pool.js";

function errorWithCode(code: string): Error & { code: string } {
  return Object.assign(new Error("database test error"), { code });
}

describe("database availability error classification", () => {
  it.each([
    "08000",
    "08006",
    "53300",
    "57P01",
    "57P04",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EPIPE",
  ])("classifies %s as unavailable", (code) => {
    expect(isDatabaseUnavailableCause(errorWithCode(code))).toBe(true);
  });

  it("recognizes pg's unexpected socket termination error", () => {
    expect(
      isDatabaseUnavailableCause(new Error("Connection terminated unexpectedly")),
    ).toBe(true);
  });

  it.each(["22008", "23514", "40001", "40P01", "42601"])(
    "does not hide application or SQL error %s",
    (code) => {
      expect(isDatabaseUnavailableCause(errorWithCode(code))).toBe(false);
    },
  );

  it("recognizes an already sanitized database error", () => {
    expect(isDatabaseUnavailableCause(new DatabaseUnavailableError())).toBe(true);
  });
});
