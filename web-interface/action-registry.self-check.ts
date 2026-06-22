#!/usr/bin/env bun
import assert from "node:assert/strict";
import path from "node:path";
import {
  actionIdForIntent,
  policyActionIdsForIntent,
  isObservationReplanRequest,
  isSafeContinuationTask,
  MAX_CONTINUATION_TASKS,
  normalizeNextTasks,
  wantsReadOnlyContinuation,
} from "./action-registry.ts";

// -- Intent routing ---------------------------------------------------------

assert.equal(actionIdForIntent("device.status.read"), "status");
assert.equal(actionIdForIntent("device.network.read"), "network");
assert.equal(actionIdForIntent("device.snapshot.read"), "snapshot");
assert.equal(actionIdForIntent("device.i2c.read"), "i2c_scan");
assert.equal(actionIdForIntent("device.gpio.read"), "gpio");
assert.equal(actionIdForIntent("device.notes.read"), "notes");
assert.equal(actionIdForIntent("device.note.write"), "note");
assert.equal(actionIdForIntent("terminal.tool"), "video");
assert.equal(actionIdForIntent("unknown.intent"), null);

assert.deepEqual(policyActionIdsForIntent("policy.system_write"), ["package-install", "reboot"]);
assert.deepEqual(policyActionIdsForIntent("policy.service_restart"), ["restart_walnut_screen_service"]);
assert.deepEqual(policyActionIdsForIntent("policy.maintenance_guidance"), ["storage-delete"]);
assert.equal(policyActionIdsForIntent("unknown.policy"), null);

// -- Safe continuation ------------------------------------------------------

assert.equal(MAX_CONTINUATION_TASKS, 1);

assert.equal(isSafeContinuationTask({ kind: "action.run", action: "status" }), true);
assert.equal(isSafeContinuationTask({ kind: "action.run", action: "network" }), true);
assert.equal(isSafeContinuationTask({ kind: "action.run", action: "snapshot" }), true);
assert.equal(isSafeContinuationTask({ kind: "action.run", action: "note" }), false);
assert.equal(isSafeContinuationTask({ kind: "action.run", action: "restart_walnut_screen_service" }), false);
assert.equal(isSafeContinuationTask({ kind: "session.summary" }), true);
assert.equal(isSafeContinuationTask({ kind: "diagnostics.recent_failure.read" }), true);
assert.equal(isSafeContinuationTask({ kind: "screen.state_frame.read" }), true);
assert.equal(isSafeContinuationTask({ kind: "unknown.task" }), false);

// -- normalizeNextTasks -----------------------------------------------------

assert.deepEqual(normalizeNextTasks(null), []);
assert.deepEqual(normalizeNextTasks(undefined), []);
assert.deepEqual(normalizeNextTasks([]), []);
assert.deepEqual(
  normalizeNextTasks([{ agent: "device", kind: "action.run", action: "status" }]),
  [{ agent: "device", kind: "action.run", action: "status" }],
);
assert.deepEqual(
  normalizeNextTasks({ kind: "action.run" }),
  [{ agent: "device", kind: "action.run" }],
);
assert.deepEqual(
  normalizeNextTasks([{ kind: "session.summary" }]),
  [{ agent: "session", kind: "session.summary" }],
);

// -- Observation replan -----------------------------------------------------

assert.equal(isObservationReplanRequest("观察后自动继续"), false);
assert.equal(isObservationReplanRequest("先观察，如果有只读下一步则自动继续"), true);
assert.equal(isObservationReplanRequest("先做一次只读观察；如果观察结果给出下一步，只允许安全只读动作自动继续"), true);
assert.equal(isObservationReplanRequest("查状态"), false);
assert.equal(isObservationReplanRequest("首先生成一个唯美星空"), false);

// -- ReadOnlyContinuation ---------------------------------------------------

assert.equal(wantsReadOnlyContinuation("观察完成"), true);
assert.equal(wantsReadOnlyContinuation("下一步做什么"), true);
assert.equal(wantsReadOnlyContinuation("普通查询"), false);

console.log("action registry self-check passed");
