// Two-mode (affiliation) data through the network-file importers, the
// tabular mapper and the exporters: networkx's bipartite files read as
// two-mode, our exports keep the mode (networkx reads them back as
// bipartite), Pajek *Vertices N N1, UCINET DL rectangular matrices, incidence
// matrices and incidence lists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import imp from '../../src/importers/network-files.js';
import { suggestMapping, parseCSV, importTabular } from '../../src/importers/tabular.js';
import { FileSet } from '../../src/core/fileset.js';
import { twoModeOf, MODE_ATTR } from '../../src/core/model.js';
import { buildNetwork, defaultSettings } from '../../src/analysis/construct.js';
import { exportGraphML } from '../../src/exporters/graphml.js';
import { exportGEXF } from '../../src/exporters/gexf.js';
import { exportPajek } from '../../src/exporters/pajek.js';
import { exportUCINET } from '../../src/exporters/ucinet.js';
import { exportNodesCSV } from '../../src/exporters/csv.js';
import { pythonAvailable } from '../../tools/accuracy/lib.mjs';
import { TWO_MODE_FORMATS, twoModeRoundTrip, importText } from '../../tools/accuracy/checks/roundtrip.mjs';
import { caseMix, makeTwoModeCase, twoModeDataset } from '../../tools/accuracy/checks/twomode.mjs';
import { runImporter, fixture, events, node, warning } from './helpers.js';

const F = (...p) => fixture('network-files', ...p);
const run = (files, options) => runImporter(imp, [].concat(files).map(f => F(f)), options);
const modeOf = (ds, key) => twoModeOf(ds).mode[ds.nodes.keys.indexOf(key)];

for (const f of ['nx-bipartite.graphml', 'nx-bipartite.gexf', 'nx-bipartite.gml']) {
  test(`networkx bipartite file ${f}: two-mode, modes kept as numbers, ties are affiliations`, async () => {
    const { ds, source } = await run(f);
    const tm = twoModeOf(ds);
    assert.ok(tm, 'two-mode');
    assert.deepEqual(tm.counts, [4, 3]);
    assert.equal(source.directed, false);
    assert.deepEqual(source.twoMode.labels, ['Actors', 'Events']);
    const avery = ds.nodes.keys.find(k => ds.nodes.labels[ds.nodes.keys.indexOf(k)] === 'Avery Lin');
    assert.strictEqual(ds.nodes.attrs[ds.nodes.keys.indexOf(avery)][MODE_ATTR], 0);
    const ev = events(ds);
    assert.equal(ev.length, 6);
    for (const e of ev) {
      assert.equal(e.type, 'declared');
      assert.equal(e.targets[0][1], 'member');
      assert.equal(modeOf(ds, e.actor), 0);
      assert.equal(modeOf(ds, e.targets[0][0]), 1);
    }
    assert.ok(ev.some(e => e.weight === 2));
    const net = buildNetwork(ds, defaultSettings(ds));
    assert.equal(net.twoMode.view, 'two-mode');
    assert.equal(net.edges.count, 6);
  });
}

test('our GraphML of a two-mode view: bipartite as a long attribute, mode labels in graph data; networkx reads it as bipartite', { skip: !pythonAvailable() && 'python3 with networkx not available' }, async () => {
  const c = makeTwoModeCase({ family: 'gnp', n0: 6, n1: 4, p: 0.4, seed: 9 });
  const ds = twoModeDataset(c);
  const net = buildNetwork(ds, { twoMode: { view: 'two-mode' } });
  const text = exportGraphML(ds, net);
  assert.match(text, /attr\.name="bipartite" attr\.type="long"/);
  assert.match(text, /<data key="mode0_label">People<\/data>/);
  const dir = mkdtempSync(join(tmpdir(), 'os-tm-'));
  const path = join(dir, 'g.graphml');
  writeFileSync(path, text);
  const out = JSON.parse(execFileSync('python3', ['-c', `
import networkx as nx, json, sys
from networkx.algorithms import bipartite
G = nx.read_graphml(sys.argv[1])
top = {n for n, d in G.nodes(data=True) if d.get('bipartite') == 0}
print(json.dumps({'types': sorted({type(d['bipartite']).__name__ for _, d in G.nodes(data=True)}), 'top': len(top), 'n': G.number_of_nodes(), 'm': G.number_of_edges(),
  'ok': bipartite.is_bipartite_node_set(G, top) and all((G.nodes[a]['bipartite'] != G.nodes[b]['bipartite']) for a, b in G.edges()),
  'labels': [G.graph.get('mode0_label'), G.graph.get('mode1_label')], 'density': bipartite.density(G, top)}))
`, path], { encoding: 'utf8' }));
  assert.deepEqual(out.types, ['int']);
  assert.equal(out.top, 6);
  assert.equal(out.m, net.edges.count);
  assert.ok(out.ok);
  assert.deepEqual(out.labels, ['People', 'Events']);
  // And back: the labels return with the data.
  const ds2 = await importText([['g.graphml', text]]);
  assert.deepEqual(twoModeOf(ds2).labels, ['People', 'Events']);
});

