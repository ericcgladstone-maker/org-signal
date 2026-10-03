// Two-mode networks against networkx.algorithms.bipartite: a fixed slice of
// tools/accuracy/checks/twomode.mjs (random bipartite datasets built through
// addAffiliation, plus Davis's Southern Women), and the Davis values recorded
// from networkx so the check also runs without python.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pythonAvailable, close } from '../../tools/accuracy/lib.mjs';
import * as twomode from '../../tools/accuracy/checks/twomode.mjs';
import { buildNetwork } from '../../src/analysis/construct.js';
import { computeNodeMetrics } from '../../src/analysis/metrics.js';
import { computeNetworkMetrics } from '../../src/analysis/network.js';
import { TWO_MODE_METRICS } from '../../src/analysis/twomode.js';

const show = (r) => `${r.failed} of ${r.comparisons} comparisons failed, e.g. ${JSON.stringify(r.failures.slice(0, 3))}`;
const DAVIS = JSON.parse(readFileSync(new URL('../fixtures/accuracy/davis-southern-women.json', import.meta.url), 'utf8'));

test('two-mode measures and projections match networkx.algorithms.bipartite on 150 random datasets and Davis', { skip: !pythonAvailable() && 'python3 with networkx not available' }, async () => {
  const r = await twomode.run({ count: 150, seed: 5, maxN0: 30, maxN1: 20, largeShare: 0 });
  assert.equal(r.cases, 151);
  assert.ok(r.comparisons > 50000);
  assert.equal(r.failed, 0, show(r));
});

test('Davis Southern Women: recorded networkx values (degree, betweenness, closeness, clustering, density, Robins-Alexander, projections)', () => {
  const c = twomode.davisCase(DAVIS);
  const ds = twomode.twoModeDataset(c);
  const net = buildNetwork(ds, { twoMode: { view: 'two-mode' } });
  assert.equal(net.n, 32);
  assert.equal(net.edges.count, 89);
  assert.deepEqual(net.twoMode.counts, [18, 14]);
  const m = computeNodeMetrics(net, { approx: false });
  for (const k of TWO_MODE_METRICS) {
    for (let v = 0; v < net.n; v++) assert.ok(close(m[k][v], DAVIS.node[k][v], 1e-9), `${k} ${DAVIS.names[v]}: ${m[k][v]} vs ${DAVIS.node[k][v]}`);
  }
  const nm = computeNetworkMetrics(net);
  for (const k of ['twoModeDensity', 'robinsAlexander', 'twoModeAvgClustering']) assert.ok(close(nm[k], DAVIS.network[k], 1e-12), k);
  assert.ok(Math.abs(nm.robinsAlexander - 0.468) < 5e-4);   // networkx's documented example
  for (const view of ['mode0', 'mode1']) for (const how of ['count', 'newman', 'binary']) {
    const p = buildNetwork(ds, { twoMode: { view, projection: how } });
    const got = Array.from({ length: p.edges.count }, (_, e) => { const a = p.nodeIds[p.edges.src[e]], b = p.nodeIds[p.edges.dst[e]]; return [Math.min(a, b), Math.max(a, b), p.edges.raw[e]]; }).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const exp = DAVIS.projections[view][how];
    assert.equal(got.length, exp.length, `${view} ${how}`);
    got.forEach((g, i) => { assert.deepEqual(g.slice(0, 2), exp[i].slice(0, 2)); assert.ok(close(g[2], exp[i][2], 1e-12), `${view} ${how} ${g}`); });
  }
});
