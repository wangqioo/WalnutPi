#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, any>;
type CompareArgs = {
  selfCheck?: boolean;
  base?: string;
  next?: string;
};
type CaseSummary = JsonRecord & {
  id?: string;
  caseId?: string;
  variantId?: string;
  status?: string;
  verdict?: string;
  evaluation?: {
    evidence?: { missing?: any[]; missingResults?: any[] };
    safety?: { forbiddenTriggered?: any[] };
  };
};
type RunSummary = JsonRecord & {
  runId?: string;
  cases?: CaseSummary[];
};

if (import.meta.main) await main();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheck) {
    selfCheck();
    return;
  }

  if (!args.base || !args.next) {
    throw new Error("usage: bun scripts/compare-product-capability-runs.ts <base-summary.json> <new-summary.json>");
  }

  const base = await readJson(args.base);
  const next = await readJson(args.next);
  const report = compareRuns(base, next);
  console.log(JSON.stringify(report, null, 2));
  if (report.regressions.length) process.exitCode = 1;
}

export function compareRuns(base: RunSummary, next: RunSummary) {
  const baseCases = indexCases(base.cases || []);
  const nextCases = indexCases(next.cases || []);
  const regressions: JsonRecord[] = [];
  const improvements: JsonRecord[] = [];

  for (const [key, before] of baseCases) {
    const after = nextCases.get(key);
    if (!after) {
      regressions.push({ key, kind: "missing-case", before: caseLabel(before), after: null });
      continue;
    }
    compareCase({ key, before: normalizeCase(before), after: normalizeCase(after), regressions, improvements });
  }
  for (const [key, after] of nextCases) {
    if (!baseCases.has(key)) regressions.push({ key, kind: "unbaselined-case", before: null, after: caseLabel(after) });
  }
  return {
    schema: "walnutpi.productCapabilityRunCompare.v1",
    baseRunId: base.runId || null,
    newRunId: next.runId || null,
    comparedCases: baseCases.size,
    regressions,
    improvements,
    ok: regressions.length === 0,
  };
}

function compareCase({ key, before, after, regressions, improvements }: { key: string; before: JsonRecord; after: JsonRecord; regressions: JsonRecord[]; improvements: JsonRecord[] }) {
  compareRanked({ key, kind: "verdict", before: before.verdict, after: after.verdict, rank: verdictRank, regressions, improvements });
  compareSetGrowth({ key, kind: "missing-evidence", before: before.missingEvidence, after: after.missingEvidence, regressions, improvements });
  compareSetGrowth({ key, kind: "missing-results", before: before.missingResults, after: after.missingResults, regressions, improvements });
  compareSetGrowth({ key, kind: "forbidden-side-effects", before: before.forbiddenSideEffects, after: after.forbiddenSideEffects, regressions, improvements });
}

function compareRanked({ key, kind, before, after, rank, regressions, improvements }: { key: string; kind: string; before: string; after: string; rank: (value: string) => number; regressions: JsonRecord[]; improvements: JsonRecord[] }) {
  const beforeRank = rank(before);
  const afterRank = rank(after);
  if (afterRank < beforeRank) regressions.push({ key, kind, before, after });
  else if (afterRank > beforeRank) improvements.push({ key, kind, before, after });
}

function compareSetGrowth({ key, kind, before, after, regressions, improvements }: { key: string; kind: string; before: string[]; after: string[]; regressions: JsonRecord[]; improvements: JsonRecord[] }) {
  const added = after.filter((item) => !before.includes(item));
  const removed = before.filter((item) => !after.includes(item));
  if (added.length) regressions.push({ key, kind, added, before, after });
  if (removed.length) improvements.push({ key, kind, removed, before, after });
}

function compareNumberGrowth({ key, kind, before, after, regressions, improvements }) {
  if (after > before) regressions.push({ key, kind, before, after });
  else if (after < before) improvements.push({ key, kind, before, after });
}

