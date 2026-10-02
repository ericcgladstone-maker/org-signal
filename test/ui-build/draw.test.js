import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../src/builders/draw.js';
import { snapToGrid, snapPointToGrid, findGuides, snapPoint } from '../../src/builders/draw-snap.js';
import { runLayout, layoutBox, LAYOUTS, treeLayout, concentricLayout } from '../../src/builders/draw-layout.js';
import { eventTargets, eventType } from '../../src/core/model.js';

function triangle() {
  let d = D.emptyDoc('Tri');
  d = D.addNode(d, { id: 'a', label: 'Ann', x: 0, y: 0 });
  d = D.addNode(d, { id: 'b', label: 'Bo', x: 100, y: 0 });
  d = D.addNode(d, { id: 'c', label: 'Cy', x: 50, y: 80 });
  d = D.addEdge(d, { id: 'ab', source: 'a', target: 'b' });
  d = D.addEdge(d, { id: 'bc', source: 'b', target: 'c', weight: 3 });
  return d;
}

test('history: commit, undo, redo round trip; no-op does not add a step', () => {
  const d0 = D.emptyDoc();
  let h = D.createHistory(d0);
  const d1 = D.addNode(d0, { id: 'a', x: 1, y: 2 });
  h = D.commit(h, d1, 'Add node');
  const d2 = D.addNode(d1, { id: 'b' });
  h = D.commit(h, d2, 'Add node');
  h = D.commit(h, h.present, 'Nothing');
  assert.equal(h.past.length, 2);
  h = D.undo(h);
  assert.equal(h.present, d1);
  assert.equal(D.redoLabel(h), 'Add node');
  h = D.undo(h);
  assert.equal(h.present, d0);
  assert.equal(D.undo(h), h, 'undo at the start is a no-op');
  h = D.redo(D.redo(h));
  assert.equal(h.present, d2);
  // a new commit after undo clears the redo branch
  h = D.commit(D.undo(h), D.addNode(d1, { id: 'z' }), 'Add node');
  assert.equal(D.canRedo(h), false);
  assert.deepEqual(h.present.nodes.map(n => n.id), ['a', 'z']);
});

test('removing a node removes incident ties; undo restores both', () => {
  const d = triangle();
  let h = D.createHistory(d);
  h = D.commit(h, D.removeNodes(h.present, ['b']), 'Delete');
  assert.equal(h.present.nodes.length, 2);
  assert.equal(h.present.edges.length, 0);
  h = D.undo(h);
  assert.equal(h.present.edges.length, 2);
  assert.deepEqual(h.present.edges.map(e => e.id), ['ab', 'bc']);
});

test('edges: self-loops and duplicates refused, undirected reverse counts as duplicate', () => {
  let d = triangle();
  assert.equal(D.addEdge(d, { source: 'a', target: 'a' }), d);
  assert.equal(D.addEdge(d, { source: 'b', target: 'a' }), d);
  const d2 = D.addEdge(d, { source: 'b', target: 'a', type: 'advice', directed: true });
  assert.equal(d2.edges.length, 3);
  assert.ok(d2.edgeTypes.includes('advice'));
  d = D.updateEdge(d, 'ab', { weight: -2 });
  assert.equal(D.edgeById(d, 'ab').weight, 1, 'non-positive weight rejected');
  d = D.reverseEdge(D.updateEdge(d, 'ab', { directed: true }), 'ab');
  assert.equal(D.edgeById(d, 'ab').source, 'b');
  d = D.connectPath(d, ['a', 'c']);
  assert.equal(d.edges.length, 3);
});

test('grid snap math', () => {
  assert.equal(snapToGrid(29, 20), 20);
  assert.equal(snapToGrid(31, 20), 40);
  assert.equal(snapToGrid(-11, 20), -20);
  assert.equal(snapToGrid(7, 0), 7);
  assert.deepEqual(snapPointToGrid({ x: 14, y: 26 }, 25), { x: 25, y: 25 });
});

test('alignment guides snap to nearby centres within threshold only', () => {
  const others = [{ x: 100, y: 0 }, { x: 0, y: 200 }];
  const g = findGuides({ x: 103, y: 196 }, others, 6);
  assert.equal(g.x, 100);
  assert.equal(g.y, 200);
  assert.equal(g.guides.filter(x => x.kind === 'align').length, 2);
  const far = findGuides({ x: 150, y: 120 }, others, 6);
  assert.equal(far.x, 150);
  assert.equal(far.y, 120);
  assert.equal(far.guides.length, 0);
});

test('equal-spacing guide extends the gap on a row', () => {
  const others = [{ x: 0, y: 0 }, { x: 80, y: 0 }];
  const g = findGuides({ x: 163, y: 2 }, others, 6);
  assert.equal(g.x, 160);
  assert.equal(g.y, 0);
  assert.ok(g.guides.some(x => x.kind === 'spacing'));
  // midpoint between two neighbours
  const m = findGuides({ x: 42, y: 50 }, [{ x: 0, y: 50 }, { x: 80, y: 50 }], 6);
  assert.equal(m.x, 40);
});

