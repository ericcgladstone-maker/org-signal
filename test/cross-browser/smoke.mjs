// Cross-browser smoke test for Org Signal (WebKit, Firefox, Chromium).
//
//   node test/cross-browser/smoke.mjs --browser webkit|firefox|chromium --url <base>
//        [--sizes desktop,phone] [--only 1,2,7] [--headed] [--out <dir>]
//
//   e.g. node test/cross-browser/smoke.mjs --browser webkit --url https://orgsignal.graystoneindustries.co
//        node tools/serve.mjs . 8823 &   node test/cross-browser/smoke.mjs --browser firefox --url http://localhost:8823
//
// Drives the real app (no harness) through eleven flows at 1440x900 and
// 390x844 (isMobile where the engine supports it; Firefox has no isMobile, so
// it gets a touch-enabled 390px window instead). Every check prints one
// PASS/FAIL line; each flow also fails on console errors, page errors, CSP
// violations, failed or 4xx/5xx requests for the app's own origin, and
// horizontal page overflow. Screenshots go to --out/<browser>/.
// Uses the Playwright library and browsers already on this machine; nothing
// is downloaded. Exit code 1 when anything failed.
//
// Flows: 1 start page, 2 sample + network map, 3 People/Groups/Content/Time,
// 4 Generate, 5 Import, 6 Build, 7 classic datasets, 8 exports, 9 Ask,
// 10 Learn, 11 workers + WASM under the CSP.

import { mkdirSync, readFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE || '/Users/ericgladstone/code/Website Fun With Trains/tests/node_modules/playwright-core/index.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../..');
const DEFAULT_OUT = '/private/tmp/claude-501/-Users-ericgladstone-My-Drive--eric-c-gladstone-gmail-com--Projects-Software-Org-Signal/28c7544b-bf65-4ca4-99cc-4f4f74736ee5/scratchpad/xbrowser';
const SLACK_ZIP_DIR = process.env.SLACK_ZIP_DIR || '/private/tmp/claude-501/-Users-ericgladstone-My-Drive--eric-c-gladstone-gmail-com--Projects-Software-Org-Signal/28c7544b-bf65-4ca4-99cc-4f4f74736ee5/scratchpad/site-shots/dl';

// ---- arguments ---------------------------------------------------------------
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const [k, v] = a.slice(2).split('=');
  if (v !== undefined) args[k] = v;
  else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
  else args[k] = true;
}
const BROWSER = args.browser || 'webkit';
const BASE = String(args.url || 'https://orgsignal.graystoneindustries.co').replace(/\/+$/, '');
const SIZES = String(args.sizes || 'desktop,phone').split(',');
const ONLY = args.only ? new Set(String(args.only).split(',').map(Number)) : null;
const OUT = path.join(args.out || DEFAULT_OUT, BROWSER);
mkdirSync(OUT, { recursive: true });
const IGNORE = /static\.cloudflareinsights\.com|cdn-cgi\/rum|favicon/; // Cloudflare's injected beacon is reported separately

const pw = await import(pathToFileURL(PLAYWRIGHT).href);
const engine = pw[BROWSER] || pw.default?.[BROWSER];
if (!engine) { console.error(`Unknown browser ${BROWSER}`); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const envNotes = new Set();
const t0 = Date.now();
const stamp = () => new Date().toISOString().slice(11, 19);

// ---- runner ------------------------------------------------------------------
async function main() {
const browser = await engine.launch({ headless: !args.headed });
console.log(`# ${BROWSER} ${browser.version()} against ${BASE} at ${new Date().toISOString()}`);

for (const size of SIZES) {
  const phone = size === 'phone';
  const ctxOpts = {
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: phone ? 2 : 1,
    acceptDownloads: true,
    ...(phone ? { hasTouch: true, ...(BROWSER === 'firefox' ? {} : { isMobile: true }) } : {}),
  };
  const context = await browser.newContext(ctxOpts);
  let page = null;
  let flowName = '';
  let issues = [];
  let currentCheck = '';
  const note = (x) => issues.push(`${x} [during: ${currentCheck}]`);
  const attach = p => {
    p.on('console', async m => {
      let t = m.text();
      // Firefox prints objects (Errors) as JSHandle@object: ask the page for the message and stack.
      if (/JSHandle@/.test(t)) t = (await Promise.all(m.args().map(a => a.evaluate(x => (x && (x.stack || x.message)) ? `${x.name || 'Error'}: ${x.message} ${x.stack || ''}`.slice(0, 600) : typeof x === 'object' ? JSON.stringify(x) : String(x)).catch(() => '?')))).join(' ');
      // A font request cut off by navigation (NS_BINDING_ABORTED) is a test artifact.
      if (/downloadable font: download failed.*status=2152398850/.test(t)) return;
      if (IGNORE.test(t)) { envNotes.add(`console (${m.type()}): ${t.replace(/\{file:.*$/, '').slice(0, 260)}`); return; }
      if (m.type() === 'error' && !/^Failed to load resource/.test(t)) note(`console.error: ${t}`);
      else if (/Content[- ]Security[- ]Policy|CSP/i.test(t)) note(`csp: ${t}`);
    });
    p.on('pageerror', e => note(`pageerror: ${e.message}`));
    p.on('requestfailed', r => {
      if (IGNORE.test(r.url())) return;
      const f = r.failure()?.errorText || '';
      if (/aborted|cancel|NS_BINDING_ABORTED/i.test(f)) return; // downloads, superseded fetches
      if (r.url().startsWith('blob:') || r.url().startsWith('data:')) return;
      note(`requestfailed: ${r.url()} (${f})`);
    });
    p.on('response', r => { if (r.status() >= 400 && !IGNORE.test(r.url()) && !(r.request().method() === 'HEAD' && /services\/mock\.js$/.test(r.url()))) note(`http ${r.status()}: ${r.url()}`); });
    p.on('dialog', d => d.accept().catch(() => {}));
  };
  const newPage = async () => {
    if (page) await page.close({ runBeforeUnload: false }).catch(() => {});
    page = await context.newPage();
    attach(page);
    return page;
  };
  await newPage();

  const T = {
    get page() { return page; }, phone, size, newPage,
    async check(name, fn) {
      currentCheck = name;
      const started = Date.now();
      try {
        const detail = await fn();
        record(size, flowName, name, true, detail);
        return true;
      } catch (e) {
        const shot = await T.shot(`FAIL-${flowName}-${name}`).catch(() => null);
        record(size, flowName, name, false, (e && e.message ? e.message : String(e)).split('\n').slice(0, 4).join(' | '), shot);
        return false;
      } finally { if (Date.now() - started > 60000) console.log(`   (${name} took ${Math.round((Date.now() - started) / 1000)}s)`); }
    },
    async shot(tag, opts = {}) {
      const file = path.join(OUT, `${size}-${tag.replace(/[^\w.-]+/g, '_').slice(0, 90)}.png`);
      await page.screenshot({ path: file, fullPage: !!opts.full, timeout: 20000 });
      return file;
    },
  };

  for (const [i, flow] of FLOWS.entries()) {
    const num = i + 1;
    if (ONLY && !ONLY.has(num)) continue;
    flowName = `${num}-${flow.name}`;
    issues = [];
    currentCheck = 'flow setup';
    console.log(`\n## [${size}] flow ${flowName} (${stamp()})`);
    try { await flow.run(T); }
    catch (e) {
      const shot = await T.shot(`FAIL-${flowName}-crash`).catch(() => null);
      record(size, flowName, 'flow ran to the end', false, e.message.split('\n').slice(0, 4).join(' | '), shot);
      await newPage(); // a broken page should not poison the next flow
    }
    const ov = await overflow(page).catch(() => null);
    record(size, flowName, 'no horizontal overflow at the end', !ov || ov.px <= 1, ov && ov.px > 1 ? `${ov.px}px wider than the viewport; widest: ${ov.culprits.join('; ')}` : '');
    const uniq = [...new Set(issues)];
    record(size, flowName, 'no console errors, page errors, CSP violations or failed requests', uniq.length === 0, uniq.slice(0, 8).join(' || '));
  }
  await context.close();
}
await browser.close();

// ---- summary -----------------------------------------------------------------
const fails = results.filter(r => !r.ok);
console.log(`\n# Summary: ${results.length - fails.length} passed, ${fails.length} failed (${BROWSER}, ${Math.round((Date.now() - t0) / 1000)}s)`);
for (const f of fails) console.log(`FAIL [${f.size}] ${f.flow} :: ${f.name} :: ${f.detail}${f.shot ? ` :: ${f.shot}` : ''}`);
if (envNotes.size) { console.log('\n# Environment notes (not counted as failures):'); for (const n of envNotes) console.log(`  - ${n}`); }
process.exit(fails.length ? 1 : 0);
}

function record(size, flow, name, ok, detail = '', shot = null) {
  results.push({ size, flow, name, ok, detail: detail == null ? '' : String(detail), shot });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${size}] ${flow} :: ${name}${detail ? ` :: ${String(detail).slice(0, 400)}` : ''}${shot ? ` :: ${shot}` : ''}`);
}

// ---- helpers -----------------------------------------------------------------
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function overflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const px = de.scrollWidth - de.clientWidth;
    const culprits = [];
    if (px > 1) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.right > de.clientWidth + 1 && r.width > 0) {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
          culprits.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} right=${Math.round(r.right)}`);
          if (culprits.length >= 6) break;
        }
      }
    }
    return { px, culprits };
  });
}

