// Browser QA for the ui-core shell and views. Not part of `npm test`
// (needs a browser): run it by hand.
//
//   python3 -m http.server 8811          (from app/)
//   QA_URL=http://localhost:8811 QA_OUT=/some/dir node test/ui-core/qa.mjs
//
// Loads the app with ?mock (synthetic data, demo engine), visits every view
// at 1440 and 390 px, exercises the main interactions, and fails on console
// errors, page errors, failed requests or horizontal page overflow. Saves a
// screenshot per view and width to QA_OUT. Optional: QA_BIG=1 also loads a
// 5,000-person demo network and reports how long the Network view takes.
//
// Chromium and puppeteer-core are not dependencies of the app; point
// CHROME and PUPPETEER at existing installs (defaults are the paths on the
// development machine).

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const PUPPETEER = process.env.PUPPETEER || '/Users/ericgladstone/My Drive (eric.c.gladstone@gmail.com)/Projects/Website Graystone Industries/site/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const CHROME = process.env.CHROME || `${os.homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = (process.env.QA_URL || 'http://localhost:8811').replace(/\/$/, '');
const OUT = process.env.QA_OUT || path.join(os.tmpdir(), 'org-signal-qa');
fs.mkdirSync(OUT, { recursive: true });

const { default: puppeteer } = await import(PUPPETEER);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
const problems = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(width) {
  const p = await browser.newPage();
  await p.setViewport({ width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1 });
  p.on('console', m => { if (m.type() === 'error') problems.push(`[${width}] console error: ${m.text()}`); });
  p.on('pageerror', e => problems.push(`[${width}] page error: ${e.message}`));
  // The shell asks before leaving a page with data loaded (beforeunload); QA navigates on purpose.
  p.on('dialog', d => d.accept().catch(() => {}));
  p.on('requestfailed', r => problems.push(`[${width}] request failed: ${r.url()} ${r.failure()?.errorText}`));
  p.on('response', r => { if (r.status() >= 400) problems.push(`[${width}] HTTP ${r.status()}: ${r.url()}`); });
  return p;
}

async function idle(p, ms = 600) {
  // Wait for the status bar to clear (no running jobs), then a beat for charts.
  for (let i = 0; i < 120; i++) {
    const busy = await p.evaluate(() => !!document.querySelector('.status__job'));
    if (!busy) break;
    await sleep(250);
  }
  await sleep(ms);
}

