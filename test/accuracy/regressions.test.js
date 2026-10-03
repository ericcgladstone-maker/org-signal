// One regression case per discrepancy the accuracy campaign found in the
// analysis engine (docs/accuracy.md lists them with their numbers).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkFromEdges } from '../../src/analysis/construct.js';
import { computeNodeMetrics } from '../../src/analysis/metrics.js';
import { computeNetworkMetrics } from '../../src/analysis/network.js';
import { groupMetrics } from '../../src/analysis/groups.js';
import { timeSeries, compareBeforeAfter } from '../../src/analysis/time.js';
import { DatasetBuilder } from '../../src/core/model.js';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const K4 = (o, w) => [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].map(([a, b]) => [a + o, b + o, w]);

test('eigenvector: two components with nearly equal leading eigenvalues (power iteration stalled at 1e-2 error)', () => {
  // K4 with weights 1.001 next to K4 with weights 1: the limit puts everything
  // on the heavier one, 1/2 per node. (A + I) ratio 4/4.003: 5,000 power
  // iterations left 2% of the mass on the lighter component.
  const net = networkFromEdges(8, [...K4(0, 1.001), ...K4(4, 1)]);
  const m = computeNodeMetrics(net, { which: ['eigenvector'] });
  assert.ok(m.meta.eigenvector.converged);
  for (let i = 0; i < 4; i++) near(m.eigenvector[i], 0.5, 1e-9, `heavy ${i}`);
  for (let i = 4; i < 8; i++) near(m.eigenvector[i], 0, 1e-9, `light ${i}`);
});

test('eigenvector does not depend on the weight scale (with small weights A + I converges slowly)', () => {
  // Star with leaf weights w_i: centre 1/sqrt 2, leaf w_i / (sqrt 2 * |w|).
  const w = Array.from({ length: 10 }, (_, i) => 1e-3 * (i + 1));
  const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
  const m = computeNodeMetrics(networkFromEdges(11, w.map((x, i) => [0, i + 1, x])), { which: ['eigenvector'] });
  assert.ok(m.meta.eigenvector.converged);
  near(m.eigenvector[0], Math.SQRT1_2, 1e-9, 'centre');
  w.forEach((x, i) => near(m.eigenvector[i + 1], x / (Math.SQRT2 * norm), 1e-9, `leaf ${i}`));
});

test('eigenvector: an isolate scores exactly 0 (was ~1e-13)', () => {
  const m = computeNodeMetrics(networkFromEdges(3, [[0, 1, 2]]), { which: ['eigenvector'] });
  assert.equal(m.eigenvector[2], 0);
  near(m.eigenvector[0], Math.SQRT1_2, 1e-12, 'tied pair');
});

test('constraint and effective size are defined for a directed node with only incoming ties (networkx 3.2 returns NaN)', () => {
  // 1 -> 0, 2 -> 0: node 0 has two contacts that are not tied to each other.
  const m = computeNodeMetrics(networkFromEdges(3, [[1, 0], [2, 0]], { directed: true }), { which: ['constraint', 'effectiveSize'] });
  near(m.constraint[0], 0.5, 1e-15, 'constraint');
  near(m.effectiveSize[0], 2, 1e-15, 'effective size');
});

test('correlations with a constant end are undefined, not rounding noise (networkx gives ~1e-8)', () => {
  // Directed tree: every target has in-degree 1.
  const net = networkFromEdges(5, [[0, 1], [0, 2], [1, 3], [1, 4]], { directed: true });
  assert.ok(Number.isNaN(computeNetworkMetrics(net).degreeAssortativity));
  const ds = { nodes: { attrs: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }] }, attributeSchema: [{ key: 'v', type: 'numeric' }] };
  const star = networkFromEdges(5, [[0, 1], [0, 2], [0, 3], [0, 4]], { directed: true });
  assert.ok(Number.isNaN(groupMetrics(star, ds, 'v').numericAssortativity));
});

function stationary(seed) {
  // Two people pairs messaging at a constant rate: nothing changes at the date.
  const b = new DatasetBuilder({ source: { format: 't', view: 'full' } });
  const p = Array.from({ length: 6 }, (_, i) => b.node('t:' + i));
  const t0 = Date.UTC(2026, 0, 5), DAY = 86400000;
  let x = seed;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  for (let d = 0; d < 60; d++) for (const [a, c] of [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]) if (rnd() < 0.5) b.event({ actor: p[a], t: t0 + d * DAY + Math.floor(rnd() * DAY), targets: [[p[c], 'dm']] });
  return { ds: b.build(), date: t0 + 30 * DAY };
}

test('before/after: p comes from relabelling events, and every metric says how it was tested', () => {
  const { ds, date } = stationary(3);
  const r = compareBeforeAfter(ds, { directed: true }, date, { metrics: ['degree', 'strength', 'betweenness'], reps: 300, metricReps: 40, seed: 2 });
  assert.match(r.meta.test, /relabel/);
  assert.equal(r.node.degree.test, 'event relabelling');
  assert.equal(r.node.degree.reps, 300);
  assert.equal(r.node.betweenness.test, 'event relabelling (networks rebuilt)');
  assert.equal(r.node.betweenness.reps, 40);
  for (const m of ['degree', 'strength', 'betweenness']) assert.ok(r.node[m].p > 0 && r.node[m].p <= 1);
  assert.deepEqual(r.meta.approximate, []);
});

