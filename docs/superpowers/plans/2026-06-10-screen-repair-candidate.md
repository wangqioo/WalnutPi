# Screen Repair Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only structured repair-candidate API and UI view for failed screen sync records.

**Architecture:** Reuse the existing screen sync record and `repairHint` model, then add a richer `repairCandidate` layer derived only from persisted records. The server owns candidate generation and route safety; the browser renders the candidate without adding any apply or retry action.

**Tech Stack:** Bun server JavaScript, browser DOM JavaScript, existing screen sync records, existing manual API verification.

---

### Task 1: Backend Repair Candidate Model

**Files:**
- Modify: `web-interface/model-terminal-server.js`

- [x] Add `repairCandidateAction(kind, label, detail)` near the existing repair helpers:

```js
function repairCandidateAction(kind, label, detail) {
  return { kind, label, detail };
}
```

- [x] Add `repairCandidateBase(record)`:

```js
function repairCandidateBase(record) {
  const stage = record.failedStage || (record.ok ? "ok" : "unknown");
  return {
    schema: "walnutpi.screenRepairCandidate.v1",
    buildId: record.buildId,
    stage,
    confidence: "low",
    beginnerSummary: record.summary || "同步记录需要人工检查。",
    developerDiagnosis: firstDiagnosticLine(record.output) || record.output || "missing diagnostic output",
    proposedActions: [],
    requiresConfirmation: true,
    canAutoApply: false,
    autoApplyReason: "第一版只生成修复候选方案，不自动修改文件或触发设备动作。",
  };
}
```

- [x] Add `buildScreenRepairCandidate(record)` after `buildScreenRepairHint(record)`. It must derive all output from `record`, `record.repairHint`, `record.commandResults`, and `record.screenEvidence`. It must not call `runRemote`, build, frame, capture, or file-write helpers.

Implementation outline:

