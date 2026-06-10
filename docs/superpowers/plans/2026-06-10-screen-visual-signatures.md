# Screen Visual Signatures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first semantic consistency layer between Web preview intent and device screen evidence.

**Architecture:** Keep pixel diff out of scope. The SSH/local-agent adapter derives a preview signature from manifest-visible fields and a device signature from manifest hash, artifact hash, target, and framebuffer metadata, then records both hashes in `visualChecks` and developer diagnostics.

**Tech Stack:** Bun server JavaScript, browser DOM JavaScript, existing screen sync evidence.

---

### Task 1: Adapter Signatures

**Files:**
- Modify: `web-interface/screen-delivery-adapters/ssh-local-agent.js`

- [x] Build a preview signature from manifest target, title, subtitle, tabs, status, metrics, and lines.
- [x] Build a device signature from manifest hash, artifact hash, target, and frame metadata.
- [x] Add signature hashes and semantic checks to `visualChecks`.
- [x] Attach full signatures under `screenEvidence.semantic` for developer diagnostics.

### Task 2: Diagnostics Display

**Files:**
- Modify: `web-interface/model-terminal-server.js`
- Modify: `web-interface/model-terminal.html`

- [x] Include preview/device signature hashes in screen record summaries.
- [x] Show visual signatures in developer diagnostics.
- [x] Show short signature hashes in sync history when available.
- [x] Keep beginner sync states unchanged.

### Task 3: Alignment Docs

**Files:**
- Modify: `docs/third-projects-integration-alignment.md`

- [x] Clarify that current consistency is semantic signature plus structural framebuffer evidence.
- [x] Keep pixel-level Web/LVGL diff as future work.
