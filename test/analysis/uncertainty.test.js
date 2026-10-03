import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nullModel, resampleRanks, createRewirer, ranks, NULL_REPS } from '../../src/analysis/uncertainty.js';
import { groupMetrics } from '../../src/analysis/groups.js';
import { createEngine } from '../../src/analysis/engine.js';
import { createRng } from '../../src/analysis/rng.js';
import { defaultSettings } from '../../src/analysis/construct.js';
import { erdosRenyi, planted, messageDataset } from './helpers.js';

function degreeSeq(n, src, dst) {
  const out = new Int32Array(n), inn = new Int32Array(n);
  for (let e = 0; e < src.length; e++) { out[src[e]]++; inn[dst[e]]++; }
  return { out, inn };
}

for (const directed of [false, true]) {
  test(`rewiring preserves every degree exactly (${directed ? 'directed' : 'undirected'}) and keeps the graph simple`, () => {
    const net = erdosRenyi(120, 0.06, { directed, seed: 3 });
    const n = net.n;
    const r = createRewirer(n, net.edges.src, net.edges.dst, directed);
    const accepted = r.shuffle(net.edges.count * 10, createRng(9));
    assert.ok(accepted > net.edges.count, 'most swaps accepted on a sparse graph');
    const before = degreeSeq(n, net.edges.src, net.edges.dst), after = degreeSeq(n, r.src, r.dst);
    if (directed) {
      assert.deepEqual(after.out, before.out);
      assert.deepEqual(after.inn, before.inn);
    } else {
      const tot = (d) => Int32Array.from(d.out, (x, i) => x + d.inn[i]);
      assert.deepEqual(tot(after), tot(before));
    }
    const seen = new Set();
    let changed = 0;
    for (let e = 0; e < r.m; e++) {
      const a = r.src[e], b = r.dst[e];
      assert.notEqual(a, b, 'no self-loops');
      const k = directed || a < b ? a * n + b : b * n + a;
      assert.ok(!seen.has(k), 'no duplicate ties');
      seen.add(k);
      if (a !== net.edges.src[e] || b !== net.edges.dst[e]) changed++;
    }
    assert.ok(changed > net.edges.count * 0.5, 'the wiring actually changed');
  });
}

test('null model: a random graph is typical of its own null (z near 0)', () => {
  const und = erdosRenyi(150, 0.05, { seed: 11 });
  const r = nullModel(und, { stats: ['transitivity', 'degreeAssortativity', 'avgClustering'], reps: 60, seed: 2 });
  for (const s of ['transitivity', 'degreeAssortativity', 'avgClustering']) {
    assert.ok(Math.abs(r[s].z) < 3, `${s} z = ${r[s].z}`);
    assert.ok(r[s].p > 0.01, `${s} p = ${r[s].p}`);
  }
  const dir = erdosRenyi(150, 0.04, { directed: true, seed: 12 });
  const rd = nullModel(dir, { stats: ['reciprocity'], reps: 60, seed: 2 });
  assert.ok(Math.abs(rd.reciprocity.z) < 3, `reciprocity z = ${rd.reciprocity.z}`);
  assert.equal(rd.meta.model, 'directed edge swaps preserving every in- and out-degree');
});

test('null model detects planted homophily, E-I and modularity', () => {
  const { net, ds } = planted(160, 0.12, 0.01, { seed: 5 });
  const membership = Int32Array.from({ length: 160 }, (_, i) => i % 2);
  const r = nullModel(net, { stats: ['attrAssortativity', 'eiIndex', 'modularity'], reps: 50, seed: 3, ds, attr: 'team', membership });
  assert.ok(r.attrAssortativity.observed > 0.6);
  assert.ok(r.attrAssortativity.z > 8, `assortativity z = ${r.attrAssortativity.z}`);
  assert.ok(r.eiIndex.z < -8, `E-I z = ${r.eiIndex.z}`);
  assert.ok(r.modularity.z > 8, `modularity z = ${r.modularity.z}`);
  assert.equal(r.attrAssortativity.p, 1 / 51, 'p cannot go below 1/(reps+1)');
});

