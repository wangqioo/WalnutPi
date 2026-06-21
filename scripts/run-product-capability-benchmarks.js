#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const defaultBenchmarks = path.join(root, "docs", "product-capability-benchmarks.v2.jsonl");
const defaultOutputRoot = path.join(root, "screen", "benchmark-runs");
const scoringKeys = [
  "goal_understanding",
  "capability_selection",
  "loop_completeness",
  "artifact_validity",
  "visual_alignment",
  "evidence_quality",
  "safety_boundary",
  "user_summary",
  "failure_recovery",
];

if (import.meta.main) await main();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheck) {
    await selfCheck();
    return;
  }

  const baseUrl = args.baseUrl || "http://127.0.0.1:4173";
  const cases = (await readJsonl(args.file || defaultBenchmarks)).filter((entry) => !args.caseId || entry.id === args.caseId);
  if (!cases.length) throw new Error(`no benchmark cases matched${args.caseId ? ` ${args.caseId}` : ""}`);

  const runId = args.runId || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const outDir = path.join(args.outputDir || defaultOutputRoot, runId);
  const turnDir = path.join(outDir, "agent-turns");
  await mkdir(turnDir, { recursive: true });

  const summary = {
    schema: "walnutpi.productCapabilityBenchmarkRun.v1",
    runId,
    startedAt: new Date().toISOString(),
    baseUrl,
    includeDevice: Boolean(args.includeDevice),
    cases: [],
  };

  for (const benchmark of cases) {
    const variants = args.allVariants ? benchmark.variants : benchmark.variants.slice(0, 1);
    for (const variant of variants) {
      const turn = await runVariant({ benchmark, variant, runId, baseUrl, includeDevice: args.includeDevice });
      await writeJson(path.join(turnDir, `${safeId(benchmark.id)}-${safeId(variant.id)}.json`), turn);
      summary.cases.push({
        caseId: benchmark.id,
        variantId: variant.id,
        status: turn.status,
        score: turn.score,
        passedPredicates: turn.predicates.filter((predicate) => predicate.ok).length,
        totalPredicates: turn.predicates.length,
        turnPath: path.relative(root, path.join(turnDir, `${safeId(benchmark.id)}-${safeId(variant.id)}.json`)).replaceAll("\\", "/"),
      });
    }
  }

  summary.finishedAt = new Date().toISOString();
  await writeJson(path.join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.cases.some((entry) => entry.status === "fail")) process.exit(1);
}

async function runVariant({ benchmark, variant, runId, baseUrl, includeDevice }) {
  const input = variant.input;
  const turn = {
    schema: "walnutpi.agentTurn.v1",
    runId,
    caseId: benchmark.id,
    variantId: variant.id,
    input,
    route: null,
    plan: { flow: benchmark.flow, action: benchmark.action || null, slots: variant.slots || {} },
    steps: [],
    artifacts: [],
    evidence: [],
    sideEffects: [],
    forbiddenActions: [],
    predicates: [],
    scores: Object.fromEntries(scoringKeys.map((key) => [key, 0])),
    recovery: null,
    status: "fail",
  };

  await classifyTurn({ turn, baseUrl, input });

  if (benchmark.deviceRequired && !includeDevice) {
    turn.steps.push({ stage: "skip", action: "device-required", ok: true, output: "skipped; pass --include-device to run" });
    turn.status = "skipped";
    turn.recovery = "Re-run with --include-device when real-device writes are allowed.";
    return scoreTurn(turn, benchmark);
  }

  if (benchmark.flow === "screen.generate") await runScreenGenerate({ turn, benchmark, variant, baseUrl, runId });
  else if (benchmark.flow === "action.run") await runAction({ turn, benchmark, baseUrl });
  else if (benchmark.flow === "screen.sync") await runScreenSync({ turn, baseUrl });
  else throw new Error(`unsupported flow ${benchmark.flow}`);

  return scoreTurn(turn, benchmark);
}

async function classifyTurn({ turn, baseUrl, input }) {
  const response = await postJson(`${baseUrl}/api/intent/classify`, { text: input });
  const classification = response.classification || null;
  turn.route = classification;
  turn.steps.push({ stage: "understand", action: "POST /api/intent/classify", ok: Boolean(classification), response });
  turn.evidence.push({ kind: "intent-route", ref: "steps[understand].response.classification" });
}

