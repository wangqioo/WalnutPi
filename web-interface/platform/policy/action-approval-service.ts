import { createHash, randomBytes } from "node:crypto";
import { stableStringify } from "../../../scripts/screen-workspace-vocabulary.ts";
import { toolResult, failedToolResult } from "../../walnut-tool-results.ts";
import { createDbActionApprovalStore } from "./action-approval-store.ts";
import { withWalnutSpan } from "../observability/tracing.ts";

type JsonObject = Record<string, any>;

const APPROVAL_TTL_MS = 5 * 60 * 1000;

export function createActionApprovalService({
  approvalStore = createDbActionApprovalStore(),
  auditLedger,
  opaEnforcer,
  policyManifest,
}: JsonObject) {
  async function prepare(body: JsonObject, turn: JsonObject) {
    const actionId = cleanActionId(body.actionId || body.action);
    if (!actionId) return failedToolResult("policy", "actionId is required for policy.action.prepare");
    const params = objectOrEmpty(body.params);
    const policy = await decide(actionId, params, turn, "prepare");
    const publicDecision = opaEnforcer.publicDecision(policy);
    await audit("policy.action.prepare.decision", turn, {
      ok: Boolean(policy),
      status: policy.status === "pending" ? 409 : policy.allow ? 200 : 400,
      actionId,
      decisionId: policy.decisionId || null,
      decision: policy,
    });

    if (policy.status === "refused") {
      await audit("policy.action.prepare.refused", turn, {
        ok: false,
        status: 400,
        actionId,
        decisionId: policy.decisionId || null,
        noCommandExecution: true,
      });
      return toolResult("policy", {
        ok: false,
        summary: "Action refused by OPA policy.",
        result: {
          operation: "policy.action.prepare",
          actionId,
          decision: publicDecision,
        },
        evidence: {
          refusedLocalAction: true,
          noCommandExecution: true,
          noRemoteCommandExecution: true,
          policyDecision: publicDecision,
        },
        diagnostics: {
          policyDecisionId: policy.decisionId || null,
        },
      });
    }

    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
    const approvalToken = randomBytes(24).toString("base64url");
    const record = {
      schema: "walnutpi.action-approval-record.v1",
      status: "prepared" as const,
      decisionId: policy.decisionId,
      actionId,
      paramsHash: hashJson(policy.parameterValues || params),
      commandBindingId: commandBindingIdForAction(actionId, policy.action),
      subjectHash: hashJson(subjectForTurn(turn)),
      subject: publicSubject(subjectForTurn(turn)),
      expiresAt,
      explanation: policy.action?.walnutCli?.explanation || policy.action?.web?.reply || policy.reason,
      decision: publicDecision,
      opaDecision: publicDecision,
      approvalTokenHash: hashToken(approvalToken),
      createdAt: new Date().toISOString(),
    };
    const write = await approvalStore.append(record);
    if (!write.persisted) {
      await audit("policy.action.prepare.persistence_failed", turn, {
        ok: false,
        status: 503,
        actionId,
        decisionId: policy.decisionId,
        reason: write.reason,
        noCommandExecution: true,
      });
      return toolResult("policy", {
        ok: false,
        summary: "Action approval could not be persisted; approval token was not issued.",
        result: {
          operation: "policy.action.prepare",
          actionId,
          decision: publicDecision,
          persisted: false,
          reason: write.reason,
        },
        evidence: {
          approvalPrepareRejected: true,
          noCommandExecution: true,
          noRemoteCommandExecution: true,
          policyDecision: publicDecision,
          dbProductState: {
            boundaryReached: true,
            persisted: false,
            skipped: Boolean(write.skipped),
            reason: write.reason,
          },
        },
        diagnostics: {
          policyDecisionId: policy.decisionId,
        },
      });
    }
    await audit("policy.action.prepare.recorded", turn, {
      ok: true,
      status: policy.status === "pending" ? 409 : 200,
      actionId,
      decisionId: policy.decisionId,
      paramsHash: record.paramsHash,
      commandBindingId: record.commandBindingId,
      subjectHash: record.subjectHash,
      expiresAt,
      noCommandExecution: true,
    });

    return toolResult("policy", {
      ok: true,
      summary: policy.status === "pending"
        ? "Action is prepared and requires explicit approval before command construction."
        : "Action is prepared; commit still requires matching approval proof before execution.",
      result: {
        operation: "policy.action.prepare",
        decisionId: policy.decisionId,
        actionId,
        paramsHash: record.paramsHash,
        commandBindingId: record.commandBindingId,
        subject: record.subject,
        expiresAt,
        explanation: record.explanation,
        decision: publicDecision,
        approvalToken,
        persisted: true,
      },
      evidence: {
        pendingLocalAction: policy.status === "pending",
        preparedLocalAction: true,
        noCommandExecution: true,
        noRemoteCommandExecution: true,
        policyDecision: publicDecision,
        dbProductState: {
          boundaryReached: true,
          persisted: true,
          skipped: false,
          reason: null,
        },
      },
      diagnostics: {
        policyDecisionId: policy.decisionId,
      },
    });
  }

  async function commit(body: JsonObject, turn: JsonObject) {
    const committed = await commitInternal(body, turn);
    return committed.toolResult;
  }

  async function commitForExecution(body: JsonObject, turn: JsonObject) {
    return commitInternal(body, turn);
  }

  async function commitInternal(body: JsonObject, turn: JsonObject) {
    const decisionId = String(body.decisionId || "").trim();
    const actionId = cleanActionId(body.actionId || body.action);
    const params = objectOrEmpty(body.params);
    const approvalToken = String(body.approvalToken || turn.auth?.subject?.approvalToken || "").trim();
    if (!decisionId) return { toolResult: failedToolResult("policy", "decisionId is required for policy.action.commit"), executionDecision: null };
    if (!actionId) return { toolResult: failedToolResult("policy", "actionId is required for policy.action.commit"), executionDecision: null };
    if (!approvalToken) return { toolResult: failedToolResult("policy", "approvalToken is required for policy.action.commit"), executionDecision: null };

    const record = await approvalStore.latestByDecisionId(decisionId);
    const subjectHash = hashJson(subjectForTurn(turn));
    const freshDecision = await decide(actionId, params, turnWithApprovalProof(turn, Boolean(record)), "commit");
    const publicDecision = opaEnforcer.publicDecision(freshDecision);
    const paramsHash = hashJson(freshDecision.parameterValues || params);
    const tokenHash = hashToken(approvalToken);
    const mismatch = !record
      ? "decision-not-prepared"
      : record.status !== "prepared"
        ? "decision-not-prepared"
        : record.actionId !== actionId
          ? "action-mismatch"
          : record.paramsHash !== paramsHash
            ? "params-hash-mismatch"
            : record.subjectHash !== subjectHash
              ? "subject-mismatch"
              : record.approvalTokenHash !== tokenHash
                ? "approval-token-mismatch"
                : Date.parse(record.expiresAt) <= Date.now()
                  ? "approval-expired"
              : null;

    await audit("policy.action.commit.decision", turn, {
      ok: !mismatch && freshDecision.allow,
      status: mismatch ? 400 : freshDecision.allow ? 200 : freshDecision.status === "pending" ? 409 : 400,
      actionId,
      decisionId,
      freshDecisionId: freshDecision.decisionId || null,
      paramsHash,
      subjectHash,
      reason: mismatch || freshDecision.reason,
      decision: freshDecision,
    });

    if (mismatch || !freshDecision.allow) {
      return {
        executionDecision: null,
        toolResult: toolResult("policy", {
        ok: false,
        summary: mismatch
          ? `Approval commit rejected: ${mismatch}.`
          : "Approval commit rejected by fresh OPA decision.",
        result: {
          operation: "policy.action.commit",
          actionId,
          decisionId,
          committed: false,
          reason: mismatch || freshDecision.reason,
          decision: publicDecision,
        },
        evidence: {
          approvalCommitRejected: true,
          noCommandExecution: true,
          noRemoteCommandExecution: true,
          policyDecision: publicDecision,
        },
        diagnostics: {
          policyDecisionId: freshDecision.decisionId || null,
        },
        }),
      };
    }

    const commitWrite = await approvalStore.append({
      ...record,
      schema: "walnutpi.action-approval-record.v1",
      status: "committed",
      committedAt: new Date().toISOString(),
      commitDecisionId: freshDecision.decisionId,
    });
    if (!commitWrite.persisted) {
      await audit("policy.action.commit.persistence_failed", turn, {
        ok: false,
        status: 503,
        actionId,
        decisionId,
        freshDecisionId: freshDecision.decisionId,
        paramsHash,
        reason: commitWrite.reason,
        noCommandExecution: true,
      });
      return {
        executionDecision: null,
        toolResult: toolResult("policy", {
          ok: false,
          summary: "Approval commit could not be persisted; command construction remains blocked.",
          result: {
            operation: "policy.action.commit",
            actionId,
            decisionId,
            committed: false,
            reason: commitWrite.reason,
            decision: publicDecision,
          },
          evidence: {
            approvalCommitRejected: true,
            noCommandExecution: true,
            noRemoteCommandExecution: true,
            policyDecision: publicDecision,
            dbProductState: {
              boundaryReached: true,
              persisted: false,
              skipped: Boolean(commitWrite.skipped),
              reason: commitWrite.reason,
            },
          },
          diagnostics: {
            policyDecisionId: freshDecision.decisionId,
          },
        }),
      };
    }
    await audit("policy.action.commit.accepted", turn, {
      ok: true,
      status: 200,
      actionId,
      decisionId,
      freshDecisionId: freshDecision.decisionId,
      paramsHash,
      commandBindingId: record.commandBindingId,
    });

    return {
      executionDecision: freshDecision,
      toolResult: toolResult("policy", {
        ok: true,
        summary: "Approval commit accepted by OPA and bound to the prepared action.",
        result: {
          operation: "policy.action.commit",
          actionId,
          decisionId,
          committed: true,
          params,
          paramsHash,
          commandBindingId: record.commandBindingId,
          decision: publicDecision,
          persisted: Boolean(commitWrite.persisted),
        },
        evidence: {
          approvalCommitted: true,
          policyDecision: publicDecision,
          dbProductState: {
            boundaryReached: true,
            persisted: Boolean(commitWrite.persisted),
            skipped: Boolean(commitWrite.skipped),
            reason: commitWrite.reason || null,
          },
        },
        diagnostics: {
          policyDecisionId: freshDecision.decisionId,
        },
      }),
    };
  }

  async function decide(actionId: string, params: JsonObject, turn: JsonObject, operation: "prepare" | "commit") {
    return withWalnutSpan("walnut.policy.decision", {
      "walnut.session_id": turn.sessionId || null,
      "walnut.turn_id": turn.turnId || null,
      "walnut.action_id": actionId,
    }, async (span) => {
      const decision = await opaEnforcer.decideActionAsync({
        manifest: policyManifest,
        executor: "web",
        actionId,
        params,
        subject: subjectForTurn(turn),
        environment: objectOrEmpty(turn.auth?.environment),
        requestContext: {
          sessionId: turn.sessionId || null,
          turnId: turn.turnId || null,
          traceId: turn.traceId || null,
          operation,
        },
      });
      span.setAttribute("walnut.policy_decision_id", decision.decisionId || "");
      return decision;
    });
  }

  async function audit(kind: string, turn: JsonObject, record: JsonObject) {
    await auditLedger?.append?.({
      kind,
      operation: kind,
      turnId: turn.turnId || null,
      sessionId: turn.sessionId || null,
      traceId: turn.traceId || null,
      subjectKind: turn.auth?.subject?.kind || null,
      deviceProfile: turn.auth?.environment?.deviceProfile || null,
      ...record,
    });
  }

  return {
    commit,
    commitForExecution,
    prepare,
  };
}

