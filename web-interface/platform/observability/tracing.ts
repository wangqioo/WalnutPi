import { trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import { getLangfuseConfig } from "../config/platform-config.ts";

let sdk: NodeSDK | null = null;

export function getWalnutTracer() {
  return trace.getTracer("walnutpi-agent-platform", "0.1.0");
}

export function createWalnutOpenTelemetrySdk({
  enableLangfuse = getLangfuseConfig().enabled && getLangfuseConfig().configured,
} = {}) {
  const langfuse = getLangfuseConfig();
  const spanProcessors = enableLangfuse
    ? [
      new LangfuseSpanProcessor({
        publicKey: langfuse.publicKey,
        secretKey: langfuse.secretKey,
        baseUrl: langfuse.baseUrl,
        mediaUploadEnabled: false,
        shouldExportSpan: ({ otelSpan }) => otelSpan.name.startsWith("walnut."),
      }),
    ]
    : [];
  return new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "walnutpi-agent-platform",
      [ATTR_SERVICE_VERSION]: "0.1.0",
    }),
    spanProcessors,
  } as any);
}

export function startWalnutObservability() {
  if (sdk) return { ok: true, alreadyStarted: true, sdk };
  sdk = createWalnutOpenTelemetrySdk();
  sdk.start();
  return { ok: true, alreadyStarted: false, sdk };
}

export function createWalnutLangfuseClient() {
  const langfuse = getLangfuseConfig();
  if (!langfuse.enabled || !langfuse.configured) {
    return {
      ok: false,
      skipped: true,
      reason: "Langfuse credentials are not configured in the platform config secret source",
      client: null,
    };
  }
  return {
    ok: true,
    skipped: false,
    client: new LangfuseClient({
      publicKey: langfuse.publicKey,
      secretKey: langfuse.secretKey,
      baseUrl: langfuse.baseUrl,
      timeout: 2,
    }),
  };
}
