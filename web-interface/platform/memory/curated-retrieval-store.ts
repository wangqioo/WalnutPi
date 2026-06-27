import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { createWalnutPostgresClient } from "../db/client.ts";
import { durableMemoryRecords, retrievalDocuments, retrievalEmbeddingRecords } from "../db/schema.ts";

type JsonObject = Record<string, any>;

export function createCuratedRetrievalStore({
  postgresClientFactory = createWalnutPostgresClient,
  resultLimit = 8,
}: JsonObject = {}) {
  async function retrieve(query: string, options: JsonObject = {}) {
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) {
      return {
        ok: false,
        skipped: true,
        reason: client?.reason || "database url is not configured",
        results: [],
      };
    }
    const limit = Math.max(1, Math.min(25, Number(options.resultLimit || resultLimit) || resultLimit));
    const terms = tokenizeQuery(query);
    try {
      const [memoryRows, documentRows] = await Promise.all([
        readApprovedMemory(client.db, terms, limit),
        readCuratedDocuments(client.db, terms, limit),
      ]);
      const indexedRows = await readIndexedSourceRows(client.db, [
        ...memoryRows.map((row: JsonObject) => row.id),
        ...documentRows.map((row: JsonObject) => row.id),
      ]);
      const results = [
        ...memoryRows.map((row: JsonObject) => retrievalResult({
          id: row.id,
          source: `durable-memory:${row.id}`,
          sourceKind: "approved_memory",
          title: row.categoryKey,
          body: row.memoryText,
          metadata: row.metadata,
          createdAt: row.createdAt,
          terms,
        })),
        ...documentRows.map((row: JsonObject) => retrievalResult({
          id: row.id,
          source: row.source,
          sourceKind: row.sourceKind,
          title: row.title,
          body: row.body,
          metadata: row.metadata,
          createdAt: row.createdAt,
          terms,
        })),
      ]
        .filter((item) => item.score > 0 || terms.length === 0)
        .sort((a, b) => b.score - a.score || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, limit);
      return {
        ok: true,
        skipped: false,
        reason: null,
        index: {
          source: "pgvector",
          embeddingModels: [...new Set(indexedRows.map((row: JsonObject) => row.embeddingModel).filter(Boolean))],
          indexed: indexedRows.length,
          writePath: "inngest.retrieval.reindex",
        },
        results,
      };
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  return {
    retrieve,
  };
}

async function readIndexedSourceRows(db: JsonObject, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({
      sourceKind: retrievalEmbeddingRecords.sourceKind,
      sourceId: retrievalEmbeddingRecords.sourceId,
      embeddingModel: retrievalEmbeddingRecords.embeddingModel,
    })
    .from(retrievalEmbeddingRecords)
    .where(and(
      inArray(retrievalEmbeddingRecords.sourceKind, ["approved_memory", "curated_corpus"]),
      inArray(retrievalEmbeddingRecords.sourceId, ids),
    ));
}

async function readApprovedMemory(db: JsonObject, terms: string[], limit: number) {
  const base = db
    .select()
    .from(durableMemoryRecords)
    .where(eq(durableMemoryRecords.status, "approved"))
    .orderBy(desc(durableMemoryRecords.approvedAt))
    .limit(limit);
  if (!terms.length) return base;
  return db
    .select()
    .from(durableMemoryRecords)
    .where(and(
      eq(durableMemoryRecords.status, "approved"),
      or(...terms.map((term) => ilike(durableMemoryRecords.memoryText, `%${term}%`))),
    ))
    .orderBy(desc(durableMemoryRecords.approvedAt))
    .limit(limit);
}

async function readCuratedDocuments(db: JsonObject, terms: string[], limit: number) {
  const sourceAllowed = sql`${retrievalDocuments.sourceKind} in ('curated_corpus', 'approved_memory', 'skill_doc', 'adr_doc')`;
  const base = db
    .select()
    .from(retrievalDocuments)
    .where(and(eq(retrievalDocuments.status, "curated"), sourceAllowed))
    .orderBy(desc(retrievalDocuments.createdAt))
    .limit(limit);
  if (!terms.length) return base;
  return db
    .select()
    .from(retrievalDocuments)
    .where(and(
      eq(retrievalDocuments.status, "curated"),
      sourceAllowed,
      or(...terms.flatMap((term) => [
        ilike(retrievalDocuments.title, `%${term}%`),
        ilike(retrievalDocuments.body, `%${term}%`),
      ])),
    ))
    .orderBy(desc(retrievalDocuments.createdAt))
    .limit(limit);
}

function retrievalResult({ id, source, sourceKind, title, body, metadata, createdAt, terms }: JsonObject) {
  const text = String(body || "");
  return {
    id: String(id || ""),
    source: String(source || ""),
    sourceKind: String(sourceKind || ""),
    title: String(title || ""),
    score: scoreText(`${title}\n${text}`, terms),
    preview: text.slice(0, 1200),
    metadata: publicMetadata(metadata),
    createdAt,
  };
}

function tokenizeQuery(value: any) {
  return [...new Set(String(value || "")
    .toLowerCase()
    .match(/[a-z0-9_./:-]+|[\u4e00-\u9fff]{2,}/g) || [])]
    .slice(0, 12);
}

function scoreText(value: string, terms: string[]) {
  if (!terms.length) return 1;
  const haystack = value.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function publicMetadata(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: JsonObject = {};
  for (const key of ["categoryKey", "sourceTool", "documentKind", "approvedAt"]) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}