test('GEXF and the Gephi node table keep the mode as an integer column', () => {
  const c = makeTwoModeCase({ family: 'dense', n0: 3, n1: 2, seed: 2 });
  const ds = twoModeDataset(c);
  const net = buildNetwork(ds, { twoMode: { view: 'two-mode' } });
  assert.match(exportGEXF(ds, net), /title="bipartite" type="long"/);
  assert.match(exportNodesCSV(ds, net).split('\r\n')[0], /,bipartite/);
});

test('Pajek two-mode: *Vertices N N1 written with the first mode first, and read back as two-mode', async () => {
  const c = makeTwoModeCase({ family: 'gnp', n0: 4, n1: 3, p: 0.5, seed: 4 });
  const ds = twoModeDataset(c);
  const net = buildNetwork(ds, { twoMode: { view: 'two-mode' } });
  const text = exportPajek(ds, net);
  assert.match(text, /^\*Vertices 7 4\n/);
  const { ds: d2, source } = await run('two-mode.net');
  assert.deepEqual(twoModeOf(d2).counts, [3, 2]);
  assert.equal(source.directed, false);
  assert.equal(modeOf(d2, 'net:Choir'), 1);
  assert.equal(events(d2).find(e => e.actor === 'net:Sam Ortiz' && e.targets[0][0] === 'net:Choir').weight, 2);
});

test('UCINET DL: rectangular matrix written for the two-mode view, read as two-mode; a column named like a row stays separate', async () => {
  const c = makeTwoModeCase({ family: 'gnp', n0: 4, n1: 3, p: 0.5, seed: 4 });
  const ds = twoModeDataset(c);
  const net = buildNetwork(ds, { twoMode: { view: 'two-mode' } });
  assert.match(exportUCINET(ds, net), /^dl nr=4 nc=3 format=fullmatrix\nrow labels:\n/);
  const { ds: d2, source } = await run('two-mode.dl');
  const tm = twoModeOf(d2);
  assert.deepEqual(tm.counts, [3, 2]);
  assert.ok(warning(source, 'dl-two-mode'));
  // "Sam" is a row (a person) and a column (an event called Sam).
  assert.equal(modeOf(d2, 'net:Sam'), 0);
  assert.equal(modeOf(d2, 'net:Sam (column)'), 1);
  assert.equal(node(d2, 'net:Sam (column)').label, 'Sam');
  assert.equal(events(d2).length, 4);
  // A square one-mode DL is unchanged.
  const one = await run('fullmatrix.dl');
  assert.equal(twoModeOf(one.ds), null);
});

test('Incidence matrix CSV with an empty corner: row and column names do not overlap, so two-mode', async () => {
  const { ds, source } = await run('incidence.csv');
  const tm = twoModeOf(ds);
  assert.deepEqual(tm.counts, [4, 3]);
  assert.ok(warning(source, 'incidence-matrix'));
  assert.equal(events(ds).length, 6);
  assert.equal(events(ds).find(e => e.actor === 'net:Riley Chen').weight, 2);
  // An adjacency matrix (same names on both sides) stays one-mode.
  assert.equal(twoModeOf((await run('matrix.csv')).ds), null);
});

test('same-mode ties in a bipartite file are kept and reported', async () => {
  const text = `<?xml version="1.0"?><graphml xmlns="http://graphml.graphdrawing.org/xmlns"><key id="b" for="node" attr.name="bipartite" attr.type="int"/>
<graph edgedefault="undirected"><node id="p1"><data key="b">0</data></node><node id="p2"><data key="b">0</data></node><node id="e1"><data key="b">1</data></node>
<edge source="p1" target="e1"/><edge source="p2" target="e1"/><edge source="p1" target="p2"/></graph></graphml>`;
  const ds = await importText([['g.graphml', text]]);
  assert.ok(twoModeOf(ds));
  assert.equal(warning(ds.meta.sources[0], 'same-mode-ties').count, 1);
  const net = buildNetwork(ds, defaultSettings(ds));
  assert.equal(net.edges.count, 2);
  assert.equal(net.twoMode.sameModeEvidence, 1);
});

