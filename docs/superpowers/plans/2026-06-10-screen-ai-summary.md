# Screen AI Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Web-side AI summary route and UI action for stored screen sync records.

**Architecture:** The server reads a local sync record, extracts compact evidence, returns a deterministic local summary, and optionally asks an OpenAI-compatible `/responses` endpoint when `OPENAI_API_KEY` is configured. The browser shows the returned summary in the sync area, chat log, and developer diagnostics without triggering device actions.

**Tech Stack:** Bun server JavaScript, browser DOM JavaScript, existing local sync records, optional fetch to OpenAI-compatible Responses API.

---

### Task 1: Backend Summary Helpers

**Files:**
- Modify: `web-interface/model-terminal-server.js`

- [x] Add AI environment constants near other top-level constants:

```js
const AI_MODEL = process.env.WALNUT_AI_MODEL || "gpt-5.5";
const AI_BASE_URL = (process.env.WALNUT_AI_BASE_URL || "https://rehdasu.cn/v1").replace(/\/+$/, "");
const AI_API_KEY = process.env.OPENAI_API_KEY || "";
```

- [x] Add `shortHash(value)`:

```js
function shortHash(value) {
  return typeof value === "string" && value.length >= 12 ? value.slice(0, 12) : null;
}
```

- [x] Add `screenSummaryEvidence(record)`:

```js
function screenSummaryEvidence(record) {
  const stage = record.failedStage || (record.ok ? "ok" : "unknown");
  const commandByStage = {
    build: "build",
    artifact: "artifact",
    activate: "activate",
    evidence: "evidence",
    frame: "frame",
    visual: "frame",
  };
  const commandName = commandByStage[stage] || "";
  const repairCandidate = buildScreenRepairCandidate(record);
  return {
    buildId: record.buildId,
    ok: Boolean(record.ok),
    failedStage: record.failedStage || null,
    summary: record.summary || "",
    manifestHashShort: shortHash(record.manifestHash),
    artifactHashShort: shortHash(record.artifactHash),
    deliveryHashShort: shortHash(record.deliveryHash),
    visualMatch: record.screenEvidence?.visualMatch || "unknown",
    visualChecks: record.screenEvidence?.visualChecks || null,
    repairHint: record.repairHint
      ? {
          stage: record.repairHint.stage,
          title: record.repairHint.title,
          summary: record.repairHint.summary,
          beginnerReason: record.repairHint.beginnerReason,
        }
      : null,
    repairCandidate: {
      stage: repairCandidate.stage,
      confidence: repairCandidate.confidence,
      beginnerSummary: repairCandidate.beginnerSummary,
      proposedActions: repairCandidate.proposedActions,
      canAutoApply: repairCandidate.canAutoApply,
    },
    firstDiagnosticLine: firstDiagnosticLine(commandName ? repairCommandOutput(record, commandName) : record.output),
  };
}
```

- [x] Add `localScreenAiSummary(evidence)`:

```js
function localScreenAiSummary(evidence) {
  if (evidence.ok) {
    if (evidence.visualMatch === "captured") {
      return "已同步到核桃派。设备返回了有效的小屏画面证据，Web 预览和设备运行使用同一个 screen manifest。";
    }
    return "同步记录显示已完成，但画面证据还需要在开发者诊断里确认。";
  }

  const stage = evidence.failedStage || "unknown";
  const nextAction = evidence.repairCandidate?.proposedActions?.[0]?.label
    || evidence.repairHint?.summary
    || "查看开发者诊断里的 command output。";
  const reason = evidence.repairCandidate?.beginnerSummary
    || evidence.repairHint?.beginnerReason
    || evidence.summary
    || "同步失败，原因还需要进一步确认。";
  return `同步失败，卡在 ${stage} 阶段。${reason} 下一步建议：${nextAction}。`;
}
```

- [x] Add `parseResponsesOutput(data)` and `callScreenSummaryAi(evidence)`:

