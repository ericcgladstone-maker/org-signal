// Hand-computed cases and behaviours not covered by the networkx references.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkFromEdges } from '../../src/analysis/construct.js';
import { computeNodeMetrics } from '../../src/analysis/metrics.js';
import { computeNetworkMetrics } from '../../src/analysis/network.js';
import { detectCommunities } from '../../src/analysis/communities.js';
import { groupMetrics, egoMetrics } from '../../src/analysis/groups.js';
import { erdosRenyi, planted } from './helpers.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('approximate betweenness is labelled and tracks the exact values', () => {
  const net = erdosRenyi(400, 0.02, { seed: 21 });
  const exact = computeNodeMetrics(net, { which: ['betweenness'], approx: false });
  const approx = computeNodeMetrics(net, { which: ['betweenness'], approxThreshold: 100, pivots: 150, seed: 3 });
  assert.equal(exact.meta.betweenness.approximate, false);
  assert.equal(approx.meta.betweenness.approximate, true);
  assert.equal(approx.meta.betweenness.pivots, 150);
  // Pearson correlation between exact and sampled.
  const x = exact.betweenness, y = approx.betweenness;
  let mx = 0, my = 0;
  for (let i = 0; i < x.length; i++) { mx += x[i]; my += y[i]; }
  mx /= x.length; my /= y.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  assert.ok(sxy / Math.sqrt(sxx * syy) > 0.9);
  close(my, mx, mx * 0.15);
});

test('directed ego density counts directed ties among alters', () => {
  // ego 0 -> 1, 2, 3; among alters 1->2, 2->1, 2->3: 3 of 3*2 possible.
  const net = networkFromEdges(4, [[0, 1], [0, 2], [3, 0], [1, 2], [2, 1], [2, 3]], { directed: true });
  const m = computeNodeMetrics(net, { which: ['egoDensity', 'reciprocity'] });
  close(m.egoDensity[0], 0.5);
  assert.ok(Number.isNaN(computeNodeMetrics(networkFromEdges(2, [[0, 1]], { directed: true }), { which: ['egoDensity'] }).egoDensity[0]));
  close(m.reciprocity[1], 2 / 3); // 1: in {0, 2}, out {2}: overlap 1
});

test('star: betweenness 1 at the centre, eigenvector converges on a bipartite graph', () => {
  const net = networkFromEdges(6, [1, 2, 3, 4, 5].map(i => [0, i]));
  const m = computeNodeMetrics(net, {});
  close(m.betweenness[0], 1);
  close(m.betweenness[1], 0);
  assert.ok(m.meta.eigenvector.converged);
  close(m.eigenvector[0], Math.SQRT1_2, 1e-9);           // centre = 1/sqrt(2)
  close(m.eigenvector[1], Math.SQRT1_2 / Math.sqrt(5), 1e-9);
  close(m.constraint[1], 1);
  close(m.effectiveSize[0], 5);
});

test('isolates get zeros or NaN, never errors', () => {
  const net = networkFromEdges(4, [[0, 1]]);
  const m = computeNodeMetrics(net, {});
  assert.equal(m.degree[3], 0);
  assert.equal(m.betweenness[3], 0);
  assert.equal(m.closeness[3], 0);
  assert.ok(Number.isNaN(m.constraint[3]));
  assert.ok(Number.isNaN(m.effectiveSize[3]));
  const r = computeNetworkMetrics(net);
  assert.equal(r.components, 3);
  assert.equal(r.isolates, 2);
  close(r.largestComponentShare, 0.5);
  const empty = computeNodeMetrics(networkFromEdges(3, []), {});
  assert.deepEqual(Array.from(empty.eigenvector), [0, 0, 0]);
});

test('network metrics: centralization, gini, path length, strong components', () => {
  const star = computeNetworkMetrics(networkFromEdges(5, [[0, 1], [0, 2], [0, 3], [0, 4]]));
  close(star.degreeCentralization, 1);
  close(star.avgPathLength, (4 * 1 * 2 + 12 * 2) / 20);
  assert.equal(star.diameter, 2);
  const cyc = computeNetworkMetrics(networkFromEdges(3, [[0, 1], [1, 2], [2, 0]], { directed: true }));
  assert.equal(cyc.strongComponents, 1);
  close(cyc.strengthGini, 0);
  const chain = computeNetworkMetrics(networkFromEdges(3, [[0, 1], [1, 2]], { directed: true }));
  assert.equal(chain.strongComponents, 3);
});

test('communities: planted groups recovered, same seed same labels', () => {
  const { net } = planted(120, 0.25, 0.005, { groups: 3, seed: 2 });
  const a = detectCommunities(net, { seed: 1 }), b = detectCommunities(net, { seed: 1 });
  assert.deepEqual(a.membership, b.membership);
  assert.equal(a.count, 3);
  assert.ok(a.modularity > 0.5);
  // Every planted group maps to one community.
  for (let g = 0; g < 3; g++) {
    const labels = new Set();
    for (let i = g; i < 120; i += 3) labels.add(a.membership[i]);
    assert.equal(labels.size, 1);
  }
  assert.equal(a.membership[0], 0, 'ids ordered by first member');
});

test('groupMetrics: E-I, densities and mixing by hand', () => {
  // X = {0, 1}, Y = {2, 3}, Z missing for 4. Ties: 0-1 (in), 0-2, 1-3 (out), 2-4 (ignored).
  const net = networkFromEdges(5, [[0, 1], [0, 2], [1, 3], [2, 4]]);
  const ds = { nodes: { attrs: [{ g: 'X' }, { g: 'X' }, { g: 'Y' }, { g: 'Y' }, {}] }, attributeSchema: [{ key: 'g', type: 'categorical' }] };
  const r = groupMetrics(net, ds, 'g');
  close(r.coverage, 0.8);
  close(r.eiIndex, 1 / 3);
  assert.deepEqual(r.values, ['X', 'Y']);
  const X = r.groups[0], Y = r.groups[1];
  assert.equal(X.value, 'X');
  close(X.density, 1);
  close(Y.density, 0);
  close(X.eiIndex, 1 / 3);
  close(Y.eiIndex, 1);
  close(r.mixing.density[0][1], 2 / 4);
  assert.deepEqual(r.mixing.counts, [[1, 2], [2, 0]]);
});

test('egoMetrics: size, density, diversity and homophily by hand', () => {
  // ego 0 with alters 1, 2, 3; tie 1-2 among alters.
  const net = networkFromEdges(4, [[0, 1], [0, 2], [0, 3], [1, 2]]);
  const ds = { nodes: { attrs: [{ d: 'A' }, { d: 'A' }, { d: 'B' }, { d: 'C' }], labels: ['e', 'a', 'b', 'c'] }, attributeSchema: [{ key: 'd', type: 'categorical' }] };
  const r = egoMetrics(net, 0, { ds, attr: 'd' });
  assert.equal(r.size, 3);
  close(r.density, 1 / 3);
  close(r.effectiveSize, 3 - 2 / 3);
  close(r.diversity, 1 - 3 * (1 / 9));
  close(r.homophily, 1 / 3);
  close(r.egoEI, (2 - 1) / 3);
  assert.deepEqual(r.alters, [1, 2, 3]);
  assert.equal(egoMetrics(net, 9).inNetwork, false);
});
