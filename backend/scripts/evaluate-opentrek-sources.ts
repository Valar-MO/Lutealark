import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createOpenTrekSession,
  runOpenTrekAgent,
} from "../src/clients/opentrek.js";
import { knowledgeSourceSchema } from "../src/contracts/agent.js";
import {
  assertSourceCaseCoverage,
  parseJsonl,
  sourceCaseSchema,
  type SourceCase,
} from "./opentrek-eval-lib.js";

const PASS_THRESHOLD_PERCENT = 80;

type AuthoritativeSourceCase = Extract<
  SourceCase,
  { labelStatus: "authoritative" }
>;

interface SourceEvaluationResult {
  id: string;
  expectedIntent: string;
  actualIntent: string | null;
  intentMatches: boolean;
  expectedSourceIds: string[];
  actualSourceIds: string[];
  sourceCount: number;
  top3IdHit: boolean;
  nonEmpty: boolean;
  elapsedMs: number;
  error: string | null;
  passed: boolean;
}

const evalPath = fileURLToPath(new URL(
  "../../opentrek/evals/sources.jsonl",
  import.meta.url,
));

async function loadCases(): Promise<SourceCase[]> {
  const text = await readFile(evalPath, "utf8");
  const cases = parseJsonl(text, sourceCaseSchema, "sources.jsonl");
  assertSourceCaseCoverage(cases);
  return cases;
}

async function evaluateCase(
  item: AuthoritativeSourceCase,
): Promise<SourceEvaluationResult> {
  const startedAt = performance.now();
  try {
    const { sessionCode } = await createOpenTrekSession();
    const response = await runOpenTrekAgent({
      sessionCode,
      message: item.prompt,
      metadata: {},
      attachments: [],
    });
    const sources = z.array(knowledgeSourceSchema).max(3).catch([])
      .parse(response.metadata.sources);
    const actualIntent = typeof response.metadata.intent === "string"
      ? response.metadata.intent
      : null;
    const intentMatches = actualIntent === item.expectedIntent;
    const actualSourceIds = sources.map((source) => source.sourceId);
    const top3IdHit = actualSourceIds.some((sourceId) =>
      item.expectedSourceIds.includes(sourceId),
    );
    const nonEmpty = response.content.trim().length > 0;

    return {
      id: item.id,
      expectedIntent: item.expectedIntent,
      actualIntent,
      intentMatches,
      expectedSourceIds: item.expectedSourceIds,
      actualSourceIds,
      sourceCount: sources.length,
      top3IdHit,
      nonEmpty,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: null,
      passed: nonEmpty && intentMatches && sources.length > 0 && top3IdHit,
    };
  } catch (error) {
    return {
      id: item.id,
      expectedIntent: item.expectedIntent,
      actualIntent: null,
      intentMatches: false,
      expectedSourceIds: item.expectedSourceIds,
      actualSourceIds: [],
      sourceCount: 0,
      top3IdHit: false,
      nonEmpty: false,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
      passed: false,
    };
  }
}

function percentage(passed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((passed / total) * 1_000) / 10;
}

async function main(): Promise<void> {
  const cases = await loadCases();
  const pendingCases = cases.filter(
    (item) => item.labelStatus === "pending_trace",
  );
  const authoritativeCases = cases.filter(
    (item): item is AuthoritativeSourceCase =>
      item.labelStatus === "authoritative",
  );
  const acceptanceReady = pendingCases.length === 0;

  if (process.argv.includes("--validate-only")) {
    console.log(JSON.stringify({
      scope: "opentrek-authoritative-top3",
      mode: "validate-only",
      status: acceptanceReady ? "ready" : "valid_but_not_ready",
      totalCases: cases.length,
      authoritativeCases: authoritativeCases.length,
      pendingTraceCases: pendingCases.map((item) => item.id),
      acceptanceReady,
      networkCalled: false,
    }));
    return;
  }

  if (!acceptanceReady) {
    for (const item of pendingCases) {
      console.log(JSON.stringify({
        id: item.id,
        labelStatus: item.labelStatus,
        status: "not_evaluated",
        reason: item.traceLabelNote,
      }));
    }
    console.log(JSON.stringify({
      summary: {
        status: "not_ready",
        totalCases: cases.length,
        authoritativeCases: authoritativeCases.length,
        pendingTraceCases: pendingCases.map((item) => item.id),
        authoritativeTop3RecallMeasured: false,
        networkCalled: false,
        reason:
          "Capture sourceId values from the same-version OpenTrek Trace and replace every pending_trace label before online acceptance.",
      },
    }));
    process.exitCode = 1;
    return;
  }

  const results: SourceEvaluationResult[] = [];
  for (const item of authoritativeCases) {
    const result = await evaluateCase(item);
    results.push(result);
    console.log(JSON.stringify(result));
  }

  const intentPassed = results.filter((item) => item.intentMatches).length;
  const top3HitPassed = results.filter((item) => item.top3IdHit).length;
  const combinedPassed = results.filter((item) => item.passed).length;
  const intentAccuracy = percentage(intentPassed, results.length);
  const top3HitRate = percentage(top3HitPassed, results.length);
  const combinedPassRate = percentage(combinedPassed, results.length);
  const passed = combinedPassRate >= PASS_THRESHOLD_PERCENT;

  console.log(JSON.stringify({
    summary: {
      status: passed ? "passed" : "failed",
      total: results.length,
      intentAccuracyPercent: intentAccuracy,
      top3IdHitRatePercent: top3HitRate,
      combinedCasesPassed: combinedPassed,
      combinedPassRatePercent: combinedPassRate,
      thresholdPercent: PASS_THRESHOLD_PERCENT,
      authoritativeTop3RecallMeasured: true,
      note:
        "A case passes only when the intent matches and an authoritative expected sourceId appears in that run's Top-3 sources.",
    },
  }));

  if (!passed) process.exitCode = 1;
}

await main();
