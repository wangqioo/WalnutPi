import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createScreenWorkspaceApi } from "./screen-workspace-api.ts";

const api = createScreenWorkspaceApi({
  screenWorkspaceStore: {},
  screenWorkspaceSyncWorkflow: {},
  readJsonRequest: async () => ({}),
  json: (body, status = 200) => ({ body, status }),
  workspaceErrorResponse: (error) => ({ body: { ok: false, error: error.message }, status: 500 }),
  webMetricsLedger: { append: async () => {} },
  processSourceAssetToScreenOutput: async () => ({}),
  appendScreenPlaylistItem: async () => ({}),
  writeDefaultScreenPlaylist: async () => ({}),
  generateLvglScreenWorkspaceRuntimeAssets: async () => ({}),
  generateWidgetCatalog: async () => null,
  persistScreenSyncResult: async () => {},
  runLocal: async () => ({ ok: true, output: "" }),
  runRemote: async () => ({ ok: true, output: "" }),
  runRemoteWithInput: async () => ({ ok: true, output: "" }),
  shellQuote: (value) => String(value),
  findWindowsCommand: async () => null,
  sha256: () => "",
  projectRoot: path.resolve("."),
  screenWorkspaceRoot: path.resolve("screen"),
  screenSourceImportMaxBytes: 1,
  screenLvglPreviewOutputDir: path.resolve("screen", "outputs", "lvgl-preview"),
});

const prompt = "联网查上海天气，做成 480x320 小屏预览，不同步真机";
const plan = api.__test.buildScreenGenerationPlan(prompt);
const mixedPrompt = "查一下 Shanghai weather，生成 480x320 小屏卡片，不要同步到真机";
const mixedPlan = api.__test.buildScreenGenerationPlan(mixedPrompt);
const explicitPlan = api.__test.buildScreenGenerationPlan(prompt, { templateId: "pixel-weather" });

assert.deepEqual(plan.needs, []);
assert.deepEqual(mixedPlan.needs, []);
assert.equal(plan.template, "pixel-ops");
assert.equal(mixedPlan.template, "pixel-ops");
assert.equal(explicitPlan.template, "pixel-weather");
assert.equal(plan.composition, "template-default");
assert.equal(plan.widgetApp, true);
assert.equal(api.__test.compactText("上海天气", 12), "上海天气");
assert.equal(api.__test.compactDisplayText("多云转晴", 14), "多云转晴");

const template = JSON.parse(await readFile(path.resolve("screen", "generators", "pixel-ops.json"), "utf8"));
const screenSpec = api.__test.buildFreeformPixelScreenSpec({
  prompt,
  title: "上海天气",
  template,
  plan,
  facts: { cards: [] },
});

assert.equal(screenSpec.title, "上海天气");
assert.equal(screenSpec.template, "pixel-ops");
assert.equal(screenSpec.primaryLabel, "DEVICE");
assert.equal(screenSpec.primaryValue, "ready");
assert.equal(screenSpec.footer, "AGENT PIXEL");
assert.equal(screenSpec.background, template.defaults.lightBackground);
assert.equal(screenSpec.accent, template.defaults.accent);
assert.equal(screenSpec.progress, template.defaults.progress);

console.log("screen-workspace-api self-check passed");
