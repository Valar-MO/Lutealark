import { describe, expect, it } from "vitest";
import {
  authEmailSchema,
  deleteAccountInputSchema,
  registerInputSchema,
  type AccountDataSnapshot,
  type DataMergeStatus,
} from "../src/contracts/auth.js";
import type {
  AccountSessionWrite,
  AuthCredential,
  AuthRepository,
  RegisterAccountWrite,
  StoredSession,
} from "../src/repositories/auth.js";
import { DuplicateAuthEmailError } from "../src/repositories/auth.js";
import {
  AUTH_SESSION_COOKIE,
  AccountLoginRequiredError,
  AuthService,
  InvalidCredentialsError,
  PasswordReauthenticationError,
  hashSessionToken,
  readCookieValue,
  resolveAuthenticatedUser,
} from "../src/services/auth.js";
import {
  createAuthRoutes,
  MemoryAuthRateLimiter,
  type AuthRateLimits,
} from "../src/routes/auth.js";

const EMAIL = "person@example.com";
const PASSWORD = "correct horse battery staple";
const DEVICE_ID = "c598fcc4-98d4-4f66-b526-65d6ba73adaf";

function hashKey(hash: Buffer): string {
  return hash.toString("hex");
}

class FakeAuthRepository implements AuthRepository {
  readonly accounts = new Map<string, AuthCredential>();
  readonly sessions = new Map<string, StoredSession>();
  lastRegistration: RegisterAccountWrite | null = null;
  lastSession: AccountSessionWrite | null = null;
  lastDeletedHash: Buffer | null = null;
  accountData: AccountDataSnapshot | null = null;

  async findAccountByEmail(email: string): Promise<AuthCredential | null> {
    return this.accounts.get(email) ?? null;
  }

  async findAccountByUserId(userId: string): Promise<AuthCredential | null> {
    return [...this.accounts.values()].find((account) => account.userId === userId)
      ?? null;
  }

  async registerAccount(input: RegisterAccountWrite): Promise<DataMergeStatus> {
    if (this.accounts.has(input.email)) throw new DuplicateAuthEmailError();
    const account: AuthCredential = {
      userId: input.userId,
      email: input.email,
      passwordHash: Buffer.from(input.passwordHash),
      passwordSalt: Buffer.from(input.passwordSalt),
    };
    this.accounts.set(input.email, account);
    this.sessions.set(hashKey(input.session.tokenHash), {
      userId: input.userId,
      email: input.email,
      expiresAt: input.session.expiresAt,
    });
    this.lastRegistration = input;
    return input.deviceUserId ? "merged" : "no_device";
  }

  async createAccountSession(input: AccountSessionWrite): Promise<DataMergeStatus> {
    const account = [...this.accounts.values()].find(
      (candidate) => candidate.userId === input.userId,
    );
    if (!account) throw new Error("missing fake account");
    this.sessions.set(hashKey(input.session.tokenHash), {
      userId: account.userId,
      email: account.email,
      expiresAt: input.session.expiresAt,
    });
    this.lastSession = input;
    return input.deviceUserId ? "merged" : "no_device";
  }

  async findActiveSession(tokenHash: Buffer, now: Date): Promise<StoredSession | null> {
    const session = this.sessions.get(hashKey(tokenHash));
    return session && session.expiresAt > now ? session : null;
  }

  async deleteSession(tokenHash: Buffer): Promise<void> {
    this.lastDeletedHash = Buffer.from(tokenHash);
    this.sessions.delete(hashKey(tokenHash));
  }

  async getAccountData(userId: string): Promise<AccountDataSnapshot | null> {
    if (this.accountData?.account.userId === userId) return this.accountData;
    const account = await this.findAccountByUserId(userId);
    if (!account) return null;
    return {
      account: {
        userId: account.userId,
        email: account.email,
        createdAt: "2030-01-01T00:00:00.000Z",
        updatedAt: "2030-01-01T00:00:00.000Z",
        claimedDevices: [],
      },
      cycleSettings: null,
      dailyCheckins: [],
      breathingRecords: [],
      conversations: [],
      dailyPlans: [],
      activities: [],
      points: {
        weeklyGoal: 30,
        preferenceCreatedAt: null,
        preferenceUpdatedAt: null,
        events: [],
      },
      memories: [],
    };
  }