async function runScreenGenerate({ turn, benchmark, variant, baseUrl, runId }) {
  const screenId = safeId(`${runId}-${benchmark.id}-${variant.id}`);
  const body = {
    prompt: variant.input,
    screenId,
    playlist: screenId,
    title: variant.slots?.location ? `${variant.slots.location}天气` : benchmark.title,
  };
  const response = await postJson(`${baseUrl}/api/screen/workspace/generate`, body);
  turn.steps.push({ stage: "process", action: "POST /api/screen/workspace/generate", ok: Boolean(response.ok), response });
  turn.sideEffects.push({ kind: "local-write", detail: "screen workspace artifacts" });
  if (response.facts?.facts?.some((fact) => fact.source)) turn.sideEffects.push({ kind: "network-read", detail: "weather source" });
  collectScreenArtifacts(turn, response);
  if (response.facts) turn.evidence.push({ kind: "weather-source-or-fetch-failure", ref: "steps[process].response.facts" });
  if (response.playlist) {
    const playlist = await getJson(`${baseUrl}/api/screen/workspace/playlist?id=${encodeURIComponent(screenId)}`);
    turn.steps.push({ stage: "preview", action: "GET /api/screen/workspace/playlist?id=<run-playlist>", ok: Boolean(playlist.ok), response: playlist });
    turn.evidence.push({ kind: "playlist-envelope", ref: "steps[preview].response" });
  }
}

async function runAction({ turn, benchmark, baseUrl }) {
  const response = await postJson(`${baseUrl}/api/action`, { action: benchmark.action });
  turn.steps.push({ stage: "device-read", action: "POST /api/action", ok: Boolean(response.ok), response });
  turn.sideEffects.push({ kind: "device-read", detail: benchmark.action });
  turn.evidence.push({ kind: "action-policy-id", value: response.id || benchmark.action });
  turn.evidence.push({ kind: "bus-read-output", ref: "steps[device-read].response.output" });
}

async function runScreenSync({ turn, baseUrl }) {
  const playlist = await getJson(`${baseUrl}/api/screen/workspace/playlist`);
  turn.steps.push({ stage: "prepare", action: "GET /api/screen/workspace/playlist", ok: Boolean(playlist.ok), response: playlist });
  if (!playlist.playlistHash) {
    turn.recovery = "Current playlist has no playlistHash; generate or refresh preview first.";
    return;
  }
  const response = await postJson(`${baseUrl}/api/screen/workspace/sync`, {
    playlistHash: playlist.playlistHash,
    evidenceMode: "full",
  });
  turn.steps.push({ stage: "sync", action: "POST /api/screen/workspace/sync", ok: Boolean(response.ok), response });
  turn.sideEffects.push({ kind: "device-write", detail: "screen runtime delivery" });
  if (response.command?.includes("restart walnut-screen.service")) turn.sideEffects.push({ kind: "service-restart", detail: "sync activation fallback" });
  if (response.screenEvidence?.frame) turn.sideEffects.push({ kind: "frame-capture", detail: "sync evidence frame" });
  if (response.deliveryManifest) turn.artifacts.push({ kind: "delivery-manifest", value: response.deliveryManifest });
  if (response.deliveryManifest?.generatedResources) turn.artifacts.push({ kind: "runtime-assets", value: response.deliveryManifest.generatedResources });
  turn.evidence.push({ kind: "playlistHash", value: response.playlistHash || playlist.playlistHash });
  if (response.screenEvidence) turn.evidence.push({ kind: "device-evidence", ref: "steps[sync].response.screenEvidence" });
  if (!response.ok) turn.recovery = response.repairHint?.summary || response.summary || "Sync failed; inspect screen evidence.";
}

function collectScreenArtifacts(turn, response) {
  if (response.manifest?.schema === "walnutpi.screen-manifest.v2") turn.artifacts.push({ kind: "screen-manifest-v2", value: response.manifest });
  if (response.playlist?.schema === "walnutpi.screen-playlist.v1") turn.artifacts.push({ kind: "screen-playlist-v1", value: response.playlist });
  if (response.output) turn.artifacts.push({ kind: "screen-output", value: response.output });
}

