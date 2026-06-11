# Remaining Screen Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining near-term screen alignment work without expanding WalnutPi into a generic IDE or unsafe automation surface.

**Architecture:** Keep each addition narrow and evidence-driven. WalnutAI receives a small static context bundle; screen sync records gain diagnostic pixel evidence; repair proposals are generated from stored records and require explicit confirmation before local file writes.

**Tech Stack:** Python WalnutAI terminal, Bun Web server JavaScript, existing screen sync records, existing SSH/local-agent delivery adapter, Markdown docs.

---

### Task 1: Record Real-Device Regression Evidence

**Files:**
- Modify: `docs/third-projects-integration-alignment.md`

- [x] Run:

```powershell
pwsh ./scripts/collect-screen-sync-evidence.ps1 -Sync -Port 4183
```

- [x] Record the latest `buildId`, `manifestHash`, `artifactHash`, `deliveryHash`, `visualMatch`, `frameSha256`, service state, and ownership summary in the alignment doc.

### Task 2: Add Minimal WalnutPi Context Bundle

**Files:**
- Create: `walnut-ai-terminal/skills/walnutpi-core.md`
- Create: `walnut-ai-terminal/skills/walnutpi-screen.md`
- Create: `walnut-ai-terminal/memory/default-memory.json`
- Modify: `walnut-ai-terminal/walnut_ai.py`
- Modify: `walnut-ai-terminal/README.md`

- [x] Add static skill files containing only non-secret WalnutPi facts and safety boundaries.
- [x] Add default memory JSON with user-facing long-term facts.
- [x] Load the files from bounded directories into `SYSTEM_PROMPT`.
- [x] Verify `python walnut-ai-terminal/walnut_ai.py /status` still works without requiring `OPENAI_API_KEY`.

### Task 3: Add Pixel Evidence Contract

**Files:**
- Modify: `web-interface/screen-delivery-adapters/ssh-local-agent.js`
- Modify: `web-interface/model-terminal-server.js`
- Modify: `web-interface/model-terminal.html`
- Modify: `README.md`
- Modify: `web-interface/README.md`

- [x] Add `screenPixelEvidence(frameEvidence, ...)` in the delivery adapter.
- [x] Attach `pixelEvidence` to `screenEvidence`.
- [x] Include pixel evidence summary fields in sync record summaries.
- [x] Add a developer diagnostics block for pixel evidence.
- [x] Document that this is metadata-only and not a Web/LVGL pixel diff.

### Task 4: Add Confirmation-Gated Repair Proposal

**Files:**
- Modify: `web-interface/model-terminal-server.js`
- Modify: `web-interface/model-terminal.html`
- Modify: `README.md`
- Modify: `web-interface/README.md`

- [x] Add `buildScreenRepairProposal(record)` that derives a proposal from stored records only.
- [x] Add `POST /api/screen/repair-proposal`.
- [x] Add `POST /api/screen/repair-apply` with confirmation phrase validation.
- [x] Add a repair proposal diagnostics block and UI button.
- [x] Keep automatic sync, SSH, build, activation, capture, and retry out of both routes.

### Task 5: Verify And Commit

**Files:**
- Modify check only expected files.

- [x] Run `git diff --check`.
- [x] Start a temporary server and verify:

```powershell
$env:PORT='4199'
$env:OPENAI_API_KEY=''
$p = Start-Process -FilePath bun -ArgumentList 'web-interface/model-terminal-server.js' -WorkingDirectory 'C:\Users\Yrd98\project\WalnutPi' -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
$record = Get-ChildItem -LiteralPath 'C:\Users\Yrd98\project\WalnutPi\web-interface\screen-sync-records' -Directory | Select-Object -First 1 -ExpandProperty Name
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4199/api/screen/ai-summary?nossh' -ContentType 'application/json' -Body (@{ buildId = $record } | ConvertTo-Json)
Stop-Process -Id $p.Id
```

- [x] Verify repair proposal and confirmation rejection with a temporary `WALNUT_SCREEN_RECORDS_DIR`.
- [x] Smoke test the Web UI with the in-app browser.
- [ ] Stage only this slice, commit, and push `yrd`.

