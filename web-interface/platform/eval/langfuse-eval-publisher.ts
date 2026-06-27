import { createHash } from "node:crypto";
import { createWalnutLangfuseClient } from "../observability/tracing.ts";
import type { WalnutCuratedEvalCase, WalnutEvalScore } from "./curated-eval.ts";

type JsonObject = Record<string, any>;

export type WalnutLangfuseEvalPublishResult = {
  ok: boolean;
  schema: "walnutpi.langfuseEvalPublish.v1";
  configured: boolean;
  skipped: boolean;
  datasetName: string;
  runName: string;
  caseId: string;
  datasetItemId: string | null;
  datasetRunId: string | null;
  traceId: string | null;
  scoreName: string | null;
  redaction: {
    input: false;
    output: false;
    metadata: false;
    rawUserText: false;
    rawParams: false;
    rawTurn: false;
    rawCommand: false;
  };
  error: string | null;
};

export async function publishCuratedEvalScoreToLangfuse({
  evalCase,
  score,
  variantId = score.variantId || "local-platform",
  datasetName = "walnutpi-curated-eval",
}: {
  evalCase: WalnutCuratedEvalCase;
  score: WalnutEvalScore;
  variantId?: string;
  datasetName?: string;
}): Promise<WalnutLangfuseEvalPublishResult> {
  const runName = `walnutpi-${safeLangfuseSlug(variantId)}`;
  const datasetItemId = datasetItemIdFor(evalCase);
  const base = createPublishResult({
    configured: false,
    skipped: true,
    datasetName,
    runName,
    caseId: evalCase.id,
    datasetItemId,
    datasetRunId: null,
    traceId: score.traceId || null,
    scoreName: null,
    error: null,
  });
  const langfuse = createWalnutLangfuseClient();
  if (!langfuse.client) {
    return {
      ...base,
      configured: false,
      error: langfuse.reason || "Langfuse is not configured",
    };
  }
  if (!score.traceId) {
    return {
      ...base,
      configured: true,
      skipped: false,
      error: "score has no traceId; Langfuse dataset run link was not created",
    };
  }

  try {
    await ensureDataset(langfuse.client, datasetName);
    const item = await langfuse.client.dataset.createItem({
      id: datasetItemId,
      datasetName,
      input: redactedDatasetInput(evalCase),
      expectedOutput: redactedExpectedOutput(evalCase),
      metadata: redactedDatasetMetadata(evalCase),
    });
    const runItem = await langfuse.client.api.datasetRunItems.create({
      runName,
      runDescription: "WalnutPi curated eval run through /api/agent/turn, Mastra, MCP, and OPA.",
      metadata: redactedRunMetadata(score),
      datasetItemId: String((item as JsonObject).id || datasetItemId),
      traceId: score.traceId,
    });
    const datasetRunId = String((runItem as JsonObject).datasetRunId || "");
    const scoreName = `walnutpi.${evalCase.grader.metric}`;
    langfuse.client.score.create({
      name: scoreName,
      traceId: score.traceId,
      datasetRunId: datasetRunId || undefined,
      value: numericVerdict(score.verdict),
      comment: safeScoreComment(score),
      metadata: redactedScoreMetadata(score),
    });
    await langfuse.client.flush();
    return createPublishResult({
      configured: true,
      skipped: false,
      datasetName,
      runName,
      caseId: evalCase.id,
      datasetItemId: String((item as JsonObject).id || datasetItemId),
      datasetRunId: datasetRunId || null,
      traceId: score.traceId,
      scoreName,
      error: null,
    });
  } catch (error: any) {
    return {
      ...base,
      configured: true,
      skipped: false,
      error: error?.message || "failed to publish curated eval score to Langfuse",
    };
  }
}

