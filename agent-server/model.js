/* Model adapter: turns the current page state into one decision via OpenRouter.
   Returns a plain action object the agent loop knows how to run. */

const SYSTEM = `You are a careful web-browsing agent operating a real browser for the user.
Each turn you receive: the user's TASK, the current URL, a numbered list of the page's
interactive ELEMENTS, a short HISTORY of what you've already done, and a SCREENSHOT.

Respond with EXACTLY ONE JSON object and nothing else. Shape:
{"thought": "<one short sentence of reasoning>", "type": "<action>", ...fields}

Actions:
- {"type":"navigate","url":"example.com"}            go to a URL
- {"type":"click","index":<n>}                        click element #n from the list
- {"type":"type","index":<n>,"text":"...","submit":true|false}  type into element #n (submit=true presses Enter)
- {"type":"scroll","direction":"down"|"up"}
- {"type":"wait","ms":1000}
- {"type":"ask","question":"..."}                     stop and ask the user (use when you need info or a login)
- {"type":"done","summary":"..."}                     the task is finished

Rules:
- Pick elements ONLY by their index number from the ELEMENTS list.
- Do ONE action per turn. Prefer the simplest next step.
- If a login/CAPTCHA/payment is required and you lack what's needed, use "ask".
- When the goal is achieved, use "done" with a brief result summary.`;

function buildUserContent({ task, url, elements, history, screenshot }) {
  const list = elements
    .slice(0, 80)
    .map((e) => `#${e.index} <${e.tag}${e.type ? ' ' + e.type : ''}> ${e.text || ''}`.trim())
    .join('\n');
  const hist = history.length ? history.slice(-12).map((h, i) => `${i + 1}. ${h}`).join('\n') : '(nothing yet)';
  const text =
    `TASK: ${task}\n\nURL: ${url}\n\nHISTORY:\n${hist}\n\nELEMENTS:\n${list || '(none found)'}\n\n` +
    `Decide the single next action as one JSON object.`;

  const content = [{ type: 'text', text }];
  if (screenshot) {
    content.push({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,' + screenshot.toString('base64') },
    });
  }
  return content;
}

function parseAction(raw) {
  if (!raw) throw new Error('empty model response');
  // Strip code fences and grab the first {...} block.
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in response: ' + s.slice(0, 120));
  const obj = JSON.parse(s.slice(start, end + 1));
  if (!obj.type) throw new Error('action missing "type"');
  return obj;
}

/**
 * Factory: returns a `decide` function bound to the given OpenRouter config.
 * @param {object} cfg
 * @param {string} cfg.apiKey      OpenRouter key (sk-or-...)
 * @param {string} cfg.model       model id, must support vision (e.g. "anthropic/claude-3.5-sonnet")
 * @param {string} [cfg.endpoint]  defaults to OpenRouter
 * @param {string} [cfg.referer]   HTTP-Referer for OpenRouter attribution
 */
function makeDecider(cfg) {
  const endpoint = (cfg.endpoint || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  return async function decide(ctx) {
    const body = {
      model: cfg.model,
      temperature: 0,
      max_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUserContent(ctx) },
      ],
    };
    const res = await fetch(endpoint + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
        'HTTP-Referer': cfg.referer || 'https://ultrabull.github.io/App-Builder/',
        'X-Title': 'Pocket AI Agent',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const msg = data.choices?.[0]?.message?.content || '';
    return parseAction(msg);
  };
}

module.exports = { makeDecider, parseAction, buildUserContent, SYSTEM };
