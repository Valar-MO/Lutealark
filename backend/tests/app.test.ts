import { describe, expect, it, vi } from "vitest";
import { app, createApp } from "../src/app.js";
import { env, parseCorsOrigins } from "../src/config/env.js";
import type { PersonalDataSnapshot } from "../src/contracts/personal-data.js";
import { DatabaseUnavailableError } from "../src/db/pool.js";
import type { PersonalDataRepository } from "../src/repositories/personal-data.js";

const USER_ID = "c598fcc4-98d4-4f66-b526-65d6ba73adaf";
const BREATHING_ID = "934fb086-2917-465b-933f-bbb5a1b96081";

const emptySnapshot: PersonalDataSnapshot = {
  cycleSettings: null,
  cycleEvents: [],
  dailyCheckins: [],
  breathingRecords: [],
};

function makeRepository(
  overrides: Partial<PersonalDataRepository> = {},
): PersonalDataRepository {
  const repository: PersonalDataRepository = {
    getPersonalData: vi.fn(async () => emptySnapshot),
    upsertCycleSettings: vi.fn(async (_userId, settings) => settings),
    recordCycleEvent: vi.fn(async (_userId, event) => ({ event, cycleSettings: null })),
    upsertDailyCheckin: vi.fn(async (_userId, checkin) => checkin),
    deleteDailyCheckin: vi.fn(async () => true),
    upsertBreathingRecord: vi.fn(async (_userId, record) => record),
    deleteBreathingRecord: vi.fn(async () => true),
    checkHealth: vi.fn(async () => undefined),
  };
  return { ...repository, ...overrides };
}

