import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_LIMIT = 200;
const MAX_SUMMARY_EVENTS = 1000;

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function usageSummary(usage) {
  if (!isPlainObject(usage)) return null;
  const inputTokens = numberOrNull(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = numberOrNull(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = numberOrNull(usage.total_tokens);
  const inputDetails = isPlainObject(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outputDetails = isPlainObject(usage.output_tokens_details) ? usage.output_tokens_details : {};
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || null),
    cachedTokens: numberOrNull(inputDetails.cached_tokens),
    reasoningTokens: numberOrNull(outputDetails.reasoning_tokens),
  };
}

function cleanEvent(event) {
  const timestamp = event.timestamp || nowIso();
  return {
    timestamp,
    kind: String(event.kind || "event").slice(0, 80),
    operation: String(event.operation || "").slice(0, 120),
    ok: typeof event.ok === "boolean" ? event.ok : null,
    latencyMs: numberOrNull(event.latencyMs),
    status: numberOrNull(event.status),
    model: event.model ? String(event.model).slice(0, 80) : null,
    reasoningEffort: event.reasoningEffort ? String(event.reasoningEffort).slice(0, 40) : null,
    usage: usageSummary(event.usage),
    route: event.route ? String(event.route).slice(0, 120) : null,
    action: event.action ? String(event.action).slice(0, 80) : null,
    stage: event.stage ? String(event.stage).slice(0, 80) : null,
    source: event.source ? String(event.source).slice(0, 80) : null,
    mode: event.mode ? String(event.mode).slice(0, 40) : null,
    buildId: event.buildId ? String(event.buildId).slice(0, 80) : null,
    manifestHash: event.manifestHash ? String(event.manifestHash).slice(0, 80) : null,
    requestId: event.requestId ? String(event.requestId).slice(0, 120) : null,
    error: event.error ? String(event.error).slice(0, 500) : null,
  };
}

function summarize(events) {
  const summary = {
    totalEvents: events.length,
    byKind: {},
    byOperation: {},
    failures: 0,
    latency: {},
    tokens: {
      input: 0,
      output: 0,
      total: 0,
      cached: 0,
      reasoning: 0,
    },
  };

  const latencies = new Map();
  for (const event of events) {
    summary.byKind[event.kind] = (summary.byKind[event.kind] || 0) + 1;
    if (event.operation) summary.byOperation[event.operation] = (summary.byOperation[event.operation] || 0) + 1;
    if (event.ok === false) summary.failures += 1;
    if (Number.isFinite(event.latencyMs)) {
      const key = event.operation || event.kind;
      if (!latencies.has(key)) latencies.set(key, []);
      latencies.get(key).push(event.latencyMs);
    }
    if (event.usage) {
      summary.tokens.input += event.usage.inputTokens || 0;
      summary.tokens.output += event.usage.outputTokens || 0;
      summary.tokens.total += event.usage.totalTokens || 0;
      summary.tokens.cached += event.usage.cachedTokens || 0;
      summary.tokens.reasoning += event.usage.reasoningTokens || 0;
    }
  }

  for (const [key, values] of latencies.entries()) {
    values.sort((a, b) => a - b);
    const sum = values.reduce((total, value) => total + value, 0);
    summary.latency[key] = {
      count: values.length,
      avgMs: Math.round(sum / values.length),
      minMs: values[0],
      p50Ms: values[Math.floor((values.length - 1) * 0.5)],
      p95Ms: values[Math.floor((values.length - 1) * 0.95)],
      maxMs: values[values.length - 1],
    };
  }

  return summary;
}

export function createWebMetricsLedger({ metricsPath, limit = DEFAULT_LIMIT }) {
  async function append(event) {
    const clean = cleanEvent(event);
    try {
      await mkdir(path.dirname(metricsPath), { recursive: true });
      await writeFile(metricsPath, `${JSON.stringify(clean)}\n`, { flag: "a" });
    } catch {
      // Metrics must never break user workflows.
    }
    return clean;
  }

  async function readRecent(requestedLimit = limit) {
    try {
      await stat(metricsPath);
    } catch {
      return [];
    }
    const text = await readFile(metricsPath, "utf8");
    const lines = text.trim().split(/\r?\n/).filter(Boolean).slice(-Math.max(1, requestedLimit));
    return lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }

  async function report(requestedLimit = limit) {
    const events = await readRecent(Math.min(MAX_SUMMARY_EVENTS, requestedLimit));
    return {
      ok: true,
      schema: "walnutpi.webMetrics.v1",
      metricsPath,
      summary: summarize(events),
      events: events.slice(-Math.max(1, Math.min(limit, requestedLimit))),
    };
  }

  return {
    append,
    report,
    usageSummary,
  };
}
