// Perceived: 4 people, 3 informants, a few ties each, compare, analyze consensus.
import { clickText } from './30-roster.mjs';
export const name = 'perceived';
export async function run({ page, open, shot, assert, step }) {
  step('open');
  await open('view=build&tab=perceived');
  await page.$eval('#ob-css-paste', el => { el.value = 'Ann\nBo\nCy\nDee'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await clickText(page, 'button', 'Add to roster');
  step('informants');
  await clickText(page, 'button', 'Next: Informants');
  // A one-way relation, so the hand counts below are over ordered pairs.
  await page.$eval('#ob-css-rel', el => { el.value = 'Advice'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => !document.querySelector('.ob label.check input[type=checkbox]')?.checked);
  for (const n of ['Ann', 'Bo', 'Cy']) await clickText(page, 'label.check', n);
  await page.waitForFunction(() => document.body.textContent.includes('3 informants'));
  await shot('1-informants');
  step('reports');
  await clickText(page, 'button', 'Next: Reports');
  const cell = async (r, c) => { await page.click(`.ob-matrix td[data-r="${r}"][data-c="${c}"]`); };
  // Ann: A->B, B->C ; Bo: A->B, B->A ; Cy: A->B, C->D
  await cell(0, 1); await cell(1, 2);
  const opts = await page.$$eval('#ob-css-inf option', os => os.map(o => o.value));
  await page.select('#ob-css-inf', opts[1]); await cell(0, 1); await cell(1, 0);
  await page.select('#ob-css-inf', opts[2]); await cell(0, 1); await cell(2, 3);
  await shot('2-reports');
  step('results');
  await clickText(page, 'button', 'Next: Compare');
  await page.waitForFunction(() => document.body.textContent.includes('How each informant compares'));
  const rows = await page.$$eval('.tbl tbody tr', trs => trs.length);
  assert.ok(rows >= 3);
  await page.waitForFunction(() => document.querySelector('.verdict__claim')?.textContent.includes('perceive'));
  await shot('3-results');
  await clickText(page, 'button', 'Analyze this network');
  await page.waitForFunction(() => window.__harness.loaded.length === 1);
  // Consensus at 50%: A->B (3/3) only; B->C, B->A, C->D are 1/3.
  const e = await page.evaluate(() => window.__harness.loaded[0].ds.events.count);
  assert.equal(e, 1);
}
