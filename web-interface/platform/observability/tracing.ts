import { context, SpanStatusCode, trace, type Span, type SpanOptions } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import { getLangfuseConfig } from "../config/platform-config.ts";

let sdk: NodeSDK | null = null;

export type WalnutSpanName =
  | "walnut.agent.turn"
  | "walnut.intent.route"
  | "walnut.tool.call"
  | "walnut.policy.decision";

export const WALNUT_SPAN_ATTRIBUTE_ALLOWLIST = [
  "walnut.session_id",
  "walnut.turn_id",
  "walnut.route",
  "walnut.tool_name",
  "walnut.action_id",
  "walnut.policy_decision_id",
  "walnut.playlist_hash",
  "walnut.build_id",
] as const;

export type WalnutSpanAttributeKey = (typeof WALNUT_SPAN_ATTRIBUTE_ALLOWLIST)[number];
export type WalnutSpanAttributes = Partial<Record<WalnutSpanAttributeKey, string | null | undefined>>;

export function getWalnutTracer() {
  return trace.getTracer("walnutpi-agent-platform", "0.1.0");
}

export function sanitizeWalnutSpanAttributes(attributes: WalnutSpanAttributes = {}) {
  const sanitized: Record<WalnutSpanAttributeKey, string> = {} as Record<WalnutSpanAttributeKey, string>;
  for (const key of WALNUT_SPAN_ATTRIBUTE_ALLOWLIST) {
    const value = attributes[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (!text) continue;
    sanitized[key] = text;
  }
  return sanitized;
}

export function setWalnutSpanAttributes(span: Span, attributes: WalnutSpanAttributes = {}) {
  span.setAttributes(sanitizeWalnutSpanAttributes(attributes));
}

export function startWalnutSpan(
  name: WalnutSpanName,
  attributes: WalnutSpanAttributes = {},
  options: SpanOptions = {},
) {
  const span = getWalnutTracer().startSpan(name, options);
  setWalnutSpanAttributes(span, attributes);
  return span;
}

export function withWalnutSpan<T>(
  name: WalnutSpanName,
  attributes: WalnutSpanAttributes,
  callback: (span: Span) => T,
  options: SpanOptions = {},
): T {
  const span = startWalnutSpan(name, attributes, options);
  const spanContext = trace.setSpan(context.active(), span);
  let asyncResult = false;
  try {
    const result = context.with(spanContext, () => callback(span));
    if (isPromiseLike(result)) {
      asyncResult = true;
      return Promise.resolve(result).then(
        (value) => {
          span.setStatus({ code: SpanStatusCode.OK });
          return value;
        },
        (error) => {
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        },
      ).finally(() => span.end()) as T;
    }
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    if (!asyncResult) span.end();
  }
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

function isPromiseLike<T>(value: T | PromiseLike<Awaited<T>>): value is PromiseLike<Awaited<T>> {
  return Boolean(value && typeof (value as PromiseLike<Awaited<T>>).then === "function");
}
