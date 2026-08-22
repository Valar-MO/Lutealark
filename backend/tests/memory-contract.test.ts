import { describe, expect, it } from "vitest";
import {
  createMemoryInputSchema,
  updateMemoryInputSchema,
} from "../src/contracts/memory.js";

describe("memory archive contracts", () => {
  it("requires explicit consent when creating long-term memory", () => {
    const candidate = {
      kind: "preference",
      summary: "偏好在开始任务前先列一个五分钟步骤",
      sourceTurnHash: "a".repeat(64),
    };

    expect(createMemoryInputSchema.safeParse(candidate).success).toBe(false);
    expect(createMemoryInputSchema.safeParse({
      ...candidate,
      consent: true,
    }).success).toBe(true);
  });

  it("does not accept raw transient or unbounded memory text", () => {
    expect(createMemoryInputSchema.safeParse({
      kind: "constraint",
      summary: "x".repeat(301),
      sourceTurnHash: "a".repeat(64),
      consent: true,
    }).success).toBe(false);
  });

  it("accepts only offline SHA-256 or explicit manual memory identifiers", () => {
    const base = {
      kind: "preference",
      summary: "先列一个五分钟步骤",
      consent: true,
    };

    expect(createMemoryInputSchema.safeParse({
      ...base,
      sourceTurnHash: `manual:934fb086-2917-465b-933f-bbb5a1b96081`,
    }).success).toBe(true);
    expect(createMemoryInputSchema.safeParse({
      ...base,
      sourceTurnHash: "sha256:0123456789abcdef",
    }).success).toBe(false);
    expect(createMemoryInputSchema.safeParse({
      ...base,
      sourceTurnHash: "g".repeat(64),
    }).success).toBe(false);
  });

  it("normalizes uppercase SHA-256 input before idempotent storage", () => {
    const parsed = createMemoryInputSchema.parse({
      kind: "preference",
      summary: "先列一个五分钟步骤",
      sourceTurnHash: "A".repeat(64),
      consent: true,
    });

    expect(parsed.sourceTurnHash).toBe("a".repeat(64));
  });

  it("rejects an empty update", () => {
    expect(updateMemoryInputSchema.safeParse({}).success).toBe(false);
  });
});
