#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertNoOracleForLoop, normalizeLoopScenario } from "./agent-scenario-contract.ts";
import { validateAgentTurnV2 } from "./agent-turn-trace-schema.ts";
import { normalizeLoopModelId, normalizeLoopReasoningEffort } from "./agent-loop-model-contract.ts";

const root = path.resolve(import.meta.dirname, "..");
const defaultCases = path.join(root, "docs", "product-capability-benchmarks.v2.jsonl");
const defaultOutputRoot = path.join(root, "screen", "benchmark-runs");
const webServerLockDir = path.join(root, "screen", ".agent-harness-web-server.lock");

type JsonRecord = Record<string, any>;
type HarnessProfile = "offline" | "network" | "device";
type HarnessArgs = {
  selfCheck?: boolean;
  caseId?: string;
  file?: string;
  baseUrl?: string;
  runId?: string;
  outputDir?: string;
  allVariants?: boolean;
  firstVariant?: boolean;
  profile?: HarnessProfile;
  concurrency?: number;
  includeDevice?: boolean;
  strictDevicePreflight?: boolean;
  loopModel?: string;
  loopReasoningEffort?: string;
  loopModelProvider?: string;
};
type BenchmarkRequirements = JsonRecord & { device?: boolean; network?: boolean; model?: boolean; search?: boolean };
type BenchmarkVariant = JsonRecord & {
  id?: string;
  input?: string;
  slots?: JsonRecord;
  scenarioContract?: JsonRecord;
};
type BenchmarkCase = JsonRecord & {
  id?: string;
  suite?: string;
  caseKind?: string;
  mutates?: any;
  mutationKind?: any;
  runnerStatus?: string;
  requirements?: BenchmarkRequirements;
  variants?: BenchmarkVariant[];
  oracle?: JsonRecord;
  loopModel?: JsonRecord;
  scenarioContract?: JsonRecord;
  action?: string;
};
type AgentTurn = JsonRecord & {
  schema?: string;
  turnId?: string;
  sessionId?: string;
  status?: string;
  route?: JsonRecord | null;
  steps?: JsonRecord[];
  artifacts?: JsonRecord[];
  evidence?: JsonRecord[] | JsonRecord;
  sideEffects?: JsonRecord[];
  skip?: JsonRecord;
  pendingNext?: any;
  loop?: JsonRecord;
  telemetry?: JsonRecord;
  diagnostics?: JsonRecord;
};
type EvaluationSummary = JsonRecord & {
  verdict?: string;
  evidence: { ok?: boolean; missing: string[]; missingResults: string[] };
  safety: { ok?: boolean; forbiddenTriggered: string[] };
};
type SettledTurn = { ok: boolean; initialStatus?: string; finalStatus?: string; timeoutMs?: number };
type CaseSummary = JsonRecord & {
  caseId?: string;
  variantId?: string;
  runnerStatus?: string | null;
  verdict?: string;
  skip?: JsonRecord | null;
  settled?: SettledTurn;
  evaluation?: EvaluationSummary;
  repairTaskPath?: string | null;
};
type TelemetrySummary = {
  totalEvents: number;
  failures: number;
  tokens: { input: number; output: number; total: number; cached: number; reasoning: number };
  elapsedMs: number;
};
type HarnessSummary = {
  schema: string;
  runId: string;
  baseUrl: string;
  profile: HarnessProfile;
  environment: JsonRecord;
  startedAt: string;
  finishedAt?: string;
  telemetry: TelemetrySummary;
  skipped: { profileRequirements: number; contractOnly: number };
  concurrency: number;
  cases: CaseSummary[];
  repairTasks: JsonRecord[];
};
type BenchmarkTask = {
  index: number;
  benchmark: BenchmarkCase;
  variant: BenchmarkVariant;
  sessionId: string;
};
type BenchmarkTaskResult = {
  index: number;
  skipKind?: "profile-requirements" | "contract-only";
  telemetry?: JsonRecord;
  caseSummary: CaseSummary;
};
type DevicePreflightMetadata = JsonRecord & {
  profile: HarnessProfile;
  includeDevice: boolean;
  strict: boolean;
  baseUrl: string;
  checks: Array<{ id: string; ok: boolean; critical: boolean; detail: string }>;
};
type HarnessError = Error & { failures?: JsonRecord[]; preflightPath?: string };

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

