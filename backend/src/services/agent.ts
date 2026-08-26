import {
  createOpenTrekSession,
  OpenTrekError,
  runOpenTrekAgent,
} from "../clients/opentrek.js";
import { env } from "../config/env.js";
import type {
  CreateAgentSessionInput,
  CreateAgentSessionResult,
  RunAgentInput,
  RunAgentResult,
} from "../contracts/agent.js";
import {
  createOfflineSession,
  isOfflineSession,
  runOfflineAssistant,
} from "./offline-assistant.js";
import {
  applyOfflineMemoryContext,
  sanitizeAgentMemoryContext,
  type AgentMemoryContextItem,
} from "./agent-memory.js";
import { isCrisisMessage } from "./offline-assistant.js";
import { evaluateAgentResponseQuality } from "./agent-response-quality.js";

export type RunAgentTrustedContext = {
  memories?: readonly AgentMemoryContextItem[];
};

export async function createAgentSession(
  input: CreateAgentSessionInput = {},
): Promise<CreateAgentSessionResult> {
  if (env.OPENTREK_MODE === "offline") return createOfflineSession();

  try {
    const session = await createOpenTrekSession(input);
    return { ...session, mode: "online" };
  } catch (error) {
    if (env.OPENTREK_MODE === "auto" && isConnectivityFailure(error)) {
      return createOfflineSession();
    }
    throw error;
  }
}

export async function runAgent(
  input: RunAgentInput,
  trustedContext: RunAgentTrustedContext = {},
): Promise<RunAgentResult> {
  const memories = isCrisisMessage(input.message)
    ? []
    : sanitizeAgentMemoryContext(
      (trustedContext.memories ?? []).map((memory) => ({
        ...memory,
        archived: false,
      })),
    );
  if (env.OPENTREK_MODE === "offline" || isOfflineSession(input.sessionCode)) {
    const response = runOfflineAssistant(asOfflineInput(input));
    applyOfflineMemoryContext(response, memories);
    return response;
  }

  try {
    const response = await runOpenTrekAgent(input, memories);
    const quality = evaluateAgentResponseQuality(response);
    if (!quality.ok) {
      if (env.OPENTREK_MODE === "auto") {
        return emotionalSupportQualityFallback();
      }
      throw new OpenTrekError(
        "OpenTrek run response failed the emotional-support quality gate",
        200,
        quality.reasons[0],
      );
    }
    return response;
  } catch (error) {
    if (env.OPENTREK_MODE === "auto" && isConnectivityFailure(error)) {
      return runOfflineFallback(input, memories);
    }
    throw error;
  }
}

function emotionalSupportQualityFallback(): RunAgentResult {
  const session = createOfflineSession();
  return {
    sessionCode: session.sessionCode,
    content: "听起来这份难受正在占用你很多力气。你不需要现在就把它处理好，我会继续听你说。",
    metadata: {
      mode: "offline",
      intent: "emotion_support",
      strategy: "none",
      ragUsed: false,
      sources: [],
      notice: "OpenTrek 回复未通过本地质量检查；本回复由无动作的本地安全回退生成，未使用 RAG。",
    },
  };
}

function runOfflineFallback(
  input: RunAgentInput,
  memories: readonly AgentMemoryContextItem[],
): RunAgentResult {
  const response = runOfflineAssistant(asOfflineInput(input));
  applyOfflineMemoryContext(response, memories);
  return response;
}

function asOfflineInput(input: RunAgentInput): RunAgentInput {
  if (isOfflineSession(input.sessionCode)) return input;
  return { ...input, sessionCode: createOfflineSession().sessionCode };
}

function isConnectivityFailure(error: unknown): boolean {
  if (error instanceof OpenTrekError) {
    return error.retryable || error.status === undefined || error.status >= 500;
  }
  return error instanceof Error
    && error.message.startsWith("OpenTrek configuration is missing:");
}
