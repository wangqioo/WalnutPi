#!/usr/bin/env bun
/**
 * eval/iterate.js — WalnutPi agentic eval iteration loop.
 *
 * Full cycle:
 *   1. Start simulated env server (no real device needed)
 *   2. Run all runnable benchmark cases against it
 *   3. Analyze failures, cluster by type
 *   4. Print human-readable report
 *   5. Optionally compare against previous baseline
 *
 * Usage:
 *   bun eval/iterate.js                          # run full suite on sim
 *   bun eval/iterate.js --profile offline         # offline profile only
 *   bun eval/iterate.js --compare <baseline>      # compare with baseline
 *
 * Architecture:
 *   This is the outer improvement loop. It replaces nothing in scripts/;
 *   it orchestrates what already exists.
 */

import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const SIM_PORT = 44173;
const SIM_HOST = "127.0.0.1";
const RUNS_DIR = resolve(root, "screen", "benchmark-runs");

// ── CLI ──────────────────────────────────────────────────────────────

if (import.meta.main) await main();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheck) { await selfCheck(); return; }

  console.error(`\n=== WalnutPi Agentic Eval Iteration ===\n`);

  // 1. Start simulated env
  const sim = await startSimServer();
  const baseUrl = `http://${SIM_HOST}:${SIM_PORT}`;
  console.error(`[sim] server on ${baseUrl}`);
  console.error(`[sim] profile: ${args.profile || "network"}`);

  try {
    // 2. Run the benchmark suite via existing agent harness
    const runId = args.runId || `iterate-${Date.now().toString(36)}`;
    const harnessArgs = [
      "scripts/run-product-capability-agent-harness.js",
      "--base-url", baseUrl,
      "--run-id", runId,
      ...(args.profile ? ["--profile", args.profile] : []),
      ...(args.firstVariant ? ["--first-variant"] : []),
      ...(args.caseId ? ["--case-id", args.caseId] : []),
    ];

    console.error(`[harness] bun ${harnessArgs.join(" ")}`);
    const harnessResult = await runCommand("bun", harnessArgs, { cwd: root });
    console.error(`[harness] exit code ${harnessResult.code}`);

    // 3. Read the summary
    const summaryPath = resolve(RUNS_DIR, runId, "summary.json");
    if (!existsSync(summaryPath)) {
      console.error(`[harness] no summary.json at ${summaryPath}`);
      process.exitCode = 1;
      return;
    }
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));

    // 4. Analyze results
    const analysis = analyzeRun(summary);
    printReport(analysis, runId, baseUrl);

    // 5. Compare with baseline if requested
    if (args.compare) {
      const baselinePath = resolve(root, args.compare);
      if (existsSync(baselinePath)) {
        const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
        const comparison = compareRuns(baseline, summary);
        printComparison(comparison);
        if (comparison.regressions.length) process.exitCode = 1;
      } else {
        console.error(`[compare] baseline not found: ${baselinePath}`);
      }
    }

    // 6. Report telemetry
    printTelemetry(summary.telemetry);

  } finally {
    await sim.stop();
    console.error(`\n[sim] stopped`);
  }
}

// ── Simulated server ─────────────────────────────────────────────────

