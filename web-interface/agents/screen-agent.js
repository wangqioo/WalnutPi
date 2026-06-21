/**
 * Screen agent — handles screen state reads, generation, widget creation, and sync.
 *
 * Plan matching:
 *   1. intent === "screen.state_frame.read"        → state_frame.read
 *   2. route+action (screen.wallpaper + sync)       → workspace.sync.intent
 *   3. route+action (screen.wallpaper + generate)   → workspace.generate.intent
 *   4. route+action (screen.widget_app + create)    → widget_app.create.intent
 *
 * Synchronous tasks (state_frame.read) complete inline.
 * Async tasks (generate, sync) are queued via ctx.queueTask().
 */
export function createScreenAgent() {
  return {
    matchPlan(classification) {
      const intent = classification?.intent || "";
      const route = classification?.route || "";
      const action = classification?.action || "";

      if (intent === "screen.state_frame.read") {
        return [{ agent: "screen", kind: "screen.state_frame.read" }];
      }
      if (route === "screen.wallpaper" && action === "sync") {
        return [{ agent: "screen", kind: "screen.workspace.sync.intent" }];
      }
      if (route === "screen.wallpaper" && action === "generate") {
        return [{ agent: "screen", kind: "screen.workspace.generate.intent" }];
      }
      if (route === "screen.widget_app" && action === "create") {
        return [{ agent: "screen", kind: "screen.widget_app.create.intent" }];
      }
      return null;
    },

    async run(task, ctx) {
      const { body, text, sessionId, turn } = ctx;

      // Synchronous: read-only state frame
      if (task.kind === "screen.state_frame.read") {
        const result = screenStateFrameReadResult();
        ctx.setCompleted(result);
        ctx.setTurnResult(true, result);
        ctx.finishAgent();
        ctx.observeStepResult();
        await ctx.updateTurnTrace();
        await ctx.emitStepDone();
        return { ok: true, status: 200, stepId: ctx.step.id, stepResult: result };
      }

      // Async: generate, widget, sync — queue via ctx.queueTask
      if (task.kind === "screen.workspace.generate.intent" && ctx.generateScreen) {
        return ctx.queueTask(() =>
          ctx.generateScreen({
            prompt: text,
            sessionId,
            turnId: turn.turnId,
            screenId: `agent-freeform-${Date.now()}`,
            playlist: "default",
            outputType: "animated",
            preset: "fit-cover:480x320",
          }),
        );
      }

      if (task.kind === "screen.widget_app.create.intent" && ctx.generateScreen) {
        return ctx.queueTask(() =>
          ctx.generateScreen({
            prompt: text,
            sessionId,
            turnId: turn.turnId,
            screenId: `agent-widget-${Date.now()}`,
            playlist: false,
            outputType: "static",
            preset: "fit-cover:480x320",
          }),
        );
      }

      if (task.kind === "screen.workspace.sync.intent" && ctx.syncScreen && body.playlistHash) {
        return ctx.queueTask(() =>
          ctx.syncScreen({ playlistHash: body.playlistHash, evidenceMode: body.evidenceMode, sessionId, turnId: turn.turnId }),
        );
      }

      // Unrecognised screen task → pending
      ctx.setPending("missing prerequisites for screen task");
      return { ok: true, status: 200, stepId: ctx.step.id, stepResult: ctx.step.result };
    },
  };
}

function screenStateFrameReadResult() {
  const summary = "当前环境没有配置安全的只读设备探针；未同步、未重启、未抓取大图，只返回诚实失败证据。";
  return {
    ok: true,
    summary,
    serviceState: "unknown",
    screenEvidence: {
      frame: { ok: false, honestFailure: "read-only screen frame probe is not configured for this local run" },
    },
    evidence: {
      screenStateOutput: summary,
      frameHashOrHonestFailure: "read-only screen frame probe is not configured for this local run",
      noScreenSync: true,
      noServiceRestart: true,
    },
  };
}
