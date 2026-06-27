import { createHash } from "node:crypto";
import { and, inArray, sql } from "drizzle-orm";
import { createWalnutPostgresClient } from "../db/client.ts";
import { retrievalEmbeddingRecords } from "../db/schema.ts";
import { createRetrievalEmbeddingProvider } from "./embedding-provider.ts";

type JsonObject = Record<string, any>;

export const RETRIEVAL_EMBEDDING_DIMENSIONS = 384;
const ALLOWED_SOURCE_KINDS = new Set(["approved_memory", "curated_corpus"]);
const ALLOWED_SOURCE_TABLES = new Set(["durable_memory_records", "retrieval_documents"]);

export function createRetrievalEmbeddingIndex({
  postgresClientFactory = createWalnutPostgresClient,
  embeddingProvider = createRetrievalEmbeddingProvider(),
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
    if (!embeddingProvider?.configured) {
      return {
        ok: false,
        indexed: false,
        sourceKind: normalized.sourceKind,
        sourceId: normalized.sourceId,
        reason: embeddingProvider?.reason || "retrieval embedding provider is not configured",
        embeddingProviderConfigured: false,
      };
    }
    if (!sourceMayLeaveControlPlane(normalized)) {
      return {
        ok: false,
        indexed: false,
        sourceKind: normalized.sourceKind,
        sourceId: normalized.sourceId,
        reason: "source is not approved for remote embedding",
        embeddingProviderConfigured: true,
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
      const embedding = await embeddingProvider.embedText(normalized.text, {
        dimensions: RETRIEVAL_EMBEDDING_DIMENSIONS,
        sourceKind: normalized.sourceKind,
        textHash,
      });
      if (!Array.isArray(embedding) || embedding.length !== RETRIEVAL_EMBEDDING_DIMENSIONS) {
        return {
          ok: false,
          indexed: false,
          reason: `embedding dimension mismatch: expected ${RETRIEVAL_EMBEDDING_DIMENSIONS}`,
        };
      }
      const embeddingModel = cleanEmbeddingModel(embeddingProvider.model);
      await client.db
        .insert(retrievalEmbeddingRecords)
        .values({
          sourceKind: normalized.sourceKind,
          sourceTable: normalized.sourceTable,
          sourceId: normalized.sourceId,
          source: normalized.source,
          textHash,
          embeddingModel,
          embedding,
          metadata: normalized.metadata,
        })
        .onConflictDoUpdate({
          target: [retrievalEmbeddingRecords.sourceKind, retrievalEmbeddingRecords.sourceId],
          set: {
            sourceTable: normalized.sourceTable,
            source: normalized.source,
            textHash,
            embeddingModel,
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
        embeddingModel,
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
      ok: results.every((result) =>
        result.ok
        || result.reason === "source kind is not indexable"
        || result.reason === "source is not approved for remote embedding"
      ),
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
  for (const key of ["categoryKey", "sourceTool", "documentKind", "approvedAt", "embeddingConsent", "remoteEmbeddingAllowed"]) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

function hashText(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sourceMayLeaveControlPlane(source: JsonObject) {
  if (source.sourceKind === "curated_corpus") return true;
  if (source.sourceKind !== "approved_memory") return false;
  return source.metadata?.embeddingConsent === "approved" && source.metadata?.remoteEmbeddingAllowed === true;
}

function cleanEmbeddingModel(value: any) {
  const model = String(value || "").trim();
  if (!model) throw new Error("retrieval embedding model is not configured");
  return model;
}
