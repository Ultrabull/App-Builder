/* ReplyPlate operator console — restaurant reputation & social, done-for-you.
   Client-side only. Uses your OpenRouter key. Data stays on this device. */
(() => {
  "use strict";
  const ENDPOINT = "https://openrouter.ai/api/v1";
  const S = {
    key: "rp.key", model: "rp.model",
    clients: "rp.clients", active: "rp.active", leads: "rp.leads",
  };
  const $ = (id) => document.getElementById(id);
  const el = (t, c) => { const n = document.createElement(t); if (c) n.className = c; return n; };
  const load = (k, f) => { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch { return f; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  let state = {
    key: load(S.key, ""),
    model: load(S.model, "anthropic/claude-3.5-sonnet"),
    clients: load(S.clients, []),
    activeId: load(S.active, null),
    leads: load(S.leads, []),
  };

  const dom = {
    clientSelect: $("clientSelect"), settingsBtn: $("settingsBtn"),
    settingsModal: $("settingsModal"), settingsClose: $("settingsClose"), settingsSave: $("settingsSave"),
    apiKey: $("apiKey"), modelSel: $("modelSel"),
    clientsList: $("clientsList"),
    cName: $("cName"), cCuisine: $("cCuisine"), cTone: $("cTone"), cReview: $("cReview"), cCity: $("cCity"),
    cSave: $("cSave"), cClear: $("cClear"),
    rvStars: $("rvStars"), rvText: $("rvText"), rvGo: $("rvGo"), rvOut: $("rvOut"),
    grGo: $("grGo"), grOut: $("grOut"),
    soTopic: $("soTopic"), soCount: $("soCount"), soGo: $("soGo"), soOut: $("soOut"),
    prName: $("prName"), prHook: $("prHook"), prChannel: $("prChannel"), prGo: $("prGo"), prOut: $("prOut"),
    leadName: $("leadName"), leadAdd: $("leadAdd"), leadsList: $("leadsList"),
    toast: $("toast"),
  };

  let editingClientId = null;

  /* ---------- helpers ---------- */
  let toastT;
  function toast(m) { dom.toast.textContent = m; dom.toast.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => dom.toast.hidden = true, 2000); }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = el("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {} ta.remove();
    }
    if (btn) { const p = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(() => btn.textContent = p, 1200); }
  }
  const activeClient = () => state.clients.find((c) => c.id === state.activeId) || null;

  async function generate(prompt, system) {
    if (!state.key) { openSettings(); throw new Error("Add your OpenRouter API key in Settings first."); }
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });
    const res = await fetch(ENDPOINT + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.key}`, "X-Title": "ReplyPlate" },
      body: JSON.stringify({ model: state.model, messages }),
    });
    if (!res.ok) {
      let d = ""; try { const j = await res.json(); d = j?.error?.message || ""; } catch {}
      if (res.status === 401) throw new Error("Invalid API key (401).");
      if (res.status === 402) throw new Error("Out of credits (402) — add credits or pick a free model in Settings.");
      throw new Error(d || `Request failed (${res.status}).`);
    }
    const j = await res.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  }

  // Split a numbered/blocked AI response into separate result cards.
  function splitBlocks(text) {
    const parts = text.split(/\n(?=\s*(?:\d+[\.\)]|Option\s*\d|["“]))/i)
      .map((s) => s.replace(/^\s*(?:\d+[\.\)]|Option\s*\d[:.]?)\s*/i, "").trim())
      .filter((s) => s.length > 2);
    return parts.length ? parts : [text.trim()];
  }
  function renderResults(container, blocks) {
    container.innerHTML = "";
    blocks.forEach((b) => {
      const card = el("div", "result");
      const t = el("div", "txt"); t.textContent = b;
      const bar = el("div", "bar");
      const cp = el("button", "copy"); cp.type = "button"; cp.textContent = "Copy";
      cp.addEventListener("click", () => copy(b, cp));
      bar.appendChild(cp);
      card.appendChild(t); card.appendChild(bar);
      container.appendChild(card);
    });
  }
  function setLoading(container) { container.innerHTML = '<div class="loading">Working…</div>'; }
  function setError(container, e) { container.innerHTML = `<div class="loading" style="color:var(--accent)">⚠️ ${e.message || e}</div>`; }

  function clientContext() {
    const c = activeClient();
    if (!c) return "a restaurant";
    let s = `the restaurant "${c.name}"`;
    if (c.cuisine) s += `, described as: ${c.cuisine}`;
    if (c.tone) s += `. Brand voice: ${c.tone}`;
    if (c.city) s += `. Located in ${c.city}`;
    return s;
  }
  function requireClient(container) {
    if (!activeClient()) { setError(container, { message: "Add a client on the Clients tab first." }); return false; }
    return true;
  }

  /* ---------- tabs ---------- */
  function initTabs() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        $("panel-" + tab.dataset.tab).classList.add("active");
      });
    });
  }

  /* ---------- clients ---------- */
  function renderClientSelect() {
    dom.clientSelect.innerHTML = "";
    if (!state.clients.length) {
      const o = el("option"); o.textContent = "— no clients —"; o.value = ""; dom.clientSelect.appendChild(o);
      return;
    }
    state.clients.forEach((c) => { const o = el("option"); o.value = c.id; o.textContent = c.name; dom.clientSelect.appendChild(o); });
    if (state.activeId) dom.clientSelect.value = state.activeId;
  }
  function renderClients() {
    dom.clientsList.innerHTML = "";
    if (!state.clients.length) {
      const e = el("div", "empty"); e.textContent = "No clients yet. Add your first restaurant below."; dom.clientsList.appendChild(e); return;
    }
    state.clients.forEach((c) => {
      const row = el("div", "client-row" + (c.id === state.activeId ? " active" : ""));
      const nm = el("div", "nm"); nm.innerHTML = `${c.name}<small>${[c.cuisine, c.city].filter(Boolean).join(" · ") || "—"}</small>`;
      const use = el("button"); use.type = "button"; use.textContent = c.id === state.activeId ? "✓ Active" : "Use";
      use.addEventListener("click", () => { state.activeId = c.id; save(S.active, c.id); renderClients(); renderClientSelect(); });
      const edit = el("button"); edit.type = "button"; edit.textContent = "Edit";
      edit.addEventListener("click", () => fillClientForm(c));
      const del = el("button"); del.type = "button"; del.textContent = "Delete";
      del.addEventListener("click", () => { if (confirm("Delete " + c.name + "?")) deleteClient(c.id); });
      row.appendChild(nm); row.appendChild(use); row.appendChild(edit); row.appendChild(del);
      dom.clientsList.appendChild(row);
    });
  }
  function fillClientForm(c) {
    editingClientId = c.id;
    dom.cName.value = c.name || ""; dom.cCuisine.value = c.cuisine || ""; dom.cTone.value = c.tone || "";
    dom.cReview.value = c.reviewLink || ""; dom.cCity.value = c.city || "";
    dom.cName.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function clearClientForm() {
    editingClientId = null;
    [dom.cName, dom.cCuisine, dom.cTone, dom.cReview, dom.cCity].forEach((i) => i.value = "");
  }
  function saveClient() {
    const name = dom.cName.value.trim();
    if (!name) { toast("Give the restaurant a name"); return; }
    const data = { name, cuisine: dom.cCuisine.value.trim(), tone: dom.cTone.value.trim(), reviewLink: dom.cReview.value.trim(), city: dom.cCity.value.trim() };
    if (editingClientId) {
      const c = state.clients.find((x) => x.id === editingClientId);
      if (c) Object.assign(c, data);
    } else {
      const c = { id: uid(), ...data };
      state.clients.push(c);
      if (!state.activeId) state.activeId = c.id;
    }
    save(S.clients, state.clients); save(S.active, state.activeId);
    clearClientForm(); renderClients(); renderClientSelect();
    toast("Saved");
  }
  function deleteClient(id) {
    state.clients = state.clients.filter((c) => c.id !== id);
    if (state.activeId === id) state.activeId = state.clients[0] ? state.clients[0].id : null;
    save(S.clients, state.clients); save(S.active, state.activeId);
    renderClients(); renderClientSelect();
  }

  /* ---------- tools ---------- */
  async function doReplies() {
    if (!requireClient(dom.rvOut)) return;
    const review = dom.rvText.value.trim();
    if (!review) { toast("Paste a review first"); return; }
    const stars = dom.rvStars.value;
    setLoading(dom.rvOut); dom.rvGo.disabled = true;
    try {
      const sys = `You write review replies for restaurants. Rules: be warm, specific, and human; match the brand voice; keep each reply 2-4 sentences; thank by name only if the reviewer gave one; for negative reviews, apologize sincerely, take it offline (invite them to contact the restaurant), and never argue or make excuses; NEVER invent facts or confirm private details. Output exactly 3 distinct reply options, numbered 1-3, nothing else.`;
      const prompt = `Write 3 reply options for this ${stars}-star review of ${clientContext()}.\n\nReview:\n"""${review}"""`;
      renderResults(dom.rvOut, splitBlocks(await generate(prompt, sys)));
    } catch (e) { setError(dom.rvOut, e); } finally { dom.rvGo.disabled = false; }
  }

  async function doGetReviews() {
    if (!requireClient(dom.grOut)) return;
    const c = activeClient();
    const link = c.reviewLink || "[your Google review link]";
    setLoading(dom.grOut); dom.grGo.disabled = true;
    try {
      const sys = `You write short, friendly messages a restaurant sends happy customers to request a Google review. Warm, no guilt-trips, easy. Always include the review link exactly as given. Match the brand voice.`;
      const prompt = `For ${clientContext()}, write these, clearly labelled: 1) a text/SMS (under 320 chars), 2) an email (subject + body), 3) a short table-card / receipt line. Use this review link: ${link}`;
      renderResults(dom.grOut, splitBlocks(await generate(prompt, sys)));
    } catch (e) { setError(dom.grOut, e); } finally { dom.grGo.disabled = false; }
  }

  async function doSocial() {
    if (!requireClient(dom.soOut)) return;
    const topic = dom.soTopic.value.trim();
    if (!topic) { toast("What's the post about?"); return; }
    const n = dom.soCount.value;
    setLoading(dom.soOut); dom.soGo.disabled = true;
    try {
      const sys = `You are a social media writer for restaurants. Write scroll-stopping Instagram/Facebook captions: appetising, on-brand, 1-3 short lines, 1-2 tasteful emojis, and 3-6 relevant hashtags at the end. Each post distinct. Output ${n} posts, numbered.`;
      const prompt = `Write ${n} social posts for ${clientContext()}.\nTopic: ${topic}`;
      renderResults(dom.soOut, splitBlocks(await generate(prompt, sys)));
    } catch (e) { setError(dom.soOut, e); } finally { dom.soGo.disabled = false; }
  }

  async function doPitch() {
    const name = dom.prName.value.trim() || "the restaurant";
    const hook = dom.prHook.value.trim();
    const channel = dom.prChannel.value;
    setLoading(dom.prOut); dom.prGo.disabled = true;
    try {
      const sys = `You write cold outreach for a done-for-you service that handles restaurants' online reviews and social media for $199/mo. Be genuine, concise, specific, and low-pressure — lead with value, not hype. No spammy clichés. End with one easy call to action (a quick reply or a free setup). Keep it appropriately short for the channel.`;
      const prompt = `Write a ${channel} outreach message to "${name}".` + (hook ? ` Personalise it around this observation: ${hook}.` : "") + ` The offer: we reply to all their reviews, get them more 5-star reviews, and post to their socials — done for them, from $199/mo, cancel anytime.`;
      renderResults(dom.prOut, [await generate(prompt, sys)]);
    } catch (e) { setError(dom.prOut, e); } finally { dom.prGo.disabled = false; }
  }

  /* ---------- leads ---------- */
  const STAGES = ["To contact", "Contacted", "Replied", "Client 🎉"];
  function renderLeads() {
    dom.leadsList.innerHTML = "";
    if (!state.leads.length) { const e = el("div", "empty"); e.textContent = "No leads yet. Add restaurants to work through."; dom.leadsList.appendChild(e); return; }
    state.leads.forEach((ld) => {
      const row = el("div", "lead" + (ld.stage === 3 ? " client-won" : ld.stage === 1 ? " done" : ""));
      const nm = el("div", "lnm"); nm.textContent = ld.name;
      const sel = el("select");
      STAGES.forEach((s, i) => { const o = el("option"); o.value = i; o.textContent = s; sel.appendChild(o); });
      sel.value = ld.stage;
      sel.addEventListener("change", () => { ld.stage = +sel.value; save(S.leads, state.leads); renderLeads(); });
      const del = el("button", "del"); del.type = "button"; del.textContent = "✕";
      del.addEventListener("click", () => { state.leads = state.leads.filter((x) => x.id !== ld.id); save(S.leads, state.leads); renderLeads(); });
      row.appendChild(nm); row.appendChild(sel); row.appendChild(del);
      dom.leadsList.appendChild(row);
    });
  }
  function addLead() {
    const name = dom.leadName.value.trim(); if (!name) return;
    state.leads.push({ id: uid(), name, stage: 0 });
    save(S.leads, state.leads); dom.leadName.value = ""; renderLeads();
  }

  /* ---------- settings ---------- */
  function openSettings() { dom.apiKey.value = state.key || ""; dom.modelSel.value = state.model; dom.settingsModal.hidden = false; }
  function closeSettings() { dom.settingsModal.hidden = true; }
  function saveSettings() {
    state.key = dom.apiKey.value.trim(); save(S.key, state.key);
    state.model = dom.modelSel.value; save(S.model, state.model);
    closeSettings(); toast("Settings saved");
  }

  /* ---------- wire ---------- */
  function wire() {
    initTabs();
    dom.clientSelect.addEventListener("change", () => { state.activeId = dom.clientSelect.value || null; save(S.active, state.activeId); renderClients(); });
    dom.settingsBtn.addEventListener("click", openSettings);
    dom.settingsClose.addEventListener("click", closeSettings);
    dom.settingsSave.addEventListener("click", saveSettings);
    dom.settingsModal.addEventListener("click", (e) => { if (e.target === dom.settingsModal) closeSettings(); });
    dom.cSave.addEventListener("click", saveClient);
    dom.cClear.addEventListener("click", clearClientForm);
    dom.rvGo.addEventListener("click", doReplies);
    dom.grGo.addEventListener("click", doGetReviews);
    dom.soGo.addEventListener("click", doSocial);
    dom.prGo.addEventListener("click", doPitch);
    dom.leadAdd.addEventListener("click", addLead);
    dom.leadName.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addLead(); } });
  }

  function init() {
    wire();
    renderClients(); renderClientSelect(); renderLeads();
    if (!state.key) setTimeout(openSettings, 400);
  }
  document.addEventListener("DOMContentLoaded", init);
})();
