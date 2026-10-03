// Network and People, Networks 101 round (R2): measure names and notes,
// fixed decimals, ties at displayed precision, "who stands out", rank
// stability in plain words, departures, fragility, small-map label spots,
// the rebuild notice, and the choices People keeps across networks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { metricLabel, measureNote, measureFormat, betweennessPairs, displayTies, standouts, distinctMeasures } from '../../src/ui/lib/measures.js';
import { stabilityReading, stabilitySummary, resamplingCaveat } from '../../src/ui/lib/stability.js';
import { departures, hasTimes } from '../../src/ui/lib/departures.js';
import { topShare, structure, whatIf, concentrationWords } from '../../src/ui/lib/fragility.js';
import { hullEdgeSpots, namesFirst, overlaps } from '../../src/ui/lib/labels.js';
import { settingsChanges, rebuildSummary, communityCounts } from '../../src/ui/lib/rebuild.js';
import { requestPeopleSort, peopleSort, rememberPeopleSort, rememberColumn, applyColumnChoices } from '../../src/ui/lib/viewprefs.js';
import { nodeColoring } from '../../src/ui/lib/coloring.js';
import { networkFromEdges } from '../../src/analysis/construct.js';
import { computeNodeMetrics } from '../../src/analysis/metrics.js';
import { parseTies, toDataset } from '../../src/builders/paste.js';

