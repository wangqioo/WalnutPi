# Agent Platform Refactor Gap Matrix

Date: 2026-06-26

This note records the current gap between the present repo state and
`docs/agent-platform-refactor-spec.md`.

It is a working map, not a replacement spec.

## Priority Key

- `P0`: must change before the new platform stack can carry the product path
- `P1`: already started, but the boundary or ownership still needs to move
- `P2`: follow after the main platform path is stable

## Gap Matrix

| Spec target | Current state | Main delta | Priority |
|---|---|---|---|
| `Mastra Runtime` for agent routing and workflows | `/api/agent/turn` now uses `web-interface/agent-platform-turn-route.ts` for request/ledger/projection only, then dispatches supported structured capabilities through `web-interface/platform/mastra/agent-turn-workflows.ts` and `@mastra/mcp`; screen read/capture/sync/render/write, memory session/preference/sensitive-skip, device reads, note write, and `policy.action.prepare`/`policy.action.commit` are registered Mastra/MCP capabilities. `web-interface/platform/mastra/storage.ts` binds the Mastra registry to `@mastra/pg` `PostgresStore` on the control-plane database, and `verify:platform` asserts the Mastra-managed Postgres tables exist | Expand Mastra-owned workflow coverage into remaining approved action flows after the approval UI exists | `P0` |
| `OPA` policy decision before command construction | `web-interface/platform/policy/opa-boundary.ts` runs OPA CLI for the active tool-dispatch policy gate; read actions may use the boundary's explicit OPA-unavailable degraded decision, while write-low and high-risk actions fail closed; OPA now requires an authenticated owner role plus matching org/device binding before allowing read or approved confirmable actions; screen sync/write tools are policy-gated before DSL execution; `policy.action.prepare` records pending/refused decisions without command construction, and `policy.action.commit` requires decision id, normalized params hash, subject match including org/device binding, approval token, and a fresh OPA allow decision. Approval records persist through `action_approval_records`; the Next/Tailwind console now has an approval queue for prepared catalog actions and commits only decision id, action id, normalized params, and approval token proof; gateway policy/action/MCP audit events persist through `audit_events`; `/api/gateway/audit-events` and the Next diagnostics panel expose only a redacted public audit projection with ids, hashes, policy summary, subject kind, and device profile; if approval persistence fails, approval token issuance and command construction fail closed | Add richer audit filters and retention/export controls without exposing raw params/result/evidence payloads | `P1` |
| `MCP + Hono` gateway for product tools | `web-interface/gateway/mcp-server.ts` exposes SDK-backed `/mcp`; the old JSON-RPC-shaped `/api/gateway/mcp` route and old `/api/agent/harness-session` route have been removed; `web-interface/gateway/tool-dispatcher.ts` no longer has an intent dispatch entry; SDK tools/list now includes 19 platform tools including screen tools, `memory.preference`, `memory.approve`, `memory.sensitiveSkip`, `device.note.write`, and policy prepare/commit; direct `/mcp` calls and `/api/agent/turn` Mastra workflow calls now carry request-derived server subject/device context into OPA/audit; better-auth routes are mounted at `/api/auth/*`, signed-in sessions persist in Postgres, spoofed subject/role headers are ignored, and signed better-auth users resolve through DB-owned WalnutPi org/device/role bindings (`walnut_orgs`, `walnut_devices`, `walnut_user_bindings`) before entering MCP/OPA; the Next/Tailwind console exercises auth/session, policy tools, and the redacted audit projection through the Hono API proxy | Add richer audit filters/retention controls and multi-org/device management UI without exposing private payloads | `P1` |
| `Screen Command DSL` as the screen control seam | `web-interface/screen-command-dsl.ts` and `web-interface/screen-command-runner.ts` run screen read, capture, sync, render, and playlist write from MCP/Mastra without letting model output become an authoritative manifest | Remote device sync and frame comparison still need broader device-profile coverage through the platform path | `P1` |
| Renderer adapter split | Screen rendering still flows through `screen-workspace-workflows.ts` and `scripts/screen-workspace-pipeline.ts` | No explicit `WallpaperRenderer`, `TerminalPrintRenderer`, `RuntimeAssetRenderer`, or `WidgetAppRenderer` modules | `P1` |
| Typed WalnutPi tool results and `walnutpi.agentPlatformTurn.v1` projection | `web-interface/walnut-tool-results.ts` defines typed results; `web-interface/agent-platform-turn-route.ts` projects only typed Mastra/MCP tool results into the turn shape; public tool/session projections strip raw command fields while retaining diagnostic/audit references | Projection still lives in the Hono route layer until the Next/AI SDK console replaces the static console path | `P1` |
| OpenTelemetry, Langfuse, and curated eval | `web-interface/platform/observability/` initializes OTel and a local-safe Langfuse boundary; existing local ledgers still hold product evidence | Wire spans into the production turn/tool paths and add the 3x3 curated eval runner | `P1` |
| DB-backed product state | `web-interface/platform/db/schema.ts` defines memory candidate, approved durable memory, sensitive-skip, curated retrieval document, action approval, audit event, agent turn snapshot, agent turn event, Web session event, and better-auth user/session/account/verification tables; migrations now run through `0008_curated_retrieval_documents.sql`; `memory.preference`, `memory.approve`, and `memory.sensitiveSkip` route through `web-interface/platform/memory/product-state-store.ts`; preference capture creates a candidate only, `memory.approve` writes approved durable memory by candidate id, and sensitive skips store hash/length only; `/api/retrieval` now reads the DB curated retrieval path over approved durable memory and curated `retrieval_documents`; raw session logs and raw daily notes are excluded by source kind/status; active Web session and `/api/agent/turn` ledgers use Postgres with explicit skipped persistence when DB config is absent | Add pgvector embeddings for approved memory and curated corpus documents only | `P1` |
| Narrow device boundary | `walnut-assistant/walnut`, `lvgl_app/src/main.c`, and `web-interface/walnut-remote-adapter.ts` form the current device path | Remote execution still relies on shell command strings and is broader than the typed device surface in the spec | `P1` |
| Vercel AI SDK web/API surface | `web-interface/platform/ai-sdk/` owns the AI SDK OpenAI-compatible provider boundary | Build the streaming API/UI path; keep AI SDK provider objects out of Mastra | `P2` |
| Next.js Walnut Agent Console | `web-interface/next-app/` now has a Tailwind console slice with chat/tool result panels, route/evidence diagnostics, signed-in subject display, email sign-up/sign-in/sign-out, quick Mastra/MCP capabilities, redacted Postgres audit trail, and approval UI for `policy.action.prepare`/`policy.action.commit`; Next rewrites `/api/*` and `/mcp` to the Hono platform server | Move remaining static-console workflows into Next and then retire the static HTML console | `P1` |
| Legacy runtime cleanup | `walnut-ai-terminal/` remains an archived/prototype seed; `web-interface/action-registry.ts` is narrowed to catalog/command-binding helpers and is not an intent executor; `/api/agent/turn` no longer calls the local dispatcher as fallback, old intent-to-action registry helpers have been removed, and `/api/agent/harness-session` is gone | Delete or narrow remaining prototype surfaces after the platform-owned business paths cover their product duties | `P2` |

## Read As

- `P0` items block the target architecture.
- `P1` items are useful progress, but the seam still needs to move.
- `P2` items should wait until the platform path is stable.

## Current Blockers

1. Finish Langfuse trace/session correlation for the active turn/tool path beyond the current OTel policy/tool spans.
2. Move Screen Workspace, device diagnostics, and artifact panels into the Next/Tailwind console so the static HTML console can be retired.
3. Add pgvector embeddings for approved memory and curated corpus documents only.
