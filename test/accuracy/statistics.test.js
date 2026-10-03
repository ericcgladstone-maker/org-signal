// Fast slice of the statistics checks (tools/accuracy/checks/stats.mjs,
// approx.mjs, consistency.mjs) on fixed seeds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../../tools/accuracy/checks/stats.mjs';
import * as approx from '../../tools/accuracy/checks/approx.mjs';
import * as consistency from '../../tools/accuracy/checks/consistency.mjs';

const show = (r) => `${r.failed} failed: ${JSON.stringify(r.failures.slice(0, 3))}`;

test('null models keep every degree; p-values are calibrated under the null; planted structure is found', async () => {
  const r = await stats.run({ count: 60, seed: 5, reps: 49, parts: ['degrees', 'calibration', 'power'] });
  assert.equal(r.failed, 0, show(r));
  assert.ok(r.stats.nullDegrees.replicates >= 400);
});

test('regression: before/after p-values are calibrated on stationary data (person sign flips gave 14% at 0.05)', async () => {
  const r = await stats.run({ count: 300, seed: 9, parts: ['beforeAfter'] });
  assert.equal(r.failed, 0, show(r));
  const s = r.stats.beforeAfter.stationary;
  // 100 stationary non-chat datasets: the old test rejected ~14%; allow
  // binomial noise around 5%.
  for (const m of ['degree', 'strength']) assert.ok(s[m].pLe05 <= 0.11, `${m}: ${s[m].pLe05}`);
  assert.ok(r.stats.beforeAfter.power.detected.strength >= 0.5, JSON.stringify(r.stats.beforeAfter.power));
});

test('bootstrap rank intervals cover the true strength rank about as often as stated', async () => {
  const r = await stats.run({ count: 60, seed: 2, parts: ['bootstrap'] });
  assert.ok(r.stats.bootstrap.strength.coverage >= 0.88, JSON.stringify(r.stats.bootstrap));
});

test('shift detection: false alarms on flat count series stay rare at the documented thresholds', async () => {
  const r = await stats.run({ count: 70, seed: 4, parts: ['shifts'] });
  assert.equal(r.failed, 0, show(r));
});

test('pivot betweenness and closeness are labelled approximate and track the exact ranks', async () => {
  const r = await approx.run({ count: 4, sizes: [1200], seedsPerGraph: 1 });
  assert.equal(r.failed, 0, show(r));
  for (const row of r.stats.rows) {
    assert.ok(row.betweenness.rho > 0.85, `${row.family}: ${row.betweenness.rho}`);
    assert.ok(row.closeness.rho > 0.9, `${row.family}: ${row.closeness.rho}`);
  }
});

test('engine (inline and worker) equals the pure functions; seeded steps are deterministic; one time window equals the network', async () => {
  const r = await consistency.run({ count: 3, seed: 2 });
  assert.equal(r.failed, 0, show(r));
});
