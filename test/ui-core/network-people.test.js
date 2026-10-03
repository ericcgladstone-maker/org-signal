// Network and People views (UX pass F2a): contacts vs total ties, ranks with
// ties, column number formats, attribute display, the map palette fold, attribute
// preference, label budget and collision, layout orientation, and the
// profile's monthly series.

import test from 'node:test';
import assert from 'node:assert/strict';
import { contactsOf, withContacts, rankInfo, fmtRank, metricLabel, displayKey, sparkSeries } from '../../src/ui/lib/measures.js';
import { columnFormat, fmtNum, fmtAttr } from '../../src/ui/lib/format.js';
import { communityScale, MAP_HUES } from '../../src/ui/lib/communities.js';
import { categoricalScale } from '../../src/ui/lib/palette.js';
import { preferredAttributes, isBookkeeping } from '../../src/ui/lib/dsutil.js';
import { labelBudget, overlaps, orientLayout } from '../../src/ui/lib/labels.js';
import { networkFromEdges } from '../../src/analysis/construct.js';
import { computeNodeMetrics } from '../../src/analysis/metrics.js';

test('contacts count each neighbor once; degree on a directed network counts a two-way tie twice', () => {
  // 0 <-> 1 (both ways), 0 -> 2, 3 -> 0, 2 -> 3
  const net = networkFromEdges(4, [[0, 1], [1, 0], [0, 2], [3, 0], [2, 3]], { directed: true });
  const m = computeNodeMetrics(net, { which: ['degree', 'reciprocity'] });
  assert.equal(m.degree[0], 4);
  const c = contactsOf(m, true);
  assert.deepEqual(Array.from(c), [3, 1, 2, 2]);
  // Undirected: degree already counts neighbors.
  const und = networkFromEdges(4, [[0, 1], [0, 2], [2, 3]]);
  const mu = computeNodeMetrics(und, { which: ['degree', 'reciprocity'] });
  assert.deepEqual(Array.from(contactsOf(mu, false)), Array.from(mu.degree));
  // The augmented map leads with contacts and is cached per metrics object.
  const w = withContacts(m, true);
  assert.equal(Object.keys(w)[0], 'contacts');
  assert.equal(withContacts(m, true), w);
  assert.equal(metricLabel('degree', true), 'Total ties (in + out)');
  // Decision 4: never a bare "Degree" without its qualifier.
  assert.equal(metricLabel('degree', false), 'Contacts (degree)');
});

test('ranks show ties instead of hiding them', () => {
  const arr = [0.5, 0.9, 0.5, 0.5, 0.1, NaN];
  assert.deepEqual(rankInfo(arr, 1), { rank: 1, last: 1, n: 5, tied: 0 });
  assert.deepEqual(rankInfo(arr, 0), { rank: 2, last: 4, n: 5, tied: 2 });
  assert.equal(rankInfo(arr, 5), null);
  assert.equal(fmtRank(rankInfo(arr, 1)), 'rank 1 of 5');
  assert.equal(fmtRank(rankInfo(arr, 0)), 'rank 2 to 4 of 5 (shared by 3 people)');
  assert.equal(fmtRank(rankInfo([1, 1, 1], 0)), 'same value for all 3 people');
  assert.equal(fmtRank(null), 'not defined for this person');
});

test('table columns use fixed decimals and no scientific notation', () => {
  const f = columnFormat([0.174, 0.0878, 0.00692, 0.0000001, 0, NaN]);
  assert.deepEqual([0.174, 0.0878, 0.00692, 0.0000001, 0, NaN].map(f), ['0.174', '0.088', '0.007', '~0', '0.000', '–']);
  const g = columnFormat([1943, 12.5, 3]);
  assert.equal(g(1943), '1,943');
  assert.equal(g(12.5), '13');
  assert.equal(columnFormat([3, 12, 74])(74), '74');
  assert.equal(columnFormat([2.4, 1.15])(1.15), '1.15');
  assert.equal(fmtNum(1.6e-106), '~0');
  assert.ok(!/e/i.test(fmtNum(-3e-9)));
});

