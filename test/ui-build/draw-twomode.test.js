// Two-mode drawings: the document format, the edits, and the conversion to a
// two-mode dataset the analysis engine reads (src/core/model.js, two-mode).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../src/builders/draw.js';
import { runLayout, layoutsFor } from '../../src/builders/draw-layout.js';
import { twoModeOf, MODE_ATTR, ROLES } from '../../src/core/model.js';
import { defaultSettings, buildNetwork } from '../../src/analysis/index.js';

function small() {
  let d = D.setTwoMode(D.emptyDoc('t'), true).doc;
  d = D.addNode(d, { id: 'a', label: 'Ann', mode: 0, x: 0, y: 0 });
  d = D.addNode(d, { id: 'b', label: 'Bo', mode: 0, x: 0, y: 60 });
  d = D.addNode(d, { id: 'x', label: 'Picnic', mode: 1, x: 200, y: 0 });
  d = D.addNode(d, { id: 'y', label: 'Gala', mode: 1, x: 200, y: 60 });
  d = D.addEdge(d, { id: 'e1', source: 'a', target: 'x' });
  d = D.addEdge(d, { id: 'e2', source: 'y', target: 'b', weight: 2 });   // event first: still an affiliation of Bo
  d = D.addEdge(d, { id: 'e3', source: 'b', target: 'x', directed: true });
  return d;
}

test('two-mode doc: defaults, labels, names by mode, modes on nodes', () => {
  const d0 = D.setTwoMode(D.emptyDoc(), true);
  assert.deepEqual(d0.doc.twoMode, { labels: ['People', 'Events'] });
  assert.equal(D.nextLabel(d0.doc, 0), 'Person 1');
  assert.equal(D.nextLabel(d0.doc, 1), 'Event 1');
  assert.equal(D.modeNoun('Clubs'), 'Club');
  assert.equal(D.modeNoun('Companies'), 'Company');
  assert.equal(D.modeNoun('Boards'), 'Board');
  assert.equal(D.modeNoun('Staff'), 'Staff');
  const d = small();
  assert.deepEqual(d.nodes.map(D.nodeMode), [0, 0, 1, 1]);
  assert.equal(d.edges.length, 3);
  assert.ok(d.edges.every(e => !e.directed), 'affiliations are undirected');
  assert.equal(D.setModeLabels(d, ['Women', '']).twoMode.labels.join(','), 'Women,Events');
  // A one-mode drawing has no mode fields at all (older drawings unchanged).
  const one = D.addNode(D.emptyDoc(), { id: 'p' });
  assert.equal(one.nodes[0].mode, undefined);
  assert.equal(one.twoMode, undefined);
});

test('two-mode doc: same-mode ties are refused, with a plain reason', () => {
  const d = small();
  assert.equal(D.addEdge(d, { source: 'a', target: 'b' }), d);
  assert.equal(D.addEdge(d, { source: 'x', target: 'y' }), d);
  assert.match(D.canConnect(d, 'a', 'b'), /only join people with events; Ann and Bo are both people/);
  assert.equal(D.canConnect(d, 'a', 'y'), null);
  // connectPath skips same-mode steps; paste keeps only cross-mode ties.
  const p = D.connectPath(d, ['a', 'b', 'y']);
  assert.equal(p.edges.length, 3, 'a-b refused, b-y already there');
  const clip = { nodes: [{ id: 'q', label: 'Q', x: 0, y: 0, group: null, attrs: {}, mode: 0 }, { id: 'r', label: 'R', x: 0, y: 0, group: null, attrs: {}, mode: 0 }], edges: [{ id: 'z', source: 'q', target: 'r', type: 'tie', weight: 1, directed: false }] };
  const pasted = D.paste(d, clip).doc;
  assert.equal(pasted.edges.length, d.edges.length);
  assert.deepEqual(pasted.nodes.slice(-2).map(n => n.mode), [0, 0]);
});

test('turning a drawing two-mode: alternating ties become the modes; otherwise everyone starts in mode 0 and the same-mode ties are counted', () => {
  let d = D.emptyDoc();
  for (const id of ['p1', 'p2', 'c1', 'c2']) d = D.addNode(d, { id, label: id });
  d = D.addEdge(d, { source: 'p1', target: 'c1' });
  d = D.addEdge(d, { source: 'p2', target: 'c1' });
  d = D.addEdge(d, { source: 'p2', target: 'c2', directed: true });
  const r = D.setTwoMode(d, true, ['Women', 'Events']);
  assert.equal(r.assigned, 'colouring');
  assert.equal(r.sameMode, 0);
  assert.deepEqual(r.doc.nodes.map(n => n.mode), [0, 0, 1, 1]);
  assert.ok(r.doc.edges.every(e => !e.directed));
  // A triangle cannot be two-coloured.
  const tri = D.addEdge(D.addEdge(d, { source: 'p1', target: 'p2' }), { source: 'c1', target: 'c2' });
  const r2 = D.setTwoMode(tri, true);
  assert.equal(r2.assigned, 'all-mode-0');
  assert.equal(r2.sameMode, tri.edges.length);
  assert.equal(D.sameModeEdges(r2.doc).length, tri.edges.length);
  const fixed = D.setNodeMode(r2.doc, ['c1', 'c2'], 1);
  assert.equal(D.sameModeEdges(fixed).length, 2);   // p1-p2 and c1-c2
  // And back: modes dropped, ties kept.
  const back = D.setTwoMode(fixed, false).doc;
  assert.equal(back.twoMode, undefined);
  assert.ok(back.nodes.every(n => !('mode' in n)));
  assert.equal(back.edges.length, tri.edges.length);
});