```js
function parseResponsesOutput(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if ((content.type === "output_text" || content.type === "text") && content.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function callScreenSummaryAi(evidence) {
  if (!AI_API_KEY) return { text: null, error: null, apiUsed: false };
  const prompt = [
    "你是 WalnutPi Web 控制台的同步结果总结器。",
    "只根据提供的 JSON 证据总结，不要编造没有发生的动作。",
    "用中文，面向小白，最多三句话。",
    "如果同步失败，说清失败阶段和最安全的下一步。",
    "",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
  const response = await fetch(`${AI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      input: [
        { role: "system", content: "你只总结已提供的设备执行证据。" },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    return { text: null, error: `API HTTP ${response.status}: ${detail.slice(0, 800)}`, apiUsed: true };
  }
  const data = await response.json();
  const text = parseResponsesOutput(data);
  return { text: text || null, error: text ? null : "API response did not include output text", apiUsed: true };
}
```

- [x] Add `buildScreenAiSummary(record)`:

```js
async function buildScreenAiSummary(record) {
  const evidence = screenSummaryEvidence(record);
  const localSummary = localScreenAiSummary(evidence);
  let source = "local";
  let summary = localSummary;
  let apiError = null;
  let apiUsed = false;

  try {
    const ai = await callScreenSummaryAi(evidence);
    apiUsed = ai.apiUsed;
    if (ai.text) {
      source = "ai";
      summary = ai.text;
    } else if (ai.error) {
      source = "ai-fallback";
      apiError = ai.error;
    }
  } catch (error) {
    source = "ai-fallback";
    apiUsed = true;
    apiError = error.message;
  }

  return {
    schema: "walnutpi.screenAiSummary.v1",
    buildId: record.buildId,
    source,
    summary,
    evidence,
    diagnostics: {
      model: apiUsed ? AI_MODEL : null,
      apiUsed,
      apiError,
    },
  };
}
```

### Task 2: Backend API Route

**Files:**
- Modify: `web-interface/model-terminal-server.js`

- [x] Add `handleScreenAiSummary(req)` beside `handleScreenRepairCandidate(req)`:

```js
async function handleScreenAiSummary(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const buildId = String(body.buildId || "").trim();
  const safeBuildId = safeRecordId(buildId);
  if (!safeBuildId) {
    return json({ ok: false, error: "invalid buildId", summary: "缺少有效的同步记录。" }, 400);
  }

  const record = await readScreenRecord(safeBuildId);
  if (!record) {
    return json({ ok: false, error: "screen record not found", summary: "找不到这次同步记录。" }, 404);
  }

  const aiSummary = await buildScreenAiSummary(record);
  return json({
    ok: true,
    buildId: safeBuildId,
    aiSummary,
  });
}
```

- [x] Register route before `/api/screen/records`:

```js
if (url.pathname === "/api/screen/ai-summary") {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  return handleScreenAiSummary(req);
}
```

### Task 3: Frontend Summary UI

**Files:**
- Modify: `web-interface/model-terminal.html`

- [x] Add an AI summary button next to the sync button:

```html
<button class="sync-button secondary-sync-button" id="aiSummaryButton" type="button" disabled>
  <span>生成 AI 总结</span>
</button>
```

- [x] Add CSS for `.secondary-sync-button` if needed:

```css
.secondary-sync-button {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}
```

- [x] Add diagnostics block:

```html
<div class="diagnostic-section">
  <span class="diagnostic-label">ai summary</span>
  <pre class="diagnostic-output" id="diagAiSummary">等待同步。</pre>
</div>
```

- [x] Add DOM references and current build ID:

```js
const aiSummaryButton = document.querySelector("#aiSummaryButton");
const diagAiSummary = document.querySelector("#diagAiSummary");
let currentSummaryBuildId = "";
```

- [x] Add `renderAiSummary(aiSummary)`:

```js
function renderAiSummary(aiSummary) {
  if (!aiSummary) return;
  syncSummary.textContent = aiSummary.summary || syncSummary.textContent;
  diagAiSummary.textContent = formatDiagnosticJson(aiSummary);
  addMessage("assistant", aiSummary.summary || "已生成同步总结。");
}
```

- [x] Add `loadAiSummary(buildId = currentSummaryBuildId)`:

```js
async function loadAiSummary(buildId = currentSummaryBuildId) {
  if (!buildId) return;
  aiSummaryButton.disabled = true;
  aiSummaryButton.textContent = "总结中";
  try {
    const response = await fetch(withCurrentSearch("/api/screen/ai-summary"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buildId }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.summary || data.error || "ai summary failed");
    renderAiSummary(data.aiSummary);
  } catch (error) {
    diagAiSummary.textContent = `无法生成 AI 总结：${error.message}`;
  } finally {
    aiSummaryButton.disabled = !currentSummaryBuildId;
    aiSummaryButton.textContent = "生成 AI 总结";
  }
}
```

- [x] Update `clearRepairPanel()` to reset `diagAiSummary` and `currentSummaryBuildId`.
- [x] Update `recordToSyncResult(record)` to include `aiSummary: record.aiSummary || null`.
- [x] Update `updateDiagnostics(result)` to set `currentSummaryBuildId`, enable the button, and render existing `aiSummary`.
- [x] Add click handler:

```js
aiSummaryButton.addEventListener("click", () => loadAiSummary());
```

### Task 4: Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `web-interface/README.md`
- Modify: `docs/third-projects-integration-alignment.md`

- [x] Document `POST /api/screen/ai-summary` as read-only and evidence-limited.
- [x] Run `git diff --check` for touched files.
- [x] Verify successful local summary with an existing record:

```powershell
$env:PORT='4196'
$p = Start-Process -FilePath bun -ArgumentList 'web-interface/model-terminal-server.js' -WorkingDirectory 'C:\Users\Yrd98\project\WalnutPi' -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
$record = Get-ChildItem -LiteralPath 'C:\Users\Yrd98\project\WalnutPi\web-interface\screen-sync-records' -Directory | Select-Object -First 1 -ExpandProperty Name
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4196/api/screen/ai-summary?nossh' -ContentType 'application/json' -Body (@{ buildId = $record } | ConvertTo-Json)
Stop-Process -Id $p.Id
```

Expected: `ok=true`, `aiSummary.schema=walnutpi.screenAiSummary.v1`, `source=local` when `OPENAI_API_KEY` is not configured.

- [x] Verify failed-stage local summary with a temporary `WALNUT_SCREEN_RECORDS_DIR`, mirroring the repair-candidate verification.
- [x] Verify invalid `buildId` returns `400`.
- [x] Smoke test page loading with the browser: button exists, diagnostics block exists, no app console errors.
