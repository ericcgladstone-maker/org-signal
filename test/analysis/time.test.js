import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder, VIEWS } from '../../src/core/model.js';
import { defaultSettings } from '../../src/analysis/construct.js';
import { makeWindows, timeSeries, detectShifts, compareBeforeAfter, robustShifts, cusumShifts, chooseWindow, suggestTimeRange, sourceCoverage } from '../../src/analysis/time.js';
import { createRng } from '../../src/analysis/rng.js';

const DAY = 86400000;
const MON = Date.UTC(2026, 0, 5); // a Monday

test('calendar windows: weeks start Monday UTC, months follow the calendar', () => {
  const w = makeWindows(MON + 2 * DAY, MON + 15 * DAY, 'week');
  assert.equal(w.length, 3);
  assert.equal(w[0].start, MON);
  assert.equal(w[1].start - w[0].start, 7 * DAY);
  const m = makeWindows(Date.UTC(2026, 0, 31), Date.UTC(2026, 2, 1), 'month');
  assert.deepEqual(m.map(x => x.label), ['2026-01', '2026-02', '2026-03']);
  assert.equal(m[1].end - m[1].start, 28 * DAY);
  const r = makeWindows(0, 10, { size: 4, step: 2 });
  assert.deepEqual(r.map(x => x.start), [0, 2, 4, 6, 8, 10]);
});

test('timeSeries: per-window ties, turnover and activity', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const [A, B, C] = ['a', 'b', 'c'].map(k => b.node('t:' + k, { attrs: { team: k === 'c' ? 'Y' : 'X' } }));
  b.event({ actor: A, t: MON + 1 * DAY, targets: [[B, 'dm']] });
  b.event({ actor: A, t: MON + 8 * DAY, targets: [[B, 'dm']] });
  b.event({ actor: A, t: MON + 15 * DAY, targets: [[C, 'dm']] });
  b.event({ actor: C, t: MON + 16 * DAY, targets: [[A, 'dm']] });
  b.event({ actor: C, t: NaN, targets: [[B, 'dm']] });
  const ds = b.build();
  const ts = timeSeries(ds, { ...defaultSettings(ds), directed: true }, { window: 'week', metrics: ['degree', 'betweenness'], attr: 'team' });
  assert.equal(ts.windows.length, 3);
  assert.deepEqual(ts.windows.map(w => w.ties), [1, 1, 2]);
  assert.deepEqual(ts.ties.formed, [1, 0, 2]);
  assert.deepEqual(ts.ties.dissolved, [0, 0, 1]);
  assert.deepEqual(ts.ties.persisted, [0, 1, 0]);
  assert.equal(ts.node.degree[2][A], 2);
  assert.equal(ts.node.degree[0][C], 0, 'absent count metric is 0');
  assert.ok(Number.isNaN(ts.node.betweenness[0][C]), 'absent other metric is NaN');
  assert.deepEqual(ts.activity.total, [1, 1, 2]);
  assert.deepEqual(ts.activity.group.values, ['X', 'Y']);
  assert.deepEqual(ts.activity.group.counts, [[1, 1, 1], [0, 0, 1]]);
  assert.equal(ts.network.ties[2], 2);
  assert.equal(ts.meta.undatedExcluded, 1);
});

// Weekly activity: ~20 messages/week for 14 weeks, then ~60/week for one team.
function shiftDataset({ shift = true, seed = 1 } = {}) {
  const rng = createRng(seed);
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const ps = Array.from({ length: 12 }, (_, i) => b.node('t:' + i, { label: 'P' + i, attrs: { team: i < 6 ? 'X' : 'Y' } }));
  for (let w = 0; w < 20; w++) {
    for (let k = 0; k < 20; k++) {
      const a = rng.int(12), c = (a + 1 + rng.int(11)) % 12;
      b.event({ actor: ps[a], t: MON + w * 7 * DAY + Math.floor(rng() * 7 * DAY), targets: [[ps[c], 'dm']] });
    }
    if (shift && w >= 14) for (let k = 0; k < 40; k++) {
      const a = rng.int(6), c = (a + 1 + rng.int(5)) % 6;
      b.event({ actor: ps[a], t: MON + w * 7 * DAY + Math.floor(rng() * 7 * DAY), targets: [[ps[c], 'dm']] });
    }
  }
  return b.build();
}

