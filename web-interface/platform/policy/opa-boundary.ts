import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { decideActionPolicy, publicPolicyDecision, type ActionPolicyDecision } from "../../action-policy-decision.ts";
import { resolveAction, type ActionPolicyManifest } from "../../action-policy.ts";
import { getOpaConfig } from "../config/platform-config.ts";

const execFileAsync = promisify(execFile);

type JsonObject = Record<string, any>;

export type OpaActionPolicyDecision = ActionPolicyDecision & {
  audit?: JsonObject;
  decisionId: string;
  engine: "opa-cli" | "local-manifest-fail-closed";
  evidence?: JsonObject;
  requirements?: JsonObject;
};

export type OpaBoundaryOptions = {
  manifest: ActionPolicyManifest;
  opaPath?: string;
  policyPath: string;
};

export function createOpaPolicyBoundary({
  manifest,
  opaPath = getOpaConfig().path,
  policyPath,
}: OpaBoundaryOptions) {
  async function decideAction({
    actionId,
    executor,
    params = {},
    subject = defaultSubject(),
    environment = defaultEnvironment(),
  }: {
    actionId: string;
    executor: string;
    params?: JsonObject;
    subject?: JsonObject;
    environment?: JsonObject;
  }): Promise<OpaActionPolicyDecision> {
    const resolved = resolveAction(manifest, { executor, actionId, params });
    const local = decideActionPolicy({ manifest, executor, actionId, params });
    const input = buildPolicyInput({
      actionId: resolved.actionId || actionId,
      action: resolved.action || null,
      executor,
      params: resolved.parameterValues || params,
      subject,
      environment,
      executorAllowed: Boolean(resolved.action?.allowedExecutors?.includes?.(executor)),
    });

    try {
      const regoDecision = await evalOpaDecision({ opaPath, policyPath, input });
      return normalizeOpaDecision({
        actionId: input.request.actionId,
        action: resolved.action || null,
        parameterValues: resolved.parameterValues || {},
        regoDecision,
      });
    } catch (error: any) {
      return failClosedDecision({
        local,
        actionId: resolved.actionId || actionId,
        action: resolved.action || null,
        reason: `opa-unavailable:${error.message || "unknown"}`,
      });
    }
  }

  async function health() {
    const version = await execFileAsync(opaPath, ["version"], { timeout: 5_000 });
    const evalResult = await evalOpaDecision({
      opaPath,
      policyPath,
      input: buildPolicyInput({
        actionId: "status",
        action: manifest.actions.status,
        executor: "web",
        params: {},
        subject: defaultSubject(),
        environment: defaultEnvironment(),
        executorAllowed: true,
      }),
    });
    return {
      ok: true,
      version: version.stdout.trim(),
      eval: evalResult,
    };
  }

  return {
    decideAction,
    health,
    publicDecision(decision: OpaActionPolicyDecision) {
      return publicPolicyDecision(decision);
    },
  };
}

function buildPolicyInput({
  actionId,
  action,
  executor,
  params,
  subject,
  environment,
  executorAllowed,
}: JsonObject) {
  return {
    schema: "walnutpi.action-policy-input.v1",
    request: {
      actionId,
      params,
      executor,
      surface: "mcp",
      operation: "tools/call",
      sessionId: null,
      turnId: null,
      traceId: null,
    },
    subject,
    action: {
      known: Boolean(action),
      risk: action?.risk || "high",
      mode: action?.mode || "refused",
      capabilities: action?.capabilities || [],
      confirmationRequired: Boolean(action?.confirmationRequired),
    },
    environment,
    executor_allowed: Boolean(executorAllowed),
  };
}

async function evalOpaDecision({ opaPath, policyPath, input }: JsonObject) {
  const policy = await readFile(policyPath, "utf8");
  const modulePath = policyPath;
  const stdout = await spawnWithInput(
    opaPath,
    [
      "eval",
      "--format=json",
      "--stdin-input",
      "--data",
      modulePath,
      "{ \"allow\": data.walnutpi.action.allow, \"status\": data.walnutpi.action.status, \"reason\": data.walnutpi.action.reason }",
    ],
    JSON.stringify(input),
  );
  if (!policy.includes("package walnutpi.action")) throw new Error("invalid walnutpi OPA package");
  const parsed = JSON.parse(stdout);
  const value = parsed?.result?.[0]?.expressions?.[0]?.value;
  if (!value || typeof value !== "object") throw new Error("OPA did not return a policy object");
  return value;
}

function spawnWithInput(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("OPA eval timed out"));
    }, 5_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `OPA exited with code ${code}`));
    });
    child.stdin.end(input);
  });
}

function normalizeOpaDecision({ actionId, action, parameterValues, regoDecision }: JsonObject): OpaActionPolicyDecision {
  const status = regoDecision.status === "allow" ? "allow" : regoDecision.status === "pending" ? "pending" : "refused";
  const allow = status === "allow";
  return {
    schema: "walnutpi.action-policy-decision.v1",
    engine: "opa-cli",
    decisionId: randomUUID(),
    actionId,
    action,
    parameterValues,
    allow,
    status,
    reason: String(regoDecision.reason || (allow ? "local-action-allowed" : "policy-refused")),
    requirements: status === "pending"
      ? {
        approval: {
          required: true,
          kind: "explicit-user-confirmation",
        },
      }
      : {},
    audit: {
      risk: action?.risk || "unknown",
      policyVersion: "local-rego",
      matchedRules: [String(regoDecision.reason || status)],
    },
    evidence: {
      kind: status === "pending" ? "pending-local-action" : status === "refused" ? "refused-local-action" : "allowed-local-action",
      actionId,
      noCommandExecution: !allow,
    },
  };
}

function failClosedDecision({ local, actionId, action, reason }: JsonObject): OpaActionPolicyDecision {
  const mustFailClosed = !action
    || action.risk === "high"
    || action.risk === "write-low"
    || action.confirmationRequired
    || action.mode === "confirmable"
    || action.mode === "refused";
  if (!mustFailClosed && local.allow) {
    return {
      ...local,
      engine: "local-manifest-fail-closed",
      decisionId: randomUUID(),
      reason: "opa-unavailable-read-action-local-allow",
      audit: { risk: action?.risk || "unknown", policyVersion: "local-manifest", matchedRules: ["read-action-local-allow"] },
      evidence: { kind: "allowed-local-action", actionId, opaUnavailable: true },
    };
  }
  return {
    schema: "walnutpi.action-policy-decision.v1",
    engine: "local-manifest-fail-closed",
    decisionId: randomUUID(),
    actionId,
    action,
    parameterValues: {},
    allow: false,
    status: action?.confirmationRequired || action?.mode === "confirmable" ? "pending" : "refused",
    reason,
    requirements: action?.confirmationRequired
      ? { approval: { required: true, kind: "explicit-user-confirmation" } }
      : {},
    audit: { risk: action?.risk || "unknown", policyVersion: "local-manifest", matchedRules: ["opa-unavailable-fail-closed"] },
    evidence: { kind: "policy-fail-closed", actionId, noCommandExecution: true },
  };
}

function defaultSubject() {
  return {
    kind: "local-user",
    authenticated: true,
    roles: ["owner"],
    approvalToken: null,
  };
}

function defaultEnvironment() {
  return {
    previewOnly: false,
    deviceProfile: "device",
    target: null,
  };
}