test('toDataset: a two-mode dataset with modes, affiliations as member targets, same-mode ties left out with a warning', () => {
  let d = small();
  d = { ...d, edges: [...d.edges, { id: 'bad', source: 'a', target: 'b', type: 'tie', weight: 1, directed: false }] };
  const ds = D.toDataset(d);
  const tm = twoModeOf(ds);
  assert.deepEqual(tm.labels, ['People', 'Events']);
  assert.deepEqual(tm.counts, [2, 2]);
  assert.equal(ds.nodes.attrs[ds.nodes.labels.indexOf('Gala')][MODE_ATTR], 1);
  assert.equal(ds.events.count, 3);
  for (let i = 0; i < ds.events.count; i++) {
    assert.equal(ds.nodes.attrs[ds.events.actor[i]][MODE_ATTR], 0, 'the actor is the mode-0 node');
    assert.equal(ROLES[ds.events.role[i]], 'member');
  }
  assert.ok(ds.meta.sources[0].warnings.some(w => w.code === 'same-mode-tie'));
  assert.equal(ds.meta.sources[0].directed, false);
  const net = buildNetwork(ds, defaultSettings(ds));
  assert.equal(net.twoMode.view, 'two-mode');
  assert.equal(net.edges.count, 3);
  assert.equal(net.edges.w[[...net.edges.src.keys()].find(e => ds.nodes.labels[net.nodeIds[net.edges.src[e]]] === 'Bo' && ds.nodes.labels[net.nodeIds[net.edges.dst[e]]] === 'Gala' || ds.nodes.labels[net.nodeIds[net.edges.dst[e]]] === 'Bo' && ds.nodes.labels[net.nodeIds[net.edges.src[e]]] === 'Gala')], 2);
  assert.deepEqual(ds.meta.positions.length, 4);
});

test('save and load: export / import JSON keeps the two-mode format; older and malformed docs stay valid', () => {
  const d = small();
  const { doc, errors, warnings } = D.importJSON(D.exportJSON(d));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(doc.twoMode, d.twoMode);
  assert.deepEqual(doc.nodes.map(n => n.mode), [0, 0, 1, 1]);
  assert.deepEqual(D.toDataset(doc).events.count, 3);
  // Nodes without a mode in a two-mode file go to mode 0, with a warning; same-mode ties are reported.
  const v = D.validateDoc({ twoMode: { labels: ['Directors', 7] }, nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1, mode: '1' }, { id: 'c', x: 2, y: 2, mode: 0 }], edges: [{ source: 'a', target: 'c' }, { source: 'a', target: 'b', directed: true }] });
  assert.deepEqual(v.doc.twoMode.labels, ['Directors', 'Events']);
  assert.deepEqual(v.doc.nodes.map(n => n.mode), [0, 1, 0]);
  assert.ok(v.warnings.some(w => /no mode/.test(w)));
  assert.ok(v.warnings.some(w => /same mode/.test(w)));
  assert.equal(v.doc.edges[1].directed, false);
  // A one-mode doc with stray mode fields stays one-mode.
  const o = D.validateDoc({ nodes: [{ id: 'a', mode: 1, x: 0, y: 0 }], edges: [] });
  assert.equal(o.doc.twoMode, undefined);
  assert.equal(o.doc.nodes[0].mode, undefined);
});

test('layouts: two columns and two rows put each mode on its own side, ordered to cut crossings; offered only to two-mode drawings', () => {
  const d = small();
  assert.ok(layoutsFor(d).some(l => l.id === 'columns'));
  assert.ok(!layoutsFor(D.emptyDoc()).some(l => l.id === 'columns'));
  const ids = d.nodes.map(n => n.id);
  const cols = runLayout(d, 'columns', ids, { all: true });
  const xs = id => cols.get(id).x;
  assert.ok(xs('a') < xs('x') && xs('b') < xs('y') && xs('a') === xs('b'));
  for (const p of cols.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  const rows = runLayout(d, 'rows', ids, { all: true });
  assert.ok(rows.get('a').y < rows.get('x').y);
  // Bo goes to both events, Ann only to the picnic: Ann sits on the picnic's side.
  const order = ['a', 'b'].sort((p, q) => cols.get(p).y - cols.get(q).y);
  const ev = ['x', 'y'].sort((p, q) => cols.get(p).y - cols.get(q).y);
  assert.equal(order[0] === 'a', ev[0] === 'x');
});
