# Issue: Agent Console multi-task test was routed as network check

## What Happened

During an in-app Browser test, the Agent Console input was used to test multiple capabilities in one prompt:

```text
测试：请测试 CLI、外部知识和联网能力。1、生成一个动态动画类型小 app；2、联网找一个唯美 gif。先预览，不要同步到真机。
```

The Console accepted the input and submitted it, but the backend classified the whole prompt as a device network read:

```json
{
  "route": "device.action",
  "action": "read",
  "intent": "device.network.read",
  "confidence": 0.9,
  "source": "rule"
}
```

The resulting plan was only:

```json
[
  { "agent": "device", "kind": "action.run", "action": "network" }
]
```

So the response was WalnutPi network output from:

```text
walnut action run network --json
```

## Expected Behavior

This prompt should be understood as a multi-part capability test, not as a single network status request.

The agent should reason about at least these aspects:

- CLI/tool capability test
- external knowledge or web lookup capability
- page/screen generation capability
- dynamic animated mini app generation
- finding or using a beautiful GIF
- preview-only delivery, with no real-device sync

## Current Diagnosis

The intent rules treated the word `联网` as `mentionsNetwork = true`, and the test phrasing made it look like a read/check request. That triggered the rule route:

```text
mentionsNetwork && hasReadOnly -> device.network.read
```

Because `device.network.read` is allowed to short-circuit without AI classification, the AI classifier never got a chance to interpret the prompt as multiple tasks.

## Notes

This is not an input-box failure. The input box worked.

The issue is in task understanding and routing:

- combined prompts are not decomposed into multiple tasks
- `联网能力` is ambiguous and currently means device network check
- screen/app generation requests can be lost when another high-confidence rule fires first
- preview-only intent should prevent sync, not suppress generation

## Follow-up Separated Tests

After splitting the original prompt into separate UI submissions:

1. `测试 CLI 能力：只读检查核桃派网络状态`
   - Result: passed.
   - Routed to `device.network.read`.
   - Ran `walnut action run network --json`.

2. `生成一个动态动画类型小 app，主题是唯美星空，先预览，不要同步到真机`
   - Result: partially passed.
   - Routed to `screen.generate` through AI classification.
   - Generated an animated preview-only Screen Workspace item.
   - No real-device sync happened.
   - Quality issue: generated output used the generic `pixel-ops` device/status template and did not clearly reflect the requested beautiful starry-sky animated app.

3. `联网找一个唯美 gif，给我候选链接，不要同步到真机`
   - Result: failed.
   - Routed again to `device.network.read`.
   - Returned WalnutPi network status instead of web/GIF candidates.

This confirms the input box and submit flow work, but external-web lookup intent is missing or shadowed by the device-network rule.

## Product Correction

The intended meaning of the original test was not "return GIF links" as a standalone web lookup.

The intended product workflow was:

```text
联网找唯美 GIF / external visual source
-> import or use it as a Screen Workspace Source Asset
-> generate a dynamic wallpaper / animated mini app preview
-> do not sync to the real device until explicitly requested
```

So `联网` in this context means source asset acquisition for the wallpaper/screen-generation workflow. It should not be interpreted as:

- a WalnutPi device network check
- a standalone external-search answer
- a CLI capability test result

The correct route should stay inside the Screen Workspace product spine:

```text
Intent Route
-> Source Asset acquisition
-> Screen Content / Screen Manifest v2
-> Screen Playlist v1
-> preview-only Runtime Screen Assets
```

The key missing behavior is that Agent Console does not currently connect external media acquisition to the wallpaper/dynamic-screen generation flow.

## Harness / Loop Framing

The harness and agent loop should be evaluated from the product workflow, not from individual tool capabilities.

For this scenario, the product goal is:

```text
Generate a beautiful GIF-based dynamic wallpaper / animated mini app preview for WalnutPi.
```

The expected loop is:

```text
user goal
-> understand this as a Screen Workspace workflow
-> acquire or select an external visual source asset
-> generate screen content from that source
-> build Screen Manifest v2 and Screen Playlist v1
-> render preview/runtime assets
-> report what was produced and ask for next-step confirmation
```

The harness should verify the whole product scenario:

- the request does not route to device network status
- external material is treated as Source Asset input
- the generated output reflects the requested visual direction
- preview appears in the Console or Screen Workspace
- no real-device sync happens without explicit confirmation
- each stage leaves evidence that explains what happened

This should not be reduced to separate checks like "CLI works", "network works", or "generation API works". Those are implementation capabilities, not the user-facing product result.
