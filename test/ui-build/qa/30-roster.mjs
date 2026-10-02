// Roster: 60 names, keyboard through the grid, toggle cells, analyze.
export const name = 'roster';
export async function run({ page, open, shot, assert, step }) {
  step('open');
  await open('view=build&tab=roster');
  step('paste roster');
  const names = Array.from({ length: 60 }, (_, i) => `Person ${String(i + 1).padStart(2, '0')}`).join('\n');
  await page.$eval('#ob-roster-paste', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, names);
  await clickText(page, 'button', 'Add to roster');
  await page.waitForFunction(() => document.body.textContent.includes('60 on roster'));
  await shot('1-roster');
  step('relations');
  await clickText(page, 'button', 'Next: Relations');
  await clickText(page, 'label', 'Advice');
  await page.waitForSelector('.ob-table input[aria-label="Relation name"]');
  await shot('2-relations');
  step('grid');
  await clickText(page, 'button', 'Next: Collect ties');
  await page.waitForSelector('.ob-matrix td[tabindex="0"]');
  await page.focus('.ob-matrix td[tabindex="0"]');
  await page.keyboard.press('Space');            // 0 -> 1
  await page.keyboard.press('ArrowDown');        // row 1, col 1 = self
  await page.keyboard.press('ArrowRight');       // 1 -> 2
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');              // 1 -> 59
  await page.keyboard.press('1');
  await page.keyboard.press('PageDown');         // 11 -> 59
  await page.keyboard.press('Space');
  const on = await page.$$eval('.ob-matrix td.on', els => els.length);
  assert.equal(on, 4);
  await page.click('.ob-matrix td[data-r="5"][data-c="7"]');
  assert.equal(await page.$$eval('.ob-matrix td.on', els => els.length), 5);
  // Sticky headers: scroll the grid and the column header row stays visible.
  await page.$eval('.ob-matrixwrap', el => { el.scrollTop = 400; el.scrollLeft = 300; });
  const headTop = await page.$eval('.ob-matrix thead th:nth-child(5)', el => el.getBoundingClientRect().top - el.closest('.ob-matrixwrap').getBoundingClientRect().top);
  assert.ok(Math.abs(headTop) < 3, 'header row stays at the top of the grid');
  await shot('3-grid');
  step('multi mode');
  await clickText(page, 'span', 'Each member answers a survey');
  await page.waitForFunction(() => document.body.textContent.includes('Template, Google Forms shape'));
  await shot('4-multi');
  await clickText(page, 'span', 'One informant fills the grid');
  step('review');
  await clickText(page, 'button', 'Next: Review');
  await clickText(page, 'button', 'Analyze this network');
  await page.waitForFunction(() => window.__harness.loaded.length === 1);
  const r = await page.evaluate(() => { const ds = window.__harness.loaded[0].ds; return { n: ds.nodes.count, e: ds.events.count, view: ds.meta.sources[0].view, ctx: ds.meta.sources[0].context }; });
  assert.deepEqual(r, { n: 60, e: 5, view: 'full', ctx: 'survey' });
  await shot('5-review');
}

export async function clickText(page, sel, text) {
  const ok = await page.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find(e => e.textContent.trim() === text || e.textContent.trim().startsWith(text));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' }); el.click(); return true;
  }, sel, text);
  if (!ok) throw new Error(`no ${sel} with text "${text}"`);
  await new Promise(r => setTimeout(r, 60));
}
