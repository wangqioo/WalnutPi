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
export function createScreenAgent({ readPlaylistEnvelope }: { readPlaylistEnvelope?: any } = {}) {
  const planByIntent = {
    "screen.state_frame.read": [{ agent: "screen", kind: "screen.state_frame.read" }],
  };
  const planByRouteAction = {
    "screen.wallpaper:sync": [{ agent: "screen", kind: "screen.workspace.sync.intent" }],
    "screen.wallpaper:generate": [{ agent: "screen", kind: "screen.workspace.generate.intent" }],
    "screen.widget_app:create": [{ agent: "screen", kind: "screen.widget_app.create.intent" }],
  };
  const taskRunners = {
    "screen.state_frame.read": runScreenStateFrameRead,
    "screen.workspace.generate.intent": runScreenWorkspaceGenerate,
    "screen.widget_app.create.intent": runScreenWidgetAppCreate,
    "screen.workspace.sync.intent": (task, ctx) => runScreenWorkspaceSync(task, ctx, readPlaylistEnvelope),
  };

  return {
    matchPlan(classification) {
      const intent = classification?.intent || "";
      const route = classification?.route || "";
      const action = classification?.action || "";
      return planByIntent[intent] || planByRouteAction[`${route}:${action}`] || null;
    },

    async run(task, ctx) {
      const runner = taskRunners[task.kind];
      const result = runner ? await runner(task, ctx) : null;
      if (result) return result;
      ctx.setPending("missing prerequisites for screen task");
      return { ok: true, status: 200, stepId: ctx.step.id, stepResult: ctx.stepResult() };
    },
  };
}

async function runScreenStateFrameRead(_task, ctx) {
  const result = screenStateFrameReadResult();
  ctx.setCompleted(result);
  ctx.setTurnResult(true, result);
  ctx.finishAgent();
  ctx.observeStepResult();
  await ctx.updateTurnTrace();
  await ctx.emitStepDone();
  return { ok: true, status: 200, stepId: ctx.step.id, stepResult: result };
}

function runScreenWorkspaceGenerate(_task, ctx) {
  if (!ctx.generateScreen) return null;
  const { text, sessionId, turn } = ctx;
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

function runScreenWidgetAppCreate(_task, ctx) {
  if (!ctx.generateScreen) return null;
  const { text, sessionId, turn } = ctx;
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

async function runScreenWorkspaceSync(_task, ctx, readPlaylistEnvelope) {
  if (!ctx.syncScreen) return null;
  const { body, sessionId, turn } = ctx;
  const playlistHash = body.playlistHash || await readCurrentPlaylistHash(readPlaylistEnvelope);
  if (!playlistHash) {
    ctx.setPending("missing current playlist hash");
    return { ok: true, status: 200, stepId: ctx.step.id, stepResult: ctx.stepResult() };
  }
  return ctx.queueTask(() =>
    ctx.syncScreen({ playlistHash, evidenceMode: body.evidenceMode, sessionId, turnId: turn.turnId }),
  );
}

async function readCurrentPlaylistHash(readPlaylistEnvelope) {
  if (typeof readPlaylistEnvelope !== "function") return null;
  const envelope = await readPlaylistEnvelope();
  return envelope?.playlistHash || null;
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