async function runHarness({ args, baseUrl, preflightContext = {} }: { args: HarnessArgs; baseUrl: string; preflightContext?: JsonRecord }) {
  const cases = selectCases(validateCases(await readJsonl(args.file || defaultCases)), args);
  if (!cases.length) throw new Error(`no benchmark cases matched${args.caseId ? ` ${args.caseId}` : ""}`);

  const runId = args.runId || `agent-harness-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const outDir = path.join(args.outputDir || defaultOutputRoot, runId);
  const turnDir = path.join(outDir, "agent-turns");
  await mkdir(turnDir, { recursive: true });

  const devicePreflight = await collectDevicePreflightMetadata({ args, baseUrl, ...preflightContext });
  const preflightPath = path.join(outDir, "device-preflight.json");
  await writeJson(preflightPath, devicePreflight);
  const deviceRegression = buildDeviceRegressionManifest({ cases, args, runId });
  const deviceRegressionPath = path.join(outDir, "device-regression.json");
  await writeJson(deviceRegressionPath, deviceRegression);
  if (devicePreflight.includeDevice || devicePreflight.profile === "device") {
    console.error(`[device-preflight] ${JSON.stringify(compactDevicePreflightForConsole(devicePreflight))}`);
  }
  const strictFailures = strictDevicePreflightFailures(devicePreflight);
  if (strictFailures.length) {
    const failure: HarnessError = new Error(`strict device preflight failed: ${strictFailures.map((item) => item.id).join(", ")}`);
    failure.failures = strictFailures;
    failure.preflightPath = path.relative(root, preflightPath).replaceAll("\\", "/");
    throw failure;
  }

  const summary: HarnessSummary = {
    schema: "walnutpi.productCapabilityAgentHarnessRun.v1",
    runId,
    baseUrl,
    profile: effectiveProfile(args),
    environment: {
      devicePreflight,
      devicePreflightPath: path.relative(root, preflightPath).replaceAll("\\", "/"),
      deviceRegression,
      deviceRegressionPath: path.relative(root, deviceRegressionPath).replaceAll("\\", "/"),
    },
    startedAt: new Date().toISOString(),
    telemetry: emptyTelemetrySummary(),
    skipped: { profileRequirements: 0, contractOnly: 0 },
    concurrency: effectiveConcurrency(args),
    cases: [],
    repairTasks: [],
  };

  const tasks = buildBenchmarkTasks({ cases, args, runId });
  const results = await runWorkerPool(tasks, summary.concurrency, (task) => runBenchmarkTask({
    task,
    args,
    baseUrl,
    runId,
    turnDir,
  }));
  for (const result of results) {
    if (result.skipKind === "profile-requirements") summary.skipped.profileRequirements += 1;
    else if (result.skipKind === "contract-only") summary.skipped.contractOnly += 1;
    if (result.telemetry) addTelemetry(summary.telemetry, result.telemetry);
    summary.cases.push(result.caseSummary);
  }
  summary.repairTasks = summary.cases
    .filter((entry) => entry.repairTaskPath)
    .map((entry) => ({
      caseId: entry.caseId,
      variantId: entry.variantId,
      verdict: entry.verdict,
      reason: coverageFailureReason(entry),
      repairTaskPath: entry.repairTaskPath,
    }));

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

function buildBenchmarkTasks({ cases, args = {}, runId }: { cases: BenchmarkCase[]; args?: HarnessArgs; runId: string }): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [];
  for (const benchmark of cases) {
    for (const variant of variantsForCase(benchmark, args)) {
      tasks.push({
        index: tasks.length,
        benchmark,
        variant,
        sessionId: safeId(`${runId}-${benchmark.id || "unknown"}-${variant.id || "default"}`),
      });
    }
  }
  return tasks;
}

async function runBenchmarkTask({ task, args, baseUrl, runId, turnDir }: { task: BenchmarkTask; args: HarnessArgs; baseUrl: string; runId: string; turnDir: string }): Promise<BenchmarkTaskResult> {
  const { benchmark, variant, sessionId } = task;
  const artifactBase = path.join(turnDir, `${safeId(benchmark.id)}-${safeId(variant.id)}`);
  const runRoot = path.dirname(turnDir);
  const profileSkip = profileSkipReason(benchmark, args);
  if (profileSkip) {
    const turn = skippedProfileTurn({ benchmark, variant, runId, sessionId, profile: effectiveProfile(args), reason: profileSkip });
    const turnPath = `${artifactBase}.json`;
    await writeJson(turnPath, turn);
    return {
      index: task.index,
      skipKind: "profile-requirements",
      caseSummary: summaryCase({
        benchmark,
        variant,
        sessionId,
        turn,
        evaluation: { verdict: "skipped", evidence: { missing: [], missingResults: [] }, safety: { forbiddenTriggered: [] } },
        settled: { ok: true, initialStatus: "skipped", finalStatus: "skipped" },
        turnPath,
      }),
    };
  }
  if (shouldSkipHarnessExecution(benchmark)) {
    const turn = skippedContractTurn({ benchmark, variant, runId, sessionId });
    const turnPath = `${artifactBase}.json`;
    await writeJson(turnPath, turn);
    return {
      index: task.index,
      skipKind: "contract-only",
      caseSummary: summaryCase({
        benchmark,
        variant,
        sessionId,
        turn,
        evaluation: { verdict: "skipped", evidence: { missing: [], missingResults: [] }, safety: { forbiddenTriggered: [] } },
        settled: { ok: true, initialStatus: "skipped", finalStatus: "skipped" },
        turnPath,
      }),
    };
  }
  const initialTurn = await postJson(`${baseUrl}/api/agent/turn`, {
    text: variant.input || "",
    sessionId,
    mode: "intent",
    requirements: benchmark.requirements,
    loopModel: loopModelRequestForBenchmark(benchmark, args),
    scenario: scenarioForBenchmarkVariant(benchmark, variant),
  });
  const { turn, settled } = await settleQueuedTurn({ baseUrl, sessionId, initialTurn });
  let initialTurnPath: string | null = null;
  if (initialTurn.turnId && initialTurn.turnId === turn.turnId && initialTurn !== turn) {
    initialTurnPath = `${artifactBase}-initial.json`;
    await writeJson(initialTurnPath, initialTurn);
  }
  const turnPath = `${artifactBase}.json`;
  await writeJson(turnPath, turn);
  const extractedArtifactDir = await exportTurnIntermediateArtifacts({
    turn,
    artifactDir: path.join(turnDir, "artifacts", `${safeId(benchmark.id)}-${safeId(variant.id)}`),
  });
  const evaluation = evaluateTurn(benchmark, turn, variant);
  const repairTaskPath = await maybeWriteRepairTask({
    benchmark,
    variant,
    sessionId,
    runId,
    profile: effectiveProfile(args),
    turn,
    evaluation,
    settled,
    turnPath,
    initialTurnPath,
    artifactDir: extractedArtifactDir,
    repairDir: path.join(runRoot, "repair-tasks"),
  });
  return {
    index: task.index,
    telemetry: turn.telemetry,
    caseSummary: summaryCase({
      benchmark,
      variant,
      sessionId,
      turn,
      evaluation,
      settled,
      initialTurnPath,
      turnPath,
      artifactDir: extractedArtifactDir,
      repairTaskPath,
    }),
  };
}

async function maybeWriteRepairTask({
  benchmark,
  variant,
  sessionId,
  runId,
  profile,
  turn,
  evaluation,
  settled,
  turnPath,
  initialTurnPath,
  artifactDir,
  repairDir,
}: {
  benchmark: BenchmarkCase;
  variant: BenchmarkVariant;
  sessionId: string;
  runId: string;
  profile: HarnessProfile;
  turn: AgentTurn;
  evaluation: EvaluationSummary;
  settled: SettledTurn;
  turnPath: string;
  initialTurnPath?: string | null;
  artifactDir?: string | null;
  repairDir: string;
}): Promise<string | null> {
  const caseSummary = summaryCase({
    benchmark,
    variant,
    sessionId,
    turn,
    evaluation,
    settled,
    turnPath,
    initialTurnPath,
    artifactDir,
  });
  if (!shouldCreateRepairTask(caseSummary)) return null;
  const id = `${safeId(benchmark.id)}-${safeId(variant.id)}`;
  const jsonPath = path.join(repairDir, `${id}.json`);
  const mdPath = path.join(repairDir, `${id}.md`);
  const task = buildCodexRepairTask({
    benchmark,
    variant,
    sessionId,
    runId,
    profile,
    turn,
    evaluation,
    settled,
    turnPath,
    initialTurnPath,
    artifactDir,
    mdPath,
  });
  await writeJson(jsonPath, task);
  await mkdir(path.dirname(mdPath), { recursive: true });
  await writeFile(mdPath, renderCodexRepairTaskMarkdown(task));
  return path.relative(root, jsonPath).replaceAll("\\", "/");
}

function shouldCreateRepairTask(entry: CaseSummary): boolean {
  if (!["runnable", "device-gated"].includes(String(entry.runnerStatus || ""))) return false;
  if (entry.skip?.kind === "profile-requirements") return false;
  return entry.verdict !== "pass" || entry.settled?.ok === false;
}

async function exportTurnIntermediateArtifacts({ turn, artifactDir }: { turn: AgentTurn; artifactDir: string }): Promise<string | null> {
  const files: Array<{ path: string; value: any; text?: boolean }> = [];
  for (const step of turn.diagnostics?.steps || []) {
    if (!step?.stepId) continue;
    files.push({
      path: path.join(artifactDir, "actions", `${safeId(step.stepId)}.json`),
      value: {
        stepId: step.stepId,
        parentStepId: step.parentStepId || null,
        agent: step.agent || null,
        kind: step.kind || null,
        action: step.action || null,
        status: step.status || null,
        startedAt: step.startedAt || null,
        finishedAt: step.finishedAt || null,
        result: step.result || null,
      },
    });
  }
  for (const [index, entry] of (turn.diagnostics?.loopModel || []).entries()) {
    const base = path.join(artifactDir, "loop-model", `${String(index + 1).padStart(2, "0")}-${safeId(entry.sourceStepId || "turn")}`);
    if (entry.artifacts?.modelContext) files.push({ path: `${base}.context.json`, value: entry.artifacts.modelContext });
    if (entry.artifacts?.normalizedProposal) files.push({ path: `${base}.proposal.json`, value: entry.artifacts.normalizedProposal });
    files.push({ path: `${base}.diagnostics.json`, value: entry });
    if (typeof entry.artifacts?.rawOutput === "string") files.push({ path: `${base}.raw.txt`, value: entry.artifacts.rawOutput, text: true });
  }
  if (!files.length) return null;
  for (const file of files) {
    await mkdir(path.dirname(file.path), { recursive: true });
    await writeFile(file.path, file.text ? String(file.value) : `${JSON.stringify(file.value, null, 2)}\n`);
  }
  return path.relative(root, artifactDir).replaceAll("\\", "/");
}

async function runWorkerPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current]);
    }
  }));
  return results;
}

async function ensureWebServer(baseUrl: string, options: { knownReachable?: boolean } = {}): Promise<{ started: boolean; stop: () => Promise<void> }> {
  if (options.knownReachable || await canReach(baseUrl)) return { started: false, stop: async () => {} };

  const lock = await acquireWebServerStartLock();
  if (!lock.acquired) {
    const reachable = await waitForReachable(baseUrl, 30000);
    if (reachable) return { started: false, stop: async () => {} };
    throw new Error(`timed out waiting for another harness process to start local web server at ${baseUrl}`);
  }

  if (await canReach(baseUrl)) {
    await lock.release();
    return { started: false, stop: async () => {} };
  }

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

  try {
    const started = await waitForStartedChildServer({ baseUrl, exited: () => exited, timeoutMs: 30000 });
    await lock.release();
    if (started) {
      return {
        started: true,
        stop: async () => {
          if (!exited) child.kill();
        },
      };
    }
  } catch (error) {
    await lock.release();
    if (!exited) child.kill();
    throw error;
  }

  if (!exited) child.kill();
  throw new Error(`timed out waiting for local web server at ${baseUrl}`);
}

async function acquireWebServerStartLock(): Promise<{ acquired: boolean; release: () => Promise<void> }> {
  try {
    await mkdir(webServerLockDir, { recursive: false });
    await writeFile(path.join(webServerLockDir, "owner.json"), `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2)}\n`);
    return {
      acquired: true,
      release: async () => {
        await rm(webServerLockDir, { recursive: true, force: true });
      },
    };
  } catch (error: any) {
    if (error?.code === "EEXIST") {
      if (await removeStaleWebServerStartLock()) return acquireWebServerStartLock();
      return { acquired: false, release: async () => {} };
    }
    throw error;
  }
}

async function removeStaleWebServerStartLock(): Promise<boolean> {
  try {
    const info = await stat(webServerLockDir);
    if (Date.now() - info.mtimeMs < 45000) return false;
    await rm(webServerLockDir, { recursive: true, force: true });
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function waitForStartedChildServer({ baseUrl, exited, timeoutMs }: { baseUrl: string; exited: () => boolean; timeoutMs: number }): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited()) {
      if (await canReach(baseUrl)) return true;
      throw new Error("local web server exited before baseUrl became reachable");
    }
    if (await canReach(baseUrl)) return true;
    await sleep(500);
  }
  return false;
}

async function waitForReachable(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canReach(baseUrl)) return true;
    await sleep(500);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canReach(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function collectDevicePreflightMetadata({ args = {}, baseUrl, baseUrlReachableBeforeStart = false, webServerStarted = false }: { args?: HarnessArgs; baseUrl: string; baseUrlReachableBeforeStart?: boolean; webServerStarted?: boolean }): Promise<DevicePreflightMetadata> {
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

async function checkJsonEndpoint(url: string): Promise<JsonRecord> {
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
      target: (body as JsonRecord | null)?.target || null,
      manifest: (body as JsonRecord | null)?.manifest || null,
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
}: {
  args?: HarnessArgs;
  baseUrl?: string;
  baseUrlReachableBeforeStart?: boolean;
  baseUrlReachableAfterStart?: boolean;
  webServerStarted?: boolean;
  actionsApi?: JsonRecord | null;
  checkedAt?: string;
  env?: NodeJS.ProcessEnv;
} = {}): DevicePreflightMetadata {
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

function envValue(env: NodeJS.ProcessEnv, key: string, defaultValue: string) {
  if (Object.hasOwn(env, key) && String(env[key] || "").trim()) {
    return { key, value: String(env[key]), source: "env", configured: true };
  }
  return { key, value: defaultValue, source: "default", configured: false };
}

function secretEnvValue(env: NodeJS.ProcessEnv, key: string, defaultLabel: string) {
  if (Object.hasOwn(env, key) && String(env[key] || "").trim()) {
    return { key, value: "[redacted]", source: "env", configured: true };
  }
  return { key, value: `[default:${defaultLabel}]`, source: "default", configured: false };
}

function remoteRootEnvValue(env: NodeJS.ProcessEnv) {
  if (Object.hasOwn(env, "WALNUT_REMOTE_PROJECT_ROOT") && String(env.WALNUT_REMOTE_PROJECT_ROOT || "").trim()) {
    return { key: "WALNUT_REMOTE_PROJECT_ROOT", value: String(env.WALNUT_REMOTE_PROJECT_ROOT), source: "env:WALNUT_REMOTE_PROJECT_ROOT", configured: true };
  }
  if (Object.hasOwn(env, "WALNUT_PROJECT_ROOT") && String(env.WALNUT_PROJECT_ROOT || "").trim()) {
    return { key: "WALNUT_PROJECT_ROOT", value: String(env.WALNUT_PROJECT_ROOT), source: "env:WALNUT_PROJECT_ROOT", configured: true };
  }
  return { key: "default", value: "/home/pi/projects/WalnutPi", source: "default", configured: false };
}

export function strictDevicePreflightFailures(metadata: Partial<DevicePreflightMetadata> | null | undefined) {
  if (!metadata?.strict || !metadata.includeDevice) return [];
  return (metadata.checks || []).filter((check) => check.critical && !check.ok);
}

function compactDevicePreflightForConsole(metadata: DevicePreflightMetadata) {
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

function buildDeviceRegressionManifest({ cases, args = {}, runId }: { cases: BenchmarkCase[]; args?: HarnessArgs; runId: string }) {
  const profile = effectiveProfile(args);
  const deviceCases = cases
    .filter((benchmark) => benchmark.requirements?.device || benchmark.runnerStatus === "device-gated")
    .map((benchmark) => ({
      caseId: benchmark.id || null,
      title: benchmark.title || null,
      runnerStatus: benchmark.runnerStatus || null,
      requirements: benchmark.requirements || null,
      variantIds: variantsForCase(benchmark, args).map((variant) => variant.id || "default"),
      execution: profile === "device" || args.includeDevice ? "included" : "profile-skip",
      requiredEvidence: benchmark.oracle?.evidence?.required || [],
      resultSignals: benchmark.oracle?.goal?.resultSignals || [],
      forbiddenSideEffects: benchmark.oracle?.safety?.forbiddenSideEffects || [],
    }));
  return {
    schema: "walnutpi.deviceRegressionManifest.v1",
    runId,
    profile,
    fixedRegressionRole: "device profile is the live WalnutPi regression environment for sync, delivery, activation, service state, frame evidence, and capture evidence",
    includedInThisRun: profile === "device" || Boolean(args.includeDevice),
    cases: deviceCases,
    recommendedCommand: "bun run bench:product -- --profile device --concurrency 1 --strict-device-preflight",
  };
}

async function postJson(url: string, body: JsonRecord): Promise<AgentTurn> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<AgentTurn>;
}

async function getJson(url: string): Promise<JsonRecord> {
  const response = await fetch(url);
  return response.json() as Promise<JsonRecord>;
}

async function settleQueuedTurn({ baseUrl, sessionId, initialTurn, timeoutMs = 120000, intervalMs = 750 }: { baseUrl: string; sessionId: string; initialTurn: AgentTurn; timeoutMs?: number; intervalMs?: number }): Promise<{ turn: AgentTurn; settled: SettledTurn }> {
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

async function readJsonl(file: string): Promise<BenchmarkCase[]> {
  const text = await readFile(file, "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

async function writeJson(file: string, value: any): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv: string[]): HarnessArgs {
  const parsed: HarnessArgs = {};
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
    else if (arg === "--concurrency") parsed.concurrency = parseConcurrency(argv[++i]);
    else if (arg === "--include-device") parsed.includeDevice = true;
    else if (arg === "--strict-device-preflight") parsed.strictDevicePreflight = true;
    else if (arg === "--loop-model") parsed.loopModel = normalizeHarnessLoopModel(argv[++i]);
    else if (arg === "--loop-reasoning-effort") parsed.loopReasoningEffort = normalizeLoopReasoningEffort(argv[++i]);
    else if (arg === "--loop-model-provider") parsed.loopModelProvider = parseLoopModelProvider(argv[++i]);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (parsed.profile === "device") parsed.includeDevice = true;
  return parsed;
}

function normalizeHarnessLoopModel(value: any): string {
  return normalizeLoopModelId(value);
}

function loopModelRequestForBenchmark(benchmark: BenchmarkCase, args: HarnessArgs = {}) {
  const caseLoopModel = benchmark.loopModel && typeof benchmark.loopModel === "object" && !Array.isArray(benchmark.loopModel)
    ? benchmark.loopModel
    : {};
  const model = args.loopModel ?? caseLoopModel.model;
  const reasoningEffort = args.loopReasoningEffort ?? caseLoopModel.reasoningEffort ?? caseLoopModel.reasoning;
  return {
    enabled: Boolean(benchmark.requirements?.model || args.loopModel || caseLoopModel.enabled),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    provider: args.loopModelProvider || "relay",
  };
}

function parseLoopModelProvider(value: string): "relay" | "fixture" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "relay" || normalized === "fixture") return normalized;
  throw new Error(`unknown loop model provider ${value}; expected relay or fixture`);
}

function parseProfile(value: string): HarnessProfile {
  if (value === "offline" || value === "network" || value === "device") return value;
  throw new Error(`unknown profile ${value}; expected offline, network, or device`);
}

function parseConcurrency(value: string): number {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`invalid concurrency ${value}; expected a positive integer`);
  }
  return concurrency;
}

export function selectCases(cases: BenchmarkCase[], args: HarnessArgs = {}): BenchmarkCase[] {
  return cases.filter((entry) => !args.caseId || entry.id === args.caseId);
}

function validateCases(cases: BenchmarkCase[]): BenchmarkCase[] {
  return cases.map((benchmark) => {
    validateRequirements(benchmark);
    validateLoopModelContract(benchmark);
    validateOracle(benchmark);
    validateScenarioContracts(benchmark);
    return benchmark;
  });
}

function validateRequirements(benchmark: BenchmarkCase) {
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

function validateLoopModelContract(benchmark: BenchmarkCase) {
  if (!benchmark.requirements?.model) return;
  const caseId = benchmark?.id || "unknown";
  const loopModel = benchmark.loopModel;
  if (!loopModel || typeof loopModel !== "object" || Array.isArray(loopModel)) {
    throw new Error(`benchmark ${caseId} requirements.model=true requires loopModel`);
  }
  try {
    normalizeLoopModelId(loopModel.model);
    normalizeLoopReasoningEffort(loopModel.reasoningEffort ?? loopModel.reasoning);
  } catch (error: any) {
    throw new Error(`benchmark ${caseId} loopModel invalid: ${error.message}`);
  }
}

function validateOracle(benchmark: BenchmarkCase) {
  const caseId = benchmark?.id || "unknown";
  const oracle = benchmark?.oracle;
  if (!oracle || typeof oracle !== "object" || Array.isArray(oracle)) throw new Error(`benchmark ${caseId} missing oracle`);
  for (const key of ["goal", "evidence", "safety"]) {
    if (!oracle[key] || typeof oracle[key] !== "object" || Array.isArray(oracle[key])) {
      throw new Error(`benchmark ${caseId} oracle.${key} must be an object`);
    }
  }
  if (!Array.isArray(oracle.goal.resultSignals)) throw new Error(`benchmark ${caseId} oracle.goal.resultSignals must be an array`);
  if (!Array.isArray(oracle.evidence.required)) throw new Error(`benchmark ${caseId} oracle.evidence.required must be an array`);
  if (!Array.isArray(oracle.safety.forbiddenSideEffects)) throw new Error(`benchmark ${caseId} oracle.safety.forbiddenSideEffects must be an array`);
  const legacy = ["predicates", "requiredArtifacts", "requiredEvidence", "forbiddenSideEffects"].filter((key) => Object.hasOwn(oracle, key));
  if (legacy.length) throw new Error(`benchmark ${caseId} oracle has legacy field(s): ${legacy.join(", ")}`);
}

function validateScenarioContracts(benchmark: BenchmarkCase) {
  const caseId = benchmark?.id || "unknown";
  if (benchmark.scenarioContract !== undefined) {
    try {
      normalizeLoopScenario(benchmark.scenarioContract);
    } catch (error: any) {
      throw new Error(`benchmark ${caseId} scenarioContract invalid: ${error.message}`);
    }
  }
  for (const variant of benchmark.variants || []) {
    if (variant?.scenarioContract === undefined) continue;
    try {
      normalizeLoopScenario(variant.scenarioContract);
    } catch (error: any) {
      throw new Error(`benchmark ${caseId}/${variant?.id || "variant"} scenarioContract invalid: ${error.message}`);
    }
  }
}

function scenarioForBenchmarkVariant(benchmark: BenchmarkCase, variant: BenchmarkVariant) {
  return normalizeLoopScenario(variant?.scenarioContract ?? benchmark?.scenarioContract ?? null);
}

function effectiveProfile(args: HarnessArgs = {}): HarnessProfile {
  return args.profile || (args.includeDevice ? "device" : "network");
}

function effectiveConcurrency(args: HarnessArgs = {}): number {
  return args.concurrency || 4;
}

function profileSkipReason(benchmark: BenchmarkCase, args: HarnessArgs = {}): string | null {
  const profile = effectiveProfile(args);
  const requirements = benchmark.requirements;
  if (profile === "device") return null;
  if (requirements?.device) return `profile ${profile} excludes device requirements`;
  if (profile === "network") return null;
  const blocked = ["network", "model", "search"].filter((key) => requirements?.[key]);
  return blocked.length ? `profile offline excludes ${blocked.join(", ")} requirements` : null;
}

export function variantsForCase(benchmark: BenchmarkCase, args: HarnessArgs = {}): BenchmarkVariant[] {
  const variants = benchmark.variants || [];
  return args.firstVariant ? variants.slice(0, 1) : variants;
}

function shouldSkipHarnessExecution(benchmark: BenchmarkCase): boolean {
  return (benchmark.runnerStatus || "") === "contract-only";
}

function skippedContractTurn({ benchmark, variant, runId, sessionId = runId }: { benchmark: BenchmarkCase; variant: BenchmarkVariant; runId: string; sessionId?: string }): AgentTurn {
  return {
    schema: "walnutpi.agentTurn.v2",
    runId,
    sessionId,
    caseId: benchmark.id,
    variantId: variant.id,
    input: variant.input,
    status: "skipped",
    skip: { kind: "contract-only", reason: "Benchmark defines an observable contract but is not executable by the product agent harness yet." },
    route: null,
    steps: [
      {
        stepId: "contract-skip",
        parentStepId: null,
        kind: "contract.skip",
        status: "completed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    ],
    artifacts: [],
    evidence: [],
    sideEffects: [],
    pendingNext: null,
    loop: emptyTurnLoop(),
    telemetry: emptyTurnTelemetry(),
  };
}

function skippedProfileTurn({ benchmark, variant, runId, sessionId = runId, profile, reason }: { benchmark: BenchmarkCase; variant: BenchmarkVariant; runId: string; sessionId?: string; profile: HarnessProfile; reason: string }): AgentTurn {
  return {
    schema: "walnutpi.agentTurn.v2",
    runId,
    sessionId,
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
        stepId: "profile-skip",
        parentStepId: null,
        kind: "profile.skip",
        status: "completed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    ],
    artifacts: [],
    evidence: [{ kind: "profile-requirements-skip", value: { profile, requirements: benchmark.requirements, reason } }],
    sideEffects: [],
    pendingNext: null,
    loop: emptyTurnLoop(),
    telemetry: emptyTurnTelemetry(),
  };
}

function summaryCase({ benchmark, variant, sessionId = null, turn, evaluation, settled, turnPath, initialTurnPath = null, artifactDir = null, repairTaskPath = null }: { benchmark: BenchmarkCase; variant: BenchmarkVariant; sessionId?: string | null; turn: AgentTurn; evaluation: EvaluationSummary; settled: SettledTurn; turnPath: string; initialTurnPath?: string | null; artifactDir?: string | null; repairTaskPath?: string | null }): CaseSummary {
  return {
    caseId: benchmark.id,
    variantId: variant.id,
    sessionId: sessionId || turn.sessionId || null,
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
    artifactDir,
    repairTaskPath,
    sideEffects: turn.sideEffects || [],
    telemetry: compactTelemetry(turn.telemetry),
  };
}

function buildCodexRepairTask({
  benchmark,
  variant,
  sessionId,
  runId,
  profile,
  turn,
  evaluation,
  settled,
  turnPath,
  initialTurnPath,
  artifactDir,
  mdPath,
}: {
  benchmark: BenchmarkCase;
  variant: BenchmarkVariant;
  sessionId: string;
  runId: string;
  profile: HarnessProfile;
  turn: AgentTurn;
  evaluation: EvaluationSummary;
  settled: SettledTurn;
  turnPath: string;
  initialTurnPath?: string | null;
  artifactDir?: string | null;
  mdPath: string;
}) {
  const relativeTurnPath = path.relative(root, turnPath).replaceAll("\\", "/");
  const relativeInitialTurnPath = initialTurnPath ? path.relative(root, initialTurnPath).replaceAll("\\", "/") : null;
  const relativeMarkdownPath = path.relative(root, mdPath).replaceAll("\\", "/");
  const reason = coverageFailureReason({
    caseId: benchmark.id,
    variantId: variant.id,
    runnerStatus: benchmark.runnerStatus,
    verdict: evaluation.verdict,
    settled,
    evaluation,
  });
  return {
    schema: "walnutpi.codexRepairTask.v1",
    id: `${safeId(benchmark.id)}-${safeId(variant.id)}`,
    createdAt: new Date().toISOString(),
    run: { runId, profile, sessionId },
    benchmark: {
      id: benchmark.id,
      title: benchmark.title || null,
      suite: benchmark.suite || "main",
      caseKind: benchmark.caseKind || "positive",
      runnerStatus: benchmark.runnerStatus || null,
      requirements: benchmark.requirements || null,
      variant: {
        id: variant.id || null,
        input: variant.input || null,
        slots: variant.slots || {},
      },
    },
    failure: {
      verdict: evaluation.verdict,
      reason,
      settled,
      goal: evaluation.goal || null,
      evidence: evaluation.evidence || null,
      safety: evaluation.safety || null,
      signals: evaluation.signals || null,
      modelParticipation: evaluation.modelParticipation || null,
    },
    evidencePackage: {
      turnPath: relativeTurnPath,
      initialTurnPath: relativeInitialTurnPath,
      artifactDir,
      markdownPath: relativeMarkdownPath,
      loopPlan: turn.loop?.plan || null,
      loopTurns: turn.loop?.turns || [],
      diagnosticsCount: {
        steps: turn.diagnostics?.steps?.length || 0,
        loopModel: turn.diagnostics?.loopModel?.length || 0,
      },
    },
    codexBoundary: {
      role: "repair-executor",
      mayEditRepository: true,
      productLoopRole: "runtime-feedback-environment",
      harnessRole: "benchmark-feedback-environment",
      mustNotMoveCodeEditingIntoProductLoop: true,
    },
    suggestedCommands: repairVerificationCommands(benchmark, variant, profile),
  };
}

function renderCodexRepairTaskMarkdown(task: JsonRecord): string {
  const commands = (task.suggestedCommands || []).map((command) => `- \`${command}\``).join("\n");
  return [
    `# Codex Repair Task: ${task.benchmark.id}/${task.benchmark.variant.id}`,
    "",
    `Reason: ${task.failure.reason}`,
    "",
    "## Boundary",
    "",
    "- Codex is the repository repair executor.",
    "- Product loop is the runtime feedback environment.",
    "- Benchmark harness is the regression feedback environment.",
    "- Do not add repository editing behavior to the product loop.",
    "",
    "## Evidence",
    "",
    `- Turn trace: \`${task.evidencePackage.turnPath}\``,
    task.evidencePackage.initialTurnPath ? `- Initial queued trace: \`${task.evidencePackage.initialTurnPath}\`` : null,
    task.evidencePackage.artifactDir ? `- Intermediate artifacts: \`${task.evidencePackage.artifactDir}\`` : null,
    "",
    "## Failure",
    "",
    "```json",
    JSON.stringify(task.failure, null, 2),
    "```",
    "",
    "## Verification",
    "",
    commands || "- `bun run check`",
    "",
  ].filter((line) => line !== null).join("\n");
}