// Load the app fresh at a hash (a full navigation).
let loads = 0;
async function open(T, hash = '', query = '') {
  const p = T.page;
  await settle(T);
  // A distinct query string forces a real load (a hash-only change would keep the loaded data).
  await p.goto(`${BASE}/?${query ? query + '&' : ''}_=${++loads}${hash ? '#' + hash : ''}`, { waitUntil: 'load', timeout: 60000 });
  await p.waitForSelector('#app > *', { timeout: 30000 });
  await p.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
}

// Let lazy view modules finish loading before navigating away: Firefox and
// WebKit reject a dynamic import cut off by navigation, and the shell logs it
// with console.error (a test artifact, not a user-facing failure).
async function settle(T) {
  const p = T.page;
  if (!p || p.url() === 'about:blank') return;
  await p.waitForFunction(() => !/Opening view/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
  await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
}

// Switch views the way the nav does (the shell listens to hashchange).
async function go(T, view) {
  const p = T.page;
  await p.evaluate(v => { location.hash = v; }, view);
  await p.waitForFunction(v => (document.title || '').startsWith(v), VIEW_TITLES[view] || view, { timeout: 20000 });
  await settle(T);
}
const VIEW_TITLES = { data: 'Data', build: 'Build', generate: 'Generate', network: 'Network', people: 'People', groups: 'Groups', content: 'Content', time: 'Time', methods: 'Methods', ask: 'Ask', learn: 'Learn' };

// The app's store, read through its own module (same URL, same instance).
async function datasetInfo(T) {
  return T.page.evaluate(async () => {
    const { store } = await import(new URL('src/ui/store.js', location.href).href);
    const s = store.get();
    return {
      name: s.dataset?.meta?.name || null, n: s.dataset?.nodes?.count ?? 0, events: s.dataset?.events?.count ?? 0,
      netVersion: s.network?.version ?? null, netN: s.network?.n ?? null, edges: s.network?.edgeCount ?? null, view: s.view,
    };
  });
}

// waitForFunction treats a returned Promise as truthy, so async predicates
// (the ones that read the store) are polled here instead.
async function waitAsync(T, fn, arg, opts = {}) {
  const timeout = opts.timeout || 30000, every = opts.polling || 500;
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { last = await T.page.evaluate(fn, arg); } catch (e) { last = e; if (!/Execution context was destroyed|navigation/i.test(e.message)) throw e; }
    if (last && !(last instanceof Error)) return last;
    if (Date.now() > end) throw new Error(`timed out after ${timeout}ms waiting for: ${String(fn).slice(0, 140)}`);
    await sleep(every);
  }
}

async function clickText(T, selector, text, opts = {}) {
  const loc = T.page.locator(selector, { hasText: text }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: opts.timeout || 20000 });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  if (T.phone && opts.tap !== false) await loc.tap({ timeout: 10000 }).catch(() => loc.click({ timeout: 10000 }));
  else await loc.click({ timeout: 10000 });
}

async function waitText(T, text, timeout = 30000) {
  await T.page.waitForFunction(t => new RegExp(t, 'i').test(document.querySelector('main')?.innerText || document.body.innerText), text instanceof RegExp ? text.source : text, { timeout });
}

// Waits for a download triggered by `action`; returns { name, size, head (bytes), path }.
async function expectDownload(T, action, timeout = 60000) {
  const [dl] = await Promise.all([T.page.waitForEvent('download', { timeout }), action()]);
  const failure = await dl.failure();
  if (failure) throw new Error(`download ${dl.suggestedFilename()} failed: ${failure}`);
  const file = path.join(OUT, `dl-${T.size}-${dl.suggestedFilename()}`);
  await dl.saveAs(file);
  const buf = readFileSync(file);
  return { name: dl.suggestedFilename(), size: buf.length, head: buf.subarray(0, 8), file, buf };
}

