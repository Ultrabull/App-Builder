/* =========================================================================
   Pocket AI — a private, single-page chat client for OpenRouter.
   No frameworks, no build step. Everything lives in the browser.
   ========================================================================= */
(() => {
  "use strict";

  /* ----------------------------- Config ---------------------------------- */
  const API_URL = "https://openrouter.ai/api/v1/chat/completions";
  const MODELS_URL = "https://openrouter.ai/api/v1/models";
  const APP_TITLE = "Pocket AI";

  const STORE = {
    key: "pocketai.key",
    chats: "pocketai.chats",
    current: "pocketai.current",
    model: "pocketai.model",
    theme: "pocketai.theme",
    models: "pocketai.modelcache",
  };

  // Curated fallback list. The live /models endpoint (Settings → Refresh)
  // adds the rest. "Custom…" always lets you paste any model id.
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
  const CUSTOM_VALUE = "__custom__";

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
    chats: load(STORE.chats, []),      // [{id, title, messages:[{role,content}], updated}]
    currentId: load(STORE.current, null),
    model: load(STORE.model, DEFAULT_MODEL),
    models: load(STORE.models, null),  // cached live list or null
  };
  let controller = null;   // AbortController for the in-flight request
  let streaming = false;

  /* --------------------------- DOM references ---------------------------- */
  const dom = {
    messages: $("messages"),
    chatList: $("chatList"),
    input: $("input"),
    form: $("composerForm"),
    sendBtn: $("sendBtn"),
    hint: $("composerHint"),
    modelSelect: $("modelSelect"),
    modelCustom: $("modelCustom"),
    newChat: $("newChatBtn"),
    menuBtn: $("menuBtn"),
    backdrop: $("backdrop"),
    themeBtn: $("themeBtn"),
    settingsBtn: $("settingsBtn"),
    settingsModal: $("settingsModal"),
    settingsClose: $("settingsClose"),
    settingsSave: $("settingsSave"),
    apiKeyInput: $("apiKeyInput"),
    keyReveal: $("keyReveal"),
    keyStatus: $("keyStatus"),
    refreshModels: $("refreshModels"),
    modelsInfo: $("modelsInfo"),
    clearAll: $("clearAll"),
    toast: $("toast"),
  };

  /* ============================ Markdown ================================= */
  /* A small, safe markdown renderer. HTML is escaped first, so no user or
     model content can inject markup. Returns an HTML string.               */

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
    // links [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
    // bold, italic, strikethrough
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    s = s.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    // restore inline code
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
    return s;
  }

  // Escapes for use inside an HTML attribute value.
  function escapeAttr(s) {
    return escapeHtml(s);
  }

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

      // Fenced code block
      const fence = line.match(/^\s*```(.*)$/);
      if (fence) {
        para = flushParagraph(para);
        const lang = fence[1].trim();
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          code.push(lines[i]);
          i++;
        }
        i++; // consume closing fence
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

      // Headings
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        para = flushParagraph(para);
        const lvl = h[1].length;
        html += `<h${lvl}>${renderInline(h[2])}</h${lvl}>`;
        i++;
        continue;
      }

      // Horizontal rule
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        para = flushParagraph(para);
        html += "<hr />";
        i++;
        continue;
      }

      // Blockquote
      if (/^\s*>\s?/.test(line)) {
        para = flushParagraph(para);
        const quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        html += `<blockquote>${renderInline(quote.join(" "))}</blockquote>`;
        continue;
      }

      // Lists (unordered / ordered)
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

      // Blank line ends a paragraph
      if (/^\s*$/.test(line)) {
        para = flushParagraph(para);
        i++;
        continue;
      }

      // Otherwise accumulate paragraph text
      para.push(line.trim());
      i++;
    }
    flushParagraph(para);
    return html;
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
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });
      item.appendChild(title);
      item.appendChild(del);
      item.addEventListener("click", () => {
        selectChat(chat.id);
        closeSidebar();
      });
      dom.chatList.appendChild(item);
    }
  }

  function welcomeScreen() {
    const wrap = el("div", "welcome");
    wrap.innerHTML =
      `<div class="logo"><svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg></div>` +
      `<h1>How can I help?</h1>` +
      `<p>Ask anything. Your chats and API key stay on this device.</p>`;
    const chips = el("div", "chips");
    const prompts = [
      "Explain a tricky concept simply",
      "Write a short poem",
      "Debug this code",
      "Plan my week",
    ];
    prompts.forEach((p) => {
      const chip = el("button", "chip");
      chip.type = "button";
      chip.textContent = p;
      chip.addEventListener("click", () => {
        dom.input.value = p;
        autoGrow();
        dom.input.focus();
        updateSendState();
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
      bubble.textContent = content;
      row.appendChild(bubble);
    } else {
      bubble.innerHTML = renderMarkdown(content);
      row.appendChild(bubble);
      const tools = el("div", "msg-tools");
      const copyBtn = el("button", "msg-tool-btn");
      copyBtn.type = "button";
      copyBtn.innerHTML =
        `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.5L14.5 3H9zm5 1.5L17.5 8H14V4.5zM5 7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1H5V7z"/></svg> Copy`;
      copyBtn.addEventListener("click", () => copyText(content, copyBtn));
      tools.appendChild(copyBtn);
      row.appendChild(tools);
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
    // Reuse an existing empty chat instead of piling up blanks.
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
    if (state.currentId === id) {
      state.currentId = state.chats.length ? state.chats[0].id : null;
    }
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
    const t = text.trim().replace(/\s+/g, " ");
    return t.length > 42 ? t.slice(0, 42) + "…" : t || "New chat";
  }

  /* ========================= OpenRouter calls =========================== */

  async function sendMessage(text) {
    if (!state.apiKey) {
      openSettings();
      setHint("Add your OpenRouter API key to start chatting.", true);
      return;
    }
    const chat = ensureChat();
    const wasEmpty = chat.messages.length === 0;

    chat.messages.push({ role: "user", content: text });
    if (wasEmpty) chat.title = titleFrom(text);
    chat.updated = Date.now();
    persist();
    renderChatList();

    // Render user bubble (clear welcome if present)
    if (wasEmpty) dom.messages.innerHTML = "";
    dom.messages.appendChild(buildMessageRow("user", text));
    scrollToBottom(true);

    // Prepare an AI bubble with a typing indicator
    const aiRow = el("div", "msg-row ai");
    const bubble = el("div", "bubble");
    bubble.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;
    aiRow.appendChild(bubble);
    dom.messages.appendChild(aiRow);
    scrollToBottom(true);

    setStreaming(true);
    let answer = "";
    let firstToken = true;

    try {
      controller = new AbortController();
      const res = await fetch(API_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.apiKey}`,
          "X-Title": APP_TITLE,
        },
        body: JSON.stringify({
          model: state.model,
          stream: true,
          messages: chat.messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const detail = await safeErr(res);
        throw new Error(detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by newlines; parse "data:" lines.
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep the incomplete tail
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
              answer += delta;
              bubble.innerHTML = renderMarkdown(answer);
              bubble.classList.add("cursor-blink");
              scrollToBottom(false);
            }
          } catch { /* ignore keep-alive / partial frames */ }
        }
      }

      bubble.classList.remove("cursor-blink");

      if (!answer.trim()) {
        answer = "_(No content returned. Try another model or check your OpenRouter credits.)_";
        bubble.innerHTML = renderMarkdown(answer);
      }

      // Finalize: rebuild row so it gets its copy button
      finalizeAiMessage(chat, answer, aiRow);
    } catch (err) {
      bubble.classList.remove("cursor-blink");
      if (err.name === "AbortError") {
        if (answer.trim()) {
          finalizeAiMessage(chat, answer, aiRow);
        } else {
          aiRow.remove();
        }
      } else {
        const msg = "⚠️ " + (err.message || "Something went wrong.");
        bubble.classList.add("error-bubble");
        bubble.innerHTML = renderMarkdown(msg);
        // Do not persist error bubbles into history.
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
    const fresh = buildMessageRow("assistant", answer);
    aiRow.replaceWith(fresh);
    scrollToBottom(false);
  }

  async function safeErr(res) {
    let text = "";
    try {
      const j = await res.json();
      text = j?.error?.message || j?.error || "";
    } catch { /* not json */ }
    if (res.status === 401) return "Invalid API key (401). Check it in Settings.";
    if (res.status === 402) return "Out of credits (402). Add credits or pick a free model.";
    if (res.status === 429) return "Rate limited (429). Wait a moment and try again.";
    return text ? `${text} (HTTP ${res.status})` : `Request failed (HTTP ${res.status}).`;
  }

  function stopStreaming() {
    if (controller) {
      try { controller.abort(); } catch {}
    }
  }

  function setStreaming(on) {
    streaming = on;
    document.body.classList.toggle("streaming", on);
    updateSendState();
  }

  /* ============================ Models ================================== */

  function buildModelOptions() {
    const sel = dom.modelSelect;
    sel.innerHTML = "";

    const addOption = (parent, id, label) => {
      const o = el("option");
      o.value = id;
      o.textContent = label;
      parent.appendChild(o);
    };
    const addGroup = (label) => {
      const g = el("optgroup");
      g.label = label;
      sel.appendChild(g);
      return g;
    };

    if (state.models && state.models.length) {
      // Live list, split into Free and Paid, capped for usability.
      const free = state.models.filter((m) => m.free);
      const paid = state.models.filter((m) => !m.free);
      const fg = addGroup(`Free models (${free.length})`);
      free.slice(0, 60).forEach((m) => addOption(fg, m.id, m.name));
      const pg = addGroup(`Other models (${paid.length})`);
      paid.slice(0, 120).forEach((m) => addOption(pg, m.id, m.name));
    } else {
      const groups = {};
      for (const m of CURATED) {
        groups[m.group] = groups[m.group] || addGroup(m.group + " models");
        addOption(groups[m.group], m.id, m.name);
      }
    }

    // Make sure the current model is selectable even if not in the list.
    const known = Array.from(sel.querySelectorAll("option")).some((o) => o.value === state.model);
    if (!known && state.model) {
      const g = addGroup("Current");
      addOption(g, state.model, state.model);
    }

    // Custom entry option
    const cg = addGroup("—");
    addOption(cg, CUSTOM_VALUE, "Custom model id…");

    sel.value = state.model;
    dom.modelCustom.hidden = true;
    dom.modelCustom.style.display = "none";
    dom.modelSelect.style.display = "";
  }

  function onModelChange() {
    const v = dom.modelSelect.value;
    if (v === CUSTOM_VALUE) {
      dom.modelSelect.style.display = "none";
      dom.modelCustom.hidden = false;
      dom.modelCustom.style.display = "";
      dom.modelCustom.value = "";
      dom.modelCustom.focus();
      return;
    }
    state.model = v;
    save(STORE.model, v);
  }

  function commitCustomModel() {
    const v = dom.modelCustom.value.trim();
    if (v) {
      state.model = v;
      save(STORE.model, v);
      buildModelOptions();
    } else {
      // revert to select
      dom.modelCustom.hidden = true;
      dom.modelCustom.style.display = "none";
      dom.modelSelect.style.display = "";
      dom.modelSelect.value = state.model;
    }
  }

  async function refreshModels() {
    dom.modelsInfo.textContent = "Loading models…";
    try {
      const headers = {};
      if (state.apiKey) headers.Authorization = `Bearer ${state.apiKey}`;
      const res = await fetch(MODELS_URL, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list = (json.data || [])
        .map((m) => {
          const p = m.pricing || {};
          const free =
            (parseFloat(p.prompt) || 0) === 0 &&
            (parseFloat(p.completion) || 0) === 0;
          return { id: m.id, name: m.name || m.id, free };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      state.models = list;
      save(STORE.models, list);
      buildModelOptions();
      dom.modelsInfo.textContent = `Loaded ${list.length} models from OpenRouter.`;
    } catch (err) {
      dom.modelsInfo.textContent = "Couldn't load models (" + (err.message || "error") + "). Using curated list.";
    }
  }

  /* ============================ Settings ================================ */

  function openSettings() {
    dom.apiKeyInput.value = state.apiKey || "";
    dom.keyStatus.textContent = "";
    dom.keyStatus.className = "field-status";
    dom.settingsModal.hidden = false;
  }
  function closeSettings() { dom.settingsModal.hidden = true; }

  function saveSettings() {
    const key = dom.apiKeyInput.value.trim();
    state.apiKey = key;
    save(STORE.key, key);
    closeSettings();
    if (key) setHint("");
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
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
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
    dom.sendBtn.disabled = dom.input.value.trim().length === 0;
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
    toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 1800);
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

  function openSidebar() {
    document.body.classList.add("sidebar-open");
    dom.backdrop.hidden = false;
  }
  function closeSidebar() {
    document.body.classList.remove("sidebar-open");
    dom.backdrop.hidden = true;
  }

  /* ============================== Events =============================== */

  function wireEvents() {
    dom.form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (streaming) { stopStreaming(); return; }
      const text = dom.input.value.trim();
      if (!text) return;
      dom.input.value = "";
      autoGrow();
      updateSendState();
      sendMessage(text);
    });

    dom.input.addEventListener("input", () => { autoGrow(); updateSendState(); });
    dom.input.addEventListener("keydown", (e) => {
      // Enter to send on desktop; Shift+Enter for newline. On touch, newline.
      if (e.key === "Enter" && !e.shiftKey && !isTouch()) {
        e.preventDefault();
        dom.form.requestSubmit();
      }
    });

    dom.newChat.addEventListener("click", () => { newChat(true); closeSidebar(); });
    dom.menuBtn.addEventListener("click", openSidebar);
    dom.backdrop.addEventListener("click", closeSidebar);

    dom.themeBtn.addEventListener("click", toggleTheme);

    dom.settingsBtn.addEventListener("click", openSettings);
    dom.settingsClose.addEventListener("click", closeSettings);
    dom.settingsSave.addEventListener("click", saveSettings);
    dom.settingsModal.addEventListener("click", (e) => {
      if (e.target === dom.settingsModal) closeSettings();
    });
    dom.keyReveal.addEventListener("click", () => {
      const isPw = dom.apiKeyInput.type === "password";
      dom.apiKeyInput.type = isPw ? "text" : "password";
      dom.keyReveal.textContent = isPw ? "Hide" : "Show";
    });
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

    dom.modelSelect.addEventListener("change", onModelChange);
    dom.modelCustom.addEventListener("blur", commitCustomModel);
    dom.modelCustom.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); dom.modelCustom.blur(); }
    });

    // Copy handler for code blocks (event delegation)
    dom.messages.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-copy]");
      if (!btn) return;
      const block = btn.closest(".code-block");
      if (block) copyText(block.getAttribute("data-code") || "", btn);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!dom.settingsModal.hidden) closeSettings();
        else closeSidebar();
      }
    });

    window.addEventListener("beforeunload", () => { if (streaming) stopStreaming(); });
  }

  function isTouch() {
    return window.matchMedia("(pointer: coarse)").matches;
  }

  /* ============================ Startup =============================== */

  function init() {
    initTheme();
    buildModelOptions();
    renderChatList();

    if (!state.chats.length || !currentChat()) {
      newChat(false);
    } else {
      renderMessages();
    }

    wireEvents();
    updateSendState();

    if (!state.apiKey) {
      setHint('Tap the gear icon and add your OpenRouter API key to begin.');
    }

    // Register the service worker for offline / installable app.
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