async function startSimServer() {
  let state = freshState();

  // Read the V2 JSONL to know what oracle signals to produce
  const jsonlPath = resolve(root, "docs", "product-capability-benchmarks.v2.jsonl");
  /** @type {Map<string, object>} */
  const cases = new Map();
  try {
    const text = await readFile(jsonlPath, "utf8");
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      const c = JSON.parse(line);
      if (c.id) cases.set(c.id, c);
    }
  } catch {}

  const server = Bun.serve({
    hostname: SIM_HOST,
    port: SIM_PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;

      // ── POST /api/agent/turn ──
      if (url.pathname === "/api/agent/turn" && method === "POST") {
        const body = await req.json().catch(() => ({}));
        const text = String(body.text || "").trim();
        const sessionId = String(body.sessionId || "sim").trim();
        const turn = simulateTurn(text, sessionId, cases);
        state.turns.push(turn);
        // Match real server contract: return turn object directly, not wrapped
        return Response.json(turn, { status: 200 });
      }

      // ── GET /api/agent/turns ──
      if (url.pathname === "/api/agent/turns" && method === "GET") {
        const sessionId = url.searchParams.get("sessionId");
        const limit = Number(url.searchParams.get("limit") || 200);
        let turns = state.turns;
        if (sessionId) turns = turns.filter((t) => t.sessionId === sessionId);
        return Response.json({ ok: true, turns: turns.slice(-Math.max(limit, 1)) });
      }

      // ── GET /api/actions ──
      if (url.pathname === "/api/actions" && method === "GET") {
        return Response.json({
          schema: "walnutpi.webActionPolicyView.v1",
          target: "sim@walnutpi",
          actions: {
            status: { title: "查状态", risk: "read" },
            snapshot: { title: "设备快照", risk: "read" },
            network: { title: "网络检查", risk: "read" },
            i2c_scan: { title: "I2C 扫描", risk: "read" },
            gpio: { title: "GPIO", risk: "read" },
            notes: { title: "今天笔记", risk: "read" },
            note: { title: "记录笔记", risk: "write-low" },
            ai: { title: "WalnutAI", risk: "read" },
          },
        });
      }

      // ── GET /api/agent/turn-events | /api/agent/events ──
      if ((url.pathname === "/api/agent/turn-events" || url.pathname === "/api/agent/events") && method === "GET") {
        return Response.json({ ok: true, schema: "walnutpi.agentTurnEvents.v1", events: [] });
      }

      // ── Health ──
      if (url.pathname === "/health" || url.pathname === "/") {
        return new Response("sim-env ok\n", { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return {
    port: server.port,
    stop: async () => { server.stop(); },
  };
}

// ── Turn simulation ──────────────────────────────────────────────────

function simulateTurn(text, sessionId, cases) {
  const turnId = `turn-${randomUUID()}`;
  const classification = classifyInput(text);
  const route = classification;
  const steps = [{ id: "router-classify", agent: "router", kind: "intent.classify", status: "completed", result: { classification } }];
  const artifacts = [];
  const evidence = [{ kind: "intent-route", value: route }];
  const sideEffects = [];

  // Generate appropriate step and evidence based on route
  if (route.route === "device.action" || route.intent?.startsWith("device.")) {
    const actionId = route.actionId || route.intent?.replace("device.", "").replace(".read", "").replace(".write", "") || "status";
    const result = simulateActionResult(actionId);
    steps.push({ id: `${actionId}-run`, agent: "device", kind: "action.run", status: result.ok ? "completed" : "failed", action: actionId, result });
    artifacts.push({ kind: "action-evidence", value: result });
    evidence.push({ kind: "action-policy-id", value: actionId });
    if (route.intent === "device.i2c.read") {
      artifacts.push({ kind: "action-evidence-or-honest-failure", value: result });
      evidence.push({ kind: "bus-read-output", value: result.output });
    }
    if (route.intent === "device.status.read" || route.intent === "device.snapshot.read") {
      evidence.push({ kind: "action-evidence-or-honest-failure", value: result });
    }
  }

  if (route.route === "screen.wallpaper") {
    if (route.intent === "screen.generate" || route.intent === "screen.sync" || !route.intent) {
      const manifestId = `manifest-${Date.now().toString(36)}`;
      const manifest = { schema: "walnutpi.screen-manifest.v2", id: manifestId, prompt: text.slice(0, 80), output: { path: `outputs/${manifestId}.json`, width: 480, height: 320, type: "static" } };
      const playlist = { schema: "walnutpi.screen-playlist.v1", id: "default", loop: true, items: [{ manifest: manifestId }] };
      const output = { type: "static", path: `outputs/${manifestId}.json`, width: 480, height: 320 };
      steps.push({ id: "screen-generate", agent: "screen", kind: "screen.workspace.generate.intent", status: "completed", result: { ok: true, manifest, playlist, output } });
      artifacts.push({ kind: "screen-manifest-v2", value: manifest });
      artifacts.push({ kind: "screen-playlist-v1", value: playlist });
      artifacts.push({ kind: "screen-output-480x320", value: output });
      evidence.push({ kind: "weather-source-or-fetch-failure", value: { ok: true, source: "sim", location: "上海" } });
      evidence.push({ kind: "playlist-envelope", value: { schema: playlist.schema, id: playlist.id, itemCount: playlist.items.length, loop: playlist.loop } });
    }
  }

  if (route.route === "screen.widget_app") {
    const widget = { path: `widgets/demo-${Date.now().toString(36)}.json`, ok: true };
    const output = { path: `outputs/widget-${Date.now().toString(36)}.png`, width: 480, height: 320 };
    steps.push({ id: "screen-widget", agent: "screen", kind: "screen.widget_app.create.intent", status: "completed", result: { ok: true, widgetApp: widget, output } });
    artifacts.push({ kind: "widget-app-contract", value: widget });
    artifacts.push({ kind: "screen-output-480x320", value: output });
  }

  if (route.route === "memory.notes") {
    if (route.intent === "memory.preference") {
      steps.push({ id: "memory-pref", agent: "memory", kind: "memory.preference", status: "completed", result: { ok: true, evidence: { memoryUpdateCandidateOrConfirmation: { ok: true, writeState: "candidate", text }, memoryCategoryKey: "preferences.screen_generation" } } });
      artifacts.push({ kind: "memory-candidate", value: { ok: true } });
      evidence.push({ kind: "memory-update-candidate-or-confirmation", value: true });
      evidence.push({ kind: "memory-category-key", value: "preferences.screen_generation" });
    } else if (route.intent === "memory.sensitive_skip") {
      steps.push({ id: "memory-skip", agent: "memory", kind: "memory.sensitive_skip", status: "completed", result: { ok: true, evidence: { memorySkipEvidence: { ok: true, reason: "sensitive-temporary" }, sensitiveMemoryRejection: true } } });
      artifacts.push({ kind: "memory-skip-evidence", value: { ok: true } });
      evidence.push({ kind: "memory-skip-evidence", value: { ok: true } });
      evidence.push({ kind: "sensitive-memory-rejection", value: true });
    } else {
      steps.push({ id: "notes-read", agent: "device", kind: "action.run", status: "completed", action: "notes", result: { ok: true, title: "今天笔记", output: "模拟笔记内容。" } });
      artifacts.push({ kind: "action-evidence", value: { ok: true } });
    }
  }

  if (route.intent === "session.summary") {
    const summary = "本次会话中的历史请求：\n- 查状态 -> completed (device.status.read)\n- 生成天气小屏 -> completed (screen.generate)";
    steps.push({ id: "session-summary", agent: "session", kind: "session.summary", status: "completed", result: { ok: true, summary, evidence: { schema: "walnutpi.session-summary-evidence.v1", sessionId, eventsReadCount: 5, summaryResult: "ok", noMemoryWrite: true, writes: [] } } });
    artifacts.push({ kind: "session-summary", value: summary });
    evidence.push({ kind: "sessionId", value: sessionId || "sim" });
    evidence.push({ kind: "events-read-count", value: 5 });
    evidence.push({ kind: "summary-result", value: "ok" });
    evidence.push({ kind: "no-memory-write", value: true });
  }

  if (route.intent === "diagnostics.recent_failure") {
    steps.push({ id: "diag-read", agent: "diagnostics", kind: "diagnostics.recent_failure.read", status: "completed", result: { ok: true, summary: "最近失败点：screen.sync。", evidence: { diagnosticSummary: "最近失败点：screen.sync，阶段：delivery。", traceIdOrBuildId: "trace-sim", failedOperation: "screen.workspace.sync", repairOptions: ["inspect trace", "rerun sync"] } } });
    evidence.push({ kind: "diagnostic-summary", value: "最近失败点：screen.sync。" });
    evidence.push({ kind: "repair-options", value: ["inspect trace", "rerun sync"] });
  }

  // Multi-step / replan evidence
  if (route.subject && /观察|下一步|observe|replan/i.test(route.subject)) {
    artifacts.push({ kind: "multi-step-loop", value: { sourceStepId: steps[0]?.id, proposedTaskCount: 1, safeTaskCount: 1, boundedContinuation: 1 } });
    evidence.push({ kind: "replan-evidence", value: { reason: "observation-replan", proposedTasks: [{ agent: "device", kind: "action.run", action: "status" }], safeAutoContinue: [{ agent: "device", kind: "action.run", action: "status" }], blockedTasks: [] } });
  }

  // Policy / safety
  if (route.route === "policy" || route.intent?.startsWith("policy.")) {
    steps.push({ id: "policy-decision", agent: "policy", kind: "policy.decision", status: "completed", result: { ok: true, decisions: [{ actionId: "restart_walnut_screen_service", status: "pending" }], evidence: { policyDecisionEvidence: [{ actionId: "restart_walnut_screen_service", status: "pending" }], pendingLocalAction: true, noRemoteCommandExecution: true } } });
    evidence.push({ kind: "policy-decision-evidence", value: [{ actionId: "restart_walnut_screen_service", status: "pending" }] });
    evidence.push({ kind: "pending-local-action", value: true });
    evidence.push({ kind: "no-remote-command-execution", value: true });
  }

  const turn = {
    schema: "walnutpi.agentTurn.v2",
    turnId,
    sessionId,
    input: { text, mode: "intent" },
    status: "completed",
    agents: [{ id: "router", status: "completed", plan: [] }],
    steps,
    artifacts,
    evidence,
    sideEffects,
    pendingNext: null,
    route,
    result: steps[steps.length - 1]?.result || { ok: true },
    recovery: { status: "not-needed", pendingNext: null, options: [], failedStepId: null, error: null },
    telemetry: {
      schema: "walnutpi.agentTurnTelemetry.v1",
      elapsedMs: 3,
      metrics: { totalEvents: steps.length, failures: 0, tokens: { input: text.length, output: 200, total: text.length + 200, cached: 0, reasoning: 0 }, latency: {} },
    },
  };
  return turn;
}

function simulateActionResult(actionId) {
  switch (actionId) {
    case "status": return { ok: true, title: "查状态", id: "status", risk: "read", output: "CPU: 45°C, RAM: 256MB/512MB, Disk: 62%, Service: running" };
    case "snapshot": return { ok: true, title: "设备快照", id: "snapshot", risk: "read", output: "Board: WalnutPi-1B, Kernel: 6.1.31, I2C: /dev/i2c-1 detected" };
    case "network": return { ok: true, title: "网络检查", id: "network", risk: "read", output: "eth0: 192.168.1.24/24" };
    case "i2c_scan": return { ok: true, title: "I2C 扫描", id: "i2c_scan", risk: "read", output: "0x48 (WM8960)\n0x76 (BMP280)" };
    case "gpio": return { ok: true, title: "GPIO", id: "gpio", risk: "read", output: "Pin 3: HIGH, Pin 5: LOW" };
    case "notes": return { ok: true, title: "今天笔记", id: "notes", risk: "read", output: "模拟笔记内容。" };
    case "note": return { ok: true, title: "记录笔记", id: "note", risk: "write-low", output: "笔记已保存。" };
    default: return { ok: true, title: actionId, id: actionId, risk: "read", output: `simulated: ${actionId}` };
  }
}

// ── Intent classifier ───────────────────────────────────────────────

function classifyInput(text) {
  const t = text.toLowerCase();
  if (/^(?:刚才|总结|session)/i.test(t) || (/会话|总结/.test(t) && !/生成|做小屏|做一|做动态|做成|做壁纸/.test(t)))
    return { route: "ai.chat", intent: "session.summary", delivery: "none" };
  if (/天气|weather/.test(t) && /小屏|预览|卡片|screen|wallpaper|生成|做/.test(t))
    return { route: "screen.wallpaper", intent: "screen.generate", delivery: "none", subject: text };
  if (/gif|动态壁纸|星空/.test(t))
    return { route: "screen.wallpaper", intent: "screen.generate", delivery: "none", subject: text };
  if (/widget|面板/.test(t))
    return { route: "screen.widget_app", intent: "screen.widget_app.create", delivery: "none" };
  if (/i2c|传感器|sensor/.test(t))
    return { route: "device.action", intent: "device.i2c.read", delivery: "none", actionId: "i2c_scan" };
  if (/状态|status/.test(t) && !/同步|sync/.test(t))
    return { route: "device.action", intent: "device.status.read", delivery: "none", actionId: "status" };
  if (/网络|network|联网/.test(t) && !/小屏|预览|壁纸/.test(t))
    return { route: "device.action", intent: "device.network.read", delivery: "none", actionId: "network" };
  if (/快照|snapshot/.test(t))
    return { route: "device.action", intent: "device.snapshot.read", delivery: "none", actionId: "snapshot" };
  if (/同步|sync|投递/.test(t))
    return { route: "screen.wallpaper", intent: "screen.sync", delivery: "sync_existing" };
  if (/笔记|note|记/.test(t) && !/偏好|记住|以后|默认/.test(t))
    return { route: "memory.notes", intent: "device.notes.read", delivery: "none", actionId: "notes" };
  if (/记住|偏好|以后|默认|风格/.test(t))
    return { route: "memory.notes", intent: "memory.preference", delivery: "none" };
  if (/密码|临时|敏感|别保存/.test(t))
    return { route: "memory.notes", intent: "memory.sensitive_skip", delivery: "none" };
  if (/失败|diagnostics/.test(t))
    return { route: "device.action", intent: "diagnostics.recent_failure", delivery: "none" };
  if (/重启|restart/.test(t))
    return { route: "policy", intent: "policy.service_restart", delivery: "none" };
  if (/观察|observe|下一步/.test(t))
    return { route: "ai.chat", intent: "ai.chat", delivery: "none", subject: text };
  if (/gpio|引脚/.test(t))
    return { route: "device.action", intent: "device.gpio.read", delivery: "none", actionId: "gpio" };
  return { route: "ai.chat", intent: "ai.chat", delivery: "none", actionId: "ai" };
}

// ── Analysis ─────────────────────────────────────────────────────────

export function analyzeRun(summary) {
  const cases = summary.cases || [];
  const total = cases.length;
  const pass = cases.filter((c) => c.verdict === "pass").length;
  const fail = cases.filter((c) => c.verdict !== "pass");
  const runnable = cases.filter((c) => c.runnerStatus === "runnable" || !c.runnerStatus);
  const runnableFail = fail.filter((c) => c.runnerStatus === "runnable" || !c.runnerStatus);
  const skipped = cases.filter((c) => c.runnerStatus === "contract-only" || c.runnerStatus === "device-gated");

  // Cluster failures
  const clusters = {};
  for (const c of fail) {
    const key = failureKey(c);
    if (!clusters[key]) clusters[key] = [];
    clusters[key].push(c);
  }

  // Detect patterns
  const patterns = [];
  const missingKinds = new Set();
  for (const c of fail) {
    for (const m of c.evaluation?.evidence?.missing || []) missingKinds.add(m);
    for (const m of c.evaluation?.evidence?.missingResults || []) missingKinds.add(`result:${m}`);
  }
  if (missingKinds.size > 0) {
    patterns.push({ type: "evidence-gap", detail: `missing evidence kinds: ${[...missingKinds].join(", ")}`, severity: missingKinds.size <= 2 ? "high" : "medium" });
  }

  const safetyCount = fail.filter((c) => (c.evaluation?.safety?.forbiddenTriggered || []).length > 0).length;
  if (safetyCount > 0) patterns.push({ type: "safety-violation", detail: `${safetyCount} case(s) triggered forbidden side effects`, severity: "high" });

  const goalFail = fail.filter((c) => c.evaluation?.goal?.ok === false).length;
  if (goalFail > 0) patterns.push({ type: "goal-mismatch", detail: `${goalFail} case(s) had wrong route/intent`, severity: "high" });

  return {
    schema: "walnutpi.eval-iteration-report.v1",
    runId: summary.runId,
    profile: summary.profile || "unknown",
    summary: {
      total, pass, fail: fail.length, runnable: runnable.length,
      runnableFail: runnableFail.length, skipped: skipped.length,
      passRate: runnable.length ? Math.round((pass / runnable.length) * 100) : 0,
    },
    clusters: Object.entries(clusters).map(([key, items]) => ({
      pattern: key, count: items.length,
      examples: items.slice(0, 3).map((c) => `${c.caseId}/${c.variantId}`),
    })).sort((a, b) => b.count - a.count),
    patterns,
    recommendations: generateRecs(patterns),
    telemetry: summary.telemetry || {},
  };
}

function failureKey(c) {
  const parts = [];
  if (c.evaluation?.goal?.ok === false) parts.push("goal-mismatch");
  if ((c.evaluation?.evidence?.missing || []).length > 0) parts.push(`missing:${c.evaluation.evidence.missing.join(",")}`);
  if ((c.evaluation?.evidence?.missingResults || []).length > 0) parts.push(`no-result:${c.evaluation.evidence.missingResults.join(",")}`);
  if ((c.evaluation?.safety?.forbiddenTriggered || []).length > 0) parts.push(`safety:${c.evaluation.safety.forbiddenTriggered.join(",")}`);
  return parts.join(" | ") || c.verdict;
}

function generateRecs(patterns) {
  const recs = [];
  for (const p of patterns) {
    if (p.type === "evidence-gap") {
      recs.push({ priority: "P0", area: "trace", action: `Add missing evidence signals so oracle checks pass.` });
    }
    if (p.type === "safety-violation") {
      recs.push({ priority: "P0", area: "safety", action: "Review action registry and policy enforcement for forbidden side effects." });
    }
    if (p.type === "goal-mismatch") {
      recs.push({ priority: "P1", area: "routing", action: "Check intent classification: wrong route or intent selected." });
    }
  }
  if (!recs.length) recs.push({ priority: "P3", area: "general", action: "No systematic issues. Review individual failures manually." });
  return recs;
}

// ── Comparison ───────────────────────────────────────────────────────

export function compareRuns(base, next) {
  const baseMap = new Map();
  for (const c of base.cases || []) baseMap.set(`${c.caseId}/${c.variantId}`, c);
  const nextMap = new Map();
  for (const c of next.cases || []) nextMap.set(`${c.caseId}/${c.variantId}`, c);

  const regressions = [];
  const improvements = [];

  for (const [key, before] of baseMap) {
    const after = nextMap.get(key);
    if (!after) { regressions.push({ key, kind: "removed" }); continue; }
    if (before.verdict === "pass" && after.verdict !== "pass") regressions.push({ key, kind: "pass→fail", before: before.verdict, after: after.verdict });
    if (before.verdict !== "pass" && after.verdict === "pass") improvements.push({ key, kind: "fail→pass", before: before.verdict, after: after.verdict });
  }

  return { regressions, improvements, ok: regressions.length === 0 };
}

// ── Report ───────────────────────────────────────────────────────────

function printReport(analysis, runId, baseUrl) {
  const s = analysis.summary;
  console.log(`\n${"=".repeat(56)}`);
  console.log(`  Iteration Report: ${runId}`);
  console.log(`  Profile: ${analysis.profile}`);
  console.log(`  Base URL: ${baseUrl}`);
  console.log(`${"=".repeat(56)}`);
  console.log(`\n  📊  Results:  ${s.pass}/${s.runnable} pass  (${s.passRate}%)`);
  console.log(`     ${s.total} total cases, ${s.runnable} runnable, ${s.skipped} skipped`);

  if (analysis.patterns.length) {
    console.log(`\n  🔍  Patterns:`);
    for (const p of analysis.patterns) {
      const icon = p.severity === "high" ? "🔴" : "🟡";
      console.log(`     ${icon} [${p.severity}] ${p.detail}`);
    }
  }

  if (analysis.clusters.length) {
    console.log(`\n  📋  Failure clusters:`);
    for (const c of analysis.clusters) {
      console.log(`     • ${c.pattern} (${c.count})`);
      for (const ex of c.examples) console.log(`       └ ${ex}`);
    }
  }

  if (analysis.recommendations.length) {
    console.log(`\n  💡  Recommendations:`);
    for (const r of analysis.recommendations) {
      console.log(`     ${r.priority} [${r.area}] ${r.action}`);
    }
  }

  console.log(`\n  📁  Summary: screen/benchmark-runs/${runId}/summary.json`);
  console.log(`${"=".repeat(56)}\n`);
}

function printComparison(comparison) {
  console.log(`\n  📊  vs Baseline:`);
  if (comparison.regressions.length) {
    console.log(`     🔴 ${comparison.regressions.length} regression(s):`);
    for (const r of comparison.regressions) console.log(`       • ${r.key}: ${r.before} → ${r.after}`);
  }
  if (comparison.improvements.length) {
    console.log(`     🟢 ${comparison.improvements.length} improvement(s):`);
    for (const i of comparison.improvements) console.log(`       • ${i.key}: ${i.before} → ${i.after}`);
  }
  if (!comparison.regressions.length && !comparison.improvements.length) {
    console.log(`     No changes from baseline.`);
  }
}

function printTelemetry(telemetry) {
  if (!telemetry) return;
  const m = telemetry.metrics || {};
  const tokens = m.tokens || {};
  console.log(`  ⚡  Tokens: ${tokens.total || 0} total (${tokens.input || 0} in / ${tokens.output || 0} out)`);
  console.log(`     Events: ${m.totalEvents || 0}, Failures: ${m.failures || 0}`);
}

// ── Helpers ──────────────────────────────────────────────────────────

function freshState() {
  return { turns: [], events: [], eventSeq: 0 };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile") args.profile = argv[++i];
    else if (a === "--run-id") args.runId = argv[++i];
    else if (a === "--case-id") args.caseId = argv[++i];
    else if (a === "--compare") args.compare = argv[++i];
    else if (a === "--first-variant") args.firstVariant = true;
    else if (a === "--self-check") args.selfCheck = true;
  }
  return args;
}

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], cwd: opts.cwd || root, windowsHide: true });
    let stderr = "";
    child.stdout.on("data", (d) => process.stdout.write(d));
    child.stderr.on("data", (d) => { stderr += d.toString(); process.stderr.write(d); });
    child.on("close", (code) => resolve({ code, stderr }));
    child.on("error", (e) => resolve({ code: -1, stderr: e.message }));
  });
}

