import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createScreenWorkspaceApi } from "./screen-workspace-api.js";

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

assert.equal(api.__test.extractWeatherCity(prompt), "上海");
assert.deepEqual(plan.needs, [{ kind: "weather.current", location: "上海" }]);
assert.equal(plan.template, "pixel-weather");
assert.equal(plan.composition, "fact-card");
assert.equal(plan.widgetApp, false);
assert.equal(api.__test.compactText("上海天气", 12), "上海天气");
assert.equal(api.__test.compactDisplayText("多云转晴", 14), "多云转晴");

const template = JSON.parse(await readFile(path.resolve("screen", "generators", "pixel-weather.json"), "utf8"));
const screenSpec = api.__test.buildFreeformPixelScreenSpec({
  prompt,
  title: "上海天气",
  template,
  plan,
  facts: {
    cards: [{
      title: "上海",
      value: "28C",
      subtitle: "多云",
      footer: "适合出行",
      items: [
        { label: "HUM", value: "60%", bar: 20 },
        { label: "WIND", value: "8KPH" },
        { label: "RAIN", value: "0MM", bar: 0 },
      ],
    }],
  },
});

assert.equal(screenSpec.title, "上海天气");
assert.equal(screenSpec.primaryLabel, "上海");
assert.equal(screenSpec.footer, "适合出行");

console.log("screen-workspace-api self-check passed");
