// Draw editor: place nodes by mouse and keyboard, connect, snap, drag,
// layout, undo, help overlay, table view, hand-off.
export const name = 'draw';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function nodeCentres(page) {
  return page.$$eval('[data-node]', els => els.map(el => {
    const c = el.querySelector('circle:not(.focus-ring)').getBoundingClientRect();
    return { id: el.getAttribute('data-node'), x: c.left + c.width / 2, y: c.top + c.height / 2, t: el.getAttribute('transform') };
  }));
}

async function clickButton(page, text) {
  const ok = await page.evaluate(t => {
    const b = [...document.querySelectorAll('.ob-draw button')].find(x => x.textContent.trim() === t && !x.disabled);
    if (b) b.click();
    return !!b;
  }, text);
  if (!ok) throw new Error(`button "${text}" not found or disabled`);
  await sleep(60);
}

export async function run({ page, width, open, shot, assert, step }) {
  step('open');
  await open('view=build&tab=draw');
  await page.waitForSelector('.ob-canvas svg');
  await page.$eval('.ob-canvas', el => el.scrollIntoView({ block: 'center' }));
  const box = await page.$eval('.ob-canvas', el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });

  step('add nodes by mouse');
  await clickButton(page, 'Add node');
  const spots = [[0.25, 0.3], [0.6, 0.3], [0.45, 0.7]];
  for (const [fx, fy] of spots) { await page.mouse.click(box.x + box.w * fx, box.y + box.h * fy); await sleep(40); }
  let ns = await nodeCentres(page);
  assert.equal(ns.length, 3);

  step('add node by keyboard');
  await page.$eval('.ob-canvas svg', el => el.focus());
  await page.keyboard.press('n');
  await sleep(50);
  ns = await nodeCentres(page);
  assert.equal(ns.length, 4);

  step('connect by drag');
  await clickButton(page, 'Connect');
  ns = await nodeCentres(page); // the toolbar may reflow when the mode changes
  await page.mouse.move(ns[0].x, ns[0].y);
  await page.mouse.down();
  await page.mouse.move((ns[0].x + ns[1].x) / 2, ns[0].y + 10, { steps: 4 });
  await page.mouse.move(ns[1].x, ns[1].y, { steps: 4 });
  await page.mouse.up();
  await sleep(50);
  assert.equal(await page.$$eval('[data-edge]', e => e.length), 1);

  step('connect by keyboard (Tab, Space, Tab, E)');
  await page.$eval('.ob-canvas svg', el => el.focus());
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');           // focus node 1 (selects it)
  await page.keyboard.press('Tab');           // node 2
  await page.keyboard.press('Tab');           // node 3, selected alone
  await page.keyboard.press('Space');         // keep node 3 selected
  await page.keyboard.press('Tab');           // focus node 4, selection stays
  await page.keyboard.press('e');             // connects selected (3) to focused (4)
  await sleep(50);
  assert.equal(await page.$$eval('[data-edge]', e => e.length), 2);

  step('snap to grid');
  await clickButton(page, 'Select');
  await clickButton(page, 'Snap to grid');
  assert.equal(await page.$eval('.ob-toolbar button[title="Snap to grid (G)"]', b => b.getAttribute('aria-pressed')), 'true');

  step('drag a node with snapping');
  ns = await nodeCentres(page);
  const n2 = ns[2];
  await page.mouse.move(n2.x, n2.y);
  await page.mouse.down();
  await page.mouse.move(n2.x + 37, n2.y + 23, { steps: 6 });
  await page.mouse.up();
  await sleep(60);
  const moved = (await nodeCentres(page)).find(n => n.id === n2.id);
  assert.notEqual(moved.t, n2.t, 'node moved');
  const [tx, ty] = moved.t.match(/-?[\d.]+/g).map(Number);
  assert.ok(Math.abs(tx / 20 - Math.round(tx / 20)) < 1e-6 && Math.abs(ty / 20 - Math.round(ty / 20)) < 1e-6, `snapped to 20px grid: ${moved.t}`);
  await shot('drawn');

  step('layout');
  const before = (await nodeCentres(page)).map(n => n.t).join('|');
  await page.select('select[aria-label="Layout (L)"]', 'circle');
  await page.keyboard.press('Escape');
  await clickButton(page, 'Apply layout');
  await sleep(700);
  const after = (await nodeCentres(page)).map(n => n.t).join('|');
  assert.notEqual(after, before, 'layout moved nodes');

  step('undo layout');
  await clickButton(page, 'Undo');
  await sleep(60);
  assert.equal((await nodeCentres(page)).map(n => n.t).join('|'), before);
  await clickButton(page, 'Redo');

  step('example and hulls');
  await clickButton(page, 'Load example');
  await sleep(100);
  assert.equal(await page.$$eval('[data-node]', e => e.length), 8);
  assert.ok(await page.$$eval('.hull', e => e.length) === 2, 'two group hulls');
  await page.$eval('.ob-canvas', el => el.scrollIntoView({ block: 'center' }));
  await shot('example');

  step('help overlay');
  await page.$eval('.ob-canvas svg', el => el.focus());
  await page.keyboard.type('?');
  await page.waitForSelector('.ob-dialog');
  await shot('help');
  await page.keyboard.press('Escape');
  await sleep(50);
  assert.equal(await page.$('.ob-dialog'), null);

  step('table view');
  await clickButton(page, 'Table view');
  await page.waitForSelector('.ob-drawtable');
  assert.equal(await page.$$eval('.ob-drawtable section:first-child tbody tr', r => r.length), 8);
  await shot('table');
  await clickButton(page, 'Table view');

  step('analyze');
  await clickButton(page, 'Analyze this network');
  await page.waitForFunction(() => window.__harness.loaded.length > 0, { timeout: 5000 });
  const res = await page.evaluate(() => { const d = window.__harness.loaded[0].ds; return { n: d.nodes.count, e: d.events.count, view: d.meta.sources[0].view }; });
  assert.equal(res.n, 8);
  assert.equal(res.view, 'full');
  assert.ok(res.e >= 11);
}
