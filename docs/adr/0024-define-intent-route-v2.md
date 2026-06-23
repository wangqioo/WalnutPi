# Define Intent Route v2

Walnut Agent Console needs a product routing contract, not only a flat intent
classification string.

The previous `walnutpi.intent.classification.v1` shape is replaced by Intent
Route v2. This is a breaking change for the classify API and internal routing
code.

**Decision**

`/api/intent/classify` returns Intent Route v2 as the primary result:

```json
{
  "schema": "walnutpi.intent.route.v2",
  "route": "screen.widget_app",
  "action": "create",
  "subject": "设备状态快捷面板",
  "delivery": "none",
  "riskHint": "read",
  "exposure": ["internal"],
  "actionPolicyId": null,
  "parameters": {
    "template": "device_status_quick_actions"
  },
  "confidence": 0.9,
  "source": "rule"
}
```

The first route set is deliberately small:

- `ai.chat`
- `screen.wallpaper`
- `screen.widget_app`
- `device.action`
- `memory.notes`
- `terminal.surface`

`action` is a small enum such as `answer`, `clarify`, `generate`, `create`,
`update`, `sync`, `switch`, `run`, `confirm`, `refuse`, `read`, `write`,
`open`, and `run_tool`. Product details belong in `subject` and
route-specific `parameters`, not in new action names.

Wallpaper and Widget App routing must be explicit:

- Wallpaper Mode covers pre-rendered images, animations, media, playlists,
  previews, and playlist sync.
- Widget App Mode covers interactive apps, panels, buttons, toggles, menus,
  dashboards, dynamic data, input, and actions.

`delivery` remains a routing hint with values such as `none`,
`sync_after_preview`, and `sync_existing`.

`riskHint` is not authorization. It is a classifier hint only. Action Policy
Manifest remains the source of truth for executable action risk,
confirmation, refusal, executors, parameters, and evidence. If `riskHint`
conflicts with policy, policy wins.

`exposure` is an array:

- `internal`: Console or agent-only route.
- `agent_action`: stable machine action governed by Action Policy Manifest.
- `human_cli`: can be exposed as a `walnut` CLI command.
- `diagnostic`: developer diagnostics only.

Any route with `agent_action` exposure must include an `actionPolicyId`.
Routes with only `human_cli` exposure do not need an Action Policy Manifest
entry because Human CLI Commands and Agent Action Commands have separate
contracts.

`parameters` are allowed, but they must be cleaned by `route + action`
whitelists. AI output must not become executable parameters directly.

`context` may be supplied to classification by the UI or server:

```json
{
  "activeSurface": "screen.widget_app",
  "activeAppId": "device-status",
  "activePlaylistId": "default"
}
```

Context is factual input. The AI router must not invent active apps,
playlists, or surfaces.

When route confidence is too low or context is missing for a route-level
decision, the result should be a clarify route:

```json
{
  "schema": "walnutpi.intent.route.v2",
  "route": "ai.chat",
  "action": "clarify",
  "subject": "做个小屏",
  "parameters": {
    "question": "你要做壁纸播放，还是可交互小应用？",
    "choices": [
      { "label": "壁纸播放", "route": "screen.wallpaper", "action": "generate" },
      { "label": "可交互小应用", "route": "screen.widget_app", "action": "create" }
    ]
  },
  "riskHint": "none",
  "exposure": ["internal"],
  "confidence": 0.45,
  "source": "rule"
}
```

Parameter details should default when the product route is clear. For example,
"做个设备状态面板" should create a Widget App with the default device status
template instead of asking for title, colors, or layout.

**Implementation shape**

Keep the implementation as a small product-routing pipeline:

```text
structuredRoute(text, context)
-> modelRoute(text, context)
-> cleanRoute(route)
```

Do not introduce a router framework, route provider interface, strategy class
tree, plugin registry, or factory hierarchy for this.

Do not keep JSON fixtures, facts, rules, or keyword fallbacks as a second
classifier. Structured routes are only for explicit platform context such as a
read-only continuation. Natural-language routing is handled by the model and
normalized to this route contract; missing classifier configuration should fail
clearly instead of guessing.

**Consequences**

Intent Route v2 becomes the boundary between natural language and product
chains.

Device action execution remains separate from route classification. A route may
identify an `actionPolicyId`, but execution still goes through Device Execution
Surface and Local Action Policy.

Breaking the old classification shape is intentional. Existing UI and server
code that reads `classification.intent` must be updated when this ADR is
implemented.
