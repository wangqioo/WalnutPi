# Screen AI Summary Design

## Goal

Add a Web-side summary layer that explains a screen sync record in beginner-friendly language:

```text
User syncs or opens a sync record
-> Web reads local sync evidence
-> Server returns a short summary based only on that evidence
-> UI shows the summary near the sync result and keeps the raw evidence in diagnostics
```

The first version is read-only. It does not connect to WalnutPi, build, activate, capture frames, write files, retry sync, or apply repairs.

## Scope

In scope:

- A new `POST /api/screen/ai-summary` route in `web-interface/model-terminal-server.js`.
- A deterministic local fallback summary that works without `OPENAI_API_KEY`.
- Optional OpenAI-compatible `/responses` summary when `OPENAI_API_KEY` is configured.
- Evidence extraction from stored local sync records only.
- UI support for requesting and displaying the summary.
- Documentation updates for the new route and safety boundary.

Out of scope:

- Streaming responses.
- Persisting generated summaries into sync records.
- Chat history memory.
- Automatic repair, retry, SSH, build, activation, or framebuffer capture.
- New SDK dependencies.

## Environment

The Web server reuses the same environment style as `walnut-ai-terminal/walnut_ai.py`:

- `OPENAI_API_KEY`: enables cloud summary.
- `WALNUT_AI_BASE_URL`: OpenAI-compatible base URL, default `https://rehdasu.cn/v1`.
- `WALNUT_AI_MODEL`: model name, default `gpt-5.5`.

If the API key is missing or the API call fails, the route returns the local fallback summary with diagnostic metadata.

## API

Add:

```text
POST /api/screen/ai-summary
```

Request:

```json
{
  "buildId": "screen-..."
}
```

Response:

```json
{
  "ok": true,
  "buildId": "screen-...",
  "aiSummary": {
    "schema": "walnutpi.screenAiSummary.v1",
    "buildId": "screen-...",
    "source": "local",
    "summary": "已同步到核桃派。屏幕服务已启动，设备返回了有效的 framebuffer 画面证据。",
    "evidence": {
      "ok": true,
      "failedStage": null,
      "visualMatch": "captured",
      "repairStage": null
    },
    "diagnostics": {
      "model": null,
      "apiUsed": false,
      "apiError": null
    }
  }
}
```

`source` is one of:

- `local`: deterministic fallback summary.
- `ai`: OpenAI-compatible summary.
- `ai-fallback`: API was configured but failed, so local summary was returned with `apiError`.

## Evidence Shape

The server passes a compact evidence object to local and AI summarizers:

- `buildId`
- `ok`
- `failedStage`
- `summary`
- `manifestHashShort`
- `artifactHashShort`
- `deliveryHashShort`
- `visualMatch`
- `visualChecks`
- `repairHint` summary fields
- `repairCandidate` summary fields
- first diagnostic line from relevant command output

The AI prompt must say:

- Summarize in Chinese.
- Use only supplied evidence.
- Do not claim actions that were not performed.
- Keep it short for beginners.
- If failed, say where it failed and the next safest manual step.

## Frontend

The repair/sync area gains a small action:

```text
生成 AI 总结
```

The button is available after a sync result or history record has a `buildId`. It calls `/api/screen/ai-summary`.

The result appears in:

- Beginner-facing sync summary text.
- Chat log as an assistant message.
- Developer diagnostics as `ai summary` JSON.

The UI must make no device calls directly. It only calls the local Web route.

## Safety

The route is read-only:

- No SSH.
- No build.
- No activation.
- No frame capture.
- No file writes.
- No retry.
- No repair application.

`?nossh` is allowed because the route reads local records only. Cloud AI, when configured, receives only the compact evidence object, not full command output, PNG bytes, or secrets.

## Error Handling

- Invalid JSON body: `400`.
- Invalid `buildId`: `400`.
- Missing record: `404`.
- API failure: return `ok: true` with `source: "ai-fallback"` and the local summary.
- Unexpected local failure: `500`.

## Success Criteria

- Existing sync and repair routes keep working.
- A stored successful sync record returns a local summary without `OPENAI_API_KEY`.
- A stored failed sync record returns a local summary that names the failed stage and safest next step.
- Invalid `buildId` is rejected before any record read.
- `?nossh` summary does not connect to WalnutPi or trigger build/capture/action paths.
- UI can show the generated summary and diagnostic JSON.
