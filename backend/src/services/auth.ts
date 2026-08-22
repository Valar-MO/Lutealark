import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type {
  AccountDataExport,
  AuthUser,
  DataMergeStatus,
  DeleteAccountInput,
  LoginInput,
  RegisterInput,
} from "../contracts/auth.js";
import {
  deleteAccountInputSchema,
  loginInputSchema,
  registerInputSchema,
} from "../contracts/auth.js";
import { personalDataUserIdSchema } from "../contracts/personal-data.js";
import {
  DuplicateAuthEmailError,
  postgresAuthRepository,
  type AuthCredential,
  type AuthRepository,
  type SessionWrite,
} from "../repositories/auth.js";

export const AUTH_SESSION_COOKIE = "lutealark_session";
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 64;
const SESSION_TOKEN_BYTES = 32;
const SCRYPT_OPTIONS = {
  cost: 16_384,
  blockSize: 8,
  parallelization: 1,
  maxmem: 64 * 1024 * 1024,
} as const;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DUMMY_SALT = Buffer.from("6c757465616c61726b2d617574682121", "hex");
const DUMMY_HASH = randomBytes(PASSWORD_HASH_BYTES);

export type ResolvedUser =
  | { authType: "account"; userId: string; email: string }
  | { authType: "anonymous"; userId: string };
export type AccountResolvedUser = Extract<ResolvedUser, { authType: "account" }>;

export interface AuthResult {
  user: AuthUser;
  sessionToken: string;
  expiresAt: Date;
  dataMerge: DataMergeStatus;
}

export class AuthServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 401 | 409,
    public readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "AuthServiceError";
  }
}

export class InvalidCredentialsError extends AuthServiceError {
  constructor() {
    // Deliberately identical for an unknown email and an incorrect password.
    super("INVALID_CREDENTIALS", 401, "邮箱或密码错误");
    this.name = "InvalidCredentialsError";
  }
}

export class EmailAlreadyRegisteredError extends AuthServiceError {
  constructor() {
    super("EMAIL_ALREADY_REGISTERED", 409, "该邮箱已注册");
    this.name = "EmailAlreadyRegisteredError";
  }
}

export class AuthenticationRequiredError extends AuthServiceError {
  constructor() {
    super("AUTHENTICATION_REQUIRED", 401, "请先登录或提供本机用户标识");
    this.name = "AuthenticationRequiredError";
  }
}

export class AccountLoginRequiredError extends AuthServiceError {
  constructor() {
    super("ACCOUNT_LOGIN_REQUIRED", 401, "请先登录账号");
    this.name = "AccountLoginRequiredError";
  }
}

export class PasswordReauthenticationError extends AuthServiceError {
  constructor() {
    // Keep the existing error code for client compatibility while avoiding
    // disclosure of which confirmation field did not match.
    super("INVALID_PASSWORD", 401, "邮箱或密码错误，账号未删除");
    this.name = "PasswordReauthenticationError";
  }
}

export class AccountStateChangedError extends AuthServiceError {
  constructor() {
    super("ACCOUNT_STATE_CHANGED", 409, "账号状态已变化，请重新登录");
    this.name = "AccountStateChangedError";
  }
}

export interface AuthServiceOptions {
  now?: () => Date;
  sessionTtlMs?: number;
  randomBytes?: (size: number) => Buffer;
  randomUUID?: () => string;
}

function derivePasswordHash(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_HASH_BYTES, SCRYPT_OPTIONS, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Buffer.from(key));
    });
  });
}

export function hashSessionToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function isValidSessionToken(token: string | undefined): token is string {
  return typeof token === "string" && SESSION_TOKEN_PATTERN.test(token);
}

