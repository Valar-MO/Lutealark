import { beforeEach, vi } from "vitest";

// The repository's default .env is configured for VPN-backed `auto` mode.
// Keep unit/HTTP tests deterministic and offline unless a test explicitly
// opts into `auto` or `online` with vi.stubEnv.
vi.stubEnv("OPENTREK_MODE", "offline");

beforeEach(() => {
  vi.stubEnv("OPENTREK_MODE", "offline");
});
