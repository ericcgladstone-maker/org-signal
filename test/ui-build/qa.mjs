// Browser QA for the Build and Generate views.
//
//   node test/ui-build/qa.mjs [--only=draw,ego] [--port=8791] [--headful]
//
// Serves app/ with python3 -m http.server, opens test/ui-build/harness.html in
// the Playwright-cached Chromium through puppeteer-core (both already on this
// machine; nothing is installed), and runs every scenario module in
// test/ui-build/qa/*.mjs at 1440px and 390px. A scenario exports
//   export const name = 'draw';
//   export async function run({ page, width, open, shot, assert, step }) {}
// The runner fails on console errors, page errors, failed requests for app
// files and horizontal page overflow. Screenshots go to the session scratchpad.

import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../..');
const PUPPETEER = '/Users/ericgladstone/My Drive (eric.c.gladstone@gmail.com)/Projects/Website Graystone Industries/site/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const CHROME = path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const OUT = process.env.QA_OUT || '/private/tmp/claude-501/-Users-ericgladstone-My-Drive--eric-c-gladstone-gmail-com--Projects-Software-Org-Signal/28c7544b-bf65-4ca4-99cc-4f4f74736ee5/scratchpad/qa';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = Number(args.port || 8791);
const only = args.only ? String(args.only).split(',') : null;
const widths = args.widths ? String(args.widths).split(',').map(Number) : [1440, 390];
mkdirSync(OUT, { recursive: true });

const { default: puppeteer } = await import(pathToFileURL(PUPPETEER).href);

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: APP, stdio: 'ignore' });
const base = `http://127.0.0.1:${PORT}/test/ui-build/harness.html`;
await waitForServer(base);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: !args.headful, args: ['--no-sandbox'] });
const scenarioDir = path.join(HERE, 'qa');
const files = existsSync(scenarioDir) ? readdirSync(scenarioDir).filter(f => f.endsWith('.mjs')).sort() : [];
let failures = 0;

for (const f of files) {
  const mod = await import(pathToFileURL(path.join(scenarioDir, f)).href);
  const name = mod.name || f.replace(/\.mjs$/, '');
  if (only && !only.includes(name)) continue;
  for (const width of widths) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1 });
    const errors = [];
    // 'Failed to load resource' console lines carry no URL; the response handler below reports real 4xx with their URL (favicon excluded).
    page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    // A scenario may allow missing files from other owners' modules that are
    // still being written (the view must then show its neutral unavailable state).
    const allowed = url => /favicon/.test(url) || (mod.allowMissing && mod.allowMissing.test(url));
    page.on('requestfailed', r => { if (!allowed(r.url())) errors.push('requestfailed: ' + r.url()); });
    page.on('response', r => { if (r.status() >= 400 && !allowed(r.url())) errors.push(`http ${r.status()}: ${r.url()}`); });
    page.on('dialog', d => d.accept());
    const label = `${name}@${width}`;
    let current = 'start';
    const ctx = {
      page, width, assert,
      async open(query = '') {
        await page.goto(`${base}?clear=1&${query}`, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => window.__harness?.ready === true, { timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
      },
      async shot(tag) {
        const file = path.join(OUT, `${name}-${width}-${tag}.png`);
        await page.screenshot({ path: file, fullPage: true });
        return file;
      },
      step(s) { current = s; },
      async overflow() {
        return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      },
    };
    try {
      await mod.run(ctx);
      const over = await ctx.overflow();
      if (over > 0) throw new Error(`horizontal overflow of ${over}px`);
      if (errors.length) throw new Error('browser errors:\n  ' + errors.join('\n  '));
      console.log(`PASS ${label}`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${label} at step "${current}": ${e.message}`);
      if (errors.length && !/browser errors/.test(e.message)) console.log('  browser errors:\n    ' + errors.join('\n    '));
      try { await ctx.shot('FAIL'); } catch { /* page may be gone */ }
    }
    await page.close();
  }
}

await browser.close();
server.kill();
console.log(failures ? `${failures} scenario run(s) failed` : 'all QA scenarios passed');
console.log('screenshots:', OUT);
process.exit(failures ? 1 : 0);

async function waitForServer(url) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('http.server did not start');
}
