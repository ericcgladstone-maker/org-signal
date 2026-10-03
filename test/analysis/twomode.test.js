// Two-mode (affiliation) data: representation, construction views,
// projections, measures by hand, applicability, communities, rendering and
// the engine. Values against networkx are in test/accuracy/twomode.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder, declareTwoMode, addAffiliation, addModeNode, twoModeOf, modeValue, toJSON, fromJSON, toTransfer, MODE_ATTR } from '../../src/core/model.js';
import { mergeDatasets } from '../../src/core/merge.js';
import * as A from '../../src/analysis/index.js';
import { createEngine } from '../../src/analysis/engine.js';

// 4 people x 3 clubs:  a-x a-y b-x c-y c-z d-z  (plus one survey tie a-b).
function clubs({ noise = false, isolate = false } = {}) {
  const b = new DatasetBuilder({ name: 'clubs' });
  b.beginSource({ format: 'test', view: 'full', directed: false });
  declareTwoMode(b, ['Students', 'Clubs']);
  const T = Date.UTC(2026, 0, 5);
  [['a', 'x', 0], ['a', 'y', 1], ['b', 'x', 2], ['c', 'y', 3], ['c', 'z', 40], ['d', 'z', 41]]
    .forEach(([p, q, d]) => addAffiliation(b, 's:' + p, 'c:' + q, { actorLabel: p.toUpperCase(), eventLabel: 'Club ' + q, t: T + d * 86400000, weight: d === 3 ? 3 : 1 }));
  if (isolate) addModeNode(b, 's:e', 0, { label: 'E' });
  if (noise) b.event({ type: 'declared', actor: b.nodeIndex('s:a'), targets: [[b.nodeIndex('s:b'), 'declared']] });
  return b.build();
}
const id = (ds, k) => ds.nodes.keys.indexOf(k);

test('representation: helpers mark modes, declare the source, and survive JSON, transfer and merge', () => {
  const ds = clubs();
  const tm = twoModeOf(ds);
  assert.deepEqual(tm.labels, ['Students', 'Clubs']);
  assert.deepEqual(tm.counts, [4, 3]);
  assert.equal(tm.declared, true);
  assert.equal(ds.nodes.attrs[id(ds, 's:a')][MODE_ATTR], 0);
  assert.equal(ds.nodes.attrs[id(ds, 'c:x')][MODE_ATTR], 1);
  assert.equal(ds.meta.sources[0].directed, false);
  assert.equal(ds.events.count, 6);
  assert.deepEqual([ds.events.type[0], ds.events.role[0]], [2, 7]);   // declared, member
  const sc = ds.attributeSchema.find(s => s.key === MODE_ATTR);
  assert.equal(sc.type, 'categorical');
  assert.deepEqual(twoModeOf(fromJSON(toJSON(ds))).mode, tm.mode);
  assert.deepEqual(twoModeOf(structuredClone(toTransfer(ds).payload)).counts, [4, 3]);
  const merged = mergeDatasets([ds, clubs()]);
  assert.deepEqual(twoModeOf(merged).labels, ['Students', 'Clubs']);
  assert.equal(modeValue('1'), 1); assert.equal(modeValue(false), 0); assert.equal(modeValue('x'), -1);
});

test('representation: an undeclared networkx-style file is two-mode when every node has bipartite 0/1', () => {
  const b = new DatasetBuilder({ name: 'nx' });
  b.beginSource({ format: 'graphml', directed: false });
  const p = b.node('g:p', { attrs: { bipartite: 0 } }), e = b.node('g:e', { attrs: { bipartite: '1' } });
  b.event({ type: 'declared', actor: p, targets: [[e, 'declared']] });
  const tm = twoModeOf(b.build());
  assert.ok(tm);
  assert.equal(tm.declared, false);
  assert.deepEqual(tm.labels, ['Actors', 'Events']);
  // One node without a mode: not two-mode unless declared.
  b.node('g:q');
  assert.equal(twoModeOf(b.build()), null);
  // A one-mode dataset is never two-mode.
  const one = new DatasetBuilder({ name: 'one' }); one.beginSource({}); one.node('x:a'); one.node('x:b');
  assert.equal(twoModeOf(one.build()), null);
});

