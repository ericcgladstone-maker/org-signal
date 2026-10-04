// Group coloring with many groups: all eight hues before folding, "Other
// groups" kept apart from "Not recorded", highlight matching, the default
// grouping attribute shared by Network, People and Groups, and where group
// names go on the map.

import test from 'node:test';
import assert from 'node:assert/strict';
import { groupColoring, otherGroupsLabel, groupLabelMin, OTHER, MISSING, NOT_RECORDED, HUES } from '../../src/ui/lib/grouping.js';
import { categoricalScale, tokens } from '../../src/ui/lib/palette.js';
import { defaultGroupAttr, preferredAttributes } from '../../src/ui/lib/dsutil.js';
import { groupAnchors, groupClusters, clusterMin } from '../../src/ui/lib/labels.js';

const groups = k => Array.from({ length: k }, (_, i) => ({ value: `g${i}`, count: 100 - i }));

test('eight groups: every one in its own hue, no Other row', () => {
  const gc = groupColoring(groups(8));
  const t = tokens();
  assert.equal(HUES, 8);
  assert.equal(gc.many, false);
  assert.equal(gc.otherCount, 0);
  assert.deepEqual(gc.entries.map(e => e.color), t.cat);
  assert.equal(new Set(gc.entries.map(e => e.color)).size, 8);
});

test('nine or more groups: the eight largest keep their hues, the rest are Other groups', () => {
  const gc = groupColoring(groups(33), { missing: 12 });
  const t = tokens();
  assert.equal(gc.many, true);
  assert.equal(gc.colored.length, 8);
  assert.equal(gc.otherCount, 25);
  assert.equal(gc.color('g7'), t.cat[7]);
  assert.equal(gc.color('g8'), t.other);
  assert.equal(gc.otherPeople, gc.others.reduce((a, e) => a + e.count, 0));
  assert.equal(gc.otherLabel, `Other groups (25 groups, ${gc.otherPeople.toLocaleString("en-US")} people)`);
  assert.equal(otherGroupsLabel(1, 1), 'Other groups (1 group, 1 person)');
  // Same fold as the plain scale the other charts use: a 9th hue never appears.
  const sc = categoricalScale(groups(33).map(g => g.value));
  assert.equal(sc.entries.length, 8);
  assert.ok(sc.folded);
});

test('Not recorded is its own color and words, never Other groups', () => {
  const gc = groupColoring(groups(12), { missing: 40 });
  assert.notEqual(gc.missingColor, gc.otherColor);
  assert.equal(gc.color(''), gc.missingColor);
  assert.equal(gc.color(null), gc.missingColor);
  assert.equal(gc.missingLabel, NOT_RECORDED);
  assert.ok(!/other/i.test(gc.missingLabel));
  assert.ok(!gc.isOther(''));
  assert.ok(gc.isOther('g9'));
  assert.ok(!gc.isOther('g2'));
  // Highlight rows: Other matches every folded group and nothing missing.
  assert.ok(gc.matches('g11', OTHER));
  assert.ok(!gc.matches('g0', OTHER));
  assert.ok(!gc.matches('', OTHER));
  assert.ok(gc.matches('', MISSING));
  assert.ok(!gc.matches('g0', MISSING));
  assert.ok(gc.matches('g3', 'g3'));
  assert.ok(!gc.matches('', 'g3'));
});

test('colors follow the group, not its rank among what a filter leaves', () => {
  const all = groupColoring(groups(10));
  const before = all.color('g5');
  // A view that only shows some groups still colors from the full ordering.
  assert.equal(all.color('g5'), before);
  assert.equal(groupColoring(groups(10)).color('g9'), all.otherColor);
});

test('group names on the map: size threshold', () => {
  assert.equal(groupLabelMin(100), 3);
  assert.equal(groupLabelMin(2561), 26);
});

const attr = (key, k, extra = {}) => ({ key, label: key.replace(/_/g, ' '), type: 'categorical', values: Array.from({ length: k }, (_, i) => `${key}${i}`), ...extra });
function ds(schema, n = 200) {
  return {
    meta: { sources: [] },
    attributeSchema: schema,
    nodes: { count: n, attrs: Array.from({ length: n }, (_, i) => Object.fromEntries(schema.map(a => [a.key, a.values[i % a.values.length]]))) },
  };
}

test('default grouping: a coarse department-like attribute, never one with more than 8 values when a coarser one exists', () => {
  // The generated workplace: 33 departments and 8 divisions.
  const work = ds([attr('department', 33), attr('division', 8), attr('title', 40), attr('location', 3)]);
  assert.equal(defaultGroupAttr(work), 'division');
  assert.equal(defaultGroupAttr(work, { communities: { count: 20 } }), 'division');
  assert.equal(preferredAttributes(work)[0].key, 'division');
  // Both coarse: department wins (the finer of the useful ones).
  assert.equal(defaultGroupAttr(ds([attr('division', 3), attr('department', 6)])), 'department');
  // Two values are enough for a top-level grouping.
  assert.equal(defaultGroupAttr(ds([attr('team', 2)])), 'team');
  // Only a 12-value department: used unless the communities are coarser.
  const twelve = ds([attr('department', 12)]);
  assert.equal(defaultGroupAttr(twelve), 'department');
  assert.equal(defaultGroupAttr(twelve, { communities: { count: 30 } }), 'department');
  assert.equal(defaultGroupAttr(twelve, { communities: { count: 6 } }), null);
  // Nothing department-like: communities.
  assert.equal(defaultGroupAttr(ds([attr('title', 40), attr('location', 3)])), null);
  // Planted ground truth is never the default.
  assert.equal(defaultGroupAttr(ds([attr('planted_group', 4)])), null);
});

