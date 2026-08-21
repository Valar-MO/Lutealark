import { initTRPC } from "@trpc/server";

export interface TrpcContext {
  resolvedUserId?: string;
  authType?: "account" | "anonymous";
  /** HTTP requests must never fall back to a userId supplied in the payload. */
  enforceResolvedUser?: boolean;
  /** Agent calls may degrade to no memory; other private calls stay unavailable. */
  identityDatabaseUnavailable?: boolean;
}

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