---

## Follow-Up Progress Backlog

This backlog records the remaining implementation gaps after the first screen-sync closure. Keep each item narrow and do not expand WalnutPi into a generic IDE, public root shell, or unsafe device writer.

### Task 6: Record Remaining Gaps And Latest Device Evidence

**Files:**
- Modify: `docs/third-projects-integration-alignment.md`
- Modify: `docs/superpowers/plans/2026-06-11-remaining-screen-alignment.md`

- [x] Record the nine remaining items as a status table:
  - real LVGL preview
  - Web/device pixel consistency
  - natural-language generation
  - manifest vocabulary
  - repair loop
  - delivery adapters
  - automated regression
  - high-risk action confirmation flow
  - long-term memory productization
- [x] Record the latest real-device WalnutMusic sync evidence from `screen-20260611124330-973d015f`.
- [x] Set the next default progress slice to Web DOM screenshot -> device framebuffer PNG pixel diff.

### Task 7: Web/Device Pixel Diff V2

**Goal:** Make the current diagnostic pixel comparison more reproducible without claiming LVGL pixel-perfect equality.

**Files:**
- Modify: `web-interface/model-terminal.html`
- Modify: `web-interface/model-terminal-server.js`
- Modify: `README.md`
- Modify: `web-interface/README.md`
- Modify: `docs/third-projects-integration-alignment.md`

- [ ] Capture a stable Web preview bitmap for the current manifest, preferably from the actual preview DOM rather than a manually redrawn approximation.
- [ ] Compare that Web bitmap with the on-demand device PNG and persist the diff result as a versioned diagnostic object.
- [ ] Store dimensions, compared pixel count, mismatch ratio, thresholds, and limitations in the sync record.
- [ ] Keep this diagnostic out of `visualMatch` and out of beginner-facing success/failure states.
- [ ] Document that this is Web semantic preview vs device PNG, not true LVGL headless preview.

### Task 8: Manifest Vocabulary Expansion Plan

**Goal:** Define the next beginner-safe manifest vocabulary before changing generators or LVGL UI code.

**Files:**
- Create or modify: `docs/superpowers/specs/*screen-manifest-vocabulary*.md`
- Modify: `docs/third-projects-integration-alignment.md`

- [ ] Propose a small component vocabulary: status card, metric group, list, progress, alert, text page.
- [ ] Define which fields are user-editable through natural language.
- [ ] Define generator impact for `scripts/generate-lvgl-screen-config.py` and `.js`.
- [ ] Define LVGL runtime impact in `lvgl_app/src/main.c`.
- [ ] Keep arbitrary C/LVGL code editing out of scope.

### Task 9: Repair Loop Half-Automation

**Goal:** Finish the safe repair loop without auto-SSH, auto-build, or auto-resync.

**Files:**
- Modify: `web-interface/model-terminal-server.js`
- Modify: `web-interface/model-terminal.html`
- Modify: `README.md`
- Modify: `web-interface/README.md`

- [ ] After `repair-apply`, force the Web UI to reload the manifest and preview.
- [ ] Present the changed preview and tell the user to manually sync.
- [ ] Keep sync as a separate user action with current `manifestHash` validation.
- [ ] Write the new sync result as a separate record with fresh evidence.

### Task 10: Lightweight Regression Coverage

**Goal:** Add focused checks around the current safety gates.

**Files:**
- Prefer existing scripts or minimal API checks; do not add broad fixtures or snapshots.

- [ ] Verify stale, missing, and malformed `manifestHash` are rejected before SSH/build.
- [ ] Verify `?nossh` blocks sync, terminal, remote actions, build, activation, and capture.
- [ ] Verify sync records include artifact hash, delivery hash, frame evidence, and pixel evidence fields.
- [ ] Verify repair proposal/apply reject missing or wrong confirmation.
- [ ] Keep real-device evidence collection in `scripts/collect-screen-sync-evidence.ps1`.