  async deleteAccount(userId: string, expectedPasswordHash: Buffer): Promise<boolean> {
    const account = await this.findAccountByUserId(userId);
    if (!account || !account.passwordHash.equals(expectedPasswordHash)) return false;
    this.accounts.delete(account.email);
    for (const [key, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(key);
    }
    this.accountData = null;
    return true;
  }
}

describe("auth contracts", () => {
  it("normalizes email addresses and enforces a useful password length", () => {
    expect(authEmailSchema.parse("  Person@Example.COM ")).toBe(EMAIL);
    expect(deleteAccountInputSchema.parse({
      email: "  Person@Example.COM ",
      password: PASSWORD,
    })).toEqual({ email: EMAIL, password: PASSWORD });
    expect(() => registerInputSchema.parse({ email: EMAIL, password: "too-short" }))
      .toThrow();
    expect(() => deleteAccountInputSchema.parse({ password: PASSWORD })).toThrow();
  });

  it("rejects unknown fields so credentials cannot be silently misinterpreted", () => {
    expect(() => registerInputSchema.parse({
      email: EMAIL,
      password: PASSWORD,
      role: "admin",
    })).toThrow();
  });
});

describe("AuthService", () => {
  it("stores independent salt/hash values and only a session-token hash", async () => {
    const repository = new FakeAuthRepository();
    const service = new AuthService(repository);
    const result = await service.register({
      email: "Person@Example.COM",
      password: PASSWORD,
      deviceUserId: DEVICE_ID,
    });

    const write = repository.lastRegistration!;
    expect(write.email).toBe(EMAIL);
    expect(write.passwordSalt).toHaveLength(16);
    expect(write.passwordHash).toHaveLength(64);
    expect(write.passwordHash.toString("utf8")).not.toContain(PASSWORD);
    expect(write.session.tokenHash).toHaveLength(32);
    expect(hashSessionToken(result.sessionToken)).toEqual(write.session.tokenHash);
    expect(JSON.stringify(write)).not.toContain(result.sessionToken);
    expect(result.dataMerge).toBe("merged");
  });

  it("accepts the correct password and returns the stable account user id", async () => {
    const repository = new FakeAuthRepository();
    const service = new AuthService(repository);
    const registered = await service.register({ email: EMAIL, password: PASSWORD });
    const loggedIn = await service.login({
      email: EMAIL,
      password: PASSWORD,
      deviceUserId: DEVICE_ID,
    });

    expect(loggedIn.user).toEqual(registered.user);
    expect(loggedIn.sessionToken).not.toBe(registered.sessionToken);
    expect(repository.lastSession?.deviceUserId).toBe(DEVICE_ID);
  });

  it("uses one public failure for an unknown email and an incorrect password", async () => {
    const repository = new FakeAuthRepository();
    const service = new AuthService(repository);
    await service.register({ email: EMAIL, password: PASSWORD });

    const failures = await Promise.all([
      service.login({ email: EMAIL, password: "incorrect-password" }).catch((error) => error),
      service.login({ email: "unknown@example.com", password: "incorrect-password" })
        .catch((error) => error),
    ]);
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(InvalidCredentialsError);
      expect(failure).toMatchObject({
        code: "INVALID_CREDENTIALS",
        publicMessage: "邮箱或密码错误",
      });
    }
  });

  it("resolves a valid account cookie before the anonymous-device header", async () => {
    const repository = new FakeAuthRepository();
    const service = new AuthService(repository);
    const registered = await service.register({ email: EMAIL, password: PASSWORD });
    const request = new Request("http://localhost/api/personal-data", {
      headers: {
        Cookie: `${AUTH_SESSION_COOKIE}=${registered.sessionToken}`,
        "X-Lutealark-User-Id": DEVICE_ID,
      },
    });

    await expect(resolveAuthenticatedUser(request, service)).resolves.toEqual({
      authType: "account",
      userId: registered.user.userId,
      email: EMAIL,
    });
  });

  it("uses bearer auth first and never falls back after an invalid bearer", async () => {
    const repository = new FakeAuthRepository();
    const service = new AuthService(repository);
    const registered = await service.register({ email: EMAIL, password: PASSWORD });
    const validBearer = new Request("http://localhost/api/personal-data", {
      headers: {
        Authorization: `Bearer ${registered.sessionToken}`,
        "X-Lutealark-User-Id": DEVICE_ID,
      },
    });

    await expect(service.resolveRequestUser(validBearer)).resolves.toEqual({
      authType: "account",
      userId: registered.user.userId,
      email: EMAIL,
    });

    for (const authorization of ["Basic abc", "Bearer invalid-token"]) {
      const request = new Request("http://localhost/api/personal-data", {
        headers: {
          Authorization: authorization,
          Cookie: `${AUTH_SESSION_COOKIE}=${registered.sessionToken}`,
          "X-Lutealark-User-Id": DEVICE_ID,
        },
      });
      await expect(service.resolveRequestUser(request)).resolves.toBeNull();
    }
  });

  it("retains the anonymous UUID fallback without treating it as an account", async () => {
    const service = new AuthService(new FakeAuthRepository());
    const request = new Request("http://localhost/api/personal-data", {
      headers: { "X-Lutealark-User-Id": DEVICE_ID },
    });

    await expect(resolveAuthenticatedUser(request, service)).resolves.toEqual({
      authType: "anonymous",
      userId: DEVICE_ID,
    });
  });

  it("expires sessions and removes the token hash on logout", async () => {
    let now = new Date("2030-01-01T00:00:00.000Z");
    const repository = new FakeAuthRepository();
    const service = new AuthService(repository, {
      now: () => new Date(now),
      sessionTtlMs: 1_000,
    });
    const registered = await service.register({ email: EMAIL, password: PASSWORD });
    const cookie = `${AUTH_SESSION_COOKIE}=${registered.sessionToken}`;
    now = new Date("2030-01-01T00:00:02.000Z");

    await expect(service.resolveRequestUser(new Request("http://localhost", {
      headers: { Cookie: cookie },
    }))).resolves.toBeNull();
    await expect(service.resolveRequestUser(new Request("http://localhost", {
      headers: {
        Authorization: `Bearer ${registered.sessionToken}`,
        "X-Lutealark-User-Id": DEVICE_ID,
      },
    }))).resolves.toBeNull();
    await service.logout(registered.sessionToken);
    expect(repository.lastDeletedHash).toEqual(hashSessionToken(registered.sessionToken));
  });

  it("exports only a logged-in account's portable, non-secret data", async () => {
    const repository = new FakeAuthRepository();
    const service = new AuthService(repository, {
      now: () => new Date("2030-02-03T04:05:06.000Z"),
    });
    const registered = await service.register({ email: EMAIL, password: PASSWORD });
    const request = new Request("http://localhost/api/auth/export", {
      headers: { Cookie: `${AUTH_SESSION_COOKIE}=${registered.sessionToken}` },
    });

    await expect(service.exportAccountData(request)).resolves.toMatchObject({
      format: "lutealark-account-data",
      schemaVersion: 1,
      exportedAt: "2030-02-03T04:05:06.000Z",
      data: {
        account: { userId: registered.user.userId, email: EMAIL },
        points: { weeklyGoal: 30 },
      },
    });
    await expect(service.exportAccountData(new Request(
      "http://localhost/api/auth/export",
      { headers: { "X-Lutealark-User-Id": DEVICE_ID } },
    ))).rejects.toBeInstanceOf(AccountLoginRequiredError);
  });

  it("requires the current email and password before deleting the account and all sessions", async () => {
    const repository = new FakeAuthRepository();
    const service = new AuthService(repository);
    const registered = await service.register({ email: EMAIL, password: PASSWORD });
    const request = new Request("http://localhost/api/auth/account", {
      headers: { Cookie: `${AUTH_SESSION_COOKIE}=${registered.sessionToken}` },
    });
    const user = await service.requireAccountRequestUser(request);

    await expect(service.deleteAccount(user, {
      email: EMAIL,
      password: "incorrect-password",
    }))
      .rejects.toBeInstanceOf(PasswordReauthenticationError);
    await expect(service.deleteAccount(user, {
      email: "someone-else@example.com",
      password: PASSWORD,
    }))
      .rejects.toBeInstanceOf(PasswordReauthenticationError);
    expect(await repository.findAccountByEmail(EMAIL)).not.toBeNull();

    await expect(service.deleteAccount(user, {
      email: " Person@Example.COM ",
      password: PASSWORD,
    })).resolves.toBeUndefined();
    expect(await repository.findAccountByEmail(EMAIL)).toBeNull();
    expect(repository.sessions.size).toBe(0);
  });
});