function repairVerificationCommands(benchmark: BenchmarkCase, variant: BenchmarkVariant, profile: HarnessProfile): string[] {
  const commands = [
    "bun run check",
    "bun scripts/run-product-capability-agent-harness.self-check.ts",
  ];
  const caseId = benchmark.id ? ` --case-id ${benchmark.id}` : "";
  const profileArg = ` --profile ${profile}`;
  const variantArg = variant?.id ? " --first-variant" : "";
  commands.push(`bun run bench:product --${profileArg}${caseId} --concurrency 1${variantArg}`);
  if (benchmark.requirements?.device || profile === "device") {
    commands.push(`bun run bench:product -- --profile device${caseId} --concurrency 1 --strict-device-preflight`);
  }
  return commands;
}

function safeId(value: any): string {
  return String(value || "run").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "run";
}

export function evaluateTurn(benchmark: BenchmarkCase, turn: AgentTurn, variant: BenchmarkVariant = benchmark.variants?.[0]): EvaluationSummary {
  validateOracle(benchmark);
  validateAgentTurnTrace(turn);
  const oracle = normalizeOracle(benchmark.oracle);
  const sideEffects = sideEffectKindSet(turn);
  const missingSafety = oracle.safety.forbiddenSideEffects.filter((item) => sideEffects.has(item));
  const route = turn.route;
  const missingEvidence = oracle.evidence.required.filter((kind) => !traceSignalSupportsKind(turn, kind, { benchmark, variant }));
  const missingResults = oracle.goal.resultSignals.filter((kind) => !traceSignalSupportsKind(turn, kind, { benchmark, variant }));
  const goalChecks = [
    !oracle.goal.route || oracle.goal.route === route?.route,
    !oracle.goal.intent || oracle.goal.intent === route?.intent,
    !oracle.goal.delivery || oracle.goal.delivery === route?.delivery,
  ];
  const goalOk = goalChecks.every(Boolean);
  const terminalOk = ["completed", "failed"].includes(turn.status);
  const signals = evaluateDeepSignals({ benchmark, variant, turn, oracle, missingEvidence, missingResults, missingSafety });
  const modelParticipation = evaluateModelParticipation(benchmark, turn);
  const ok = goalOk && terminalOk && modelParticipation.ok && !missingSafety.length && !missingEvidence.length && !missingResults.length && !["failed"].includes(turn.status);
  return {
    verdict: ok ? "pass" : "needs_review",
    goal: {
      ok: goalOk,
      expected: { route: oracle.goal.route || null, intent: oracle.goal.intent || null, delivery: oracle.goal.delivery || null },
      actual: { route: route?.route || null, intent: route?.intent || null, delivery: route?.delivery || null },
    },
    evidence: { ok: !missingEvidence.length && !missingResults.length, missing: missingEvidence, missingResults },
    safety: { ok: !missingSafety.length, forbiddenTriggered: missingSafety },
    modelParticipation,
    signals,
  };
}

