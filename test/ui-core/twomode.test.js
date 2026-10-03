// Two-mode networks in the analysis views: the words and options the drawer,
// Network and People show (src/ui/lib/twomode.js), the mode coloring
// (src/ui/lib/coloring.js) and the per-mode "who stands out", on a real
// two-mode network built by the engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder, declareTwoMode, addAffiliation } from '../../src/core/model.js';
import { buildNetwork } from '../../src/analysis/construct.js';
import { computeNodeMetrics } from '../../src/analysis/metrics.js';
import { viewOptions, projectionOptions, projectionSentence, twoModeIntro, perModeStandouts, standoutWords, layoutOptions, defaultLayout, arrangeFor, withoutModeAttr, modeLabelOf, isTwoModeView, twoModeOfNet } from '../../src/ui/lib/twomode.js';
import { nodeColoring, getColorBy, setColorBy, defaultColor } from '../../src/ui/lib/coloring.js';
import { measureNote, UNIT_MEASURES, metricLabel } from '../../src/ui/lib/measures.js';

// 4 women x 3 events: a-x a-y b-x c-y c-z d-z, plus a-z.
function clubs() {
  const b = new DatasetBuilder({ name: 'clubs' });
  b.beginSource({ format: 'test', directed: false });
  declareTwoMode(b, ['Women', 'Events']);
  for (const [p, q] of [['a', 'x'], ['a', 'y'], ['b', 'x'], ['c', 'y'], ['c', 'z'], ['d', 'z'], ['a', 'z']]) addAffiliation(b, 'w:' + p, 'e:' + q, { actorLabel: p.toUpperCase(), eventLabel: q.toUpperCase() });
  return b.build();
}
// The network as the store holds it (src/ui/services/engine.js build()).
const storeNet = (net) => ({ n: net.n, nodeIds: net.nodeIds, directed: net.directed, edgeCount: net.edges.count, twoMode: net.twoMode ?? null });

test('words: view choices, projection weights and the projection sentence use the mode names', () => {
  const v = viewOptions(['Women', 'Events']);
  assert.deepEqual(v.map(o => o.value), ['two-mode', 'mode0', 'mode1']);
  assert.equal(v[0].label, 'Women and events (two-mode)');
  assert.equal(v[1].label, 'Women tied by shared events');
  assert.equal(v[2].label, 'Events tied by shared women');
  assert.deepEqual(projectionOptions(['Women', 'Events']).map(o => o.value), ['count', 'newman', 'binary']);
  assert.match(projectionOptions(['Women', 'Events'], 0)[0].desc, /how many events/);
  assert.equal(projectionSentence({ labels: ['Women', 'Events'], basis: 0, projection: 'count', minShared: 1 }),
    'Projection: two women are tied when they share at least one of the events; tie weight = the number of events they share.');
  assert.match(projectionSentence({ labels: ['Women', 'Events'], basis: 1, projection: 'newman', minShared: 2 }), /two events are tied when they share at least 2 of the women; .*Newman/);
  assert.match(projectionSentence({ labels: ['Women', 'Events'], basis: 0, projection: 'binary', minShared: 1 }), /every tie weighs 1/);
  assert.equal(projectionSentence({ labels: ['Women', 'Events'], basis: -1 }), null);
});

