/* Multi-agent orchestrator for Pocket AI ("the team").
   A planner model breaks a goal into subtasks and delegates them to worker
   agents — optionally several in parallel — then combines the results into a
   final answer. Emits a single unified event feed so the UI can show the
   agents "talking". This module is pure coordination: the planner and the
   workers are injected, so it is model- and browser-agnostic (and testable). */

/**
 * @param {object} o
 * @param {string}   o.goal
 * @param {(ctx:{goal,history,round})=>Promise<object>} o.plan  planner → decision
 * @param {Record<string,(task:string,ctx:object)=>Promise<string>>} o.workers
 * @param {(msg:object)=>void} o.emit
 * @param {number} [o.maxRounds]    hard cap on planner turns (budget guard)
 * @param {number} [o.maxParallel]  max agents dispatched per round
 */
async function runTeam({ goal, plan, workers, emit, maxRounds = 8, maxParallel = 3 }) {
  const history = []; // [{agent, task, result, error?}]
  const names = Object.keys(workers);

  for (let round = 1; round <= maxRounds; round++) {
    let decision;
    try {
      decision = await plan({ goal, history, round });
    } catch (e) {
      emit({ type: "error", message: "planner error: " + e.message });
      return { ok: false, reason: "planner-error" };
    }
    emit({ type: "plan", round, thought: decision.thought || "", decision });

    if (decision.type === "final") {
      emit({ type: "final", answer: decision.answer || "" });
      return { ok: true, answer: decision.answer || "" };
    }

    const tasks = Array.isArray(decision.tasks) ? decision.tasks.filter((t) => t && t.agent && t.task) : [];
    if (!tasks.length) {
      emit({ type: "error", message: "planner returned no tasks" });
      return { ok: false, reason: "no-tasks" };
    }

    const batch = tasks.slice(0, maxParallel);
    emit({ type: "round-start", round, tasks: batch.map((t) => ({ agent: t.agent, task: t.task })) });

    // Dispatch the batch in parallel; each worker streams its own events too.
    const results = await Promise.all(batch.map(async (t) => {
      const worker = workers[t.agent];
      if (!worker) {
        const r = { agent: t.agent, task: t.task, result: `No such agent "${t.agent}". Available: ${names.join(", ")}.`, error: true };
        emit({ type: "agent-msg", ...r });
        return r;
      }
      emit({ type: "agent-start", agent: t.agent, task: t.task });
      try {
        const out = await worker(t.task, { emit, agent: t.agent, goal, history });
        const r = { agent: t.agent, task: t.task, result: String(out == null ? "" : out) };
        emit({ type: "agent-msg", agent: r.agent, task: r.task, result: r.result });
        return r;
      } catch (e) {
        const r = { agent: t.agent, task: t.task, result: "error: " + e.message, error: true };
        emit({ type: "agent-msg", ...r });
        return r;
      }
    }));

    history.push(...results);
  }

  emit({ type: "stopped", reason: "max-rounds" });
  return { ok: false, reason: "max-rounds", history };
}

module.exports = { runTeam };
