import { Inngest } from "inngest";
import { serve as serveInngestHono } from "inngest/hono";
import { createPendingEvalScore, getCuratedEvalCase, listCuratedEvalCases } from "../eval/curated-eval.ts";
import { runCuratedEvalCasesThroughPlatform } from "../eval/curated-eval-runner.ts";
import { createRetrievalReindexWorkflow } from "../memory/retrieval-reindex-workflow.ts";

type JsonObject = Record<string, any>;

export const walnutInngest = new Inngest({
  id: "walnutpi",
  isDev: !process.env.INNGEST_SIGNING_KEY,
});

export function createWalnutInngestFunctions({
  runAgentTurn = null,
}: {
  runAgentTurn?: ((body: JsonObject) => Promise<JsonObject>) | null;
} = {}) {
  const collectDeviceEvidenceFunction = walnutInngest.createFunction(
    {
      id: "collect-device-evidence",
      name: "Collect device evidence",
      triggers: {
        event: "walnut/device.evidence.requested",
      },
    },
    async ({ event }) => {
      return {
        ok: true,
        eventName: event.name,
        queuedOnly: true,
      };
    },
  );

  const syncScreenPlaylistFunction = walnutInngest.createFunction(
    {
      id: "sync-screen-playlist",
      name: "Sync screen playlist",
      triggers: {
        event: "walnut/screen.sync.requested",
      },
    },
    async ({ event }) => {
      return {
        ok: true,
        eventName: event.name,
        queuedOnly: true,
        schema: "walnutpi.screenSync.longWorkflow.v1",
        playlistHash: event.data?.playlistHash || null,
        evidenceMode: event.data?.evidenceMode === "full" ? "full" : "fast",
        deviceProfile: "device",
        requiredPath: ["Mastra", "MCP", "OPA", "Screen Command DSL", "typed delivery adapter"],
        resultRef: event.data?.resultRef || null,
      };
    },
  );

  const runCuratedEvalCaseFunction = walnutInngest.createFunction(
    {
      id: "run-curated-eval-case",
      name: "Run curated eval case",
      triggers: {
        event: "walnut/eval.curated.case.requested",
      },
    },
    async ({ event }) => {
      const evalCase = getCuratedEvalCase(String(event.data?.caseId || ""));
      if (!evalCase) {
        return {
          ok: false,
          eventName: event.name,
          reason: "unknown curated eval case",
          caseId: event.data?.caseId || null,
        };
      }
      if (!runAgentTurn) {
        return {
          ok: false,
          eventName: event.name,
          schema: "walnutpi.curatedEvalCaseRun.v1",
          case: evalCase,
          score: createPendingEvalScore(evalCase, {
            variantId: String(event.data?.variantId || "local-platform"),
            reason: "platform runner is not configured for Inngest eval execution",
            evidenceRefs: [`curated-eval-case:${evalCase.id}`],
          }),
          reason: "platform-runner-not-configured",
          generatedBenchmarkHarnessRestored: false,
        };
      }
      const run = await runCuratedEvalCasesThroughPlatform({
        cases: [evalCase],
        variantId: String(event.data?.variantId || "local-platform"),
        allowDevice: event.data?.allowDevice === true,
        publishLangfuse: event.data?.publishLangfuse !== false,
        datasetName: event.data?.datasetName ? String(event.data.datasetName) : "walnutpi-curated-eval",
        runAgentTurn,
      });
      return {
        ok: run.ok,
        eventName: event.name,
        schema: "walnutpi.curatedEvalCaseRun.v1",
        caseId: evalCase.id,
        result: run.results[0] || null,
        summary: {
          passed: run.passed,
          failed: run.failed,
          skipped: run.skipped,
          allowDevice: run.allowDevice,
          publishLangfuse: run.publishLangfuse,
        },
        generatedBenchmarkHarnessRestored: false,
        redaction: run.redaction,
      };
    },
  );

  const fanoutCuratedEvalFunction = walnutInngest.createFunction(
    {
      id: "fanout-curated-eval",
      name: "Fan out curated eval",
      triggers: {
        event: "walnut/eval.curated.requested",
      },
    },
    async ({ event, step }) => {
      const cases = listCuratedEvalCases();
      await Promise.all(cases.map((evalCase) =>
        step.sendEvent(`fanout-${evalCase.id}`, {
          name: "walnut/eval.curated.case.requested",
          data: {
            caseId: evalCase.id,
            variantId: event.data?.variantId || "local-platform",
            suite: evalCase.suite,
            profile: evalCase.profile,
            allowDevice: event.data?.allowDevice === true,
            publishLangfuse: event.data?.publishLangfuse !== false,
            datasetName: event.data?.datasetName || "walnutpi-curated-eval",
          },
        }),
      ));
      return {
        ok: true,
        eventName: event.name,
        schema: "walnutpi.curatedEvalFanout.v1",
        caseCount: cases.length,
        cases: cases.map((evalCase) => ({
          id: evalCase.id,
          suite: evalCase.suite,
          profile: evalCase.profile,
          fingerprint: evalCase.fingerprint,
        })),
        generatedBenchmarkHarnessRestored: false,
      };
    },
  );

  const nightlyDriftCheckFunction = walnutInngest.createFunction(
    {
      id: "nightly-drift-check",
      name: "Nightly drift check",
      triggers: {
        cron: "0 3 * * *",
      },
    },
    async ({ step }) => {
      await step.sendEvent("nightly-curated-eval", {
        name: "walnut/eval.curated.requested",
        data: {
          variantId: "nightly-local-platform",
          source: "nightly-drift-check",
          publishLangfuse: true,
          allowDevice: false,
        },
      });
      await step.sendEvent("nightly-device-evidence", {
        name: "walnut/device.evidence.requested",
        data: {
          source: "nightly-drift-check",
          deviceProfile: "device",
        },
      });
      return {
        ok: true,
        schema: "walnutpi.nightlyDriftCheck.v1",
        queued: ["walnut/eval.curated.requested", "walnut/device.evidence.requested"],
      };
    },
  );

  const reindexRetrievalEmbeddingsFunction = walnutInngest.createFunction(
    {
      id: "reindex-retrieval-embeddings",
      name: "Reindex retrieval embeddings",
      triggers: {
        event: "walnut/retrieval.reindex.requested",
      },
    },
    async ({ event }) => {
      const result = await createRetrievalReindexWorkflow().run({
        limit: event.data?.limit,
      });
      return {
        ok: result.ok,
        eventName: event.name,
        indexed: result.indexed,
        refused: result.refused,
        sourceKinds: result.sourceKinds || [],
        reason: result.reason || null,
      };
    },
  );

  return [
    collectDeviceEvidenceFunction,
    syncScreenPlaylistFunction,
    reindexRetrievalEmbeddingsFunction,
    runCuratedEvalCaseFunction,
    fanoutCuratedEvalFunction,
    nightlyDriftCheckFunction,
  ];
}

export const walnutInngestFunctions = createWalnutInngestFunctions();

export function createWalnutInngestServeHandler({
  runAgentTurn,
}: {
  runAgentTurn: (body: JsonObject) => Promise<JsonObject>;
}) {
  return serveInngestHono({
    client: walnutInngest,
    functions: createWalnutInngestFunctions({ runAgentTurn }),
  });
}