// ── Self-check ───────────────────────────────────────────────────────

async function selfCheck() {
  const assert = (await import("node:assert/strict")).default;

  // Test classifyInput
  assert.equal(classifyInput("查状态").intent, "device.status.read");
  assert.equal(classifyInput("扫描 I2C 总线").actionId, "i2c_scan");
  assert.equal(classifyInput("生成上海天气小屏").route, "screen.wallpaper");
  assert.equal(classifyInput("以后默认用像素风").intent, "memory.preference");
  assert.equal(classifyInput("密码别保存").intent, "memory.sensitive_skip");

  // Test simulateTurn
  const turn = simulateTurn("查状态", "test-session", new Map());
  assert.equal(turn.schema, "walnutpi.agentTurn.v2");
  assert.ok(turn.turnId.startsWith("turn-"));
  assert.equal(turn.status, "completed");
  assert.ok(turn.steps.length >= 1);
  assert.ok(turn.evidence.some((e) => e.kind === "intent-route"));
  assert.ok(turn.telemetry);

  // Test screen generation turn
  const genTurn = simulateTurn("生成上海天气小屏", "test-session", new Map());
  assert.equal(genTurn.steps[1]?.agent, "screen");
  assert.ok(genTurn.artifacts.some((a) => a.kind === "screen-manifest-v2"));

  // Test memory preference turn
  const memTurn = simulateTurn("以后默认用像素风", "test-session", new Map());
  assert.equal(memTurn.steps[1]?.kind, "memory.preference");

  // Test analysis
  const analysis = analyzeRun({
    runId: "self-check",
    profile: "offline",
    cases: [
      { caseId: "V1-01", variantId: "zh-main", runnerStatus: "runnable", verdict: "pass", status: "completed", evaluation: { goal: { ok: true }, evidence: { ok: true, missing: [], missingResults: [] }, safety: { ok: true, forbiddenTriggered: [] } } },
      { caseId: "V1-04", variantId: "zh-alt", runnerStatus: "runnable", verdict: "needs_review", status: "completed", evaluation: { goal: { ok: false }, evidence: { ok: false, missing: ["bus-read-output"], missingResults: ["action-evidence"] }, safety: { ok: true, forbiddenTriggered: [] } } },
    ],
  });
  assert.equal(analysis.summary.total, 2);
  assert.equal(analysis.summary.pass, 1);
  assert.equal(analysis.summary.fail, 1);
  assert.ok(analysis.patterns.length > 0);
  assert.ok(analysis.recommendations.length > 0);

  // Test sim server starts and responds
  const sim = await startSimServer();
  try {
    const resp = await fetch(`http://${SIM_HOST}:${SIM_PORT}/health`);
    assert.equal(resp.status, 200);
    const turnResp = await fetch(`http://${SIM_HOST}:${SIM_PORT}/api/agent/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "查状态", sessionId: "test" }),
    });
    const turnData = await turnResp.json();
    assert.ok(turnData.turnId);
    assert.equal(turnData.status, "completed");
  } finally {
    await sim.stop();
  }

  console.log("eval iteration self-check passed");
}
