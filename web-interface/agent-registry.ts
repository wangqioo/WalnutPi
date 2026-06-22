/**
 * Agent Registry — replaces if/else chains for plan selection and task dispatch.
 *
 * Agents register their plan-matching logic and run handler. The loop
 * delegates to the registry instead of branching on intent/task kind.
 *
 *   registry.register('device', createDeviceAgent({ runAction }))
 *   registry.register('screen', createScreenAgent({ generateScreen, syncScreen }))
 *   // ...
 *
 *   registry.selectTurnPlan(classification) → task[] | null
 *   registry.runTask(task, ctx)             → { ok, status, stepId, stepResult }
 */
export function createAgentRegistry() {
  /** @type {Array<{ kind: string, matchPlan: Function, run: Function }>} */
  const agents = [];

  return {
    /**
     * Register an agent. Registration order determines plan-matching priority.
     * @param {string} kind  Agent identifier (e.g. "device", "screen")
     * @param {{ matchPlan?: (c:any) => any[]|null, run: (task:any, ctx:any) => Promise<any> }} def
     */
    register(kind, def) {
      agents.push({ kind, ...def });
      return this;
    },

    /**
     * Find the first registered agent whose matchPlan returns a plan.
     * Returns null when no agent matches (caller falls back to ai.chat).
     */
    selectTurnPlan(classification, mode = "intent") {
      if (mode === "ai") return null;
      for (const agent of agents) {
        if (typeof agent.matchPlan !== "function") continue;
        const plan = agent.matchPlan(classification);
        if (plan) return plan;
      }
      return null;
    },

    /** Return the runner object (or null) for a given kind. */
    getRunner(kind) {
      const agent = agents.find((a) => a.kind === kind);
      return agent && typeof agent.run === "function" ? agent : null;
    },

    /** Run a task by dispatching to the matching agent's run handler. */
    async runTask(task, ctx) {
      const agent = agents.find((a) => a.kind === task.agent);
      if (!agent || typeof agent.run !== "function") {
        throw new Error(`no runner registered for agent kind: ${task.agent}`);
      }
      return agent.run(task, ctx);
    },
  };
}
