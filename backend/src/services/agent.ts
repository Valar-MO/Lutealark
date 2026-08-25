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
    return await runOpenTrekAgent(input, memories);
  } catch (error) {
    if (env.OPENTREK_MODE === "auto" && isConnectivityFailure(error)) {
      const offlineInput = asOfflineInput(input);
      const response = runOfflineAssistant(offlineInput);
      applyOfflineMemoryContext(response, memories);
      return response;
    }
    throw error;
  }
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
