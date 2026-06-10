# Screen Delivery Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the current SSH screen sync delivery path into a focused adapter module.

**Architecture:** Keep manifest hash validation and record persistence in `model-terminal-server.js`. Move build, artifact, activation, state/frame evidence, delivery manifest, and failure classification into `web-interface/screen-delivery-adapters/ssh-local-agent.js`.

**Tech Stack:** Bun server JavaScript, SSH command execution, WalnutPi screen CLI.

---

### Task 1: Adapter Module

**Files:**
- Create: `web-interface/screen-delivery-adapters/ssh-local-agent.js`

- [x] Create `createSshLocalAgentAdapter`.
- [x] Implement `deliver({ buildId, manifest, manifestHash })`.
- [x] Move delivery manifest creation into the adapter.
- [x] Move artifact hash validation into the adapter.
- [x] Move activation and state/frame evidence commands into the adapter.
- [x] Return command results in a stable shape for sync records.

### Task 2: Web Server Integration

**Files:**
- Modify: `web-interface/model-terminal-server.js`

- [x] Import and instantiate the `ssh-local-agent` adapter.
- [x] Keep manifest hash validation in the route.
- [x] Replace inline delivery code with adapter invocation.
- [x] Keep frame ticket registration in the route.
- [x] Preserve existing response and record fields.

### Task 3: Alignment Docs

**Files:**
- Modify: `docs/third-projects-integration-alignment.md`
- Create: `docs/superpowers/specs/2026-06-10-screen-delivery-adapter-design.md`

- [x] Document the adapter boundary.
- [x] Clarify that only the SSH/local-agent adapter exists today.
- [x] Leave USB/eMMC/image delivery as future adapters.
