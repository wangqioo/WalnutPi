# Screen Repair Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a narrow first repair loop for failed screen syncs by turning failure stages and evidence into readable repair hints.

**Architecture:** Keep repair hints read-only. The server derives a `repairHint` from stored sync records and exposes it through a small API; the Web UI shows a failure-only button and panel without applying code changes or retrying sync automatically.

**Tech Stack:** Bun server JavaScript, browser DOM JavaScript, existing screen sync records.

---

### Task 1: Repair Hint Model And API

**Files:**
- Modify: `web-interface/model-terminal-server.js`

- [x] Add `buildScreenRepairHint(record)` for `manifest`, `build`, `artifact`, `activate`, `evidence`, `frame`, `visual`, `delivery`, `preview`, and unknown failures.
- [x] Save `repairHint` into failed screen sync records.
- [x] Include repair hint summary in record summaries.
- [x] Add `POST /api/screen/repair-plan` to read a stored record and return a repair hint.

### Task 2: Web Repair Panel

**Files:**
- Modify: `web-interface/model-terminal.html`

- [x] Add a hidden failure-only repair panel below the sync controls.
- [x] Show the panel when sync fails or a failed history record is opened.
- [x] Render beginner reason and suggested next actions.
- [x] Fetch `/api/screen/repair-plan` when the user clicks the repair button.
- [x] Keep the flow read-only with no automatic edits or retries.

### Task 3: Alignment Docs

**Files:**
- Modify: `docs/third-projects-integration-alignment.md`

- [x] Document that the first repair loop is read-only repair hints.
- [x] Leave auto-fix, code edits, and retry orchestration for later.
