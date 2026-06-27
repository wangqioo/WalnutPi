import {
  getCuratedEvalCase,
  listCuratedEvalCases,
  runCuratedEvalCase,
  type WalnutCuratedEvalCase,
  type WalnutEvalScore,
} from "./curated-eval.ts";
import { publishCuratedEvalScoreToLangfuse } from "./langfuse-eval-publisher.ts";

type JsonObject = Record<string, any>;

export function selectCuratedEvalCases({
  caseId = null,
  suite = null,
}: {
  caseId?: string | null;
  suite?: string | null;
}) {
  const selected = caseId
    ? [getCuratedEvalCase(caseId)].filter(Boolean)
    : listCuratedEvalCases()
      .map((item: JsonObject) => getCuratedEvalCase(item.id))
      .filter((item: WalnutCuratedEvalCase | null): item is WalnutCuratedEvalCase => Boolean(item))
      .filter((item: WalnutCuratedEvalCase) => !suite || item.suite === suite);
  if (caseId && selected.length === 0) {
    return {
      ok: false,
      cases: [] as WalnutCuratedEvalCase[],
      error: "unknown curated eval case",
      status: 404,
    };
  }
  return {
    ok: true,
    cases: selected as WalnutCuratedEvalCase[],
    error: null,
    status: 200,
  };
}

export async function runCuratedEvalCasesThroughPlatform({
  cases,
  variantId = "local-platform",
  allowDevice = false,
  publishLangfuse = true,
  datasetName = "walnutpi-curated-eval",
  runAgentTurn,
}: {
  cases: WalnutCuratedEvalCase[];
  variantId?: string;
  allowDevice?: boolean;
  publishLangfuse?: boolean;
  datasetName?: string;
  runAgentTurn: (body: JsonObject) => Promise<JsonObject>;
}) {
  const results = [];
  for (const evalCase of cases) {
    const result = await runCuratedEvalCase({
      evalCase,
      variantId,
      allowDevice,
      runAgentTurn,
    });
    const score = objectOrEmpty(result.score) as WalnutEvalScore;
    results.push({
      ...result,
      langfuse: publishLangfuse && !result.skipped && result.score
        ? await publishCuratedEvalScoreToLangfuse({
          evalCase,
          score,
          variantId,
          datasetName,
        })
        : skippedLangfusePublish({
          datasetName,
          runName: `walnutpi-${variantId}`,
          caseId: evalCase.id,
          traceId: score.traceId || null,
          error: publishLangfuse ? "Langfuse publish requires an executed eval score with traceId" : "Langfuse publish disabled by request",
        }),
    });
  }
  return {
    ok: results.every((item: JsonObject) =>
      (item.ok || item.skipped)
      && (publishLangfuse !== true || item.langfuse?.ok || item.langfuse?.skipped)
    ),
    schema: "walnutpi.curatedEvalRun.v1",
    caseCount: results.length,
    passed: results.filter((item: JsonObject) => item.score?.verdict === "pass").length,
    failed: results.filter((item: JsonObject) => item.score?.verdict === "fail").length,
    skipped: results.filter((item: JsonObject) => item.skipped || item.score?.verdict === "skip").length,
    allowDevice,
    publishLangfuse,
    results,
    generatedBenchmarkHarnessRestored: false,
    redaction: {
      rawUserText: false,
      rawSessionLogs: false,
      rawDailyNotes: false,
      rawCommand: false,
    },
  };
}

export function skippedLangfusePublish({
  datasetName,
  runName,
  caseId,
  traceId,
  error,
}: {
  datasetName: string;
  runName: string;
  caseId: string;
  traceId: string | null;
  error: string;
}) {
  return {
    ok: false,
    schema: "walnutpi.langfuseEvalPublish.v1",
    configured: false,
    skipped: true,
    datasetName,
    runName,
    caseId,
    datasetItemId: null,
    datasetRunId: null,
    traceId,
    scoreName: null,
    redaction: {
      input: false,
      output: false,
      metadata: false,
      rawUserText: false,
      rawParams: false,
      rawTurn: false,
      rawCommand: false,
    },
    error,
  };
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
