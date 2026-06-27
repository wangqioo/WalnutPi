import { Inngest } from "inngest";
import { createPendingEvalScore, getCuratedEvalCase, listCuratedEvalCases } from "../eval/curated-eval.ts";
import { createRetrievalReindexWorkflow } from "../memory/retrieval-reindex-workflow.ts";

export const walnutInngest = new Inngest({
  id: "walnutpi",
});

export const collectDeviceEvidenceFunction = walnutInngest.createFunction(
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

export const syncScreenPlaylistFunction = walnutInngest.createFunction(
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

export const runCuratedEvalCaseFunction = walnutInngest.createFunction(
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
    return {
      ok: true,
      eventName: event.name,
      case: evalCase,
      score: createPendingEvalScore(evalCase, {
        variantId: String(event.data?.variantId || "local-platform"),
        reason: "queued curated eval case; execution must attach a redacted platform trace before scoring",
        evidenceRefs: [`curated-eval-case:${evalCase.id}`],
      }),
      langfuse: {
        datasetItemId: event.data?.langfuseDatasetItemId || null,
        traceId: event.data?.traceId || null,
        rawPrivateContentAllowed: false,
      },
    };
  },
);

export const fanoutCuratedEvalFunction = walnutInngest.createFunction(
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

export const nightlyDriftCheckFunction = walnutInngest.createFunction(
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

export const reindexRetrievalEmbeddingsFunction = walnutInngest.createFunction(
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

export const walnutInngestFunctions = [
  collectDeviceEvidenceFunction,
  syncScreenPlaylistFunction,
  reindexRetrievalEmbeddingsFunction,
  runCuratedEvalCaseFunction,
  fanoutCuratedEvalFunction,
  nightlyDriftCheckFunction,
];