function scoreTurn(turn, benchmark) {
  turn.predicates = benchmark.oracle.predicates.map((predicate) => ({
    ...predicate,
    ok: evaluatePredicate(turn, predicate, benchmark),
  }));
  const passed = turn.predicates.filter((predicate) => predicate.ok).length;
  const total = turn.predicates.length || 1;
  const score2 = (ok) => (ok ? 2 : 0);
  turn.scores.goal_understanding = score2(predicateOk(turn, "routeIs") || predicateOk(turn, "actionIdIs"));
  turn.scores.capability_selection = score2(predicateOk(turn, "intentIs") || predicateOk(turn, "actionRiskIs") || predicateOk(turn, "syncHasPlaylistHash"));
  turn.scores.loop_completeness = Math.round((passed / total) * 2);
  turn.scores.artifact_validity = score2(predicateOk(turn, "screenArtifactValid") || predicateOk(turn, "syncHasDeliveryManifest") || predicateOk(turn, "i2cEvidenceOrHonestFailure"));
  turn.scores.visual_alignment = benchmark.flow === "screen.sync" ? score2(turn.steps.at(-1)?.response?.screenEvidence?.visualMatch === "captured") : 2;
  turn.scores.evidence_quality = score2(turn.evidence.length > 0);
  turn.scores.safety_boundary = score2(predicateOk(turn, "noForbiddenSideEffects"));
  turn.scores.user_summary = 1;
  turn.scores.failure_recovery = turn.recovery || turn.status === "skipped" ? 2 : 1;
  turn.score = Object.values(turn.scores).reduce((sum, value) => sum + value, 0);
  turn.status = turn.status === "skipped" ? "skipped" : passed === total ? "pass" : passed > 0 ? "partial" : "fail";
  return turn;
}

function evaluatePredicate(turn, predicate, benchmark) {
  const response = turn.steps.at(-1)?.response || {};
  if (predicate.kind === "routeIs") return turn.route?.route === predicate.value;
  if (predicate.kind === "intentIs") return turn.route?.intent === predicate.value;
  if (predicate.kind === "deliveryIs") return turn.route?.delivery === predicate.value;
  if (predicate.kind === "actionIdIs") return response.id === predicate.value || benchmark.action === predicate.value;
  if (predicate.kind === "actionRiskIs") return response.risk === predicate.value;
  if (predicate.kind === "screenArtifactValid") return screenArtifactValid(turn);
  if (predicate.kind === "weatherLocationMatchesSlot") return weatherLocationMatchesSlot(turn);
  if (predicate.kind === "weatherSourceOrHonestFailure") return weatherSourceOrHonestFailure(turn);
  if (predicate.kind === "i2cEvidenceOrHonestFailure") return i2cEvidenceOrHonestFailure(turn);
  if (predicate.kind === "syncHasPlaylistHash") return Boolean(response.playlistHash || evidenceValue(turn, "playlistHash"));
  if (predicate.kind === "syncHasDeliveryManifest") return Boolean(response.deliveryManifest);
  if (predicate.kind === "syncHasDeviceEvidence") return Boolean(response.screenEvidence?.state || response.screenEvidence?.frame);
  if (predicate.kind === "noForbiddenSideEffects") return noForbiddenSideEffects(turn, benchmark.oracle.forbiddenSideEffects || []);
  throw new Error(`unsupported predicate ${predicate.kind}`);
}

function screenArtifactValid(turn) {
  const manifest = artifactValue(turn, "screen-manifest-v2");
  const playlist = artifactValue(turn, "screen-playlist-v1");
  const output = artifactValue(turn, "screen-output");
  return manifest?.schema === "walnutpi.screen-manifest.v2"
    && playlist?.schema === "walnutpi.screen-playlist.v1"
    && output?.width === 480
    && output?.height === 320;
}

function weatherLocationMatchesSlot(turn) {
  const slot = String(turn.plan.slots.location || "").toLowerCase();
  const facts = turn.steps.find((step) => step.stage === "process")?.response?.facts?.facts || [];
  return facts.some((fact) => String(fact.location || fact.city || "").toLowerCase().includes(slot));
}

function weatherSourceOrHonestFailure(turn) {
  const processStep = turn.steps.find((step) => step.stage === "process");
  if (processStep?.response?.facts?.facts?.some((fact) => fact.source)) return true;
  return Boolean(processStep?.response?.ok === false && (processStep.response.error || processStep.response.output));
}

