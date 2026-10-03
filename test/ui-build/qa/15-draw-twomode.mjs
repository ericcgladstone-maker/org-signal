// Draw editor, two-mode drawings: turn a drawing two-mode, place people and
// events (circles and squares), connect across modes, refuse a same-mode tie
// with a visible reason, load the students-and-clubs example, lay it out in
// two columns, table with a Mode column, and hand a two-mode dataset over.
export const name = 'draw-twomode';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function centres(page) {
  return page.$$eval('[data-node]', els => els.map(el => {
    const c = el.querySelector('.shape').getBoundingClientRect();
    return { id: el.getAttribute('data-node'), mode: el.getAttribute('data-mode'), x: c.left + c.width / 2, y: c.top + c.height / 2, t: el.getAttribute('transform') };
  }));
}

async function clickButton(page, test) {
  const ok = await page.evaluate(src => {
    const re = new RegExp(src);
    const b = [...document.querySelectorAll('.ob-draw button')].find(x => re.test(x.textContent.trim()) && !x.disabled);
    if (b) b.click();
    return !!b;
  }, test);
  if (!ok) throw new Error(`button /${test}/ not found or disabled`);
  await sleep(60);
}

async function fileMenu(page, test) {
  await page.$eval('.ob-menu', d => { d.open = true; });
  await clickButton(page, test);
}

async function drag(page, a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2 + 8, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await sleep(60);
}

export async function run({ page, width, open, shot, assert, step }) {
  step('open and turn two-mode');
  await open('view=build&tab=draw');
  await page.waitForSelector('.ob-canvas svg');
  await fileMenu(page, '^Two-mode drawing');
  await sleep(80);
  assert.ok(await page.$('.ob-addmode'), 'toolbar offers which kind to add');
  assert.ok(await page.evaluate(() => window.__harness.notices.some(n => /Two-mode drawing/.test(n.text))), 'says what happened');
  await page.$eval('.ob-canvas', el => el.scrollIntoView({ block: 'center' }));
  const box = await page.$eval('.ob-canvas', el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });

  step('place two people (circles) and two events (squares)');
  await clickButton(page, 'Person$');
  for (const [fx, fy] of [[0.2, 0.25], [0.2, 0.6]]) { await page.mouse.click(box.x + box.w * fx, box.y + box.h * fy); await sleep(40); await page.keyboard.press('Enter'); await sleep(40); }
  await clickButton(page, 'Event$');
  for (const [fx, fy] of [[0.7, 0.25], [0.7, 0.6]]) { await page.mouse.click(box.x + box.w * fx, box.y + box.h * fy); await sleep(40); await page.keyboard.press('Enter'); await sleep(40); }
  let ns = await centres(page);
  assert.deepEqual(ns.map(n => n.mode).sort(), ['0', '0', '1', '1']);
  assert.equal(await page.$$eval('[data-node] rect.shape', e => e.length), 2, 'events are squares');
  assert.ok(await page.$eval('.ob-modekey', el => /People \(2\)/.test(el.textContent) && /Events \(2\)/.test(el.textContent)), 'shape key in words');

  step('connect a person to an event; a person to a person is refused');
  await clickButton(page, '^Connect$');
  ns = await centres(page);
  const p = ns.filter(n => n.mode === '0'), e = ns.filter(n => n.mode === '1');
  await drag(page, p[0], e[0]);
  await drag(page, p[1], e[0]);
  assert.equal(await page.$$eval('[data-edge]', x => x.length), 2);
  await drag(page, p[0], p[1]);
  assert.equal(await page.$$eval('[data-edge]', x => x.length), 2, 'same-mode tie refused');
  assert.ok(await page.evaluate(() => window.__harness.notices.some(n => n.level === 'warn' && /only join people with events/.test(n.text))), 'reason shown');
  await shot('drawn');

  step('example: students and clubs, two columns');
  await fileMenu(page, '^Students and clubs');
  await sleep(120);
  assert.equal(await page.$$eval('[data-node]', x => x.length), 10);
  assert.equal(await page.$$eval('[data-node] rect.shape', x => x.length), 4);
  assert.ok(await page.$eval('.ob-example', el => el.textContent.includes('Two-mode betweenness')), 'what to look for');
  await clickButton(page, '^Select$');
  await page.select('#ob-draw-layout', 'columns');
  await clickButton(page, '^Apply layout$');
  await sleep(700);
  ns = await centres(page);
  const xs0 = new Set(ns.filter(n => n.mode === '0').map(n => Math.round(n.x))), xs1 = new Set(ns.filter(n => n.mode === '1').map(n => Math.round(n.x)));
  assert.equal(xs0.size, 1, 'students in one column');
  assert.equal(xs1.size, 1, 'clubs in one column');
  assert.ok([...xs0][0] < [...xs1][0]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  await page.$eval('.ob-canvas', el => el.scrollIntoView({ block: 'center' }));
  await shot('example');

  step('inspector: mode in words for one node');
  ns = await centres(page);
  const student = ns.find(n => n.mode === '0');
  await page.mouse.click(student.x, student.y);
  await sleep(60);
  assert.ok(await page.$('#ob-n-mode'), 'Mode field');
  assert.equal(await page.$eval('#ob-n-mode', s => s.selectedOptions[0].textContent), 'Student (circle)');

  step('table: Mode column');
  await clickButton(page, '^Table$');
  await page.waitForSelector('.ob-drawtable');
  assert.ok(await page.$$eval('.ob-drawtable th', t => t.some(x => x.textContent === 'Mode')));
  await shot('table');
  await clickButton(page, '^Canvas$');

  step('analyze: a two-mode dataset');
  await clickButton(page, '^Analyze this network$');
  await page.waitForFunction(() => window.__harness.loaded.length > 0, { timeout: 5000 });
  const res = await page.evaluate(() => { const d = window.__harness.loaded.at(-1).ds; return { n: d.nodes.count, e: d.events.count, tm: d.meta.sources[0].twoMode, modes: d.nodes.attrs.map(a => a.bipartite) }; });
  assert.equal(res.n, 10);
  assert.equal(res.e, 10);
  assert.deepEqual(res.tm.labels, ['Students', 'Clubs']);
  assert.equal(res.modes.filter(m => m === 1).length, 4);
}