test('detectShifts finds a planted rise in one team and nothing in a flat series', () => {
  const ds = shiftDataset();
  const ts = timeSeries(ds, defaultSettings(ds), { window: 'week', attr: 'team', metrics: ['degree'] });
  const r = detectShifts(ts, { labels: ds.nodes.labels });
  const grp = r.shifts.filter(s => s.target === 'group');
  assert.ok(grp.some(s => s.id === 'X' && s.window === 14 && s.direction === 'up'), JSON.stringify(grp));
  assert.ok(!grp.some(s => s.id === 'Y'), 'team Y did not change');
  assert.ok(r.shifts.some(s => s.target === 'network' && s.metric === 'activity' && s.window === 14));
  const c = detectShifts(ts, { method: 'cusum' });
  assert.ok(c.shifts.some(s => s.target === 'group' && s.id === 'X' && s.direction === 'up' && s.window >= 13 && s.window <= 15));

  const flat = shiftDataset({ shift: false, seed: 4 });
  const tf = timeSeries(flat, defaultSettings(flat), { window: 'week', attr: 'team', metrics: ['degree'] });
  const rf = detectShifts(tf, {});
  assert.equal(rf.shifts.length, 0, JSON.stringify(rf.shifts.slice(0, 3)));
  assert.ok(rf.meta.seriesScanned > 10);
});

test('robust and CUSUM primitives', () => {
  const x = [10, 11, 9, 10, 10, 11, 9, 10, 30, 31, 10];
  const r = robustShifts(x, { threshold: 3.5 });
  assert.equal(r.length, 1);
  assert.equal(r[0].window, 8);
  assert.equal(r[0].length, 2);
  assert.equal(r[0].direction, 'up');
  assert.equal(robustShifts([5, 5, 5, 5, 5, 5], {}).length, 0, 'flat series, no shift');
  const c = cusumShifts([0, 1, 0, 1, 0, 1, 0, 1, 3, 3, 3, 3], { baseline: 8, h: 5 });
  assert.equal(c[0].direction, 'up');
  assert.equal(c[0].window, 8);
});

test('compareBeforeAfter: planted increase is detected with an effect size', () => {
  const ds = shiftDataset();
  const date = MON + 14 * 7 * DAY;
  const r = compareBeforeAfter(ds, defaultSettings(ds), date, { span: 6 * 7 * DAY, metrics: ['strength', 'degree'], attr: 'team', reps: 500 });
  assert.equal(r.before.end, date);
  assert.ok(r.node.strength.meanDiff > 0);
  assert.ok(r.node.strength.dz > 0.8, `dz ${r.node.strength.dz}`);
  assert.ok(r.node.strength.p < 0.05);
  const X = r.groups.find(g => g.value === 'X'), Y = r.groups.find(g => g.value === 'Y');
  assert.ok(X.ratio > 2 && Y.ratio < 1.6);
  assert.ok(r.node.strength.topIncreases[0].label.startsWith('P'));
  assert.throws(() => compareBeforeAfter(ds, defaultSettings(ds), MON - DAY), /inside the data/);
});

test('window choice: auto picks by span, and a unit over the limit is coarsened, not refused', () => {
  assert.equal(chooseWindow(MON, MON + 30 * DAY).window, 'day');
  assert.equal(chooseWindow(MON, MON + 200 * DAY).window, 'week');
  assert.equal(chooseWindow(MON, MON + 8 * 365 * DAY).window, 'month');
  const c = chooseWindow(Date.UTC(2008, 5, 30), Date.UTC(2025, 11, 31), { window: 'week' });
  assert.equal(c.window, 'month');
  assert.match(c.reason, /exceed the limit of 520; using months/);
  assert.equal(chooseWindow(MON, MON + 200 * DAY, { window: 'week' }).reason, null);
  // 17 years of weekly windows used to throw "914 windows requested".
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const [x, y] = ['x', 'y'].map(k => b.node('t:' + k));
  b.event({ actor: x, t: Date.UTC(2008, 5, 30), targets: [[y, 'dm']] });
  b.event({ actor: y, t: Date.UTC(2025, 11, 31), targets: [[x, 'dm']] });
  const ds = b.build();
  const ts = timeSeries(ds, defaultSettings(ds), { window: 'week' });
  assert.equal(ts.meta.window, 'month');
  assert.equal(ts.meta.windowRequested, 'week');
  assert.ok(ts.windows.length <= 520 && ts.meta.windowReason);
});

