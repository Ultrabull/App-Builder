/* =========================================================================
   Pocket AI — a private, single-page chat client for OpenRouter-compatible
   APIs. No frameworks, no build step. Everything lives in the browser.
   ========================================================================= */
(() => {
  "use strict";

  /* ----------------------------- Config ---------------------------------- */
  const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1";
  const APP_TITLE = "Pocket AI";

  const STORE = {
    key: "pocketai.key",
    chats: "pocketai.chats",
    current: "pocketai.current",
    model: "pocketai.model",
    theme: "pocketai.theme",
    models: "pocketai.modelcache",
    endpoint: "pocketai.endpoint",
    fallback: "pocketai.fallback",
    favorites: "pocketai.favorites",
    autoread: "pocketai.autoread",
    system: "pocketai.system",
    memory: "pocketai.memory",
    skills: "pocketai.skills",
    activeSkill: "pocketai.activeskill",
  };

  // Built-in skills (specialized assistants). Custom ones are stored
  // separately and merged in. "General" = base personality only.
  const DEFAULT_SKILLS = [
    { id: "general", emoji: "💬", name: "General", prompt: "" },
    { id: "builder", emoji: "🛠️", name: "App Builder", prompt: "You are an expert web-app builder. When the user describes an app, tool, game, or page, reply with ONE complete, self-contained HTML document that implements it fully. Put ALL CSS in a <style> tag and ALL JavaScript in a <script> tag, inline. Use NO external files, CDNs, frameworks, or network requests — they are blocked in the preview. Make it clean, responsive, and mobile-friendly. Start with a one-line summary of what you built, then the entire document inside a single ```html code block. When the user asks for changes, return the FULL updated HTML document again, not just the changed part." },
    { id: "writer", emoji: "✍️", name: "Writing coach", prompt: "You are a sharp, encouraging writing partner. Help draft, tighten, and improve writing. Offer a clear version, then note what you changed." },
    { id: "coder", emoji: "💻", name: "Coding buddy", prompt: "You are a concise coding helper. When asked for code, give working, copy-ready snippets with a short explanation. Prefer simple, modern solutions." },
    { id: "chef", emoji: "🍳", name: "Chef", prompt: "You are a friendly home-cooking assistant. Suggest recipes from the ingredients or cravings given, with simple step-by-step instructions and quick substitutions." },
    { id: "tutor", emoji: "🗣️", name: "Language tutor", prompt: "You are a patient language tutor. Hold a natural conversation, gently correct mistakes, and briefly explain the fix. Keep it at the learner's level." },
    { id: "planner", emoji: "🗓️", name: "Planner", prompt: "You help turn goals into clear, realistic, step-by-step plans with priorities and timeframes. Ask for any missing detail first." },
  ];

  // Curated fallback list, used until the live /models endpoint is loaded.
  const CURATED = [
    { group: "Free", id: "deepseek/deepseek-chat-v3-0324:free", name: "DeepSeek V3 (free)" },
    { group: "Free", id: "deepseek/deepseek-r1:free", name: "DeepSeek R1 · reasoning (free)" },
    { group: "Free", id: "qwen/qwen-2.5-72b-instruct:free", name: "Qwen 2.5 72B (free)" },
    { group: "Free", id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (free)" },
    { group: "Premium", id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
    { group: "Premium", id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku" },
    { group: "Premium", id: "openai/gpt-4o", name: "OpenAI GPT-4o" },
    { group: "Premium", id: "openai/gpt-4o-mini", name: "OpenAI GPT-4o mini" },
    { group: "Premium", id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash" },
  ];
  const DEFAULT_MODEL = "deepseek/deepseek-chat-v3-0324:free";
  const MODEL_LIST_CAP = 250;

  // Default "personality" so the assistant behaves like a friendly chat
  // assistant (ChatGPT/Claude style) instead of dumping code walls.
  const DEFAULT_SYSTEM =
    "You are Pocket AI, a warm, capable personal assistant and creative partner. " +
    "Help the user make things — writing, plans, ideas, designs, content, and simple code when asked. " +
    "Reply conversationally in plain language; keep answers focused and easy to read with short paragraphs or bullet points. " +
    "When the user wants to build or create something, guide them step by step and ask one brief clarifying question if the goal is unclear. " +
    "Only include code when the user explicitly asks for it, and keep it clean and copy-ready. " +
    "Be encouraging and down to earth.";

  /* ------------------------- Tiny helpers -------------------------------- */
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  };
  const load = (k, fallback) => {
    try {
      const v = localStorage.getItem(k);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  };
  const save = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  };
  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ------------------------------- State --------------------------------- */
  let state = {
    apiKey: load(STORE.key, ""),
    chats: load(STORE.chats, []),
    currentId: load(STORE.current, null),
    model: load(STORE.model, DEFAULT_MODEL),
    models: load(STORE.models, null),
    endpoint: load(STORE.endpoint, DEFAULT_ENDPOINT),
    fallbackModel: load(STORE.fallback, ""),
    favorites: load(STORE.favorites, []),
    autoRead: load(STORE.autoread, false),
    systemPrompt: load(STORE.system, DEFAULT_SYSTEM),
    memory: load(STORE.memory, []),          // array of fact strings
    customSkills: load(STORE.skills, []),    // user-created skills
    activeSkillId: load(STORE.activeSkill, "general"),
  };
  let controller = null;       // AbortController for the in-flight request
  let streaming = false;
  let pendingImage = null;     // data URL of an attached image (not persisted until sent)

  /* --------------------------- DOM references ---------------------------- */
  const dom = {
    messages: $("messages"),
    chatList: $("chatList"),
    input: $("input"),
    form: $("composerForm"),
    sendBtn: $("sendBtn"),
    hint: $("composerHint"),
    micBtn: $("micBtn"),
    attachBtn: $("attachBtn"),
    fileInput: $("fileInput"),
    attachPreview: $("attachPreview"),
    newChat: $("newChatBtn"),
    menuBtn: $("menuBtn"),
    backdrop: $("backdrop"),
    themeBtn: $("themeBtn"),
    settingsBtn: $("settingsBtn"),
    freeBtn: $("freeBtn"),
    // skills
    skillsBtn: $("skillsBtn"),
    skillsBtnLabel: $("skillsBtnLabel"),
    skillsModal: $("skillsModal"),
    skillsClose: $("skillsClose"),
    skillsList: $("skillsList"),
    skillName: $("skillName"),
    skillPrompt: $("skillPrompt"),
    skillAdd: $("skillAdd"),
    // memory
    memList: $("memList"),
    memInput: $("memInput"),
    memAdd: $("memAdd"),
    // live preview
    previewModal: $("previewModal"),
    previewFrame: $("previewFrame"),
    previewOpen: $("previewOpen"),
    previewSave: $("previewSave"),
    previewClose: $("previewClose"),
    // model picker
    modelBtn: $("modelBtn"),
    modelBtnLabel: $("modelBtnLabel"),
    modelModal: $("modelModal"),
    modelModalClose: $("modelModalClose"),
    modelSearch: $("modelSearch"),
    modelFreeOnly: $("modelFreeOnly"),
    modelList: $("modelList"),
    modelCount: $("modelCount"),
    modelCustomInput: $("modelCustomInput"),
    modelUseCustom: $("modelUseCustom"),
    // settings
    settingsModal: $("settingsModal"),
    settingsClose: $("settingsClose"),
    settingsSave: $("settingsSave"),
    apiKeyInput: $("apiKeyInput"),
    keyReveal: $("keyReveal"),
    keyStatus: $("keyStatus"),
    endpointInput: $("endpointInput"),
    fallbackInput: $("fallbackInput"),
    systemInput: $("systemInput"),
    systemReset: $("systemReset"),
    autoReadToggle: $("autoReadToggle"),
    refreshModels: $("refreshModels"),
    modelsInfo: $("modelsInfo"),
    clearAll: $("clearAll"),
    toast: $("toast"),
  };

  /* ---------------------- Endpoint / URL helpers ------------------------- */
  function normEndpoint(u) {
    u = (u || "").trim().replace(/\/+$/, "");
    return u || DEFAULT_ENDPOINT;
  }
  const chatUrl = () => normEndpoint(state.endpoint) + "/chat/completions";
  const modelsApiUrl = () => normEndpoint(state.endpoint) + "/models";
  function authHeaders(json) {
    const h = { Authorization: `Bearer ${state.apiKey}`, "X-Title": APP_TITLE };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  /* ============================ Markdown ================================= */
  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderInline(text) {
    let s = escapeHtml(text);
    // Protect inline-code contents with a control-character sentinel that
    // cannot appear in already-escaped text (avoids clashing with digits).
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    s = s.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
    return s;
  }

  const escapeAttr = escapeHtml;

  function renderMarkdown(src) {
    const lines = (src || "").replace(/\r\n/g, "\n").split("\n");
    let html = "";
    let i = 0;
    const flushParagraph = (buf) => {
      if (buf.length) html += `<p>${renderInline(buf.join(" "))}</p>`;
      return [];
    };
    let para = [];

    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(/^\s*```(.*)$/);
      if (fence) {
        para = flushParagraph(para);
        const lang = fence[1].trim();
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        const raw = code.join("\n");
        const label = lang || "code";
        html +=
          `<div class="code-block" data-code="${escapeAttr(raw)}">` +
            `<div class="code-head"><span>${escapeHtml(label)}</span>` +
            `<button class="code-copy" type="button" data-copy>` +
              `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.5L14.5 3H9zm5 1.5L17.5 8H14V4.5zM5 7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1H5V7z"/></svg>` +
              `Copy</button></div>` +
            `<pre><code>${escapeHtml(raw)}</code></pre>` +
          `</div>`;
        continue;
      }

      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) { para = flushParagraph(para); const lvl = h[1].length; html += `<h${lvl}>${renderInline(h[2])}</h${lvl}>`; i++; continue; }

      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { para = flushParagraph(para); html += "<hr />"; i++; continue; }

      if (/^\s*>\s?/.test(line)) {
        para = flushParagraph(para);
        const quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        html += `<blockquote>${renderInline(quote.join(" "))}</blockquote>`;
        continue;
      }

      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        para = flushParagraph(para);
        const ordered = /^\s*\d+\.\s+/.test(line);
        const tag = ordered ? "ol" : "ul";
        html += `<${tag}>`;
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          const item = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
          html += `<li>${renderInline(item)}</li>`;
          i++;
        }
        html += `</${tag}>`;
        continue;
      }

      if (/^\s*$/.test(line)) { para = flushParagraph(para); i++; continue; }

      para.push(line.trim());
      i++;
    }
    flushParagraph(para);
    return html;
  }

  // Plain-text extraction from markdown, for text-to-speech.
  function stripMarkdown(md) {
    return (md || "")
      .replace(/```[\s\S]*?```/g, ". code block. ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/[*_~>#]/g, "")
      .replace(/\n{2,}/g, ". ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* -------------------- Message content helpers -------------------------- */
  // A message's content is either a plain string, or an array of parts
  // ({type:"text",text} / {type:"image_url",image_url:{url}}) for vision.
  function msgText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.filter((p) => p.type === "text").map((p) => p.text).join(" ");
    }
    return "";
  }
  function msgImages(content) {
    if (Array.isArray(content)) {
      return content.filter((p) => p.type === "image_url")
        .map((p) => p.image_url && p.image_url.url).filter(Boolean);
    }
    return [];
  }
  function buildUserContent(text, imageDataUrl) {
    if (imageDataUrl) {
      const parts = [];
      if (text) parts.push({ type: "text", text });
      parts.push({ type: "image_url", image_url: { url: imageDataUrl } });
      return parts;
    }
    return text;
  }

  /* ============================ Rendering ================================ */
  function currentChat() {
    return state.chats.find((c) => c.id === state.currentId) || null;
  }

  function renderChatList() {
    dom.chatList.innerHTML = "";
    if (!state.chats.length) {
      const empty = el("div", "chat-empty");
      empty.textContent = "No conversations yet.";
      dom.chatList.appendChild(empty);
      return;
    }
    const sorted = [...state.chats].sort((a, b) => (b.updated || 0) - (a.updated || 0));
    for (const chat of sorted) {
      const item = el("div", "chat-item" + (chat.id === state.currentId ? " active" : ""));
      const title = el("span", "chat-title");
      title.textContent = chat.title || "New chat";
      const del = el("button", "chat-del");
      del.type = "button";
      del.setAttribute("aria-label", "Delete conversation");
      del.innerHTML =
        `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9z"/></svg>`;
      del.addEventListener("click", (e) => { e.stopPropagation(); deleteChat(chat.id); });
      item.appendChild(title);
      item.appendChild(del);
      item.addEventListener("click", () => { selectChat(chat.id); closeSidebar(); });
      dom.chatList.appendChild(item);
    }
  }

  function welcomeScreen() {
    const wrap = el("div", "welcome");
    wrap.innerHTML =
      `<div class="logo"><svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg></div>` +
      `<h1>How can I help?</h1>` +
      `<p>Ask anything, speak it, or attach a photo. Your chats and key stay on this device.</p>`;
    const chips = el("div", "chips");
    const prompts = [
      { t: "🛠️ Build a mini app", build: true },
      { t: "Help me plan a project" },
      { t: "Write a first draft for me" },
      { t: "Brainstorm ideas together" },
    ];
    prompts.forEach(({ t, build }) => {
      const chip = el("button", "chip");
      chip.type = "button";
      chip.textContent = t;
      chip.addEventListener("click", () => {
        if (build) { selectSkill("builder"); dom.input.value = "Build a "; }
        else { dom.input.value = t; }
        autoGrow(); dom.input.focus(); updateSendState();
      });
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
    return wrap;
  }

  function renderMessages() {
    dom.messages.innerHTML = "";
    const chat = currentChat();
    if (!chat || !chat.messages.length) {
      dom.messages.appendChild(welcomeScreen());
      return;
    }
    for (const msg of chat.messages) {
      dom.messages.appendChild(buildMessageRow(msg.role, msg.content));
    }
    scrollToBottom(true);
  }

  function buildMessageRow(role, content) {
    const row = el("div", `msg-row ${role === "user" ? "user" : "ai"}`);
    const bubble = el("div", "bubble");

    if (role === "user") {
      const imgs = msgImages(content);
      imgs.forEach((url) => {
        const im = el("img", "bubble-img");
        im.src = url; im.alt = "attached image"; im.loading = "lazy";
        bubble.appendChild(im);
      });
      const text = msgText(content);
      if (text) {
        const t = el("div", "bubble-text");
        t.textContent = text;
        bubble.appendChild(t);
      }
      row.appendChild(bubble);
    } else {
      const text = msgText(content);
      bubble.innerHTML = renderMarkdown(text);
      row.appendChild(bubble);

      const tools = el("div", "msg-tools");
      const copyBtn = el("button", "msg-tool-btn");
      copyBtn.type = "button";
      copyBtn.innerHTML =
        `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.5L14.5 3H9zm5 1.5L17.5 8H14V4.5zM5 7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1H5V7z"/></svg> Copy`;
      copyBtn.addEventListener("click", () => copyText(text, copyBtn));
      tools.appendChild(copyBtn);

      if (ttsSupported()) {
        const speakBtn = el("button", "msg-tool-btn");
        speakBtn.type = "button";
        speakBtn.innerHTML =
          `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 5V4L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zm-2.5-9v2.1a7 7 0 0 1 0 13.8V21a9 9 0 0 0 0-18z"/></svg> <span>Read</span>`;
        speakBtn.addEventListener("click", () => speak(text, speakBtn));
        tools.appendChild(speakBtn);
      }
      row.appendChild(tools);
      enhanceCodeBlocks(bubble);
    }
    return row;
  }

  function scrollToBottom(force) {
    const m = dom.messages;
    const nearBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 140;
    if (force || nearBottom) m.scrollTop = m.scrollHeight;
  }

  /* ========================= Chat management ============================= */
  function persist() {
    save(STORE.chats, state.chats);
    save(STORE.current, state.currentId);
  }

  function newChat(focus) {
    const existingEmpty = state.chats.find((c) => c.messages.length === 0);
    if (existingEmpty) {
      state.currentId = existingEmpty.id;
    } else {
      const chat = { id: uid(), title: "New chat", messages: [], updated: Date.now() };
      state.chats.unshift(chat);
      state.currentId = chat.id;
    }
    persist();
    renderChatList();
    renderMessages();
    if (focus) dom.input.focus();
  }

  function selectChat(id) {
    if (streaming) stopStreaming();
    state.currentId = id;
    save(STORE.current, id);
    renderChatList();
    renderMessages();
  }

  function deleteChat(id) {
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.currentId === id) state.currentId = state.chats.length ? state.chats[0].id : null;
    persist();
    renderChatList();
    if (!state.chats.length) newChat(false);
    else renderMessages();
  }

  function ensureChat() {
    if (!currentChat()) newChat(false);
    return currentChat();
  }

  function titleFrom(text) {
    const t = (text || "").trim().replace(/\s+/g, " ");
    return t.length > 42 ? t.slice(0, 42) + "…" : t || "New chat";
  }

  /* ========================= Streaming call ============================= */
  // Streams one completion for `model` into `bubble`, accumulating into
  // out.text. Throws on HTTP error or abort.
  async function streamChat(model, messages, bubble, signal, out) {
    out.text = "";
    let firstToken = true;
    bubble.classList.remove("error-bubble");
    bubble.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;

    const res = await fetch(chatUrl(), {
      method: "POST",
      signal,
      headers: authHeaders(true),
      body: JSON.stringify({ model, stream: true, messages }),
    });
    if (!res.ok) throw new Error(await safeErr(res));
    if (!res.body) throw new Error("Streaming not supported by this response.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            if (firstToken) { firstToken = false; bubble.innerHTML = ""; }
            out.text += delta;
            bubble.innerHTML = renderMarkdown(out.text);
            bubble.classList.add("cursor-blink");
            scrollToBottom(false);
          }
        } catch { /* keep-alive / partial frame */ }
      }
    }
    bubble.classList.remove("cursor-blink");
    return out.text;
  }

  async function sendMessage(text) {
    if (!state.apiKey) {
      openSettings();
      setHint("Add your API key in Settings to start chatting.", true);
      return;
    }
    const image = pendingImage;
    if (!text && !image) return;

    // "remember that …" / "remember: …" quietly saves a fact to memory.
    const rem = text.match(/^\s*remember(?:\s+that\b|\s*:)\s*(.+)$/i);
    if (rem) { addMemory(rem[1].trim()); showToast("Saved to memory"); }

    const chat = ensureChat();
    const wasEmpty = chat.messages.length === 0;
    const content = buildUserContent(text, image);

    chat.messages.push({ role: "user", content });
    if (wasEmpty) chat.title = titleFrom(text || (image ? "📷 Image" : ""));
    chat.updated = Date.now();
    clearPendingImage();
    persist();
    renderChatList();

    if (wasEmpty) dom.messages.innerHTML = "";
    dom.messages.appendChild(buildMessageRow("user", content));
    scrollToBottom(true);

    const aiRow = el("div", "msg-row ai");
    const bubble = el("div", "bubble");
    bubble.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;
    aiRow.appendChild(bubble);
    dom.messages.appendChild(aiRow);
    scrollToBottom(true);

    setStreaming(true);
    controller = new AbortController();
    const payload = chat.messages.map((m) => ({ role: m.role, content: m.content }));
    const sys = buildSystemMessage();
    if (sys) payload.unshift({ role: "system", content: sys });
    const out = { text: "" };
    let usedFallback = false;

    try {
      try {
        await streamChat(state.model, payload, bubble, controller.signal, out);
      } catch (err) {
        if (err.name === "AbortError") throw err;
        const fb = (state.fallbackModel || "").trim();
        if (fb && fb !== state.model) {
          showToast("Primary failed — trying fallback");
          await streamChat(fb, payload, bubble, controller.signal, out);
          usedFallback = true;
        } else {
          throw err;
        }
      }

      let answer = out.text;
      if (!answer.trim()) answer = "_(No content returned. Try another model or check your credits.)_";
      if (usedFallback) answer = `_↪ answered by fallback: ${state.fallbackModel}_\n\n` + answer;
      bubble.classList.remove("cursor-blink");
      bubble.innerHTML = renderMarkdown(answer);
      finalizeAiMessage(chat, answer, aiRow);
      if (state.autoRead) speak(answer, null);
    } catch (err) {
      bubble.classList.remove("cursor-blink");
      if (err.name === "AbortError") {
        if (out.text.trim()) finalizeAiMessage(chat, out.text, aiRow);
        else aiRow.remove();
      } else {
        bubble.classList.add("error-bubble");
        bubble.innerHTML = renderMarkdown("⚠️ " + (err.message || "Something went wrong."));
      }
    } finally {
      setStreaming(false);
      controller = null;
    }
  }

  function finalizeAiMessage(chat, answer, aiRow) {
    chat.messages.push({ role: "assistant", content: answer });
    chat.updated = Date.now();
    persist();
    renderChatList();
    aiRow.replaceWith(buildMessageRow("assistant", answer));
    scrollToBottom(false);
  }

  async function safeErr(res) {
    let text = "";
    try {
      const j = await res.json();
      text = j?.error?.message || j?.error || "";
      if (typeof text === "object") text = JSON.stringify(text);
    } catch { /* not json */ }
    if (res.status === 401) return "Invalid API key (401). Check it in Settings.";
    if (res.status === 402) return "Out of credits (402). Add credits or pick a free model.";
    if (res.status === 429) return "Rate limited (429). Wait a moment, or try another model.";
    if (res.status === 404) {
      const base = text || "This model isn't available.";
      return base + " — tap the model name above and choose a currently-available Free model.";
    }
    return text ? `${text} (HTTP ${res.status})` : `Request failed (HTTP ${res.status}).`;
  }

  function stopStreaming() {
    if (controller) { try { controller.abort(); } catch {} }
  }

  function setStreaming(on) {
    streaming = on;
    document.body.classList.toggle("streaming", on);
    updateSendState();
  }

  /* ============================ Models ================================== */
  function modelSource() {
    if (state.models && state.models.length) return state.models;
    return CURATED.map((m) => ({
      id: m.id, name: m.name, free: m.group === "Free",
      prompt: null, completion: null, context: null,
    }));
  }

  function modelLabel(id) {
    const src = modelSource();
    const m = src.find((x) => x.id === id);
    if (m) return m.name || m.id;
    return id;
  }
  function updateModelButton() {
    dom.modelBtnLabel.textContent = modelLabel(state.model);
    dom.modelBtnLabel.title = state.model;
  }

  function priceLabel(m) {
    if (m.free) return "Free";
    if (m.prompt == null) return "";
    const inM = m.prompt * 1e6, outM = m.completion * 1e6;
    const f = (n) => n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(2) : n.toFixed(3);
    return `$${f(inM)} in / $${f(outM)} out per 1M`;
  }

  function selectModel(id) {
    if (!id) return;
    state.model = id;
    save(STORE.model, id);
    updateModelButton();
    closeModelModal();
  }

  function toggleFavorite(id) {
    const i = state.favorites.indexOf(id);
    if (i >= 0) state.favorites.splice(i, 1);
    else state.favorites.unshift(id);
    save(STORE.favorites, state.favorites);
    renderModelList();
  }

  function renderModelList() {
    const term = (dom.modelSearch.value || "").toLowerCase().trim();
    const freeOnly = dom.modelFreeOnly.checked;
    const favs = new Set(state.favorites);
    const src = modelSource();

    let items = src.filter((m) => {
      if (freeOnly && !m.free) return false;
      if (term && !(m.id.toLowerCase().includes(term) || (m.name || "").toLowerCase().includes(term))) return false;
      return true;
    });
    items.sort((a, b) => {
      const fa = favs.has(a.id), fb = favs.has(b.id);
      if (fa !== fb) return fa ? -1 : 1;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });

    const shown = items.slice(0, MODEL_LIST_CAP);
    dom.modelList.innerHTML = "";
    if (!shown.length) {
      const e = el("div", "model-empty");
      e.textContent = "No models match. Try a different search, or use a custom id below.";
      dom.modelList.appendChild(e);
    }
    for (const m of shown) {
      const row = el("div", "model-row" + (m.id === state.model ? " selected" : ""));

      const star = el("button", "model-star" + (favs.has(m.id) ? " on" : ""));
      star.type = "button";
      star.textContent = favs.has(m.id) ? "★" : "☆";
      star.setAttribute("aria-label", favs.has(m.id) ? "Unfavorite" : "Favorite");
      star.addEventListener("click", (e) => { e.stopPropagation(); toggleFavorite(m.id); });

      const info = el("div", "model-info");
      const nm = el("div", "model-name");
      nm.textContent = m.name || m.id;
      const meta = el("div", "model-meta");
      const idspan = el("span", "model-id");
      idspan.textContent = m.id;
      meta.appendChild(idspan);
      const price = priceLabel(m);
      if (price) {
        const pb = el("span", "model-price" + (m.free ? " free" : ""));
        pb.textContent = price;
        meta.appendChild(pb);
      }
      if (m.context) {
        const cb = el("span", "model-ctx");
        cb.textContent = Math.round(m.context / 1000) + "K ctx";
        meta.appendChild(cb);
      }
      info.appendChild(nm);
      info.appendChild(meta);

      row.appendChild(star);
      row.appendChild(info);
      row.addEventListener("click", () => selectModel(m.id));
      dom.modelList.appendChild(row);
    }
    dom.modelCount.textContent =
      `${items.length} model${items.length === 1 ? "" : "s"}` +
      (items.length > MODEL_LIST_CAP ? ` · showing ${MODEL_LIST_CAP}` : "");
  }

  function openModelModal(preFree) {
    dom.modelModal.hidden = false;
    dom.modelCustomInput.value = "";
    if (preFree) { dom.modelFreeOnly.checked = true; dom.modelSearch.value = ""; }
    renderModelList();
    // Pull the live list (public endpoint; no key required) so free models
    // reflect what's actually available right now.
    if (!state.models) refreshModels();
    else if (preFree) refreshModels();
    setTimeout(() => dom.modelSearch.focus(), 30);
  }
  function closeModelModal() { dom.modelModal.hidden = true; }

  async function refreshModels() {
    if (dom.modelsInfo) dom.modelsInfo.textContent = "Loading models…";
    try {
      const headers = {};
      if (state.apiKey) headers.Authorization = `Bearer ${state.apiKey}`;
      const res = await fetch(modelsApiUrl(), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list = (json.data || [])
        .map((m) => {
          const p = m.pricing || {};
          const prompt = parseFloat(p.prompt) || 0;
          const completion = parseFloat(p.completion) || 0;
          return {
            id: m.id,
            name: m.name || m.id,
            free: prompt === 0 && completion === 0,
            prompt, completion,
            context: m.context_length || (m.top_provider && m.top_provider.context_length) || null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      state.models = list;
      save(STORE.models, list);
      updateModelButton();
      if (!dom.modelModal.hidden) renderModelList();
      if (dom.modelsInfo) dom.modelsInfo.textContent = `Loaded ${list.length} models.`;
    } catch (err) {
      if (dom.modelsInfo) dom.modelsInfo.textContent =
        "Couldn't load models (" + (err.message || "error") + "). Using the built-in list.";
    }
  }

  // If the selected model has been retired by the provider, quietly switch
  // to a currently-available free model so the app never dead-ends.
  async function healModelIfRetired() {
    if (!state.apiKey) return;
    await refreshModels();
    if (!state.models || !state.models.length) return;
    if (state.models.some((m) => m.id === state.model)) return; // still valid
    const replacement = state.models.find((m) => m.free) || state.models[0];
    if (!replacement) return;
    state.model = replacement.id;
    save(STORE.model, replacement.id);
    updateModelButton();
    showToast("Your model was retired — switched to " + (replacement.name || replacement.id));
  }

  /* ============================ Voice: input ============================ */
  let recognition = null;
  let listening = false;
  let micBase = "";

  const speechSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  function setupRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (e) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      dom.input.value = (micBase ? micBase + " " : "") + txt;
      autoGrow();
      updateSendState();
    };
    recognition.onend = () => { listening = false; dom.micBtn.classList.remove("active"); };
    recognition.onerror = (e) => {
      listening = false;
      dom.micBtn.classList.remove("active");
      if (e.error === "not-allowed" || e.error === "service-not-allowed") showToast("Microphone permission denied");
      else if (e.error === "no-speech") showToast("Didn't catch that — try again");
    };
  }

  function toggleMic() {
    if (!speechSupported()) { showToast("Voice input isn't supported in this browser"); return; }
    if (!recognition) setupRecognition();
    if (listening) { try { recognition.stop(); } catch {} return; }
    micBase = dom.input.value.trim();
    try {
      recognition.start();
      listening = true;
      dom.micBtn.classList.add("active");
    } catch { /* start() throws if already active */ }
  }

  /* ============================ Voice: output =========================== */
  let speakingBtn = null;
  const ttsSupported = () => "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  function speak(md, btn) {
    if (!ttsSupported()) return;
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) {
      synth.cancel();
      const wasSame = speakingBtn === btn;
      if (speakingBtn) speakingBtn.classList.remove("speaking");
      speakingBtn = null;
      if (wasSame) return; // clicking the active button stops it
    }
    const text = stripMarkdown(md);
    if (!text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || "en-US";
    const clear = () => { if (btn) btn.classList.remove("speaking"); if (speakingBtn === btn) speakingBtn = null; };
    u.onend = clear;
    u.onerror = clear;
    if (btn) btn.classList.add("speaking");
    speakingBtn = btn;
    synth.speak(u);
  }

  /* ============================ Vision: attach ========================== */
  function fileToDownscaledDataURL(file, maxDim = 1024, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = el("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        try { resolve(canvas.toDataURL("image/jpeg", quality)); }
        catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
      img.src = url;
    });
  }

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("Please choose an image"); return; }
    try {
      pendingImage = await fileToDownscaledDataURL(file);
      showAttachPreview(pendingImage);
      updateSendState();
    } catch {
      showToast("Couldn't process that image");
    }
  }

  function showAttachPreview(dataUrl) {
    dom.attachPreview.innerHTML = "";
    const thumb = el("div", "attach-thumb");
    const im = el("img");
    im.src = dataUrl; im.alt = "attachment preview";
    thumb.appendChild(im);
    const rm = el("button", "attach-remove");
    rm.type = "button";
    rm.textContent = "✕";
    rm.setAttribute("aria-label", "Remove image");
    rm.addEventListener("click", clearPendingImage);
    thumb.appendChild(rm);
    dom.attachPreview.appendChild(thumb);
    dom.attachPreview.hidden = false;
  }

  function clearPendingImage() {
    pendingImage = null;
    dom.attachPreview.hidden = true;
    dom.attachPreview.innerHTML = "";
    dom.fileInput.value = "";
    updateSendState();
  }

  /* ======================= App preview / export ======================= */
  let previewCode = "";
  const looksLikeHtmlDoc = (code) => /<!doctype html|<html[\s>]|<body[\s>]/i.test(code || "");

  function previewApp(code) {
    previewCode = code;
    // Sandboxed iframe (no allow-same-origin) — the generated app runs
    // isolated and cannot read this page's storage or your API key.
    dom.previewFrame.srcdoc = code;
    dom.previewModal.hidden = false;
  }
  function closePreview() {
    dom.previewModal.hidden = true;
    dom.previewFrame.srcdoc = "";
  }
  const htmlBlobUrl = (code) => URL.createObjectURL(new Blob([code], { type: "text/html" }));
  function openInTab(code) {
    const url = htmlBlobUrl(code);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function downloadHtml(code) {
    const a = el("a");
    a.href = htmlBlobUrl(code);
    a.download = "app.html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    showToast("Saved app.html");
  }

  // Give any full-HTML code block Preview / Open / Save actions.
  function enhanceCodeBlocks(container) {
    container.querySelectorAll(".code-block").forEach((block) => {
      if (block.dataset.enhanced) return;
      const code = block.getAttribute("data-code") || "";
      if (!looksLikeHtmlDoc(code)) return;
      block.dataset.enhanced = "1";
      const head = block.querySelector(".code-head");
      if (!head) return;
      const mk = (label, fn) => {
        const b = el("button", "code-copy");
        b.type = "button";
        b.textContent = label;
        b.addEventListener("click", fn);
        return b;
      };
      head.appendChild(mk("▶ Preview", () => previewApp(code)));
      head.appendChild(mk("↗ Open", () => openInTab(code)));
      head.appendChild(mk("⬇ Save", () => downloadHtml(code)));
    });
  }

  /* ============================ Skills ================================= */
  function allSkills() { return DEFAULT_SKILLS.concat(state.customSkills); }
  function activeSkill() {
    return allSkills().find((s) => s.id === state.activeSkillId) || DEFAULT_SKILLS[0];
  }
  function updateSkillsButton() {
    const s = activeSkill();
    dom.skillsBtnLabel.textContent = s.id === "general" ? "Skills" : `${s.emoji} ${s.name}`;
    dom.input.placeholder = s.id === "builder"
      ? "Describe an app to build…"
      : "Message, or tap the mic…";
  }

  function renderSkills() {
    const list = allSkills();
    dom.skillsList.innerHTML = "";
    for (const s of list) {
      const row = el("div", "model-row" + (s.id === state.activeSkillId ? " selected" : ""));
      const info = el("div", "model-info");
      const nm = el("div", "model-name");
      nm.textContent = `${s.emoji} ${s.name}`;
      info.appendChild(nm);
      if (s.prompt) {
        const meta = el("div", "model-meta");
        const desc = el("span", "model-id");
        desc.textContent = s.prompt.length > 90 ? s.prompt.slice(0, 90) + "…" : s.prompt;
        meta.appendChild(desc);
        info.appendChild(meta);
      }
      row.appendChild(info);
      if (!DEFAULT_SKILLS.some((d) => d.id === s.id)) {
        const del = el("button", "model-star");
        del.type = "button";
        del.textContent = "🗑";
        del.setAttribute("aria-label", "Delete skill");
        del.addEventListener("click", (e) => { e.stopPropagation(); deleteSkill(s.id); });
        row.appendChild(del);
      }
      row.addEventListener("click", () => selectSkill(s.id));
      dom.skillsList.appendChild(row);
    }
  }

  function selectSkill(id) {
    state.activeSkillId = id;
    save(STORE.activeSkill, id);
    updateSkillsButton();
    renderSkills();
    const s = activeSkill();
    showToast(s.id === "general" ? "Skill: General" : `Skill: ${s.emoji} ${s.name}`);
    closeSkillsModal();
    closeSidebar();
  }

  function addCustomSkill() {
    const name = dom.skillName.value.trim();
    const prompt = dom.skillPrompt.value.trim();
    if (!name || !prompt) { showToast("Add a name and instructions"); return; }
    const skill = { id: "custom-" + uid(), emoji: "⭐", name, prompt };
    state.customSkills.push(skill);
    save(STORE.skills, state.customSkills);
    dom.skillName.value = "";
    dom.skillPrompt.value = "";
    selectSkill(skill.id);
  }

  function deleteSkill(id) {
    state.customSkills = state.customSkills.filter((s) => s.id !== id);
    save(STORE.skills, state.customSkills);
    if (state.activeSkillId === id) { state.activeSkillId = "general"; save(STORE.activeSkill, "general"); updateSkillsButton(); }
    renderSkills();
  }

  function openSkillsModal() { renderSkills(); dom.skillsModal.hidden = false; }
  function closeSkillsModal() { dom.skillsModal.hidden = true; }

  /* ============================ Memory ================================= */
  function renderMemory() {
    dom.memList.innerHTML = "";
    if (!state.memory.length) {
      const e = el("div", "mem-empty");
      e.textContent = "No memories yet.";
      dom.memList.appendChild(e);
      return;
    }
    state.memory.forEach((fact, i) => {
      const item = el("div", "mem-item");
      const span = el("span");
      span.textContent = fact;
      const del = el("button", "mem-del");
      del.type = "button";
      del.textContent = "✕";
      del.setAttribute("aria-label", "Delete memory");
      del.addEventListener("click", () => removeMemory(i));
      item.appendChild(span);
      item.appendChild(del);
      dom.memList.appendChild(item);
    });
  }

  function addMemory(fact) {
    fact = (fact || "").trim();
    if (!fact) return;
    if (state.memory.some((m) => m.toLowerCase() === fact.toLowerCase())) return;
    state.memory.push(fact);
    save(STORE.memory, state.memory);
    renderMemory();
  }

  function removeMemory(i) {
    state.memory.splice(i, 1);
    save(STORE.memory, state.memory);
    renderMemory();
  }

  // Assemble the full system message: personality + active skill + memory.
  function buildSystemMessage() {
    const parts = [];
    const base = (state.systemPrompt || "").trim();
    if (base) parts.push(base);
    const sk = activeSkill();
    if (sk && sk.prompt && sk.prompt.trim()) {
      parts.push(`For this conversation, take on this role — ${sk.name}: ${sk.prompt.trim()}`);
    }
    if (state.memory && state.memory.length) {
      parts.push("Things to remember about the user:\n" + state.memory.map((m) => "- " + m).join("\n"));
    }
    return parts.join("\n\n");
  }

  /* ============================ Settings ================================ */
  function openSettings() {
    renderMemory();
    dom.apiKeyInput.value = state.apiKey || "";
    dom.endpointInput.value = state.endpoint || DEFAULT_ENDPOINT;
    dom.fallbackInput.value = state.fallbackModel || "";
    dom.systemInput.value = state.systemPrompt || "";
    dom.autoReadToggle.checked = !!state.autoRead;
    dom.keyStatus.textContent = "";
    dom.keyStatus.className = "field-status";
    dom.settingsModal.hidden = false;
  }
  function closeSettings() { dom.settingsModal.hidden = true; }

  function saveSettings() {
    state.apiKey = dom.apiKeyInput.value.trim();
    save(STORE.key, state.apiKey);

    const newEndpoint = normEndpoint(dom.endpointInput.value);
    if (newEndpoint !== normEndpoint(state.endpoint)) {
      // Endpoint changed — cached models are from the old provider.
      state.models = null;
      save(STORE.models, null);
    }
    state.endpoint = newEndpoint;
    save(STORE.endpoint, newEndpoint);

    state.fallbackModel = dom.fallbackInput.value.trim();
    save(STORE.fallback, state.fallbackModel);

    state.systemPrompt = dom.systemInput.value;
    save(STORE.system, state.systemPrompt);

    state.autoRead = dom.autoReadToggle.checked;
    save(STORE.autoread, state.autoRead);

    updateModelButton();
    closeSettings();
    if (state.apiKey) setHint("");
    showToast("Settings saved");
  }

  /* ============================= Theme ================================= */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    save(STORE.theme, theme);
  }
  function initTheme() {
    const saved = load(STORE.theme, null);
    if (saved) { applyTheme(saved); return; }
    applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  }

  /* ============================ UI utils =============================== */
  function autoGrow() {
    dom.input.style.height = "auto";
    dom.input.style.height = Math.min(dom.input.scrollHeight, 180) + "px";
  }
  function updateSendState() {
    if (streaming) { dom.sendBtn.disabled = false; return; }
    dom.sendBtn.disabled = dom.input.value.trim().length === 0 && !pendingImage;
  }
  function setHint(text, isError) {
    dom.hint.innerHTML = text;
    dom.hint.style.color = isError ? "var(--danger)" : "var(--text-dim)";
  }

  let toastTimer = null;
  function showToast(msg) {
    dom.toast.textContent = msg;
    dom.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 1900);
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = el("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      ta.remove();
    }
    if (btn) {
      const prev = btn.innerHTML;
      btn.innerHTML = "✓ Copied";
      setTimeout(() => { btn.innerHTML = prev; }, 1200);
    } else {
      showToast("Copied");
    }
  }

  function openSidebar() { document.body.classList.add("sidebar-open"); dom.backdrop.hidden = false; }
  function closeSidebar() { document.body.classList.remove("sidebar-open"); dom.backdrop.hidden = true; }

  /* ============================== Events =============================== */
  function wireEvents() {
    dom.form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (streaming) { stopStreaming(); return; }
      const text = dom.input.value.trim();
      if (!text && !pendingImage) return;
      dom.input.value = "";
      autoGrow();
      updateSendState();
      sendMessage(text);
    });

    dom.input.addEventListener("input", () => { autoGrow(); updateSendState(); });
    dom.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !isTouch()) { e.preventDefault(); dom.form.requestSubmit(); }
    });

    dom.newChat.addEventListener("click", () => { newChat(true); closeSidebar(); });

    // Skills
    dom.skillsBtn.addEventListener("click", openSkillsModal);
    dom.skillsClose.addEventListener("click", closeSkillsModal);
    dom.skillsModal.addEventListener("click", (e) => { if (e.target === dom.skillsModal) closeSkillsModal(); });
    dom.skillAdd.addEventListener("click", addCustomSkill);

    // Live preview
    dom.previewClose.addEventListener("click", closePreview);
    dom.previewOpen.addEventListener("click", () => openInTab(previewCode));
    dom.previewSave.addEventListener("click", () => downloadHtml(previewCode));

    // Memory
    dom.memAdd.addEventListener("click", () => { addMemory(dom.memInput.value); dom.memInput.value = ""; });
    dom.memInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addMemory(dom.memInput.value); dom.memInput.value = ""; }
    });

    dom.menuBtn.addEventListener("click", openSidebar);
    dom.backdrop.addEventListener("click", closeSidebar);
    dom.themeBtn.addEventListener("click", toggleTheme);

    // Voice + attach
    dom.micBtn.addEventListener("click", toggleMic);
    dom.attachBtn.addEventListener("click", () => dom.fileInput.click());
    dom.fileInput.addEventListener("change", (e) => handleFile(e.target.files && e.target.files[0]));

    // Model picker
    dom.modelBtn.addEventListener("click", () => openModelModal(false));
    dom.freeBtn.addEventListener("click", () => openModelModal(true));
    dom.modelModalClose.addEventListener("click", closeModelModal);
    dom.modelModal.addEventListener("click", (e) => { if (e.target === dom.modelModal) closeModelModal(); });
    dom.modelSearch.addEventListener("input", renderModelList);
    dom.modelFreeOnly.addEventListener("change", renderModelList);
    dom.modelUseCustom.addEventListener("click", () => selectModel(dom.modelCustomInput.value.trim()));
    dom.modelCustomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); selectModel(dom.modelCustomInput.value.trim()); }
    });

    // Settings
    dom.settingsBtn.addEventListener("click", openSettings);
    dom.settingsClose.addEventListener("click", closeSettings);
    dom.settingsSave.addEventListener("click", saveSettings);
    dom.settingsModal.addEventListener("click", (e) => { if (e.target === dom.settingsModal) closeSettings(); });
    dom.keyReveal.addEventListener("click", () => {
      const isPw = dom.apiKeyInput.type === "password";
      dom.apiKeyInput.type = isPw ? "text" : "password";
      dom.keyReveal.textContent = isPw ? "Hide" : "Show";
    });
    dom.systemReset.addEventListener("click", () => { dom.systemInput.value = DEFAULT_SYSTEM; });
    dom.refreshModels.addEventListener("click", refreshModels);
    dom.clearAll.addEventListener("click", () => {
      if (confirm("Delete ALL conversations from this device? This cannot be undone.")) {
        state.chats = [];
        state.currentId = null;
        persist();
        newChat(false);
        renderChatList();
        showToast("All chats deleted");
      }
    });

    // Copy handler for code blocks (delegated)
    dom.messages.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-copy]");
      if (!btn) return;
      const block = btn.closest(".code-block");
      if (block) copyText(block.getAttribute("data-code") || "", btn);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!dom.previewModal.hidden) closePreview();
      else if (!dom.settingsModal.hidden) closeSettings();
      else if (!dom.modelModal.hidden) closeModelModal();
      else if (!dom.skillsModal.hidden) closeSkillsModal();
      else closeSidebar();
    });

    window.addEventListener("beforeunload", () => { if (streaming) stopStreaming(); });
  }

  const isTouch = () => window.matchMedia("(pointer: coarse)").matches;

  // iOS Safari does not shrink the layout for the on-screen keyboard, which
  // pushes the fixed-height UI off-screen. Size the app to the *visual*
  // viewport instead so it always fits the space above the keyboard.
  function syncViewportHeight() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--app-h", h + "px");
    if (vv && vv.offsetTop > 0) window.scrollTo(0, 0);
  }

  function setupViewport() {
    syncViewportHeight();
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncViewportHeight);
      window.visualViewport.addEventListener("scroll", syncViewportHeight);
    }
    window.addEventListener("resize", syncViewportHeight);
    window.addEventListener("orientationchange", () => setTimeout(syncViewportHeight, 200));
    // When the field is focused (keyboard opens), re-fit and reveal the latest message.
    dom.input.addEventListener("focus", () => setTimeout(() => { syncViewportHeight(); scrollToBottom(true); }, 300));
  }

  /* ============================ Startup =============================== */
  function init() {
    initTheme();
    updateModelButton();
    updateSkillsButton();
    renderChatList();

    if (!state.chats.length || !currentChat()) newChat(false);
    else renderMessages();

    wireEvents();
    setupViewport();
    updateSendState();

    // Hide voice-input button where unsupported (e.g. some desktop browsers).
    if (!speechSupported()) dom.micBtn.hidden = true;

    if (!state.apiKey) setHint("Tap the gear icon and add your OpenRouter API key to begin.");
    else healModelIfRetired();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
