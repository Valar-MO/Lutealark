import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AuthRepository } from "../src/repositories/auth.js";
import { AuthService } from "../src/services/auth.js";
import type { MemoryRepository } from "../src/repositories/memory.js";
import type { PersonalDataRepository } from "../src/repositories/personal-data.js";
import type { ProductFeaturesRepository } from "../src/repositories/product-features.js";
import { createAppRouter } from "../src/trpc/router.js";

const ACCOUNT_USER_ID = "a77e8c50-57cf-4a23-8bf5-7a1fd92d31a5";
const SPOOFED_USER_ID = "b745bace-bdb6-47aa-8897-2c90cad1705c";

function dependencies() {
  const getPointsSummary = vi.fn(async () => ({
    weekStart: "2026-08-10",
    weekEnd: "2026-08-16",
    weeklyGoal: 30,
    weeklyPoints: 0,
    totalPoints: 0,
    remainingPoints: 30,
    breakdown: {
      checkin: 0,
      breathing: 0,
      pomodoro: 0,
      plan_item: 0,
      environment: 0,
      micro_movement: 0,
    },
    recentEvents: [],
  }));
  return {
    getPointsSummary,
    router: createAppRouter({
      personalDataRepository: {} as PersonalDataRepository,
      productFeaturesRepository: {
        getPointsSummary,
      } as unknown as ProductFeaturesRepository,
      memoryRepository: {} as MemoryRepository,
    }),
  };
}

describe("tRPC identity binding", () => {
  it("rejects registered or claimed UUID headers and accepts an unclaimed UUID", async () => {
    const getPointsSummary = vi.fn(async () => ({
      weekStart: "2026-08-10",
      weekEnd: "2026-08-16",
      weeklyGoal: 30,
      weeklyPoints: 0,
      totalPoints: 0,
      remainingPoints: 30,
      breakdown: {
        checkin: 0,
        breathing: 0,
        pomodoro: 0,
        plan_item: 0,
        environment: 0,
        micro_movement: 0,
      },
      recentEvents: [],
    }));
    const registeredId = ACCOUNT_USER_ID;
    const claimedId = SPOOFED_USER_ID;
    const unclaimedId = "934fb086-2917-465b-933f-bbb5a1b96081";
    const authRepository = {
      findAccountByEmail: async () => null,
      findAccountByUserId: async () => null,
      isAnonymousUserIdAvailable: async (userId: string) => (
        userId !== registeredId && userId !== claimedId
      ),
      registerAccount: async () => "no_device" as const,
      createAccountSession: async () => "no_device" as const,
      findActiveSession: async () => null,
      deleteSession: async () => undefined,
      getAccountData: async () => null,
      deleteAccount: async () => false,
    } satisfies AuthRepository;
    const app = createApp({
      personalDataRepository: {} as PersonalDataRepository,
      productFeaturesRepository: { getPointsSummary } as unknown as ProductFeaturesRepository,
      authenticationService: new AuthService(authRepository),
    });
    const request = (userId: string) => app.request(
      `/trpc/points.summary?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      {
      headers: {
        "X-Lutealark-User-Id": userId,
      },
      },
    );

    for (const blockedId of [registeredId, claimedId]) {
      const response = await request(blockedId);
      expect(response.status).toBe(401);
    }
    const accepted = await request(unclaimedId);
    expect(accepted.status).toBe(200);
    expect(getPointsSummary).toHaveBeenCalledWith(unclaimedId, undefined);
  });

  it("uses the authenticated request identity instead of a payload UUID", async () => {
    const { router, getPointsSummary } = dependencies();
    const caller = router.createCaller({
      resolvedUserId: ACCOUNT_USER_ID,
      authType: "account",
      enforceResolvedUser: true,
    });

    await caller.points.summary({ userId: SPOOFED_USER_ID });

    expect(getPointsSummary).toHaveBeenCalledWith(ACCOUNT_USER_ID, undefined);
  });

  it("rejects private HTTP-style calls without a resolved identity", async () => {
    const { router } = dependencies();
    const caller = router.createCaller({ enforceResolvedUser: true });

    await expect(caller.points.summary({ userId: SPOOFED_USER_ID }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("degrades only agent chat when identity PostgreSQL is unavailable", async () => {
    const { router, getPointsSummary } = dependencies();
    const caller = router.createCaller({
      enforceResolvedUser: true,
      identityDatabaseUnavailable: true,
    });

    await expect(caller.agent.chat({
      sessionCode: "offline:c598fcc4-98d4-4f66-b526-65d6ba73adaf",
      message: "论文完全开始不了",
      metadata: {},
      attachments: [],
    })).resolves.toMatchObject({
      metadata: { intent: "task_difficulty", sources: [] },
    });
    await expect(caller.points.summary({ userId: SPOOFED_USER_ID }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(getPointsSummary).not.toHaveBeenCalled();
  });
});