const path6 = () => networkFromEdges(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
const star6 = () => networkFromEdges(6, [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]);

test('decision 4: no bare "Degree"; closeness and betweenness name their variant', () => {
  assert.equal(metricLabel('contacts', false), 'Contacts (degree)');
  assert.equal(metricLabel('contacts', true), 'Contacts');
  assert.equal(metricLabel('degree', true), 'Total ties (in + out)');
  assert.equal(metricLabel('closeness', false), 'Closeness (harmonic)');
  assert.equal(metricLabel('betweenness', true), 'Betweenness (normalized)');
  for (const d of [true, false]) for (const k of ['contacts', 'degree']) assert.notEqual(metricLabel(k, d), 'Degree');
  // Undirected: degree is the contacts column, listed once.
  assert.deepEqual(distinctMeasures(['contacts', 'degree', 'strength'], false), ['contacts', 'strength']);
  assert.deepEqual(distinctMeasures(['contacts', 'degree'], true), ['contacts', 'degree']);
});

test('A2: the notes give the formulas and the raw betweenness count for this network', () => {
  assert.equal(betweennessPairs(6, false), 10);
  assert.equal(betweennessPairs(6, true), 20);
  const m = computeNodeMetrics(star6(), { which: ['betweenness', 'closeness'] });
  // Star center: normalized 1, raw 10 = 1 x (n-1)(n-2)/2.
  assert.equal(m.betweenness[0], 1);
  assert.match(measureNote('betweenness', { n: 6, directed: false }), /times 10, the number of such pairs/);
  const c = measureNote('closeness', { n: 6 });
  assert.match(c, /1 \/ \(steps to reach them\)/);
  assert.match(c, /0\.333 textbook, 0\.457 harmonic/);
  // The example in the note is the app's own value for the end of a path.
  const mp = computeNodeMetrics(path6(), { which: ['closeness'] });
  assert.equal(measureFormat('closeness', mp.closeness)(mp.closeness[0]), '0.457');
});

test('M6: 0-1 measures always show three decimals, counts none', () => {
  const ms = computeNodeMetrics(star6(), { which: ['betweenness', 'closeness', 'degree'] });
  assert.equal(measureFormat('betweenness', ms.betweenness)(ms.betweenness[0]), '1.000');
  assert.equal(measureFormat('betweenness', ms.betweenness)(ms.betweenness[1]), '0.000');
  assert.equal(measureFormat('closeness', ms.closeness)(ms.closeness[1]), '0.600');
  assert.equal(measureFormat('degree', ms.degree)(ms.degree[0]), '5');
});

test('J6: ties at the precision shown are found, and "who stands out" names them together', () => {
  const vals = [0.067, 0.0412, 0.04118, 0.0410, 0.052, 0.0001];
  const fmt = measureFormat('betweenness', vals);
  const order = [0, 4, 1, 2, 3, 5];
  assert.deepEqual(displayTies(order, vals, fmt), [{ from: 2, to: 4, text: '0.041' }]);
  // Romeo 0.595 and Juliet 0.571 are not tied; four people with 3 contacts are.
  const node = { contacts: Float64Array.from([4, 3, 3, 3, 3, 2, 2, 2]), betweenness: Float64Array.from([0.595, 0.143, 0.571, 0.2, 0, 0, 0, 0]) };
  const [c, b] = standouts(node, ['contacts', 'betweenness']);
  assert.deepEqual(c.top, [0]);
  assert.equal(c.next.value, '3');
  assert.deepEqual(b.top, [0]);
  assert.equal(b.next.v, 2);
  const tie = standouts({ contacts: Float64Array.from([2, 2, 1]) }, ['contacts'])[0];
  assert.deepEqual(tie.top, [0, 1]);
  assert.equal(tie.tied, 2);
  assert.equal(standouts({ contacts: Float64Array.from([1, 1, 1]) }, ['contacts'])[0].allSame, true);
});

test('rank stability reads in plain words for the chosen top k (decision 5, L10)', () => {
  assert.equal(stabilityReading({ rank: 1, lo: 1, hi: 1 }, 5).text, 'Settled: stays at rank 1 in the resamples');
  assert.equal(stabilityReading({ rank: 2, lo: 2, hi: 4 }, 5).level, 'top');
  assert.equal(stabilityReading({ rank: 5, lo: 5, hi: 8 }, 5).level, 'edge');
  assert.equal(stabilityReading({ rank: 7, lo: 6, hi: 8 }, 5).level, 'outside');
  // Jordan's distributed org: ranks 5-8 tie at 0.041, so only 4 of the top 5 hold up.
  const rows = [
    { node: 10, rank: 1, lo: 1, hi: 1, value: 0.067 }, { node: 11, rank: 2, lo: 2, hi: 2, value: 0.052 },
    { node: 12, rank: 3, lo: 3, hi: 3, value: 0.048 }, { node: 13, rank: 4, lo: 4, hi: 4, value: 0.047 },
    { node: 14, rank: 5, lo: 5, hi: 7, value: 0.0412 }, { node: 15, rank: 6, lo: 5, hi: 8, value: 0.0411 },
    { node: 16, rank: 7, lo: 6, hi: 8, value: 0.0410 }, { node: 17, rank: 8, lo: 5, hi: 8, value: 0.0410 },
    { node: 18, rank: 9, lo: 9, hi: 9, value: 0.03 },
  ];
  const fmt = measureFormat('betweenness', rows.map(r => r.value));
  const s = stabilitySummary(rows, 5, fmt);
  assert.equal(s.findings, 4);
  assert.deepEqual(s.groups.map(g => [g.from, g.to, g.text]), [[5, 8, '0.041']]);
  assert.match(s.verdict, /4 of the top 5 hold up/);
  const s3 = stabilitySummary(rows, 3, fmt);
  assert.equal(s3.findings, 3);
  assert.match(s3.verdict, /The top 3 hold/);
  // N14: the caveat always says resampling cannot test whether ties exist.
  assert.match(resamplingCaveat('betweenness', true), /cannot test whether a tie exists/);
  assert.match(resamplingCaveat('betweenness', true), /ignores tie weights/);
  assert.doesNotMatch(resamplingCaveat('strength', true), /ignores tie weights/);
});

test('J7: people who went silent well before the end, or were deactivated, are found', () => {
  const day = 86400000;
  const t0 = Date.UTC(2025, 0, 6);
  // A and B talk for 90 days; C talks to A for the first 40 days only.
  const ds = toDataset(parseTies('A - B\nA - C'));
  const n = ds.nodes.count;
  const idx = Object.fromEntries(ds.nodes.labels.map((l, i) => [l, i]));
  const actor = [], t = [];
  for (let d = 0; d < 90; d += 2) { actor.push(idx.A); t.push(t0 + d * day); actor.push(idx.B); t.push(t0 + d * day + 1); }
  for (let d = 0; d < 40; d += 4) { actor.push(idx.C); t.push(t0 + d * day); }
  const fake = { nodes: { ...ds.nodes, attrs: Array.from({ length: n }, () => ({})) }, events: { count: actor.length, actor: Int32Array.from(actor), t: Float64Array.from(t) } };
  const dep = departures(fake);
  assert.equal(dep.size, 1);
  assert.equal(dep.get(idx.C).kind, 'silent');
  assert.ok(dep.get(idx.C).quietDays >= 49);
  fake.nodes.attrs[idx.B] = { deactivated: true };
  assert.equal(departures({ ...fake }).get(idx.B).kind, 'deactivated');
  // One person's exports (WhatsApp chats, a mailbox): a quiet contact has not
  // left, so no silence marks; a deactivation the export states is kept.
  for (const src of [{ view: 'chat', family: 'personal', format: 'whatsapp' }, { view: 'ego', format: 'email' }]) {
    const own = { ...fake, meta: { sources: [src, { ...src }] } };
    const d2 = departures(own);
    assert.equal(d2.has(idx.C), false, src.format);
    assert.equal(d2.get(idx.B).kind, 'deactivated');
  }
  assert.equal(departures({ ...fake, nodes: { ...fake.nodes, attrs: fake.nodes.attrs.map(() => ({})) }, meta: { sources: [{ view: 'full', format: 'slack' }] } }).get(idx.C).kind, 'silent');
  // A drawing has no times: nobody is "silent", and first/last seen is hidden.
  assert.equal(hasTimes(ds), false);
  assert.equal(departures(ds).size, 0);
});

test('J8: concentration of betweenness and the remove-these-people what-if', () => {
  // Two 5-cliques joined only through broker 10.
  const edges = [];
  for (const base of [0, 5]) for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) edges.push([base + a, base + b]);
  edges.push([0, 10], [10, 5]);
  const net = networkFromEdges(11, edges);
  const m = computeNodeMetrics(net, { which: ['betweenness'] });
  const top = topShare(m.betweenness, 1);
  assert.deepEqual(top.people, [10]);
  assert.ok(top.share > 0.3 && Math.abs(top.even - 1 / 11) < 1e-12);
  const src = edges.map(e => e[0]), dst = edges.map(e => e[1]);
  const group = v => (v < 5 ? 'L' : v < 10 ? 'R' : 'B');
  const r = whatIf(11, src, dst, [10], { groupOf: group });
  assert.equal(r.before.pieces, 1);
  assert.equal(r.after.pieces, 2);
  assert.equal(r.before.cross, 2);
  assert.equal(r.after.cross, 0);
  assert.equal(r.after.largestShare, 0.5);
  assert.ok(r.after.avgSteps < r.before.avgSteps); // only within-clique pairs remain reachable
  // A path: average steps of a 6-path is 35/15.
  const p = structure(6, [0, 1, 2, 3, 4], [1, 2, 3, 4, 5]);
  assert.ok(Math.abs(p.avgSteps - 70 / 30) < 1e-12);
});

