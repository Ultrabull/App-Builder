# Pocket AI — Agent Server

The backend that gives Pocket AI the ability to **drive a real browser and do work for you**.
It runs a persistent Chromium in the cloud, takes a plain-language task, and streams back
every step (with screenshots) to Pocket AI on your phone or laptop. You approve anything
sensitive before it happens.

This folder is a standalone service. It is **not** part of the GitHub Pages site.

## How it fits together

```
Pocket AI (phone/web)  ──task──▶  Agent Server (this)  ──drives──▶  Chromium in the cloud
        ▲                                   │
        └──────── live screenshots + steps ─┘   (you approve sensitive actions)
```

- The agent decides actions with **your OpenRouter key**, pointed at a **vision-capable** model.
- Logins persist in a mounted volume, so you sign into the apps you want it to use **once**.
- A shared secret (`AGENT_TOKEN`) means only your Pocket AI can command it.

## Deploy to Railway (~$5/mo)

1. Push this repo to GitHub (already done if you're reading this there).
2. Go to **railway.app** → **New Project** → **Deploy from GitHub repo** → pick this repo.
3. In the service **Settings**:
   - **Root Directory**: `agent-server`
   - **Builder**: Dockerfile (auto-detected).
4. Add a **Volume** mounted at `/data` (keeps you logged in between restarts).
5. Add **Variables** (see `.env.example`):
   - `AGENT_TOKEN` = a long random string (your password for the agent)
   - `CORS_ORIGIN` = `https://ultrabull.github.io`
   - `ALLOWLIST` = optional, e.g. `google.com,gmail.com`
6. Deploy. Railway gives you a public URL like `https://xxxx.up.railway.app`.
7. In **Pocket AI → Settings → Agent**: paste that URL and the same `AGENT_TOKEN`.

Render and Fly.io work the same way (Dockerfile + a volume at `/data` + the env vars).

## Signing the agent into your apps (one time)

Because the cloud browser is separate from your own, you log into the apps you want it to
operate once, and the session is saved in the `/data` volume. (A guided "login mode" is on
the roadmap; until then logins happen during a task via the `ask` pause.)

## Safety model

- **Confirm gate**: any click/step whose label looks like `send / pay / buy / delete / submit /
  book / transfer / publish …` pauses and waits for your approval.
- **Allowlist**: navigation off your allowed hosts asks first.
- **Shared secret**: requests without `AGENT_TOKEN` are rejected.
- **Advice**: don't log the agent into primary banking. Treat it as a capable but supervised
  assistant, not fully autonomous.

## API (for reference)

| Method | Path | Purpose |
|---|---|---|
| POST | `/task` | `{task, apiKey, model, endpoint?, startUrl?}` → `{id}` |
| GET  | `/stream/:id` | Server-Sent Events: `screenshot`, `thought`, `confirm-request`, `done`, … |
| POST | `/confirm/:id` | `{cid, approve}` to answer a confirmation |
| GET  | `/health` | liveness |

## Local test (no key needed)

```
cd agent-server
npm install
npm test          # drives real Chromium with a mock model; proves the loop works
```

## Reality check

This is supervised browser automation driven by a general model. It handles well-structured
tasks on common sites well; it can still misclick on complex or unusual pages. Expect to
watch and occasionally correct it — that's the current state of the art, not a bug here.