export function readCookieValue(
  cookieHeader: string | null,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function securePasswordMatch(candidate: Buffer, account: AuthCredential | null): boolean {
  const expected = account?.passwordHash.length === PASSWORD_HASH_BYTES
    ? account.passwordHash
    : DUMMY_HASH;
  return timingSafeEqual(candidate, expected) && account !== null;
}

export class AuthService {
  private readonly now: () => Date;
  private readonly sessionTtlMs: number;
  private readonly makeRandomBytes: (size: number) => Buffer;
  private readonly makeRandomUUID: () => string;

  constructor(
    private readonly repository: AuthRepository,
    options: AuthServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.sessionTtlMs = options.sessionTtlMs ?? AUTH_SESSION_TTL_MS;
    this.makeRandomBytes = options.randomBytes ?? randomBytes;
    this.makeRandomUUID = options.randomUUID ?? randomUUID;
    if (!Number.isSafeInteger(this.sessionTtlMs) || this.sessionTtlMs <= 0) {
      throw new Error("sessionTtlMs must be a positive safe integer");
    }
  }

  private createSession(): { session: SessionWrite; token: string } {
    const token = this.makeRandomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    if (!isValidSessionToken(token)) {
      throw new Error("The random byte source returned an invalid session token");
    }
    const createdAt = this.now();
    return {
      token,
      session: {
        id: this.makeRandomUUID(),
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(createdAt.getTime() + this.sessionTtlMs),
      },
    };
  }

  async register(rawInput: RegisterInput): Promise<AuthResult> {
    const input = registerInputSchema.parse(rawInput);
    const salt = this.makeRandomBytes(PASSWORD_SALT_BYTES);
    if (salt.length !== PASSWORD_SALT_BYTES) {
      throw new Error("The random byte source returned an invalid password salt");
    }
    const passwordHash = await derivePasswordHash(input.password, salt);
    const userId = personalDataUserIdSchema.parse(this.makeRandomUUID());
    const { session, token } = this.createSession();
    try {
      const dataMerge = await this.repository.registerAccount({
        userId,
        email: input.email,
        passwordHash,
        passwordSalt: salt,
        session,
        ...(input.deviceUserId ? { deviceUserId: input.deviceUserId } : {}),
      });
      return {
        user: { userId, email: input.email },
        sessionToken: token,
        expiresAt: session.expiresAt,
        dataMerge,
      };
    } catch (error) {
      if (error instanceof DuplicateAuthEmailError) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }

  async login(rawInput: LoginInput): Promise<AuthResult> {
    const input = loginInputSchema.parse(rawInput);
    const account = await this.repository.findAccountByEmail(input.email);
    const salt = account?.passwordSalt.length === PASSWORD_SALT_BYTES
      ? account.passwordSalt
      : DUMMY_SALT;
    const candidate = await derivePasswordHash(input.password, salt);
    if (!account || !securePasswordMatch(candidate, account)) {
      throw new InvalidCredentialsError();
    }

    const { session, token } = this.createSession();
    const dataMerge = await this.repository.createAccountSession({
      userId: account.userId,
      session,
      ...(input.deviceUserId ? { deviceUserId: input.deviceUserId } : {}),
    });
    return {
      user: { userId: account.userId, email: account.email },
      sessionToken: token,
      expiresAt: session.expiresAt,
      dataMerge,
    };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!isValidSessionToken(token)) return;
    await this.repository.deleteSession(hashSessionToken(token));
  }

  async resolveRequestUser(request: Request): Promise<ResolvedUser | null> {
    const token = readCookieValue(
      request.headers.get("Cookie"),
      AUTH_SESSION_COOKIE,
    );
    if (isValidSessionToken(token)) {
      const session = await this.repository.findActiveSession(
        hashSessionToken(token),
        this.now(),
      );
      if (session) {
        return {
          authType: "account",
          userId: session.userId,
          email: session.email,
        };
      }
    }

    const anonymous = personalDataUserIdSchema.safeParse(
      request.headers.get("X-Lutealark-User-Id"),
    );
    return anonymous.success
      ? { authType: "anonymous", userId: anonymous.data }
      : null;
  }

  async requireAccountRequestUser(request: Request): Promise<AccountResolvedUser> {
    const user = await this.resolveRequestUser(request);
    if (!user || user.authType !== "account") {
      throw new AccountLoginRequiredError();
    }
    return user;
  }

  async exportAccountData(request: Request): Promise<AccountDataExport> {
    const user = await this.requireAccountRequestUser(request);
    const data = await this.repository.getAccountData(user.userId);
    if (!data) throw new AccountLoginRequiredError();
    return {
      format: "lutealark-account-data",
      schemaVersion: 1,
      exportedAt: this.now().toISOString(),
      data,
    };
  }

  async deleteAccount(
    user: AccountResolvedUser,
    rawInput: DeleteAccountInput,
  ): Promise<void> {
    const input = deleteAccountInputSchema.parse(rawInput);
    const account = await this.repository.findAccountByUserId(user.userId);
    const salt = account?.passwordSalt.length === PASSWORD_SALT_BYTES
      ? account.passwordSalt
      : DUMMY_SALT;
    const candidate = await derivePasswordHash(input.password, salt);
    const passwordMatches = securePasswordMatch(candidate, account);
    if (!account || input.email !== account.email || !passwordMatches) {
      throw new PasswordReauthenticationError();
    }
    const deleted = await this.repository.deleteAccount(
      user.userId,
      account.passwordHash,
    );
    if (!deleted) throw new AccountStateChangedError();
  }
}

export const authService = new AuthService(postgresAuthRepository);

/**
 * Resolves an account session first and keeps the existing anonymous UUID
 * header as a fallback. Personal-data and feature routes should call this
 * instead of trusting X-Lutealark-User-Id directly.
 */
export async function resolveAuthenticatedUser(
  request: Request,
  service: AuthService = authService,
): Promise<ResolvedUser> {
  const user = await service.resolveRequestUser(request);
  if (!user) throw new AuthenticationRequiredError();
  return user;
}
