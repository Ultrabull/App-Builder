/* Pocket AI — browser agent core.
   A model-driven loop that operates a real Chromium page: it reads the page's
   interactive elements, shows the model a screenshot + an indexed element list,
   and executes the single action the model picks. Repeat until "done".

   Deliberately uses the DOM-index approach (not raw pixel clicking) so it works
   with ordinary vision models on OpenRouter, not only dedicated computer-use models. */

// ---- Page inspection -------------------------------------------------------

// Injected into the page: collect visible, interactive elements and tag each
// with a stable index we can act on later.
const COLLECT_FN = `() => {
  const out = [];
  const sel = 'a,button,input,textarea,select,[role=button],[role=link],[onclick],[contenteditable=true]';
  const nodes = document.querySelectorAll(sel);
  let i = 0;
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible = r.width > 1 && r.height > 1 &&
      style.visibility !== 'hidden' && style.display !== 'none' &&
      r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    if (!visible) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    let text = (el.innerText || el.value || el.getAttribute('aria-label') ||
                el.getAttribute('placeholder') || el.getAttribute('name') || '').trim();
    text = text.replace(/\\s+/g, ' ').slice(0, 120);
    el.setAttribute('data-pai-idx', String(i));
    out.push({ index: i, tag, type, text,
               x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    i++;
  }
  return out;
}`;

async function extractElements(page) {
  try {
    return await page.evaluate(`(${COLLECT_FN})()`);
  } catch {
    return [];
  }
}

// ---- Sensitivity gate ------------------------------------------------------

// Words that signal an action a human should confirm before it happens.
const SENSITIVE = /\b(send|submit|pay|buy|purchase|checkout|order|delete|remove|confirm|book|transfer|post|publish|unsubscribe|deactivate|close account)\b/i;

function isSensitive(action, elements) {
  if (action.type === 'click') {
    const el = elements.find((e) => e.index === action.index);
    if (el && SENSITIVE.test(el.text)) return true;
  }
  if (action.type === 'type' && action.submit) return true;
  if (action.type === 'navigate' && SENSITIVE.test(action.url || '')) return true;
  return false;
}

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

// ---- Action execution ------------------------------------------------------

async function execute(page, action, elements) {
  switch (action.type) {
    case 'navigate': {
      let url = action.url || '';
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      break;
    }
    case 'click': {
      const loc = page.locator(`[data-pai-idx="${action.index}"]`).first();
      await loc.click({ timeout: 10000 });
      await page.waitForTimeout(400);
      break;
    }
    case 'type': {
      const loc = page.locator(`[data-pai-idx="${action.index}"]`).first();
      await loc.click({ timeout: 10000 });
      await loc.fill(''); // clear
      await loc.type(String(action.text ?? ''), { delay: 20 });
      if (action.submit) await loc.press('Enter');
      await page.waitForTimeout(400);
      break;
    }
    case 'scroll': {
      const dy = action.direction === 'up' ? -600 : 600;
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(300);
      break;
    }
    case 'wait': {
      await page.waitForTimeout(Math.min(action.ms || 1000, 8000));
      break;
    }
    default:
      throw new Error('unknown action: ' + action.type);
  }
}

// ---- The loop --------------------------------------------------------------

/**
 * Run a task to completion.
 * @param {object} o
 * @param {string} o.task           natural-language goal
 * @param {import('playwright').Page} o.page
 * @param {(ctx:object)=>Promise<object>} o.decide  model call → action object
 * @param {(msg:object)=>void} o.emit               stream events to the client
 * @param {(action:object)=>Promise<boolean>} o.confirm  gate for sensitive steps
 * @param {string[]} [o.allowlist]   allowed hosts; [] means any
 * @param {number} [o.maxSteps]
 */
async function runTask({ task, page, decide, emit, confirm, allowlist = [], maxSteps = 25, hint = null }) {
  const history = [];
  for (let step = 1; step <= maxSteps; step++) {
    const url = page.url();
    const elements = await extractElements(page);

    let shot = null;
    try { shot = await page.screenshot({ type: 'jpeg', quality: 55 }); } catch {}
    emit({ type: 'screenshot', step, url, image: shot ? shot.toString('base64') : null });

    let action;
    try {
      action = await decide({ task, url, elements, history, screenshot: shot, hint });
    } catch (e) {
      emit({ type: 'error', step, message: 'model error: ' + e.message });
      return { ok: false, reason: 'model-error' };
    }
    emit({ type: 'thought', step, thought: action.thought || '', action });

    if (action.type === 'done') {
      // Emit the successful step trace so the client can save/refine it as a
      // reusable skill (Hermes-style self-improvement).
      emit({ type: 'done', summary: action.summary || 'Task complete.', trace: history.slice() });
      return { ok: true, trace: history.slice() };
    }
    if (action.type === 'ask') {
      emit({ type: 'ask', question: action.question || 'I need input to continue.' });
      return { ok: false, reason: 'needs-input', question: action.question };
    }

    // Allowlist check for navigation.
    if (action.type === 'navigate' && allowlist.length) {
      const h = hostOf(/^https?:/i.test(action.url) ? action.url : 'https://' + action.url);
      if (!allowlist.some((a) => h === a || h.endsWith('.' + a))) {
        const ok = await confirm({ ...action, reason: `off-allowlist host: ${h}` });
        if (!ok) { history.push(`blocked navigate to ${h}`); continue; }
      }
    }

    // Sensitive-action gate.
    if (isSensitive(action, elements)) {
      emit({ type: 'confirm-needed', step, action });
      const ok = await confirm(action);
      if (!ok) { history.push(`user declined: ${describe(action, elements)}`); continue; }
    }

    try {
      await execute(page, action, elements);
      history.push(describe(action, elements));
    } catch (e) {
      history.push(`failed: ${describe(action, elements)} (${e.message})`);
      emit({ type: 'action-error', step, message: e.message });
    }
  }
  emit({ type: 'stopped', reason: 'max-steps' });
  return { ok: false, reason: 'max-steps' };
}

function describe(action, elements = []) {
  const el = elements.find((e) => e.index === action.index);
  const label = el ? `"${el.text || el.tag}"` : (action.index != null ? `#${action.index}` : '');
  switch (action.type) {
    case 'navigate': return `navigate → ${action.url}`;
    case 'click': return `click ${label}`;
    case 'type': return `type "${action.text}"${action.submit ? ' + Enter' : ''} into ${label}`;
    case 'scroll': return `scroll ${action.direction || 'down'}`;
    case 'wait': return `wait ${action.ms || 1000}ms`;
    default: return action.type;
  }
}

module.exports = { runTask, extractElements, execute, isSensitive, describe, SENSITIVE };