test('null model reproduces exactly with the same seed, and per-node constraint z', () => {
  const { net, ds } = planted(60, 0.2, 0.03, { seed: 8 });
  const a = nullModel(net, { stats: ['transitivity'], reps: 20, seed: 4, nodeStats: ['constraint'] });
  const b = nullModel(net, { stats: ['transitivity'], reps: 20, seed: 4, nodeStats: ['constraint'] });
  assert.deepEqual(a.transitivity, b.transitivity);
  assert.equal(a.nodes.constraint.z.length, 60);
  assert.deepEqual(a.nodes.constraint.z, b.nodes.constraint.z);
  const c = nullModel(net, { stats: ['transitivity'], reps: 20, seed: 5 });
  assert.notEqual(c.transitivity.mean, a.transitivity.mean);
  // Stats that need an attribute are skipped without one; reciprocity is skipped when undirected.
  const d = nullModel(net, { stats: ['reciprocity', 'eiIndex', 'transitivity'], reps: 5 });
  assert.deepEqual(Object.keys(d).filter(k => k !== 'meta'), ['transitivity']);
  assert.ok(ds);
});

test('resampleRanks is deterministic for a seed and returns rank intervals', () => {
  const ds = messageDataset(30, 600, { seed: 2 });
  const s = defaultSettings(ds);
  const a = resampleRanks(ds, s, { metric: 'degree', reps: 25, top: 5, seed: 7 });
  const b = resampleRanks(ds, s, { metric: 'degree', reps: 25, top: 5, seed: 7 });
  assert.deepEqual(a, b);
  assert.ok(Array.isArray(a));
  assert.equal(a.length, 30);
  for (let i = 1; i < a.length; i++) assert.ok(a[i].rank >= a[i - 1].rank, 'ordered by observed rank');
  for (const r of a) {
    assert.ok(r.lo <= r.hi);
    assert.ok(r.topShare >= 0 && r.topShare <= 1);
    assert.equal(typeof r.node, 'number');
    assert.equal(r.label, ds.nodes.labels[r.node]);
  }
  // In a uniform random network the top rank is not stable.
  assert.ok(a[0].hi - a[0].lo >= 3, 'wide interval for a noisy leader');
  const c = resampleRanks(ds, s, { metric: 'degree', reps: 25, top: 5, seed: 8 });
  assert.notDeepEqual(a.map(r => r.lo), c.map(r => r.lo));
});

test('ranks: competition ranking, ties share the best rank, NaN last', () => {
  assert.deepEqual(Array.from(ranks([3, 5, 5, NaN, 1])), [3, 1, 1, 5, 4]);
});

test('nullModel: a statistic undefined in every replicate gets no p-value', async () => {
  const { DatasetBuilder } = await import('../../src/core/model.js');
  const A = await import('../../src/analysis/index.js');
  const b = new DatasetBuilder({ source: { format: 'test', view: 'full' } });
  const n = Array.from({ length: 12 }, (_, i) => b.node(`t:${i}`, { attrs: i === 0 ? { team: 'A' } : {} }));
  for (let i = 0; i < 12; i++) for (const j of [1, 2, 5]) b.event({ type: 'declared', actor: n[i], targets: [[n[(i + j) % 12], 'declared']] });
  const ds = b.build();
  const net = A.buildNetwork(ds, A.defaultSettings(ds));
  const r = A.nullModel(net, { stats: ['attrAssortativity'], reps: 20, seed: 1, ds, attr: 'team' });
  const s = r.attrAssortativity;
  assert.ok(s, 'statistic reported');
  assert.equal(s.p, null);
  assert.equal(s.replicates, 0);
});

