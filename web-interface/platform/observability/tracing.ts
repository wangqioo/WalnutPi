import { context, SpanStatusCode, trace, type Span, type SpanOptions } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import { getLangfuseConfig } from "../config/platform-config.ts";

let sdk: NodeSDK | null = null;
let lastStartStatus: WalnutObservabilityStatus | null = null;

export type WalnutSpanName =
  | "walnut.agent.turn"
  | "walnut.intent.route"
  | "walnut.tool.call"
  | "walnut.policy.decision"
  | "walnut.screen.command"
  | "walnut.screen.render"
  | "walnut.screen.sync"
  | "walnut.device.action"
  | "walnut.memory.retrieve"
  | "walnut.widget_app.sync";

export const WALNUT_SPAN_ATTRIBUTE_ALLOWLIST = [
  "walnut.trace_id",
  "walnut.session_id",
  "walnut.turn_id",
  "walnut.route",
  "walnut.tool_name",
  "walnut.action_id",
  "walnut.policy_decision_id",
  "walnut.device_profile",
  "walnut.operation",
  "walnut.playlist_hash",
  "walnut.build_id",
] as const;

export type WalnutSpanAttributeKey = (typeof WALNUT_SPAN_ATTRIBUTE_ALLOWLIST)[number];
export type WalnutSpanAttributes = Partial<Record<WalnutSpanAttributeKey, string | null | undefined>>;
export type WalnutObservabilityStatus = {
  ok: boolean;
  schema: "walnutpi.observability.status.v1";
  enabled: boolean;
  configured: boolean;
  exporterEnabled: boolean;
  started: boolean;
  alreadyStarted: boolean;
  baseUrlHost: string | null;
  publicKeyPrefix: string | null;
  error: string | null;
};

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
  setLangfuseTraceAttributes(span, name, attributes);
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
  if (sdk) {
    lastStartStatus = createObservabilityStatus({
      ok: true,
      started: true,
      alreadyStarted: true,
      error: null,
    });
    return { ...lastStartStatus, sdk };
  }
  try {
    sdk = createWalnutOpenTelemetrySdk();
    sdk.start();
    lastStartStatus = createObservabilityStatus({
      ok: true,
      started: true,
      alreadyStarted: false,
      error: null,
    });
    return { ...lastStartStatus, sdk };
  } catch (error: any) {
    sdk = null;
    lastStartStatus = createObservabilityStatus({
      ok: false,
      started: false,
      alreadyStarted: false,
      error: error?.message || "failed to start WalnutPi observability",
    });
    return { ...lastStartStatus, sdk: null };
  }
}

export function getWalnutObservabilityStatus(): WalnutObservabilityStatus {
  return lastStartStatus || createObservabilityStatus({
    ok: false,
    started: false,
    alreadyStarted: false,
    error: "WalnutPi observability has not been started",
  });
}

export function activeWalnutTraceId() {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext?.traceId && spanContext.traceId !== "00000000000000000000000000000000"
    ? spanContext.traceId
    : null;
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

function setLangfuseTraceAttributes(
  span: Span,
  name: WalnutSpanName,
  attributes: WalnutSpanAttributes = {},
) {
  const safe: Record<string, string> = {
    "langfuse.trace.name": name,
  };
  const sessionId = sanitizeLangfuseId(attributes["walnut.session_id"]);
  if (sessionId) {
    safe["session.id"] = sessionId;
    safe["langfuse.session.id"] = sessionId;
  }
  span.setAttributes(safe);
}

function createObservabilityStatus({
  ok,
  started,
  alreadyStarted,
  error,
}: {
  ok: boolean;
  started: boolean;
  alreadyStarted: boolean;
  error: string | null;
}): WalnutObservabilityStatus {
  const langfuse = getLangfuseConfig();
  return {
    ok,
    schema: "walnutpi.observability.status.v1",
    enabled: Boolean(langfuse.enabled),
    configured: Boolean(langfuse.configured),
    exporterEnabled: Boolean(langfuse.enabled && langfuse.configured),
    started,
    alreadyStarted,
    baseUrlHost: hostOnly(langfuse.baseUrl),
    publicKeyPrefix: langfuse.publicKey ? `${langfuse.publicKey.slice(0, 8)}...` : null,
    error,
  };
}

function hostOnly(value: string) {
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

function sanitizeLangfuseId(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || text.length > 200) return null;
  return /^[\x20-\x7E]+$/.test(text) ? text : null;
}

function isPromiseLike<T>(value: T | PromiseLike<Awaited<T>>): value is PromiseLike<Awaited<T>> {
  return Boolean(value && typeof (value as PromiseLike<Awaited<T>>).then === "function");
}
