# Agent Native Harness And Loop Notes

## Why This Matters

`agent-native` is useful to WalnutPi for one narrow reason: it separates full
agent runtimes from app actions.

The important split:

- Harness: owns an external agent runtime session, resume state, approvals,
  transcript, cancellation, and sandbox assumptions.
- Loop: owns one WalnutPi user turn, selected steps, device actions, evidence,
  and resulting UI state.
- Action surface: one operation should power UI, agent, CLI, and later MCP.

Do not copy the full framework first. WalnutPi needs the smaller shape.

## What Agent Native Does

Agent Native has two agent integration paths.

1. Harness agents for full runtimes like Claude Code, Codex, Pi, Cursor, or
   Mastra.
2. External agent access through MCP, where outside hosts call app actions and
   can deep-link back to UI surfaces.

Its core rule is that full harnesses are not model providers. They own their
own loop, tools, session state, compaction, approvals, and sandbox behavior.
Agent Native wraps them with a run/session boundary instead of replaying chat
history into a normal model loop.

Important files from `C:/Users/Yrd98/project/agent-native`:

- `packages/core/src/agent/harness/types.ts`
  Defines `AgentHarnessAdapter`, `AgentHarnessSession`,
  `AgentHarnessEvent`, and permission modes.
- `packages/core/src/agent/harness/runner.ts`
  `startAgentHarnessRun()` creates or resumes a harness session, streams events,
  saves pending approvals, detaches, and persists opaque `resumeState`.
- `packages/core/src/agent/harness/store.ts`
  Stores `agent_harness_sessions` with harness name, thread id, run id,
  provider session id, status, resume state, workspace ref, pending approval,
  owner, and org.
- `packages/core/src/agent/run-manager.ts`
  `startRun()` owns `runId`, `threadId`, event sequence, heartbeat, abort,
  terminal event ordering, and SQL fallback.
- `packages/core/src/agent/run-loop-with-resume.ts`
  Retries a run loop after soft timeout or resumable gateway interruption,
  while avoiding duplicate side effects.
- `packages/core/src/action.ts`
  `defineAction()` creates one action entry for tools, HTTP, UI hooks, CLI, MCP,
  approval, read-only behavior, and optional UI links.
- `packages/core/src/server/action-routes.ts`
  Mounts actions as HTTP routes and emits action-change events after mutations.
- `packages/core/src/mcp/build-server.ts`
  Maps the same action registry into MCP `tools/list` and `tools/call`.
- `packages/core/src/client/use-db-sync.ts`
  Keeps browser state fresh from action/app-state changes.

## Useful Patterns To Borrow

### 1. One Action Surface

Agent Native's best idea is not the code generator. It is the contract:

```text
one action implementation
-> UI button
-> agent tool
-> HTTP endpoint
-> CLI command
-> MCP tool later
```

WalnutPi already has partial pieces:

- `web-interface/action-policy.ts`
- `web-interface/agent-actions-api.ts`
- `action-policy-manifest.json`
- `web-interface/screen-workspace-sync-workflow.ts`
- `walnut-assistant/walnut`
- `walnut-ai-terminal/walnut_ai.py`

The gap is not capability. The gap is that a full turn is not recorded as one
run with steps and evidence.

### 2. Run Timeline

Agent Native records runs as `runId + threadId + seq events + status`.
WalnutPi does not need SQL first. A JSONL ledger is enough for the first cut.

Minimum WalnutPi run shape:

```json
{
  "schema": "walnutpi.agentTurn.v2",
  "turnId": "turn-...",
  "sessionId": "web-...",
  "input": { "text": "...", "mode": "intent" },
  "status": "completed",
  "steps": [
    {
      "id": "classify",
      "kind": "intent.classify",
      "status": "completed",
      "result": {}
    },
    {
      "id": "execute",
      "kind": "action.run",
      "status": "completed",
      "result": {}
    }
  ],
  "pendingNext": null,
  "evidence": {}
}
```