test('two-mode view: intro, layouts, mode labels, mode attribute hidden', () => {
  const ds = clubs();
  const net = storeNet(buildNetwork(ds, { twoMode: { view: 'two-mode' } }));
  assert.ok(isTwoModeView(net));
  assert.equal(twoModeIntro(net.twoMode, 7, 7), '4 women and 3 events, 7 ties (each joins one of the women to one of the events).');
  assert.deepEqual(layoutOptions(net).map(o => o.value), ['force', 'columns', 'rows']);
  assert.deepEqual(layoutOptions(net, { drawn: true }).map(o => o.value), ['drawn', 'force', 'columns', 'rows']);
  assert.equal(defaultLayout(net), 'columns');
  assert.equal(defaultLayout({ ...net, n: 500 }), 'force');
  assert.equal(arrangeFor('columns'), 'columns');
  assert.equal(arrangeFor('force'), null);
  const v = net.index ? 0 : Array.prototype.indexOf.call(net.nodeIds, ds.nodes.keys.indexOf('e:x'));
  assert.equal(modeLabelOf(net, v), 'Events');
  assert.deepEqual(withoutModeAttr(ds.attributeSchema).map(a => a.key), []);
  // Projections: one mode, no columns, projection sentence available.
  const p = storeNet(buildNetwork(ds, { twoMode: { view: 'mode0' } }));
  assert.equal(isTwoModeView(p), false);
  assert.equal(twoModeOfNet(p).basis, 0);
  assert.deepEqual(layoutOptions(p).map(o => o.value), ['force']);
  assert.equal(twoModeIntro(p.twoMode, 4, 4), '4 women and 4 ties between them.');
  // One-mode data has none of it.
  assert.equal(twoModeOfNet({ n: 3 }), null);
});

test('who stands out per mode: each kind ranked among its own, by the two-mode measures', () => {
  const ds = clubs();
  const net = buildNetwork(ds, { twoMode: { view: 'two-mode' } });
  const m = computeNodeMetrics(net);
  const groups = perModeStandouts(m, net.twoMode.mode);
  assert.deepEqual(groups.map(g => g.mode), [0, 1]);
  const label = v => ds.nodes.labels[net.nodeIds[v]];
  const deg0 = groups[0].rows.find(r => r.key === 'twoModeDegree');
  assert.deepEqual(deg0.top.map(label), ['A']);          // A is at all 3 events
  assert.equal(deg0.value, '1.000');
  const deg1 = groups[1].rows.find(r => r.key === 'twoModeDegree');
  for (const v of deg1.top) assert.equal(net.twoMode.mode[v], 1);
  assert.equal(standoutWords('twoModeDegree', ['Women', 'Events'], 0), 'Tied to the largest share of the events');
  assert.equal(standoutWords('twoModeDegree', ['Women', 'Events'], 1), 'Tied to the largest share of the women');
});

test('coloring by mode: two named groups, the default on the two-mode view, gone on a projection', () => {
  const ds = clubs();
  const net = storeNet(buildNetwork(ds, { twoMode: { view: 'two-mode' } }));
  assert.equal(defaultColor(ds, null, [], net), 'mode');
  const c = nodeColoring({ ds, net, colorBy: 'mode' });
  assert.equal(c.kind, 'cat');
  assert.equal(c.mode, true);
  assert.deepEqual(c.gc.colored.map(e => [e.label, e.count]), [['Women', 4], ['Events', 3]]);
  assert.notEqual(c.of(0), c.of(Array.prototype.findIndex.call(net.twoMode.mode, x => x !== net.twoMode.mode[0])));
  assert.equal(getColorBy(ds, null, [], net), 'mode');
  setColorBy(ds, 'mode');
  const p = storeNet(buildNetwork(ds, { twoMode: { view: 'mode0' } }));
  assert.notEqual(getColorBy(ds, null, [], p), 'mode');
});

test('measure notes and formats for the two-mode measures', () => {
  for (const k of ['twoModeDegree', 'twoModeBetweenness', 'twoModeCloseness', 'twoModeClustering']) {
    assert.ok(UNIT_MEASURES.has(k), k);
    assert.ok(measureNote(k, { twoMode: { labels: ['Women', 'Events'], counts: [18, 14] } }).length > 40, k);
  }
  assert.match(measureNote('twoModeDegree', { twoMode: { labels: ['Women', 'Events'], counts: [18, 14] } }), /share of the 14 events/);
  assert.match(metricLabel('twoModeDegree', false), /two-mode degree/i);
});
