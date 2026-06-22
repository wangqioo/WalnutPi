const SCENARIO_SCHEMA = "walnutpi.loopScenario.v1";

const ORACLE_ONLY_KEYS = new Set([
  "oracle",
  "route",
  "intent",
  "delivery",
  "resultSignals",
  "predicates",
  "pass",
  "expected",
]);

export function normalizeLoopScenario(value) {
  if (value === null || value === undefined || value === "") return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("scenario must be an object");
  }
  rejectOracleKeys(value, "scenario");
  const schema = value.schema || SCENARIO_SCHEMA;
  if (schema !== SCENARIO_SCHEMA) {
    throw new Error(`scenario schema must be ${SCENARIO_SCHEMA}`);
  }
  const scenario = {
    schema,
    goal: requiredString(value.goal, "scenario.goal"),
    constraints: stringArray(value.constraints, "scenario.constraints"),
    requiredEvidence: stringArray(value.requiredEvidence, "scenario.requiredEvidence"),
    allowedContinuations: normalizeAllowedContinuations(value.allowedContinuations),
    blockedPolicy: normalizeBlockedPolicy(value.blockedPolicy),
  };
  rejectOracleKeys(scenario.blockedPolicy, "scenario.blockedPolicy");
  return scenario;
}

export function validateLoopScenario(value) {
  normalizeLoopScenario(value);
  return true;
}

export function assertNoOracleForLoop(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  if (Object.hasOwn(body, "oracle")) {
    throw new Error("oracle is harness-only and must not be passed to the product loop");
  }
}

export function scenarioAllowsAutoContinuation(task, scenario) {
  if (!scenario) return true;
  const allowed = scenario.allowedContinuations || [];
  if (!allowed.length) return true;
  return allowed.some((entry) => {
    if (entry.class === "read-only") return isReadOnlyTask(task);
    if (entry.kind && entry.kind !== task.kind) return false;
    if (entry.action && entry.action !== (task.action || null)) return false;
    return Boolean(entry.kind || entry.action);
  });
}

export function scenarioVetoReason(task, scenario) {
  if (!scenario) return null;
  if (!scenarioAllowsAutoContinuation(task, scenario)) return "scenario-continuation-not-allowed";
  const requiresConfirmation = new Set(scenario.blockedPolicy?.requiresConfirmation || []);
  const signals = taskPolicySignals(task);
  for (const signal of signals) {
    if (requiresConfirmation.has(signal)) return "continuation-requires-explicit-confirmation";
  }
  return null;
}

function rejectOracleKeys(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const present = Object.keys(value).filter((key) => ORACLE_ONLY_KEYS.has(key));
  if (present.length) {
    throw new Error(`${path} contains harness-only oracle field(s): ${present.join(", ")}`);
  }
}

function requiredString(value, path) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${path} is required`);
  return normalized;
}

function stringArray(value, path) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) => {
    const normalized = String(item || "").trim();
    if (!normalized) throw new Error(`${path}[${index}] must be a non-empty string`);
    return normalized;
  });
}

function normalizeAllowedContinuations(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("scenario.allowedContinuations must be an array");
  return value.map((entry, index) => {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (!name) throw new Error(`scenario.allowedContinuations[${index}] must be non-empty`);
      return { class: name };
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`scenario.allowedContinuations[${index}] must be a string or object`);
    }
    rejectOracleKeys(entry, `scenario.allowedContinuations[${index}]`);
    const normalized = {
      class: entry.class ? String(entry.class).trim() : null,
      kind: entry.kind ? String(entry.kind).trim() : null,
      action: entry.action ? String(entry.action).trim() : null,
    };
    if (!normalized.class && !normalized.kind && !normalized.action) {
      throw new Error(`scenario.allowedContinuations[${index}] must include class, kind, or action`);
    }
    return normalized;
  });
}

function normalizeBlockedPolicy(value) {
  if (value === undefined || value === null) return { requiresConfirmation: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("scenario.blockedPolicy must be an object");
  }
  rejectOracleKeys(value, "scenario.blockedPolicy");
  return {
    requiresConfirmation: stringArray(value.requiresConfirmation, "scenario.blockedPolicy.requiresConfirmation"),
  };
}

function isReadOnlyTask(task) {
  if (!task || typeof task !== "object") return false;
  if (task.kind === "action.run") {
    return ["status", "network", "snapshot", "gpio", "notes"].includes(String(task.action || ""));
  }
  return ["session.summary", "diagnostics.recent_failure.read", "screen.state_frame.read"].includes(String(task.kind || ""));
}

function taskPolicySignals(task) {
  const action = String(task?.action || "");
  const kind = String(task?.kind || "");
  const signals = new Set([kind, action]);
  if (kind.startsWith("screen.workspace.sync")) signals.add("screen-sync");
  if (["note"].includes(action)) signals.add("daily-note-write");
  if (["package-install", "reboot", "restart_walnut_screen_service"].includes(action)) signals.add("device-write");
  if (action === "restart_walnut_screen_service") signals.add("service-restart");
  if (action === "reboot") signals.add("reboot");
  return [...signals].filter(Boolean);
}