test('suggested time range: the dense period, not a few very old dates', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const [x, y] = ['x', 'y'].map(k => b.node('t:' + k));
  for (let k = 0; k < 4; k++) b.event({ actor: x, t: Date.UTC(2009 + 3 * k, 2, 1), targets: [[y, 'declared']] });
  for (let k = 0; k < 200; k++) b.event({ actor: k % 2 ? x : y, t: MON + k * 12 * 3600000, targets: [[k % 2 ? y : x, 'dm']] });
  const ds = b.build();
  const r = suggestTimeRange(ds);
  assert.ok(r, 'a range is suggested');
  assert.equal(r.start, MON);
  assert.ok(r.end <= MON + 101 * DAY && r.end > MON + 90 * DAY);
  assert.equal(r.outsideBefore, 4);
  // Evenly spread data: use everything.
  const even = shiftDataset({ shift: false });
  assert.equal(suggestTimeRange(even), null);
});

// Two sources: a steady one for 20 weeks, and a larger export that starts in
// week 10 and ends in week 16. Activity jumps at both edges without anyone
// changing behaviour.
function twoSourceDataset() {
  const rng = createRng(2);
  const b = new DatasetBuilder();
  b.beginSource({ format: 'slack', view: VIEWS.FULL });
  const ps = Array.from({ length: 12 }, (_, i) => b.node('t:' + i, { label: 'P' + i }));
  for (let w = 0; w < 20; w++) for (let k = 0; k < 20; k++) {
    const a = rng.int(12), c = (a + 1 + rng.int(11)) % 12;
    b.event({ actor: ps[a], t: MON + w * 7 * DAY + Math.floor(rng() * 7 * DAY), targets: [[ps[c], 'dm']] });
  }
  b.beginSource({ format: 'email', view: VIEWS.EGO, egoKey: 'e:me' });
  const me = b.node('e:me', { label: 'Me' });
  const mail = Array.from({ length: 6 }, (_, i) => b.node('e:' + i, { label: 'M' + i }));
  for (let w = 10; w < 16; w++) for (let k = 0; k < 60; k++) {
    const o = mail[rng.int(6)];
    b.event({ actor: k % 2 ? me : o, t: MON + w * 7 * DAY + Math.floor(rng() * 7 * DAY), targets: [[k % 2 ? o : me, 'to']] });
  }
  return b.build();
}

test('shifts at a source\'s start or end are suppressed, and the edges are reported', () => {
  const ds = twoSourceDataset();
  const cov = sourceCoverage(ds);
  assert.equal(cov.length, 2);
  assert.ok(cov[1].material && cov[1].start >= MON + 70 * DAY);
  const ts = timeSeries(ds, defaultSettings(ds), { window: 'week', metrics: ['degree'] });
  assert.equal(ts.sources.length, 2);
  assert.deepEqual(ts.nodeSources[ds.nodes.keys.indexOf('e:me')], [1]);
  const r = detectShifts(ts, { labels: ds.nodes.labels });
  const near = (s, k) => s.window >= k - 1 && s.window <= k + 1;
  assert.ok(!r.shifts.some(s => s.target === 'network' && (near(s, 10) || near(s, 15) || near(s, 16))), JSON.stringify(r.shifts.slice(0, 4)));
  assert.ok(!r.shifts.some(s => s.target === 'node' && s.label === 'Me'), 'the mailbox owner does not "change" when the mailbox starts');
  assert.deepEqual(r.meta.sourceEdges.map(e => [e.kind, e.window]), [['starts', 10], ['ends', 15]]);
  assert.ok(r.meta.sourceEdgeWindowsSkipped >= 6);
  // Without the coverage information the export's start reads as a rise.
  const blind = detectShifts({ ...ts, sources: [], nodeSources: {} });
  assert.ok(blind.shifts.some(s => s.target === 'network' && s.metric === 'activity' && s.direction === 'up' && near(s, 10)));
});

test('before/after: a source ending inside a period is a caution, and its people are marked', () => {
  const ds = twoSourceDataset();
  const date = MON + 14 * 7 * DAY;
  const r = compareBeforeAfter(ds, defaultSettings(ds), date, { span: 4 * 7 * DAY, metrics: ['strength'], reps: 200 });
  assert.equal(r.cautions.length, 1);
  assert.equal(r.cautions[0].kind, 'ends');
  assert.equal(r.cautions[0].period, 'after');
  const dec = r.node.strength.topDecreases;
  assert.ok(dec.some(p => p.label === 'Me' && p.sourceEdge), JSON.stringify(dec));
  assert.ok(dec.filter(p => /^P/.test(p.label)).every(p => !p.sourceEdge), 'people of the steady source are not marked');
  // Periods well inside both sources: no caution.
  const q = compareBeforeAfter(ds, defaultSettings(ds), MON + 13 * 7 * DAY, { span: 2 * 7 * DAY, metrics: ['degree'], reps: 50 });
  assert.equal(q.cautions.length, 0);
});