test('snapPoint: guides win, grid fills the other axis', () => {
  const p = snapPoint({ x: 102, y: 33 }, [{ x: 100, y: 500 }], { grid: true, gridSize: 20, threshold: 6 });
  assert.equal(p.x, 100);
  assert.equal(p.y, 40);
  const q = snapPoint({ x: 102, y: 33 }, [], { grid: true, gridSize: 20 });
  assert.deepEqual([q.x, q.y], [100, 40]);
});

function bigDoc(n = 12) {
  let d = D.emptyDoc();
  for (let i = 0; i < n; i++) d = D.addNode(d, { id: 'n' + i, x: (i * 37) % 200, y: (i * 53) % 150, attrs: { level: i % 3 } });
  for (let i = 1; i < n; i++) d = D.addEdge(d, { source: 'n' + Math.floor((i - 1) / 2), target: 'n' + i });
  d = D.addAttrColumn(d, { key: 'level', type: 'number' });
  return d;
}

test('every layout gives finite, distinct positions for all nodes', () => {
  const d = bigDoc();
  const ids = d.nodes.map(n => n.id);
  for (const { id } of LAYOUTS) {
    const pos = runLayout(d, id, ids, { all: true, root: 'n0', key: 'level', seed: 3 });
    assert.equal(pos.size, ids.length, id);
    const seen = new Set();
    for (const p of pos.values()) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), id);
      seen.add(`${p.x.toFixed(3)},${p.y.toFixed(3)}`);
    }
    assert.equal(seen.size, ids.length, `${id} positions distinct`);
  }
});

test('force layout is deterministic for a seed', () => {
  const d = bigDoc();
  const ids = d.nodes.map(n => n.id);
  const a = runLayout(d, 'force', ids, { all: true, seed: 5 });
  const b = runLayout(d, 'force', ids, { all: true, seed: 5 });
  assert.deepEqual([...a.values()], [...b.values()]);
});

test('selection layouts stay inside the selection bounding box', () => {
  let d = bigDoc();
  // a selection with a clearly non-degenerate box
  const sel = ['n3', 'n4', 'n5', 'n6', 'n7'];
  d = D.moveNodes(d, { n3: { x: 500, y: 500 }, n4: { x: 800, y: 520 }, n5: { x: 650, y: 700 }, n6: { x: 520, y: 690 }, n7: { x: 790, y: 650 } });
  const box = layoutBox(d, sel);
  assert.deepEqual(box, { x: 500, y: 500, w: 300, h: 200 });
  for (const { id } of LAYOUTS) {
    const pos = runLayout(d, id, sel, { root: 'n3', key: 'level' });
    for (const p of pos.values()) {
      assert.ok(p.x >= 500 - 1e-6 && p.x <= 800 + 1e-6 && p.y >= 500 - 1e-6 && p.y <= 700 + 1e-6, `${id} ${p.x},${p.y}`);
    }
  }
});

test('tree layout puts the root on top and children one level down', () => {
  const d = bigDoc(7);
  const pos = treeLayout(d, d.nodes.map(n => n.id), { x: 0, y: 0, w: 300, h: 200 }, { root: 'n0' });
  assert.equal(pos.get('n0').y, 0);
  assert.equal(pos.get('n1').y, 100);
  assert.equal(pos.get('n3').y, 200);
  assert.equal(pos.get('n0').x, (pos.get('n1').x + pos.get('n2').x) / 2);
});

test('concentric: highest numeric value innermost', () => {
  const d = bigDoc(9);
  const pos = concentricLayout(d, d.nodes.map(n => n.id), { x: -100, y: -100, w: 200, h: 200 }, { key: 'level' });
  const r = id => Math.hypot(pos.get(id).x, pos.get(id).y);
  assert.ok(r('n2') < r('n1') && r('n1') < r('n0'), 'level 2 inside level 1 inside level 0');
});

test('align and distribute', () => {
  let d = triangle();
  d = D.align(d, ['a', 'b', 'c'], 'top');
  assert.deepEqual(d.nodes.map(n => n.y), [0, 0, 0]);
  d = D.align(d, ['a', 'c'], 'right');
  assert.equal(D.nodeById(d, 'a').x, 50);
  let e = D.emptyDoc();
  for (const [id, x] of [['p', 0], ['q', 10], ['r', 90], ['s', 30]]) e = D.addNode(e, { id, x, y: 0 });
  e = D.distribute(e, ['p', 'q', 'r', 's'], 'h');
  assert.deepEqual(e.nodes.map(n => n.x), [0, 30, 90, 60]);
});

