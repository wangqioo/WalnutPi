#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const defaultProfile: GateProfile = "offline";
const defaultOutputRoot = path.join(root, "screen", "benchmark-runs");

type GateProfile = "offline" | "network" | "device";
type GateArgs = {
  profile: GateProfile;
  selfCheck?: boolean;
  baseline?: string;
  runId?: string;
  outputDir?: string;
  file?: string;
  baseUrl?: string;
};

if (import.meta.main) await main();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheck) {
    await selfCheck();
    return;
  }

  const baseline = resolveBaseline(args);
  await assertBaselineExists(baseline, args.profile);

  const runId = args.runId || `product-gate-${args.profile}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const outputDir = args.outputDir || defaultOutputRoot;
  await runCommand("bun", [
    "scripts/run-product-capability-agent-harness.ts",
    "--profile",
    args.profile,
    "--run-id",
    runId,
    "--output-dir",
    outputDir,
    ...optionalArg("--file", args.file),
    ...optionalArg("--base-url", args.baseUrl),
  ]);

  const summary = path.join(outputDir, runId, "summary.json");
  await runCommand("bun", [
    "scripts/compare-product-capability-runs.ts",
    "--base",
    baseline,
    "--new",
    summary,
  ]);
}

export function defaultBaselineForProfile(profile: GateProfile = defaultProfile) {
  return path.join(root, "screen", "benchmark-baselines", profile, "summary.json");
}

export function resolveBaseline(args: Partial<GateArgs> = {}) {
  return path.resolve(args.baseline || defaultBaselineForProfile(args.profile || defaultProfile));
}

async function assertBaselineExists(baseline: string, profile: GateProfile) {
  try {
    await access(baseline);
  } catch {
    throw new Error([
      `product capability gate baseline not found: ${baseline}`,
      "",
      `Create or refresh it by running the offline harness and copying a reviewed summary:`,
      `  bun scripts/run-product-capability-agent-harness.ts --profile ${profile} --run-id baseline-${profile}`,
      `  New-Item -ItemType Directory -Force screen/benchmark-baselines/${profile}`,
      `  Copy-Item screen/benchmark-runs/baseline-${profile}/summary.json screen/benchmark-baselines/${profile}/summary.json`,
      "",
      `Use --baseline <summary.json> to compare against a different approved baseline.`,
    ].join("\n"));
  }
}

function parseArgs(argv: string[]): GateArgs {
  const parsed: GateArgs = { profile: defaultProfile };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-check") parsed.selfCheck = true;
    else if (arg === "--baseline") parsed.baseline = argv[++i];
    else if (arg === "--profile") parsed.profile = parseProfile(argv[++i]);
    else if (arg === "--run-id") parsed.runId = safeId(argv[++i]);
    else if (arg === "--output-dir") parsed.outputDir = path.resolve(argv[++i]);
    else if (arg === "--file") parsed.file = path.resolve(argv[++i]);
    else if (arg === "--base-url") parsed.baseUrl = argv[++i];
    else throw new Error(`unknown argument ${arg}`);
  }
  return parsed;
}

function parseProfile(value: string): GateProfile {
  if (value === "offline" || value === "network" || value === "device") return value as GateProfile;
  throw new Error(`unknown profile ${value}; expected offline, network, or device`);
}

function optionalArg(flag: string, value?: string): string[] {
  return value ? [flag, value] : [];
}

function safeId(value: any): string {
  return String(value || "run").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "run";
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${signal || `exit code ${code}`}`));
    });
  });
}

async function selfCheck() {
  const offlineBaseline = defaultBaselineForProfile("offline");
  if (!offlineBaseline.endsWith(path.join("screen", "benchmark-baselines", "offline", "summary.json"))) {
    throw new Error("default offline baseline path is wrong");
  }

  const tempBaseline = path.join(root, "screen", "benchmark-baselines", "self-check", "summary.json");
  const resolved = resolveBaseline({ profile: "offline", baseline: tempBaseline });
  if (resolved !== tempBaseline) throw new Error("--baseline override should win");
  if (parseArgs(["--profile", "network"]).profile !== "network") {
    throw new Error("gate should parse --profile");
  }

  const source = await readFile(new URL(import.meta.url), "utf8");
  if (!source.includes("--profile") || !source.includes("offline")) {
    throw new Error("gate should default to an offline harness profile");
  }

  console.log("product capability gate self-check passed");
}