```js
function buildScreenRepairCandidate(record) {
  const hint = record.repairHint || buildScreenRepairHint(record);
  const candidate = {
    ...repairCandidateBase(record),
    stage: hint.stage,
    beginnerSummary: hint.beginnerReason || hint.summary,
    developerDiagnosis: hint.developerDiagnosis,
  };

  const action = repairCandidateAction;
  const stagePlans = {
    ok: {
      confidence: "high",
      actions: [
        action("manual-check", "不需要修复", "这条同步记录已经成功，可以继续编辑小屏内容。"),
      ],
    },
    preview: {
      confidence: "high",
      actions: [
        action("refresh-and-retry", "退出预览模式", "去掉 URL 里的 ?nossh 后重新打开页面，再手动点击同步。"),
      ],
    },
    manifest: {
      confidence: "high",
      actions: [
        action("refresh-and-retry", "刷新小屏预览", "重新读取 /api/screen/manifest，确保同步请求携带最新 manifestHash。"),
        action("local-edit-plan", "检查 manifest JSON", "检查 lvgl_app/screen-manifest.json 是否是合法 JSON，schema 是否仍是 walnutpi.screen.v1。"),
      ],
    },
    build: {
      confidence: "medium",
      actions: [
        action("manual-check", "查看 build 段第一处错误", "在开发者诊断 command output 的 build 段查找第一条 error、failed、fatal 或 permission 行。"),
        action("local-edit-plan", "检查生成配置和 LVGL 源码", "如果是 C 或生成头文件错误，检查 lvgl_app/generated/screen_config.h 和 lvgl_app/src/main.c。"),
      ],
    },
    artifact: {
      confidence: "medium",
      actions: [
        action("device-check", "检查 LVGL 产物", "确认远端 build/lvgl_app/walnut-lvgl-screen 存在且可执行。"),
        action("manual-check", "确认远端项目根", "确认 WALNUT_REMOTE_PROJECT_ROOT 指向 /home/pi/projects/WalnutPi 或真实 checkout。"),
      ],
    },
    activate: {
      confidence: "medium",
      actions: [
        action("device-check", "检查屏幕服务", "确认 walnut-screen.service 已安装，且 sudo -n walnut screen start 可以运行。"),
        action("manual-check", "查看服务日志", "在设备上查看 walnut-screen.service 状态和最近日志，定位启动失败原因。"),
      ],
    },
    evidence: {
      confidence: "medium",
      actions: [
        action("device-check", "检查屏幕状态命令", "在设备上运行 walnut screen state，确认 walnut-screen.service 是 active。"),
        action("refresh-and-retry", "等待后重新同步", "如果服务刚启动，等待几秒后手动重新同步。"),
      ],
    },
    frame: {
      confidence: "medium",
      actions: [
        action("device-check", "检查 framebuffer 证据命令", "在设备上运行 sudo -n walnut screen frame，确认返回 JSON 元数据。"),
        action("manual-check", "检查 /dev/fb0 权限", "确认 /dev/fb0 可读，且没有其他 framebuffer 程序覆盖小屏。"),
      ],
    },
    visual: {
      confidence: "medium",
      actions: [
        action("manual-check", "检查画面结构字段", "查看 visualChecks，确认 480x320、RGB565、byteLength 和 nonblank 检查是否通过。"),
        action("device-check", "检查是否空白帧", "如果 frameNonblank=false，确认 walnut-screen.service 是否真的在绘制当前 LVGL 程序。"),
      ],
    },
    delivery: {
      confidence: "medium",
      actions: [
        action("manual-check", "查看 adapter 异常", "查看 command output 里的异常堆栈或 adapter 参数错误。"),
        action("manual-check", "检查 SSH 工具和参数", "确认 sshpass、SSH_HOST、SSH_USER、WALNUT_REMOTE_PROJECT_ROOT 和 WALNUT_REMOTE_BUILD_USER 配置可用。"),
      ],
    },
    unknown: {
      confidence: "low",
      actions: [
        action("manual-check", "按最早失败输出排查", "保留 buildId，查看 command output 中最早出现的 error、failed、fatal、permission 或 timeout 行。"),
      ],
    },
  };

  const plan = stagePlans[candidate.stage] || stagePlans.unknown;
  candidate.confidence = plan.confidence;
  candidate.proposedActions = plan.actions;
  candidate.evidence = hint.evidence;
  return candidate;
}
```

### Task 2: Backend Route

**Files:**
- Modify: `web-interface/model-terminal-server.js`

- [x] Add `handleScreenRepairCandidate(req)` beside `handleScreenRepairPlan(req)`:

```js
async function handleScreenRepairCandidate(req) {
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

  const repairCandidate = buildScreenRepairCandidate(record);
  return json({
    ok: true,
    buildId: safeBuildId,
    repairCandidate,
  });
}
```

- [x] Register the route before `/api/screen/records`:

```js
if (url.pathname === "/api/screen/repair-candidate") {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  return handleScreenRepairCandidate(req);
}
```

- [x] Do not add `previewOnly(url)` blocking to this route, because it reads local records only and does not connect to the device.

### Task 3: Frontend Diagnostics And Rendering

**Files:**
- Modify: `web-interface/model-terminal.html`

- [x] Add a developer diagnostics section after `repair hint`:

```html
<div class="diagnostic-section">
  <span class="diagnostic-label">repair candidate</span>
  <pre class="diagnostic-output" id="diagRepairCandidate">等待同步。</pre>
</div>
```

- [x] Add the DOM reference near existing diagnostics constants:

```js
const diagRepairCandidate = document.querySelector("#diagRepairCandidate");
```

- [x] Update `recordToSyncResult(record)` to include:

```js
repairCandidate: record.repairCandidate || null,
```

- [x] Update `clearRepairPanel()`:

```js
diagRepairCandidate.textContent = "等待同步。";
repairPlanButton.textContent = "查看修复候选方案";
```