test('L5: on small or drawn maps the group cue sits on the group edge, never on a person', () => {
  assert.equal(namesFirst(8, false), true);
  assert.equal(namesFirst(500, true), true);
  assert.equal(namesFirst(500, false), false);
  const members = [{ x: 100, y: 100, r: 6 }, { x: 140, y: 120, r: 6 }, { x: 120, y: 160, r: 6 }];
  const spots = hullEdgeSpots(members, 60, 17);
  const discs = members.map(m => ({ x: m.x - m.r, y: m.y - m.r, w: 2 * m.r, h: 2 * m.r }));
  for (const s of spots) assert.equal(overlaps(s, discs, 0), false);
  assert.ok(spots[0].y + spots[0].h <= 94); // above the topmost member
});

test('N16, N17: the rebuild notice says what happened to ties, dates and communities', () => {
  const a = { rules: { reply: { on: true }, reaction: { on: true } }, time: { start: NaN, end: null } };
  const b = { rules: { reply: { on: true }, reaction: { on: false } }, time: { start: null, end: undefined } };
  const same = settingsChanges(a, b, { before: { n: 150, edgeCount: 1814 }, after: { n: 150, edgeCount: 1814 } });
  assert.deepEqual(same, ['No longer counting reactions as evidence: the same ties, with less weight']);
  assert.deepEqual(settingsChanges(a, b, { before: { n: 150, edgeCount: 1814 }, after: { n: 150, edgeCount: 1700 } }), ['Removed ties from reactions']);
  assert.deepEqual(settingsChanges({ time: { start: 1 } }, { time: {} }), ['Time range: all dates']);
  assert.deepEqual(communityCounts({ sizes: [40, 30, 1], count: 3 }), { groups: 2, alone: 1 });
  const s = rebuildSummary(
    { n: 150, edgeCount: 1814, nodeIds: [0, 1], communities: { membership: [0, 1], sizes: [80, 70], count: 2 }, settings: a },
    { n: 150, edgeCount: 1814, nodeIds: [0, 1], communities: { membership: [0, 1], sizes: [80, 69, 1], count: 3 }, settings: b });
  assert.equal(s.lines[1], '2 communities, plus 1 person with no ties; nobody changed community');
});

