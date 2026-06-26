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
| `Mastra Runtime` for agent routing and workflows | `/api/agent/turn` now uses `web-interface/agent-platform-turn-route.ts` for request/ledger/projection only, then dispatches supported structured capabilities through `web-interface/platform/mastra/agent-turn-workflows.ts` and `@mastra/mcp`; screen read/capture/sync/render/write, memory session/preference/sensitive-skip, device reads, note write, and `policy.action.prepare`/`policy.action.commit` are registered Mastra/MCP capabilities | Expand Mastra-owned workflow coverage into remaining approved action flows after the approval UI exists | `P0` |
| `OPA` policy decision before command construction | `web-interface/platform/policy/opa-boundary.ts` runs OPA CLI for the active tool-dispatch policy gate; read actions may use the boundary's explicit OPA-unavailable degraded decision, while write-low and high-risk actions fail closed; screen sync/write tools are policy-gated before DSL execution; `policy.action.prepare` records pending/refused decisions without command construction, and `policy.action.commit` requires decision id, normalized params hash, subject match, approval token, and a fresh OPA allow decision. Approval records persist through `action_approval_records`, and gateway policy/action/MCP audit events persist through `audit_events`; if approval persistence fails, approval token issuance and command construction fail closed | Add approval UI around the policy tools and expose DB audit review in diagnostics | `P0` |
| `MCP + Hono` gateway for product tools | `web-interface/gateway/mcp-server.ts` exposes SDK-backed `/mcp`; the old JSON-RPC-shaped `/api/gateway/mcp` route and old `/api/agent/harness-session` route have been removed; `web-interface/gateway/tool-dispatcher.ts` no longer has an intent dispatch entry; SDK tools/list now includes 18 platform tools including screen tools, `memory.preference`, `memory.sensitiveSkip`, `device.note.write`, and policy prepare/commit; MCP calls now carry server-derived subject/device context into OPA/audit | Add approval UI around the policy tools | `P0` |
| `Screen Command DSL` as the screen control seam | `web-interface/screen-command-dsl.ts` and `web-interface/screen-command-runner.ts` run screen read, capture, sync, render, and playlist write from MCP/Mastra without letting model output become an authoritative manifest | Remote device sync and frame comparison still need broader device-profile coverage through the platform path | `P1` |
| Renderer adapter split | Screen rendering still flows through `screen-workspace-workflows.ts` and `scripts/screen-workspace-pipeline.ts` | No explicit `WallpaperRenderer`, `TerminalPrintRenderer`, `RuntimeAssetRenderer`, or `WidgetAppRenderer` modules | `P1` |
| Typed WalnutPi tool results and `walnutpi.agentPlatformTurn.v1` projection | `web-interface/walnut-tool-results.ts` defines typed results; `web-interface/agent-platform-turn-route.ts` projects only typed Mastra/MCP tool results into the turn shape; public tool/session projections strip raw command fields while retaining diagnostic/audit references | Projection still lives in the Hono route layer until the Next/AI SDK console replaces the static console path | `P1` |
| OpenTelemetry, Langfuse, and curated eval | `web-interface/platform/observability/` initializes OTel and a local-safe Langfuse boundary; existing local ledgers still hold product evidence | Wire spans into the production turn/tool paths and add the 3x3 curated eval runner | `P1` |
| DB-backed product state | `web-interface/platform/db/schema.ts` defines memory candidate, sensitive-skip, action approval, and audit event tables; `web-interface/platform/db/migrations/` plus `bun run db:migrate` provide managed SQL migrations through `0003_expand_audit_events.sql`; `memory.preference` and `memory.sensitiveSkip` route through `web-interface/platform/memory/product-state-store.ts`; sensitive skips store hash/length only; approval prepare/commit routes through `action_approval_records`; gateway audit writes now use `audit_events` instead of `data/gateway-audit.jsonl` | Add approved durable memory and curated retrieval paths without indexing raw session logs; migrate remaining turn/session ledgers when those product paths move | `P1` |
| Narrow device boundary | `walnut-assistant/walnut`, `lvgl_app/src/main.c`, and `web-interface/walnut-remote-adapter.ts` form the current device path | Remote execution still relies on shell command strings and is broader than the typed device surface in the spec | `P1` |
| Vercel AI SDK web/API surface | `web-interface/platform/ai-sdk/` owns the AI SDK OpenAI-compatible provider boundary | Build the streaming API/UI path; keep AI SDK provider objects out of Mastra | `P2` |
| Next.js Walnut Agent Console | `web-interface/next-app/` is a minimal Next boundary; the static HTML console remains active | Replace the static console only after a business vertical slice is stable | `P2` |
| Legacy runtime cleanup | `walnut-ai-terminal/` remains an archived/prototype seed; `web-interface/action-registry.ts` is narrowed to catalog/command-binding helpers and is not an intent executor; `/api/agent/turn` no longer calls the local dispatcher as fallback, old intent-to-action registry helpers have been removed, and `/api/agent/harness-session` is gone | Delete or narrow remaining prototype surfaces after the platform-owned business paths cover their product duties | `P2` |

## Read As

- `P0` items block the target architecture.
- `P1` items are useful progress, but the seam still needs to move.
- `P2` items should wait until the platform path is stable.

## Current Blockers

1. Add the approval UI around the new `policy.action.prepare`/`policy.action.commit` tools.
2. Replace the current better-auth-first/local-owner subject resolver with real signed-in user flows once the Next.js console owns login/session creation.
3. Finish Langfuse trace/session correlation for the active turn/tool path beyond the current OTel policy/tool spans.
4. Replace the static console with the Next.js/Vercel AI SDK surface after the platform path owns the needed business workflows.
