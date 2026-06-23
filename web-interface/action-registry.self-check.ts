#!/usr/bin/env bun
import assert from "node:assert/strict";
import path from "node:path";
import {
  actionIdForIntent,
  policyActionIdsForIntent,
  isSafeContinuationTask,
  MAX_CONTINUATION_TASKS,
  normalizeNextTasks,
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

console.log("action registry self-check passed");