async function overflow(p, label) {
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (ov > 0) {
    const culprit = await p.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const els = [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed');
      return els.slice(0, 3).map(e => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`).join(', ');
    });
    problems.push(`${label}: horizontal overflow ${ov}px (${culprit})`);
  }
}

async function shot(p, name) { await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false }); }

async function go(p, view) {
  await p.evaluate(v => { location.hash = v; }, view);
  await sleep(300);
  await idle(p);
}

async function clickText(p, selector, text) {
  const ok = await p.evaluate((sel, t) => { const el = [...document.querySelectorAll(sel)].find(e => e.textContent.trim().startsWith(t)); if (el) { el.click(); return true; } return false; }, selector, text);
  if (!ok) problems.push(`could not find ${selector} "${text}"`);
  await sleep(300);
  return ok;
}

for (const width of [1440, 390]) {
  const tag = width;
  // Empty state, no demo data.
  let p = await page(width);
  await p.goto(`${BASE}/index.html?mock&empty#data`, { waitUntil: 'load' });
  await idle(p, 800);
  await overflow(p, `${tag} data-empty`); await shot(p, `${tag}-data-empty`);
  await p.close();

  p = await page(width);
  await p.goto(`${BASE}/index.html?mock#data`, { waitUntil: 'load' });
  await sleep(500); await idle(p, 800);
  await overflow(p, `${tag} data`); await shot(p, `${tag}-data`);
  // The masthead's loaded-data chip with a long dataset name must not widen the page.
  await p.evaluate(async () => {
    const { store } = await import('/src/ui/store.js');
    const d = store.get().dataset;
    if (d) store.set({ dataset: { ...d, meta: { ...d.meta, name: 'Acme Corporation Slack workspace export plus the HR roster (slack, 2025)' } } });
  });
  await sleep(300);
  await overflow(p, `${tag} loaded chip, long name`); await shot(p, `${tag}-loaded-chip`);
  await clickText(p, '.tabs button', 'Who is who'); await idle(p, 400); await shot(p, `${tag}-data-identity`);

  await go(p, 'network'); await sleep(1200);
  await overflow(p, `${tag} network`); await shot(p, `${tag}-network`);
  // Select someone through the search box (keyboard path).
  await p.type('#net-search', 'Ada'); await p.keyboard.press('Enter'); await sleep(900);
  await shot(p, `${tag}-network-selected`);
  // Construction drawer.
  await clickText(p, 'button', 'Construction settings'); await sleep(500);
  await overflow(p, `${tag} drawer`); await shot(p, `${tag}-drawer`);
  await p.keyboard.press('Escape'); await sleep(300);

  await go(p, 'people');
  await p.evaluate(() => document.querySelector('.vt__row')?.click()); await idle(p, 800);
  await overflow(p, `${tag} people`); await shot(p, `${tag}-people`);
  if (width > 600) { await p.evaluate(() => document.querySelector('.split__side')?.scrollTo(0, 99999)); await sleep(300); await shot(p, `${tag}-people-profile-end`); }

  await go(p, 'groups'); await idle(p, 800);
  await overflow(p, `${tag} groups`); await shot(p, `${tag}-groups`);

  await go(p, 'content');
  for (const t of ['Tone', 'Keywords', 'Topics', 'Diffusion']) {
    // The tone tab was called Affect before round 2 (decision 4).
    const tab = t === 'Tone' && !(await p.evaluate(() => [...document.querySelectorAll('.tabs button')].some(b => b.textContent.trim().startsWith('Tone')))) ? 'Affect' : t;
    await clickText(p, '.tabs button', tab); await idle(p, 500);
    if (t === 'Diffusion') { await p.type('input[placeholder^="for example"]', 'roadmap'); await clickText(p, 'button', 'Trace'); await idle(p, 800); }
    await overflow(p, `${tag} content ${t}`); await shot(p, `${tag}-content-${t.toLowerCase()}`);
  }

  await go(p, 'time'); await idle(p, 1000);
  await overflow(p, `${tag} time`); await shot(p, `${tag}-time`);
  await clickText(p, 'button', 'Compare'); await idle(p, 800); await shot(p, `${tag}-time-before-after`);

  await go(p, 'ask'); await idle(p, 600);
  // Never talk to a real provider from QA.
  await p.select('#main select', 'demo').catch(() => problems.push('demo provider not selectable'));
  await sleep(300);
  await overflow(p, `${tag} ask`); await shot(p, `${tag}-ask-nokey`);
  await p.type('input[type=password]', 'demo-key-123456');
  await clickText(p, 'button', 'Use this key'); await sleep(600);
  await clickText(p, '.chat button', 'Is clustering'); await sleep(2500); await idle(p, 500);
  await overflow(p, `${tag} ask chat`); await shot(p, `${tag}-ask-chat`);
  await clickText(p, '.tabs button', 'Reports'); await sleep(300);
  await clickText(p, 'button', 'Write report'); await sleep(2500); await idle(p, 300);
  await shot(p, `${tag}-ask-report`);
  await clickText(p, '.tabs button', 'Content coding'); await sleep(300);
  await clickText(p, 'button', 'Draw sample'); await sleep(300);
  await clickText(p, 'button', 'Run coding'); await sleep(1500); await idle(p, 300);
  await overflow(p, `${tag} ask coding`); await shot(p, `${tag}-ask-coding`);

  await go(p, 'methods'); await idle(p, 800);
  await overflow(p, `${tag} methods`); await shot(p, `${tag}-methods`);

  await go(p, 'build'); await idle(p, 1000);
  await overflow(p, `${tag} build`); await shot(p, `${tag}-build`);
  await go(p, 'generate'); await idle(p, 1000);
  await overflow(p, `${tag} generate`); await shot(p, `${tag}-generate`);

  // Learn: a concept anchor, a Term popover that opens on click and closes
  // on Escape, and the Explanations switch (round 2, decision 1).
  await go(p, 'learn/betweenness'); await idle(p, 800);
  await overflow(p, `${tag} learn`); await shot(p, `${tag}-learn`);
  const atConcept = await p.evaluate(() => { const r = document.getElementById('learn-betweenness')?.getBoundingClientRect(); return !!r && r.top >= 0 && r.top < window.innerHeight / 2; });
  if (!atConcept) problems.push(`${tag}: #learn/betweenness did not scroll to the concept`);
  await p.evaluate(() => { const t = document.querySelector('.pop-trigger.term'); t?.scrollIntoView({ block: 'center' }); t?.click(); });
  await sleep(300);
  if (!(await p.evaluate(() => !!document.querySelector('.pop .pop__more')))) problems.push(`${tag}: Term popover did not open on click`);
  await shot(p, `${tag}-learn-term`);
  await p.keyboard.press('Escape'); await sleep(200);
  if (await p.evaluate(() => !!document.querySelector('.pop'))) problems.push(`${tag}: Term popover did not close on Escape`);
  const before = await p.evaluate(() => document.querySelector('.explain-switch__v')?.textContent);
  await p.evaluate(() => document.querySelector('.learn__explain button')?.click()); await sleep(200);
  const after = await p.evaluate(() => document.querySelector('.explain-switch__v')?.textContent);
  if (!before || before === after) problems.push(`${tag}: Explanations switch did not change (${before} -> ${after})`);
  await p.evaluate(() => document.querySelector('.learn__explain button')?.click()); await sleep(200);

  if (width < 600) {
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.click('.menu-btn'); await sleep(300); await shot(p, `${tag}-menu`);
    const descs = await p.evaluate(() => [...document.querySelectorAll('.app-nav .nav-link__desc')].filter(e => e.offsetHeight > 0).length);
    if (descs < 10) problems.push(`${tag}: phone menu shows ${descs} view descriptions`);
    await p.keyboard.press('Escape');
  }
  // Purposeful empty state: the view's question and the sample link.
  await p.goto(`${BASE}/index.html?mock&empty#groups`, { waitUntil: 'load' });
  await idle(p, 500);
  const needs = await p.evaluate(() => ({ q: document.querySelector('.view__intro')?.textContent || '', sample: [...document.querySelectorAll('.needs button')].some(b => /sample/i.test(b.textContent)) }));
  if (!/\?/.test(needs.q) || !needs.sample) problems.push(`${tag}: Groups empty state lacks its question or the sample link`);
  await overflow(p, `${tag} groups-empty`); await shot(p, `${tag}-groups-empty`);
  // Keyboard: Tab from a fresh load reaches the skip link first.
  await p.goto(`${BASE}/index.html?mock&empty#data`, { waitUntil: 'load' });
  await idle(p, 300);
  await p.keyboard.press('Tab');
  const first = await p.evaluate(() => document.activeElement?.className);
  if (!String(first).includes('skip')) problems.push(`${tag}: first Tab stop is "${first}", expected the skip link`);
  await p.close();
}

// ---- real modules -----------------------------------------------------------
// 1. The real analysis engine (worker) over the synthetic demo data (?demo).
// 2. A real import: the Slack fixture plus an HR table zipped together,
//    through the real pipeline worker, identity review, and the profile join
//    of the table no importer claimed.
if (!process.env.QA_SKIP_REAL) {
  let p = await page(1440);
  await p.goto(`${BASE}/index.html?demo#network`, { waitUntil: 'load' });
  await sleep(800); await idle(p, 1500);
  await overflow(p, 'real network'); await shot(p, 'real-1440-network');
  await go(p, 'people'); await p.evaluate(() => document.querySelector('.vt__row')?.click()); await idle(p, 1500); await shot(p, 'real-1440-people');
  await go(p, 'groups'); await idle(p, 1500); await shot(p, 'real-1440-groups');
  await go(p, 'content'); await idle(p, 2000); await shot(p, 'real-1440-content');
  for (const t of ['Keywords', 'Topics', 'Diffusion']) {
    await clickText(p, '.tabs button', t); await idle(p, 800);
    if (t === 'Diffusion') { await clickText(p, 'button', 'Find new words'); await idle(p, 1500); }
    await shot(p, `real-1440-content-${t.toLowerCase()}`);
  }
  await go(p, 'time'); await idle(p, 2000); await shot(p, 'real-1440-time');
  await clickText(p, 'button', 'Compare'); await idle(p, 1500); await shot(p, 'real-1440-time-before-after');
  await go(p, 'methods'); await idle(p, 1000); await shot(p, 'real-1440-methods');
  // Every export runs without an error notice.
  const client = await p.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT }).catch(() => {});
  const nButtons = await p.evaluate(() => [...document.querySelectorAll('button')].filter(b => /^Download /.test(b.getAttribute('aria-label') || '')).length);
  for (let k = 0; k < nButtons; k++) {
    await p.evaluate(i => [...document.querySelectorAll('button')].filter(b => /^Download /.test(b.getAttribute('aria-label') || ''))[i].click(), k);
    await sleep(700);
  }
  await clickText(p, 'button', 'Network figure'); await sleep(500);
  await clickText(p, 'button', 'Summary report'); await sleep(500);
  const errs = await p.evaluate(() => [...document.querySelectorAll('.notice--error')].map(n => n.textContent));
  if (errs.length) problems.push(`exports: ${errs.join(' | ')}`);
  if (nButtons < 8) problems.push(`exports: only ${nButtons} formats available`);
  await p.close();

  const { zipSync, strToU8 } = await import(new URL('../../vendor/fflate.js', import.meta.url));
  const root = new URL('../fixtures/importers-a/slack/standard/', import.meta.url).pathname;
  const files = {};
  const walk = (dir, rel = '') => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const fp = path.join(dir, e.name); if (e.isDirectory()) walk(fp, `${rel}${e.name}/`); else files[`export/${rel}${e.name}`] = new Uint8Array(fs.readFileSync(fp)); } };
  walk(decodeURIComponent(root));
  files['export/hr.csv'] = strToU8('name,department,level\nAna Ruiz,Design,2\nBen Okafor,Engineering,4\nChen Li,Research,3\nDana Park,Design,1\n');
  const zipPath = path.join(OUT, 'qa-slack-with-hr.zip');
  fs.writeFileSync(zipPath, zipSync(files));

  p = await page(1440);
  await p.goto(`${BASE}/index.html#data`, { waitUntil: 'load' });
  await idle(p, 500);
  const input = await p.$('input[type=file]:not([webkitdirectory])');
  await input.uploadFile(zipPath);
  await sleep(500); await p.waitForFunction(() => !document.querySelector('.loading'), { timeout: 60000 }).catch(() => problems.push('detection did not finish'));
  await idle(p, 500); await shot(p, 'real-1440-import-detected');
  await clickText(p, '.dv-actions button', 'Import'); await sleep(500); await idle(p, 1000);
  // The unclaimed HR table is offered for joining in the review, matched by name.
  await p.waitForFunction(() => /rows matched/.test(document.querySelector('.dv-join')?.textContent || ''), { timeout: 20000 }).catch(() => problems.push('real import: the HR table join was not previewed'));
  await shot(p, 'real-1440-import-review');
  const loaded = await p.evaluate(() => { const b = [...document.querySelectorAll('.dv-actions button')].find(e => /^(Merge \d+ and load|Load into analysis)/.test(e.textContent.trim())); if (b) b.click(); return !!b; });
  await sleep(500); await idle(p, 1500);
  await overflow(p, 'real import'); await shot(p, 'real-1440-import-loaded');
  await go(p, 'data'); await idle(p, 600); await shot(p, 'real-1440-profile-join');
  await go(p, 'network'); await idle(p, 2000); await shot(p, 'real-1440-imported-network');
  await go(p, 'groups'); await idle(p, 1500); await shot(p, 'real-1440-imported-groups');
  if (!loaded) problems.push('real import: could not load the imported data');
  await p.close();
}

if (process.env.QA_BIG) {
  const p = await page(1440);
  const t0 = Date.now();
  await p.goto(`${BASE}/index.html?demo&n=5000#network`, { waitUntil: 'load' });
  await p.waitForSelector('.net__canvas canvas', { timeout: 180000 });
  await idle(p, 1000);
  const loadMs = Date.now() - t0;
  // Rough frame timing while the camera animates.
  const fps = await p.evaluate(async () => {
    const btn = document.querySelector('.net__zoom .btn');
    let frames = 0; const start = performance.now();
    btn.click();
    await new Promise(res => { const tick = () => { frames++; if (performance.now() - start < 1000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    return frames;
  });
  console.log(`5,000-person demo: network view ready in ${(loadMs / 1000).toFixed(1)} s; ${fps} frames in 1 s while zooming`);
  await shot(p, '1440-network-5000');
  await go(p, 'people'); await shot(p, '1440-people-5000');
  await p.close();
}

await browser.close();
console.log(`Screenshots: ${OUT}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const x of [...new Set(problems)]) console.log(`- ${x}`);
  process.exit(1);
}
console.log('QA passed: no console errors, no failed requests, no horizontal overflow.');
