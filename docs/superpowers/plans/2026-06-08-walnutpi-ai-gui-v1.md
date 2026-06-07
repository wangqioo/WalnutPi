# WalnutPi AI GUI V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first concrete WalnutPi AI GUI that turns the current web console from a chat/action surface into a supervised action interface with intent, plan, risk, evidence, and takeover paths.

**Architecture:** Keep the current Bun single-file web server and single-page HTML shell, but add small shared abstractions inside `web-interface/model-terminal-server.js` for action planning and evidence metadata. The frontend remains in `web-interface/model-terminal.html`, adding structured task cards above the terminal scene. WalnutAI CLI remains the local agent backend, with only focused extensions when the web console needs structured output.

**Tech Stack:** Bun server, browser JavaScript, xterm.js, Three.js GLB scene, Python unittest for CLI behavior, Node `--check` for server syntax, Playwright/browser verification if the local server is run later.

---

## Scope

This plan implements the web-console side of the AI GUI principles.

In scope:

- `/api/actions` returns action metadata with risk, plan steps, evidence labels, and confirmation requirements.
- `/api/action` returns a structured task result: intent, plan, risk, command, target, timing, output, evidence, and failure stage.
- The web console renders task cards with plan, execution status, evidence, and takeover controls.
- High-risk actions are represented and blocked behind confirmation semantics; no high-risk remote mutation is added in V1.
- Existing terminal fallback remains available as the expert takeover layer.
- Tests cover server-side metadata construction through a small pure module.

Out of scope:

- Full visual redesign.
- Rewriting the current single-page app into a framework.
- Replacing Bun with Express or Vite.
- Deploying to the live server.
- Full LVGL/small-screen redesign.
- Voice UX.
- Adding new destructive remote actions.

## File Structure

- Create: `web-interface/action-model.js`
  - Pure action catalog helpers shared by the Bun server and tests.
  - Exports `ACTIONS`, `actionSummary`, `buildTaskStart`, `buildTaskResult`, `riskRequiresConfirmation`, and `sanitizeActionOutput`.

- Modify: `web-interface/model-terminal-server.js`
  - Import helpers from `action-model.js`.
  - Keep SSH execution and WebSocket handling here.
  - Add `SSH_PORT` support so FRP targets such as `150.158.146.192:6230` work consistently.
  - Return structured task payloads from `/api/actions` and `/api/action`.

- Modify: `web-interface/model-terminal.html`
  - Add task-card UI for intent, plan, risk, evidence, and takeover.
  - Keep current chat log, quick prompts, 3D scene, and terminal.
  - Change client action handling to render structured task states instead of only message bubbles.

- Create: `web-interface/action-model.test.mjs`
  - Node test file for pure action model helpers.

- Modify: `docs/superpowers/specs/2026-06-08-ai-gui-principles-design.md`
  - Add a short "V1 implementation mapping" section after this plan is implemented.

## Task 1: Extract Action Metadata Model

**Files:**
- Create: `web-interface/action-model.js`
- Create: `web-interface/action-model.test.mjs`
- Modify: `web-interface/model-terminal-server.js`

- [ ] **Step 1: Create the failing action model test**

