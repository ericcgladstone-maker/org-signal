// Generate: walk the form, check an invalid option is disabled, then either
// generate and analyze (generator present) or confirm the neutral
// unavailable state (generator missing).
import { clickText } from './30-roster.mjs';
export const name = 'generate';
// The generator and analysis modules belong to other engineers and may be
// incomplete; their 404s are tolerated as long as the view degrades cleanly.
export const allowMissing = /\/src\/(generator|analysis)\//;
export async function run({ page, open, shot, assert, step }) {
  step('open');
  await open('view=generate');
  await page.waitForSelector('input[name="ob-gen-context"]');
  const fallback = await page.$('.ob-unavailable') !== null;
  step('choose workplace / slack');
  await page.click('input[name="ob-gen-context"][value="workplace"]');
  await page.click('input[name="ob-gen-medium"][value="slack"]');
  // A Slack export is an admin export of everyone: "one person" is not offered.
  const egoDisabled = await page.$eval('input[name="ob-gen-observation"][value="ego"]', el => el.disabled);
  assert.equal(egoDisabled, true);
  step('switch to email, observation ego allowed');
  await page.click('input[name="ob-gen-medium"][value="email"]');
  assert.equal(await page.$eval('input[name="ob-gen-observation"][value="ego"]', el => el.disabled), false);
  await page.click('input[name="ob-gen-observation"][value="ego"]');
  step('back to slack resets observation');
  await page.click('input[name="ob-gen-medium"][value="slack"]');
  assert.equal(await page.$eval('input[name="ob-gen-observation"]:checked', el => el.value), 'full');
  step('size');
  await page.$eval('#ob-gen-size', el => { el.value = '60'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('#ob-gen-summary').textContent.includes('60 people'));
  await shot('1-form');
  const btn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Generate and analyze'));
  if (fallback) {
    step('fallback: buttons disabled');
    assert.equal(await btn.evaluate(b => b.disabled), true);
    return;
  }
  step('generate and analyze');
  await clickText(page, 'button', 'Generate and analyze');
  await page.waitForFunction(() => window.__harness.loaded.length === 1 || document.querySelector('.ob-gen [role=alert]'), { timeout: 60000 });
  const alert = await page.$eval('.ob-gen [role=alert]', el => el.textContent).catch(() => null);
  assert.equal(alert, null, 'generation error: ' + alert);
  const ds = await page.evaluate(() => { const d = window.__harness.loaded[0].ds; return { n: d.nodes.count, e: d.events.count }; });
  assert.ok(ds.n > 0 && ds.e > 0);
  step('recovery');
  await page.waitForSelector('#ob-rec-title');
  const recBtn = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Run recovery check'); return b && !b.disabled; });
  if (recBtn) {
    await clickText(page, 'button', 'Run recovery check');
    await page.waitForFunction(() => !document.body.textContent.includes('Checking...'), { timeout: 60000 });
  }
  await shot('2-generated');
}