test('attribute values: time zone offsets in seconds read as UTC offsets', () => {
  assert.equal(fmtAttr('tz_offset', -18000), 'UTC-5');
  assert.equal(fmtAttr('Tz offset', 19800), 'UTC+5:30');
  assert.equal(fmtAttr('tz_offset', 7), '7');
  assert.equal(fmtAttr('is_bot', true), 'yes');
  assert.equal(fmtAttr('dept', 'Sales'), 'Sales');
  assert.equal(displayKey('draw:n987846954f'), null);
  assert.equal(displayKey('slack:U012'), 'slack:U012');
});

test('the map uses all eight hues for communities before folding into Other', () => {
  assert.equal(MAP_HUES, 8);
  const sc = communityScale({ count: 10 });
  assert.equal(sc.entries.length, 8);
  assert.notEqual(sc.color('7'), sc.otherColor);
  assert.equal(sc.color('8'), sc.otherColor);
  assert.equal(categoricalScale(['a', 'b', 'c', 'd', 'e', 'f']).entries.length, 6);
  assert.equal(categoricalScale(['a', 'b', 'c'], { hues: 5 }).folded, false);
});

test('attributes: department-like first, bookkeeping yes/no fields last', () => {
  const attrs = [
    { key: 'title', label: 'Title', type: 'categorical', values: Array.from({ length: 33 }, (_, i) => `t${i}`) },
    { key: 'is_phone_number', label: 'Is phone number', type: 'boolean', values: ['true', 'false'] },
    { key: 'dept', label: 'Dept', type: 'categorical', values: ['a', 'b', 'c', 'd'] },
    { key: 'office', label: 'Office', type: 'categorical', values: ['x', 'y', 'z'] },
  ];
  const n = 40;
  const ds = { attributeSchema: attrs, nodes: { count: n, attrs: Array.from({ length: n }, (_, i) => ({ title: `t${i % 33}`, is_phone_number: i % 2 === 0, dept: 'abcd'[i % 4], office: 'xyz'[i % 3] })) } };
  assert.deepEqual(preferredAttributes(ds).map(a => a.key), ['dept', 'office', 'title', 'is_phone_number']);
  assert.ok(isBookkeeping(attrs[1]));
  assert.ok(isBookkeeping({ key: 'responded', type: 'categorical', values: ['yes', 'no'] }));
  assert.ok(!isBookkeeping(attrs[2]));
});

test('labels: budget by size and zoom, everyone in small networks, no overlaps', () => {
  assert.equal(labelBudget({ n: 10, width: 1000, ratio: 1 }), Infinity);
  assert.equal(labelBudget({ n: 200, width: 1000, ratio: 1 }), 8);
  assert.equal(labelBudget({ n: 200, width: 390, ratio: 1 }), 4);
  assert.equal(labelBudget({ n: 200, width: 1000, ratio: 0.5 }), 16);
  assert.equal(labelBudget({ n: 200, width: 1000, ratio: 1, focus: true }), 20);
  const placed = [{ x: 0, y: 0, w: 50, h: 14 }];
  assert.ok(overlaps({ x: 40, y: 5, w: 30, h: 14 }, placed));
  assert.ok(!overlaps({ x: 60, y: 0, w: 30, h: 14 }, placed));
  assert.ok(!overlaps({ x: 0, y: 20, w: 50, h: 14 }, placed));
});

test('layout orientation puts the long axis along the canvas', () => {
  // Points along the diagonal y = x.
  const x = Float32Array.from([0, 1, 2, 3, 4]), y = Float32Array.from([0, 1.1, 2, 2.9, 4]);
  const span = a => Math.max(...a) - Math.min(...a);
  const wide = orientLayout(x, y, true);
  assert.ok(span(wide.x) > 5 && span(wide.y) < 0.5);
  const tall = orientLayout(x, y, false);
  assert.ok(span(tall.y) > 5 && span(tall.x) < 0.5);
});

test('profile series leave out partly covered months and label the latest value', () => {
  const data = {
    windows: [{ start: 0, coverage: 0.2 }, { start: 1, coverage: 1 }, { start: 2, coverage: 1 }, { start: 3, coverage: 0.09 }],
    node: { degree: [[1], [5], [7], [0]], betweenness: [[NaN], [NaN], [NaN], [NaN]] },
  };
  const s = sparkSeries(data, 0, ['degree', 'betweenness']);
  assert.equal(s.windows.length, 2);
  assert.deepEqual(s.metrics.map(m => m.key), ['degree']);
  assert.deepEqual(s.metrics[0].last, { x: 2, y: 7 });
});