function commandBindingIdForAction(actionId: string, action: JsonObject = {}) {
  if (action?.web?.commandTemplate) return `web.commandTemplate:${actionId}`;
  if (action?.web?.command) return `web.command:${actionId}`;
  if (action?.walnutCli?.command) return `walnutCli.command:${actionId}`;
  if (action?.walnutCli?.handler) return `walnutCli.handler:${actionId}`;
  return `catalog:${actionId}`;
}

function cleanActionId(value: any) {
  const text = String(value || "").trim();
  return /^[a-z][a-z0-9_-]*$/.test(text) ? text : "";
}

function hashJson(value: any) {
  return createHash("sha256").update(stableStringify(value ?? null)).digest("hex");
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function publicSubject(subject: JsonObject) {
  return {
    kind: subject.kind || null,
    authenticated: Boolean(subject.authenticated),
    roles: Array.isArray(subject.roles) ? subject.roles : [],
    userId: subject.userId || null,
    sessionId: subject.sessionId || null,
  };
}

function subjectForTurn(turn: JsonObject) {
  const subject = objectOrEmpty(turn.auth?.subject);
  return {
    kind: subject.kind || "anonymous",
    authenticated: Boolean(subject.authenticated),
    roles: Array.isArray(subject.roles) ? subject.roles : [],
    userId: subject.userId || null,
    sessionId: subject.sessionId || turn.sessionId || null,
    approvalTokenProof: subject.approvalTokenProof === true,
  };
}

function turnWithApprovalProof(turn: JsonObject, approvalTokenProof: boolean) {
  return {
    ...turn,
    auth: {
      ...objectOrEmpty(turn.auth),
      subject: {
        ...objectOrEmpty(turn.auth?.subject),
        approvalTokenProof,
      },
    },
  };
}
