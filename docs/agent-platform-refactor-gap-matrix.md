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
| `Mastra Runtime` for agent routing and workflows | `web-interface/mastra-registry.ts` registers Mastra agents used by `web-interface/mastra-agent-api.ts`; `/api/agent/turn` still routes through `web-interface/agent-platform-runtime.ts` | Mastra is not yet the owner of the product turn workflow, and tool dispatch still lives in the local runtime/gateway layer | `P0` |
| `OPA` policy decision before command construction | `web-interface/platform/policy/opa-boundary.ts` runs OPA CLI for the active tool-dispatch policy gate; the local manifest remains the catalog/fail-closed fallback | Prepare/commit approval audit flow is still missing | `P0` |
| `MCP + Hono` gateway for product tools | `web-interface/gateway/mcp-server.ts` now exposes SDK-backed `/mcp` beside the legacy JSON-RPC-shaped `/api/gateway/mcp` route | Expand the SDK surface beyond the first read-only tools and carry auth context into each call | `P0` |
| `Screen Command DSL` as the screen control seam | `web-interface/screen-command-dsl.ts` and `web-interface/screen-command-runner.ts` already exist | DSL is present, but the runner still owns workspace workflow, sync, and capture orchestration | `P1` |
| Renderer adapter split | Screen rendering still flows through `screen-workspace-workflows.ts` and `scripts/screen-workspace-pipeline.ts` | No explicit `WallpaperRenderer`, `TerminalPrintRenderer`, `RuntimeAssetRenderer`, or `WidgetAppRenderer` modules | `P1` |
| Typed WalnutPi tool results and `walnutpi.agentPlatformTurn.v1` projection | `web-interface/walnut-tool-results.ts` and `web-interface/agent-platform-runtime.ts` already produce typed tool results and a new turn shape | The projection is still assembled inside custom runtime code instead of a framework run projection | `P1` |
| OpenTelemetry, Langfuse, and curated eval | `web-interface/platform/observability/` initializes OTel and a local-safe Langfuse boundary; existing local ledgers still hold product evidence | Wire spans into the production turn/tool paths and add the 3x3 curated eval runner | `P1` |
| Narrow device boundary | `walnut-assistant/walnut`, `lvgl_app/src/main.c`, and `web-interface/walnut-remote-adapter.ts` form the current device path | Remote execution still relies on shell command strings and is broader than the typed device surface in the spec | `P1` |
| Vercel AI SDK web/API surface | `web-interface/platform/ai-sdk/` owns the AI SDK OpenAI-compatible provider boundary | Build the streaming API/UI path; keep AI SDK provider objects out of Mastra | `P2` |
| Next.js Walnut Agent Console | `web-interface/next-app/` is a minimal Next boundary; the static HTML console remains active | Replace the static console only after a business vertical slice is stable | `P2` |
| Legacy runtime cleanup | `walnut-ai-terminal/` and `web-interface/action-registry.ts` still carry prototype-era behavior | The old prototype and legacy command-building path still remain in the repo | `P2` |

## Read As

- `P0` items block the target architecture.
- `P1` items are useful progress, but the seam still needs to move.
- `P2` items should wait until the platform path is stable.

## Suggested First Moves

1. Keep TypeScript on TS5 with `skipLibCheck: true` as third-party declaration-noise isolation; Mastra uses normal static imports and Mastra-supported model config.
2. Move policy decisions out of local action execution and into an OPA-backed gate.
3. Replace the JSON-RPC-shaped gateway route with an MCP TypeScript SDK + Hono endpoint, then register those tools with the Mastra runtime.
4. Cut `/api/agent/turn` over to a Mastra-owned product workflow after the gateway/tool surface is stable.
5. Use Vercel AI SDK for the web/API streaming surface; keep Mastra model config on Mastra-supported model inputs until provider-version compatibility is explicit.