Create `web-interface/action-model.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIONS,
  actionSummary,
  buildTaskStart,
  riskRequiresConfirmation,
  sanitizeActionOutput,
} from "./action-model.js";

test("status action exposes plan, evidence, and read risk", () => {
  const summary = actionSummary(ACTIONS.status, "status");

  assert.equal(summary.id, "status");
  assert.equal(summary.risk, "read");
  assert.equal(summary.requiresConfirmation, false);
  assert.deepEqual(summary.plan, [
    "确认目标设备",
    "读取系统和网络状态",
    "检查关键服务",
    "汇总异常和下一步建议",
  ]);
  assert.deepEqual(summary.evidenceLabels, ["target", "command", "output", "duration"]);
});

test("risky actions require confirmation", () => {
  assert.equal(riskRequiresConfirmation("read"), false);
  assert.equal(riskRequiresConfirmation("write-low"), false);
  assert.equal(riskRequiresConfirmation("high"), true);
});

test("task start captures intent, target, plan, risk, and timing", () => {
  const task = buildTaskStart({
    id: "status",
    action: ACTIONS.status,
    intent: "核桃派现在还好吗",
    target: "root@150.158.146.192",
    command: "walnut status",
    now: 1000,
  });

  assert.equal(task.id, "status");
  assert.equal(task.intent, "核桃派现在还好吗");
  assert.equal(task.target, "root@150.158.146.192");
  assert.equal(task.command, "walnut status");
  assert.equal(task.status, "running");
  assert.equal(task.startedAt, 1000);
  assert.equal(task.requiresConfirmation, false);
  assert.equal(task.failureStage, "");
});

test("output sanitizer truncates long command output", () => {
  const output = sanitizeActionOutput("x".repeat(30), 10);
  assert.equal(output, "xxxxxxxxxx\n\n[local] output truncated");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test web-interface/action-model.test.mjs
```

Expected:

