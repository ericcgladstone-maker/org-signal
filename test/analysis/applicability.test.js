import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder, VIEWS } from '../../src/core/model.js';
import { buildNetwork, defaultSettings } from '../../src/analysis/construct.js';
import { applicability, APPLICABILITY_KEYS } from '../../src/analysis/applicability.js';
import { NODE_METRICS } from '../../src/analysis/metrics.js';
import { messageDataset } from './helpers.js';

test('every metric gets a level and a reason when not ok', () => {
  const ds = messageDataset(40, 800, { text: () => 'quarterly planning notes' });
  const ap = applicability(ds, buildNetwork(ds, defaultSettings(ds)));
  for (const k of [...NODE_METRICS, ...APPLICABILITY_KEYS]) {
    assert.ok(['ok', 'caution', 'na'].includes(ap[k].level), k);
    if (ap[k].level !== 'ok') assert.ok(ap[k].reason.length > 10, k);
  }
  assert.equal(ap.betweenness.level, 'ok');
  assert.equal(ap.groups.level, 'ok');
  assert.equal(ap.affect.level, 'caution', 'lexicon sentiment always carries a caution');
  assert.equal(ap.hierarchy.level, 'na');
});

test('ego view: path measures are artifacts, ego measures apply', () => {
  const b = new DatasetBuilder({ source: { format: 'mbox', view: VIEWS.EGO, egoKey: 'e:me' } });
  const me = b.node('e:me');
  const others = Array.from({ length: 10 }, (_, i) => b.node('e:' + i));
  for (const o of others) b.event({ actor: me, t: Date.UTC(2026, 0, 1) + o, targets: [[o, 'to']] });
  const ds = b.build();
  const ap = applicability(ds, buildNetwork(ds, defaultSettings(ds)));
  assert.equal(ap.betweenness.level, 'na');
  assert.match(ap.betweenness.reason, /one person's export/);
  assert.equal(ap.closeness.level, 'na');
  assert.equal(ap.ego.level, 'ok');
  assert.deepEqual(ap._context.egoNodes, [me]);
  assert.equal(ap.groups.level, 'na', 'no attributes loaded');
  assert.equal(ap.affect.level, 'na', 'no text');
});

test('undirected, binary, disconnected and copresence-only networks are flagged', () => {
  const b = new DatasetBuilder({ source: { format: 'ics', view: VIEWS.FULL } });
  const ps = Array.from({ length: 8 }, (_, i) => b.node('c:' + i, { attrs: { manager_id: 'c:0', team: i < 4 ? 'a' : 'b' } }));
  const mt = b.context('m', { kind: 'meeting' });
  b.event({ type: 'copresence', actor: ps[0], t: 1, context: mt, targets: [[ps[1], 'attendee'], [ps[2], 'attendee']] });
  b.event({ type: 'copresence', actor: ps[4], t: 2, context: mt, targets: [[ps[5], 'attendee'], [ps[6], 'attendee']] });
  const ds = b.build();
  const net = buildNetwork(ds, { ...defaultSettings(ds), weighting: 'binary' });
  assert.equal(net.directed, false);
  const ap = applicability(ds, net);
  assert.equal(ap.reciprocity.level, 'na');
  assert.equal(ap.inDegree.level, 'na');
  assert.equal(ap.betweennessWeighted.level, 'na');
  assert.equal(ap.eigenvector.level, 'caution');
  assert.match(ap.eigenvector.reason, /components/);
  assert.equal(ap.clustering.level, 'caution');
  assert.match(ap.betweenness.reason, /Managers/);
  assert.equal(ap.hierarchy.level, 'ok');
  assert.equal(ap.timeSeries.level, 'caution');
});