test('construction: defaults to the undirected two-mode view; same-mode ties and unknown-mode nodes stay out', () => {
  const ds = clubs({ noise: true });
  const s = A.defaultSettings(ds);
  assert.deepEqual(s.twoMode, { view: 'two-mode', projection: 'count', minShared: 1 });
  assert.equal(s.directed, false);
  const net = A.buildNetwork(ds, { ...s, directed: true });   // two-mode overrides direction
  assert.equal(net.directed, false);
  assert.equal(net.edges.count, 6);
  assert.equal(net.twoMode.sameModeEvidence, 1);
  assert.deepEqual(net.twoMode.counts, [4, 3]);
  assert.equal(net.summary.twoMode.affiliations, 6);
  // Affiliation weight is the tie weight (c-y weighs 3).
  const c = net.index[id(ds, 's:c')], y = net.index[id(ds, 'c:y')];
  const e = [...net.edges.src.keys()].find(k => (net.edges.src[k] === Math.min(c, y) && net.edges.dst[k] === Math.max(c, y)));
  assert.equal(net.edges.w[e], 3);
  // twoMode: null builds the ordinary network of everything (the survey tie included).
  const flat = A.buildNetwork(ds, { ...s, twoMode: null });
  assert.equal(flat.edges.count, 7);
  assert.equal(flat.twoMode, undefined);
  // One-mode data has no twoMode settings and is unchanged.
  const one = new DatasetBuilder({ name: 'one' }); one.beginSource({}); const a = one.node('x:a'), bb = one.node('x:b');
  one.event({ type: 'declared', actor: a, targets: [[bb, 'declared']] });
  assert.equal(A.defaultSettings(one.build()).twoMode, null);
});

test('projections: count, Newman and binary weights, minimum shared count, isolates, evidence via the shared club', () => {
  const b = new DatasetBuilder({ name: 'p' });
  b.beginSource({ format: 'test', directed: false });
  // Club x: a b c; club y: a b; club z: c d.
  for (const [p, q] of [['a', 'x'], ['b', 'x'], ['c', 'x'], ['a', 'y'], ['b', 'y'], ['c', 'z'], ['d', 'z']]) addAffiliation(b, 'p:' + p, 'c:' + q);
  addModeNode(b, 'p:e', 0);
  const ds = b.build();
  const pairs = (net) => Object.fromEntries(Array.from({ length: net.edges.count }, (_, e) => [ds.nodes.labels[net.nodeIds[net.edges.src[e]]] + ds.nodes.labels[net.nodeIds[net.edges.dst[e]]], +net.edges.raw[e].toFixed(6)]));
  const count = A.buildNetwork(ds, { twoMode: { view: 'mode0' } });
  assert.equal(count.n, 5);   // a b c d and the isolate e; no clubs
  assert.deepEqual(pairs(count), { ab: 2, ac: 1, bc: 1, cd: 1 });
  assert.deepEqual(Array.from(count.edges.shared), [2, 1, 1, 1]);
  assert.deepEqual(pairs(A.buildNetwork(ds, { twoMode: { view: 'mode0', projection: 'newman' } })), { ab: 1.5, ac: 0.5, bc: 0.5, cd: 1 });
  assert.deepEqual(pairs(A.buildNetwork(ds, { twoMode: { view: 'mode0', projection: 'binary' } })), { ab: 1, ac: 1, bc: 1, cd: 1 });
  const thick = A.buildNetwork(ds, { twoMode: { view: 'mode0', minShared: 2 } });
  assert.deepEqual(pairs(thick), { ab: 2 });
  assert.equal(thick.twoMode.belowMinShared, 3);
  assert.deepEqual(pairs(A.buildNetwork(ds, { twoMode: { view: 'mode1' } })), { xy: 2, xz: 1 });
  assert.equal(A.buildNetwork(ds, { twoMode: { view: 'mode0' }, includeIsolates: false }).n, 4);
  // Log weighting applies on top of the projection weight.
  const lg = A.buildNetwork(ds, { twoMode: { view: 'mode0' }, weighting: 'log' });
  assert.ok(Math.abs(lg.edges.w[0] - Math.log1p(2)) < 1e-12);
  const ev = A.edgeEvidence(ds, count, id(ds, 'p:a'), id(ds, 'p:b'));
  assert.equal(ev.length, 4);   // a-x, b-x, a-y, b-y
  assert.deepEqual([...new Set(ev.map(e => e.viaLabel))].sort(), ['x', 'y']);
});

