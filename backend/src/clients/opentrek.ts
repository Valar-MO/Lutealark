import { z } from "zod";
import { requireOpenTrekConfig } from "../config/env.js";
import { calculateCycle } from "../services/cycle.js";
import { buildHistoryContext } from "../services/history.js";
import type {
  CreateAgentSessionInput,
  CreateAgentSessionResult,
  RunAgentInput,
  RunAgentResult,
} from "../contracts/agent.js";

const createSessionResponseSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      uniqueCode: z.string().min(1),
    })
    .nullable()
    .optional(),
  errorCode: z.string().nullable().optional(),
  errorMsg: z.string().nullable().optional(),
});

const runResponseSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      message: z
        .object({
          content: z.array(
            z
              .object({
                type: z.string(),
                text: z.object({ value: z.string() }).optional(),
              })
              .passthrough(),
          ),
          metadata: z.record(z.string(), z.unknown()).nullable().optional(),
        })
        .nullable()
        .optional(),
      error: z.unknown().nullable().optional(),
    })
    .nullable()
    .optional(),
  errorCode: z.string().nullable().optional(),
  errorMsg: z.string().nullable().optional(),
});

export class OpenTrekError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string | null,
  ) {
    super(message);
    this.name = "OpenTrekError";
  }
}

export async function createOpenTrekSession(
  input: CreateAgentSessionInput = {},
): Promise<CreateAgentSessionResult> {
  const config = requireOpenTrekConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/createSession`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.appKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentCode: config.agentCode,
        agentVersion: config.agentVersion,
        ...(input.memoryUserId ? { memoryUserId: input.memoryUserId } : {}),
      }),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") ?? "unknown";
    const responseText = await response.text();
    let raw: unknown = null;
    try {
      raw = JSON.parse(responseText);
    } catch {
      throw new OpenTrekError(
        `OpenTrek createSession returned HTTP ${response.status} (${contentType}); check OPENTREK_BASE_URL and gateway routing`,
        response.status,
      );
    }
    const parsed = createSessionResponseSchema.safeParse(raw);

    if (!parsed.success) {
      throw new OpenTrekError(
        `OpenTrek returned an unexpected createSession JSON structure (HTTP ${response.status})`,
        response.status,
      );
    }

    if (!response.ok || !parsed.data.success || !parsed.data.data) {
      throw new OpenTrekError(
        parsed.data.errorMsg || `OpenTrek createSession failed (${response.status})`,
        response.status,
        parsed.data.errorCode,
      );
    }

    return { sessionCode: parsed.data.data.uniqueCode };
  } catch (error) {
    if (error instanceof OpenTrekError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new OpenTrekError("OpenTrek createSession timed out");
    }
    throw new OpenTrekError(
      error instanceof Error ? error.message : "OpenTrek createSession failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function runOpenTrekAgent(
  input: RunAgentInput,
): Promise<RunAgentResult> {
  const config = requireOpenTrekConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.runTimeoutMs);
  const metadata = buildAgentMetadata(input);
  const text = buildAgentInputText(input.message, metadata);

  try {
    const response = await fetch(`${config.baseUrl}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.appKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stream: false,
        delta: false,
        sessionId: input.sessionCode,
        message: {
          text,
          metadata,
          attachments: input.attachments,
        },
      }),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") ?? "unknown";
    const responseText = await response.text();
    let raw: unknown;
    try {
      raw = JSON.parse(responseText);
    } catch {
      throw new OpenTrekError(
        `OpenTrek run returned HTTP ${response.status} (${contentType})`,
        response.status,
      );
    }

    const parsed = runResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OpenTrekError(
        `OpenTrek returned an unexpected run JSON structure (HTTP ${response.status})`,
        response.status,
      );
    }

    const result = parsed.data;
    if (!response.ok || !result.success || !result.data?.message) {
      throw new OpenTrekError(
        result.errorMsg || `OpenTrek run failed (${response.status})`,
        response.status,
        result.errorCode,
      );
    }

    const content = result.data.message.content
      .filter((item) => item.type === "text" && item.text)
      .map((item) => item.text!.value)
      .join("");

    if (!content) {
      throw new OpenTrekError("OpenTrek run response did not contain text content");
    }

    return {
      sessionCode: input.sessionCode,
      content,
      metadata: result.data.message.metadata ?? {},
    };
  } catch (error) {
    if (error instanceof OpenTrekError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new OpenTrekError(
        `OpenTrek run timed out after ${config.runTimeoutMs} ms`,
      );
    }
    throw new OpenTrekError(
      error instanceof Error ? error.message : "OpenTrek run failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}

const protectedCycleMetadataKeys = new Set([
  "currentPhase",
  "phaseName",
  "isBufferMode",
  "dayOfCycle",
  "daysToNextPeriod",
  "energyValue",
  "cycleLength",
]);

export function buildAgentMetadata(
  input: RunAgentInput,
): Record<string, unknown> {
  const metadata = Object.fromEntries(
    Object.entries(input.metadata).filter(
      ([key]) => !protectedCycleMetadataKeys.has(key),
    ),
  );

  const checkinMetadata = input.dailyCheckin?.shareWithChat
    ? {
        checkinDate: input.dailyCheckin.date,
        selfReportedEnergy: input.dailyCheckin.energy,
        mood: input.dailyCheckin.mood,
        bodyState: input.dailyCheckin.bodyState,
        checkinNote: input.dailyCheckin.note ?? "",
      }
    : {};
  const historyRecords = input.dailyCheckins ?? (input.dailyCheckin ? [input.dailyCheckin] : []);
  const historyContext = buildHistoryContext(historyRecords);
  const historyMetadata = historyContext
    ? { historyContext: JSON.stringify(historyContext) }
    : {};

  if (!input.cycleSettings) {
    return { ...metadata, ...checkinMetadata, ...historyMetadata };
  }

  const cycle = calculateCycle(input.cycleSettings);
  return {
    ...metadata,
    ...checkinMetadata,
    ...historyMetadata,
    ...cycle,
    cycleLength: input.cycleSettings.cycleLength,
  };
}

export function buildAgentInputText(
  userInput: string,
  metadata: Record<string, unknown>,
): string {
  return JSON.stringify({
    input: userInput,
    currentPhase: metadata.currentPhase ?? null,
    phaseName: metadata.phaseName ?? null,
    isBufferMode: metadata.isBufferMode ?? false,
    dayOfCycle: metadata.dayOfCycle ?? null,
    daysToNextPeriod: metadata.daysToNextPeriod ?? null,
    energyValue: metadata.energyValue ?? null,
    cycleLength: metadata.cycleLength ?? null,
    checkinDate: metadata.checkinDate ?? null,
    selfReportedEnergy: metadata.selfReportedEnergy ?? null,
    mood: metadata.mood ?? null,
    bodyState: metadata.bodyState ?? [],
    checkinNote: metadata.checkinNote ?? "",
    historyContext: metadata.historyContext ?? "",
  });
}
