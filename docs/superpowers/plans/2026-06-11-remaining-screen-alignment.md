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