```text
ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: Implement the action model module**

Create `web-interface/action-model.js`:

```js
export const DEFAULT_ACTION_OUTPUT_LIMIT = 24_000;

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function sanitizeActionOutput(value, limit = DEFAULT_ACTION_OUTPUT_LIMIT) {
  const text = String(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[local] output truncated`;
}

export function riskRequiresConfirmation(risk) {
  return risk === "high";
}

export const ACTIONS = {
  status: {
    title: "查状态",
    risk: "read",
    mode: "remote",
    command: "walnut status",
    reply: "我会读取系统、网络、存储、服务和音频状态。",
    intentLabel: "设备健康检查",
    plan: ["确认目标设备", "读取系统和网络状态", "检查关键服务", "汇总异常和下一步建议"],
    evidenceLabels: ["target", "command", "output", "duration"],
    timeoutMs: 20_000,
  },
  snapshot: {
    title: "设备快照",
    risk: "read",
    mode: "remote",
    command: [
      "hostname",
      "uname -a",
      "cat /etc/WalnutPi-release 2>/dev/null || true",
      "cat /etc/os-release 2>/dev/null || true",
      "sed -n '1,160p' /boot/config.txt 2>/dev/null || true",
      "gpio pins 2>/dev/null || true",
      "set-device status 2>/dev/null || true",
    ].join("; "),
    reply: "我会先做只读设备快照，确认板子、系统、引脚和 overlay 状态。",
    intentLabel: "设备快照",
    plan: ["确认目标设备", "读取系统版本", "读取启动配置", "只读检查引脚和 overlay"],
    evidenceLabels: ["target", "command", "output", "duration"],
    timeoutMs: 20_000,
  },
  network: {
    title: "网络检查",
    risk: "read",
    mode: "remote",
    command: [
      "ip -br addr",
      "ip route show default",
      "nmcli -t -f ACTIVE,SSID,SIGNAL dev wifi 2>/dev/null || true",
    ].join("; "),
    reply: "我会检查 IP、默认路由和 Wi-Fi 状态。",
    intentLabel: "网络检查",
    plan: ["确认目标设备", "读取 IP 地址", "检查默认路由", "读取 Wi-Fi 状态"],
    evidenceLabels: ["target", "command", "output", "duration"],
    timeoutMs: 12_000,
  },
  gpio: {
    title: "GPIO 检查",
    risk: "read",
    mode: "remote",
    command: [
      "gpio pins",
      "gpio pin i2c 2>/dev/null || true",
      "gpio pin spi 2>/dev/null || true",
      "gpio pin uart 2>/dev/null || true",
      "gpio pin pwm 2>/dev/null || true",
      "set-device status 2>/dev/null || true",
      "sed -n '1,160p' /boot/config.txt 2>/dev/null || true",
    ].join("; "),
    reply: "我会只读检查引脚、总线和 overlay，避免误占用 GPIO。",
    intentLabel: "GPIO 只读检查",
    plan: ["确认目标设备", "读取引脚表", "读取总线占用", "读取 overlay 配置"],
    evidenceLabels: ["target", "command", "output", "duration"],
    timeoutMs: 20_000,
  },
  notes: {
    title: "今天笔记",
    risk: "read",
    mode: "remote",
    command: "walnut today",
    reply: "我会读取今天保存的核桃派笔记。",
    intentLabel: "读取今天笔记",
    plan: ["确认目标设备", "读取本地笔记", "展示结果"],
    evidenceLabels: ["target", "command", "output", "duration"],
    timeoutMs: 10_000,
  },
  note: {
    title: "记录笔记",
    risk: "write-low",
    mode: "remote",
    buildCommand(body) {
      const text = String(body.text || "").trim();
      if (!text) throw new Error("缺少要记录的内容。");
      return `walnut note ${shellQuote(text)}`;
    },
    reply: "我会把这句话写进核桃派本地笔记。",
    intentLabel: "记录本地笔记",
    plan: ["确认目标设备", "写入本地笔记", "返回保存结果"],
    evidenceLabels: ["target", "command", "output", "duration"],
    timeoutMs: 10_000,
  },
  ai: {
    title: "WalnutAI Agent",
    risk: "read",
    mode: "remote",
    buildCommand(body) {
      const text = String(body.text || "").trim();
      if (!text) throw new Error("缺少要问 WalnutAI 的内容。");
      return `walnut ai ${shellQuote(text)}`;
    },
    reply: "我会把自然语言交给 WalnutAI，由它判断是否需要先执行本地安全动作。",
    intentLabel: "自然语言本地 agent",
    plan: ["识别用户意图", "判断是否需要本地安全动作", "执行或转交云端 AI", "总结结果"],
    evidenceLabels: ["target", "command", "output", "duration"],
    timeoutMs: 120_000,
  },
  video: {
    title: "彩色视频",
    risk: "interactive",
    mode: "terminal",
    command: "walnut video color",
    reply: "我会直接运行彩色 ASCII 视频命令，不打开菜单。",
    intentLabel: "终端交互演示",
    plan: ["确认终端连接", "把命令发送到可接管终端", "由用户在终端中观察和停止"],
    evidenceLabels: ["target", "command", "terminal"],
  },
};

export function actionSummary(action, id) {
  return {
    id,
    title: action.title,
    risk: action.risk,
    mode: action.mode,
    reply: action.reply,
    intentLabel: action.intentLabel,
    plan: action.plan,
    evidenceLabels: action.evidenceLabels,
    requiresConfirmation: riskRequiresConfirmation(action.risk),
  };
}

export function buildTaskStart({ id, action, intent, target, command, now = Date.now() }) {
  return {
    ...actionSummary(action, id),
    intent: intent || action.intentLabel || action.title,
    target,
    command,
    status: "running",
    startedAt: now,
    finishedAt: null,
    durationMs: null,
    output: "",
    code: null,
    failureStage: "",
  };
}

export function buildTaskResult(task, result, now = Date.now()) {
  const durationMs = Math.max(0, now - task.startedAt);
  return {
    ...task,
    status: result.ok ? "completed" : "failed",
    finishedAt: now,
    durationMs,
    code: result.code,
    output: result.output,
    failureStage: result.ok ? "" : result.failureStage || "execute",
  };
}
```

- [ ] **Step 4: Run the action model test and verify it passes**

Run:

```bash
node --test web-interface/action-model.test.mjs
```

Expected:

```text
pass
```

- [ ] **Step 5: Refactor the server to import the model**

Modify the top of `web-interface/model-terminal-server.js` to replace local `ACTION_OUTPUT_LIMIT`, `shellQuote`, `limitedOutput`, `ACTIONS`, and `actionSummary` definitions with:

```js
import { spawn } from "node:child_process";

import {
  ACTIONS,
  actionSummary,
  buildTaskResult,
  buildTaskStart,
  sanitizeActionOutput,
  shellQuote,
} from "./action-model.js";
```

Add port-aware target constants after the existing SSH environment constants:

```js
const SSH_PORT = String(process.env.SSH_PORT || "22");

function sshTarget() {
  return `${SSH_USER}@${SSH_HOST}`;
}

function displayTarget() {
  return `${SSH_USER}@${SSH_HOST}:${SSH_PORT}`;
}
```

In both `runRemote` and `startSsh`, replace:

```js
const target = `${SSH_USER}@${SSH_HOST}`;
```

with:

```js
const target = sshTarget();
```

In both SSH spawn argument arrays, add the port arguments before `target`:

```js
"-p",
SSH_PORT,
target,
```

In `runRemote`, replace:

```js
output: limitedOutput(`${stdout}${stderr}\n[local] action timed out`.trim()),
```

with:

```js
output: sanitizeActionOutput(`${stdout}${stderr}\n[local] action timed out`.trim()),
failureStage: "timeout",
```

Replace:

```js
resolve({ ok: false, code: null, output: `[local] ${error.message}` });
```

with:

```js
resolve({ ok: false, code: null, output: `[local] ${error.message}`, failureStage: "spawn" });
```

Replace:

```js
const output = limitedOutput(`${stdout}${stderr}`.trim() || "ok");
resolve({ ok: code === 0, code, output });
```

with:

```js
const output = sanitizeActionOutput(`${stdout}${stderr}`.trim() || "ok");
resolve({ ok: code === 0, code, output, failureStage: code === 0 ? "" : "execute" });
```

In `handleAction`, before executing the action, create:

```js
const target = displayTarget();
const intent = String(body.intent || body.text || action.intentLabel || action.title).trim();
const task = buildTaskStart({ id, action, intent, target, command });
```

In `/api/actions`, replace:

```js
target: `${SSH_USER}@${SSH_HOST}`,
```

with:

```js
target: displayTarget(),
```

For terminal-mode actions, return:

```js
return json({
  ok: true,
  task: {
    ...task,
    status: "handoff",
    finishedAt: Date.now(),
    durationMs: 0,
  },
});
```

For remote actions, replace the current result JSON with:

```js
const result = await runRemote(command, action.timeoutMs);
const completedTask = buildTaskResult(task, result);
return json({
  ok: result.ok,
  task: completedTask,
});
```

- [ ] **Step 6: Run server syntax checks**

Run:

```bash
node --check web-interface/action-model.js
node --check web-interface/model-terminal-server.js
node --test web-interface/action-model.test.mjs
```

Expected:

```text
node --check commands print no errors
node --test reports all tests passing
```

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add web-interface/action-model.js web-interface/action-model.test.mjs web-interface/model-terminal-server.js
git commit -m "Add structured action metadata for AI GUI"
```

## Task 2: Render Supervised Task Cards in the Web Console

**Files:**
- Modify: `web-interface/model-terminal.html`

- [ ] **Step 1: Add task card CSS**

In `web-interface/model-terminal.html`, inside the existing `<style>` block after `.output-block`, add:

```css
.task-card {
  display: grid;
  gap: 10px;
  max-width: 96%;
  border: 1px solid rgba(120, 200, 193, 0.28);
  border-radius: 8px;
  padding: 11px;
  background: rgba(13, 20, 19, 0.78);
}

.task-card.is-failed {
  border-color: rgba(214, 107, 101, 0.42);
}

.task-card.is-completed {
  border-color: rgba(117, 196, 134, 0.38);
}

.task-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.task-title {
  margin: 0;
  color: var(--paper);
  font-size: 13px;
  font-weight: 720;
}

.task-intent {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.risk-badge {
  flex: 0 0 auto;
  border: 1px solid rgba(240, 239, 231, 0.16);
  border-radius: 999px;
  padding: 4px 8px;
  color: var(--paper);
  font-size: 11px;
}

.risk-badge[data-risk="read"] {
  color: var(--green);
}

.risk-badge[data-risk="write-low"],
.risk-badge[data-risk="interactive"] {
  color: var(--gold);
}

.risk-badge[data-risk="high"] {
  color: var(--red);
}

.task-plan {
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.task-plan li {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 6px;
  color: #d8e7dc;
  font-size: 12px;
  line-height: 1.35;
}

.step-dot {
  display: grid;
  width: 16px;
  height: 16px;
  place-items: center;
  border: 1px solid rgba(240, 239, 231, 0.2);
  border-radius: 50%;
  color: var(--muted);
  font-size: 10px;
}

.task-evidence {
  display: grid;
  gap: 6px;
  border-top: 1px solid rgba(240, 239, 231, 0.11);
  padding-top: 8px;
}

.evidence-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
  color: var(--muted);
  font-size: 11px;
}

.evidence-row strong {
  color: #d8e7dc;
  font-weight: 620;
  overflow-wrap: anywhere;
}

.task-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.task-button {
  min-height: 30px;
  border: 1px solid rgba(240, 239, 231, 0.14);
  border-radius: 6px;
  padding: 0 9px;
  background: rgba(240, 239, 231, 0.07);
  color: var(--paper);
  font-size: 12px;
}

.task-button:hover,
.task-button:focus-visible {
  border-color: rgba(208, 160, 68, 0.7);
  outline: none;
}
```

- [ ] **Step 2: Add task rendering helpers**

In the existing `<script type="module">` block, find `function addMessage(...)` and add these functions after it:

```js
function riskLabel(risk) {
  const labels = {
    read: "只读",
    "write-low": "低风险写入",
    interactive: "终端交互",
    high: "高风险",
  };
  return labels[risk] || risk || "未知";
}

function statusLabel(status) {
  const labels = {
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    handoff: "已交给终端",
  };
  return labels[status] || status || "未知";
}

function addEvidence(container, label, value) {
  if (!value) return;
  const row = document.createElement("div");
  row.className = "evidence-row";

  const labelView = document.createElement("span");
  labelView.textContent = label;

  const valueView = document.createElement("strong");
  valueView.textContent = value;

  row.append(labelView, valueView);
  container.append(row);
}

function addTaskCard(task) {
  const card = document.createElement("article");
  card.className = `task-card is-${task.status || "running"}`;

  const top = document.createElement("div");
  top.className = "task-top";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.className = "task-title";
  title.textContent = `${task.title || "任务"} · ${statusLabel(task.status)}`;

  const intent = document.createElement("p");
  intent.className = "task-intent";
  intent.textContent = task.intent || task.intentLabel || "";

  titleWrap.append(title, intent);

  const risk = document.createElement("span");
  risk.className = "risk-badge";
  risk.dataset.risk = task.risk || "";
  risk.textContent = riskLabel(task.risk);

  top.append(titleWrap, risk);
  card.append(top);

  const plan = document.createElement("ol");
  plan.className = "task-plan";
  for (const [index, step] of (task.plan || []).entries()) {
    const item = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "step-dot";
    dot.textContent = String(index + 1);
    const text = document.createElement("span");
    text.textContent = step;
    item.append(dot, text);
    plan.append(item);
  }
  card.append(plan);

  const evidence = document.createElement("div");
  evidence.className = "task-evidence";
  addEvidence(evidence, "目标", task.target);
  addEvidence(evidence, "命令", task.command);
  addEvidence(evidence, "耗时", typeof task.durationMs === "number" ? `${task.durationMs} ms` : "");
  addEvidence(evidence, "阶段", task.failureStage);
  if (task.output) {
    const output = document.createElement("pre");
    output.className = "output-block";
    output.textContent = task.output;
    evidence.append(output);
  }
  card.append(evidence);

  const actions = document.createElement("div");
  actions.className = "task-actions";

  const terminalButton = document.createElement("button");
  terminalButton.className = "task-button";
  terminalButton.type = "button";
  terminalButton.textContent = "接管终端";
  terminalButton.addEventListener("click", () => {
    connectTerminal();
    term.focus();
  });
  actions.append(terminalButton);

  if (task.command) {
    const copyButton = document.createElement("button");
    copyButton.className = "task-button";
    copyButton.type = "button";
    copyButton.textContent = "复制命令";
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard?.writeText(task.command);
    });
    actions.append(copyButton);
  }

  card.append(actions);
  chatLog.append(card);
  chatLog.scrollTop = chatLog.scrollHeight;
}
```

- [ ] **Step 3: Render task payloads from `/api/action`**

In `runAction(action, userLabel = "")`, replace the final result handling:

```js
if (result.mode === "terminal") {
  addMessage("assistant", result.reply, { command: result.command });
  sendTerminalCommand(result.command);
  return;
}

addMessage("assistant", result.ok ? "动作完成。" : "动作返回异常。", {
  command: result.command,
  output: result.output,
  error: !result.ok,
});
writeTerminalBlock(result);
```

with:

```js
if (result.task) {
  addTaskCard(result.task);
  if (result.task.status === "handoff" && result.task.command) {
    sendTerminalCommand(result.task.command);
  } else {
    writeTerminalBlock({
      id: result.task.id,
      title: result.task.title,
      command: result.task.command,
      output: result.task.output,
      ok: result.ok,
    });
  }
  return;
}

addMessage("assistant", result.ok ? "动作完成。" : "动作返回异常。", {
  command: result.command,
  output: result.output,
  error: !result.ok,
});
```

- [ ] **Step 4: Keep compatibility with `/api/actions`**

In the frontend action-loading code, keep using action summaries from `/api/actions`. If no explicit load function exists, add this near startup before the initial `connectTerminal()` call:

```js
async function loadActionCatalog() {
  try {
    const response = await fetch("/api/actions");
    const catalog = await response.json();
    if (catalog.target) {
      targetLabel.textContent = catalog.target;
    }
  } catch {
    // The page can still operate with static prompt routing.
  }
}

loadActionCatalog();
```

Use the existing target label element name from the page. If it is not named `targetLabel`, define it with:

```js
const targetLabel = document.querySelector("[data-target-label]");
```

and add `data-target-label` to the target `<strong>` element in the header.

- [ ] **Step 5: Run syntax checks**

Run:

```bash
node --check web-interface/model-terminal-server.js
node --test web-interface/action-model.test.mjs
```

Expected:

```text
node --check prints no errors
node --test reports all tests passing
```

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add web-interface/model-terminal.html
git commit -m "Render supervised AI GUI task cards"
```

## Task 3: Add Risk Confirmation Semantics

**Files:**
- Modify: `web-interface/action-model.js`
- Modify: `web-interface/action-model.test.mjs`
- Modify: `web-interface/model-terminal-server.js`
- Modify: `web-interface/model-terminal.html`

- [ ] **Step 1: Add failing tests for high-risk confirmation**

Append to `web-interface/action-model.test.mjs`:

```js
test("high-risk reboot action is described but blocked by default", () => {
  const summary = actionSummary(ACTIONS.reboot, "reboot");

  assert.equal(summary.risk, "high");
  assert.equal(summary.requiresConfirmation, true);
  assert.deepEqual(summary.plan, [
    "解释重启会中断当前服务和连接",
    "等待用户明确确认",
    "确认后才执行重启命令",
  ]);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test web-interface/action-model.test.mjs
```

Expected:

```text
TypeError
```

because `ACTIONS.reboot` does not exist yet.

- [ ] **Step 3: Add a described high-risk action**

In `web-interface/action-model.js`, add this action to `ACTIONS`:

```js
reboot: {
  title: "重启设备",
  risk: "high",
  mode: "blocked",
  command: "reboot",
  reply: "重启会中断当前连接和服务，必须确认后才允许执行。",
  intentLabel: "高风险重启请求",
  plan: ["解释重启会中断当前服务和连接", "等待用户明确确认", "确认后才执行重启命令"],
  evidenceLabels: ["target", "command", "confirmation"],
},
```

- [ ] **Step 4: Block high-risk actions in the server**

In `handleAction` in `web-interface/model-terminal-server.js`, after building `task`, add:

```js
if (action.mode === "blocked" || task.requiresConfirmation) {
  return json({
    ok: false,
    task: {
      ...task,
      status: "needs-confirmation",
      finishedAt: Date.now(),
      durationMs: 0,
      failureStage: "confirmation",
      output: "这个动作会改变设备状态。V1 只展示风险和计划，不直接执行高风险命令。",
    },
  }, 409);
}
```

Update `statusLabel` in `model-terminal.html`:

```js
needs-confirmation: "等待确认",
```

In CSS, add:

```css
.task-card.is-needs-confirmation {
  border-color: rgba(208, 160, 68, 0.5);
}
```

- [ ] **Step 5: Route obvious reboot prompts to the blocked action**

In `actionForText(text)` in `web-interface/model-terminal.html`, before the default AI action, add:

```js
if (/重启|reboot|restart device|关机|shutdown/.test(lower)) {
  return {
    id: "reboot",
    reply: "这是高风险操作。我会先展示风险和计划，不会直接执行。",
  };
}
```

- [ ] **Step 6: Run checks**

Run:

```bash
node --check web-interface/action-model.js
node --check web-interface/model-terminal-server.js
node --test web-interface/action-model.test.mjs
```

Expected:

```text
all checks pass
```

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add web-interface/action-model.js web-interface/action-model.test.mjs web-interface/model-terminal-server.js web-interface/model-terminal.html
git commit -m "Add high-risk action confirmation semantics"
```

## Task 4: Add a Small-Screen Status Handoff Hook

**Files:**
- Modify: `web-interface/model-terminal-server.js`
- Modify: `web-interface/action-model.test.mjs`
- Modify: `web-interface/action-model.js`

- [ ] **Step 1: Add helper test for small-screen summary text**

Append to `web-interface/action-model.test.mjs`:

```js
import { buildScreenSummary } from "./action-model.js";

test("screen summary compresses task state for small display", () => {
  const summary = buildScreenSummary({
    title: "查状态",
    status: "completed",
    risk: "read",
    intent: "核桃派现在还好吗",
  });

  assert.equal(summary, "查状态 completed read 核桃派现在还好吗");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test web-interface/action-model.test.mjs
```

Expected:

```text
SyntaxError or missing export for buildScreenSummary
```

- [ ] **Step 3: Implement screen summary helper**

In `web-interface/action-model.js`, add:

```js
export function buildScreenSummary(task) {
  return [task.title, task.status, task.risk, task.intent]
    .filter(Boolean)
    .join(" ")
    .slice(0, 120);
}
```

- [ ] **Step 4: Update server to send completed task summaries to Walnut screen**

In `web-interface/model-terminal-server.js`, update the import:

```js
buildScreenSummary,
```

Add this helper after `runRemote`:

```js
async function updateWalnutScreen(summary) {
  if (!summary) return;
  await runRemote(`walnut screen ai ${shellQuote(summary)}`, 8_000);
}
```

After `const completedTask = buildTaskResult(task, result);`, add:

```js
await updateWalnutScreen(buildScreenSummary(completedTask));
```

Do not update the screen for `needs-confirmation` blocked tasks in V1.

- [ ] **Step 5: Run checks**

Run:

```bash
node --check web-interface/action-model.js
node --check web-interface/model-terminal-server.js
node --test web-interface/action-model.test.mjs
```

Expected:

```text
all checks pass
```

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add web-interface/action-model.js web-interface/action-model.test.mjs web-interface/model-terminal-server.js
git commit -m "Send AI GUI task summaries to Walnut screen"
```

## Task 5: Verification and Documentation Mapping

**Files:**
- Modify: `docs/superpowers/specs/2026-06-08-ai-gui-principles-design.md`
- Modify: `web-interface/README.md`

- [ ] **Step 1: Add web-console V1 mapping to the principles spec**

Append this section before `## Out of Scope` in `docs/superpowers/specs/2026-06-08-ai-gui-principles-design.md`:

```markdown
## V1 Implementation Mapping

WalnutPi AI GUI V1 maps these principles to the web console first:

- Intent: natural-language prompts are routed to allowed local actions or WalnutAI.
- Plan: every action summary includes visible plan steps.
- Risk: action metadata labels read, write-low, interactive, and high-risk actions.
- Evidence: task results include target, command, output, duration, and failure stage.
- Takeover: the live terminal remains available from every task card.
- Multi-surface: completed task summaries can be sent to the WalnutPi small screen.

V1 deliberately blocks high-risk actions at the GUI layer instead of executing them. This keeps the system honest while the confirmation model matures.
```

- [ ] **Step 2: Update web-interface README**

Append this section to `web-interface/README.md`:

```markdown
## V1 Supervised Action Model

The web console should render every action as a task, not only as a chat message.

Each task includes:

- interpreted user intent
- visible plan steps
- risk label
- target device
- command or action
- output evidence
- duration and failure stage
- terminal takeover path

High-risk actions are represented as blocked tasks in V1. The console can explain the risk and show the intended command, but it must not execute destructive commands until a stronger confirmation and rollback model exists.
```

- [ ] **Step 3: Run full checks**

Run:

```bash
node --check web-interface/action-model.js
node --check web-interface/model-terminal-server.js
node --check web-interface/ssh-terminal-server.js
node --test web-interface/action-model.test.mjs
python3 -m py_compile walnut-ai-terminal/walnut_ai.py walnut-assistant/walnut
python3 -m unittest discover -s tests
```

Expected:

```text
node --check commands print no errors
node --test reports all tests passing
python py_compile prints no errors
unittest reports 27 tests passing
```

- [ ] **Step 4: Commit Task 5**

Run:

```bash
git add docs/superpowers/specs/2026-06-08-ai-gui-principles-design.md web-interface/README.md
git commit -m "Document WalnutPi AI GUI V1 mapping"
```

## Final Verification

- [ ] **Step 1: Run all non-browser verification**

Run:

```bash
node --check web-interface/action-model.js
node --check web-interface/model-terminal-server.js
node --check web-interface/ssh-terminal-server.js
node --test web-interface/action-model.test.mjs
python3 -m py_compile walnut-ai-terminal/walnut_ai.py walnut-assistant/walnut
python3 -m unittest discover -s tests
```

Expected:

```text
all commands pass
```

- [ ] **Step 2: Optional manual browser verification**

If Bun is available and the live board credentials are configured, run:

```bash
cd web-interface
SSH_HOST=150.158.146.192 SSH_PORT=6230 SSH_USER=root SSH_PASSWORD='<password>' bun model-terminal-server.js
```

Open:

```text
http://127.0.0.1:4173/
```

Verify:

- "核桃派现在还好吗" renders a task card.
- The task card shows plan steps.
- The task card shows risk as read-only.
- The task card shows target, command, output, and duration.
- "重启核桃派" renders a needs-confirmation task and does not reboot the board.
- "接管终端" focuses the terminal.

- [ ] **Step 3: Push when approved**

Run:

```bash
git status --short --branch
git push origin main
```

Expected:

```text
main is pushed to origin/main
```

## Self-Review

Spec coverage:

- Intent-first GUI: covered by Task 2 task cards and Task 1 action metadata.
- Plan visibility: covered by Task 1 `plan` metadata and Task 2 rendering.
- Risk grading: covered by Task 1 risk metadata and Task 3 high-risk blocked action.
- Evidence: covered by Task 1 task result payload and Task 2 evidence rendering.
- Takeover path: covered by Task 2 terminal takeover button.
- Multiple surfaces: covered by Task 4 small-screen summary hook.
- Documentation mapping: covered by Task 5.

Scope check:

- This is one focused implementation plan for the web-console V1. It intentionally does not redesign LVGL, voice, deployment, or the full visual system.

Placeholder scan:

- No unresolved placeholders are present.
- Every task includes exact files, exact code, exact commands, and expected results.
