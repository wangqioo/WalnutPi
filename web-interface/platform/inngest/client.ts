import { Inngest } from "inngest";
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
  reindexRetrievalEmbeddingsFunction,
];
