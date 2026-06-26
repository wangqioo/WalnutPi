import { and, eq } from "drizzle-orm";
import { createWalnutPostgresClient } from "../db/client.ts";
import { durableMemoryRecords, retrievalDocuments } from "../db/schema.ts";
import { createRetrievalEmbeddingIndex } from "./retrieval-embedding-index.ts";

type JsonObject = Record<string, any>;

export function createRetrievalReindexWorkflow({
  postgresClientFactory = createWalnutPostgresClient,
  embeddingIndex = createRetrievalEmbeddingIndex({ postgresClientFactory }),
  batchLimit = 100,
}: JsonObject = {}) {
  async function run(options: JsonObject = {}) {
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) {
      return {
        ok: false,
        indexed: 0,
        refused: 0,
        reason: client?.reason || "database url is not configured",
      };
    }
    const limit = Math.max(1, Math.min(500, Number(options.limit || batchLimit) || batchLimit));
    try {
      const [memoryRows, documentRows] = await Promise.all([
        client.db
          .select()
          .from(durableMemoryRecords)
          .where(eq(durableMemoryRecords.status, "approved"))
          .limit(limit),
        client.db
          .select()
          .from(retrievalDocuments)
          .where(and(
            eq(retrievalDocuments.status, "curated"),
            eq(retrievalDocuments.sourceKind, "curated_corpus"),
          ))
          .limit(limit),
      ]);
      const result = await embeddingIndex.upsertSources([
        ...memoryRows.map(memorySource),
        ...documentRows.map(documentSource),
      ]);
      return {
        ok: result.ok,
        indexed: result.indexed,
        refused: result.refused.length,
        sourceKinds: [...new Set(result.results.map((item: JsonObject) => item.sourceKind).filter(Boolean))],
      };
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  return {
    run,
  };
}

function memorySource(row: JsonObject) {
  return {
    sourceKind: "approved_memory",
    sourceTable: "durable_memory_records",
    sourceId: row.id,
    source: `durable-memory:${row.id}`,
    text: row.memoryText,
    metadata: {
      ...(row.metadata || {}),
      categoryKey: row.categoryKey,
      sourceTool: row.sourceTool,
      approvedAt: row.approvedAt,
    },
  };
}

function documentSource(row: JsonObject) {
  return {
    sourceKind: "curated_corpus",
    sourceTable: "retrieval_documents",
    sourceId: row.id,
    source: row.source,
    text: `${row.title}\n${row.body}`,
    metadata: row.metadata,
  };
}
