#!/usr/bin/env bun
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildScreenSyncEvidence, screenServiceState } from "./screen-sync-evidence.ts";

const validHash = "a".repeat(64);
const playlistEnvelope = {
  playlistHash: validHash,
  playlist: { id: "default", loop: true },
  items: [
    {
      manifestId: "demo",
      manifestHash: "b".repeat(64),
      durationMs: 1000,
      repeat: 1,
      transition: "cut",
      output: { type: "static", rgb565PixelSha256: "c".repeat(64) },
    },
  ],
};
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const ok = { ok: true, code: 0, output: "ok" };
const frameResult = {
  ok: true,
  code: 0,
  output: JSON.stringify({
    sha256: "d".repeat(64),
    byteLength: 307200,
    expectedByteLength: 307200,
    width: 480,
    height: 320,
    pixelFormat: "RGB565_LE",
    bitsPerPixel: 16,
    isBlank: false,
    nonzeroBytes: 64,
  }),
};

assert.equal(screenServiceState("walnut-screen.service              inactive"), "inactive");

const inactiveStateResult = {
  ok: true,
  code: 0,
  output: "== Screen ==\nwalnut-screen.service              inactive\nwalnut-framebuffer-status.service  inactive",
};

const evidence = buildScreenSyncEvidence({
  playlistEnvelope,
  playlistHash: validHash,
  artifactHash: validHash,
  artifactHashValid: true,
  frameEvidence: JSON.parse(frameResult.output),
  stateResult: inactiveStateResult,
  frameResult,
  stateCommand: "walnut screen state",
  frameCommand: "sudo -n walnut screen frame",
  fullEvidence: true,
  buildId: "screen-self-check",
  frameUrl: (buildId) => `/api/screen/frame/${buildId}`,
  validSha256: (value) => /^[a-f0-9]{64}$/.test(String(value || "")),
  sha256: hash,
  stableStringify: JSON.stringify,
  stageResults: {
    sliceResult: ok,
    buildResult: ok,
    validateResult: ok,
    activateResult: ok,
    stateResult: inactiveStateResult,
    frameResult,
  },
});

assert.equal(evidence.failure.stage, "activate");
assert.match(evidence.failure.summary, /inactive/);

console.log("screen sync evidence self-check passed");
