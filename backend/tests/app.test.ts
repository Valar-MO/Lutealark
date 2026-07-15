import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";

describe("HTTP responses", () => {
  it("declares UTF-8 for JSON responses", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
  });
});