// Pixel statistics of an element, from a screenshot decoded in the page
// (img-src allows data:, so no PNG decoder is needed here).
async function pixelStats(T, selector) {
  const el = T.page.locator(selector).first();
  const buf = await el.screenshot({ timeout: 20000 });
  return imageStats(T, buf.toString('base64'));
}
async function imageStats(T, b64, mime = 'image/png') {
  return T.page.evaluate(async ({ b64, mime }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('image did not decode')); img.src = `data:${mime};base64,${b64}`; });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
    const bg = [data[0], data[1], data[2]];
    let diff = 0; const colors = new Set();
    for (let i = 0; i < data.length; i += 16) {
      const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
      if (d > 40) diff++;
      colors.add((data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | (data[i + 2] >> 4));
    }
    return { width, height, nonBg: diff / (data.length / 16), colors: colors.size };
  }, { b64, mime });
}

// Candidate node centres from a screenshot of the map: small uniform blobs
// of a colour well away from the background.
async function nodeCandidates(T) {
  const el = T.page.locator('.net__canvas').first();
  const box = await el.boundingBox();
  const buf = await el.screenshot({ timeout: 20000 });
  const pts = await T.page.evaluate(async ({ b64 }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `data:image/png;base64,${b64}`; });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
    const px = (x, y) => { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
    const bg = px(2, 2);
    const far = (p) => Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 90;
    const same = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 30;
    const out = [];
    const r = Math.max(2, Math.round(width / 400));
    for (let y = 10; y < height - 10 && out.length < 400; y += 3) for (let x = 10; x < width - 10; x += 3) {
      const p = px(x, y);
      if (!far(p)) continue;
      if (same(p, px(x - r, y)) && same(p, px(x + r, y)) && same(p, px(x, y - r)) && same(p, px(x, y + r))) out.push([x / width, y / height]);
    }
    return out;
  }, { b64: buf.toString('base64') });
  // Spread the candidates: take every k-th.
  const step = Math.max(1, Math.floor(pts.length / 40));
  return pts.filter((_, i) => i % step === 0).map(([fx, fy]) => ({ x: box.x + fx * box.width, y: box.y + fy * box.height }));
}

async function ensureSample(T, { force = false } = {}) {
  const info = await datasetInfo(T).catch(() => null);
  if (!force && info && info.n > 0 && info.netVersion != null) return info;
  await open(T, 'network');
  await clickText(T, 'button', /Explore the sample/);
  await waitAsync(T, async () => {
    const { store } = await import(new URL('src/ui/store.js', location.href).href);
    const s = store.get(); return !!(s.dataset && s.network && s.metrics);
  }, null, { timeout: 120000, polling: 500 });
  return datasetInfo(T);
}

async function setInputFiles(T, files) {
  // The Data view's first hidden file input (Choose files).
  const input = T.page.locator('.dv-drop input[type=file]').first();
  await input.setInputFiles(files);
}

function fixture(rel) { return path.join(APP, 'test/fixtures', rel); }

