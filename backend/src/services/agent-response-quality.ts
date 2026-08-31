import type { RunAgentResult } from "../contracts/agent.js";

export type AgentResponseQualityReason =
  | "E_UNSUPPORTED_STRATEGY"
  | "E_ACTION_PRESENT"
  | "E_BREATHING_GUIDANCE"
  | "E_MULTIPLE_SUGGESTIONS"
  | "E_ALTERNATIVES"
  | "E_MULTI_STEP"
  | "E_SUGGESTION_LIST"
  | "E_MULTIPLE_QUESTIONS";

export type AgentResponseQualityResult =
  | { ok: true; reasons: [] }
  | { ok: false; reasons: AgentResponseQualityReason[] };

const BREATHING_GUIDANCE = [
  /4\s*[-‐-―−]\s*7\s*[-‐-―−]\s*8/u,
  /(屏住呼吸|屏息|憋气|深呼吸|腹式呼吸|呼吸练习|呼吸训练|呼吸节奏|呼吸轮次)/u,
  /(可以|试试|尝试|建议|不妨|请|先|跟着|开始|做|数).{0,20}(呼吸|吸气|呼气)/u,
  /(吸气|呼气).{0,12}(秒|拍|次|数到|计数)/u,
  /(把|将).{0,12}注意力.{0,8}呼吸/u,
];

const SUGGESTION_SIGNAL = /(如果愿意.{0,24}(可以|试试|尝试)|可以试试|你可以|不妨|尝试|建议|先把|先做|只处理|戴上|播放|关掉|调低|移开|放下|写下)/u;
const ALTERNATIVE_SIGNAL = /(或|或者|也可以|任选|二选一|三选一|比如|例如)/u;
const MULTI_STEP_SIGNAL = /(先.{0,80}(再|然后|接着|随后)|同时|并且|以及)/u;
const LIST_PREFIX = /^\s*(?:[-*\u2022]|(?:\d+|[一二三四五六七八九十]+)[.\u3001）)])\s*/u;

/**
 * Fail closed on high-confidence violations in the generic emotional-support
 * path. The gate intentionally does not try to prove arbitrary prose is
 * grounded; it only rejects response shapes that violate the product contract.
 */
export function evaluateAgentResponseQuality(
  response: RunAgentResult,
): AgentResponseQualityResult {
  if (response.metadata.intent !== "emotion_support") {
    return { ok: true, reasons: [] };
  }
  const strategy = response.metadata.strategy;

  // This gate is the P03 (generic emotional support) contract. P05/P07 have
  // different action and consent semantics, so applying P03's action-free
  // rules to them would reject valid breathing/environment/movement replies.
  // Keep unknown or missing strategies fail-closed rather than silently
  // treating malformed upstream metadata as a specialized route.
  if (
    strategy === "breathing"
    || strategy === "environment"
    || strategy === "micro_movement"
  ) {
    return { ok: true, reasons: [] };
  }
  if (strategy !== "none") {
    return { ok: false, reasons: ["E_UNSUPPORTED_STRATEGY"] };
  }

  const normalized = response.content.normalize("NFKC");
  const reasons: AgentResponseQualityReason[] = [];
  if (typeof response.metadata.action === "string"
    && response.metadata.action.trim()) {
    reasons.push("E_ACTION_PRESENT");
  }
  if (BREATHING_GUIDANCE.some((pattern) => pattern.test(normalized))) {
    reasons.push("E_BREATHING_GUIDANCE");
  }

  const lines = normalized.split(/\r?\n/u);
  if (lines.some((line) => LIST_PREFIX.test(line) && SUGGESTION_SIGNAL.test(line))) {
    reasons.push("E_SUGGESTION_LIST");
  }
  const suggestionSentences = normalized
    .split(/[。！？!?;\n]+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && SUGGESTION_SIGNAL.test(sentence));
  if (suggestionSentences.length > 1) {
    reasons.push("E_MULTIPLE_SUGGESTIONS");
  }
  if (suggestionSentences.some((sentence) => ALTERNATIVE_SIGNAL.test(sentence))) {
    reasons.push("E_ALTERNATIVES");
  }
  if (suggestionSentences.some((sentence) => MULTI_STEP_SIGNAL.test(sentence))) {
    reasons.push("E_MULTI_STEP");
  }
  if ((normalized.match(/[？?]/gu) ?? []).length > 1) {
    reasons.push("E_MULTIPLE_QUESTIONS");
  }

  return reasons.length > 0
    ? { ok: false, reasons: Array.from(new Set(reasons)) }
    : { ok: true, reasons: [] };
}
