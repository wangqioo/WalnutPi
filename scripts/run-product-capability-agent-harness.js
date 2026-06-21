#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const defaultCases = path.join(root, "docs", "product-capability-benchmarks.v2.jsonl");
const defaultOutputRoot = path.join(root, "screen", "benchmark-runs");

if (import.meta.main) await main();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheck) {
    await selfCheck();
    return;
  }

  const baseUrl = args.baseUrl || "http://127.0.0.1:4173";
  const baseUrlReachableBeforeStart = await canReach(baseUrl);
  const server = await ensureWebServer(baseUrl, { knownReachable: baseUrlReachableBeforeStart });
  try {
    await runHarness({
      args,
      baseUrl,
      preflightContext: {
        baseUrlReachableBeforeStart,
        webServerStarted: server.started,
      },
    });
  } finally {
    await server.stop();
  }
}

async function runHarness({ args, baseUrl, preflightContext = {} }) {
  const cases = selectCases(validateCases(await readJsonl(args.file || defaultCases)), args);
  if (!cases.length) throw new Error(`no benchmark cases matched${args.caseId ? ` ${args.caseId}` : ""}`);

  const runId = args.runId || `agent-harness-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const outDir = path.join(args.outputDir || defaultOutputRoot, runId);
  const turnDir = path.join(outDir, "agent-turns");
  await mkdir(turnDir, { recursive: true });

  const devicePreflight = await collectDevicePreflightMetadata({ args, baseUrl, ...preflightContext });
  const preflightPath = path.join(outDir, "device-preflight.json");
  await writeJson(preflightPath, devicePreflight);
  if (devicePreflight.includeDevice || devicePreflight.profile === "device") {
    console.error(`[device-preflight] ${JSON.stringify(compactDevicePreflightForConsole(devicePreflight))}`);
  }
  const strictFailures = strictDevicePreflightFailures(devicePreflight);
  if (strictFailures.length) {
    const failure = new Error(`strict device preflight failed: ${strictFailures.map((item) => item.id).join(", ")}`);
    failure.failures = strictFailures;
    failure.preflightPath = path.relative(root, preflightPath).replaceAll("\\", "/");
    throw failure;
  }

  const summary = {
    schema: "walnutpi.productCapabilityAgentHarnessRun.v1",
    runId,
    baseUrl,
    profile: effectiveProfile(args),
    environment: {
      devicePreflight,
      devicePreflightPath: path.relative(root, preflightPath).replaceAll("\\", "/"),
    },
    startedAt: new Date().toISOString(),
    telemetry: emptyTelemetrySummary(),
    skipped: { profileRequirements: 0, contractOnly: 0 },
    cases: [],
  };

  for (const benchmark of cases) {
    for (const variant of variantsForCase(benchmark, args)) {
      const profileSkip = profileSkipReason(benchmark, args);
      if (profileSkip) {
        const turn = skippedProfileTurn({ benchmark, variant, runId, profile: effectiveProfile(args), reason: profileSkip });
        const turnPath = path.join(turnDir, `${safeId(benchmark.id)}-${safeId(variant.id)}.json`);
        await writeJson(turnPath, turn);
        summary.skipped.profileRequirements += 1;
        summary.cases.push(summaryCase({
          benchmark,
          variant,
          turn,
          evaluation: { verdict: "skipped", evidence: { missing: [], missingResults: [] }, safety: { forbiddenTriggered: [] } },
          settled: { ok: true, initialStatus: "skipped", finalStatus: "skipped" },
          turnPath,
        }));
        continue;
      }
      if (shouldSkipHarnessExecution(benchmark)) {
        const turn = skippedContractTurn({ benchmark, variant, runId });
        const turnPath = path.join(turnDir, `${safeId(benchmark.id)}-${safeId(variant.id)}.json`);
        await writeJson(turnPath, turn);
        summary.skipped.contractOnly += 1;
        summary.cases.push(summaryCase({
          benchmark,
          variant,
          turn,
          evaluation: { verdict: "skipped", evidence: { missing: [], missingResults: [] }, safety: { forbiddenTriggered: [] } },
          settled: { ok: true, initialStatus: "skipped", finalStatus: "skipped" },
          turnPath,
        }));
        continue;
      }
      const initialTurn = await postJson(`${baseUrl}/api/agent/turn`, {
        text: variant.input,
        sessionId: runId,
        mode: "intent",
      });
      const { turn, settled } = await settleQueuedTurn({ baseUrl, sessionId: runId, initialTurn });
      let initialTurnPath = null;
      if (initialTurn.turnId && initialTurn.turnId === turn.turnId && initialTurn !== turn) {
        initialTurnPath = path.join(turnDir, `${safeId(benchmark.id)}-${safeId(variant.id)}-initial.json`);
        await writeJson(initialTurnPath, initialTurn);
      }
      const turnPath = path.join(turnDir, `${safeId(benchmark.id)}-${safeId(variant.id)}.json`);
      await writeJson(turnPath, turn);
      const evaluation = evaluateTurn(benchmark, turn, variant);
      addTelemetry(summary.telemetry, turn.telemetry);
      summary.cases.push(summaryCase({
        benchmark,
        variant,
        turn,
        evaluation,
        settled,
        initialTurnPath,
        turnPath,
      }));
    }
  }

  summary.finishedAt = new Date().toISOString();
  await writeJson(path.join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  const coverageFailures = currentRunCoverageFailures(summary);
  if (coverageFailures.length) {
    console.error(`[product-capability-agent-harness] current run has ${coverageFailures.length} coverage failure(s)`);
    for (const failure of coverageFailures) {
      console.error(`[product-capability-agent-harness] ${failure.caseId}/${failure.variantId}: ${failure.reason}`);
    }
    process.exitCode = 1;
  }
}

async function ensureWebServer(baseUrl, options = {}) {
  if (options.knownReachable || await canReach(baseUrl)) return { started: false, stop: async () => {} };

  console.error(`baseUrl not reachable, starting local web server: bun run web`);
  const child = spawn("bun", ["run", "web"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => process.stderr.write(`[web] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[web] ${chunk}`));

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (exited) {
      if (await canReach(baseUrl)) return { started: false, stop: async () => {} };
      throw new Error("local web server exited before baseUrl became reachable");
    }
    if (await canReach(baseUrl)) {
      return {
        started: true,
        stop: async () => {
          if (!exited) child.kill();
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!exited) child.kill();
  throw new Error(`timed out waiting for local web server at ${baseUrl}`);
}

async function canReach(baseUrl) {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function collectDevicePreflightMetadata({ args = {}, baseUrl, baseUrlReachableBeforeStart = false, webServerStarted = false }) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const baseUrlReachableAfterStart = await canReach(baseUrl);
  const actionsApi = await checkJsonEndpoint(`${normalizedBaseUrl}/api/actions`);
  return buildDevicePreflightMetadata({
    args,
    baseUrl,
    baseUrlReachableBeforeStart,
    baseUrlReachableAfterStart,
    webServerStarted,
    actionsApi,
  });
}

async function checkJsonEndpoint(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return {
      url,
      ok: response.ok,
      status: response.status,
      target: body?.target || null,
      manifest: body?.manifest || null,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      error: error.message,
      target: null,
      manifest: null,
    };
  }
}

export function buildDevicePreflightMetadata({
  args = {},
  baseUrl = "http://127.0.0.1:4173",
  baseUrlReachableBeforeStart = false,
  baseUrlReachableAfterStart = false,
  webServerStarted = false,
  actionsApi = null,
  checkedAt = new Date().toISOString(),
  env = process.env,
} = {}) {
  const profile = effectiveProfile(args);
  const includeDevice = Boolean(args.includeDevice || profile === "device");
  const sshHost = envValue(env, "SSH_HOST", "192.168.1.24");
  const sshUser = envValue(env, "SSH_USER", "root");
  const sshPassword = secretEnvValue(env, "SSH_PASSWORD", "root");
  const remoteProjectRoot = remoteRootEnvValue(env);
  const remoteBuildUser = envValue(env, "WALNUT_REMOTE_BUILD_USER", "pi");
  const target = `${sshUser.value}@${sshHost.value}`;
  const remoteRootLooksRemote = String(remoteProjectRoot.value || "").startsWith("/");
  const checks = [
    {
      id: "base-url-reachable",
      ok: Boolean(baseUrlReachableAfterStart),
      critical: true,
      detail: baseUrlReachableAfterStart
        ? "Walnut Agent Console base URL responded without a server error."
        : "Walnut Agent Console base URL did not respond.",
    },
    {
      id: "agent-actions-api-reachable",
      ok: Boolean(actionsApi?.ok),
      critical: includeDevice,
      detail: actionsApi?.ok
        ? "Action policy endpoint responded; this is an HTTP/API check only."
        : `Action policy endpoint unavailable${actionsApi?.error ? `: ${actionsApi.error}` : ""}.`,
    },
    {
      id: "ssh-host-configured",
      ok: sshHost.configured,
      critical: includeDevice,
      detail: sshHost.configured ? "SSH_HOST is explicitly set." : "Using default SSH_HOST; target may be machine-local and non-repeatable.",
    },
    {
      id: "ssh-user-configured",
      ok: sshUser.configured,
      critical: includeDevice,
      detail: sshUser.configured ? "SSH_USER is explicitly set." : "Using default SSH_USER; target may be machine-local and non-repeatable.",
    },
    {
      id: "ssh-password-configured",
      ok: sshPassword.configured,
      critical: includeDevice,
      detail: sshPassword.configured ? "SSH_PASSWORD is explicitly set; value is redacted." : "Using default SSH_PASSWORD; authentication assumptions are not repeatable.",
    },
    {
      id: "remote-project-root-configured",
      ok: remoteProjectRoot.configured,
      critical: includeDevice,
      detail: remoteProjectRoot.configured
        ? `${remoteProjectRoot.key} is explicitly set.`
        : "Using default remote project root; device checkout may differ.",
    },
    {
      id: "remote-project-root-shape",
      ok: remoteRootLooksRemote,
      critical: includeDevice,
      detail: remoteRootLooksRemote
        ? "Remote project root looks like an absolute device path."
        : "Remote project root does not look like an absolute device path.",
    },
  ];
  return {
    schema: "walnutpi.deviceBenchmarkPreflight.v1",
    checkedAt,
    profile,
    includeDevice,
    strict: Boolean(args.strictDevicePreflight),
    baseUrl,
    webServer: {
      reachableBeforeStart: Boolean(baseUrlReachableBeforeStart),
      reachableAfterStart: Boolean(baseUrlReachableAfterStart),
      startedByHarness: Boolean(webServerStarted),
    },
    target: {
      label: target,
      host: sshHost.value,
      user: sshUser.value,
      sshHostSource: sshHost.source,
      sshUserSource: sshUser.source,
      sshPasswordConfigured: sshPassword.configured,
      sshPasswordSource: sshPassword.source,
      remoteProjectRoot: remoteProjectRoot.value,
      remoteProjectRootSource: remoteProjectRoot.source,
      remoteProjectRootKey: remoteProjectRoot.key,
      remoteBuildUser: remoteBuildUser.value,
      remoteBuildUserSource: remoteBuildUser.source,
    },
    urlChecks: {
      actionsApi: actionsApi || {
        url: `${baseUrl.replace(/\/+$/, "")}/api/actions`,
        ok: false,
        status: null,
        target: null,
        manifest: null,
      },
    },
    checks,
    nonRepeatableFactors: includeDevice
      ? [
        "Device profile includes cases whose result depends on the live WalnutPi device, current network path, credentials, and physical runtime state.",
        "This preflight only checks local environment and HTTP endpoints; it does not SSH, execute walnut commands, read service state, or verify the screen.",
        "Remote project root, device checkout, system service state, attached peripherals, and current display frame can drift between runs.",
        "Network/search/model-backed cases can vary independently of the device even when the target metadata is stable.",
      ]
      : [
        "Device cases are excluded unless --profile device or --include-device is used.",
      ],
  };
}

function envValue(env, key, fallback) {
  if (Object.hasOwn(env, key) && String(env[key] || "").trim()) {
    return { key, value: String(env[key]), source: "env", configured: true };
  }
  return { key, value: fallback, source: "default", configured: false };
}

function secretEnvValue(env, key, fallbackLabel) {
  if (Object.hasOwn(env, key) && String(env[key] || "").trim()) {
    return { key, value: "[redacted]", source: "env", configured: true };
  }
  return { key, value: `[default:${fallbackLabel}]`, source: "default", configured: false };
}

function remoteRootEnvValue(env) {
  if (Object.hasOwn(env, "WALNUT_REMOTE_PROJECT_ROOT") && String(env.WALNUT_REMOTE_PROJECT_ROOT || "").trim()) {
    return { key: "WALNUT_REMOTE_PROJECT_ROOT", value: String(env.WALNUT_REMOTE_PROJECT_ROOT), source: "env:WALNUT_REMOTE_PROJECT_ROOT", configured: true };
  }
  if (Object.hasOwn(env, "WALNUT_PROJECT_ROOT") && String(env.WALNUT_PROJECT_ROOT || "").trim()) {
    return { key: "WALNUT_PROJECT_ROOT", value: String(env.WALNUT_PROJECT_ROOT), source: "env:WALNUT_PROJECT_ROOT", configured: true };
  }
  return { key: "default", value: "/home/pi/projects/WalnutPi", source: "default", configured: false };
}

export function strictDevicePreflightFailures(metadata) {
  if (!metadata?.strict || !metadata.includeDevice) return [];
  return (metadata.checks || []).filter((check) => check.critical && !check.ok);
}

function compactDevicePreflightForConsole(metadata) {
  return {
    profile: metadata.profile,
    includeDevice: metadata.includeDevice,
    strict: metadata.strict,
    baseUrl: metadata.baseUrl,
    target: metadata.target?.label || null,
    remoteProjectRoot: metadata.target?.remoteProjectRoot || null,
    webServer: metadata.webServer,
    failedChecks: (metadata.checks || []).filter((check) => !check.ok).map((check) => check.id),
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function getJson(url) {
  const response = await fetch(url);
  return response.json();
}

async function settleQueuedTurn({ baseUrl, sessionId, initialTurn, timeoutMs = 120000, intervalMs = 750 }) {
  if (!["queued", "pending"].includes(initialTurn?.status)) {
    return { turn: initialTurn, settled: { ok: true, initialStatus: initialTurn?.status || "unknown", finalStatus: initialTurn?.status || "unknown" } };
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const turns = await getJson(`${baseUrl}/api/agent/turns?sessionId=${encodeURIComponent(sessionId)}&limit=200`);
    const snapshots = (turns.turns || []).filter((turn) => turn.turnId === initialTurn.turnId);
    const latest = snapshots.at(-1);
    if (latest && !["queued", "pending", "running"].includes(latest.status)) {
      return { turn: latest, settled: { ok: true, initialStatus: initialTurn.status, finalStatus: latest.status } };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { turn: initialTurn, settled: { ok: false, initialStatus: initialTurn.status, finalStatus: initialTurn.status, timeoutMs } };
}

async function readJsonl(file) {
  const text = await readFile(file, "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-check") parsed.selfCheck = true;
    else if (arg === "--case-id") parsed.caseId = argv[++i];
    else if (arg === "--file") parsed.file = path.resolve(argv[++i]);
    else if (arg === "--base-url") parsed.baseUrl = argv[++i];
    else if (arg === "--run-id") parsed.runId = safeId(argv[++i]);
    else if (arg === "--output-dir") parsed.outputDir = path.resolve(argv[++i]);
    else if (arg === "--all-variants") parsed.allVariants = true;
    else if (arg === "--first-variant") parsed.firstVariant = true;
    else if (arg === "--profile") parsed.profile = parseProfile(argv[++i]);
    else if (arg === "--include-device") parsed.includeDevice = true;
    else if (arg === "--strict-device-preflight") parsed.strictDevicePreflight = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (parsed.profile === "device") parsed.includeDevice = true;
  return parsed;
}

function parseProfile(value) {
  if (!["offline", "network", "device"].includes(value)) {
    throw new Error(`unknown profile ${value}; expected offline, network, or device`);
  }
  return value;
}

export function selectCases(cases, args = {}) {
  return cases.filter((entry) => !args.caseId || entry.id === args.caseId);
}

function validateCases(cases) {
  return cases.map((benchmark) => {
    validateRequirements(benchmark);
    return benchmark;
  });
}

function validateRequirements(benchmark) {
  const caseId = benchmark?.id || "unknown";
  const requirements = benchmark?.requirements;
  if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) {
    throw new Error(`benchmark ${caseId} missing requirements`);
  }
  for (const key of ["device", "network", "model", "search"]) {
    if (typeof requirements[key] !== "boolean") {
      throw new Error(`benchmark ${caseId} requirements.${key} must be boolean`);
    }
  }
  const unknown = Object.keys(requirements).filter((key) => !["device", "network", "model", "search"].includes(key));
  if (unknown.length) throw new Error(`benchmark ${caseId} requirements has unknown field(s): ${unknown.join(", ")}`);
}

function effectiveProfile(args = {}) {
  return args.profile || (args.includeDevice ? "device" : "network");
}

function profileSkipReason(benchmark, args = {}) {
  const profile = effectiveProfile(args);
  const requirements = benchmark.requirements;
  if (profile === "device") return null;
  if (requirements.device) return `profile ${profile} excludes device requirements`;
  if (profile === "network") return null;
  const blocked = ["network", "model", "search"].filter((key) => requirements[key]);
  return blocked.length ? `profile offline excludes ${blocked.join(", ")} requirements` : null;
}

export function variantsForCase(benchmark, args = {}) {
  return args.firstVariant ? benchmark.variants.slice(0, 1) : benchmark.variants;
}

function shouldSkipHarnessExecution(benchmark) {
  return (benchmark.runnerStatus || "") === "contract-only";
}

function skippedContractTurn({ benchmark, variant, runId }) {
  return {
    schema: "walnutpi.agentTurn.v2",
    runId,
    caseId: benchmark.id,
    variantId: variant.id,
    input: variant.input,
    status: "skipped",
    skip: { kind: "contract-only", reason: "Benchmark defines an observable contract but is not executable by the product agent harness yet." },
    route: null,
    steps: [
      {
        kind: "contract.skip",
        status: "completed",
        result: {
          runnerStatus: "contract-only",
          reason: "Benchmark defines an observable contract but is not executable by the product agent harness yet.",
        },
      },
    ],
    artifacts: [],
    evidence: [],
    sideEffects: [],
    telemetry: { elapsedMs: 0, metrics: emptyTelemetrySummary() },
  };
}

function skippedProfileTurn({ benchmark, variant, runId, profile, reason }) {
  return {
    schema: "walnutpi.agentTurn.v2",
    runId,
    caseId: benchmark.id,
    variantId: variant.id,
    input: variant.input,
    status: "skipped",
    skip: {
      kind: "profile-requirements",
      profile,
      requirements: benchmark.requirements,
      reason,
    },
    route: null,
    steps: [
      {
        kind: "profile.skip",
        status: "completed",
        result: {
          profile,
          requirements: benchmark.requirements,
          reason,
        },
      },
    ],
    artifacts: [],
    evidence: [{ kind: "profile-requirements-skip", value: { profile, requirements: benchmark.requirements, reason } }],
    sideEffects: [],
    telemetry: { elapsedMs: 0, metrics: emptyTelemetrySummary() },
  };
}

function summaryCase({ benchmark, variant, turn, evaluation, settled, turnPath, initialTurnPath = null }) {
  return {
    caseId: benchmark.id,
    variantId: variant.id,
    suite: benchmark.suite || "main",
    caseKind: benchmark.caseKind || "positive",
    mutates: benchmark.mutates || null,
    mutationKind: benchmark.mutationKind || null,
    runnerStatus: benchmark.runnerStatus || null,
    requirements: benchmark.requirements,
    status: turn.status || "unknown",
    verdict: evaluation.verdict,
    skip: turn.skip || null,
    evaluation,
    settled,
    initialTurnPath: initialTurnPath ? path.relative(root, initialTurnPath).replaceAll("\\", "/") : null,
    turnPath: path.relative(root, turnPath).replaceAll("\\", "/"),
    sideEffects: turn.sideEffects || [],
    telemetry: compactTelemetry(turn.telemetry),
  };
}

function safeId(value) {
  return String(value || "run").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "run";
}

export function evaluateTurn(benchmark, turn, variant = benchmark.variants?.[0]) {
  const oracle = normalizeOracle(benchmark.oracle || {});
  const sideEffects = new Set(turn.sideEffects || []);
  const missingSafety = oracle.safety.forbiddenSideEffects.filter((item) => sideEffects.has(item));
  const route = turn.route || turn.steps?.find((step) => step.kind === "intent.classify")?.result?.classification || {};
  const missingEvidence = (oracle.evidence.required || oracle.evidence.signals || []).filter((kind) => !traceSignalSupportsKind(turn, kind, { benchmark, variant }));
  const missingResults = (oracle.goal.resultSignals || oracle.goal.result || []).filter((kind) => !traceSignalSupportsKind(turn, kind, { benchmark, variant }));
  const goalChecks = [
    !oracle.goal.route || oracle.goal.route === route.route,
    !oracle.goal.intent || oracle.goal.intent === route.intent,
    !oracle.goal.delivery || oracle.goal.delivery === route.delivery,
  ];
  const goalOk = goalChecks.every(Boolean);
  const terminalOk = ["completed", "failed"].includes(turn.status);
  const signals = evaluateDeepSignals({ benchmark, variant, turn, oracle, missingEvidence, missingResults, missingSafety });
  const ok = goalOk && terminalOk && !missingSafety.length && !missingEvidence.length && !missingResults.length && !["failed"].includes(turn.status);
  return {
    verdict: ok ? "pass" : "needs_review",
    goal: {
      ok: goalOk,
      expected: { route: oracle.goal.route || null, intent: oracle.goal.intent || null, delivery: oracle.goal.delivery || null },
      actual: { route: route.route || null, intent: route.intent || null, delivery: route.delivery || null },
    },
    evidence: { ok: !missingEvidence.length && !missingResults.length, missing: missingEvidence, missingResults },
    safety: { ok: !missingSafety.length, forbiddenTriggered: missingSafety },
    signals,
  };
}

export function currentRunCoverageFailures(summary) {
  return (summary.cases || [])
    .filter((entry) => ["runnable", "device-gated"].includes(entry.runnerStatus))
    .filter((entry) => entry.skip?.kind !== "profile-requirements")
    .filter((entry) => entry.verdict !== "pass" || entry.settled?.ok === false)
    .map((entry) => ({
      caseId: entry.caseId || "unknown",
      variantId: entry.variantId || "default",
      verdict: entry.verdict || "unknown",
      reason: coverageFailureReason(entry),
    }));
}

function coverageFailureReason(entry) {
  if (entry.settled?.ok === false) return `turn did not settle from ${entry.settled.initialStatus || "unknown"}`;
  const missing = [
    ...(entry.evaluation?.evidence?.missing || []).map((kind) => `missing evidence ${kind}`),
    ...(entry.evaluation?.evidence?.missingResults || []).map((kind) => `missing result ${kind}`),
    ...(entry.evaluation?.safety?.forbiddenTriggered || []).map((kind) => `forbidden side effect ${kind}`),
  ];
  if (missing.length) return missing.join("; ");
  return `verdict ${entry.verdict || "unknown"}`;
}

function normalizeOracle(oracle) {
  return {
    goal: oracle.goal || {
      route: oracle.predicates?.find((item) => item.kind === "routeIs")?.value || null,
      intent: oracle.predicates?.find((item) => item.kind === "intentIs")?.value || null,
      delivery: oracle.predicates?.find((item) => item.kind === "deliveryIs")?.value || null,
      result: oracle.requiredArtifacts || [],
    },
    evidence: oracle.evidence || { required: oracle.requiredEvidence || [] },
    safety: oracle.safety || { forbiddenSideEffects: oracle.forbiddenSideEffects || [] },
  };
}

function hasTraceKind(turn, kind) {
  if (kind === "intent-route") return Boolean(turn.route);
  if (kind === "agentTurn-step") return Boolean(turn.steps?.length);
  const values = [
    ...(turn.artifacts || []).map((item) => item.kind),
    ...(Array.isArray(turn.evidence) ? turn.evidence.map((item) => item.kind) : Object.keys(turn.evidence || {})),
  ];
  return values.includes(kind);
}

function traceSignalSupportsKind(turn, kind, context = {}) {
  if (!hasTraceKind(turn, kind)) return false;
  const signal = traceSignalValue(turn, kind);
  if (!hasSupportingValue(signal)) return false;
  if (kind === "screen-output-480x320") return Number(signal?.width) === 480 && Number(signal?.height) === 320;
  if (kind === "action-policy-id") return signal === (context.benchmark?.action || completedActionId(turn));
  if (kind === "replan-evidence") return replanEvidenceIsSafe(signal);
  return hasSupportingValue(signal);
}

function traceSignalValue(turn, kind) {
  if (kind === "intent-route") return turn.route;
  if (kind === "agentTurn-step") return turn.steps?.[0] || null;
  return (turn.evidence || []).find((item) => item.kind === kind)?.value
    ?? (turn.artifacts || []).find((item) => item.kind === kind)?.value
    ?? null;
}

function completedActionId(turn) {
  return (turn.steps || []).find((step) => step.kind === "action.run" && step.status === "completed" && step.action)?.action || null;
}

function hasSupportingValue(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function replanEvidenceIsSafe(signal) {
  const safe = Array.isArray(signal?.safeAutoContinue) ? signal.safeAutoContinue : [];
  const blocked = Array.isArray(signal?.blockedTasks) ? signal.blockedTasks : [];
  if (!safe.length && !blocked.length) return false;
  return safe.every((task) => ["status", "network", "snapshot", "gpio", "notes"].includes(String(task.action || "")));
}

function evaluateDeepSignals({ benchmark, variant = benchmark.variants?.[0], turn, oracle, missingEvidence, missingResults, missingSafety }) {
  const sideEffects = new Set(turn.sideEffects || []);
  const slots = variant?.slots || {};
  const needsRecovery = turn.status === "failed" || missingEvidence.length || missingResults.length;
  const hasRecovery = ["recovery-options", "repair-options", "repair-hint"].some((kind) => hasTraceKind(turn, kind))
    || turn.steps?.some((step) => step.status === "failed" && (step.result?.error || step.result?.repairHint));
  return {
    visualEvidence: signalStatus(missingResults.length === 0, missingResults.length ? "missing result signals" : "result signals present"),
    semanticFit: signalStatus(
      !(slots.delivery === "preview-only" && (sideEffects.has("screen-sync") || sideEffects.has("device-write"))),
      "slot-level route/safety checks",
    ),
    recoveryQuality: needsRecovery
      ? signalStatus(hasRecovery, hasRecovery ? "recovery evidence present" : "missing recovery evidence")
      : signalStatus(true, "not needed"),
    telemetryHealth: signalStatus((turn.telemetry?.metrics?.failures || 0) === 0, "metrics failure count"),
    safetyBoundary: signalStatus(missingSafety.length === 0, missingSafety.length ? "forbidden side effects observed" : "no forbidden side effects"),
  };
}

function signalStatus(ok, note) {
  return { status: ok ? "ok" : "needs_review", note };
}

function emptyTelemetrySummary() {
  return {
    totalEvents: 0,
    failures: 0,
    tokens: { input: 0, output: 0, total: 0, cached: 0, reasoning: 0 },
    elapsedMs: 0,
  };
}

function addTelemetry(total, telemetry = {}) {
  const metrics = telemetry.metrics || {};
  const tokens = metrics.tokens || {};
  total.totalEvents += metrics.totalEvents || 0;
  total.failures += metrics.failures || 0;
  total.elapsedMs += telemetry.elapsedMs || 0;
  for (const key of Object.keys(total.tokens)) total.tokens[key] += tokens[key] || 0;
}

function compactTelemetry(telemetry = {}) {
  return {
    elapsedMs: telemetry.elapsedMs || null,
    totalEvents: telemetry.metrics?.totalEvents || 0,
    failures: telemetry.metrics?.failures || 0,
    tokens: telemetry.metrics?.tokens || emptyTelemetrySummary().tokens,
  };
}

function assertThrows(fn, pattern) {
  try {
    fn();
  } catch (error) {
    if (!pattern.test(error.message)) throw error;
    return;
  }
  throw new Error(`expected function to throw ${pattern}`);
}

async function selfCheck() {
  const sampleCases = [
    { id: "local", requirements: { device: false, network: false, model: false, search: false }, variants: [{ id: "a" }, { id: "b" }] },
    { id: "device", requirements: { device: true, network: false, model: false, search: false }, variants: [{ id: "a" }] },
    { id: "network", requirements: { device: false, network: true, model: false, search: false }, variants: [{ id: "a" }] },
    { id: "search", requirements: { device: false, network: true, model: false, search: true }, variants: [{ id: "a" }] },
  ];
  if (selectCases(sampleCases, {}).map((entry) => entry.id).join(",") !== "local,device,network,search") {
    throw new Error("selectCases should only apply explicit case-id filtering");
  }
  if (parseArgs(["--case-id", "V1-25"]).caseId !== "V1-25") {
    throw new Error("case selector should map to caseId");
  }
  if (!profileSkipReason(sampleCases[1], { profile: "network" }) || profileSkipReason(sampleCases[2], { profile: "network" })) {
    throw new Error("network profile should skip device requirements only");
  }
  if (profileSkipReason(sampleCases[0], { profile: "offline" }) || !profileSkipReason(sampleCases[2], { profile: "offline" }) || !profileSkipReason(sampleCases[3], { profile: "offline" })) {
    throw new Error("offline profile should skip network/model/search requirements");
  }
  if (profileSkipReason(sampleCases[1], { profile: "device" })) {
    throw new Error("device profile should include device requirements");
  }
  assertThrows(() => validateCases([{ id: "bad", variants: [] }]), /missing requirements/);
  assertThrows(() => validateCases([{ id: "bad", requirements: { device: false, network: false, model: false }, variants: [] }]), /requirements.search/);
  assertThrows(() => validateCases([{ id: "bad", requirements: { device: false, network: false, model: false, search: false, extra: false }, variants: [] }]), /unknown field/);
  const skippedProfile = skippedProfileTurn({
    benchmark: sampleCases[2],
    variant: { id: "a", input: "network case" },
    runId: "self-check",
    profile: "offline",
    reason: profileSkipReason(sampleCases[2], { profile: "offline" }),
  });
  if (skippedProfile.skip.kind !== "profile-requirements" || !skippedProfile.evidence.some((item) => item.kind === "profile-requirements-skip")) {
    throw new Error("profile requirement skip should be explicit in turn evidence");
  }
  if (variantsForCase(sampleCases[0], {}).length !== 2 || variantsForCase(sampleCases[0], { firstVariant: true }).length !== 1) {
    throw new Error("variant selection failed");
  }
  if (!shouldSkipHarnessExecution({ runnerStatus: "contract-only" }) || shouldSkipHarnessExecution({ runnerStatus: "runnable" })) {
    throw new Error("contract-only execution skip detection failed");
  }
  const skippedTurn = skippedContractTurn({
    benchmark: { id: "V1-09" },
    variant: { id: "zh-main", input: "contract placeholder" },
    runId: "self-check",
  });
  if (skippedTurn.status !== "skipped" || skippedTurn.steps[0]?.kind !== "contract.skip" || skippedTurn.sideEffects.length !== 0) {
    throw new Error("contract-only skipped turn shape failed");
  }
  const strictPreflight = buildDevicePreflightMetadata({
    args: { profile: "device", strictDevicePreflight: true },
    baseUrlReachableAfterStart: true,
    actionsApi: { ok: true, status: 200 },
    checkedAt: "2026-01-01T00:00:00.000Z",
    env: {},
  });
  const failures = strictDevicePreflightFailures(strictPreflight).map((check) => check.id);
  if (!failures.includes("ssh-host-configured") || !failures.includes("remote-project-root-configured")) {
    throw new Error("strict device preflight should fail without explicit device target metadata");
  }
  const metadataOnlyPreflight = buildDevicePreflightMetadata({
    args: { profile: "device" },
    baseUrlReachableAfterStart: true,
    actionsApi: { ok: true, status: 200 },
    checkedAt: "2026-01-01T00:00:00.000Z",
    env: {},
  });
  if (strictDevicePreflightFailures(metadataOnlyPreflight).length !== 0) {
    throw new Error("default device preflight should record metadata without fail-fast");
  }
  const coverageFailures = currentRunCoverageFailures({
    cases: [
      { caseId: "V1-25", variantId: "zh-main", runnerStatus: "runnable", verdict: "pass", settled: { ok: true } },
      {
        caseId: "V1-25",
        variantId: "zh-alt",
        runnerStatus: "runnable",
        verdict: "needs_review",
        settled: { ok: true },
        evaluation: { evidence: { missing: ["replan-evidence"], missingResults: ["multi-step-loop"] }, safety: { forbiddenTriggered: [] } },
      },
      { caseId: "V1-09", variantId: "zh-main", runnerStatus: "contract-only", verdict: "needs_review", settled: { ok: true } },
    ],
  });
  if (coverageFailures.length !== 1 || coverageFailures[0].caseId !== "V1-25") {
    throw new Error("current run coverage failures should surface failing runnable cases");
  }
  const fakeEvidence = evaluateTurn(
    {
      id: "V1-01",
      oracle: {
        goal: { route: "screen.wallpaper", intent: "screen.generate", delivery: "none", resultSignals: ["screen-output-480x320"] },
        evidence: { required: ["weather-source-or-fetch-failure"] },
        safety: { forbiddenSideEffects: [] },
      },
    },
    {
      status: "completed",
      route: { route: "screen.wallpaper", intent: "screen.generate", delivery: "none" },
      artifacts: [{ kind: "screen-output-480x320", value: { width: 480, height: 320 } }],
      evidence: [{ kind: "weather-source-or-fetch-failure", value: null }],
      sideEffects: [],
    },
    { slots: { location: "上海" } },
  );
  if (fakeEvidence.verdict !== "needs_review" || !fakeEvidence.evidence.missing.includes("weather-source-or-fetch-failure")) {
    throw new Error("oracle should reject trace signals whose content does not support the requested result");
  }
  console.log("product capability agent harness self-check passed");
}
