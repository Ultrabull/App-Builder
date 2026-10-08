/* Plumbing test — proves the risky parts (element extraction + action execution)
   work against a real Chromium, using a MOCK model so no API key/network is needed.
   Run: node test-plumbing.js  */

const { chromium } = require('playwright');
const { runTask, extractElements } = require('./agent');

const PAGE = `data:text/html,` + encodeURIComponent(`
<!doctype html><meta charset=utf-8>
<style>body{font:16px sans-serif;padding:20px}input{font-size:16px;padding:6px}</style>
<h1>Test Form</h1>
<input id="q" placeholder="Search box">
<button id="go" onclick="document.getElementById('out').textContent='RESULT:'+document.getElementById('q').value">Search</button>
<button id="danger">Delete account</button>
<p id="out">(empty)</p>
`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅', m); } else { fail++; console.log('  ❌', m); } };

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });

  // 1. Element extraction finds the field and both buttons, with indices.
  const els = await extractElements(page);
  const input = els.find((e) => e.tag === 'input');
  const goBtn = els.find((e) => /search/i.test(e.text) && e.tag === 'button');
  const delBtn = els.find((e) => /delete/i.test(e.text));
  ok(input && goBtn && delBtn, `extracted field + buttons (${els.length} elements)`);

  // 2. A scripted "model" drives: type into the field, click Search, then done.
  const script = [
    { thought: 'type the query', type: 'type', index: input.index, text: 'hello world', submit: false },
    { thought: 'click search', type: 'click', index: goBtn.index },
    { thought: 'finished', type: 'done', summary: 'typed and searched' },
  ];
  let step = 0;
  const events = [];
  const decide = async () => script[step++];
  const emit = (m) => events.push(m);
  const confirm = async () => true; // auto-approve (not expected to trigger here)

  const result = await runTask({ task: 'search hello world', page, decide, emit, confirm, maxSteps: 6 });

  ok(result.ok, 'loop completed with done');
  const outText = await page.locator('#out').textContent();
  ok(outText === 'RESULT:hello world', `action executed in page DOM: "${outText}"`);
  ok(events.some((e) => e.type === 'screenshot' && e.image), 'screenshots were emitted (base64)');
  ok(events.some((e) => e.type === 'done'), 'done event emitted');

  // 3. Sensitivity gate: clicking "Delete account" must request confirmation.
  const els2 = await extractElements(page);
  const del = els2.find((e) => /delete/i.test(e.text));
  let confirmAsked = false;
  const script2 = [
    { thought: 'click delete', type: 'click', index: del.index },
    { thought: 'done', type: 'done', summary: 'stopped' },
  ];
  let s2 = 0;
  await runTask({
    task: 'delete the account', page,
    decide: async () => script2[s2++],
    emit: () => {},
    confirm: async () => { confirmAsked = true; return false; }, // deny
    maxSteps: 4,
  });
  ok(confirmAsked, 'sensitive "Delete account" click triggered a confirm gate');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(2); });
