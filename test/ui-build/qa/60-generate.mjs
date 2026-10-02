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
  const seg = async (legend, label) => {
    const ok = await page.evaluate((legend, label) => {
      const fs = [...document.querySelectorAll('.ob-gen fieldset')].find(f => f.querySelector('legend')?.textContent.includes(legend));
      const b = fs && [...fs.querySelectorAll('.seg button')].find(x => x.textContent.trim() === label);
      if (!b) return null;
      if (!b.disabled) b.click();
      return { disabled: b.disabled };
    }, legend, label);
    assert.ok(ok, `no "${label}" under ${legend}`);
    await new Promise(r => setTimeout(r, 60));
    return ok;
  };
  const pressed = legend => page.evaluate(legend => [...document.querySelectorAll('.ob-gen fieldset')].find(f => f.querySelector('legend')?.textContent.includes(legend)).querySelector('.seg button[aria-pressed="true"]').textContent.trim(), legend);
  step('choose workplace / slack');
  await page.click('input[name="ob-gen-context"][value="workplace"]');
  await seg('Medium', 'Slack');
  // An option the medium's export cannot show stays visible, disabled, with the reason written out.
  assert.equal((await seg('What the export shows', "One person's posts")).disabled, true);
  assert.ok(await page.evaluate(() => /Not available: One person's posts\. A Slack export does not show this slice/.test(document.querySelector('.ob-gen').textContent)));
  step('a one-person view warns that it hides the planted groups');
  assert.equal((await seg('What the export shows', 'One person')).disabled, false);
  assert.equal(await pressed('What the export shows'), 'One person');
  assert.ok(await page.evaluate(() => /cannot appear as structure/.test(document.querySelector('.ob-gen').textContent)));
  await seg('What the export shows', 'Everyone');
  step('online public starts on everyone (P3)');
  await page.click('input[name="ob-gen-context"][value="online"]');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(await pressed('What the export shows'), 'Everyone');
  await page.click('input[name="ob-gen-context"][value="workplace"]');
  await new Promise(r => setTimeout(r, 60));
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
  step('recovery runs by itself and survives remounting');
  await page.waitForSelector('#ob-rec-title');
  await page.waitForFunction(() => /Recovered|Partly|Missed/.test(document.querySelector('.ob-recovery')?.textContent || ''), { timeout: 60000 });
  const g = await page.evaluate(async () => {
    const { store } = await import('/src/ui/store.js');
    const x = store.get().generated;
    return x && { name: x.datasetName === window.__harness.loaded[0].ds.meta.name, checks: x.recovery?.checks?.length, gt: !!x.groundTruth };
  });
  assert.deepEqual(g, { name: true, checks: g.checks, gt: true });
  assert.ok(g.checks > 3);
  const comm = await page.evaluate(() => [...document.querySelectorAll('.ob-checks li')].find(li => /detected communities/.test(li.textContent))?.textContent || '');
  assert.ok(!/Not checked/i.test(comm), 'communities compared: ' + comm);
  await shot('2-generated');
}