This is the loop artifact. It should be readable by the UI, agent, diagnostics,
and later external MCP hosts.

Web and CLI should expose the same core trace fields even if the envelope is
different. Web returns them inside `/api/agent/turn`; WalnutAI one-shot CLI may
append one `WALNUT_AGENT_TURN_TRACE:` JSON line after the human-readable answer.
Both forms must keep:

- `schema`
- `source`
- `route.action`, `route.risk`, and `route.reason`
- `steps[]`, with action execution represented as `kind: "action.run"`
- `evidence`, reusing existing action JSON as `evidence.rawJson` when present
- `contextUsed`, including memory, retrieval, and local action output flags

Benchmark and diagnostics code should read these shared fields rather than
branching into separate Web-only and CLI-only names.

### 3. Harness Session

Harness state is different from UI session state. Agent Native stores opaque
`resumeState` separately. WalnutPi should do the same once external runtimes are
introduced.

Minimum WalnutPi harness session shape:

```json
{
  "schema": "walnutpi.agentHarnessSession.v1",
  "sessionId": "harness-...",
  "harnessName": "walnut-ai",
  "threadId": "web-session-id",
  "runId": "turn-id",
  "status": "idle",
  "resumeState": {},
  "pendingApproval": null
}
```

Do not store this in generic navigation state.

### 4. Action Change Events

Agent Native auto-refreshes UI after mutating actions. WalnutPi can borrow the
simple version:

```text
action succeeds
-> append turn step
-> persist evidence if any
-> update last action state
-> UI reads one status endpoint or receives a later poll event
```

No CRDT, no multiplayer, no React Query migration yet.

### 5. Performance Architecture, Not Just Object Shape

The first WalnutPi patches copied the useful object shape:

```text
HTTP request
-> inline classify
-> inline selected step
-> final turn artifact
```

That is enough to prove the contract, but it is not the high-performance
architecture Agent Native is actually using. The next migration target should
borrow the run-manager pattern:

```text
POST /api/agent/turn
-> enqueue run
-> return turnId quickly
-> worker executes steps
-> append seq events
-> publish events
-> UI consumes SSE
-> final artifact persists
```

The important borrowed pieces are:

- Event sequence: every turn event has `turnId`, `seq`, `kind`, `status`, and
  timestamp.
- Pub/sub: step progress is published as it happens, instead of waiting for the
  final HTTP response.
- Queue: expensive or device-writing steps run through a bounded queue.
- Resume boundary: completed steps and pending approvals are durable enough to
  avoid duplicate side effects after restart or timeout.

WalnutPi should still avoid Agent Native's full SaaS framework. The small
version is:

1. `agent-turn-events.jsonl` for append-only event history.
2. An in-process event bus for live subscribers.
3. `GET /api/agent/events?sessionId=...` as an SSE stream.
4. A one-lane queue for screen generation, screen sync, and device writes.
5. Keep read-only actions inline until they become slow enough to queue.

This is the key architecture lesson: do not only copy the `turn` and
`harnessSession` records. Copy the asynchronous run boundary that keeps UI,
long-running work, cancellation, approvals, and device writes from blocking one
HTTP request.

## WalnutPi Current Shape

Important current files:

- `web-interface/model-terminal-server.ts`
  Main Web API assembly point. It wires intent, Action Policy, screen workspace,
  remote command execution, session ledger, and metrics.
- `web-interface/walnut-agent-console.html`
  Current Agent Console orchestration. `sendPrompt()` still branches in the
  browser.
- `web-interface/agent-actions-api.ts`
  Runs `/api/action` through Action Policy, command building, remote execution,
  session logging, and metrics.
- `web-interface/action-policy.ts`
  Normalizes and resolves allowed actions.
- `web-interface/screen-workspace-sync-workflow.ts`
  Best existing example of a WalnutPi loop step: input validation, hash checks,
  delivery, evidence, structured failure.
