#!/usr/bin/env bun
import assert from "node:assert/strict";
import { actionsForExecutor, loadActionPolicyManifest, resolveAction } from "./action-policy.ts";

const manifest = await loadActionPolicyManifest(new URL("../action-policy-manifest.json", import.meta.url));

assert.equal(resolveAction(manifest, { executor: "web", actionId: "i2c_scan" }).status, "runnable");
assert.equal(resolveAction(manifest, { executor: "walnut-ai", actionId: "i2c_scan" }).status, "runnable");
assert.equal(resolveAction(manifest, { executor: "web", actionId: "overlay-change" }).status, "refused");
assert.equal(actionsForExecutor(manifest, "walnut-cli").i2c_scan.walnutCli.handler, "i2c_scan");

console.log("action policy self-check passed");