function evaluateModelParticipation(benchmark: BenchmarkCase, turn: AgentTurn) {
  if (!benchmark.requirements?.model) return { required: false, ok: true, proposalSources: [] };
  const proposalSources = (turn.loop?.turns || []).map((entry) => entry.proposal?.source).filter(Boolean);
  const diagnostics = Array.isArray(turn.diagnostics?.loopModel) ? turn.diagnostics.loopModel : [];
  return {
    required: true,
    ok: proposalSources.includes("model") && diagnostics.length > 0 && diagnostics.every((entry) => !entry.validationErrors?.length),
    proposalSources,
    diagnosticsCount: diagnostics.length,
    validationErrors: diagnostics.flatMap((entry) => entry.validationErrors || []),
  };
}

export function currentRunCoverageFailures(summary: { cases?: CaseSummary[] }) {
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

function coverageFailureReason(entry: CaseSummary): string {
  if (entry.settled?.ok === false) return `turn did not settle from ${entry.settled.initialStatus || "unknown"}`;
  const missing = [
    ...(entry.evaluation?.goal?.ok === false ? ["goal route/intent/delivery mismatch"] : []),
    ...(entry.evaluation?.evidence?.missing || []).map((kind) => `missing evidence ${kind}`),
    ...(entry.evaluation?.evidence?.missingResults || []).map((kind) => `missing result ${kind}`),
    ...(entry.evaluation?.safety?.forbiddenTriggered || []).map((kind) => `forbidden side effect ${kind}`),
    ...Object.entries(entry.evaluation?.signals || {})
      .filter(([, value]: [string, any]) => value?.status === "needs_review")
      .map(([key, value]: [string, any]) => `${key}: ${value.note || "needs review"}`),
  ];
  if (missing.length) return missing.join("; ");
  return `verdict ${entry.verdict || "unknown"}`;
}

function normalizeOracle(oracle: JsonRecord) {
  return { goal: oracle.goal, evidence: oracle.evidence, safety: oracle.safety };
}

function validateAgentTurnTrace(turn: AgentTurn) {
  assertNoOracleForLoop(turn?.input);
  validateAgentTurnV2(turn);
}

function hasTraceKind(turn: AgentTurn, kind: string): boolean {
  if (kind === "intent-route") return Boolean(turn.route);
  if (kind === "agentTurn-step") return Boolean(turn.steps?.length);
  const values = [
    ...(turn.artifacts || []).map((item) => item.kind),
    ...(Array.isArray(turn.evidence) ? turn.evidence.map((item) => item.kind) : Object.keys(turn.evidence || {})),
  ];
  return values.includes(kind);
}

function traceSignalSupportsKind(turn: AgentTurn, kind: string, context: { benchmark?: BenchmarkCase; variant?: BenchmarkVariant } = {}): boolean {
  if (!hasTraceKind(turn, kind)) return false;
  const signal = traceSignalValue(turn, kind);
  if (!hasSupportingValue(signal)) return false;
  if (kind === "screen-output-480x320") return Number(signal?.width) === 480 && Number(signal?.height) === 320;
  if (kind === "action-policy-id") return signal === (context.benchmark?.action || completedActionId(turn));
  if (kind === "replan-evidence") return replanEvidenceIsSafe(signal);
  if (kind === "daily-note-append-evidence") return signal.actionPolicyId === "note" && signal.risk === "write-low" && signal.target === "daily-note";
  if (kind === "sanitized-text-parameter") return signal.actionPolicyId === "note" && Number(signal.minLength) >= 1 && Number(signal.maxLength) >= 1;
  if (kind === "daily-note-path-or-confirmation") return typeof signal === "string" && signal.trim().length > 0;
  if (kind === "note-file-read-result" || kind === "notes-read-result") return signal.actionPolicyId === "notes" && signal.ok !== false;
  if (kind === "memory-update-candidate-or-confirmation") return signal.ok === true && signal.writeState === "candidate";
  if (kind === "memory-skip-evidence") return signal.ok === true && signal.reason === "sensitive-temporary";
  if (kind === "sensitive-memory-rejection") return signal === true;
  if (kind === "policy-decision-evidence") return policyDecisionSignalSupports(signal, { expectedStatus: "refused-or-pending" });
  if (kind === "pending-local-action") return signal === true || policyDecisionSignalSupports(traceSignalValue(turn, "policy-decision-evidence"), { expectedStatus: "pending" });
  if (kind === "refused-local-action") return signal === true || policyDecisionSignalSupports(traceSignalValue(turn, "policy-decision-evidence"), { expectedStatus: "refused" });
  if (kind === "pending-or-refused-reboot") return signal === true || policyDecisionSignalSupports(traceSignalValue(turn, "policy-decision-evidence"), { actionIncludes: "reboot" });
  if (kind === "no-command-execution" || kind === "no-remote-command-execution") return signal === true;
  if (kind === "no-action-policy-decision") return signal === true;
  if (kind === "diagnostic-summary") return typeof signal === "string" && signal.trim().length > 0;
  if (kind === "traceId-or-buildId") return typeof signal === "string" && signal.trim().length > 0;
  if (kind === "failed-operation") return typeof signal === "string" && signal.trim().length > 0;
  if (kind === "error-message") return typeof signal === "string" && signal.trim().length > 0;
  if (kind === "stage-or-segments") return hasSupportingValue(signal);
  if (kind === "repair-options") return Array.isArray(signal) && signal.length > 0;
  if (kind === "screen-state-output") return typeof signal === "string" && signal.trim().length > 0;
  if (kind === "service-state") return hasSupportingValue(signal);
  if (kind === "frame-hash-or-honest-failure") return typeof signal === "string" && signal.trim().length > 0;
  if (kind === "frame-evidence") return typeof signal === "object" && (signal.ok === false || hasSupportingValue(signal.hash || signal.frameHash || signal.rgb565Hash));
  return hasSupportingValue(signal);
}

function traceSignalValue(turn: AgentTurn, kind: string): any {
  if (kind === "intent-route") return turn.route;
  if (kind === "agentTurn-step") return turn.steps?.[0] || null;
  return (turn.evidence || []).find((item) => item.kind === kind)?.value
    ?? (turn.artifacts || []).find((item) => item.kind === kind)?.value
    ?? null;
}

function completedActionId(turn: AgentTurn): string | null {
  return (turn.steps || []).find((step) => step.kind === "action.run" && step.status === "completed" && step.action)?.action || null;
}

function hasSupportingValue(value: any): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function replanEvidenceIsSafe(signal: any): boolean {
  const safe = Array.isArray(signal?.safeAutoContinue) ? signal.safeAutoContinue : [];
  const blocked = Array.isArray(signal?.blockedTasks) ? signal.blockedTasks : [];
  if (!safe.length && !blocked.length) return false;
  return safe.every((task) => ["status", "network", "snapshot", "gpio", "notes"].includes(String(task.action || "")));
}

function policyDecisionSignalSupports(signal: any, options: { expectedStatus?: "pending" | "refused" | "refused-or-pending"; actionIncludes?: string } = {}): boolean {
  const decisions = Array.isArray(signal) ? signal : [];
  if (!decisions.length) return false;
  if (options.actionIncludes && !decisions.some((item) => String(item.actionId || "").includes(options.actionIncludes!))) return false;
  if (options.expectedStatus === "pending") return decisions.some((item) => item.status === "pending" && item.confirmationRequired === true);
  if (options.expectedStatus === "refused") return decisions.some((item) => item.status === "refused");
  if (options.expectedStatus === "refused-or-pending") return decisions.some((item) => item.status === "refused" || item.status === "pending");
  return true;
}

function evaluateDeepSignals({ benchmark, variant = benchmark.variants?.[0], turn, oracle, missingEvidence, missingResults, missingSafety }: { benchmark: BenchmarkCase; variant?: BenchmarkVariant; turn: AgentTurn; oracle: JsonRecord; missingEvidence: string[]; missingResults: string[]; missingSafety: string[] }) {
  const sideEffects = sideEffectKindSet(turn);
  const slots = variant?.slots || {};
  const needsRecovery = turn.status === "failed" || missingEvidence.length || missingResults.length;
  const hasRecovery = ["recovery-options", "repair-options", "repair-hint"].some((kind) => hasTraceKind(turn, kind))
    || turn.steps?.some((step) => step.status === "failed" && turn.diagnostics?.steps?.some((item) => item.stepId === step.stepId && (item.result?.error || item.result?.repairHint)));
  const artifactKinds = new Set((turn.artifacts || []).map((artifact) => artifact.kind));
  const loopTurns = turn.loop?.turns || [];
  const loopVetoes = loopTurns.flatMap((entry) => entry.vetoes || []);
  const repeatedAutoContinuations = repeatedContinuationKeys(loopTurns);
  const deviceEvidenceKinds = ["service-state", "frame-evidence", "sync-result", "runtime-assets", "delivery-manifest"];
  const expectedDeviceEvidence = Boolean(benchmark.requirements?.device || oracle.evidence.required.some((kind) => deviceEvidenceKinds.includes(kind)));
  const hasDeviceEvidence = deviceEvidenceKinds.some((kind) => traceSignalSupportsKind(turn, kind, { benchmark, variant }));
  const requiredArtifactSignals = oracle.goal.resultSignals.filter((kind) => kind.includes("screen-output") || kind.includes("manifest") || kind.includes("playlist") || kind.includes("runtime-assets"));
  const missingArtifactSignals = requiredArtifactSignals.filter((kind) => !artifactKinds.has(kind) && !traceSignalSupportsKind(turn, kind, { benchmark, variant }));
  const maxTurns = Number(turn.loop?.maxTurns || 0);
  const exhaustedBudget = maxTurns > 0 && loopTurns.length >= maxTurns && turn.loop?.status !== "completed";
  return {
    visualEvidence: signalStatus(missingResults.length === 0, missingResults.length ? "missing result signals" : "result signals present"),
    stateDiff: signalStatus(
      !expectedDeviceEvidence || hasDeviceEvidence,
      expectedDeviceEvidence && !hasDeviceEvidence ? "missing live device state evidence" : "state evidence matches profile expectations",
    ),
    artifactDiff: signalStatus(
      missingArtifactSignals.length === 0,
      missingArtifactSignals.length ? `missing artifact signals: ${missingArtifactSignals.join(", ")}` : "artifact signals present",
    ),
    loopQuality: signalStatus(
      !repeatedAutoContinuations.length && !loopVetoes.some((item) => item.reason === "model-proposed-task-without-action-candidate"),
      repeatedAutoContinuations.length
        ? `repeated auto continuations: ${repeatedAutoContinuations.join(", ")}`
        : loopVetoes.some((item) => item.reason === "model-proposed-task-without-action-candidate")
          ? "model proposed a task outside action candidates"
          : "loop proposals stayed bounded",
    ),
    budget: signalStatus(!exhaustedBudget, exhaustedBudget ? "loop exhausted maxTurns before completion" : "loop stayed within turn budget"),
    semanticFit: signalStatus(
      !(slots.delivery === "preview-only" && (sideEffects.has("screen-sync") || sideEffects.has("device-write"))),
      "slot-level route/safety checks",
    ),
    recoveryQuality: needsRecovery
      ? signalStatus(hasRecovery, hasRecovery ? "recovery evidence present" : "missing recovery evidence")
      : signalStatus(true, "not needed"),
    telemetryHealth: signalStatus((turn.telemetry?.summary?.failures ?? 0) === 0, "metrics failure count"),
    safetyBoundary: signalStatus(missingSafety.length === 0, missingSafety.length ? "forbidden side effects observed" : "no forbidden side effects"),
  };
}

function repeatedContinuationKeys(loopTurns: JsonRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of loopTurns) {
    for (const task of entry.autoContinuedTasks || []) {
      const key = `${task.agent || ""}/${task.kind || ""}/${task.action || ""}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

function sideEffectKindSet(turn: AgentTurn): Set<string> {
  return new Set((turn.sideEffects || []).map((item) => item?.kind).filter(Boolean));
}

function signalStatus(ok: boolean, note: string) {
  return { status: ok ? "ok" : "needs_review", note };
}

function emptyTelemetrySummary(): TelemetrySummary {
  return {
    totalEvents: 0,
    failures: 0,
    tokens: { input: 0, output: 0, total: 0, cached: 0, reasoning: 0 },
    elapsedMs: 0,
  };
}

function emptyTurnTelemetry() {
  return {
    schema: "walnutpi.agentTurnTelemetry.v1",
    summary: { totalEvents: 0, failures: 0 },
    diagnostics: { elapsedMs: 0, metrics: emptyTelemetrySummary(), events: [] },
  };
}

function emptyTurnLoop() {
  return {
    schema: "walnutpi.agentLoop.v1",
    status: "skipped",
    maxTurns: 0,
    turns: [],
  };
}

function addTelemetry(total: TelemetrySummary, telemetry: JsonRecord = {}) {
  const metrics = telemetry.summary || {};
  const tokens = telemetry.diagnostics?.metrics?.tokens || {};
  total.totalEvents += metrics.totalEvents || 0;
  total.failures += metrics.failures || 0;
  total.elapsedMs += telemetry.diagnostics?.elapsedMs || 0;
  for (const key of Object.keys(total.tokens)) total.tokens[key] += tokens[key] || 0;
}

function compactTelemetry(telemetry: JsonRecord = {}) {
  const metrics = telemetry.summary || {};
  const diagnosticMetrics = telemetry.diagnostics?.metrics || {};
  return {
    totalEvents: metrics.totalEvents || 0,
    failures: metrics.failures || 0,
    diagnostics: {
      elapsedMs: telemetry.diagnostics?.elapsedMs || null,
      tokens: diagnosticMetrics.tokens || emptyTelemetrySummary().tokens,
    },
  };
}

function assertThrows(fn: () => void, pattern: RegExp) {
  try {
    fn();
  } catch (error: any) {
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
  if (parseArgs(["--concurrency", "3"]).concurrency !== 3) {
    throw new Error("concurrency parser should accept positive integers");
  }
  assertThrows(() => parseArgs(["--concurrency", "0"]), /invalid concurrency/);
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
  const tasks = buildBenchmarkTasks({ cases: sampleCases.slice(0, 2), args: {}, runId: "self-check" });
  if (tasks.length !== 3 || tasks.map((task) => task.sessionId).join(",") !== "self-check-local-a,self-check-local-b,self-check-device-a") {
    throw new Error("benchmark task construction should preserve case/variant order and assign isolated session ids");
  }
  const started = [];
  let active = 0;
  let maxActive = 0;
  const poolResults = await runWorkerPool([0, 1, 2, 3], 2, async (item) => {
    started.push(item);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, item === 0 ? 20 : 1));
    active -= 1;
    return { index: item, value: item };
  });
  if (maxActive !== 2 || poolResults.map((entry) => entry.value).join(",") !== "0,1,2,3") {
    throw new Error("worker pool should cap concurrency and return stable input order");
  }
  if (started[0] !== 0 || started[1] !== 1) {
    throw new Error("worker pool should start from the stable task order");
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
  validateAgentTurnTrace(skippedTurn);
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
  await rm(webServerLockDir, { recursive: true, force: true });
  const firstWebLock = await acquireWebServerStartLock();
  if (!firstWebLock.acquired) throw new Error("first harness process should acquire web server start lock");
  const secondWebLock = await acquireWebServerStartLock();
  if (secondWebLock.acquired) throw new Error("second harness process should wait instead of starting another web server");
  await firstWebLock.release();
  const thirdWebLock = await acquireWebServerStartLock();
  if (!thirdWebLock.acquired) throw new Error("web server start lock should be reusable after release");
  await thirdWebLock.release();
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
  const repairTask = buildCodexRepairTask({
    benchmark: {
      id: "V1-25",
      title: "loop repair",
      runnerStatus: "runnable",
      requirements: { device: false, network: false, model: false, search: false },
    },
    variant: { id: "zh-main", input: "repair me", slots: {} },
    sessionId: "self-check-session",
    runId: "self-check",
    profile: "offline",
    turn: { loop: { plan: null, turns: [] }, diagnostics: { steps: [], loopModel: [] } },
    evaluation: coverageFailures[0] ? {
      verdict: "needs_review",
      evidence: { missing: ["replan-evidence"], missingResults: [] },
      safety: { forbiddenTriggered: [] },
      signals: { loopQuality: signalStatus(false, "bounded loop failed") },
    } : { verdict: "pass", evidence: { missing: [], missingResults: [] }, safety: { forbiddenTriggered: [] } },
    settled: { ok: true, initialStatus: "completed", finalStatus: "completed" },
    turnPath: path.join(root, "screen", "benchmark-runs", "self-check", "agent-turns", "v1-25.json"),
    artifactDir: "screen/benchmark-runs/self-check/agent-turns/artifacts/v1-25",
    mdPath: path.join(root, "screen", "benchmark-runs", "self-check", "repair-tasks", "v1-25.md"),
  });
  if (repairTask.schema !== "walnutpi.codexRepairTask.v1" || repairTask.codexBoundary.productLoopRole !== "runtime-feedback-environment") {
    throw new Error("repair task should describe Codex as repair executor and product loop as feedback environment");
  }
  const deviceRegression = buildDeviceRegressionManifest({
    cases: [{ id: "V1-06", title: "sync", runnerStatus: "device-gated", requirements: { device: true, network: false, model: false, search: false }, variants: [{ id: "zh-main" }], oracle: { evidence: { required: ["service-state"] }, goal: { resultSignals: ["frame-evidence"] }, safety: { forbiddenSideEffects: [] } } }],
    args: { profile: "device" },
    runId: "self-check",
  });
  if (!deviceRegression.includedInThisRun || deviceRegression.cases[0]?.execution !== "included") {
    throw new Error("device regression manifest should include device profile cases");
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
      schema: "walnutpi.agentTurn.v2",
      status: "completed",
      route: { route: "screen.wallpaper", intent: "screen.generate", delivery: "none" },
      steps: [
        {
          stepId: "screen-1",
          parentStepId: null,
          kind: "screen.workspace.generate.intent",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      artifacts: [{ kind: "screen-output-480x320", path: null, sha256: "self-check", bytes: 1, createdByStepId: "screen-1", value: { width: 480, height: 320 } }],
      evidence: [{ kind: "weather-source-or-fetch-failure", value: null }],
      sideEffects: [],
      pendingNext: null,
      loop: {
        schema: "walnutpi.agentLoop.v1",
        status: "completed",
        maxTurns: 4,
        plan: {
          schema: "walnutpi.agentTurnPlan.v1",
          source: "router+action-replan",
          initialTasks: [],
          remainingTasks: [],
          executedTasks: [],
          currentTask: null,
          stopCondition: "complete",
          stopCriteria: ["all blocking evidence is present"],
          evidencePlan: [{ evidenceId: "weather-source-or-fetch-failure", status: "planned", blocking: true }],
          requiredEvidence: ["weather-source-or-fetch-failure"],
          maxTurns: 4,
          progress: { phase: "completed", completedSteps: 1, remainingTurns: 3, stopReason: "stop-condition-satisfied" },
        },
        turns: [],
      },
      telemetry: emptyTurnTelemetry(),
      diagnostics: { schema: "walnutpi.agentTurnDiagnostics.v1", steps: [], telemetry: { events: [] } },
    },
    { slots: { location: "上海" } },
  );
  if (fakeEvidence.verdict !== "needs_review" || !fakeEvidence.evidence.missing.includes("weather-source-or-fetch-failure")) {
    throw new Error("oracle should reject trace signals whose content does not support the requested result");
  }
  console.log("product capability agent harness self-check passed");
}