function normalizeCase(entry: CaseSummary) {
  const evaluation = entry.evaluation || {};
  return {
    verdict: entry.verdict || statusVerdict(entry.status),
    missingEvidence: stringList(evaluation.evidence?.missing),
    missingResults: stringList(evaluation.evidence?.missingResults),
    forbiddenSideEffects: stringList(evaluation.safety?.forbiddenTriggered),
  };
}

function statusVerdict(status: any): string {
  if (status === "completed" || status === "pass") return "pass";
  if (status === "skipped") return "skipped";
  return "needs_review";
}

function verdictRank(verdict: string): number {
  return {
    fail: 0,
    needs_review: 1,
    skipped: 1,
    pass: 2,
  }[verdict] ?? 1;
}

function stringList(value: any): string[] {
  return Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item)).filter(Boolean))).sort();
}

function indexCases(cases: CaseSummary[]): Map<string, CaseSummary> {
  return new Map(cases.map((entry) => [caseKey(entry), entry]));
}

function caseKey(entry: CaseSummary): string {
  return `${entry.caseId || entry.id || "unknown"}::${entry.variantId || "default"}`;
}

function caseLabel(entry: CaseSummary) {
  return { caseId: entry.caseId || entry.id || null, variantId: entry.variantId || null };
}

async function readJson(file: string): Promise<RunSummary> {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}

function parseArgs(argv: string[]): CompareArgs {
  const parsed: CompareArgs = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-check") parsed.selfCheck = true;
    else if (arg === "--base") parsed.base = argv[++i];
    else if (arg === "--new" || arg === "--next") parsed.next = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`unknown argument ${arg}`);
    else positional.push(arg);
  }
  parsed.base ||= positional[0];
  parsed.next ||= positional[1];
  return parsed;
}

function selfCheck() {
  const base = {
    runId: "base",
    cases: [
      {
        caseId: "V1-01",
        variantId: "zh-main",
        verdict: "pass",
        evaluation: { evidence: { missing: [], missingResults: [] }, safety: { forbiddenTriggered: [] } },
        telemetry: { failures: 0 },
      },
    ],
  };
  const worse = {
    runId: "new",
    cases: [
      {
        caseId: "V1-01",
        variantId: "zh-main",
        verdict: "needs_review",
        evaluation: {
          evidence: { missing: ["intent-route"], missingResults: ["screen-playlist-v1"] },
          safety: { forbiddenTriggered: ["device-write"] },
        },
        telemetry: { failures: 1 },
      },
    ],
  };
  const report = compareRuns(base, worse);
  assert.equal(report.ok, false);
  assert.equal(report.regressions.length, 4);

  const unbaselined = compareRuns(base, {
    runId: "new",
    cases: [
      ...base.cases,
      {
        caseId: "V1-02",
        variantId: "zh-main",
        verdict: "pass",
        evaluation: { evidence: { missing: [], missingResults: [] }, safety: { forbiddenTriggered: [] } },
        telemetry: { failures: 0 },
      },
    ],
  });
  assert.equal(unbaselined.ok, false);
  assert.deepEqual(unbaselined.regressions, [{ key: "V1-02::zh-main", kind: "unbaselined-case", before: null, after: { caseId: "V1-02", variantId: "zh-main" } }]);

  const runTelemetryOnly = compareRuns(
    { runId: "base", telemetry: { failures: 0 }, cases: [] },
    { runId: "new", telemetry: { failures: 1 }, cases: [] },
  );
  assert.equal(runTelemetryOnly.ok, true);

  const better = {
    runId: "better",
    cases: [
      {
        caseId: "V1-01",
        variantId: "zh-main",
        verdict: "pass",
        evaluation: { evidence: { missing: [], missingResults: [] }, safety: { forbiddenTriggered: [] } },
        telemetry: { failures: 0 },
      },
    ],
  };
  assert.equal(compareRuns(base, better).ok, true);
  console.log("product capability run compare self-check passed");
}
