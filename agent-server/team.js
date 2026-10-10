/* Concrete team members for the orchestrator: a planner and worker factories
   bound to OpenRouter (text agents) and to Scout (the browser agent). */

const { runTask } = require("./agent");

/* --------------------------- OpenRouter helper -------------------------- */
async function orCall(endpoint, cfg, body) {
  const res = await fetch(endpoint + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + cfg.apiKey,
      "HTTP-Referer": cfg.referer || "https://ultrabull.github.io/App-Builder/",
      "X-Title": "Pocket AI Scout Team",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 160)}`);
  }
  return res.json();
}

function parsePlan(data) {
  const raw = data.choices?.[0]?.message?.content || "";
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("no JSON in planner response");
  return JSON.parse(s.slice(a, b + 1));
}

/* ------------------------------- Planner -------------------------------- */
const plannerSystem = (roster) =>
  `You are the Orchestrator of a small team of AI agents working toward the user's GOAL.
Break the goal into subtasks, delegate them to the right agents (several at once when
they're independent), then combine the results into a final answer for the user.

Available agents:
${roster.map((r) => `- ${r.id}: ${r.desc}`).join("\n")}

Each turn you get the GOAL and the HISTORY of completed subtasks with their results.
Reply with EXACTLY ONE JSON object:
- Delegate:  {"thought":"...","type":"delegate","tasks":[{"agent":"<id>","task":"<clear, self-contained instruction>"}]}
- Finish:    {"thought":"...","type":"final","answer":"<the complete answer for the user>"}

Rules:
- Use only the listed agents. Prefer parallel subtasks when independent.
- Only "scout" can access the live web/log in to sites; route lookups and web actions to it.
- Don't repeat subtasks already in HISTORY. Finish as soon as the goal is met.`;

function makePlanner(cfg, roster) {
  const endpoint = (cfg.endpoint || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  return async function plan({ goal, history }) {
    const hist = history.length
      ? history.map((h, i) => `${i + 1}. [${h.agent}] ${h.task}\n   → ${String(h.result).slice(0, 800)}`).join("\n")
      : "(nothing yet)";
    const data = await orCall(endpoint, cfg, {
      model: cfg.model,
      temperature: 0,
      max_tokens: 700,
      messages: [
        { role: "system", content: plannerSystem(roster) },
        { role: "user", content: `GOAL: ${goal}\n\nHISTORY:\n${hist}\n\nDecide the next step as one JSON object.` },
      ],
    });
    return parsePlan(data);
  };
}

/* --------------------------- Text workers ------------------------------- */
const RESEARCHER_SYS =
  "You are a Researcher on an AI team. Given a subtask, produce a concise, factual briefing: " +
  "key points, numbers, and any caveats. If you're given page text or notes, summarize them. " +
  "Be honest about uncertainty and never fabricate facts or sources. If the task needs live web " +
  "data you don't have, say exactly what the browser agent should fetch.";
const WRITER_SYS =
  "You are a Writer on an AI team. Turn the provided notes/instructions into a clear, well-structured " +
  "final piece in the requested format (email, summary, post, list…). Keep it tight and ready to use.";
const ANALYST_SYS =
  "You are an Analyst on an AI team. Do the calculation or data reasoning requested, show the key steps " +
  "briefly, and state the result clearly. Flag any assumptions.";

function makeTextWorker(cfg, systemPrompt) {
  const endpoint = (cfg.endpoint || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  return async function (task, ctx) {
    const data = await orCall(endpoint, cfg, {
      model: cfg.model,
      temperature: 0.3,
      max_tokens: 900,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `GOAL: ${ctx.goal}\n\nYOUR SUBTASK: ${task}` },
      ],
    });
    return data.choices?.[0]?.message?.content || "";
  };
}

/* ------------------------- Scout (browser) worker ----------------------- */
// Each invocation gets its OWN page (tab) from the shared persistent context,
// so several Scout subtasks can run as parallel browser sessions while still
// sharing your saved logins. The page is closed when the subtask ends.
function makeScoutWorker({ newPage, decide, confirm, allowlist, maxSteps }) {
  return async function (task, ctx) {
    const page = await newPage();
    const summary = [];
    const localEmit = (m) => {
      // Tag Scout's stream so the UI can attribute screenshots/steps to it.
      ctx.emit({ ...m, via: "scout", task });
      if (m.type === "done" && m.summary) summary.push(m.summary);
    };
    try {
      const res = await runTask({ task, page, decide, emit: localEmit, confirm, allowlist, maxSteps });
      if (res.ok) return summary.join(" ") || "Scout completed the task.";
      return "Scout stopped (" + (res.reason || "") + ")" + (res.question ? ": " + res.question : "");
    } finally {
      try { await page.close(); } catch {}
    }
  };
}

const DEFAULT_ROSTER = [
  { id: "scout", desc: "drives a real web browser to look things up or perform web tasks (the only agent with live web access)" },
  { id: "researcher", desc: "summarizes and reasons over information; organizes findings" },
  { id: "writer", desc: "writes the final output (email, summary, post, etc.)" },
];

module.exports = {
  makePlanner, makeTextWorker, makeScoutWorker,
  RESEARCHER_SYS, WRITER_SYS, ANALYST_SYS, DEFAULT_ROSTER,
};
