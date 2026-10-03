// Construction with tie fields: weight from a field, filters by a field,
// filters that leave other sources alone, and tie fields in evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder } from '../../src/core/model.js';
import { buildNetwork, defaultSettings, edgeEvidence, edgeTieAttributes, tieFieldPlan } from '../../src/analysis/construct.js';

function ds() {
  const b = new DatasetBuilder({ name: 'tf' });
  b.beginSource({ format: 'roster', view: 'full', tieFields: [
    { key: 'type', label: 'Type', type: 'choice', options: ['advice', 'friendship'] },
    { key: 'strength', label: 'Strength', type: 'scale', max: 5 },
    { key: 'freq', label: 'How often', type: 'choice', options: ['Monthly', 'Weekly', 'Daily'], ordered: true },
  ] });
  const [a, c, d, e] = ['a', 'c', 'd', 'e'].map(k => b.node('r:' + k));
  b.event({ type: 'declared', actor: a, targets: [[c, 'declared']], weight: 1, attrs: { type: 'advice', strength: 5, freq: 'Daily' } });
  b.event({ type: 'declared', actor: c, targets: [[d, 'declared']], weight: 1, attrs: { type: ['advice', 'friendship'], strength: 2, freq: 'Monthly' } });
  b.event({ type: 'declared', actor: d, targets: [[e, 'declared']], weight: 1, attrs: { type: 'friendship' } });
  b.event({ type: 'declared', actor: e, targets: [[a, 'declared']], weight: 3 });
  // A second source without tie fields: messages.
  b.beginSource({ format: 'slack', view: 'full' });
  const ctx = b.context('ch', { kind: 'channel', visibility: 'public' });
  b.event({ type: 'message', actor: a, targets: [[d, 'mention']], context: ctx });
  return b.build();
}
const w = (net, ds, x, y) => { const i = net.index[ds.nodes.keys.indexOf('r:' + x)], j = net.index[ds.nodes.keys.indexOf('r:' + y)]; for (let k = 0; k < net.edges.count; k++) if (net.edges.src[k] === i && net.edges.dst[k] === j) return net.edges.w[k]; return 0; };

test('defaults: no tie-field weighting or filtering', () => {
  const d = ds();
  const s = defaultSettings(d);
  assert.deepEqual(s.tieFields, { weight: null, filters: [] });
  assert.equal(tieFieldPlan(d, s.tieFields), null);
  const net = buildNetwork(d, { directed: true });
  assert.equal(w(net, d, 'a', 'c'), 1);
  assert.equal(w(net, d, 'e', 'a'), 3);
  assert.equal(net.summary.tieFields.filtered, 0);
});

test('weight from a numeric field; events without it keep their weight and are counted', () => {
  const d = ds();
  const net = buildNetwork(d, { directed: true, tieFields: { weight: 'strength' } });
  assert.equal(w(net, d, 'a', 'c'), 5);
  assert.equal(w(net, d, 'c', 'd'), 2);
  assert.equal(w(net, d, 'd', 'e'), 1);   // blank strength: event weight
  assert.equal(w(net, d, 'e', 'a'), 3);
  assert.equal(net.summary.tieFields.weightMissing, 2);
  assert.equal(w(net, d, 'a', 'd'), 1);   // the Slack mention is untouched
});

test('weight from an ordered choice uses its position', () => {
  const d = ds();
  const net = buildNetwork(d, { directed: true, tieFields: { weight: 'freq' } });
  assert.equal(w(net, d, 'a', 'c'), 3);   // Daily = third option
  assert.equal(w(net, d, 'c', 'd'), 1);   // Monthly = first
});

test('filter by a categorical field: only advice ties; other sources pass', () => {
  const d = ds();
  const net = buildNetwork(d, { directed: true, tieFields: { filters: [{ key: 'type', values: ['advice'] }] } });
  assert.equal(w(net, d, 'a', 'c'), 1);
  assert.equal(w(net, d, 'c', 'd'), 1);   // several values: any matches
  assert.equal(w(net, d, 'd', 'e'), 0);
  assert.equal(w(net, d, 'e', 'a'), 0);   // blank type is dropped ...
  assert.equal(w(net, d, 'a', 'd'), 1);   // ... but Slack messages are not
  assert.equal(net.summary.tieFields.filtered, 2);
  const keep = buildNetwork(d, { directed: true, tieFields: { filters: [{ key: 'type', values: ['advice'], keepMissing: true }] } });
  assert.equal(w(keep, d, 'e', 'a'), 3);
  const strong = buildNetwork(d, { directed: true, tieFields: { filters: [{ key: 'strength', min: 3 }] } });
  assert.equal(w(strong, d, 'a', 'c'), 1);
  assert.equal(w(strong, d, 'c', 'd'), 0);
});

test('evidence and per-edge tie fields', () => {
  const d = ds();
  const net = buildNetwork(d, { directed: true });
  const ev = edgeEvidence(d, net, d.nodes.keys.indexOf('r:a'), d.nodes.keys.indexOf('r:c'));
  assert.deepEqual(ev[0].attrs, { type: 'advice', strength: 5, freq: 'Daily' });
  const { fields, values } = edgeTieAttributes(d, net);
  assert.deepEqual(fields.map(f => f.key), ['type', 'strength', 'freq']);
  const k = [...Array(net.edges.count).keys()].find(e => net.nodeIds[net.edges.src[e]] === d.nodes.keys.indexOf('r:c'));
  assert.deepEqual(values[k], { type: 'advice; friendship', strength: 2, freq: 'Monthly' });
  // Undirected: both reports of a pair are combined (numbers averaged).
  const b = new DatasetBuilder();
  b.beginSource({ format: 't' });
  const x = b.node('t:x'), y = b.node('t:y');
  b.event({ type: 'declared', actor: x, targets: [[y, 'declared']], attrs: { strength: 4, type: 'advice' } });
  b.event({ type: 'declared', actor: y, targets: [[x, 'declared']], attrs: { strength: 2, type: 'friendship' } });
  const u = b.build();
  const un = buildNetwork(u, { directed: false });
  assert.deepEqual(edgeTieAttributes(u, un).values, [{ strength: 3, type: 'advice; friendship' }]);
});