// ---- flows -------------------------------------------------------------------
const FLOWS = [
  { name: 'start', async run(T) {
    await T.check('start page renders', async () => {
      await open(T, '');
      await T.page.waitForSelector('.dv-start__card', { timeout: 30000 });
      const n = await T.page.locator('.dv-start__card').count();
      assert(n >= 4, `expected 4 start cards, saw ${n}`);
      await T.shot('1-start', { full: true });
      return `${n} start cards; h2 "${await T.page.locator('main h2').first().innerText()}"`;
    });
    await T.check('fonts load (Geist)', async () => {
      const r = await T.page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].map(f => `${f.family}:${f.status}`); });
      const loaded = r.filter(x => /loaded$/.test(x));
      assert(loaded.length > 0, `no web font loaded: ${r.join(', ')}`);
      return loaded.join(', ');
    });
    await T.check('classic list shows', async () => {
      await T.page.waitForSelector('#dv-classic .classic__list li', { timeout: 30000 });
      const n = await T.page.locator('#dv-classic .classic__list li').count();
      assert(n >= 4, `classic list has ${n} items`);
      return `${n} items`;
    });
    await T.check('Learn link opens Learn', async () => {
      await clickText(T, '.dv-learn a', /Learn the ideas/);
      await T.page.waitForFunction(() => document.title.startsWith('Learn'), null, { timeout: 20000 });
      await settle(T);
    });
    if (T.phone) await T.check('phone menu opens and navigates', async () => {
      await T.page.locator('.menu-btn').tap();
      await T.page.waitForSelector('.app-nav[data-open=true]');
      await T.shot('1-menu');
      await T.page.locator('.app-nav a[href="#data"]').tap();
      await T.page.waitForFunction(() => document.title.startsWith('Data'));
    });
  } },

  { name: 'sample-network', async run(T) {
    let info;
    await T.check('sample organization loads (Explore the sample)', async () => {
      info = await ensureSample(T);
      assert(info.n > 0, 'no people');
      return `${info.name}: ${info.n} people, ${info.edges} ties`;
    });
    await T.check('network map renders (WebGL canvas not blank)', async () => {
      if (!/^Network/.test(await T.page.title())) await go(T, 'network');
      await T.page.waitForSelector('.net__canvas canvas', { timeout: 60000 });
      await T.page.waitForTimeout(2500);
      const gl = await T.page.evaluate(() => [...document.querySelectorAll('.net__canvas canvas')].map(c => c.className || c.tagName).join(','));
      const st = await pixelStats(T, '.net__canvas');
      await T.shot('2-network');
      assert(st.nonBg > 0.01 && st.colors > 6, `map looks blank: ${(st.nonBg * 100).toFixed(2)}% non-background, ${st.colors} colours`);
      return `${(st.nonBg * 100).toFixed(1)}% drawn, ${st.colors} colours; canvases: ${gl}`;
    });
    await T.check('labels drawn on the label layer', async () => {
      const r = await T.page.evaluate(() => {
        let best = 0;
        for (const c of document.querySelectorAll('.net__canvas canvas')) {
          if (!/label/i.test(c.className)) continue;
          const g = c.getContext('2d'); if (!g || !c.width) continue;
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let n = 0; for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 0) n++;
          best = Math.max(best, n);
        }
        return best;
      });
      assert(r > 50, `label canvases hold ${r} sampled pixels`);
      return `${r} sampled label pixels`;
    });
    await T.check('Who stands out lists people', async () => {
      const n = await T.page.locator('#standout-h').count();
      assert(n === 1, 'no Who stands out heading');
      const txt = await T.page.locator('#standout-h').locator('xpath=..').innerText();
      assert(txt.length > 40, 'Who stands out is empty');
      return txt.replace(/\s+/g, ' ').slice(0, 120);
    });
    await T.check('click a person on the canvas selects them', async () => {
      await T.page.locator('.net').scrollIntoViewIfNeeded();
      const cands = await nodeCandidates(T);
      assert(cands.length, 'no node-like blobs found in the map screenshot');
      let hit = null;
      for (const c of cands) {
        await T.page.mouse.move(c.x, c.y);
        await T.page.waitForTimeout(60);
        const cur = await T.page.evaluate(() => document.querySelector('.net__canvas')?.style.cursor);
        if (cur === 'pointer') { hit = c; break; }
      }
      assert(hit, `hovering ${cands.length} candidate points never reported a node (cursor never became pointer)`);
      if (T.phone) await T.page.touchscreen.tap(hit.x, hit.y); else await T.page.mouse.click(hit.x, hit.y);
      await T.page.waitForSelector('.net-sel__name', { timeout: 10000 });
      await T.shot('2-selected');
      return `selected ${await T.page.locator('.net-sel__name').first().innerText()} at ${Math.round(hit.x)},${Math.round(hit.y)}`;
    });
    await T.check('click a tie opens the evidence panel', async () => {
      if (!(await T.page.locator('.net-ties__btn').count())) {
        // Fall back to the search box when the canvas click did not select anyone.
        const first = await T.page.evaluate(async () => { const { store } = await import(new URL('src/ui/store.js', location.href).href); return store.get().dataset.nodes.labels[0]; });
        await T.page.fill('#net-search', first.slice(0, 5));
        await T.page.keyboard.press('Enter');
      }
      const btn = T.page.locator('.net-ties__btn').first();
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await waitText(T, /Evidence for this tie/);
      await T.page.waitForTimeout(800);
      await T.shot('2-evidence');
      const n = await T.page.locator('.net-evidence li').count();
      return `${n} evidence items listed`;
    });
    await T.check('search box selects a person', async () => {
      const first = await T.page.evaluate(async () => { const { store } = await import(new URL('src/ui/store.js', location.href).href); return store.get().dataset.nodes.labels[3]; });
      await T.page.locator('#net-search').scrollIntoViewIfNeeded();
      await T.page.fill('#net-search', first);
      await T.page.waitForSelector('#net-search-list li', { timeout: 5000 });
      await T.page.keyboard.press('Enter');
      await T.page.waitForFunction(n => document.querySelector('.net-sel__name')?.textContent.includes(n), first, { timeout: 5000 });
    });
    await T.check('Construction settings drawer opens; Apply rebuilds', async () => {
      const before = (await datasetInfo(T)).netVersion;
      await clickText(T, 'button', /^Construction settings$/);
      await T.page.waitForSelector('#drawer-h', { timeout: 15000 });
      await T.page.waitForTimeout(400);
      await T.shot('2-drawer');
      const boxes = T.page.locator('.drawer .rule-row input[type=checkbox]');
      const k = await boxes.count();
      assert(k > 0, 'no rule checkboxes');
      await boxes.nth(k > 1 ? 1 : 0).click();
      await clickText(T, '.drawer button', /Apply and rebuild/);
      await waitAsync(T, async (v) => { const { store } = await import(new URL('src/ui/store.js', location.href).href); const s = store.get(); return s.network && s.network.version !== v && s.metrics && !s.ui?.drawer; }, before, { timeout: 90000, polling: 500 });
      const after = await datasetInfo(T);
      return `network version ${before} -> ${after.netVersion}, ${after.edges} ties`;
    });
  } },

  { name: 'explore-views', async run(T) {
    await ensureSample(T);
    await T.check('People: table (desktop) or ranked list (phone) renders and sorts', async () => {
      await go(T, 'people');
      if (T.phone) {
        await T.page.waitForSelector('.people-list__row', { timeout: 60000 });
        const n = await T.page.locator('.people-list__row').count();
        await T.shot('3-people');
        return `${n} rows in the ranked list`;
      }
      await T.page.waitForSelector('.vt__th.num .vt__sort', { timeout: 60000 });
      const heads = T.page.locator('.vt__th.num .vt__sort');
      const k = await heads.count();
      assert(k > 2, `only ${k} sortable measure columns`);
      await heads.nth(1).click();
      await T.page.waitForTimeout(400);
      await T.page.waitForSelector('.vt__th.is-sorted[aria-sort]', { timeout: 5000 });
      await T.shot('3-people');
      return `${k} measure columns; sorted by ${await T.page.locator('.vt__th.is-sorted').first().innerText()}`;
    });
    await T.check('People: rank stability runs', async () => {
      if (T.phone) {
        // The phone list starts on Contacts with no sort key, which offers no stability check; pick a measure first.
        const sel = T.page.locator('.people-list select, label:has-text("Measure") select').first();
        const v = await sel.locator('option').evaluateAll(os => (os.find(o => /Strength/.test(o.textContent)) || os[1]).value);
        await sel.selectOption(v);
      }
      const b = T.page.locator('button', { hasText: /Check how stable/ }).first();
      await b.waitFor({ timeout: 20000 });
      await b.scrollIntoViewIfNeeded();
      await b.click();
      await waitText(T, /Rank stability/, 120000);
      await T.page.waitForFunction(() => ![...document.querySelectorAll('main button')].some(b => /Resampling|Check how stable/.test(b.textContent)), null, { timeout: 120000 });
      await waitText(T, /hold up|not a finding|could drop/, 10000);
      await T.shot('3-stability');
    });
    await T.check('People: profile opens', async () => {
      const row = T.phone ? T.page.locator('.people-list__row').first() : T.page.locator('.vt__row').first();
      await row.scrollIntoViewIfNeeded();
      if (T.phone) await row.tap(); else await row.click();
      await waitText(T, /Strongest ties/);
      await T.page.waitForTimeout(500);
      await T.shot('3-profile');
    });
    await T.check('Groups: attribute, E-I and random comparison', async () => {
      await go(T, 'groups');
      const sel = T.page.locator('label:has-text("Groups from") select, select').first();
      await sel.waitFor({ timeout: 30000 });
      const opts = await sel.locator('option').evaluateAll(os => os.map(o => ({ v: o.value, t: o.textContent })));
      const pick = opts.find(o => /depart|team|role/i.test(o.t)) || opts.find(o => !/communit/i.test(o.t)) || opts[0];
      await sel.selectOption(pick.v);
      await waitText(T, /E-I index/, 60000);
      await T.page.waitForFunction(() => !/Comparing with \d+ random networks/.test(document.querySelector('main').innerText), null, { timeout: 180000 });
      await waitText(T, /random networks with the same numbers of ties give|E-I if random/, 10000);
      await T.shot('3-groups', { full: true });
      return `grouped by ${pick.t}`;
    });
    for (const tab of ['Tone', 'Keywords', 'Topics', 'Diffusion']) {
      await T.check(`Content: ${tab} tab`, async () => {
        if (!/^Content/.test(await T.page.title())) await go(T, 'content');
        await T.page.locator('[role=tab]', { hasText: tab }).first().click();
        await T.page.waitForTimeout(500);
        await T.page.waitForFunction(() => { const p = document.getElementById('ct-panel'); return p && p.innerText.length > 80 && !/^\s*(Loading|Computing)/.test(p.innerText); }, null, { timeout: 120000 });
        if (tab === 'Diffusion') { const tr = T.page.locator('#ct-panel button', { hasText: /^Trace$/ }); if (await tr.count()) { await tr.first().click(); await T.page.waitForTimeout(3000); } }
        const err = await T.page.locator('#ct-panel .flag--error, #ct-panel [role=alert]').count();
        await T.shot(`3-content-${tab}`);
        assert(!err, `${tab} shows an error`);
      });
    }
    await T.check('Time: series and detected shifts', async () => {
      await go(T, 'time');
      await T.page.waitForSelector('#ts-h', { timeout: 60000 });
      await T.page.waitForSelector('#sh-h', { timeout: 120000 });
      await T.page.waitForTimeout(1500);
      const svgs = await T.page.locator('main svg').count();
      assert(svgs > 0, 'no charts');
      await T.shot('3-time', { full: true });
      return `${svgs} svg charts`;
    });
    await T.check('Time: before/after compare', async () => {
      const form = T.page.locator('form:has(button:has-text("Compare"))').first();
      await form.scrollIntoViewIfNeeded();
      await form.locator('button', { hasText: 'Compare' }).click();
      await T.page.waitForTimeout(3000);
      await T.page.waitForFunction(() => { const h = document.getElementById('ba-h'); const s = h && h.closest('section'); return s && /after/i.test(s.innerText) && s.querySelectorAll('table, .verdict, svg').length > 0; }, null, { timeout: 120000 });
      await T.shot('3-time-ba');
    });
  } },

  { name: 'generate', async run(T) {
    await open(T, 'generate');
    await T.check('Generate: bridge-dependent, 120, seed 7, analyze', async () => {
      await T.page.waitForSelector('input[name=ob-gen-structure]', { timeout: 30000 });
      await T.page.check('input[name=ob-gen-context][value=workplace]');
      await T.page.check('input[name=ob-gen-structure][value=bridge-dependent]');
      await T.page.fill('#ob-gen-size', '120'); await T.page.locator('#ob-gen-size').dispatchEvent('change');
      const adv = T.page.locator('#ob-gen-seed');
      if (!(await adv.isVisible())) { const d = T.page.locator('details:has(#ob-gen-seed) > summary'); if (await d.count()) await d.first().click(); }
      await T.page.fill('#ob-gen-seed', '7'); await T.page.locator('#ob-gen-seed').dispatchEvent('change');
      await clickText(T, 'button', /^Generate and analyze$/);
      await waitAsync(T, async () => { const { store } = await import(new URL('src/ui/store.js', location.href).href); const s = store.get(); return s.dataset && s.network && s.metrics && s.generated; }, null, { timeout: 180000, polling: 500 });
      const i = await datasetInfo(T);
      assert(Math.abs(i.n - 120) <= 3, `expected about 120 people, got ${i.n}`);
      return `${i.name}: ${i.n} people`;
    });
    await T.check('Generate: recovery check reports', async () => {
      if (!/^Generate/.test(await T.page.title())) await go(T, 'generate');
      await T.page.waitForSelector('#ob-recovery', { timeout: 30000 });
      await waitAsync(T, async () => { const { store } = await import(new URL('src/ui/store.js', location.href).href); return !!store.get().generated?.recovery; }, null, { timeout: 180000, polling: 1000 });
      await T.page.locator('#ob-recovery').scrollIntoViewIfNeeded();
      await T.page.waitForTimeout(500);
      await T.shot('4-recovery');
    });
    await T.check('Generate: native export downloads a zip', async () => {
      if (!/^Generate/.test(await T.page.title())) await go(T, 'generate');
      const d = await expectDownload(T, () => clickText(T, 'button', /Download as native export files/), 180000);
      assert(d.head[0] === 0x50 && d.head[1] === 0x4b, `${d.name} is not a zip (starts ${d.head.toString('hex')})`);
      return `${d.name}, ${d.size} bytes`;
    });
  } },

  { name: 'import', async run(T) {
    const slack = readdirSync(SLACK_ZIP_DIR).filter(f => f.endsWith('.zip')).map(f => path.join(SLACK_ZIP_DIR, f))[0];
    const cases = [
      ['Slack zip', [slack]],
      ['mbox', [fixture('importers-a/email/takeout/Takeout/Mail/All mail Including Spam and Trash.mbox')]],
      ['ics', [fixture('importers-a/calendar/outlook/Calendar.ics')]],
      ['GraphML', [fixture('importers-a/network-files/plain.graphml')]],
      ['WhatsApp txt', [fixture('importers-b/whatsapp/WhatsApp Chat with Equipo.txt')]],
      ['WhatsApp zip', [fixture('importers-b/whatsapp/WhatsApp Chat - Project Falcon.zip')]],
      ['iMessage chat.db (sql.js WASM)', [fixture('importers-b/imessage/chat.db')]],
    ];
    for (const [label, files] of cases) {
      await T.check(`Import ${label}: review then Load into analysis`, async () => {
        for (const f of files) assert(f && statSync(f).size > 0, `missing fixture ${f}`);
        await open(T, 'data');
        await T.page.waitForSelector('.dv-drop input[type=file]', { state: 'attached', timeout: 30000 });
        await setInputFiles(T, files);
        // Detection, then the Import button.
        const imp = T.page.locator('.dv-actions .btn--primary').first();
        await imp.waitFor({ timeout: 30000 });
        await T.page.waitForFunction(() => { const b = document.querySelector('.dv-actions .btn--primary'); return b && !b.disabled; }, null, { timeout: 60000 });
        await imp.click();
        await T.page.waitForSelector('#rev-h', { timeout: 120000 });
        await T.page.waitForTimeout(500);
        await T.shot(`5-review-${label}`, { full: true });
        const empty = await T.page.locator('.dv-review [role=alert]', { hasText: 'Nothing to analyze' }).count();
        assert(!empty, 'review says Nothing to analyze');
        const load = T.page.locator('.dv-review .dv-actions .btn--primary').first();
        await load.click();
        await waitAsync(T, async () => { const { store } = await import(new URL('src/ui/store.js', location.href).href); const s = store.get(); return s.dataset && s.network; }, null, { timeout: 120000, polling: 500 });
        const i = await datasetInfo(T);
        return `${i.name}: ${i.n} people, ${i.events} events`;
      });
    }
  } },

  { name: 'build', async run(T) {
    await T.check('Draw: worked example, drag, add tie, Analyze', async () => {
      await open(T, 'build?example=two-cliques-broker');
      await T.page.waitForSelector('.ob-canvas svg [data-node]', { timeout: 30000 });
      await T.page.locator('.ob-canvas').scrollIntoViewIfNeeded();
      await T.page.waitForTimeout(500); // smooth scrolling settles before measuring
      const centres = async () => T.page.$$eval('[data-node]', els => els.map(el => { const c = el.querySelector('circle:not(.focus-ring)').getBoundingClientRect(); return { id: el.getAttribute('data-node'), x: c.left + c.width / 2, y: c.top + c.height / 2, t: el.getAttribute('transform') }; }));
      let ns = await centres();
      assert(ns.length > 3, `example has ${ns.length} nodes`);
      const edges0 = await T.page.locator('[data-edge]').count();
      // Drag a node.
      const n0 = ns[0];
      await T.page.mouse.move(n0.x, n0.y); await T.page.mouse.down();
      await T.page.mouse.move(n0.x + 30, n0.y + 20, { steps: 6 }); await T.page.mouse.up();
      await T.page.waitForTimeout(200);
      const moved = (await centres()).find(n => n.id === n0.id);
      assert(moved.t !== n0.t, 'node did not move when dragged');
      // Add a tie: Connect mode, drag from one node to a non-neighbour.
      await clickText(T, '.ob-draw button', /^Connect$/, { tap: false });
      await T.page.locator('.ob-canvas').scrollIntoViewIfNeeded();
      await T.page.waitForTimeout(200);
      ns = await centres();
      const a = ns[1], b = ns[ns.length - 1];
      await T.page.mouse.move(a.x, a.y); await T.page.mouse.down();
      await T.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2 + 8, { steps: 5 });
      await T.page.mouse.move(b.x, b.y, { steps: 5 }); await T.page.mouse.up();
      await T.page.waitForTimeout(200);
      const edges1 = await T.page.locator('[data-edge]').count();
      await T.shot('6-draw');
      assert(edges1 === edges0 + 1, `ties ${edges0} -> ${edges1} after connecting`);
      await clickText(T, '.ob-draw button', /^Analyze this network$/, { tap: false });
      await waitAsync(T, async () => { const { store } = await import(new URL('src/ui/store.js', location.href).href); const s = store.get(); return s.dataset && s.network; }, null, { timeout: 60000, polling: 500 });
      const i = await datasetInfo(T);
      return `${i.n} people, ${i.edges} ties`;
    });
    await T.check('Ego interview example opens', async () => {
      await open(T, 'build?example=ego-10');
      await T.page.waitForSelector('.ego', { timeout: 30000 });
      await T.page.waitForTimeout(800);
      await T.shot('6-ego', { full: true });
      const txt = await T.page.locator('.ego').innerText();
      assert(txt.length > 100, 'ego builder is empty');
    });
    let link = null;
    await T.check('Roster: share link is produced', async () => {
      await open(T, 'build');
      await T.page.locator('.ob .tabs [role=tab]', { hasText: 'Roster' }).click();
      await T.page.waitForSelector('#ob-roster-paste', { timeout: 20000 });
      await T.page.$eval('#ob-roster-paste', el => { el.value = 'Ana\nBen\nCai\nDee\nEli'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await clickText(T, 'button', /^Add to roster$/);
      await clickText(T, 'button', /Next: Relations/);
      await clickText(T, 'label', /Advice/);
      await clickText(T, 'button', /Next: Collect ties/);
      await clickText(T, 'button', /Each member answers a survey/);
      await clickText(T, 'button', /Make a share link/);
      await T.page.waitForSelector('textarea.ob-share__url', { timeout: 20000 });
      link = await T.page.locator('textarea.ob-share__url').first().inputValue();
      assert(/#survey=/.test(link), `link has no #survey=: ${link.slice(0, 80)}`);
      await T.shot('6-roster-share', { full: true });
      return `${link.length} characters`;
    });
    await T.check('Respondent view opens from the share link', async () => {
      assert(link, 'no link from the previous step');
      const u = new URL(link); const target = `${BASE}/${u.hash}`;
      const p = await T.newPage();
      await p.goto(target, { waitUntil: 'load' });
      await p.waitForFunction(() => /Who are you/i.test(document.body.innerText), null, { timeout: 30000 });
      const inp = p.locator('input').filter({ visible: true }).first();
      await inp.fill('An');
      await p.waitForTimeout(400);
      const sugg = /Ana/.test(await p.locator('body').innerText());
      assert(sugg, 'typing "An" did not offer Ana from the roster');
      await T.shot('6-respond', { full: true });
    });
    await T.check('Respondent view (#respond) opens', async () => {
      await T.page.goto(`${BASE}/#respond`, { waitUntil: 'load' });
      await T.page.waitForFunction(() => document.body.innerText.length > 100, null, { timeout: 30000 });
      await T.shot('6-respond-file');
    });
    await T.check('Perceived: Krackhardt advice opens', async () => {
      await T.newPage();
      await open(T, 'build?perceived=krackhardt:advice');
      await T.page.waitForFunction(() => /informant/i.test(document.querySelector('main')?.innerText || ''), null, { timeout: 60000 });
      await T.page.waitForTimeout(800);
      await T.shot('6-perceived', { full: true });
    });
    await T.check('Paste ties: preview and Analyze', async () => {
      await open(T, 'build');
      await T.page.locator('.ob .tabs [role=tab]', { hasText: 'Paste ties' }).click();
      await T.page.waitForSelector('#ob-paste-text', { timeout: 20000 });
      await T.page.fill('#ob-paste-text', 'Avery - Jordan\nJordan -> Sam, 3\nnot a tie line\n"Lee, Morgan", Avery, 2');
      await T.page.waitForSelector('.ob-lines li.bad', { timeout: 10000 });
      const sum = await T.page.locator('#ob-paste-summary').innerText();
      assert(/3 ties among 4 people/.test(sum), `summary: ${sum}`);
      await clickText(T, 'button', /^Analyze this network$/);
      await waitAsync(T, async () => { const { store } = await import(new URL('src/ui/store.js', location.href).href); const s = store.get(); return s.dataset && s.network; }, null, { timeout: 60000, polling: 500 });
      assert((await datasetInfo(T)).n === 4, 'expected 4 people');
    });
  } },

  { name: 'classic', async run(T) {
    await open(T, 'data');
    const list = await T.page.evaluate(async () => (await (await fetch(new URL('data/classic/index.json', location.href))).json()));
    const items = (Array.isArray(list) ? list : list.datasets || list.items || []).filter(e => e.file || e.path || e.available !== false);
    for (const e of items) {
      const title = e.title || e.id;
      await T.check(`classic: ${title}`, async () => {
        await open(T, 'data');
        await T.page.waitForSelector('#dv-classic .classic__list', { timeout: 30000 });
        const all = T.page.locator('.classic__all');
        if (await all.count()) await all.first().click();
        const btn = T.page.locator(`button[aria-label="Load ${title}"]`).first();
        if (!(await btn.count())) return 'not loadable here (no Load button)';
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
        await waitAsync(T, async () => { const { store } = await import(new URL('src/ui/store.js', location.href).href); const s = store.get(); return s.dataset && s.network && s.metrics; }, null, { timeout: 120000, polling: 500 });
        const i = await datasetInfo(T);
        if (/davis|southern/i.test(e.id + title)) {
          await go(T, 'network');
          await T.page.waitForSelector('.net__canvas canvas', { timeout: 60000 });
          await T.page.waitForTimeout(2000);
          const tm = await T.page.locator('#standout-h').innerText();
          await T.shot('7-davis-network');
          assert(/each among their own kind/i.test(tm), `Davis not shown two-mode: "${tm}"`);
        }
        return `${i.n} people/nodes, ${i.edges} ties`;
      });
    }
    await T.check('Enron gzip decompresses (DecompressionStream)', async () => {
      const r = await T.page.evaluate(async () => {
        const res = await fetch(new URL('data/classic/enron.json.gz', location.href));
        const buf = new Uint8Array(await res.arrayBuffer());
        const head = [...buf.slice(0, 2)].map(b => b.toString(16)).join('');
        let txt;
        if (head === '1f8b') txt = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
        else txt = new TextDecoder().decode(buf); // served already decoded (Content-Encoding)
        return { head, enc: res.headers.get('content-encoding'), type: res.headers.get('content-type'), len: txt.length, ok: (() => { try { JSON.parse(txt); return true; } catch { return false; } })() };
      });
      assert(r.ok, `Enron did not parse: ${JSON.stringify(r)}`);
      return JSON.stringify(r);
    });
  } },

  { name: 'exports', async run(T) {
    await ensureSample(T, { force: !/^Synthetic workplace, bridge-dependent \(Slack, seed 1\)/.test((await datasetInfo(T).catch(() => ({}))).name || '') });
    await go(T, 'methods');
    await T.page.waitForSelector('#exp-h', { timeout: 30000 });
    for (const [label, re] of [['GEXF', /^Download GEXF$/], ['Metrics CSV', /^Download Metrics CSV$/], ['GraphML', /^Download GraphML$/]]) {
      await T.check(`export ${label}`, async () => {
        const btn = T.page.getByRole('button', { name: re }).first();
        await btn.scrollIntoViewIfNeeded();
        await T.page.waitForFunction(() => [...document.querySelectorAll('.tbl--files button')].some(b => !b.disabled), null, { timeout: 30000 });
        const d = await expectDownload(T, () => btn.click());
        assert(d.size > 50, `${d.name} has ${d.size} bytes`);
        return `${d.name}, ${d.size} bytes`;
      });
    }
    await T.check('export figure SVG (Methods)', async () => {
      const d = await expectDownload(T, () => clickText(T, 'button', /Network figure, colored by community/));
      assert(d.size > 500 && /<svg/.test(d.buf.toString('utf8', 0, 400)), `${d.name}: ${d.size} bytes`);
      return `${d.name}, ${d.size} bytes`;
    });
    await T.check('export summary report (HTML)', async () => {
      await T.page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /Summary report/.test(b.textContent) && !b.disabled), null, { timeout: 60000 });
      const d = await expectDownload(T, () => clickText(T, 'button', /Summary report/));
      assert(d.size > 500, `${d.name}: ${d.size} bytes`);
      return `${d.name}, ${d.size} bytes`;
    });
    await T.check('export project file', async () => {
      const d = await expectDownload(T, () => clickText(T, 'button', /^Save project$/));
      assert(d.size > 1000, `${d.name}: ${d.size} bytes`);
      return `${d.name}, ${d.size} bytes`;
    });
    await T.check('Network view: figure SVG', async () => {
      await go(T, 'network');
      await T.page.waitForSelector('.net__canvas canvas', { timeout: 60000 });
      await T.page.waitForTimeout(1500);
      const d = await expectDownload(T, () => T.page.locator('.net-export button', { hasText: 'SVG' }).click());
      assert(d.size > 500, `${d.name}: ${d.size} bytes`);
      return `${d.name}, ${d.size} bytes`;
    });
    await T.check('Network view: figure PNG is a valid image', async () => {
      const d = await expectDownload(T, () => T.page.locator('.net-export button', { hasText: 'PNG' }).click(), 30000);
      assert(d.head.toString('hex') === '89504e470d0a1a0a', `${d.name} is not a PNG (starts ${d.head.toString('hex')})`);
      const st = await imageStats(T, d.buf.toString('base64'));
      assert(st.width > 100 && st.colors > 4, `PNG ${st.width}x${st.height}, ${st.colors} colours`);
      return `${d.name}, ${d.size} bytes, ${st.width}x${st.height}, ${(st.nonBg * 100).toFixed(1)}% drawn`;
    });
  } },

  { name: 'ask', async run(T) {
    await T.check('Ask: provider and key UI renders (no key entered)', async () => {
      await open(T, 'ask');
      await T.page.waitForFunction(() => { const t = document.querySelector('main')?.innerText || ''; return /Provider/i.test(t) && !/Loading providers|Opening view/.test(t); }, null, { timeout: 30000 });
      const pw = await T.page.locator('main input[type=password], main input[autocomplete=off]').count();
      const sel = await T.page.locator('main select, main [role=radiogroup], main .seg').count();
      await T.shot('9-ask', { full: true });
      assert(pw > 0 || sel > 0, 'no provider or key controls');
      return `${pw} key inputs, ${sel} provider controls`;
    });
    await T.check('Ask: ?mock demo provider (only when mock.js is served)', async () => {
      const has = await T.page.evaluate(async () => (await fetch(new URL('src/ui/services/mock.js', location.href), { method: 'HEAD' })).ok);
      if (!has) return 'skipped: mock.js not in this build (deployed builds strip it)';
      await open(T, 'ask', 'mock');
      await T.page.waitForFunction(() => /Demo mode/i.test(document.body.innerText) && /Offline demo/.test(document.body.innerText), null, { timeout: 30000 });
      await T.shot('9-ask-mock', { full: true });
      return 'demo mode banner shown';
    });
  } },

  { name: 'learn', async run(T) {
    await T.check('Learn: concepts render', async () => {
      await open(T, 'learn');
      await T.page.waitForSelector('main input[type=search]', { timeout: 30000 });
      const n = await T.page.locator('main dt, main .concept, main article').count();
      assert(n > 5, `only ${n} concept elements`);
      await T.shot('10-learn');
      return `${n} concept elements`;
    });
    await T.check('Learn: search filters', async () => {
      const before = (await T.page.locator('main').innerText()).length;
      await T.page.fill('main input[type=search]', 'betweenness');
      await T.page.waitForTimeout(600);
      const after = (await T.page.locator('main').innerText()).length;
      assert(/betweenness/i.test(await T.page.locator('main').innerText()), 'no betweenness after search');
      assert(after < before, `search did not narrow the page (${before} -> ${after} chars)`);
      await T.page.fill('main input[type=search]', '');
    });
    await T.check('Learn: About and limits', async () => {
      await clickText(T, 'a', /About and limits/);
      await T.page.waitForTimeout(800);
      const vis = await T.page.evaluate(() => { const el = document.getElementById('learn-about'); if (!el) return null; const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
      assert(vis, 'About section did not scroll into view');
    });
    await T.check('Interpretive notes switch toggles and persists', async () => {
      const sw = T.page.locator('.explain-switch').filter({ visible: true }).first();
      let target = sw;
      if (!(await sw.count())) { await T.page.locator('.menu-btn').tap(); target = T.page.locator('.app-nav .explain-switch').first(); }
      const before = await target.getAttribute('aria-pressed');
      await target.click();
      const after = await T.page.locator('.explain-switch').first().getAttribute('aria-pressed');
      assert(before !== after, `aria-pressed stayed ${before}`);
      const stored = await T.page.evaluate(() => { try { return localStorage.getItem('orgsignal.explain'); } catch (e) { return 'throws: ' + e.message; } });
      await T.page.reload({ waitUntil: 'load' });
      await T.page.waitForSelector('.explain-switch', { state: 'attached', timeout: 20000 });
      const reloaded = await T.page.locator('.explain-switch').first().getAttribute('aria-pressed');
      assert(reloaded === after, `after reload aria-pressed=${reloaded}, expected ${after} (stored ${stored})`);
      // Put it back.
      const t2 = T.page.locator('.explain-switch').filter({ visible: true }).first();
      if (await t2.count()) await t2.click();
      return `${before} -> ${after}, stored "${stored}", kept after reload`;
    });
  } },

  { name: 'workers-wasm', async run(T) {
    await open(T, 'data');
    await T.check('analysis engine runs in a module worker', async () => {
      const r = await T.page.evaluate(async () => {
        const { createEngine } = await import(new URL('src/analysis/engine.js', location.href).href);
        const e = await createEngine({ worker: true });
        return { mode: e.mode || null };
      });
      const { engineStatus } = await T.page.evaluate(async () => { const m = await import(new URL('src/ui/services/engine.js', location.href).href); return { engineStatus: m.engineStatus() }; });
      assert(engineStatus.available && engineStatus.kind === 'real', `engine: ${JSON.stringify(engineStatus)}`);
      // Prove a worker round trip.
      const ok = await T.page.evaluate(() => new Promise((res) => {
        const w = new Worker(new URL('src/workers/analysis.worker.js', location.href), { type: 'module' });
        const t = setTimeout(() => res('timeout'), 10000);
        w.onerror = e => { clearTimeout(t); res('error: ' + (e.message || 'worker error')); };
        w.onmessage = m => { clearTimeout(t); res('message'); w.terminate(); };
        w.postMessage({ id: 1, method: 'nonexistentMethodForSmoke', args: [] });
      }));
      assert(ok === 'message', `worker round trip: ${ok}`);
      return `mode ${r.mode}; round trip ok`;
    });
    await T.check('import worker (module) starts', async () => {
      const ok = await T.page.evaluate(() => new Promise((res) => {
        const w = new Worker(new URL('src/workers/import.worker.js', location.href), { type: 'module' });
        const t = setTimeout(() => { w.terminate(); res('no error in 3s'); }, 3000);
        w.onerror = e => { clearTimeout(t); res('error: ' + (e.message || 'worker error')); };
      }));
      assert(!/^error/.test(ok), ok);
      return ok;
    });
    await T.check('generate worker (module) starts', async () => {
      const ok = await T.page.evaluate(() => new Promise((res) => {
        const w = new Worker(new URL('src/ui/generate/generate.worker.js', location.href), { type: 'module' });
        const t = setTimeout(() => { w.terminate(); res('no error in 3s'); }, 3000);
        w.onerror = e => { clearTimeout(t); res('error: ' + (e.message || 'worker error')); };
      }));
      assert(!/^error/.test(ok), ok);
      return ok;
    });
    await T.check('sql.js WASM compiles under the CSP', async () => {
      const r = await T.page.evaluate(async () => {
        const { default: initSqlJs } = await import(new URL('vendor/sql-wasm-browser.mjs', location.href).href);
        const wasmUrl = new URL('vendor/sql-wasm-browser.wasm', location.href);
        const SQL = await initSqlJs({ locateFile: () => wasmUrl.href });
        const db = new SQL.Database();
        const out = db.exec('select 6*7 as x')[0].values[0][0];
        db.close();
        return out;
      });
      assert(r === 42, `sqlite returned ${r}`);
      return 'select 6*7 = 42';
    });
    await T.check('DecompressionStream deflate-raw (zip reader) available', async () => {
      const r = await T.page.evaluate(() => { try { new DecompressionStream('deflate-raw'); new DecompressionStream('gzip'); return 'ok'; } catch (e) { return e.message; } });
      assert(r === 'ok', r);
    });
  } },
];

await main();