describe("HTTP responses", () => {
  it("parses only exact HTTP(S) origins from CORS_ORIGINS", () => {
    expect(parseCorsOrigins(" https://localhost,https://api.example.com ")).toEqual([
      "https://localhost",
      "https://api.example.com",
    ]);
    expect(() => parseCorsOrigins("https://api.example.com/path")).toThrow(
      "must contain exact HTTP(S) origins",
    );
    expect(() => parseCorsOrigins("ftp://localhost")).toThrow(
      "must contain exact HTTP(S) origins",
    );
  });

  it("allows a configured local development origin and its headers", async () => {
    const testApp = createApp({
      personalDataRepository: makeRepository(),
      corsOrigins: ["https://localhost"],
    });
    const response = await testApp.request("/api/auth/me", {
      method: "OPTIONS",
      headers: {
        Origin: "https://localhost",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": [
          "Content-Type",
          "X-Lutealark-User-Id",
        ].join(", "),
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-Lutealark-User-Id");
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("rejects preflight from an origin outside the exact allowlist", async () => {
    const testApp = createApp({
      personalDataRepository: makeRepository(),
      corsOrigins: ["https://localhost"],
    });
    const response = await testApp.request("/api/auth/me", {
      method: "OPTIONS",
      headers: {
        Origin: "https://localhost.attacker.example",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Lutealark-User-Id",
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ error: "CORS_ORIGIN_DENIED" });
  });

  it("rejects an actual request from a non-allowed Origin before routing", async () => {
    const repository = makeRepository();
    const testApp = createApp({
      personalDataRepository: repository,
      corsOrigins: ["https://localhost"],
    });
    const response = await testApp.request("/health/database", {
      headers: { Origin: "https://attacker.example" },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(repository.checkHealth).not.toHaveBeenCalled();
  });

  it.each([
    { origin: "http://localhost", expectedHeader: "http://localhost" },
    { origin: undefined, expectedHeader: null },
  ])("allows same-origin and Origin-less local requests", async ({ origin, expectedHeader }) => {
    const testApp = createApp({ personalDataRepository: makeRepository(), corsOrigins: [] });
    const response = await testApp.request("http://localhost/health", {
      headers: origin ? { Origin: origin } : undefined,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(expectedHeader);
  });

  it("declares UTF-8 for JSON responses", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
  });

  it("rejects oversized API request bodies before processing them", async () => {
    const response = await app.request("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(300_000) }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "PAYLOAD_TOO_LARGE",
      message: "请求内容过大",
    });
  });

  it("applies the same request body limit to tRPC", async () => {
    const response = await app.request("/trpc/unknown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(300_000) }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "PAYLOAD_TOO_LARGE" });
  });

  it.each([
    "/api/agent/session",
    "/api/agent/chat",
    "/api/workflow/cycle",
  ])("returns 400 for malformed JSON at %s", async (path) => {
    const testApp = createApp({ personalDataRepository: makeRepository() });
    const response = await testApp.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_JSON",
      message: "请求内容不是有效 JSON",
    });
  });

  it("returns 429 with Retry-After when the public Agent guard denies work", async () => {
    const testApp = createApp({
      personalDataRepository: makeRepository(),
      agentTrafficGuard: {
        enter: () => ({ allowed: false, retryAfterSeconds: 7 }),
      },
    });
    const response = await testApp.request("/api/agent/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("7");
    await expect(response.json()).resolves.toMatchObject({ error: "RATE_LIMITED" });
  });

  it("releases Agent concurrency capacity when request processing fails", async () => {
    const release = vi.fn();
    const testApp = createApp({
      personalDataRepository: makeRepository(),
      agentTrafficGuard: {
        enter: () => ({ allowed: true, release }),
      },
    });
    const response = await testApp.request("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns 503 when online mode lacks required OpenTrek configuration", async () => {
    const original = {
      mode: env.OPENTREK_MODE,
      baseUrl: env.OPENTREK_BASE_URL,
      appKey: env.OPENTREK_APP_KEY,
      agentCode: env.OPENTREK_AGENT_CODE,
      agentVersion: env.OPENTREK_AGENT_VERSION,
    };
    env.OPENTREK_MODE = "online";
    env.OPENTREK_BASE_URL = undefined;
    env.OPENTREK_APP_KEY = undefined;
    env.OPENTREK_AGENT_CODE = undefined;
    env.OPENTREK_AGENT_VERSION = undefined;
    try {
      const testApp = createApp({ personalDataRepository: makeRepository() });
      const response = await testApp.request("/api/agent/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "OPENTREK_UNAVAILABLE",
        message: "OpenTrek 在线服务尚未正确配置",
      });
    } finally {
      env.OPENTREK_MODE = original.mode;
      env.OPENTREK_BASE_URL = original.baseUrl;
      env.OPENTREK_APP_KEY = original.appKey;
      env.OPENTREK_AGENT_CODE = original.agentCode;
      env.OPENTREK_AGENT_VERSION = original.agentVersion;
    }
  });

  it.each([
    {
      lastPeriodDate: "2026-02-30",
      cycleLength: 28,
      today: "2026-03-01",
    },
    {
      lastPeriodDate: "2026-07-14",
      cycleLength: 28,
      today: "2026-07-13",
    },
  ])("returns 400 for invalid or future cycle dates", async (input) => {
    const response = await app.request("/api/workflow/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "INVALID_INPUT",
    });
  });

  it("keeps the basic health check independent from PostgreSQL", async () => {
    const repository = makeRepository({
      checkHealth: vi.fn(async () => {
        throw new DatabaseUnavailableError();
      }),
    });
    const testApp = createApp({ personalDataRepository: repository });

    const response = await testApp.request("/health");

    expect(response.status).toBe(200);
    expect(repository.checkHealth).not.toHaveBeenCalled();
  });

  it("exposes OpenTrek mode and configuration health without secrets", async () => {
    const testApp = createApp({ personalDataRepository: makeRepository() });
    const response = await testApp.request("/health/opentrek");

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      mode: expect.stringMatching(/^(auto|online|offline)$/),
      configured: expect.any(Boolean),
      status: expect.stringMatching(/^(ready|disabled|misconfigured)$/),
    });
    expect(body).not.toHaveProperty("appKey");
  });

  it("checks PostgreSQL only on the database health endpoint", async () => {
    const repository = makeRepository();
    const testApp = createApp({ personalDataRepository: repository });

    const response = await testApp.request("/health/database");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "lutealark-database",
    });
    expect(repository.checkHealth).toHaveBeenCalledOnce();
  });

  it.each([undefined, "not-a-uuid"])(
    "requires a valid account session or anonymous personal-data identity",
    async (header) => {
      const repository = makeRepository();
      const testApp = createApp({ personalDataRepository: repository });
      const headers = header ? { "X-Lutealark-User-Id": header } : undefined;

      const response = await testApp.request("/api/personal-data", { headers });

      expect(response.status).toBe(401);
      expect(repository.getPersonalData).not.toHaveBeenCalled();
    },
  );

  it("returns the complete personal-data snapshot", async () => {
    const snapshot: PersonalDataSnapshot = {
      cycleSettings: { lastPeriodDate: "2026-08-01", cycleLength: 28 },
      cycleEvents: [{ date: "2026-08-01", type: "period_start" }],
      dailyCheckins: [{
        date: "2026-08-09",
        energy: 2,
        mood: "anxious",
        bodyState: ["疲惫"],
        note: "需要慢一点",
        shareWithChat: true,
      }],
      breathingRecords: [{
        id: BREATHING_ID,
        modeId: "box",
        modeName: "方块呼吸",
        completedAt: "2026-08-09T02:00:00.000Z",
        durationSeconds: 120,
        rating: 4,
      }],
    };
    const repository = makeRepository({
      getPersonalData: vi.fn(async () => snapshot),
    });
    const testApp = createApp({ personalDataRepository: repository });

    const response = await testApp.request("/api/personal-data", {
      headers: { "X-Lutealark-User-Id": USER_ID },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(repository.getPersonalData).toHaveBeenCalledWith(USER_ID);
  });

  it("upserts cycle settings for the header user", async () => {
    const repository = makeRepository();
    const testApp = createApp({ personalDataRepository: repository });
    const input = { lastPeriodDate: "2026-08-01", cycleLength: 28 };

    const response = await testApp.request("/api/personal-data/cycle", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Lutealark-User-Id": USER_ID,
      },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(input);
    expect(repository.upsertCycleSettings).toHaveBeenCalledWith(USER_ID, input);
  });

  it("upserts a complete daily check-in", async () => {
    const repository = makeRepository();
    const testApp = createApp({ personalDataRepository: repository });
    const input = {
      date: "2026-08-09",
      energy: 3,
      mood: "calm",
      bodyState: ["疲惫"],
      note: "今天稳一些",
      shareWithChat: true,
    };

    const response = await testApp.request("/api/personal-data/checkin", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Lutealark-User-Id": USER_ID,
      },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(input);
    expect(repository.upsertDailyCheckin).toHaveBeenCalledWith(USER_ID, input);
  });

  it("upserts a breathing record including its nullable rating", async () => {
    const repository = makeRepository();
    const testApp = createApp({ personalDataRepository: repository });
    const input = {
      id: BREATHING_ID,
      modeId: "box",
      modeName: "方块呼吸",
      completedAt: "2026-08-09T02:00:00.000Z",
      durationSeconds: 120,
      rating: null,
    };

    const response = await testApp.request("/api/personal-data/breathing", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Lutealark-User-Id": USER_ID,
      },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(input);
    expect(repository.upsertBreathingRecord).toHaveBeenCalledWith(USER_ID, input);
  });

  it("deletes a daily check-in by date", async () => {
    const repository = makeRepository();
    const testApp = createApp({ personalDataRepository: repository });

    const response = await testApp.request("/api/personal-data/checkin/2026-08-09", {
      method: "DELETE",
      headers: { "X-Lutealark-User-Id": USER_ID },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(repository.deleteDailyCheckin).toHaveBeenCalledWith(USER_ID, "2026-08-09");
  });

  it("deletes a breathing record by id", async () => {
    const repository = makeRepository();
    const testApp = createApp({ personalDataRepository: repository });

    const response = await testApp.request(`/api/personal-data/breathing/${BREATHING_ID}`, {
      method: "DELETE",
      headers: { "X-Lutealark-User-Id": USER_ID },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(repository.deleteBreathingRecord).toHaveBeenCalledWith(USER_ID, BREATHING_ID);
  });

  it.each([
    {
      path: "/api/personal-data/checkin/2026-08-09",
      repositoryMethod: "deleteDailyCheckin" as const,
    },
    {
      path: `/api/personal-data/breathing/${BREATHING_ID}`,
      repositoryMethod: "deleteBreathingRecord" as const,
    },
  ])("returns 404 when the personal record to delete does not exist", async ({
    path,
    repositoryMethod,
  }) => {
    const repository = makeRepository({
      [repositoryMethod]: vi.fn(async () => false),
    });
    const testApp = createApp({ personalDataRepository: repository });

    const response = await testApp.request(path, {
      method: "DELETE",
      headers: { "X-Lutealark-User-Id": USER_ID },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "NOT_FOUND" });
  });

  it.each([
    {
      path: "/api/personal-data/checkin/2026-02-30",
      repositoryMethod: "deleteDailyCheckin" as const,
    },
    {
      path: "/api/personal-data/breathing/not-a-uuid",
      repositoryMethod: "deleteBreathingRecord" as const,
    },
  ])("rejects an invalid personal-record delete identifier", async ({
    path,
    repositoryMethod,
  }) => {
    const repository = makeRepository();
    const testApp = createApp({ personalDataRepository: repository });

    const response = await testApp.request(path, {
      method: "DELETE",
      headers: { "X-Lutealark-User-Id": USER_ID },
    });

    expect(response.status).toBe(400);
    expect(repository[repositoryMethod]).not.toHaveBeenCalled();
  });

  it("rejects invalid personal data before calling the repository", async () => {
    const repository = makeRepository();
    const testApp = createApp({ personalDataRepository: repository });

    const response = await testApp.request("/api/personal-data/cycle", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Lutealark-User-Id": USER_ID,
      },
      body: JSON.stringify({ lastPeriodDate: "2026-08-01", cycleLength: 12 }),
    });

    expect(response.status).toBe(400);
    expect(repository.upsertCycleSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/personal-data/cycle", {
      lastPeriodDate: "2026-02-30",
      cycleLength: 28,
    }, "upsertCycleSettings"],
    ["/api/personal-data/cycle", {
      lastPeriodDate: "9999-12-31",
      cycleLength: 28,
    }, "upsertCycleSettings"],
    ["/api/personal-data/checkin", {
      date: "2026-02-30",
      energy: 3,
      mood: "calm",
      bodyState: [],
      shareWithChat: true,
    }, "upsertDailyCheckin"],
  ] as const)(
    "rejects a semantically invalid personal-data date",
    async (path, input, repositoryMethod) => {
      const repository = makeRepository();
      const testApp = createApp({ personalDataRepository: repository });

      const response = await testApp.request(path, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Lutealark-User-Id": USER_ID,
        },
        body: JSON.stringify(input),
      });

      expect(response.status).toBe(400);
      expect(repository[repositoryMethod]).not.toHaveBeenCalled();
    },
  );

  it.each(["/health/database", "/api/personal-data"])(
    "returns a sanitized 503 when PostgreSQL is unavailable",
    async (path) => {
      const connectionSecret = "postgresql://secret-user:secret-password@db/internal";
      const unavailable = async () => {
        throw new DatabaseUnavailableError(connectionSecret);
      };
      const repository = makeRepository({
        checkHealth: vi.fn(unavailable),
        getPersonalData: vi.fn(unavailable),
      });
      const testApp = createApp({ personalDataRepository: repository });

      const response = await testApp.request(path, {
        headers: { "X-Lutealark-User-Id": USER_ID },
      });
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(JSON.parse(body)).toEqual({
        error: "DATABASE_UNAVAILABLE",
        message: "个人数据服务暂时不可用",
      });
      expect(body).not.toContain(connectionSecret);
      expect(body).not.toContain("secret-password");
    },
  );
});
