// Live test of Ask against the real providers (Anthropic, OpenAI, Gemini),
// driving the deployed app in Chrome: Analyst question, a report, and a
// 20-message content-coding run per provider. Costs a few cents per run.
//
//   ORG_SIGNAL_KEYS_ENV=/path/to/.env node test/live/ask-live.mjs <out-dir> [base-url] [providers]
//
// The .env holds ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY. Keys are
// read into memory only, typed into the app (not remembered), and scrubbed
// from everything printed or written. Not part of the test suite (needs keys
// and network). Needs puppeteer-core and Chrome for Testing (PUPPETEER, CHROME
// as in test/ui-core/qa.mjs). First run 2026-10-04: all three pass after the
// Gemini JSON-output fix.
import fs from 'node:fs';
import os from 'node:os';
const { default: puppeteer } = await import(process.env.PUPPETEER || '/Users/ericgladstone/My Drive (eric.c.gladstone@gmail.com)/Projects/Website Graystone Industries/site/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js');
const ENV = process.env.ORG_SIGNAL_KEYS_ENV;
if (!ENV || !process.argv[2]) { console.error('usage: ORG_SIGNAL_KEYS_ENV=/path/.env node test/live/ask-live.mjs <out-dir> [base-url] [providers]'); process.exit(1); }
const env = Object.fromEntries(fs.readFileSync(ENV, 'utf8').split('\n').map(l => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
const KEYS = { anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY, gemini: env.GEMINI_API_KEY };
const OUT = process.argv[2]; const BASE = process.argv[3] || 'https://orgsignal.graystoneindustries.co';
const only = (process.argv[4] || 'anthropic,openai,gemini').split(',');
const CHROME = process.env.CHROME || `${os.homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scrub = s => { let t = String(s); for (const k of Object.values(KEYS)) if (k) t = t.split(k).join('[KEY]'); return t; };
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
const results = {};
for (const prov of only) {
  const r = results[prov] = { errors: [] };
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 1000 });
  p.on('pageerror', e => r.errors.push(scrub(e.message))); p.on('console', m => { if (m.type() === 'error') r.errors.push(scrub(m.text()).slice(0, 300)); });
  p.on('dialog', d => d.accept());
  try {
    await p.goto(BASE + '/#network?v=' + Date.now(), { waitUntil: 'networkidle0' });
    const sample = await p.waitForFunction(() => [...document.querySelectorAll('button,a')].find(e => /Explore the sample/i.test(e.textContent)), { timeout: 30000 });
    await sample.asElement().click();
    await p.waitForFunction(() => /people and [\d,]+ ties/.test(document.querySelector('main')?.innerText || ''), { timeout: 120000 });
    await p.evaluate(() => { location.hash = '#ask'; });
    await p.waitForSelector('#prov-h', { timeout: 30000 }); await sleep(800);
    // provider select: the <select> inside the field labelled "Provider"
    await p.evaluate((id) => { const lab = [...document.querySelectorAll('label, .field')].find(l => /^\s*Provider/.test(l.textContent)); const s = lab?.querySelector('select') || document.querySelector('select'); s.value = id; s.dispatchEvent(new Event('change', { bubbles: true })); s.dispatchEvent(new Event('input', { bubbles: true })); }, prov);
    await sleep(600);
    await p.type('input[type=password]', KEYS[prov], { delay: 0 });
    await p.evaluate(() => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Use this key').click());
    await p.waitForFunction(() => /held in memory for this tab/.test(document.body.innerText), { timeout: 30000 });
    await sleep(1500);
    r.model = await p.evaluate(() => { const lab = [...document.querySelectorAll('label, .field')].find(l => /^\s*Model/.test(l.textContent)); return lab?.querySelector('select')?.value; });
    // Analyst
    const t0 = Date.now();
    await p.click('#ask-q'); await p.type('#ask-q', 'Who are the brokers in this organization, and how sure can we be about that ranking?');
    await p.evaluate(() => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Ask').click());
    await p.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Ask'); return b && document.querySelector('#ask-q') && !document.body.innerText.includes('Stop') && /\[T\d+\]|T\d+/.test(document.querySelector('main').innerText); }, { timeout: 300000, polling: 1000 });
    r.analystSeconds = Math.round((Date.now() - t0) / 1000);
    r.analyst = await p.evaluate(() => { const m = document.querySelector('main').innerText; const i = m.lastIndexOf('Who are the brokers'); return m.slice(i, i + 2500); });
    r.analystCitations = (r.analyst.match(/\[T\d+\]/g) || []).length;
    r.analystFlags = (r.analyst.match(/not (found|cited)|uncited|could not be traced|unsupported/gi) || []).length;
    await p.screenshot({ path: `${OUT}/${prov}-analyst.png`, fullPage: true });
    // Reports
    await p.evaluate(() => [...document.querySelectorAll('[role=tab]')].find(e => e.textContent.trim() === 'Reports').click()); await sleep(800);
    const t1 = Date.now();
    await p.evaluate(() => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Write report').click());
    await p.waitForSelector('#report-out', { timeout: 300000 });
    await p.waitForFunction(() => ![...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Stop'), { timeout: 300000, polling: 1000 });
    r.reportSeconds = Math.round((Date.now() - t1) / 1000);
    r.report = await p.evaluate(() => document.querySelector('#report-out').innerText.slice(0, 1500));
    r.reportLen = await p.evaluate(() => document.querySelector('#report-out').innerText.length);
    await p.screenshot({ path: `${OUT}/${prov}-report.png`, fullPage: true });
    // Content coding: small sample
    await p.evaluate(() => [...document.querySelectorAll('[role=tab]')].find(e => e.textContent.trim() === 'Content coding').click()); await sleep(800);
    await p.evaluate(() => { const i = [...document.querySelectorAll('label.field')].find(l => /^\s*Messages/.test(l.textContent))?.querySelector('input'); if (i) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '20'); i.dispatchEvent(new Event('input', { bubbles: true })); } });
    r.codebookCodes = await p.evaluate(() => [...document.querySelectorAll('label.field')].filter(l => /^\s*Label/.test(l.textContent)).map(l => l.querySelector('input')?.value));
    await p.evaluate(() => [...document.querySelectorAll('button')].find(e => /Draw sample and estimate/.test(e.textContent)).click()); await sleep(1500);
    const t2 = Date.now();
    await p.evaluate(() => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Run coding').click());
    await p.waitForSelector('#cres-h', { timeout: 300000 });
    await p.waitForFunction(() => ![...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Stop'), { timeout: 300000, polling: 1000 });
    r.codingSeconds = Math.round((Date.now() - t2) / 1000);
    r.coding = await p.evaluate(() => { const h = document.querySelector('#cres-h'); return (h.closest('section') || h.parentElement).innerText.slice(0, 1200); });
    await p.screenshot({ path: `${OUT}/${prov}-coding.png`, fullPage: true });
    // the key must not be visible anywhere on the page
    r.keyVisible = await p.evaluate(k => document.body.innerText.includes(k), KEYS[prov]);
  } catch (e) {
    r.failed = scrub(e.message).slice(0, 400);
    try { await p.screenshot({ path: `${OUT}/${prov}-FAIL.png`, fullPage: true }); r.failText = scrub(await p.evaluate(() => document.querySelector('main')?.innerText.slice(-1500))); } catch {}
  }
  await ctx.close();
}
await b.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/results.json`, scrub(JSON.stringify(results, null, 1)));
console.log(scrub(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { model: v.model, failed: v.failed, analystSeconds: v.analystSeconds, analystCitations: v.analystCitations, analystFlags: v.analystFlags, reportLen: v.reportLen, reportSeconds: v.reportSeconds, codingSeconds: v.codingSeconds, keyVisible: v.keyVisible, errors: v.errors.length }])), null, 1)));
