# Screen Repair Candidate Design

## Goal

Extend the existing read-only screen sync repair hints into a first repair-candidate loop:

```text
Screen sync fails
-> User opens repair panel
-> Web API reads the stored sync record
-> Server returns a structured repair candidate
-> UI shows what can be tried next and what evidence supports it
```

This slice does not apply patches, edit source files, retry sync, restart services, or run new device commands. It prepares the structure needed for a later confirmed repair flow while keeping the current safety boundary intact.

## Scope

In scope:

- A new `POST /api/screen/repair-candidate` route in `web-interface/model-terminal-server.js`.
- A `buildScreenRepairCandidate(record)` function derived from stored sync evidence.
- A browser repair panel update that shows candidate details after a failed sync or failed history record.
- Candidate output for existing failure stages: `manifest`, `build`, `artifact`, `activate`, `evidence`, `frame`, `visual`, `delivery`, `preview`, and unknown failures.
- Backward compatibility with existing `repairHint`, `/api/screen/repair-plan`, and stored sync records.

Out of scope:

- Applying file changes.
- Generating source-code patches.
- Cloud AI patch generation.
- Automatic retry or resync.
- New delivery adapters.
- High-risk confirmation and execution flows.
- Running additional SSH, build, capture, or activation commands from the repair-candidate route.

## User Experience

When sync fails, the existing repair panel remains beginner-facing:

```text
同步失败
查看修复候选方案
```

Clicking the button fetches the candidate and shows:

- A short beginner summary.
- Why the system thinks this is the likely issue.
- Proposed next actions.
- Whether the candidate can be applied automatically.

For this first slice, every candidate says:

```text
需要确认
不会自动修改文件
不会自动连接核桃派
不会自动重新同步
```

Developer diagnostics continue to show raw `repairHint`, `repairCandidate`, command output, hashes, delivery manifest, and screen evidence.

## Candidate Model

The API returns:

```json
{
  "ok": true,
  "buildId": "screen-...",
  "repairCandidate": {
    "schema": "walnutpi.screenRepairCandidate.v1",
    "buildId": "screen-...",
    "stage": "frame",
    "confidence": "medium",
    "beginnerSummary": "无法读取到有效的小屏画面证据。",
    "developerDiagnosis": "sudo -n walnut screen frame did not return valid frame metadata.",
    "proposedActions": [
      {
        "kind": "manual-check",
        "label": "检查 framebuffer 证据命令",
        "detail": "在设备上运行 sudo -n walnut screen frame，确认返回 JSON 元数据。"
      }
    ],
    "requiresConfirmation": true,
    "canAutoApply": false,
    "autoApplyReason": "第一版只生成修复候选方案，不自动修改文件或触发设备动作。"
  }
}
```

`confidence` is one of:

- `high`: The stored failure stage and command output point to one narrow cause.
- `medium`: The failure stage is clear, but the root cause still needs a manual check.
- `low`: The record is incomplete or the failure stage is unknown.

`proposedActions.kind` is one of:

- `manual-check`: User or developer should inspect a fact.
- `local-edit-plan`: A future confirmed local file edit could fix the issue.
- `device-check`: A future confirmed device-side check could collect more evidence.
- `refresh-and-retry`: The user should refresh preview and run sync again manually.

No first-version action is executable through this API.

## Candidate Rules

The candidate builder maps known stages to structured next steps:

- `preview`: Explain that `?nossh` is preview-only and syncing requires removing the query flag.
- `manifest`: Recommend refreshing the manifest, checking JSON validity, and preserving current `manifestHash` behavior.
- `build`: Point to the first build error and recommend checking generated config and `scripts/build-lvgl-app.sh`.
- `artifact`: Recommend checking `build/lvgl_app/walnut-lvgl-screen`, executable bit, and remote project root.
- `activate`: Recommend checking `walnut-screen.service` installation and `sudo -n walnut screen start`.
- `evidence`: Recommend checking `walnut screen state` output and service activity.
- `frame`: Recommend checking `/dev/fb0`, `sudo -n walnut screen frame`, and framebuffer ownership/permissions.
- `visual`: Recommend checking target dimensions, RGB565 format, byte length, and blank-frame status.
- `delivery`: Recommend checking adapter exception output, SSH credentials, `sshpass`, and adapter parameters.
- Unknown: Preserve the command output and recommend manual diagnosis from the earliest failing command block.

Each rule uses only the persisted record. It must not call `runRemote`, read device state, build the app, or inspect files outside the existing record.

## Backend API

Add:

```text
POST /api/screen/repair-candidate
```

Request:

```json
{
  "buildId": "screen-..."
}
```

Behavior:

- Validate `buildId` with the same safe record ID rules as existing record APIs.
- Load the stored screen sync record.
- Reject missing or unknown records with the same beginner tone used by `/api/screen/repair-plan`.
- Return a candidate for both failed and successful records.
- For successful records, return a low-action candidate that says no repair is needed.

The existing `/api/screen/repair-plan` remains available and can keep returning `repairHint`. The new route is the structured candidate endpoint for the next repair loop.

## Frontend Changes

Update `web-interface/model-terminal.html`:

- Rename the repair button text after failure to `查看修复候选方案`.
- Fetch `/api/screen/repair-candidate` when clicked.
- Render candidate summary and proposed actions in the existing repair panel.
- Keep developer JSON output for both `repairHint` and `repairCandidate`.
- Do not add an apply button in this slice.

The UI may keep showing existing `repairHint` immediately after sync failure, then enrich the panel after the candidate API returns.

## Safety

The route is read-only:

- No SSH.
- No build.
- No activation.
- No framebuffer capture.
- No file writes.
- No source patch generation.
- No sync retry.

Every candidate sets `requiresConfirmation: true` and `canAutoApply: false`. This prevents the first implementation from implying that a suggested action has already been performed.

`?nossh` remains preview-only. Because this route reads local sync records only, it can return candidates in preview mode without connecting to the device.

## Error Handling

- Invalid JSON body: return `400`.
- Invalid `buildId`: return `400` with beginner text.
- Missing record: return `404`.
- Corrupt record JSON: return `500` with a diagnostic message.
- Candidate generation exception: return `500` and do not modify the record.

Candidate generation should be deterministic. It should not depend on current time except for optional `generatedAt`.

## Success Criteria

- Failed sync records can return a structured repair candidate.
- Existing repair hints still work.
- Existing sync records and history views remain readable.
- `?nossh` does not trigger device actions.
- The repair candidate route does not call SSH, build, activation, frame, or capture paths.
- The UI clearly communicates that no automatic repair is applied.
- Developer diagnostics expose the candidate JSON for later implementation work.

## Tradeoffs

This design deliberately stops before applying changes. That means the user still has to take the next step manually, but the system gains a stable model for explaining and reviewing repairs without creating unsafe hidden behavior.

The next slice can add confirmed local edits for narrow manifest failures. Device-side checks, service restarts, or resync should wait for a separate high-risk confirmation design.
