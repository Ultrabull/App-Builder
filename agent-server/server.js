/* Pocket AI agent server.
   Holds a persistent Chromium (so your logins stick), accepts a task, runs the
   agent loop, and streams steps + screenshots back over Server-Sent Events.
   Your phone/browser is the remote: it POSTs a task and watches the stream. */

const express = require('express');
const { chromium } = require('playwright');
const { runTask } = require('./agent');
const { makeDecider } = require('./model');
const { runTeam } = require('./orchestrator');
const {
  makePlanner, makeTextWorker, makeScoutWorker,
  RESEARCHER_SYS, WRITER_SYS, ANALYST_SYS, DEFAULT_ROSTER,
} = require('./team');

const PORT = process.env.PORT || 8080;
const AUTH = process.env.AGENT_TOKEN || '';            // shared secret; required in prod
const ALLOWLIST = (process.env.ALLOWLIST || '')         // comma-separated hosts, empty = any
  .split(',').map((s) => s.trim()).filter(Boolean);
const USER_DATA_DIR = process.env.PROFILE_DIR || '/data/profile'; // persistent login profile

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS: allow the Pocket AI front-end to call us from the browser.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  next();
});

function authed(req) {
  if (!AUTH) return true; // no token set → open (fine for local testing only)
  const h = req.get('Authorization') || '';
  return h === 'Bearer ' + AUTH || req.query.token === AUTH;
}

// ---- Persistent browser ----------------------------------------------------

let context = null;
async function getContext() {
  if (context) return context;
  context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  return context;
}

// ---- Task registry ---------------------------------------------------------

const tasks = new Map(); // id -> { listeners:Set<res>, buffer:[], pending:{resolve}, done:bool }

function emitter(id) {
  return (msg) => {
    const t = tasks.get(id);
    if (!t) return;
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    t.buffer.push(line);
    for (const res of t.listeners) res.write(line);
    if (['done', 'final', 'stopped', 'error'].includes(msg.type)) t.finished = true;
  };
}

app.get('/health', (_req, res) => res.json({ ok: true, allowlist: ALLOWLIST }));

// Start a task.
app.post('/task', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  const { task, apiKey, model, endpoint, startUrl } = req.body || {};
  if (!task || !apiKey || !model) {
    return res.status(400).json({ error: 'task, apiKey and model are required' });
  }
  const id = Math.random().toString(36).slice(2, 10);
  tasks.set(id, { listeners: new Set(), buffer: [], finished: false, confirms: new Map() });
  res.json({ id });

  const emit = emitter(id);
  const decide = makeDecider({ apiKey, model, endpoint });
  const confirm = (action) => new Promise((resolve) => {
    const t = tasks.get(id);
    const cid = Math.random().toString(36).slice(2, 8);
    t.confirms.set(cid, resolve);
    emit({ type: 'confirm-request', cid, action });
    setTimeout(() => { if (t.confirms.has(cid)) { t.confirms.delete(cid); resolve(false); } }, 120000);
  });

  try {
    const ctx = await getContext();
    const page = ctx.pages()[0] || (await ctx.newPage());
    if (startUrl) {
      let u = /^https?:\/\//i.test(startUrl) ? startUrl : 'https://' + startUrl;
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    await runTask({ task, page, decide, emit, confirm, allowlist: ALLOWLIST });
  } catch (e) {
    emit({ type: 'error', message: e.message });
  }
});

// Start a multi-agent team run (orchestrator + workers, parallel).
app.post('/run', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  const { goal, apiKey, endpoint, orchModel, workerModel, scoutModel, maxRounds, maxParallel, maxSteps } = req.body || {};
  if (!goal || !apiKey || !orchModel) {
    return res.status(400).json({ error: 'goal, apiKey and orchModel are required' });
  }
  const id = Math.random().toString(36).slice(2, 10);
  tasks.set(id, { listeners: new Set(), buffer: [], finished: false, confirms: new Map() });
  res.json({ id });

  const emit = emitter(id);
  const confirm = (action) => new Promise((resolve) => {
    const t = tasks.get(id);
    const cid = Math.random().toString(36).slice(2, 8);
    t.confirms.set(cid, resolve);
    emit({ type: 'confirm-request', cid, action });
    setTimeout(() => { if (t.confirms.has(cid)) { t.confirms.delete(cid); resolve(false); } }, 120000);
  });

  const orchCfg = { apiKey, model: orchModel, endpoint };
  const workCfg = { apiKey, model: workerModel || orchModel, endpoint };
  const plan = makePlanner(orchCfg, DEFAULT_ROSTER);
  const decide = makeDecider({ apiKey, model: scoutModel || workerModel || orchModel, endpoint });

  try {
    const ctx = await getContext();
    const workers = {
      scout: makeScoutWorker({
        newPage: () => ctx.newPage(),
        decide, confirm, allowlist: ALLOWLIST, maxSteps: Number(maxSteps) || 25,
      }),
      researcher: makeTextWorker(workCfg, RESEARCHER_SYS),
      writer: makeTextWorker(workCfg, WRITER_SYS),
      analyst: makeTextWorker(workCfg, ANALYST_SYS),
    };
    await runTeam({
      goal, plan, workers, emit,
      maxRounds: Number(maxRounds) || 8,
      maxParallel: Number(maxParallel) || 3,
    });
  } catch (e) {
    emit({ type: 'error', message: e.message });
  }
});

// Subscribe to a task's event stream.
app.get('/stream/:id', (req, res) => {
  if (!authed(req)) return res.status(401).end();
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  for (const line of t.buffer) res.write(line); // replay what happened before they connected
  if (t.finished) return res.end();
  t.listeners.add(res);
  req.on('close', () => t.listeners.delete(res));
});

// Answer a confirmation prompt.
app.post('/confirm/:id', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'no such task' });
  const { cid, approve } = req.body || {};
  const resolve = t.confirms.get(cid);
  if (!resolve) return res.status(404).json({ error: 'no such confirm' });
  t.confirms.delete(cid);
  resolve(!!approve);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Pocket AI agent server on :${PORT}  (auth ${AUTH ? 'on' : 'OFF'}, allowlist ${ALLOWLIST.length || 'any'})`);
});