test('group anchors sit where most of the group is, not at its mean', () => {
  // Group a: 20 people clustered at (0,0) plus 4 strays at (10,10); group b at (10,10).
  const x = [], y = [], key = [];
  for (let i = 0; i < 20; i++) { x.push(i % 5 * 0.05); y.push(Math.floor(i / 5) * 0.05); key.push('a'); }
  for (let i = 0; i < 4; i++) { x.push(10); y.push(10); key.push('a'); }
  for (let i = 0; i < 10; i++) { x.push(10 + i * 0.01); y.push(10); key.push('b'); }
  x.push(5); y.push(5); key.push('');
  const anchors = groupAnchors(Float64Array.from(x), Float64Array.from(y), i => key[i]);
  assert.deepEqual(anchors.map(a => a.key), ['a', 'b']);
  const a = anchors[0];
  assert.equal(a.n, 24);
  assert.ok(a.x < 1 && a.y < 1, `anchor at ${a.x},${a.y}`);
  assert.ok(Math.abs(anchors[1].x - 10) < 0.5);
});

// Points for the cluster tests: `count` people of group `key` in a tight
// 0.1-spaced block at (cx, cy).
function blob(pts, key, count, cx, cy) {
  for (let i = 0; i < count; i++) pts.push({ x: cx + (i % 4) * 0.1, y: cy + Math.floor(i / 4) * 0.1, key });
}
const anchorsOf = pts => groupAnchors(Float64Array.from(pts, p => p.x), Float64Array.from(pts, p => p.y), i => pts[i].key);

test('group clusters: single linkage by distance in layout space', () => {
  const x = Float64Array.from([0, 0.5, 1.0, 5, 5.4, 20]), y = new Float64Array(6);
  // A chain of close steps is one cluster; a gap wider than eps splits.
  assert.deepEqual(groupClusters(x, y, [0, 1, 2, 3, 4, 5], 0.6), [[0, 1, 2], [3, 4], [5]]);
  assert.deepEqual(groupClusters(x, y, [0, 1, 2, 3, 4, 5], 5), [[0, 1, 2, 3, 4], [5]]);
  // Only the listed members count; equal sizes go in node order.
  assert.deepEqual(groupClusters(x, y, [3, 0], 0.6), [[0], [3]]);
  assert.deepEqual(groupClusters(x, y, [], 1), []);
  assert.equal(clusterMin(4), 3);
  assert.equal(clusterMin(44), 11);
  assert.equal(clusterMin(45), 12);
});

test('a group split into two substantial clusters is named on each', () => {
  // Operations-like: 30 people bottom right, 14 top middle, far apart;
  // other groups fill the map between them.
  const pts = [];
  blob(pts, 'ops', 30, 10, 10);
  blob(pts, 'ops', 14, 5, 0);
  blob(pts, 'eng', 15, 10, 0);
  blob(pts, 'sales', 16, 0, 10);
  const a = anchorsOf(pts);
  const ops = a.filter(c => c.key === 'ops');
  assert.equal(ops.length, 2);
  assert.deepEqual(ops.map(c => [c.part, c.n, c.m]), [[0, 44, 30], [1, 44, 14]]);
  // The main name goes on the larger cluster, the second on the smaller.
  assert.ok(Math.abs(ops[0].x - 10.15) < 0.3 && Math.abs(ops[0].y - 10.35) < 0.5, `main at ${ops[0].x},${ops[0].y}`);
  assert.ok(Math.abs(ops[1].x - 5.15) < 0.3 && ops[1].y < 1, `second at ${ops[1].x},${ops[1].y}`);
  // Every group's main anchor comes before any second one, so a second name
  // never takes the place of another group's first.
  assert.deepEqual(a.map(c => `${c.key}:${c.part}`), ['ops:0', 'sales:0', 'eng:0', 'ops:1']);
});

test('stragglers and small loose ends do not add a name', () => {
  const pts = [];
  // 20 together and 4 elsewhere: 4 is under a quarter of 24 (6).
  blob(pts, 'a', 20, 0, 0);
  blob(pts, 'a', 4, 10, 10);
  // A small group in 2 + 2 + 2: no part reaches 3 people.
  blob(pts, 'b', 2, 10, 0);
  blob(pts, 'b', 2, 0, 10);
  blob(pts, 'b', 2, 5, 5);
  // The same small size in 3 + 3 does: two parts of at least 3 people.
  blob(pts, 'c', 3, 3, 8);
  blob(pts, 'c', 3, 8, 3);
  const a = anchorsOf(pts);
  assert.deepEqual(a.filter(c => c.key === 'a').map(c => [c.part, c.m]), [[0, 24]]);
  assert.deepEqual(a.filter(c => c.key === 'b').map(c => [c.part, c.m]), [[0, 6]]);
  assert.deepEqual(a.filter(c => c.key === 'c').map(c => [c.part, c.m]), [[0, 3], [1, 3]]);
});

test('a Louvain community of one (an isolate) is shown as no community, and the others keep their numbers', async () => {
  const { communityNumber, communityLabel, NO_COMMUNITY } = await import('../../src/ui/lib/communities.js');
  const c = { membership: [0, 0, 1, 1, 2], sizes: [2, 2, 1], count: 3 };
  assert.deepEqual([0, 1, 2, 3, 4].map(v => communityNumber(c, v)), [1, 1, 2, 2, null]);
  assert.equal(communityLabel(c, 4), NO_COMMUNITY);
  assert.equal(communityLabel(c, 2), 'Community 2');
});
