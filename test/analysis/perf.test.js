// Performance check (CONTRACTS scale target): 5,000 people, ~50,000 ties.
// Node metrics with exact betweenness (both weightings) through the engine,
// which must report progress while it works. Skip with ORG_SIGNAL_SKIP_PERF=1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../../src/analysis/engine.js';
import { DatasetBuilder, VIEWS } from '../../src/core/model.js';
import { createRng } from '../../src/analysis/rng.js';

const skip = process.env.ORG_SIGNAL_SKIP_PERF === '1';

function bigDataset(n = 5000, events = 60000, seed = 42) {
  const rng = createRng(seed);
  const b = new DatasetBuilder({ name: 'perf', source: { format: 'synthetic', view: VIEWS.FULL } });
  const ps = Array.from({ length: n }, (_, i) => b.node('p:' + i, { attrs: { team: 'T' + Math.floor(i / 100) } }));
  const ch = b.context('p:dm', { kind: 'dm', visibility: 'direct' });
  for (let k = 0; k < events; k++) {
    const a = rng.int(n);
    // 70% of messages stay within a team of 100, the rest go anywhere.
    let c = rng() < 0.7 ? Math.floor(a / 100) * 100 + rng.int(100) : rng.int(n);
    if (c === a) c = (a + 1) % n;
    b.event({ actor: ps[a], t: Date.UTC(2026, 0, 1) + k * 60000, context: ch, targets: [[ps[c], 'dm']] });
  }
  return b.build();
}

test('5,000 nodes / ~50,000 ties: exact node metrics within 60 s with progress', { skip, timeout: 180000 }, async () => {
  const ds = bigDataset();
  const engine = createEngine({ worker: false });
  await engine.load(ds);
  const t0 = performance.now();
  const info = await engine.build({ directed: false });
  const tBuild = performance.now() - t0;
  assert.equal(info.n, 5000);
  assert.ok(info.summary.edges > 45000, `ties ${info.summary.edges}`);
  const progress = [];
  const t1 = performance.now();
  const m = await engine.nodeMetrics({ approx: false }, { onProgress: (f, msg) => progress.push([performance.now() - t1, f, msg]) });
  const tMetrics = performance.now() - t1;
  assert.equal(m.meta.betweenness.approximate, false);
  assert.equal(m.betweenness.length, 5000);
  assert.ok(tMetrics < 60000, `node metrics took ${Math.round(tMetrics)} ms`);
  assert.ok(progress.length >= 100, `progress calls ${progress.length}`);
  // Progress keeps arriving during the long betweenness passes (no gap over 2 s).
  let gap = 0;
  for (let i = 1; i < progress.length; i++) gap = Math.max(gap, progress[i][0] - progress[i - 1][0]);
  assert.ok(gap < 2000, `longest silence ${Math.round(gap)} ms`);
  const t2 = performance.now();
  await engine.networkMetrics();
  const tNet = performance.now() - t2;
  console.log(`# perf: build ${Math.round(tBuild)} ms, node metrics ${Math.round(tMetrics)} ms (${progress.length} progress calls, longest gap ${Math.round(gap)} ms), network metrics ${Math.round(tNet)} ms, ties ${info.summary.edges}`);
});
