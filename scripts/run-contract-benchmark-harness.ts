#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const defaultCases = path.join(root, "docs", "benchmarks", "contracts", "product-manifest.json");
const defaultOutputRoot = path.join(root, "screen", "benchmark-runs");
const CONTRACT_CAPABILITY_AREAS = ["agent-runtime", "core-product", "experimental", "verification"] as const;

type JsonRecord = Record<string, any>;
type ContractArgs = {
  selfCheck?: boolean;
  file?: string;
  caseId?: string;
  runId?: string;
  outputDir?: string;
};
type BenchmarkCase = JsonRecord & {
  id?: string;
  title?: string;
  suite?: string;
  benchmarkCategory?: string;
  productLoop?: string;
  capabilityArea?: string;
  runnerStatus?: string;
  requirements?: JsonRecord;
  variants?: JsonRecord[];
  oracle?: JsonRecord;
};
type BenchmarkManifestFile = {
  category?: string;
  path?: string;
  caseCount?: number;
  caseIds?: string[];
};
type ContractSummary = {
  schema: string;
  runId: string;
  sourceFile: string;
  startedAt: string;
  finishedAt?: string;
  caseCount: number;
  variantCount: number;
  contracts: JsonRecord[];
  productLoops: JsonRecord;
  requirements: JsonRecord;
};

if (import.meta.main) await main();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheck) {
    await selfCheck();
    return;
  }

  const summary = await runContractHarness(args);
  console.log(JSON.stringify(summary, null, 2));
}

