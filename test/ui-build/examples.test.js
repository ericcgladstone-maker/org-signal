// The worked examples teach what they say: every number in an example's
// "what to look for" is checked here against the analysis the views use.
// Reference values were computed independently with networkx 3.2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES, exampleDoc, exampleSession, exampleById } from '../../src/builders/examples.js';
import * as D from '../../src/builders/draw.js';
import * as E from '../../src/builders/ego.js';
import { exampleFromHash } from '../../src/ui/build/hash.js';
import { defaultSettings, buildNetwork, computeNodeMetrics, computeNetworkMetrics, detectCommunities, groupMetrics, egoMetrics } from '../../src/analysis/index.js';

function analyze(ds) {
  const settings = defaultSettings(ds);
  const net = buildNetwork(ds, settings);
  const m = computeNodeMetrics(net, { which: ['degree', 'betweenness', 'closeness'] });
  const byLabel = metric => Object.fromEntries(Array.from(net.nodeIds, (d, v) => [ds.nodes.labels[d], m[metric][v]]));
  return { settings, net, m, byLabel, network: computeNetworkMetrics(net) };
}
const near = (a, b, tol = 5e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

test('every example loads; drawings are undirected so Build and Network count the same ties', () => {
  for (const ex of EXAMPLES) {
    assert.ok(ex.title && ex.summary && ex.lookFor.length >= 2, ex.id);
    if (ex.kind === 'draw') {
      const doc = exampleDoc(ex.id);
      assert.equal(doc.example, ex.id);
      assert.ok(doc.edges.every(e => !e.directed), `${ex.id} has a directed tie`);
      const a = analyze(D.toDataset(doc));
      assert.equal(a.net.directed, false, ex.id);
      assert.equal(a.net.edges.count, doc.edges.length, `${ex.id}: Network ties = Build ties`);
      assert.equal(D.toDataset(doc).meta.example.title, ex.title);
    } else {
      assert.equal(exampleSession(ex.id).example, ex.id);
    }
  }
  assert.equal(exampleById('nope'), null);
  // The ids the Learn view links to (#build?example=<id>, docs/api/ui-core.md).
  for (const id of ['two-cliques-broker', 'path-and-star', 'ring-small-world', 'class-friendships', 'ego-10']) assert.ok(exampleById(id), id);
  assert.equal(exampleFromHash('#build?example=path-and-star'), 'path-and-star');
  assert.equal(exampleFromHash('#build/example/ego-10'), 'ego-10');
  assert.equal(exampleFromHash('#build?x=1&example=ring-small-world'), 'ring-small-world');
  assert.equal(exampleFromHash('#build?example=nope'), null);
  assert.equal(exampleFromHash('#network?example=path'), null);
  assert.equal(exampleDoc('ego-10'), null);
});

test('L1: in "two teams and a broker" the broker has the highest betweenness and is the only route', () => {
  const doc = exampleDoc('two-cliques-broker');
  const a = analyze(D.toDataset(doc));
  const bt = a.byLabel('betweenness');
  const ranked = Object.entries(bt).sort((x, y) => y[1] - x[1]);
  assert.equal(ranked[0][0], 'Hal Novak');
  assert.ok(ranked[0][1] > ranked[1][1] * 2, 'clearly highest');
  near(bt['Hal Novak'], 16 / 28);            // networkx 0.5714
  near(bt['Ava Lind'], 5 / 28);              // networkx 0.1786
  const deg = a.byLabel('degree');
  assert.equal(deg['Hal Novak'], 4);
  assert.equal(Math.max(...Object.values(deg)), 4, 'Hal does not have the most contacts');
  assert.equal(a.network.components, 1);
  assert.equal(a.net.edges.count, 16);
  // Hal is the only route: without him the teams fall apart.
  const hal = doc.nodes.find(n => n.label === 'Hal Novak').id;
  const b = analyze(D.toDataset(D.removeNodes(doc, [hal])));
  assert.equal(b.network.components, 2);
});

test('path and star: the values the A2 hand calculation is checked against', () => {
  const p = analyze(D.toDataset(exampleDoc('path')));
  const bt = p.byLabel('betweenness'), cl = p.byLabel('closeness'), dg = p.byLabel('degree');
  near(bt.C, 0.6); near(bt.D, 0.6); near(bt.B, 0.4); near(bt.A, 0);
  near(cl.A, (1 + 1 / 2 + 1 / 3 + 1 / 4 + 1 / 5) / 5); near(cl.A, 0.457);
  assert.deepEqual([dg.A, dg.B, dg.F], [1, 2, 1]);
  const s = analyze(D.toDataset(exampleDoc('star')));
  near(s.byLabel('betweenness').Hub, 1); near(s.byLabel('betweenness').L1, 0);
  near(s.byLabel('closeness').Hub, 1); near(s.byLabel('closeness').L3, 0.6);
  near(s.network.degreeCentralization, 1);
});

test('ring vs small world: two shortcuts shorten paths, clustering stays high', () => {
  const r = analyze(D.toDataset(exampleDoc('ring')));
  const w = analyze(D.toDataset(exampleDoc('small-world')));
  assert.equal(r.net.edges.count, 40); assert.equal(w.net.edges.count, 42);
  near(r.network.avgPathLength, 2.895); near(w.network.avgPathLength, 2.347);
  near(r.network.transitivity, 0.5); near(w.network.transitivity, 0.441);
  const top = Object.entries(w.byLabel('betweenness')).sort((x, y) => y[1] - x[1]).slice(0, 4).map(x => x[0]).sort();
  assert.deepEqual(top, ['Ada', 'Fin', 'Kit', 'Pia']);
});

test('class friendships: homophily by major, communities are the majors', () => {
  const ds = D.toDataset(exampleDoc('class-friendships'));
  const a = analyze(ds);
  const g = groupMetrics(a.net, ds, 'major');
  near(g.eiIndex, -0.667);
  near(g.assortativity, 0.75);                // networkx attribute_assortativity_coefficient
  const c = detectCommunities(a.net, { seed: 1 });
  const byCommunity = new Map();
  a.net.nodeIds.forEach((d, v) => {
    const k = c.membership[v];
    if (!byCommunity.has(k)) byCommunity.set(k, new Set());
    byCommunity.get(k).add(ds.nodes.labels[d]);
  });
  assert.equal(byCommunity.size, 3);
  for (const s of byCommunity.values()) assert.equal(s.size, 4);
});

test('the ego example: size, density, effective size and constraint by Burt\'s binary formula', () => {
  const s = exampleSession('ego-10');
  assert.equal(s.alters.length, 10);
  assert.equal(s.alters.filter(x => x.generators.length === 2).length, 3, 'three people named twice');
  const m = E.egoMeasures(s);
  assert.equal(m.size, 10); assert.equal(m.ties, 12);
  near(m.density, 12 / 45); near(m.effectiveSize, 7.6); near(m.constraint, 0.29216);
  // The analysis on the dataset agrees: every tie counts 1 (C4).
  const ds = E.toDataset(s);
  const net = buildNetwork(ds, defaultSettings(ds));
  const ego = egoMetrics(net, 0);
  near(ego.effectiveSize, 7.6); near(ego.constraint, 0.29216); near(ego.density, 12 / 45);
});

test('C4: Priyanka\'s A3 interview gives Burt\'s binary effective size (8.33), not the weighted 8.84', () => {
  // findings-class-survey.md; networkx: effective size 8.333, constraint 0.267 (unweighted).
  const P = ['Mom', 'Dad', 'Chloe Nguyen', 'Farah Haddad', 'Aunt Meera', 'Sam Whitfield', 'Leo Park', 'Hana', 'Omar', 'Lily', 'Prof. Okafor', 'Ms. Gupta'];
  const twice = new Set(['Chloe Nguyen', 'Farah Haddad', 'Hana', 'Dad']);
  let s = E.newSession({ egoLabel: 'Priyanka' });
  s = E.addGenerator(s, { preset: 'discuss', cap: 15 }); s = E.addGenerator(s, { preset: 'social', cap: 15 });
  const id = {};
  for (const n of P) { let r = E.addAlter(s, n, 'discuss'); s = r.session; id[n] = r.alter.id; if (twice.has(n)) s = E.addAlter(s, n, 'social').session; }
  const groups = [['Mom', 'Dad', 'Aunt Meera'], ['Chloe Nguyen', 'Farah Haddad', 'Sam Whitfield', 'Leo Park', 'Lily', 'Prof. Okafor'], ['Hana', 'Omar', 'Ms. Gupta']];
  for (const g of groups) { s = E.addContext(s, 'x', { fromAnswers: false }); const c = s.contexts.at(-1); for (const m of g) s = E.assignContext(s, id[m], c.id); }
  for (const [a, b] of [['Lily', 'Prof. Okafor'], ['Leo Park', 'Lily'], ['Sam Whitfield', 'Lily']]) s = E.setTie(s, id[a], id[b], false);
  for (const [a, b] of [['Mom', 'Hana'], ['Dad', 'Hana'], ['Mom', 'Lily'], ['Chloe Nguyen', 'Hana']]) s = E.setTie(s, id[a], id[b], true);
  const m = E.egoMeasures(s);
  near(m.effectiveSize, 8.333); near(m.constraint, 0.267); near(m.density, 0.333);
  // One reading rule (by density): 22 of 66 pairs is in between, not
  // "brokering" next to a constraint high in its range (retest a3-11).
  assert.equal(m.reading, 'mixed');
  assert.equal(E.egoReading(0.2), 'brokering'); assert.equal(E.egoReading(0.8), 'closed'); assert.equal(E.egoReading(12 / 45), 'brokering');
  const ds = E.toDataset(s);
  const ego = egoMetrics(buildNetwork(ds, defaultSettings(ds)), 0);
  near(ego.effectiveSize, 8.333); near(ego.constraint, 0.267);
});

test('two-mode example: students and clubs, every number in its notes', () => {
  const doc = exampleDoc('clubs-two-mode');
  assert.deepEqual(doc.twoMode.labels, ['Students', 'Clubs']);
  assert.equal(exampleById('two-mode').id, 'clubs-two-mode');
  const ds = D.toDataset(doc);
  const settings = defaultSettings(ds);
  assert.equal(settings.twoMode.view, 'two-mode');
  const net = buildNetwork(ds, settings);
  assert.equal(net.n, 10);
  assert.equal(net.edges.count, 10);
  assert.deepEqual(net.twoMode.counts, [6, 4]);
  const m = computeNodeMetrics(net);
  const by = k => Object.fromEntries(Array.from(net.nodeIds, (d, v) => [ds.nodes.labels[d], m[k][v]]));
  near(computeNetworkMetrics(net).twoModeDensity, 10 / 24);
  near(by('twoModeDegree')['Dev Rao'], 0.5);
  near(by('twoModeDegree').Choir, 0.5);
  assert.equal(by('degree').Choir, 3);
  const bt = by('twoModeBetweenness');
  near(bt['Cara Nunez'], 20 / 30);
  near(bt['Dev Rao'], 0.6);
  assert.equal(Object.entries(bt).filter(([k]) => !['Chess', 'Choir', 'Drama', 'Robotics'].includes(k)).sort((a, b) => b[1] - a[1])[0][0], 'Cara Nunez');
  // Raw betweenness 20 of a possible 30 for a student in a 6 x 4 network.
  near(m.betweenness[net.index[ds.nodes.labels.indexOf('Cara Nunez')]] * (9 * 8) / 2, 20, 1e-9);
  near(computeNetworkMetrics(net).robinsAlexander, 1 / 3);
  const p = buildNetwork(ds, { ...settings, twoMode: { view: 'mode0' } });
  const w = {};
  for (let e = 0; e < p.edges.count; e++) w[[ds.nodes.labels[p.nodeIds[p.edges.src[e]]], ds.nodes.labels[p.nodeIds[p.edges.dst[e]]]].sort().join('|')] = p.edges.raw[e];
  assert.equal(w['Ana Silva|Ben Adler'], 2);
  assert.ok(Object.entries(w).every(([k, v]) => k === 'Ana Silva|Ben Adler' || v === 1));
  const pb = computeNodeMetrics(p, { which: ['betweenness'] });
  const pby = Object.fromEntries(Array.from(p.nodeIds, (d, v) => [ds.nodes.labels[d], pb.betweenness[v]]));
  near(pby['Cara Nunez'], 0.6); near(pby['Dev Rao'], 0.6);
  // The notes quote these values.
  const notes = exampleById('clubs-two-mode').lookFor.join(' ');
  for (const num of ['0.417', '0.500', '0.667', '0.600', '0.333', '20 / 30']) assert.ok(notes.includes(num), num);
});
