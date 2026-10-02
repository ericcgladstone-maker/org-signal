// Ego builder end to end: two generators, interpreters, names with a
// cross-generator duplicate, describe, contexts, an exception tie, analyze.
export const name = 'ego';

export async function run({ page, open, shot, assert, step }) {
  const clickText = async (sel, text) => {
    const ok = await page.evaluate((sel, text) => {
      const el = [...document.querySelectorAll(sel)].find(e => e.textContent.trim().includes(text));
      if (!el) return false;
      el.click();
      return true;
    }, sel, text);
    assert.ok(ok, `no ${sel} with text "${text}"`);
  };
  const next = async () => { await clickText('.ego-nav .ob-btn.primary', 'Next'); // the step change moves focus to the step heading on the next frame; let it land before typing
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };

  step('open');
  await open('view=build&tab=ego');
  await page.waitForSelector('.ego');

  step('generators');
  await clickText('.ob-check', 'Advice');
  await page.waitForFunction(() => document.querySelectorAll('.ego .ego-item').length === 2);
  await shot('1-generators');
  await next();

  step('interpreters');
  await page.waitForSelector('#ego-weight');
  const n = await page.$$eval('.ego .ego-item', els => els.length);
  assert.equal(n, 2);
  await next();

  step('names');
  const inputs = await page.$$('.ego-addname input');
  assert.equal(inputs.length, 2);
  for (const nm of ['Avery Lee', 'Jordan Park', 'Sam Ortiz']) { await inputs[0].type(nm); await inputs[0].press('Enter'); }
  await inputs[1].type('avery lee'); await inputs[1].press('Enter');
  await page.waitForFunction(() => /already named under Important matters/.test(document.querySelector('.ego').textContent));
  for (const nm of ['Kim Ng', 'Rui Costa']) { await inputs[1].type(nm); await inputs[1].press('Enter'); }
  await page.waitForFunction(() => document.querySelectorAll('.ego-names li').length === 6);
  await shot('3-names');
  await next();

  step('describe');
  await page.waitForSelector('.ego-describe');
  await page.select('#cell-0-0', 'friend');
  await page.select('#cell-1-1', '4');
  await page.focus('#cell-1-1');
  await page.keyboard.press('Enter');
  const focused = await page.evaluate(() => document.activeElement.id);
  assert.equal(focused, 'cell-2-1');
  await shot('4-describe');
  await next();

  step('ties: contexts');
  await clickText('.ego .ob-btn', 'Add Work');
  await clickText('.ego .ob-btn', 'Add Family');
  await page.waitForSelector('.ego-ctx');
  const boxes = await page.$$('.ego-ctx tbody tr');
  // Avery, Jordan, Sam at work; Kim and Rui family
  const tick = async (row, col) => { const cb = await boxes[row].$$('input[type=checkbox]'); await cb[col].click(); };
  await tick(0, 0); await tick(1, 0); await tick(2, 0); await tick(3, 1); await tick(4, 1);
  await page.waitForFunction(() => document.querySelectorAll('.ego-canvas .ego-tie').length === 4);

  step('ties: exception on canvas');
  const nodes = await page.$$('.ego-canvas .ego-node circle');
  await nodes[0].click();
  await nodes[3].click();
  await page.waitForFunction(() => document.querySelectorAll('.ego-canvas .ego-tie.added').length === 1);
  step('ties: pair list');
  await page.type('#ego-pair-q', 'Rui');
  await page.waitForFunction(() => document.querySelectorAll('.ego-pairs li').length === 4);
  await shot('5-ties');
  await next();

  step('review');
  await page.waitForSelector('.ob-kv');
  await shot('6-review');
  await clickText('.ob-btn.primary', 'Analyze this network');
  await page.waitForFunction(() => window.__harness.loaded.length === 1, { timeout: 5000 });
  const r = await page.evaluate(() => {
    const ds = window.__harness.loaded[0].ds;
    return { view: ds.meta.sources[0].view, ctx: ds.meta.sources[0].context, nodes: ds.nodes.count, events: ds.events.count };
  });
  assert.equal(r.view, 'ego');
  assert.equal(r.ctx, 'survey');
  assert.equal(r.nodes, 6);
  // 3 + 3 ego->alter (Avery twice) + 4 implied + 1 exception
  assert.equal(r.events, 11);

  step('resume after reload');
  await page.goto(page.url().replace('clear=1', 'clear=0'), { waitUntil: 'networkidle0' });
  await page.waitForSelector('.ob-kv');
  const people = await page.$eval('.ob-kv', el => el.textContent);
  assert.ok(/Peoplenamed5/.test(people.replace(/\s+/g, '')), 'autosaved session restored');
}