- `web-interface/screen-delivery-adapters/ssh-local-agent.ts`
  Real-device delivery and evidence collection.
- `web-interface/screen-evidence-ledger.ts`
  Existing durable evidence pattern for screen sync.
- `walnut-assistant/walnut`
  Device Execution Surface CLI.
- `walnut-ai-terminal/walnut_ai.py`
  Device-side WalnutAI runtime and local intent/action loop.

Current key flows:

```text
Agent Console
-> POST /api/intent/classify
-> browser chooses action/screen/AI branch
```

```text
POST /api/action
-> resolveAction(executor="web")
-> build command
-> run remote command or terminal action
-> session ledger + metrics
```

```text
POST /api/screen/workspace/sync
-> createScreenWorkspaceSyncWorkflow().run()
-> validate playlist hash
-> deliverWorkspacePlaylist()
-> service/frame/capture evidence
-> screen evidence ledger
```

## Gaps

- No unified `turn/run/step/attempt` object.
- Browser owns too much loop orchestration in `sendPrompt()`.
- Intent classification is not durably tied to the action or sync result.
- Screen sync has strong evidence; ordinary `/api/action` mostly has output and
  metrics.
- Widget sync and screen workspace sync are separate write paths with different
  evidence strength.
- JS and Python action policy readers are related but not one shared contract.
- Confirmable actions are not a complete approval loop yet.

## Minimal Migration Plan

### Phase 1: Web-Side Turn Loop

Add a small Web endpoint:

```text
POST /api/agent/turn
```

It should:

1. Create `turnId`.
2. Record the user input and mode.
3. Run intent classification.
4. Select one step: action, screen generation, sync, or WalnutAI delegation.
5. Execute through existing handlers or shared internal functions.
6. Return `schema: "walnutpi.agentTurn.v2"` with `steps[]`,
   `pendingNext`, `result`, and evidence pointers.

Keep product endpoints stable. `/api/action`, `/api/intent/classify`, and
`/api/screen/workspace/sync` remain product APIs, but they are not benchmark
runner entrypoints.

### Phase 2: Action Registry Tightening

Promote these to first-class action ids:

- `intent.classify`
- `action.run`
- `screen.workspace.playlist`
- `screen.workspace.validate`
- `screen.workspace.sync`
- `screen.device.state`
- `screen.device.capture`

Use the existing Action Policy as the permission layer. Keep the surface small.

### Phase 3: Harness Session Store

Introduce a small JSONL or JSON store for harness sessions:

- `harnessName`
- `threadId`
- `runId`
- `status`
- `resumeState`
- `pendingApproval`

Start with `walnut-ai` as the only harness. Add Codex/Claude/Pi later.

### Phase 4: External Agent/MCP

Only after Phase 1 and 2 are stable:

- Expose read-only diagnostics and screen state as MCP tools.
- Add compact catalog / tool search.
- Add mutating screen sync/capture tools behind Action Policy approval.
- Add `walnut connect --client codex|claude-code|cursor` later.

## What Not To Borrow Yet

- SQL-first migration.
- CRDT/presence/multiplayer.
- Full MCP OAuth/device-code flow.
- Generated React action hooks.
- Provider API substrate.
- Multi-app workspace.

Those solve Agent Native's SaaS framework problems, not WalnutPi's current
device-control loop.

## Near-Term Patch Target

Smallest useful patch:

1. Add `web-interface/agent-turn-loop.ts`.
2. Add `web-interface/agent-turn-ledger.ts` if persistence is needed now.
3. Mount `POST /api/agent/turn` in `model-terminal-server.ts`.
4. Make the endpoint return a structured timeline for classify + selected
   action result.
5. Add one assert-based self-check script for the turn shape.

Skipped for the first patch: MCP, SQL, background SSE, external harness
runtime, and UI rewrite.
