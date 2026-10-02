// Shell smoke test: both views mount, the tab list is keyboard operable.
export const name = 'shell';
export const allowMissing = /\/src\/(generator|analysis)\//; // other owners' modules, possibly incomplete
export async function run({ page, open, shot, assert, step }) {
  step('open build');
  await open('view=build');
  await page.waitForSelector('.ob .tabs [role=tab]');
  const tabs = await page.$$eval('.ob .tabs [role=tab]', els => els.map(e => e.textContent));
  assert.equal(tabs.length, 5);
  step('keyboard tabs');
  await page.focus('.ob .tabs [aria-selected=true]');
  await page.keyboard.press('ArrowRight');
  const sel = await page.$eval('.ob .tabs [aria-selected=true]', e => e.textContent);
  assert.equal(sel, 'Ego network');
  await shot('build');
  step('open generate');
  await open('view=generate');
  await page.waitForSelector('.ob');
  await shot('generate');
}