test('copy/paste gives new ids, offsets, and keeps only internal ties', () => {
  const d = triangle();
  const clip = D.copySelection(d, ['a', 'b']);
  assert.equal(clip.edges.length, 1);
  const { doc, ids } = D.paste(d, clip, { offset: 30 });
  assert.equal(doc.nodes.length, 5);
  assert.equal(doc.edges.length, 3);
  assert.ok(ids.every(id => !['a', 'b', 'c'].includes(id)));
  const pa = D.nodeById(doc, ids[0]);
  assert.deepEqual([pa.x, pa.y, pa.label], [30, 30, 'Ann']);
  const pe = doc.edges[2];
  assert.ok(ids.includes(pe.source) && ids.includes(pe.target));
});

test('groups and attribute columns', () => {
  let d = triangle();
  d = D.addGroup(d, { id: 'g1', name: 'Ops' });
  d = D.setGroup(d, ['a', 'b'], 'g1');
  assert.equal(D.nodeById(d, 'a').group, 'g1');
  d = D.removeGroup(d, 'g1');
  assert.equal(D.nodeById(d, 'a').group, null);
  d = D.addAttrColumn(d, { key: 'tenure', type: 'number' });
  assert.equal(D.addAttrColumn(d, { key: 'tenure' }), d, 'duplicate column refused');
  d = D.setNodeAttr(d, 'a', 'tenure', '4');
  d = D.removeAttrColumn(d, 'tenure');
  assert.equal('tenure' in D.nodeById(d, 'a').attrs, false);
});

test('JSON round trip and validation', () => {
  let d = triangle();
  d = D.addGroup(d, { id: 'g', name: 'Team' });
  d = D.setGroup(d, ['c'], 'g');
  const back = D.importJSON(D.exportJSON(d));
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.doc.nodes, d.nodes);
  assert.deepEqual(back.doc.edges, d.edges);
  assert.deepEqual(back.doc.groups, d.groups);
  assert.equal(D.importJSON('{oops').doc, null);
  assert.equal(D.importJSON('{"a":1}').doc, null);
  const messy = D.validateDoc({ nodes: [{ id: 1, x: 'q' }, { id: 1 }, { id: 2, attrs: { role: 'x' }, group: 'g9' }],
    edges: [{ source: 1, target: 2 }, { source: 1, target: 3 }, { source: 2, target: 2 }] });
  assert.equal(messy.doc.nodes.length, 2);
  assert.equal(messy.doc.edges.length, 1);
  assert.equal(messy.errors.length, 3);
  assert.ok(messy.warnings.length >= 1);
  assert.deepEqual(messy.doc.attrColumns, [{ key: 'role', type: 'text' }]);
  assert.deepEqual(messy.doc.groups, [{ id: 'g9', name: 'g9' }]);
});

test('toDataset: shape, keys, view, contexts, weights, typed attrs', () => {
  let d = triangle();
  d = D.addAttrColumn(d, { key: 'tenure', type: 'number' });
  d = D.addAttrColumn(d, { key: 'remote', type: 'boolean' });
  d = D.setNodeAttr(d, 'a', 'tenure', '4');
  d = D.setNodeAttr(d, 'a', 'remote', 'yes');
  d = D.addGroup(d, { id: 'g', name: 'Ops' });
  d = D.setGroup(d, ['a'], 'g');
  d = D.addEdge(d, { source: 'c', target: 'a', type: 'advice' });
  const ds = D.toDataset(d, { name: 'My drawing' });
  assert.equal(ds.meta.name, 'My drawing');
  const src = ds.meta.sources[0];
  assert.equal(src.view, 'full');
  assert.equal(src.context, 'custom');
  assert.equal(src.format, 'draw');
  assert.equal(src.directed, false);
  assert.equal(ds.nodes.count, 3);
  assert.deepEqual(ds.nodes.keys, ['draw:a', 'draw:b', 'draw:c']);
  assert.deepEqual(ds.nodes.labels, ['Ann', 'Bo', 'Cy']);
  assert.deepEqual(ds.nodes.attrs[0], { tenure: 4, remote: true, group: 'Ops' });
  assert.equal(ds.events.count, 3, 'one event per undirected tie');
  assert.ok([...Array(3).keys()].every(i => eventType(ds, i) === 'declared'));
  assert.deepEqual(eventTargets(ds, 1), [[2, 'declared']]);
  assert.equal(ds.events.weight[1], 3);
  assert.deepEqual(ds.contexts.keys, ['draw:type:tie', 'draw:type:advice']);
  assert.deepEqual(ds.contexts.kinds, ['canvas', 'canvas']);
  assert.equal(ds.events.context[2], 1);
  assert.deepEqual(ds.meta.positions[1], [100, 0]);
  // mixed direction: undirected ties emit both directions
  const mixed = D.toDataset(D.addEdge(d, { source: 'a', target: 'c', type: 'reports to', directed: true }));
  assert.equal(mixed.meta.sources[0].directed, true);
  assert.equal(mixed.events.count, 3 * 2 + 1);
  assert.throws(() => D.toDataset(D.emptyDoc()), /no nodes/);
});