test('time series says which windows were sampled (pivots, path-length sources)', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: 'full' } });
  // A ring of 800 people, one message every 10 minutes: one or two weekly
  // windows, each with more people than the 256 pivots approx: true uses.
  const p = Array.from({ length: 800 }, (_, i) => b.node('t:' + i));
  const t0 = Date.UTC(2026, 0, 5);
  for (let i = 0; i < 800; i++) b.event({ actor: p[i], t: t0 + i * 600000, targets: [[p[(i + 1) % 800], 'dm']] });
  const ds = b.build();
  const ts = timeSeries(ds, { directed: true }, { window: 'week', metrics: ['betweenness'], approx: true });
  const big = ts.windows.map((w, i) => i).filter(i => ts.windows[i].nodes > 256);
  assert.ok(big.length >= 1);
  assert.deepEqual(ts.meta.approximateWindows, big);
  // More than 200 people in a window: path lengths from 200 sources.
  assert.deepEqual(ts.meta.pathLengthSampledWindows, ts.windows.map((w, i) => i).filter(i => ts.windows[i].nodes > 200));
  const exact = timeSeries(ds, { directed: true }, { window: 'week', metrics: ['betweenness'], approx: false });
  assert.deepEqual(exact.meta.approximateWindows, []);
});

test('weighted betweenness: equal-length paths are detected with a relative tolerance, so heavy ties are not merged', () => {
  // 0 - 1 - 3 has length 2e-6; 0 - 2 - 3 is 1e-11 longer (5e-6 relative).
  // The tolerance used to be absolute (1e-10) below distance 1 and called
  // them equal, giving 1 and 2 a half share each.
  const w = 1e6, w2 = 1 / 1.00001e-6;
  const edges = [[0, 1, w], [1, 3, w], [0, 2, w], [2, 3, w2]];
  const m = computeNodeMetrics(networkFromEdges(4, edges), { which: ['betweennessWeighted'] });
  near(m.betweennessWeighted[1], 1 / 3, 1e-15, 'on the shortest path');
  near(m.betweennessWeighted[2], 0, 1e-15, 'on the longer path');
  // Scaling every weight leaves it unchanged.
  const m2 = computeNodeMetrics(networkFromEdges(4, edges.map(([a, b, x]) => [a, b, x * 1e-6])), { which: ['betweennessWeighted'] });
  assert.deepEqual(Array.from(m2.betweennessWeighted), Array.from(m.betweennessWeighted));
});

// ---- Networks 101 round (N2): the modularity null re-runs community detection ----

test('modularity null: a random network is typical of its own null (the fixed-partition null put it more than 10 sd above)', async () => {
  const { nullModel, createRewirer } = await import('../../src/analysis/uncertainty.js');
  const { detectCommunities, modularity } = await import('../../src/analysis/communities.js');
  const { makeGraph } = await import('../../src/analysis/graph.js');
  const { createRng } = await import('../../src/analysis/rng.js');
  // Erdos-Renyi, 120 people, mean degree about 6: Louvain still finds a
  // partition with modularity ~0.4, which is what random graphs give.
  const rng = createRng(17), e = [];
  for (let a = 0; a < 120; a++) for (let b = a + 1; b < 120; b++) if (rng() < 0.05) e.push([a, b, 1]);
  const net = networkFromEdges(120, e, { directed: false });
  const com = detectCommunities(net, { seed: 1 });
  const r = nullModel(net, { stats: ['modularity'], reps: 60, seed: 3, membership: com.membership }).modularity;
  assert.ok(com.modularity > 0.3, `Louvain finds structure in noise: ${com.modularity}`);
  assert.ok(r.mean > 0.3, `null mean is what the search finds in random networks: ${r.mean}`);
  assert.ok(Math.abs(r.z) < 3 && r.p > 0.05, `z ${r.z}, p ${r.p}`);
  near(r.partition, modularity(makeGraph(120, net.edges.src, net.edges.dst, null, false), com.membership), 1e-12, 'partition shown, unweighted');
  // The old null (partition held fixed on rewired networks) on the same data.
  const rw = createRewirer(120, net.edges.src, net.edges.dst, false), rr = createRng(3);
  const xs = [];
  for (let k = 0; k < 60; k++) { rw.shuffle(10 * net.edges.count, rr); xs.push(modularity(makeGraph(120, rw.src, rw.dst, null, false, rw.m), com.membership)); }
  const m = xs.reduce((a, b) => a + b, 0) / xs.length, sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  assert.ok((com.modularity - m) / sd > 10, 'the straw man this replaces');
});

test('modularity null on weighted ties: weights are ignored on both sides, so a null network is not "significantly low"', async () => {
  const { nullModel } = await import('../../src/analysis/uncertainty.js');
  const { detectCommunities } = await import('../../src/analysis/communities.js');
  const { createRng } = await import('../../src/analysis/rng.js');
  let low = 0;
  for (let k = 0; k < 12; k++) {
    const rng = createRng(100 + k), e = [];
    for (let a = 0; a < 60; a++) for (let b = a + 1; b < 60; b++) if (rng() < 0.08) e.push([a, b, 1 + rng.int(5)]);
    const net = networkFromEdges(60, e, { directed: false });
    const r = nullModel(net, { stats: ['modularity'], reps: 40, seed: k + 1, membership: detectCommunities(net, { seed: 1 }).membership }).modularity;
    if (r.p <= 0.05) low++;
  }
  // Scoring the weighted partition on unweighted ties put 84% of null
  // networks at p <= 0.05 (all below the null mean).
  assert.ok(low <= 3, `${low} of 12`);
});
