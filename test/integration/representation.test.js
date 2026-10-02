// End to end: does the analysis recover what the generator planted?
//
// Each case generates a world with known structure, measures it with the real
// analysis code, and asks the generator's independent recoveryCheck what was
// found. Thresholds are set from runs on 2026-10-02 with a little slack; a drop
// below them means the measurement (or the generator) regressed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, recoveryCheck } from '../../src/generator/index.js';
import * as A from '../../src/analysis/index.js';

function analyse(ds, T) {
  const net = A.buildNetwork(ds, A.defaultSettings(ds));
  const nodeMetrics = A.computeNodeMetrics(net, { which: ['betweenness', 'degree'] });
  const com = A.detectCommunities(net, { seed: 1 });
  const attr = T.communities?.attr || (ds.attributeSchema.find(a => a.type === 'categorical') || {}).key;
  const hasText = ds.events.text.some(t => t);
  const affect = attr && hasText ? A.affect(ds, { by: 'group', attr }) : null;
  const shifts = A.detectShifts(A.timeSeries(ds, net.settings, { window: 'week', attr }));
  const diffusion = hasText ? A.diffusion(ds, net, {}) : null;
  return recoveryCheck(T, ds, net, { membership: com.membership, nodeMetrics, affect, shifts, diffusion });
}

const verdict = (rep, id) => rep.checks.find(c => c.id === id)?.verdict;
const valueOf = (rep, id) => rep.checks.find(c => c.id === id)?.value;

test('bridge-dependent workplace: communities, brokers, fidelity and the departure are recovered', () => {
  const { dataset, groundTruth } = generate({ context: 'workplace', medium: 'slack', structure: 'bridge-dependent', seed: 7, content: 'light', output: 'dataset' });
  const rep = analyse(dataset, groundTruth);
  assert.equal(verdict(rep, 'bridges'), 'recovered', rep.summary);
  assert.ok(valueOf(rep, 'betweenness-fidelity') >= 0.95);
  assert.ok(rep.checks.filter(c => c.area === 'time').every(c => c.verdict === 'recovered'));
  assert.ok(rep.checks.filter(c => c.verdict === 'missed').length === 0, rep.summary);
});

test('siloed workplace: the silo is detected as a shift', () => {
  const { dataset, groundTruth } = generate({ context: 'workplace', medium: 'slack', structure: 'siloed', seed: 7, content: 'none', output: 'dataset' });
  const rep = analyse(dataset, groundTruth);
  const silo = rep.checks.find(c => c.area === 'time');
  assert.equal(silo.verdict, 'recovered', silo.says);
});

test('online polarized: communities exactly recovered', () => {
  const { dataset, groundTruth } = generate({ context: 'online', medium: 'x', structure: 'polarized', seed: 7, content: 'light', output: 'dataset' });
  const rep = analyse(dataset, groundTruth);
  const com = rep.checks.find(c => c.area === 'structure' && /communit/i.test(c.name));
  assert.equal(com.verdict, 'recovered', com.says);
  assert.ok(valueOf(rep, 'betweenness-fidelity') >= 0.9);
});

test('classroom survey: recall error is visible and communities recovered', () => {
  const { dataset, groundTruth } = generate({ context: 'survey', medium: 'survey', structure: 'classroom', seed: 7, content: 'none', output: 'dataset' });
  const rep = analyse(dataset, groundTruth);
  assert.ok(rep.checks.filter(c => c.verdict === 'recovered').length >= 3, rep.summary);
});

test('shift detection stays quiet on worlds with nothing planted', () => {
  let alarms = 0;
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  for (const seed of seeds) {
    const { dataset: ds, groundTruth: T } = generate({ context: 'workplace', medium: 'slack', structure: 'distributed', seed, content: 'none', output: 'dataset' });
    assert.equal((T.events || []).filter(e => ['departure', 'reorg', 'silo', 'quiet', 'consolidation'].includes(e.type)).length, 0);
    const net = A.buildNetwork(ds, A.defaultSettings(ds));
    alarms += A.detectShifts(A.timeSeries(ds, net.settings, { window: 'week', attr: T.communities?.attr || 'department' })).shifts.length;
  }
  assert.ok(alarms / seeds.length <= 0.5, `${alarms / seeds.length} false alarms per dataset`);
});