function i2cEvidenceOrHonestFailure(turn) {
  const output = String(turn.steps.find((step) => step.stage === "device-read")?.response?.output || "");
  return /\/dev\/i2c-|i2cdetect unavailable|no \/dev\/i2c-\* nodes found|timed out after \d+s/.test(output);
}

function noForbiddenSideEffects(turn, forbidden) {
  const output = turn.steps.map((step) => `${step.action}\n${JSON.stringify(step.response || {})}`).join("\n").toLowerCase();
  const sideEffectKinds = new Set(turn.sideEffects.map((effect) => effect.kind));
  const sideEffectMap = {
    "device-write": "device-write",
    "service-restart": "service-restart",
    "frame-capture": "frame-capture",
    "ssh-delivery": "device-write",
    "gpio-output": "gpio-output",
    "overlay-change": "overlay-change",
    "package-install": "package-install",
    reboot: "reboot",
    "sync-without-playlist-hash": "sync-without-playlist-hash",
    "regenerate-during-sync": "regenerate-during-sync",
  };
  return forbidden.every((item) => {
    if (sideEffectKinds.has(sideEffectMap[item] || item)) return false;
    if (item === "overlay-change") return !/(overlay-change|set-device enable|set-device disable)/.test(output);
    if (item === "package-install") return !/(apt-get install|package-install)/.test(output);
    if (item === "reboot") return !/\breboot\b/.test(output);
    if (item === "sync-without-playlist-hash") return !turn.steps.some((step) => step.stage === "sync" && !step.response?.playlistHash);
    if (item === "regenerate-during-sync") return !turn.steps.some((step) => step.stage === "sync" && /workspace\/generate/.test(JSON.stringify(step.response || {})));
    return true;
  });
}

function predicateOk(turn, kind) {
  return turn.predicates.some((predicate) => predicate.kind === kind && predicate.ok);
}

function artifactValue(turn, kind) {
  return turn.artifacts.find((artifact) => artifact.kind === kind)?.value || null;
}

function evidenceValue(turn, kind) {
  return turn.evidence.find((evidence) => evidence.kind === kind)?.value || null;
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

async function readJsonl(file) {
  const text = await readFile(file, "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function safeId(value) {
  return String(value || "run").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "run";
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-check") parsed.selfCheck = true;
    else if (arg === "--all-variants") parsed.allVariants = true;
    else if (arg === "--include-device") parsed.includeDevice = true;
    else if (arg === "--case") parsed.caseId = argv[++i];
    else if (arg === "--base-url") parsed.baseUrl = argv[++i];
    else if (arg === "--file") parsed.file = path.resolve(argv[++i]);
    else if (arg === "--output-dir") parsed.outputDir = path.resolve(argv[++i]);
    else if (arg === "--run-id") parsed.runId = safeId(argv[++i]);
    else throw new Error(`unknown argument ${arg}`);
  }
  return parsed;
}

async function selfCheck() {
  const cases = await readJsonl(defaultBenchmarks);
  assert.equal(cases.length, 3);
  assert.ok(cases.every((entry) => entry.schema === "walnutpi.product-capability-benchmark.v2"));
  assert.ok(cases.every((entry) => entry.variants.length >= 1));
  assert.ok(cases.every((entry) => entry.oracle.predicates.length >= 1));
  const sample = {
    route: { route: "screen.wallpaper", intent: "screen.generate", delivery: "none" },
    plan: { slots: { location: "上海" } },
    steps: [{ stage: "process", response: { facts: { facts: [{ source: "wttr.in", location: "上海" }] } } }],
    artifacts: [
      { kind: "screen-manifest-v2", value: { schema: "walnutpi.screen-manifest.v2" } },
      { kind: "screen-playlist-v1", value: { schema: "walnutpi.screen-playlist.v1" } },
      { kind: "screen-output", value: { width: 480, height: 320 } },
    ],
    sideEffects: [{ kind: "local-write" }],
  };
  assert.equal(evaluatePredicate(sample, { kind: "routeIs", value: "screen.wallpaper" }, cases[0]), true);
  assert.equal(evaluatePredicate(sample, { kind: "screenArtifactValid" }, cases[0]), true);
  assert.equal(evaluatePredicate(sample, { kind: "weatherLocationMatchesSlot" }, cases[0]), true);
  console.log("product benchmark runner self-check passed");
}