test('null model: one replicate count (200) and one run per network, reused by every caller (N3)', async () => {
  const { net, ds } = planted(80, 0.15, 0.02, { seed: 21 });
  assert.equal(NULL_REPS, 200);
  const peek = (stats, o = {}) => nullModel(net, { stats, reps: 30, seed: 1, cachedOnly: true, ...o }).meta.cached;
  assert.deepEqual(peek(['transitivity', 'modularity']), []);
  const a = nullModel(net, { stats: ['transitivity', 'modularity'], reps: 30, seed: 1 });
  assert.equal(a.meta.reps, 30);
  assert.equal(a.meta.cached, undefined, 'a normal call looks the same whether or not it was cached');
  assert.deepEqual(peek(['transitivity', 'modularity', 'avgClustering']), ['transitivity', 'modularity']);
  // Another view asks for modularity alone, then with other statistics: the
  // same values, and the new statistic computed as if run together.
  const b = nullModel(net, { stats: ['modularity'], reps: 30, seed: 1 });
  assert.deepEqual(b.modularity, a.modularity);
  const c = nullModel(net, { stats: ['avgClustering', 'transitivity'], reps: 30, seed: 1 });
  assert.deepEqual(c.transitivity, a.transitivity);
  const joint = nullModel(planted(80, 0.15, 0.02, { seed: 21 }).net, { stats: ['avgClustering', 'transitivity', 'modularity'], reps: 30, seed: 1 });
  assert.deepEqual(c.avgClustering, joint.avgClustering);
  assert.deepEqual(joint.modularity, a.modularity);
  // cachedOnly never rewires; a different replicate count is a different run.
  const d = nullModel(net, { stats: ['modularity', 'degreeAssortativity'], reps: 30, seed: 1, cachedOnly: true });
  assert.deepEqual(Object.keys(d).filter(k => k !== 'meta'), ['modularity']);
  assert.deepEqual(peek(['modularity'], { reps: 31 }), []);
  // Attribute statistics are keyed by the attribute.
  assert.deepEqual(peek(['eiIndex'], { ds, attr: 'team' }), []);
  nullModel(net, { stats: ['eiIndex'], reps: 30, seed: 1, ds, attr: 'team' });
  assert.deepEqual(peek(['eiIndex'], { ds, attr: 'team' }), ['eiIndex']);
  // The default is the shared count.
  assert.equal(nullModel(net, { stats: ['transitivity'], cachedOnly: true }).meta.reps, 200);
});

test('null model through the engine: Network and Groups get the same modularity result', async () => {
  const ds = messageDataset(40, 800, { seed: 3 });
  const engine = createEngine({ worker: false });
  await engine.load(ds);
  await engine.build(defaultSettings(ds));
  const com = await engine.communities({ seed: 1 });
  // Network asks for its four statistics; Groups then asks for modularity.
  const net = await engine.nullModel({ stats: ['reciprocity', 'transitivity', 'avgClustering', 'modularity'], reps: 20, seed: 1, membership: com.membership });
  assert.deepEqual((await engine.nullModel({ stats: ['modularity'], reps: 20, seed: 1, cachedOnly: true })).meta.cached, ['modularity']);
  const grp = await engine.nullModel({ stats: ['modularity'], reps: 20, seed: 1, membership: com.membership });
  assert.deepEqual(grp.modularity, net.modularity);
  // A view can read what is there without starting a run.
  const peek = await engine.nullModel({ stats: ['transitivity', 'degreeAssortativity'], reps: 20, seed: 1, cachedOnly: true });
  assert.deepEqual(Object.keys(peek).filter(k => k !== 'meta'), ['transitivity']);
  // A rebuild is a new network: nothing carries over.
  await engine.build({ ...defaultSettings(ds), weighting: 'binary' });
  assert.deepEqual((await engine.nullModel({ stats: ['modularity'], reps: 20, seed: 1, cachedOnly: true })).meta.cached, []);
});

test('null model: per-group E-I with its random expectation, matching the group table (J11)', () => {
  const { net, ds } = planted(90, 0.15, 0.02, { groups: 3, seed: 6 });
  const r = nullModel(net, { stats: ['eiIndex'], reps: 25, seed: 2, ds, attr: 'team' });
  const gm = groupMetrics(net, ds, 'team');
  assert.equal(r.eiIndex.groups.length, gm.groups.length);
  r.eiIndex.groups.forEach((g, i) => {
    assert.equal(g.value, gm.groups[i].value);
    assert.ok(Math.abs(g.observed - gm.groups[i].eiIndex) < 1e-12);
    assert.ok(g.mean > g.observed, 'planted groups are more inward than the rewired expectation');
    assert.equal(g.replicates, 25);
  });
  assert.equal(r.meta.pFloor, 1 / 26);
});