async function runContractHarness(args: ContractArgs = {}): Promise<ContractSummary> {
  const sourceFile = args.file || defaultCases;
  const allCases = await readContractCases(sourceFile);
  const cases = allCases.filter((entry) => !args.caseId || entry.id === args.caseId);
  if (!cases.length) throw new Error(`no contract benchmark cases matched${args.caseId ? ` ${args.caseId}` : ""}`);
  validateContractCases(cases);

  const runId = args.runId || `contract-benchmark-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const summary: ContractSummary = {
    schema: "walnutpi.contractBenchmarkRun.v1",
    runId,
    sourceFile: path.relative(root, path.resolve(sourceFile)).replaceAll("\\", "/"),
    startedAt: new Date().toISOString(),
    caseCount: cases.length,
    variantCount: cases.reduce((total, entry) => total + (entry.variants || []).length, 0),
    contracts: cases.map(contractCaseSummary),
    productLoops: summarizeProductLoops(cases),
    requirements: summarizeRequirements(cases),
  };
  summary.finishedAt = new Date().toISOString();

  const outDir = path.join(args.outputDir || defaultOutputRoot, runId);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "contract-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function readContractCases(file: string): Promise<BenchmarkCase[]> {
  const resolved = path.resolve(file);
  if (resolved.endsWith(".jsonl")) return readJsonl(resolved);
  if (!resolved.endsWith(".json")) throw new Error(`unsupported contract benchmark file ${file}; expected .jsonl or manifest .json`);
  const manifest = JSON.parse(await readFile(resolved, "utf8"));
  if (manifest?.schema !== "walnutpi.product-benchmark-manifest.v1") {
    throw new Error(`contract benchmark manifest ${path.relative(root, resolved)} has unsupported schema ${manifest?.schema || "missing"}`);
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error(`contract benchmark manifest ${path.relative(root, resolved)} must list files`);
  }
  const seen = new Set<string>();
  const cases: BenchmarkCase[] = [];
  for (const entry of manifest.files as BenchmarkManifestFile[]) {
    if (!entry?.path || typeof entry.path !== "string") throw new Error(`contract benchmark manifest ${path.relative(root, resolved)} file entry missing path`);
    if (path.isAbsolute(entry.path) || entry.path.includes("..")) throw new Error(`contract benchmark manifest path must stay in manifest directory: ${entry.path}`);
    const fileCases = await readJsonl(path.resolve(path.dirname(resolved), entry.path));
    if (entry.caseCount !== undefined && fileCases.length !== entry.caseCount) {
      throw new Error(`contract benchmark manifest expected ${entry.caseCount} case(s) in ${entry.path}, found ${fileCases.length}`);
    }
    const expectedIds = entry.caseIds || [];
    if (expectedIds.length && expectedIds.join(",") !== fileCases.map((benchmark) => benchmark.id || "").join(",")) {
      throw new Error(`contract benchmark manifest caseIds mismatch for ${entry.path}`);
    }
    for (const benchmark of fileCases) {
      const id = benchmark.id || "unknown";
      if (seen.has(id)) throw new Error(`duplicate contract benchmark case id ${id}`);
      seen.add(id);
      if (entry.category && benchmark.benchmarkCategory && benchmark.benchmarkCategory !== entry.category) {
        throw new Error(`contract benchmark ${id} category ${benchmark.benchmarkCategory} does not match manifest category ${entry.category}`);
      }
      cases.push(benchmark);
    }
  }
  return cases;
}

async function readJsonl(file: string): Promise<BenchmarkCase[]> {
  const text = await readFile(file, "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function validateContractCases(cases: BenchmarkCase[]) {
  const seen = new Set<string>();
  for (const benchmark of cases) {
    const caseId = benchmark.id || "unknown";
    if (!benchmark.id || typeof benchmark.id !== "string") throw new Error("contract benchmark missing id");
    if (seen.has(benchmark.id)) throw new Error(`duplicate contract benchmark id ${benchmark.id}`);
    seen.add(benchmark.id);
    if (benchmark.runnerStatus !== "contract-only") throw new Error(`contract benchmark ${caseId} must declare runnerStatus contract-only`);
    if (benchmark.benchmarkCategory !== "contract-only") throw new Error(`contract benchmark ${caseId} must declare benchmarkCategory contract-only`);
    for (const key of ["productLoop", "capabilityArea"] as const) {
      if (typeof benchmark[key] !== "string" || !benchmark[key].trim()) throw new Error(`contract benchmark ${caseId} missing ${key}`);
    }
    if (!(CONTRACT_CAPABILITY_AREAS as readonly string[]).includes(benchmark.capabilityArea!)) {
      throw new Error(`contract benchmark ${caseId} has unknown capabilityArea ${benchmark.capabilityArea}`);
    }
    validateRequirements(benchmark);
    validateOracle(benchmark);
    if (!Array.isArray(benchmark.variants) || !benchmark.variants.length) throw new Error(`contract benchmark ${caseId} must declare variants`);
    for (const variant of benchmark.variants) {
      if (!variant?.id || typeof variant.id !== "string") throw new Error(`contract benchmark ${caseId} has variant without id`);
      if (typeof variant.input !== "string" || !variant.input.trim()) throw new Error(`contract benchmark ${caseId}/${variant.id} missing input`);
    }
  }
}

function validateRequirements(benchmark: BenchmarkCase) {
  const requirements = benchmark.requirements;
  const caseId = benchmark.id || "unknown";
  if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) throw new Error(`contract benchmark ${caseId} missing requirements`);
  const expectedKeys = ["device", "network", "model", "search"];
  for (const key of expectedKeys) {
    if (typeof requirements[key] !== "boolean") throw new Error(`contract benchmark ${caseId} requirements.${key} must be boolean`);
  }
  const unknown = Object.keys(requirements).filter((key) => !expectedKeys.includes(key));
  if (unknown.length) throw new Error(`contract benchmark ${caseId} requirements has unknown field(s): ${unknown.join(", ")}`);
}

function validateOracle(benchmark: BenchmarkCase) {
  const oracle = benchmark.oracle;
  const caseId = benchmark.id || "unknown";
  if (!oracle || typeof oracle !== "object" || Array.isArray(oracle)) throw new Error(`contract benchmark ${caseId} missing oracle`);
  for (const key of ["goal", "evidence", "safety"]) {
    if (!oracle[key] || typeof oracle[key] !== "object" || Array.isArray(oracle[key])) throw new Error(`contract benchmark ${caseId} oracle.${key} must be an object`);
  }
  if (!Array.isArray(oracle.goal.resultSignals)) throw new Error(`contract benchmark ${caseId} oracle.goal.resultSignals must be an array`);
  if (!Array.isArray(oracle.evidence.required)) throw new Error(`contract benchmark ${caseId} oracle.evidence.required must be an array`);
  if (!Array.isArray(oracle.safety.forbiddenSideEffects)) throw new Error(`contract benchmark ${caseId} oracle.safety.forbiddenSideEffects must be an array`);
}

function contractCaseSummary(benchmark: BenchmarkCase) {
  return {
    caseId: benchmark.id,
    title: benchmark.title || null,
    suite: benchmark.suite || null,
    productLoop: benchmark.productLoop,
    capabilityArea: benchmark.capabilityArea,
    runnerStatus: benchmark.runnerStatus,
    requirements: benchmark.requirements,
    variantIds: (benchmark.variants || []).map((variant) => variant.id || "default"),
    expectedEvidence: benchmark.oracle?.evidence?.required || [],
    resultSignals: benchmark.oracle?.goal?.resultSignals || [],
    forbiddenSideEffects: benchmark.oracle?.safety?.forbiddenSideEffects || [],
  };
}

function summarizeProductLoops(cases: BenchmarkCase[]) {
  const summary: JsonRecord = {};
  for (const benchmark of cases) {
    const loop = benchmark.productLoop || "unknown";
    summary[loop] = (summary[loop] || 0) + 1;
  }
  return summary;
}

function summarizeRequirements(cases: BenchmarkCase[]) {
  const summary = { device: 0, network: 0, model: 0, search: 0 };
  for (const benchmark of cases) {
    for (const key of Object.keys(summary) as Array<keyof typeof summary>) {
      if (benchmark.requirements?.[key]) summary[key] += 1;
    }
  }
  return summary;
}

function parseArgs(argv: string[]): ContractArgs {
  const parsed: ContractArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-check") parsed.selfCheck = true;
    else if (arg === "--file") parsed.file = path.resolve(argv[++i]);
    else if (arg === "--case-id") parsed.caseId = argv[++i];
    else if (arg === "--run-id") parsed.runId = safeId(argv[++i]);
    else if (arg === "--output-dir") parsed.outputDir = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${arg}`);
  }
  return parsed;
}

function safeId(value: any): string {
  return String(value || "run").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "run";
}

async function selfCheck() {
  const summary = await runContractHarness({
    file: defaultCases,
    runId: "contract-self-check",
    outputDir: path.join(root, "screen", ".contract-benchmark-self-check"),
  });
  if (summary.schema !== "walnutpi.contractBenchmarkRun.v1") throw new Error("contract summary schema mismatch");
  if (summary.caseCount !== 6 || summary.variantCount !== 12) throw new Error("contract product manifest count mismatch");
  if (summary.contracts.some((entry) => entry.runnerStatus !== "contract-only")) throw new Error("contract runner included non-contract cases");

  console.log("contract benchmark harness self-check passed");
}