- [x] Add `renderRepairCandidate(repairCandidate)`:

```js
function renderRepairCandidate(repairCandidate) {
  if (!repairCandidate) return;
  repairPanel.hidden = false;
  repairTitle.textContent = "修复候选方案";
  repairReason.textContent = repairCandidate.beginnerSummary || "同步失败，需要查看候选方案。";
  repairActions.replaceChildren();

  for (const action of repairCandidate.proposedActions || []) {
    const item = document.createElement("li");
    const label = action.label || action.kind || "建议";
    const detail = action.detail ? `：${action.detail}` : "";
    item.textContent = `${label}${detail}`;
    repairActions.append(item);
  }

  const safety = document.createElement("li");
  safety.textContent = repairCandidate.canAutoApply
    ? "需要确认后才能执行。"
    : "当前不会自动修改文件、连接核桃派或重新同步。";
  repairActions.append(safety);
}
```

- [x] Update `loadRepairPlan()` to fetch `/api/screen/repair-candidate`, render candidate, and keep `repairHint` fallback if the server returns one later:

```js
const response = await fetch(withCurrentSearch("/api/screen/repair-candidate"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ buildId }),
});
const data = await response.json();
if (!response.ok || !data.ok) throw new Error(data.summary || data.error || "repair candidate failed");
renderRepairCandidate(data.repairCandidate);
diagRepairCandidate.textContent = formatDiagnosticJson(data.repairCandidate);
if (data.repairHint) {
  renderRepairHint(data.repairHint);
  diagRepairHint.textContent = formatDiagnosticJson(data.repairHint);
}
```

- [x] Update button text in failure paths from `查看修复建议` to `查看修复候选方案`, and final loading text from `刷新建议` to `刷新候选方案`.

- [x] Update `updateDiagnostics(result)`:

```js
diagRepairCandidate.textContent = formatDiagnosticJson(result.repairCandidate);
if (result.repairCandidate) renderRepairCandidate(result.repairCandidate);
```

### Task 4: Verification

**Files:**
- No source edits beyond Task 1-3.

- [x] Try the planned syntax check:

```powershell
bun --check web-interface/model-terminal-server.js
```

Actual: Bun 1.3.14 treated this as a server startup command and kept the process running. Stop that temporary process and use the server/API verification below as the syntax and route-load check.

- [x] Start server on an unused local port:

```powershell
$env:PORT='4191'; $p = Start-Process -FilePath bun -ArgumentList 'web-interface/model-terminal-server.js' -WorkingDirectory 'C:\Users\Yrd98\project\WalnutPi' -WindowStyle Hidden -PassThru; Start-Sleep -Seconds 2; $p.Id
```

Expected: prints a process id.

- [x] Fetch a known stored record candidate without SSH:

```powershell
$record = Get-ChildItem -LiteralPath 'C:\Users\Yrd98\project\WalnutPi\web-interface\screen-sync-records' -Directory | Select-Object -First 1 -ExpandProperty Name
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4191/api/screen/repair-candidate?nossh' -ContentType 'application/json' -Body (@{ buildId = $record } | ConvertTo-Json)
```

Expected: JSON includes `ok: true`, `repairCandidate.schema: walnutpi.screenRepairCandidate.v1`, `canAutoApply: false`, and `requiresConfirmation: true`.

- [x] Confirm invalid build IDs are rejected:

```powershell
Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:4191/api/screen/repair-candidate?nossh' -ContentType 'application/json' -Body '{"buildId":"../bad"}' -SkipHttpErrorCheck
```

Expected: HTTP status `400`.

- [x] Stop the server process:

```powershell
Stop-Process -Id $p.Id
```

Expected: process stops.

- [x] Check worktree:

```powershell
git status --short
```

Expected: only the repair candidate plan and implementation files are modified, plus pre-existing unrelated `scripts/install-*` changes.
