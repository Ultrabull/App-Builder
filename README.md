# Pocket AI

A clean, private, mobile-first AI chat assistant — a simple ChatGPT/Claude-style
app that talks to any model on [OpenRouter](https://openrouter.ai) using **your**
API key. No login, no server, no database. Your key and your conversations live
only in your browser.

_Single-page chat · streaming replies · markdown · light/dark · installable PWA_

## Features

- **Chat interface** — your messages on the right, the AI's on the left, with a
  text box and Send button at the bottom.
- **Streaming replies** — answers appear word-by-word as the model types.
- **Markdown rendering** — headings, **bold**, bullet lists, links, and code
  blocks with a one-tap **Copy** button. Every AI message has its own copy button.
- **Model picker** — a dropdown at the top. Defaults to a free model
  (DeepSeek V3) and includes premium options (Claude, GPT-4o, Gemini). Load the
  full live list from OpenRouter, or type any custom model id.
- **Conversation history** — a left side menu with a **New chat** button. Chats
  are saved on your device and restored when you reopen the app.
- **Settings** — a gear icon where you paste your OpenRouter API key (stored
  only in this browser, never hard-coded).
- **Light & dark mode** — with a toggle; follows your system theme by default.
- **Installable (PWA)** — add it to your home screen and it runs like a native app,
  including offline access to the app shell.

## Quick start

1. Get an OpenRouter API key at **https://openrouter.ai/keys** (free models
   available; premium models need account credits).
2. Open the app (see *Running it* below).
3. Tap the **⚙ gear** icon, paste your key, and **Save**.
4. Pick a model at the top and start chatting.

## Running it

It's a plain static site — no build step. Serve the folder over HTTP (a service
worker and the manifest require `http://` or `https://`, not `file://`):

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then open `http://localhost:8000` on your computer or phone. To install on a
phone: open the site in the browser and choose **Add to Home Screen**.

> For a real installable PWA on your phone, host these files on any static host
> (GitHub Pages, Netlify, Vercel, Cloudflare Pages, …) over HTTPS.

## Project structure

```
index.html            # markup and app shell
styles.css            # theming (light/dark) and layout
app.js                # chat logic, streaming, markdown, storage, models
manifest.webmanifest  # PWA metadata
sw.js                 # service worker (offline app shell)
icons/                # app + favicon icons
```

## Privacy

Everything stays on your device. Your API key and chat history are kept in the
browser's `localStorage`. Requests go directly from your browser to OpenRouter;
nothing is sent anywhere else, and there is no backend.

## Notes

- Model availability on OpenRouter changes over time. If a curated model id
  stops working, use **Settings → Refresh model list** or type a current model
  id via **Custom model id…**.
- Free models can be rate-limited; premium models require credits on your
  OpenRouter account.
