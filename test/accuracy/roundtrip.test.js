// Export -> re-import -> recompute, on a fixed set of random graphs, for every
// export format. The heavy version is tools/accuracy/campaign.mjs (check
// 'roundtrip'); see tools/accuracy/checks/roundtrip.mjs for what is compared
// and the precision each format keeps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, roundTrip, importText, caseDataset } from '../../tools/accuracy/checks/roundtrip.mjs';
import { caseMix, makeCase } from '../../tools/accuracy/lib.mjs';
import { networkFromEdges, buildNetwork, defaultSettings } from '../../src/analysis/construct.js';
import { exportGraphML } from '../../src/exporters/graphml.js';
import { exportUCINET } from '../../src/exporters/ucinet.js';
import { exportCSV } from '../../src/exporters/csv.js';

const SPECS = caseMix(32, 7, { maxN: 60, largeShare: 0 });

for (const f of Object.keys(FORMATS)) {
  test(`${f}: random graphs survive export and re-import (ties, weights, attributes, measures)`, async () => {
    for (const spec of SPECS) {
      const r = await roundTrip(makeCase(spec), f);
      assert.deepEqual(r.problems, [], `${JSON.stringify(spec)}: ${r.problems.join('; ')}`);
    }
  });
}

// One small directed weighted case, used by the pinned cases below.
const SMALL = { spec: { seed: 1 }, n: 4, directed: true, edges: [[0, 1, 0.1], [1, 2, 2], [2, 1, 2], [2, 0, 1e-3]] };

test('weights survive at float64 precision', async () => {
  const ds = caseDataset(SMALL);
  const net = networkFromEdges(4, SMALL.edges, { directed: true });
  const ds2 = await importText([['g.graphml', exportGraphML(ds, net)]]);
  const net2 = buildNetwork(ds2, defaultSettings(ds2));
  assert.ok(Array.from(net2.edges.w).includes(0.1));
});

test('UCINET DL has no direction flag: a symmetric directed graph reads back undirected', async () => {
  const c = { spec: { seed: 2 }, n: 3, directed: true, edges: [[0, 1, 1], [1, 0, 1], [1, 2, 3], [2, 1, 3]] };
  const ds = caseDataset(c);
  const net = networkFromEdges(3, c.edges, { directed: true });
  const ds2 = await importText([['g.dl', exportUCINET(ds, net)]]);
  assert.equal(buildNetwork(ds2, defaultSettings(ds2)).directed, false);
  // Forcing the direction gives back the original ties.
  const r = await roundTrip(c, 'dl-edgelist');
  assert.deepEqual(r.problems, []);
  assert.ok(r.losses.some(l => l.startsWith('direction')));
});

test('an edge-only Gephi CSV drops isolates; with the node table they survive', async () => {
  const c = { spec: { seed: 3 }, n: 4, directed: false, edges: [[0, 1, 1]] };
  const ds = caseDataset(c);
  const net = networkFromEdges(4, c.edges);
  const csv = exportCSV(ds, net);
  assert.equal((await importText([['edges.csv', csv.edges]])).nodes.count, 2);
  assert.equal((await importText([['edges.csv', csv.edges], ['nodes.csv', csv.nodes]])).nodes.count, 4);
});