describe("auth HTTP routes", () => {
  it("sets an HttpOnly Strict cookie and never returns the token or password", async () => {
    const repository = new FakeAuthRepository();
    const service = new AuthService(repository);
    const routes = createAuthRoutes({ service, secureCookies: false });
    const response = await routes.request("/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lutealark-User-Id": DEVICE_ID,
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      authenticated: true,
      user: { email: EMAIL },
      dataMerge: "merged",
    });
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
    expect(body).not.toHaveProperty("accessToken");
    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toContain(`${AUTH_SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Secure");
    const token = readCookieValue(setCookie, AUTH_SESSION_COOKIE)!;
    expect(JSON.stringify(body)).not.toContain(token);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a bearer token only to an explicit Capacitor client", async () => {
    const repository = new FakeAuthRepository();
    const routes = createAuthRoutes({
      service: new AuthService(repository),
      secureCookies: false,
    });
    const registration = await routes.request("/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://localhost",
        "X-Lutealark-Client": "capacitor",
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const registeredBody = await registration.json() as { accessToken: string };
    expect(registeredBody.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(registration.headers.get("Set-Cookie")).toBeNull();

    const nativeLogin = await routes.request("/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://localhost",
        "X-Lutealark-Client": "capacitor",
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(await nativeLogin.json()).toHaveProperty(
      "accessToken",
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    );
    expect(nativeLogin.headers.get("Set-Cookie")).toBeNull();

    for (const origin of [undefined, "https://app.example.com"]) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Lutealark-Client": "capacitor",
      };
      if (origin) headers.Origin = origin;
      const webLogin = await routes.request("/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      expect(await webLogin.json()).not.toHaveProperty("accessToken");
      expect(webLogin.headers.get("Set-Cookie")).toContain(`${AUTH_SESSION_COOKIE}=`);
    }

    const me = await routes.request("/me", {
      headers: {
        Authorization: `Bearer ${registeredBody.accessToken}`,
        "X-Lutealark-User-Id": DEVICE_ID,
      },
    });
    await expect(me.json()).resolves.toMatchObject({
      authenticated: true,
      authType: "account",
      user: { email: EMAIL },
    });

    const logout = await routes.request("/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${registeredBody.accessToken}` },
    });
    expect(logout.status).toBe(200);
    expect(repository.lastDeletedHash).toEqual(hashSessionToken(registeredBody.accessToken));

    const afterLogout = await routes.request("/me", {
      headers: { Authorization: `Bearer ${registeredBody.accessToken}` },
    });
    await expect(afterLogout.json()).resolves.toEqual({
      authenticated: false,
      authType: "none",
      user: null,
    });
  });

  it("marks the cookie Secure for HTTPS deployments", async () => {
    const routes = createAuthRoutes({
      service: new AuthService(new FakeAuthRepository()),
      secureCookies: true,
    });
    const response = await routes.request("https://example.com/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
  });

  it("rejects a body/header device-id mismatch before creating an account", async () => {
    const repository = new FakeAuthRepository();
    const routes = createAuthRoutes({
      service: new AuthService(repository),
      secureCookies: false,
    });
    const response = await routes.request("/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lutealark-User-Id": DEVICE_ID,
      },
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
        deviceUserId: "934fb086-2917-465b-933f-bbb5a1b96081",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "DEVICE_ID_MISMATCH" });
    expect(repository.lastRegistration).toBeNull();
  });

  it("supports /me and invalidates the persisted session on logout", async () => {
    const repository = new FakeAuthRepository();
    const routes = createAuthRoutes({
      service: new AuthService(repository),
      secureCookies: false,
    });
    const registration = await routes.request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const cookie = registration.headers.get("Set-Cookie")!.split(";", 1)[0]!;

    const me = await routes.request("/me", { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      authenticated: true,
      authType: "account",
      user: { email: EMAIL },
    });

    const logout = await routes.request("/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(repository.lastDeletedHash).not.toBeNull();

    const afterLogout = await routes.request("/me", { headers: { Cookie: cookie } });
    await expect(afterLogout.json()).resolves.toEqual({
      authenticated: false,
      authType: "none",
      user: null,
    });
  });

  it("downloads a versioned account export without authentication secrets", async () => {
    const repository = new FakeAuthRepository();
    const routes = createAuthRoutes({
      service: new AuthService(repository),
      secureCookies: false,
    });
    const registration = await routes.request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const cookie = registration.headers.get("Set-Cookie")!.split(";", 1)[0]!;

    const response = await routes.request("/export", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition"))
      .toMatch(/^attachment; filename="lutealark-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const serialized = JSON.stringify(await response.json());
    for (const forbiddenKey of [
      "passwordHash",
      "passwordSalt",
      "tokenHash",
      "sessionToken",
    ]) {
      expect(serialized).not.toContain(`\"${forbiddenKey}\"`);
    }

    const anonymous = await routes.request("/export", {
      headers: { "X-Lutealark-User-Id": DEVICE_ID },
    });
    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toMatchObject({
      error: "ACCOUNT_LOGIN_REQUIRED",
    });
  });

  it("rechecks the email and password, preserves an account on failure, and clears the cookie on success", async () => {
    const repository = new FakeAuthRepository();
    const routes = createAuthRoutes({
      service: new AuthService(repository),
      secureCookies: false,
    });
    const registration = await routes.request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const cookie = registration.headers.get("Set-Cookie")!.split(";", 1)[0]!;

    const wrongPassword = await routes.request("/account", {
      method: "DELETE",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: "incorrect-password" }),
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.headers.get("Set-Cookie")).toBeNull();
    expect(await repository.findAccountByEmail(EMAIL)).not.toBeNull();

    const wrongEmail = await routes.request("/account", {
      method: "DELETE",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "someone-else@example.com", password: PASSWORD }),
    });
    expect(wrongEmail.status).toBe(401);
    expect(await wrongEmail.json()).toMatchObject({
      error: "INVALID_PASSWORD",
      message: "邮箱或密码错误，账号未删除",
    });
    expect(await repository.findAccountByEmail(EMAIL)).not.toBeNull();

    const missingEmail = await routes.request("/account", {
      method: "DELETE",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(missingEmail.status).toBe(400);
    expect(await repository.findAccountByEmail(EMAIL)).not.toBeNull();

    const deleted = await routes.request("/account", {
      method: "DELETE",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ email: " Person@Example.COM ", password: PASSWORD }),
    });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ deleted: true });
    expect(deleted.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(await repository.findAccountByEmail(EMAIL)).toBeNull();
    expect(repository.sessions.size).toBe(0);
  });

  it("rate-limits repeated login attempts in memory", async () => {
    const oneAttempt: AuthRateLimits = {
      loginByEmail: { limit: 1, windowMs: 60_000 },
      loginByClient: { limit: 10, windowMs: 60_000 },
      registerByEmail: { limit: 10, windowMs: 60_000 },
      registerByClient: { limit: 10, windowMs: 60_000 },
    };
    const routes = createAuthRoutes({
      service: new AuthService(new FakeAuthRepository()),
      rateLimiter: new MemoryAuthRateLimiter(() => 10_000),
      rateLimits: oneAttempt,
      secureCookies: false,
    });
    const request = () => routes.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });

    expect((await request()).status).toBe(401);
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });

  it("does not let a caller bypass client rate limits with a forged provider IP header", async () => {
    const oneClientAttempt: AuthRateLimits = {
      loginByEmail: { limit: 10, windowMs: 60_000 },
      loginByClient: { limit: 1, windowMs: 60_000 },
      registerByEmail: { limit: 10, windowMs: 60_000 },
      registerByClient: { limit: 10, windowMs: 60_000 },
    };
    const routes = createAuthRoutes({
      service: new AuthService(new FakeAuthRepository()),
      rateLimiter: new MemoryAuthRateLimiter(() => 10_000),
      rateLimits: oneClientAttempt,
      secureCookies: false,
    });
    const request = (email: string, forgedProviderIp: string, proxyIp: string) =>
      routes.request("/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": forgedProviderIp,
          "X-Real-IP": proxyIp,
        },
        body: JSON.stringify({ email, password: PASSWORD }),
      });

    expect((await request(EMAIL, "198.51.100.1", "203.0.113.10")).status).toBe(401);
    expect((await request("other@example.com", "198.51.100.2", "203.0.113.10")).status)
      .toBe(429);
    expect((await request("third@example.com", "198.51.100.2", "203.0.113.11")).status)
      .toBe(401);
  });

  it("rejects oversized auth bodies", async () => {
    const routes = createAuthRoutes({
      service: new AuthService(new FakeAuthRepository()),
      secureCookies: false,
    });
    const response = await routes.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: "x".repeat(40_000) }),
    });
    expect(response.status).toBe(413);
  });
});