// ---- Networks 101 round (J3, J2, J16) ----

test('shift persistence is judged against the pre-shift baseline, not the rolling one (J3)', async () => {
  const { robustShifts, persistence } = await import('../../src/analysis/time.js');
  // A permanent drop from ~0.18 to ~0.05 at window 6: the rolling baseline
  // catches up after a few windows, so the flagged run is short, but the
  // level never comes back.
  const x = [0.18, 0.17, 0.19, 0.18, 0.17, 0.18, 0.05, 0.06, 0.05, 0.04, 0.05, 0.06, 0.05];
  const [s] = robustShifts(x, { threshold: 3.5, baseline: 8, minBaseline: 4 });
  assert.equal(s.window, 6);
  assert.ok(s.length < 7, 'the flagged run stops before the end');
  assert.equal(s.held, 7);
  assert.equal(s.span, 7);
  assert.equal(s.heldToEnd, true);
  assert.equal(s.lastHeld, 12);
  // A one-window blip: flagged once, back at the baseline after.
  const blip = persistence([1, 1, 1, 1, 1, 9, 1, 1, 1], 5, 5, 1, 'up');
  assert.deepEqual({ held: blip.held, span: blip.span, heldToEnd: blip.heldToEnd, lastHeld: blip.lastHeld }, { held: 1, span: 4, heldToEnd: false, lastHeld: 5 });
});

test('before/after with an attribute reports E-I and cross-group share either side, with a test (J2), and says where the date falls (J16)', async () => {
  const { compareBeforeAfter } = await import('../../src/analysis/time.js');
  const { DatasetBuilder } = await import('../../src/core/model.js');
  const b = new DatasetBuilder({ source: { format: 't', view: 'full' } });
  const p = Array.from({ length: 12 }, (_, i) => b.node('t:' + i, { attrs: { dept: i < 6 ? 'A' : 'B' } }));
  const t0 = Date.UTC(2026, 0, 5), DAY = 86400000;
  let x = 7;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  // Before day 30 a third of messages cross departments; after, none do.
  for (let d = 0; d < 60; d++) for (let k = 0; k < 12; k++) {
    const a = Math.floor(rnd() * 12);
    const cross = d < 30 && rnd() < 0.33;
    const pool = Array.from({ length: 12 }, (_, i) => i).filter(i => i !== a && ((i < 6) === (a < 6)) !== cross);
    b.event({ actor: p[a], t: t0 + d * DAY + Math.floor(rnd() * DAY), targets: [[p[pool[Math.floor(rnd() * pool.length)]], 'dm']] });
  }
  const ds = b.build();
  const r = compareBeforeAfter(ds, { directed: true }, t0 + 30 * DAY, { metrics: ['degree'], attr: 'dept', reps: 300, seed: 1 });
  assert.equal(r.mixing.attr, 'dept');
  assert.equal(r.mixing.after.across, 0);
  assert.equal(r.mixing.after.eiIndex, -1);
  assert.ok(r.mixing.before.crossShare > 0.2);
  assert.ok(r.mixing.diff < -0.4);
  assert.ok(r.mixing.p <= 0.01, `p ${r.mixing.p}`);
  assert.equal(r.mixing.snapshot, true);
  assert.match(r.meta.boundary, /on the date itself count as after/);
  assert.match(r.meta.test, /randomization/);
  // With no metrics asked for, the mixing still comes back (the Groups banner uses this).
  const g = compareBeforeAfter(ds, { directed: true }, t0 + 30 * DAY, { metrics: [], attr: 'dept', reps: 100, seed: 1 });
  assert.deepEqual(g.node, {});
  assert.equal(g.mixing.after.eiIndex, -1);
});

test('detectShifts says which window it was computed with', async () => {
  const { timeSeries, detectShifts } = await import('../../src/analysis/time.js');
  const { messageDataset } = await import('./helpers.js');
  const ds = messageDataset(20, 600, { seed: 4 });
  for (const w of ['day', 'week']) assert.equal(detectShifts(timeSeries(ds, { directed: true }, { window: w, metrics: ['degree'] })).meta.window, w);
});
