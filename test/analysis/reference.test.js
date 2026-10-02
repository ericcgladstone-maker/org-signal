// Validation against networkx 3.2 on reference graphs.
// Fixtures: tools/analysis/make-references.py -> test/fixtures/analysis/*.json

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { networkFromEdges } from '../../src/analysis/construct.js';
import { computeNodeMetrics } from '../../src/analysis/metrics.js';
import { computeNetworkMetrics } from '../../src/analysis/network.js';
import { modularity } from '../../src/analysis/communities.js';
import { graphOf } from '../../src/analysis/graph.js';
import { groupMetrics } from '../../src/analysis/groups.js';

const DIR = new URL('../fixtures/analysis/', import.meta.url);
const fixtures = readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => JSON.parse(readFileSync(new URL(f, DIR), 'utf8')));
const TOL = 1e-9;

function close(actual, expected, tol, what) {
  if (expected === null) { assert.ok(Number.isNaN(actual), `${what}: expected NaN, got ${actual}`); return; }
  const err = Math.abs(actual - expected);
  assert.ok(err <= tol * Math.max(1, Math.abs(expected)), `${what}: got ${actual}, networkx ${expected} (diff ${err})`);
}

function fakeDataset(fx) {
  // groupMetrics reads attrs through the dataset; nodeIds are 0..n-1.
  return {
    nodes: { attrs: fx.attr.map((g, i) => ({ grp: g, num: fx.numattr[i] })) },
    attributeSchema: [{ key: 'grp', type: 'categorical' }, { key: 'num', type: 'numeric' }],
  };
}

for (const fx of fixtures) {
  for (const variant of ['weighted', 'binary']) {
    const edges = fx.edges.map(([a, b, w]) => [a, b, variant === 'binary' ? 1 : w]);
    const net = networkFromEdges(fx.n, edges, { directed: fx.directed });
    const ref = fx[variant];

    test(`${fx.name} (${variant}): node metrics match networkx`, () => {
      const m = computeNodeMetrics(net, { approx: false });
      for (const [k, expected] of Object.entries(ref.node)) {
        assert.ok(m[k], `metric ${k} missing`);
        // Power-iteration measures converge to 1e-12 on our side and 1e-14 on networkx's.
        const tol = k === 'eigenvector' || k === 'pagerank' ? 1e-7 : TOL;
        expected.forEach((x, i) => close(m[k][i], x, tol, `${k}[${i}]`));
      }
    });

    test(`${fx.name} (${variant}): network metrics match networkx`, () => {
      const r = computeNetworkMetrics(net);
      const g = graphOf(net);
      for (const k of ['density', 'transitivity', 'avgClustering', 'components', 'reciprocity', 'degreeAssortativity', 'avgPathLength']) {
        if (k in ref.network) close(r[k], ref.network[k], TOL, k);
      }
      if ('modularity' in ref.network) close(modularity(g, Int32Array.from(fx.membership)), ref.network.modularity, TOL, 'modularity');
      const ds = fakeDataset(fx);
      if ('attrAssortativity' in ref.network) close(groupMetrics(net, ds, 'grp').assortativity, ref.network.attrAssortativity, TOL, 'attribute assortativity');
      if ('numericAssortativity' in ref.network) close(groupMetrics(net, ds, 'num').numericAssortativity, ref.network.numericAssortativity, TOL, 'numeric assortativity');
    });
  }
}

test('reference fixtures are present', () => {
  assert.ok(fixtures.length >= 7, 'run tools/analysis/make-references.py');
});