test('measures by hand on a 2 x 2 path: degree / other mode, Borgatti-Everett betweenness and closeness, Latapy clustering', () => {
  // a - x - b - y : actors a, b; events x, y.
  const b = new DatasetBuilder({ name: 'path' });
  b.beginSource({ format: 'test', directed: false });
  addAffiliation(b, 'p:a', 'e:x'); addAffiliation(b, 'p:b', 'e:x'); addAffiliation(b, 'p:b', 'e:y');
  const ds = b.build();
  const net = A.buildNetwork(ds, A.defaultSettings(ds));
  const m = A.computeNodeMetrics(net);
  const v = (k) => net.index[id(ds, k)];
  assert.equal(m.twoModeDegree[v('p:b')], 1);
  assert.equal(m.twoModeDegree[v('e:y')], 0.5);
  // Path a-x-b-y: raw betweenness x = 2 (a-b, a-y), b = 2 (x-y, a-y). Max for a mode of 2 against 2 = 2.
  assert.equal(A.twoModeBetweennessMax(2, 2), 2);
  assert.equal(m.twoModeBetweenness[v('e:x')], 1);
  assert.equal(m.twoModeBetweenness[v('p:b')], 1);
  assert.equal(m.twoModeBetweenness[v('p:a')], 0);
  // Closeness of a: distances 1 (x), 2 (b), 3 (y) = 6; minimum (2 + 2*1) = 4 -> 4/6.
  assert.ok(Math.abs(m.twoModeCloseness[v('p:a')] - 4 / 6) < 1e-12);
  // Latapy (dot): a's only second neighbour is b: |{x}| / |{x, y}| = 1/2.
  assert.equal(m.twoModeClustering[v('p:a')], 0.5);
  const nm = A.computeNetworkMetrics(net);
  assert.equal(nm.twoModeDensity, 3 / 4);
  assert.equal(nm.robinsAlexander, 0);   // no four-cycles
  assert.deepEqual(nm.modeCounts, [2, 2]);
  // One-mode networks never get two-mode measures.
  const p = A.buildNetwork(ds, { twoMode: { view: 'mode0' } });
  assert.equal(A.computeNodeMetrics(p).twoModeDegree, undefined);
  assert.equal(A.computeNetworkMetrics(p).twoModeDensity, undefined);
});

test('applicability: one-mode-only measures are not applicable on the two-mode view, two-mode measures only there', () => {
  const ds = clubs();
  const net = A.buildNetwork(ds, A.defaultSettings(ds));
  const ap = A.applicability(ds, net);
  for (const k of ['clustering', 'transitivity', 'avgClustering', 'constraint', 'effectiveSize', 'density', 'reciprocity', 'nullModel', 'degreeCentralization']) assert.equal(ap[k].level, 'na', k);
  assert.match(ap.clustering.reason, /students and clubs/);
  for (const k of A.TWO_MODE_METRICS) assert.notEqual(ap[k].level, 'na', k);
  assert.equal(ap.betweenness.level, 'caution');
  const proj = A.buildNetwork(ds, { twoMode: { view: 'mode0' } });
  const ap2 = A.applicability(ds, proj);
  for (const k of A.TWO_MODE_METRICS) assert.equal(ap2[k].level, 'na');
  assert.match(ap2.clustering.reason, /clique/);
});

