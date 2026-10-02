// Paste ties: example text plus an error line; preview flags it; analyze.
import { clickText } from './30-roster.mjs';
export const name = 'paste';
export async function run({ page, open, shot, assert, step }) {
  step('open');
  await open('view=build&tab=paste');
  await page.waitForSelector('#ob-paste-text');
  await page.type('#ob-paste-text', 'Avery - Jordan\nJordan -> Sam, 3\nnot a tie line\n"Lee, Morgan", Avery, 2');
  await page.waitForSelector('.ob-lines li.bad');
  assert.equal(await page.$$eval('.ob-lines li.bad', els => els.length), 1);
  const summary = await page.$eval('#ob-paste-summary', el => el.textContent);
  assert.match(summary, /3 ties among 4 people/);
  await shot('1-preview');
  await clickText(page, 'button', 'Analyze this network');
  await page.waitForFunction(() => window.__harness.loaded.length === 1);
  const n = await page.evaluate(() => window.__harness.loaded[0].ds.nodes.count);
  assert.equal(n, 4);
}
