// End to end over a fixed seed set: distribution-level recovery properties of
// generator + analysis (not one lucky seed). Thresholds come from the campaign
// (tools/accuracy/campaign.mjs, check `recovery`) with slack; see
// docs/accuracy.md for the measured distributions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, recoveryCheck } from '../../src/generator/index.js';
import * as A from '../../src/analysis/index.js';
import { analyse } from '../../tools/accuracy/checks/recovery.mjs';

const SEEDS = [101, 102, 103, 104, 105];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const check = (rep, id) => rep.checks.find(c => c.id === id);
const world = (structure, seed, medium = 'slack', context = 'workplace') => generate({ context, medium, structure, seed, content: 'none', output: 'dataset' });

test('bridge-dependent workplace: fidelity and brokers hold across seeds', () => {
  const fid = [], prec = [];
  for (const seed of SEEDS) {
    const { dataset, groundTruth } = world('bridge-dependent', seed);
    const { report } = analyse(dataset, groundTruth);
    fid.push(check(report, 'betweenness-fidelity').value);
    prec.push(check(report, 'bridges').value);
  }
  assert.ok(median(fid) >= 0.95, `median fidelity ${median(fid)}`);
  assert.ok(Math.min(...fid) >= 0.9, `min fidelity ${Math.min(...fid)}`);
  assert.ok(median(prec) >= 0.5, `median broker precision@k ${median(prec)}`);
});

test('flat workplaces: few false shift alarms per dataset (robust and CUSUM)', () => {
  const seeds = [201, 202, 203, 204, 205, 206, 207, 208];
  const alarms = { robust: 0, cusum: 0 };
  for (const seed of seeds) {
    const { dataset, groundTruth } = world('distributed', seed);
    assert.equal((groundTruth.events || []).filter(e => ['departure', 'reorg', 'silo', 'quiet', 'consolidation'].includes(e.type)).length, 0);
    const { shiftsBy } = analyse(dataset, groundTruth, { methods: ['robust', 'cusum'] });
    for (const m of Object.keys(alarms)) alarms[m] += shiftsBy[m].shifts.length;
  }
  assert.ok(alarms.robust / seeds.length <= 0.375, `robust: ${alarms.robust / seeds.length} false alarms per dataset`);
  assert.ok(alarms.cusum / seeds.length <= 0.375, `cusum: ${alarms.cusum / seeds.length} false alarms per dataset`);
});

test('planted silo and consolidation are found near the planted date in most seeds', () => {
  for (const structure of ['siloed', 'consolidating']) {
    let hit = 0;
    const seeds = [301, 302, 303, 304];
    for (const seed of seeds) {
      const { dataset, groundTruth } = world(structure, seed);
      const { report } = analyse(dataset, groundTruth);
      const c = report.checks.find(x => x.area === 'time');
      if (c?.verdict === 'recovered') hit++;
    }
    assert.ok(hit >= 3, `${structure}: recovered in ${hit} of ${seeds.length} seeds`);
  }
});

// With the direction set correctly, a network file of the true ties is the
// true network, so betweenness must rank people exactly as the truth does.
test('network medium measured undirected matches the true ties exactly', () => {
  for (const seed of [401, 402]) {
    const { dataset, groundTruth } = world('distributed', seed, 'network');
    const net = A.buildNetwork(dataset, { ...A.defaultSettings(dataset), directed: false });
    const nodeMetrics = A.computeNodeMetrics(net, { which: ['betweenness'] });
    const f = check(recoveryCheck(groundTruth, dataset, net, { nodeMetrics }), 'betweenness-fidelity');
    assert.ok(f.value >= 0.99, `seed ${seed}: fidelity ${f.value}`);
  }
});

// Generator (dataset output) bug, reported to its owner: the 'network' medium
// source does not set directed: false, so default construction reads each
// undirected true tie as one-way and fidelity falls to about 0.7. The native
// GraphML round trip is correct (edgedefault="undirected" -> directed: false).
test('network medium dataset declares undirected ties', () => {
  const { dataset, groundTruth } = world('distributed', 401, 'network');
  assert.equal(groundTruth.ties.directed, false);
  assert.equal(dataset.meta.sources[0].directed, false);
});