test('communities: found on the actors projection, events join their members, Barber modularity reported; null model skips', () => {
  const b = new DatasetBuilder({ name: 'two groups' });
  b.beginSource({ format: 'test', directed: false });
  for (const p of ['a', 'b', 'c']) for (const q of ['x', 'y']) addAffiliation(b, 'p:' + p, 'e:' + q);
  for (const p of ['d', 'e', 'f']) for (const q of ['z', 'w']) addAffiliation(b, 'p:' + p, 'e:' + q);
  addAffiliation(b, 'p:c', 'e:z');
  const ds = b.build();
  const net = A.buildNetwork(ds, A.defaultSettings(ds));
  const c = A.detectCommunities(net, { seed: 1 });
  const mem = (k) => c.membership[net.index[id(ds, k)]];
  assert.equal(c.count, 2);
  assert.equal(mem('p:a'), mem('e:x'));
  assert.equal(mem('p:d'), mem('e:w'));
  assert.notEqual(mem('p:a'), mem('p:d'));
  assert.ok(c.barberModularity > 0.3 && c.barberModularity < 0.5, String(c.barberModularity));
  assert.equal(A.barberModularity(net, new Int32Array(net.n)), 0);   // one community: Q_B = 1 - 1 = 0
  const nm = A.nullModel(net, { reps: 3 });
  assert.equal(nm.transitivity, undefined);
});

test('rendering: modes on render nodes; columns and rows put each mode on its own side', () => {
  const ds = clubs();
  const net = A.buildNetwork(ds, A.defaultSettings(ds));
  const cols = A.graphForRender(net, { arrange: 'columns' });
  assert.deepEqual(cols.modeLabels, ['Students', 'Clubs']);
  for (let i = 0; i < cols.nodes.count; i++) assert.equal(Math.sign(cols.nodes.x[i]), cols.nodes.mode[i] === 0 ? -1 : 1);
  const rows = A.graphForRender(net, { arrange: 'rows' });
  for (let i = 0; i < rows.nodes.count; i++) assert.equal(Math.sign(rows.nodes.y[i]), rows.nodes.mode[i] === 0 ? 1 : -1);
  const force = A.graphForRender(net, { iterations: 10 });
  assert.ok(force.nodes.mode && force.nodes.x);
  const one = A.graphForRender(A.buildNetwork(ds, { twoMode: { view: 'mode0' } }), { arrange: 'columns', iterations: 5 });
  assert.equal(one.twoModeView, 'mode0');
});

test('engine: build reports twoMode; measures, time windows and resampling run on two-mode data', async () => {
  const ds = clubs();
  const engine = createEngine({ worker: false });
  await engine.load(ds);
  const info = await engine.build({ twoMode: { view: 'two-mode' } });
  assert.equal(info.twoMode.view, 'two-mode');
  assert.deepEqual(Array.from(info.twoMode.mode).filter(x => x === 1).length, 3);
  const m = await engine.nodeMetrics({ which: [...A.NODE_METRICS, ...A.TWO_MODE_METRICS] });
  assert.equal(m.twoModeDegree.length, 7);
  const r = await engine.graphForRender({ arrange: 'columns' });
  assert.ok(r.nodes.mode);
  const info2 = await engine.build({ twoMode: { view: 'mode1', projection: 'newman' } });
  assert.equal(info2.n, 3);
  const series = await engine.timeSeries({ window: 'week' });
  assert.ok(series.windows.length >= 2);
  const rr = await engine.resampleRanks({ metric: 'degree', reps: 5 });
  assert.ok(rr.length > 0);
  engine.terminate();
});
