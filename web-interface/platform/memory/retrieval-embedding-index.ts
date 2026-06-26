import { createHash } from "node:crypto";
import { and, inArray, sql } from "drizzle-orm";
import { createWalnutPostgresClient } from "../db/client.ts";
import { retrievalEmbeddingRecords } from "../db/schema.ts";

type JsonObject = Record<string, any>;

export const RETRIEVAL_EMBEDDING_DIMENSIONS = 384;
export const RETRIEVAL_EMBEDDING_MODEL = `walnutpi.local-hash.${RETRIEVAL_EMBEDDING_DIMENSIONS}`;
const ALLOWED_SOURCE_KINDS = new Set(["approved_memory", "curated_corpus"]);
const ALLOWED_SOURCE_TABLES = new Set(["durable_memory_records", "retrieval_documents"]);

export function createRetrievalEmbeddingIndex({
  postgresClientFactory = createWalnutPostgresClient,
  embedText = deterministicEmbedding,
}: JsonObject = {}) {
  async function upsertSource(source: JsonObject) {
    const normalized = normalizeSource(source);
    if (!normalized.ok) {
      return {
        ok: false,
        indexed: false,
        reason: normalized.reason,
      };
    }
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) {
      return {
        ok: false,
        indexed: false,
        reason: client?.reason || "database url is not configured",
      };
    }
    try {
      const textHash = hashText(normalized.text);
      const embedding = await embedText(normalized.text, {
        dimensions: RETRIEVAL_EMBEDDING_DIMENSIONS,
        sourceKind: normalized.sourceKind,
      });
      if (!Array.isArray(embedding) || embedding.length !== RETRIEVAL_EMBEDDING_DIMENSIONS) {
        return {
          ok: false,
          indexed: false,
          reason: `embedding dimension mismatch: expected ${RETRIEVAL_EMBEDDING_DIMENSIONS}`,
        };
      }
      await client.db
        .insert(retrievalEmbeddingRecords)
        .values({
          sourceKind: normalized.sourceKind,
          sourceTable: normalized.sourceTable,
          sourceId: normalized.sourceId,
          source: normalized.source,
          textHash,
          embeddingModel: RETRIEVAL_EMBEDDING_MODEL,
          embedding,
          metadata: normalized.metadata,
        })
        .onConflictDoUpdate({
          target: [retrievalEmbeddingRecords.sourceKind, retrievalEmbeddingRecords.sourceId],
          set: {
            sourceTable: normalized.sourceTable,
            source: normalized.source,
            textHash,
            embeddingModel: RETRIEVAL_EMBEDDING_MODEL,
            embedding,
            metadata: normalized.metadata,
            updatedAt: sql`now()`,
          },
        });
      return {
        ok: true,
        indexed: true,
        sourceKind: normalized.sourceKind,
        sourceId: normalized.sourceId,
        textHash,
        embeddingModel: RETRIEVAL_EMBEDDING_MODEL,
      };
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  async function upsertSources(sources: JsonObject[]) {
    const results = [];
    for (const source of sources) {
      results.push(await upsertSource(source));
    }
    return {
      ok: results.every((result) => result.ok || result.reason === "source kind is not indexable"),
      indexed: results.filter((result) => result.indexed).length,
      refused: results.filter((result) => !result.indexed),
      results,
    };
  }

  async function readForSources(sources: JsonObject[]) {
    const normalized = sources
      .map((source) => normalizeSource(source))
      .filter((source) => source.ok);
    if (!normalized.length) return [];
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) return [];
    try {
      const ids = normalized.map((source) => source.sourceId);
      return client.db
        .select()
        .from(retrievalEmbeddingRecords)
        .where(and(
          inArray(retrievalEmbeddingRecords.sourceId, ids),
          inArray(retrievalEmbeddingRecords.sourceKind, ["approved_memory", "curated_corpus"]),
        ));
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  return {
    upsertSource,
    upsertSources,
    readForSources,
  };
}

function normalizeSource(source: JsonObject) {
  const sourceKind = String(source.sourceKind || "");
  const sourceTable = String(source.sourceTable || "");
  const sourceId = String(source.sourceId || source.id || "");
  const text = String(source.text || source.body || source.memoryText || "");
  if (!ALLOWED_SOURCE_KINDS.has(sourceKind)) return { ok: false, reason: "source kind is not indexable" };
  if (!ALLOWED_SOURCE_TABLES.has(sourceTable)) return { ok: false, reason: "source table is not indexable" };
  if (!sourceId) return { ok: false, reason: "source id is required" };
  if (!text.trim()) return { ok: false, reason: "source text is required" };
  return {
    ok: true,
    sourceKind,
    sourceTable,
    sourceId,
    source: String(source.source || `${sourceTable}:${sourceId}`),
    text,
    metadata: publicMetadata(source.metadata),
  };
}

function publicMetadata(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: JsonObject = {};
  for (const key of ["categoryKey", "sourceTool", "documentKind", "approvedAt"]) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

function hashText(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicEmbedding(value: string, { dimensions = RETRIEVAL_EMBEDDING_DIMENSIONS }: JsonObject = {}) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = String(value || "").toLowerCase().match(/[a-z0-9_./:-]+|[\u4e00-\u9fff]{1,}/g) || [];
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    for (let offset = 0; offset < digest.length; offset += 2) {
      const bucket = ((digest[offset] << 8) + digest[offset + 1]) % dimensions;
      vector[bucket] += 1;
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(8)));
}
