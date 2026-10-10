/* Tests the multi-agent coordination core with mock planner + mock workers
   (no models, no browser, no network). Proves: parallel dispatch, delegation,
   unified event feed, unknown-agent handling, budget cap, and final answer. */

const { runTeam } = require("./orchestrator");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✅", m); } else { fail++; console.log("  ❌", m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ---- Test 1: parallel fan-out + delegation + final ----
  const events = [];
  const emit = (m) => events.push(m);

  // Mock workers that each take ~60ms so we can prove they run concurrently.
  const started = [];
  const mkWorker = (tag) => async (task) => { started.push({ tag, t: Date.now() }); await sleep(60); return `${tag} did: ${task}`; };
  const workers = {
    researcher: mkWorker("researcher"),
    writer: async (task) => `email draft based on: ${task}`,
    scout: mkWorker("scout"),
  };

  // Mock planner: round 1 delegates 2 researchers + 1 scout in parallel,
  // round 2 delegates the writer, round 3 finalizes.
  let round = 0;
  const plan = async ({ history }) => {
    round++;
    if (round === 1) return { thought: "gather in parallel", type: "delegate", tasks: [
      { agent: "researcher", task: "competitor A" },
      { agent: "researcher", task: "competitor B" },
      { agent: "scout", task: "check live pricing" },
    ] };
    if (round === 2) return { thought: "write it up", type: "delegate", tasks: [
      { agent: "writer", task: "summarize: " + history.map((h) => h.result).join(" | ") },
    ] };
    return { thought: "done", type: "final", answer: "FINAL: " + history[history.length - 1].result };
  };

  const t0 = Date.now();
  const res = await runTeam({ goal: "research 2 competitors and draft an email", plan, workers, emit, maxRounds: 6, maxParallel: 3 });
  const elapsed = Date.now() - t0;

  ok(res.ok && /FINAL: email draft/.test(res.answer), "team produced a final answer: " + (res.answer || "").slice(0, 40));

  // Parallelism: the 3 round-1 workers (2×60ms + instant writer later) must have
  // started within a few ms of each other, and total time ≈ 2 rounds of ~60ms,
  // not 3×60ms serial.
  const r1 = started.filter((s) => s.tag);
  const spread = Math.max(...r1.map((s) => s.t)) - Math.min(...r1.map((s) => s.t));
  ok(spread < 40, `round-1 workers ran concurrently (start spread ${spread}ms)`);
  ok(elapsed < 200, `whole run stayed concurrent (~${elapsed}ms, not serial)`);

  // Event feed shows the agents talking.
  ok(events.filter((e) => e.type === "agent-start").length === 4, "4 agent-start events (3 + writer)");
  ok(events.filter((e) => e.type === "agent-msg").length === 4, "4 agent-msg results streamed");
  ok(events.some((e) => e.type === "plan"), "planner decisions emitted");
  ok(events.some((e) => e.type === "final"), "final event emitted");
  const roundStart = events.find((e) => e.type === "round-start");
  ok(roundStart && roundStart.tasks.length === 3, "round-start lists the parallel batch");

  // ---- Test 2: maxParallel caps the batch ----
  const ev2 = [];
  let r2 = 0;
  await runTeam({
    goal: "x", emit: (m) => ev2.push(m),
    workers: { a: async () => "ok" },
    plan: async () => (++r2 === 1
      ? { type: "delegate", tasks: [ { agent: "a", task: "1" }, { agent: "a", task: "2" }, { agent: "a", task: "3" } ] }
      : { type: "final", answer: "done" }),
    maxParallel: 2, maxRounds: 3,
  });
  ok(ev2.find((e) => e.type === "round-start").tasks.length === 2, "maxParallel=2 trims a 3-task batch to 2");

  // ---- Test 3: unknown agent is reported, not fatal ----
  const ev3 = [];
  let r3 = 0;
  const res3 = await runTeam({
    goal: "x", emit: (m) => ev3.push(m),
    workers: { writer: async () => "wrote" },
    plan: async () => (++r3 === 1
      ? { type: "delegate", tasks: [ { agent: "ghost", task: "do" } ] }
      : { type: "final", answer: "recovered" }),
    maxRounds: 3,
  });
  ok(ev3.some((e) => e.type === "agent-msg" && e.error && /No such agent/.test(e.result)), "unknown agent reported as error message");
  ok(res3.ok, "run recovers after an unknown-agent subtask");

  // ---- Test 4: budget cap (max-rounds) stops a non-finishing planner ----
  let r4 = 0;
  const ev4 = [];
  const res4 = await runTeam({
    goal: "loop", emit: (m) => ev4.push(m),
    workers: { a: async () => "again" },
    plan: async () => { r4++; return { type: "delegate", tasks: [ { agent: "a", task: "again" } ] }; },
    maxRounds: 4,
  });
  ok(!res4.ok && res4.reason === "max-rounds", "budget cap stops an endless planner");
  ok(r4 === 4, "planner invoked exactly maxRounds times");
  ok(ev4.some((e) => e.type === "stopped" && e.reason === "max-rounds"), "stopped event emitted at cap");

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
