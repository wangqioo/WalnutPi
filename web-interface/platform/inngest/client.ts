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
    async ({ event, step }) => {
      if (!runAgentTurn) {
        return platformRunnerNotConfigured({
          eventName: event.name,
          schema: "walnutpi.deviceEvidence.longWorkflow.v1",
          workflow: "device-evidence",
        });
      }
      const sessionId = String(event.data?.sessionId || `inngest-device-evidence-${Date.now()}`);
      const statusTurn = await step.run("device-status-platform-turn", () => runAgentTurn({
        sessionId,
        text: "device.status.read",
        capability: "device.status.read",
      })) as JsonObject;
      const captureTurn = event.data?.includeScreenCapture === false
        ? null
        : await step.run("screen-capture-platform-turn", () => runAgentTurn({
          sessionId,
          text: "screen.captureFrame",
          capability: "screen.captureFrame",
          buildId: event.data?.buildId || undefined,
        })) as JsonObject;
      return {
        ok: Boolean(statusTurn.ok) && (captureTurn ? Boolean(captureTurn.ok) : true),
        eventName: event.name,
        schema: "walnutpi.deviceEvidence.longWorkflow.v1",
        queuedOnly: false,
        deviceProfile: "device",
        requiredPath: ["Inngest", "agent-turn", "Mastra", "MCP", "OPA", "typed device boundary"],
        status: redactedTurnSummary(statusTurn),
        capture: captureTurn ? redactedTurnSummary(captureTurn) : null,
        resultRef: event.data?.resultRef || null,
        redaction: publicLongWorkflowRedaction(),
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
    async ({ event, step }) => {
      if (!runAgentTurn) {
        return platformRunnerNotConfigured({
          eventName: event.name,
          schema: "walnutpi.screenSync.longWorkflow.v1",
          workflow: "screen-sync",
        });
      }
      const turn = await step.run("screen-sync-platform-turn", () => runAgentTurn({
        sessionId: String(event.data?.sessionId || `inngest-screen-sync-${Date.now()}`),
        text: "screen.syncPlaylist",
        capability: "screen.syncPlaylist",
        playlistHash: event.data?.playlistHash || undefined,
        evidenceMode: event.data?.evidenceMode === "full" ? "full" : "fast",
        mode: event.data?.mode === "preview" || event.data?.previewOnly === true ? "preview" : "remote",
        previewOnly: event.data?.mode === "preview" || event.data?.previewOnly === true,
      })) as JsonObject;
      return {
        ok: Boolean(turn.ok),
        eventName: event.name,
        queuedOnly: false,
        schema: "walnutpi.screenSync.longWorkflow.v1",
        playlistHash: event.data?.playlistHash || null,
        evidenceMode: event.data?.evidenceMode === "full" ? "full" : "fast",
        deviceProfile: "device",
        requiredPath: ["Inngest", "agent-turn", "Mastra", "MCP", "OPA", "Screen Command DSL", "typed delivery adapter"],
        turn: redactedTurnSummary(turn),
        resultRef: event.data?.resultRef || null,
        redaction: publicLongWorkflowRedaction(),
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

function platformRunnerNotConfigured({
  eventName,
  schema,
  workflow,
}: {
  eventName: string;
  schema: string;
  workflow: string;
}) {
  return {
    ok: false,
    eventName,
    schema,
    workflow,
    queuedOnly: false,
    reason: "platform-runner-not-configured",
    requiredPath: ["Inngest", "agent-turn", "Mastra", "MCP", "OPA"],
    generatedBenchmarkHarnessRestored: false,
    redaction: publicLongWorkflowRedaction(),
  };
}

function redactedTurnSummary(turn: JsonObject) {
  const latest = Array.isArray(turn.toolResults) ? turn.toolResults.at(-1) : null;
  return {
    schema: turn.schema || null,
    ok: Boolean(turn.ok),
    status: turn.status || null,
    turnId: turn.turnId || null,
    traceId: turn.traceId || null,
    route: turn.route ? {
      schema: turn.route.schema || null,
      route: turn.route.route || null,
      action: turn.route.action || null,
      intent: turn.route.intent || null,
      source: turn.route.source || null,
    } : null,
    latestTool: latest ? {
      schema: latest.schema || null,
      ok: Boolean(latest.ok),
      family: latest.family || null,
      summaryRedacted: Boolean(latest.summary),
      diagnostics: publicDiagnostics(latest.diagnostics),
      evidenceKeys: Object.keys(objectOrEmpty(latest.evidence)).sort(),
      resultKeys: Object.keys(objectOrEmpty(latest.result)).sort(),
      sideEffectCount: Array.isArray(latest.sideEffects) ? latest.sideEffects.length : 0,
    } : null,
    toolResultCount: Array.isArray(turn.toolResults) ? turn.toolResults.length : 0,
    sideEffectCount: Array.isArray(turn.sideEffects) ? turn.sideEffects.length : 0,
  };
}

function publicDiagnostics(value: any) {
  const diagnostics = objectOrEmpty(value);
  return {
    operation: diagnostics.operation || null,
    capability: diagnostics.capability || null,
    mcpToolName: diagnostics.mcpToolName || null,
    traceId: diagnostics.traceId || null,
    policyDecisionId: diagnostics.policyDecisionId || null,
    failedStage: diagnostics.failedStage || null,
    adapter: diagnostics.adapter || null,
    reason: diagnostics.reason || null,
  };
}

function publicLongWorkflowRedaction() {
  return {
    rawUserText: false,
    rawParams: false,
    rawCommand: false,
    rawOutput: false,
    rawSessionLogs: false,
    rawDailyNotes: false,
  };
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