async function ensureDataset(client: JsonObject, datasetName: string) {
  try {
    await client.api.datasets.get(datasetName);
  } catch {
    await client.api.datasets.create({
      name: datasetName,
      description: "WalnutPi curated eval cases with redacted inputs and expected evidence.",
      metadata: {
        schema: "walnutpi.curatedEvalDataset.v1",
        rawUserText: false,
        rawParams: false,
        rawSessionLogs: false,
        rawDailyNotes: false,
        generatedBenchmarkHarnessRestored: false,
      },
    });
  }
}

function redactedDatasetInput(evalCase: WalnutCuratedEvalCase) {
  return {
    schema: "walnutpi.curatedEvalInput.redacted.v1",
    caseId: evalCase.id,
    suite: evalCase.suite,
    profile: evalCase.profile,
    inputKind: evalCase.input.kind,
    capability: evalCase.input.capability || null,
    inputTextHash: sha256(evalCase.input.text),
    paramsHash: sha256(JSON.stringify(evalCase.input.params || {})),
    rawUserText: false,
    rawParams: false,
  };
}

function redactedExpectedOutput(evalCase: WalnutCuratedEvalCase) {
  return {
    schema: "walnutpi.curatedEvalExpected.redacted.v1",
    expectedBehavior: evalCase.expectedBehavior,
    requiredEvidence: evalCase.requiredEvidence,
    forbiddenSideEffects: evalCase.forbiddenSideEffects,
    grader: evalCase.grader,
  };
}

function redactedDatasetMetadata(evalCase: WalnutCuratedEvalCase) {
  return {
    schema: "walnutpi.curatedEvalDatasetItemMetadata.v1",
    labels: evalCase.labels,
    rawUserText: false,
    rawParams: false,
    rawSessionLogs: false,
    rawDailyNotes: false,
  };
}

function redactedRunMetadata(score: WalnutEvalScore) {
  return {
    schema: "walnutpi.curatedEvalRunMetadata.v1",
    variantId: score.variantId,
    profile: score.profile,
    granularity: score.granularity,
    evidenceLayer: score.evidenceLayer,
    grader: score.grader,
    evidenceRefs: score.evidenceRefs,
    artifactRefs: score.artifactRefs,
    rawTurn: false,
    rawCommand: false,
  };
}

function redactedScoreMetadata(score: WalnutEvalScore) {
  return {
    schema: "walnutpi.evalScoreMetadata.redacted.v1",
    caseId: score.caseId,
    variantId: score.variantId,
    suite: score.suite,
    profile: score.profile,
    verdict: score.verdict,
    metric: score.metric,
    granularity: score.granularity,
    evidenceLayer: score.evidenceLayer,
    grader: score.grader,
    evidenceRefs: score.evidenceRefs,
    artifactRefs: score.artifactRefs,
    rawTurn: false,
    rawCommand: false,
  };
}

function createPublishResult({
  configured,
  skipped,
  datasetName,
  runName,
  caseId,
  datasetItemId,
  datasetRunId,
  traceId,
  scoreName,
  error,
}: Omit<WalnutLangfuseEvalPublishResult, "ok" | "schema" | "redaction">): WalnutLangfuseEvalPublishResult {
  return {
    ok: configured && !skipped && !error,
    schema: "walnutpi.langfuseEvalPublish.v1",
    configured,
    skipped,
    datasetName,
    runName,
    caseId,
    datasetItemId,
    datasetRunId,
    traceId,
    scoreName,
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

function numericVerdict(verdict: WalnutEvalScore["verdict"]) {
  if (verdict === "pass") return 1;
  if (verdict === "fail") return 0;
  return 0;
}

function safeScoreComment(score: WalnutEvalScore) {
  const value = typeof score.value === "string" ? score.value : String(score.value ?? score.verdict);
  return `${score.verdict}: ${value}`.slice(0, 500);
}

function datasetItemIdFor(evalCase: WalnutCuratedEvalCase) {
  return `walnutpi-curated-${evalCase.id}`;
}

function safeLangfuseSlug(value: string) {
  return String(value || "local-platform").replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 80) || "local-platform";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