test('tabular: an incidence list is suggested as affiliations and imported as two-mode with weights and dates', async () => {
  const { rows } = parseCSV('student,club,hours,joined\nAvery Lin,Chess club,2,2025-09-01\nAvery Lin,Choir,1,2025-09-03\nJordan Pike,Choir,3,2025-09-03\n');
  const s = suggestMapping(rows[0], rows.slice(1));
  assert.equal(s.kind, 'affiliations');
  assert.equal(s.mapping.actor, 'student');
  assert.equal(s.mapping.targets, 'club');
  assert.equal(s.mapping.weight, 'hours');
  assert.equal(s.mapping.timestamp, 'joined');
  assert.deepEqual(s.mapping.modeLabels, ['Students', 'Clubs']);
  const fs = await FileSet.fromPaths([fixture('tabular', 'club-memberships.csv')]);
  const ds = await importTabular(fs, { mapping: s.mapping, kind: 'affiliations' });
  const tm = twoModeOf(ds);
  assert.deepEqual(tm.counts, [4, 3]);
  assert.deepEqual(tm.labels, ['Students', 'Clubs']);
  const ev = events(ds);
  assert.equal(ev.length, 6);
  assert.deepEqual(ev[0].targets, [['csv:event:Chess club', 'member']]);
  assert.equal(ev[0].t, Date.UTC(2025, 8, 1));
  assert.equal(ev[2].weight, 3);
  assert.equal(ds.meta.sources[0].directed, false);
  // The automatic path (no mapping chosen) gets there too.
  const auto = await importTabular(fs, {});
  assert.deepEqual(twoModeOf(auto).counts, [4, 3]);
});

test('tabular: an incidence matrix is suggested with event columns and row attributes; empty rows stay as people', async () => {
  const { rows } = parseCSV('Student,Chess club,Choir,Robotics,year\nAvery Lin,1,1,0,2\nJordan Pike,0,1,0,3\nSam Ortiz,0,1,1,2\n');
  const s = suggestMapping(rows[0], rows.slice(1));
  assert.equal(s.kind, 'incidence');
  assert.deepEqual(s.mapping.events, ['Chess club', 'Choir', 'Robotics']);
  assert.deepEqual(s.mapping.attrs, ['year']);
  const fs = await FileSet.fromPaths([fixture('tabular', 'club-matrix.csv')]);
  const ds = await importTabular(fs, { mapping: s.mapping, kind: 'incidence' });
  const tm = twoModeOf(ds);
  assert.deepEqual(tm.counts, [5, 3]);   // Noor Haddad belongs to nothing but is a person
  assert.deepEqual(tm.labels, ['Students', 'Events']);
  assert.equal(events(ds).length, 6);
  assert.equal(node(ds, 'csv:Avery Lin').attrs.year, 2);
  assert.equal(node(ds, 'csv:event:Choir').label, 'Choir');
  const net = buildNetwork(ds, defaultSettings(ds));
  assert.equal(net.n, 8);
});

test('tabular: one-mode tables are not mistaken for two-mode ones', () => {
  const people = parseCSV('employee_id,name,department,level,start_date,remote\nE1,Ana,Design,3,2019-04-01,yes\nE2,Ben,Eng,2,2021-09-15,no\n').rows;
  assert.equal(suggestMapping(people[0], people.slice(1)).kind, 'nodes');
  const roster = parseCSV('name,team\nAna,Design\nBen,Eng\nCai,Design\n').rows;   // names unique: one row per person
  assert.equal(suggestMapping(roster[0], roster.slice(1)).kind, 'nodes');
  const edges = parseCSV('Source,Target,Type,Weight\nA,B,Undirected,2\n').rows;
  assert.equal(suggestMapping(edges[0], edges.slice(1)).kind, 'edges');
});

test('round trip: random two-mode datasets survive every format that keeps the mode', async () => {
  for (const spec of caseMix(12, 21, { maxN0: 15, maxN1: 10, largeShare: 0 })) {
    const c = makeTwoModeCase(spec);
    for (const f of TWO_MODE_FORMATS) {
      const r = await twoModeRoundTrip(c, f);
      assert.deepEqual(r.problems, [], `${f} ${JSON.stringify(spec)}: ${r.problems.join('; ')}`);
    }
  }
});

test('import report: two-mode totals and per-source counts of each kind, with what the data can and cannot show', async () => {
  const { importReport } = await import('../../src/core/report.js');
  const fs = await FileSet.fromPaths([fixture('tabular', 'club-matrix.csv')]);
  const { rows } = parseCSV('Student,Chess club,Choir,Robotics,year\nAvery Lin,1,1,0,2\nJordan Pike,0,1,0,3\n');
  const ds = await importTabular(fs, { mapping: suggestMapping(rows[0], rows.slice(1)).mapping, kind: 'incidence' });
  const r = importReport(ds);
  assert.deepEqual(r.totals.twoMode, { labels: ['Students', 'Events'], counts: [5, 3] });
  assert.deepEqual(r.sources[0].twoMode.counts, [4, 3]);   // Noor Haddad is in no event
  assert.ok(r.sources[0].canShow.some(l => /which of the students belong to/.test(l)));
  assert.ok(r.sources[0].cannotShow.some(l => /opportunity to meet/.test(l)));
  assert.equal(importReport((await run('fullmatrix.dl')).ds).totals.twoMode, null);
});