test('M11, J15: People keeps the sort and added columns for the next network', () => {
  rememberPeopleSort({ key: 'm:betweenness', dir: 'desc' });
  assert.deepEqual(peopleSort(k => k === 'm:betweenness'), { key: 'm:betweenness', dir: 'desc' });
  assert.equal(peopleSort(() => false), null);
  requestPeopleSort('closeness');
  assert.deepEqual(peopleSort(() => true), { key: 'm:closeness', dir: 'desc' });
  rememberColumn('m:degree', true);
  rememberColumn('m:pagerank', false);
  const cols = applyColumnChoices(new Set(['m:contacts', 'm:pagerank']), new Set(['m:contacts', 'm:degree', 'm:pagerank']));
  assert.deepEqual([...cols].sort(), ['m:contacts', 'm:degree']);
});

test('L6, N21: People dots use the same group colors as the map, by network index', () => {
  const ds = toDataset(parseTies('A - B\nB - C\nC - D'));
  ds.nodes.attrs = ds.nodes.attrs.map((a, i) => ({ ...a, dept: i < 2 ? 'Sales' : 'Design' }));
  const net = { n: 4, nodeIds: Int32Array.from([3, 2, 1, 0]) };
  const c = nodeColoring({ ds, net, colorBy: 'attr:dept', attrs: [{ key: 'dept', label: 'Department' }] });
  assert.equal(c.kind, 'cat');
  assert.equal(c.key(0), String(ds.nodes.attrs[3].dept));
  assert.equal(c.of(3), c.gc.color(ds.nodes.attrs[0].dept));
  assert.equal(c.title, 'Department');
});

test('Groups banner: only a shift that lasted raises it, not a one-window blip', async () => {
  const { groupShift, persistentShift } = await import('../../src/ui/views/time.js');
  const blip = { target: 'network', metric: 'crossGroupShare', start: 1, held: 1, span: 20, heldToEnd: false };
  const last = { target: 'network', metric: 'crossGroupShare', start: 1, held: 1, span: 1, heldToEnd: true };
  const step = { target: 'network', metric: 'crossGroupShare', start: 2, held: 6, span: 7, heldToEnd: false };
  assert.equal(persistentShift(blip), false);
  assert.equal(persistentShift(last), false);
  assert.equal(persistentShift(step), true);
  assert.equal(groupShift([blip, last]), null);
  assert.equal(groupShift([blip, step]), step);
});

test('fragility wording is relative to an even spread; "run through" only above the stated threshold', () => {
  // Top 5 of 96 holding 20%: concentrated (3.8x), not "depends on a few people".
  const a = concentrationWords({ k: 5, share: 0.2, even: 5 / 96 });
  assert.equal(a.level, 'concentrated');
  assert.match(a.text, /3\.8 times the 5% an even spread gives/);
  assert.doesNotMatch(a.text, /run through/);
  assert.equal(concentrationWords({ k: 5, share: 0.6, even: 5 / 96 }).level, 'depends');
  assert.equal(concentrationWords({ k: 5, share: 0.07, even: 5 / 96 }).level, 'even');
});

test('N17: an isolate is not counted as a community', async () => {
  const { communityWords, communityCounts } = await import('../../src/ui/lib/rebuild.js');
  const c = { count: 7, nontrivial: 6, sizes: [20, 18, 15, 15, 14, 13, 1] };
  assert.equal(communityWords(c), '6 communities, plus 1 person with no ties');
  assert.equal(communityCounts(c).groups, 6);
  assert.equal(communityWords({ count: 2, sizes: [3, 3] }), '2 communities');
});
