# Screen Manifest Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a constrained screen template and one-sentence manifest editing loop that keeps Web preview, LVGL build output, sync hash checks, and device evidence tied to the same `screen-manifest.json`.

**Architecture:** Keep `lvgl_app/screen-manifest.json` as source of truth. Add local Web APIs for template/intent edits, generate `lvgl_app/generated/screen_config.h` before LVGL build, and replace visible hardcoded LVGL strings with generated constants.

**Tech Stack:** Bun server JavaScript, browser DOM JavaScript, bash build script, LVGL C, JSON manifest.

---

### Task 1: Manifest Templates And Edit APIs

**Files:**
- Modify: `web-interface/model-terminal-server.js`

- [x] Add template definitions near existing screen manifest helpers.
- [x] Add shared stale-hash validation for manifest write APIs.
- [x] Add safe manifest normalization and write helper.
- [x] Add deterministic intent parsing for title, subtitle, status, metrics, and page themes.
- [x] Block template and intent writes in `?nossh` preview mode.
- [x] Add routes:
  - `GET /api/screen/templates`
  - `POST /api/screen/template`
  - `POST /api/screen/intent`

### Task 2: Web UI Controls

**Files:**
- Modify: `web-interface/model-terminal.html`

- [x] Add compact template buttons and one-sentence input inside the existing small-screen workflow.
- [x] Load templates from `GET /api/screen/templates`.
- [x] Post selected template with current `manifestHash`.
- [x] Post sentence edits with current `manifestHash`.
- [x] Refresh Web preview and diagnostics hash after successful manifest updates.
- [x] Keep sync states beginner-facing.

### Task 3: Manifest-To-C Generator

**Files:**
- Create: `scripts/generate-lvgl-screen-config.js`
- Modify: `scripts/build-lvgl-app.sh`

- [x] Read and validate `lvgl_app/screen-manifest.json`.
- [x] Escape strings into C literals.
- [x] Generate `lvgl_app/generated/screen_config.h`.
- [x] Run the generator before CMake in `scripts/build-lvgl-app.sh`.

### Task 4: LVGL Runtime Uses Generated Text

**Files:**
- Modify: `lvgl_app/src/main.c`

- [x] Include `generated/screen_config.h`.
- [x] Replace visible header title/subtitle constants.
- [x] Replace tab labels.
- [x] Replace home status and initial metric text.
- [x] Replace initial text-page defaults with generated text blocks.
- [x] Preserve live runtime updates for IP, memory, disk, uptime, AI text, and FRP.
