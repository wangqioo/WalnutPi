import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embed } from "ai";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadPlatformConfig } from "../config/platform-config.ts";

type JsonObject = Record<string, any>;

export type RetrievalEmbeddingProvider = {
  configured: boolean;
  model: string | null;
  dimensions: number;
  reason: string | null;
  embedText(text: string, context: JsonObject): Promise<number[]>;
};

export function createRetrievalEmbeddingProvider({
  config = objectOrEmpty(loadPlatformConfig().retrievalEmbeddings),
}: {
  config?: JsonObject | null;
} = {}): RetrievalEmbeddingProvider {
  const providerConfig = objectOrEmpty(config);
  const enabled = providerConfig.enabled === true;
  const model = cleanText(providerConfig.model);
  const baseUrl = cleanText(providerConfig.baseUrl);
  const apiKey = cleanText(providerConfig.apiKey) || resolveSecretSource(objectOrEmpty(providerConfig.apiKeySource));
  const providerName = cleanText(providerConfig.provider) || "openai-compatible";
  const dimensions = normalizeDimensions(providerConfig.dimensions);

  if (!enabled) {
    return disabledProvider("retrieval embedding provider is not enabled", dimensions);
  }
  if (providerName !== "openai-compatible") {
    return disabledProvider(`unsupported retrieval embedding provider: ${providerName}`, dimensions);
  }
  if (!model) {
    return disabledProvider("retrieval embedding model is not configured", dimensions);
  }
  if (!baseUrl || !apiKey) {
    return disabledProvider("retrieval embedding provider baseUrl/apiKey is not configured", dimensions, model);
  }

  const provider = createOpenAICompatible({
    name: "walnut-retrieval-embeddings",
    baseURL: baseUrl.replace(/\/+$/, ""),
    apiKey,
  });

  return {
    configured: true,
    model,
    dimensions,
    reason: null,
    async embedText(text: string) {
      const result = await embed({
        model: provider.embeddingModel(model),
        value: text,
        providerOptions: {
          "walnut-retrieval-embeddings": {
            dimensions,
          },
        },
        maxRetries: 1,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "walnut.retrieval.embed",
        },
      });
      return result.embedding.map((value) => Number(value));
    },
  };
}

function disabledProvider(reason: string, dimensions: number, model: string | null = null): RetrievalEmbeddingProvider {
  return {
    configured: false,
    model,
    dimensions,
    reason,
    async embedText() {
      throw new Error(reason);
    },
  };
}

function normalizeDimensions(value: any) {
  const dimensions = Number(value || 384);
  return Number.isFinite(dimensions) && dimensions > 0 ? Math.trunc(dimensions) : 384;
}

function cleanText(value: any) {
  return String(value || "").trim();
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveSecretSource(source: JsonObject) {
  if (source.kind === "env") return cleanText(process.env[source.name]);
  if (source.kind === "literal") return cleanText(source.value);
  if (source.kind === "codex-auth") {
    const filePath = resolveHomePath(source.path);
    if (!existsSync(filePath)) return "";
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return cleanText(parsed[source.key || "OPENAI_API_KEY"]);
  }
  return "";
}

function resolveHomePath(value: string) {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(home, value.slice(2));
  return path.resolve(value);
}
