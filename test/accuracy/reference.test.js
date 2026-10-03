// Fast slice of the accuracy campaign (tools/accuracy/campaign.mjs): reference
// agreement, closed forms, invariances and approximation labels on a fixed
// seed set. The full campaign runs the same checks on thousands of graphs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pythonAvailable } from '../../tools/accuracy/lib.mjs';
import * as reference from '../../tools/accuracy/checks/reference.mjs';
import * as closedforms from '../../tools/accuracy/checks/closedforms.mjs';
import * as invariance from '../../tools/accuracy/checks/invariance.mjs';

const show = (r) => `${r.failed} of ${r.comparisons} comparisons failed, e.g. ${JSON.stringify(r.failures.slice(0, 3))}`;

test('every measure matches networkx / numpy / hand-written references on 300 random graphs', { skip: !pythonAvailable() && 'python3 with networkx and numpy not available' }, async () => {
  // All 15 families, both directions, all five weight schemes, n <= 60.
  const r = await reference.run({ count: 300, seed: 11, maxN: 60, largeShare: 0 });
  assert.equal(r.cases, 300);
  assert.ok(r.comparisons > 100000);
  assert.equal(r.failed, 0, show(r));
});

test('closed-form values: star, path, ring, complete, bipartite, empty, directed variants', async () => {
  const r = await closedforms.run({ count: 30, extra: [80] });
  assert.ok(r.cases > 250);
  assert.equal(r.failed, 0, show(r));
});

test('invariances: relabeling, edge order, isolates, weight scale, unit weights, symmetric directed', async () => {
  const r = await invariance.run({ count: 150, seed: 3 });
  assert.equal(r.failed, 0, show(r));
});
