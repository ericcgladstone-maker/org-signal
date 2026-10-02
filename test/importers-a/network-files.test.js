import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import imp from '../../src/importers/network-files.js';
import { parseXml, XmlSax } from '../../src/importers/xml.js';
import { FileSet } from '../../src/core/fileset.js';
import { runImporter, fixture, events, node, ctx, warning } from './helpers.js';

const F = (...p) => fixture('network-files', ...p);
const run = (files, options) => runImporter(imp, [].concat(files).map(f => F(f)), options);
const iso = ms => new Date(ms).toISOString();

// Python reader used as the independent reference.
const NX_READ = `
import networkx as nx, json, sys, warnings
warnings.simplefilter('ignore')
kind, path = sys.argv[1], sys.argv[2]
G = {'graphml': nx.read_graphml, 'gexf': nx.read_gexf, 'gml': nx.read_gml, 'pajek': nx.read_pajek}[kind](path)
def clean(v):
    if isinstance(v, (bool, int, float, str)) or v is None: return v
    return str(v)
print(json.dumps({'directed': G.is_directed(), 'multi': G.is_multigraph(),
  'nodes': {str(n): {k: [type(v).__name__, clean(v)] for k, v in d.items()} for n, d in G.nodes(data=True)},
  'edges': [[str(u), str(v), clean(d.get('weight', 1.0))] for u, v, d in G.edges(data=True)]}, ensure_ascii=False))
`;
function nx(kind, path) {
  return JSON.parse(execFileSync('python3', ['-c', NX_READ, kind, path], { encoding: 'utf8' }));
}

test('xml tokenizer: entities, CDATA, namespaces, doctype skipped, chunked input', () => {
  const s = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "boom">]><!-- <c> --><g:r xmlns:g="urn:x" a=\'1 &amp; 2\'><n id="&lt;1">T&#233;st &a; &#x1F600;<![CDATA[<raw>&amp;]]></n><e/></g:r>';
  const t = parseXml(s);
  assert.equal(t.local, 'r'); assert.equal(t.ns, 'urn:x'); assert.equal(t.attrs.a, '1 & 2');
  assert.equal(t.children[0].attrs.id, '<1');
  assert.equal(t.children[0].text, 'Tést &a; \u{1F600}<raw>&amp;'); // custom entity NOT expanded
  const parts = [];
  const sax = new XmlSax({ text: x => parts.push(x) });
  for (const ch of s) sax.write(ch);
  sax.end();
  assert.equal(parts.join(''), 'Tést &a; \u{1F600}<raw>&amp;');
  // literal newlines in attributes normalise to spaces; &#10; survives
  assert.equal(parseXml('<a t="x&#10;y\nz"/>').attrs.t, 'x\ny z');
  assert.throws(() => parseXml('<a><b></a>'), /Mismatched/);
  assert.throws(() => parseXml('<a>'), /not closed/);
});

test('detect: scores and claimed files', async () => {
  const fs = await FileSet.fromPaths([F('typed.graphml')]);
  const d = await imp.detect(fs);
  assert.equal(d.score, 0.9); assert.deepEqual(d.files, ['typed.graphml']);
  const nc = await imp.detect(await FileSet.fromPaths([F('nc.graphml')]));
  assert.equal(nc.score, 0.3);
  const pair = await imp.detect(await FileSet.fromPaths([F('gephi_nodes.csv'), F('gephi_edges.csv')]));
  assert.equal(pair.score, 0.8); assert.deepEqual(pair.files.sort(), ['gephi_edges.csv', 'gephi_nodes.csv']);
  const nodesOnly = await imp.detect(await FileSet.fromPaths([F('gephi_nodes.csv')]));
  assert.equal(nodesOnly.score, 0);
  assert.equal((await imp.detect(await FileSet.fromPaths([F('plain_edges.csv')]))).score, 0.55);
  assert.equal((await imp.detect(await FileSet.fromPaths([F('graph.edgelist')]))).score, 0.5);
  for (const f of ['nx.gml', 'mixed.net', 'fullmatrix.dl', 'static-12.gexf']) assert.equal((await imp.detect(await FileSet.fromPaths([F(f)]))).score, 0.9, f);
});

test('GraphML: typed keys, defaults, parallel edges, relation contexts, self-loop, time key', async () => {
  const { ds, source } = await run('typed.graphml');
  assert.equal(source.format, 'graphml'); assert.equal(source.view, 'full'); assert.equal(source.directed, true);
  assert.deepEqual(node(ds, 'net:n0').attrs, { team: 'Design', tenure: 7, remote: true, score: 0.25 });
  assert.equal(node(ds, 'net:n1').label, 'José Pérez & Co');
  assert.equal(node(ds, 'net:n1').attrs.team, 'unknown'); // <default> applied (networkx keeps it in graph['node_default'] instead)
  assert.deepEqual(node(ds, 'net:n1').platformIds, { net: 'n1' });
  const ev = events(ds);
  assert.equal(ev.length, 3);
  assert.ok(ev.every(e => e.type === 'declared'));
  assert.deepEqual(ev.map(e => [e.actor, e.targets[0][0], e.targets[0][1], e.weight, e.context]), [
    ['net:n0', 'net:n1', 'declared', 4, 'net:typed.graphml#advice'],
    ['net:n0', 'net:n1', 'declared', 1.5, 'net:typed.graphml#advice'],
    ['net:n1', 'net:n2', 'declared', 1, 'net:typed.graphml'],
  ]);
  assert.equal(ev[0].t, Date.UTC(2026, 2, 2, 9, 15));
  assert.ok(Number.isNaN(ev[1].t));
  assert.equal(ctx(ds, 'net:typed.graphml#advice').kind, 'network');
  assert.equal(source.counts['self-loops'], 1);
  assert.match(warning(source, 'edge-attrs-dropped').message, /note/);
});

test('GraphML: no namespace, missing edgedefault, per-edge override; yEd labels', async () => {
  const { ds, source } = await run('plain.graphml');
  assert.equal(source.directed, false);
  assert.ok(warning(source, 'no-edgedefault'));
  assert.equal(warning(source, 'mixed-directedness').count, 1);
  assert.equal(events(ds)[0].weight, 3);
  const y = await run('yed.graphml');
  assert.equal(node(y.ds, 'net:n0').label, 'Riley Chen');
  assert.deepEqual(node(y.ds, 'net:n0').attrs, { description: 'first' });
  assert.equal(node(y.ds, 'net:n1').label, 'Jordan Pike');
});

test('GEXF 1.2draft static: attributes, defaults, kind as relation, non-ASCII label', async () => {
  const { ds, source } = await run('static-12.gexf');
  assert.equal(source.format, 'gexf'); assert.equal(source.directed, false);
  assert.deepEqual(node(ds, 'net:u1').attrs, { team: 'Design', msgs: 42, manager: true });
  assert.equal(node(ds, 'net:u2').label, '北京 Office');
  assert.equal(node(ds, 'net:u2').attrs.msgs, 0);
  const ev = events(ds);
  assert.deepEqual(ev.map(e => [e.actor, e.targets[0][0], e.weight, e.context]), [
    ['net:u1', 'net:u2', 4, 'net:static-12.gexf'], ['net:u2', 'net:u3', 1, 'net:static-12.gexf'], ['net:u1', 'net:u2', 2, 'net:static-12.gexf#mentor']]);
  assert.match(warning(source, 'edge-attrs-dropped').message, /channel/);
});

test('GEXF 1.3 dynamic timestamps: one event per spell, dynamic weights, compact timestamps', async () => {
  const { ds, source } = await run('dynamic-13.gexf');
  const ev = events(ds);
  assert.deepEqual(ev.map(e => [e.actor, e.targets[0][0], e.weight, iso(e.t)]), [
    ['net:u1', 'net:u2', 1, '2026-03-02T09:15:00.000Z'],
    ['net:u1', 'net:u2', 2, '2026-03-04T16:40:00.000Z'],
    // static weight 6 split over 3 timestamps so the total is preserved
    ['net:u2', 'net:u3', 2, '2026-03-01T00:00:00.000Z'],
    ['net:u2', 'net:u3', 2, '2026-03-05T12:00:00.000Z'],
    ['net:u2', 'net:u3', 2, '2026-03-06T00:00:00.000Z'],
  ]);
  assert.equal(source.counts['timed-edges'], 5);
  assert.equal(source.directed, true);
});

test('GEXF intervals: spells and edge start, ends dropped with a warning; numeric times', async () => {
  const { ds, source } = await run('interval-13.gexf');
  assert.deepEqual(events(ds).map(e => [e.actor, e.weight, e.t]), [
    ['net:a', 1.5, Date.UTC(2024, 0, 1)], ['net:a', 1.5, Date.UTC(2024, 1, 1)], ['net:b', 1, Date.UTC(2024, 2, 15)]]);
  assert.equal(warning(source, 'interval-end-dropped').count, 3);
  const d = await run('double-13.gexf');
  const ev = events(d.ds);
  assert.equal(ev.length, 2);
  assert.ok(ev.every(e => Number.isNaN(e.t)));
  assert.equal(ev[0].weight, 2);
  assert.match(warning(d.source, 'numeric-time-not-dates').message, /1 to 21/);
});

test('GML: entities decoded, keyed by unique label, reals and ints, graphics ignored', async () => {
  const { ds, source } = await run('nx.gml');
  assert.equal(source.directed, true);
  const n = node(ds, 'net:José Pérez');
  assert.deepEqual(n.attrs, { team: 'Design', tenure: 3, score: 0.5 });
  assert.deepEqual(n.platformIds, { net: '0' });
  assert.deepEqual(events(ds).map(e => e.weight), [4, 15, 1]);
  assert.match(warning(source, 'edge-attrs-dropped').message, /channel/);
});

test('Pajek: quotes, coords, mixed arcs/edges, arcslist, undirected UTF-8', async () => {
  const m = await run('mixed.net');
  assert.ok(node(m.ds, 'net:Sam "Sammy" Ortiz'));
  assert.deepEqual(node(m.ds, 'net:Avery Lin').attrs, { x: 0.1, y: 0.2, z: 0.5 });
  assert.equal(m.ds.nodes.count, 4);
  assert.ok(warning(m.source, 'mixed-directedness'));
  assert.deepEqual(events(m.ds).map(e => e.weight), [4, 1, 2]);
  const a = await run('arcslist.net');
  assert.deepEqual(events(a.ds).map(e => [e.actor, e.targets[0][0]]), [['net:a', 'net:b'], ['net:a', 'net:c'], ['net:c', 'net:a']]);
  const u = await run('undirected.net');
  assert.equal(u.source.directed, false);
  assert.ok(node(u.ds, 'net:北京'));
});

test('UCINET DL: fullmatrix, edgelist1 embedded, nodelist1, NM=2 relations, upperhalf', async () => {
  const f = await run('fullmatrix.dl');
  assert.equal(f.source.format, 'ucinet-dl'); assert.equal(f.source.directed, true);
  assert.deepEqual(events(f.ds).map(e => `${e.actor.slice(4)}>${e.targets[0][0].slice(4)}`),
    ['Avery>Jordan', 'Avery>Sam', 'Jordan>Avery', 'Jordan>Riley', 'Riley>Avery']);
  const e = await run('edgelist1.dl');
  assert.deepEqual(events(e.ds).map(x => [x.actor.slice(4), x.targets[0][0].slice(4), x.weight]), [['Avery', 'Jordan', 4], ['Jordan', 'Sam', 1], ['Avery', 'Sam', 2]]);
  const nl = await run('nodelist1.dl');
  assert.deepEqual(events(nl.ds).map(x => `${x.actor.slice(4)}>${x.targets[0][0].slice(4)}`), ['Avery>Jordan', 'Avery>Sam', 'Jordan>Riley', 'Riley>Avery']);
  const mm = await run('multi.dl');
  const by = {};
  for (const x of events(mm.ds)) by[x.context] = (by[x.context] || 0) + 1;
  assert.deepEqual(by, { 'net:multi.dl#advice': 2, 'net:multi.dl#friendship': 4 });
  assert.equal(ctx(mm.ds, 'net:multi.dl#friendship').name, 'friendship');
  const up = await run('upper.dl');
  assert.equal(up.source.directed, false);
  assert.deepEqual(events(up.ds).map(x => [x.actor.slice(4), x.targets[0][0].slice(4), x.weight]), [['a', 'b', 1], ['b', 'c', 3]]);
});

test('Gephi node + edge tables: undirected type, timestamp cells, inferred attr types', async () => {
  const { ds, source } = await run(['gephi_nodes.csv', 'gephi_edges.csv']);
  assert.equal(ds.meta.sources.length, 1);
  assert.equal(source.format, 'gephi-csv');
  assert.deepEqual(source.fileNames.sort(), ['gephi_edges.csv', 'gephi_nodes.csv']);
  assert.equal(source.directed, false);
  assert.deepEqual(node(ds, 'net:u2').attrs, { team: 'Ops', tenure: 2, remote: false });
  assert.equal(node(ds, 'net:u2').label, 'Pike, Jordan');
  assert.deepEqual(events(ds).map(e => [e.actor, e.targets[0][0], e.weight, Number.isNaN(e.t) ? null : iso(e.t)]), [
    ['net:u1', 'net:u2', 1, '2026-03-02T09:15:00.000Z'], ['net:u1', 'net:u2', 1, '2026-03-04T16:40:00.000Z'],
    ['net:u2', 'net:u3', 1.5, '2026-03-05T00:00:00.000Z'], ['net:u1', 'net:u3', 1, null]]);
  assert.match(warning(source, 'edge-attrs-dropped').message, /channel/);
});

test('adjacency matrix CSV, plain edge list CSV, headerless edge list', async () => {
  const m = await run('matrix.csv');
  assert.equal(m.source.directed, false);
  assert.deepEqual(events(m.ds).map(e => [e.actor, e.targets[0][0], e.weight]), [['net:Avery', 'net:Jordan', 1], ['net:Avery', 'net:Sam', 2]]);
  assert.equal(warning(m.source, 'self-loops').count, 1);
  const p = await run('plain_edges.csv');
  assert.equal(p.source.format, 'edgelist'); assert.equal(p.source.directed, true);
  assert.ok(warning(p.source, 'direction-assumed'));
  assert.deepEqual(events(p.ds).map(e => [e.weight, e.t]), [[3, Date.UTC(2024, 0, 5)], [1, Date.UTC(2024, 0, 6, 10)], [1, NaN]]);
  const h = await run('graph.edgelist', { edgeListDirection: 'undirected' });
  assert.equal(h.source.directed, false);
  assert.deepEqual(events(h.ds).map(e => e.weight), [3, 1, 1, 2.5]);
});

test('zipped input is read the same way', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-'));
  const zip = join(dir, 'nets.zip');
  execFileSync('python3', ['-c', `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sys.argv[2:]: z.write(f, 'export/' + f.split('/')[-1])
`, zip, F('typed.graphml'), F('nx.gml')]);
  const { ds } = await runImporter(imp, [zip]);
  assert.equal(ds.meta.sources.length, 2);
  assert.equal(ds.nodes.count, 6);
});

// Independent check: networkx reads the same files and must agree on nodes, ties and weights.
test('agrees with networkx on every fixture networkx can read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nfx-'));
  const cases = [
    ['typed.graphml', 'graphml', k => k], ['yed.graphml', 'graphml', k => k], ['static-12.gexf', 'gexf', k => k],
    // networkx 3.2.1 does not know the 1.3 namespace; read a copy declared as 1.2draft.
    // (dynamic-13.gexf is not checked: networkx 3.2.1 raises KeyError on timeformat="dateTime" spells.)
    ['interval-13.gexf', 'gexf', k => k, true],
    ['nx.gml', 'gml', k => k], ['mixed.net', 'pajek', k => k], ['undirected.net', 'pajek', k => k],
  ];
  for (const [file, kind, , as12] of cases) {
    let path = F(file);
    if (as12) {
      path = join(dir, file);
      writeFileSync(path, readFileSync(F(file), 'utf8').replace('http://gexf.net/1.3', 'http://www.gexf.net/1.2draft'));
    }
    const ref = nx(kind, path);
    const { ds, source } = await run(file);
    assert.deepEqual(ds.nodes.keys.map(k => k.slice(4)).sort(), Object.keys(ref.nodes).sort(), `${file} nodes`);
    assert.equal(source.directed, ref.directed, `${file} direction`);
    const refEdges = ref.edges.filter(([u, v]) => u !== v);
    // Pairs: networkx keeps one edge per GEXF <edge>; we may split dated edges into several events.
    const pairs = list => [...new Set(list.map(([u, v]) => (ref.directed || u < v ? `${u}>${v}` : `${v}>${u}`)))].sort();
    const ours = events(ds).map(e => [e.actor.slice(4), e.targets[0][0].slice(4), e.weight]);
    assert.deepEqual(pairs(ours), pairs(refEdges), `${file} pairs`);
    if (!as12) {
      assert.equal(ours.length, refEdges.length, `${file} edge count`);
      const sum = l => l.reduce((s, x) => s + (typeof x[2] === 'number' ? x[2] : 1), 0);
      assert.equal(sum(ours), sum(refEdges), `${file} weight sum`);
    }
    // Labels: networkx stores them as a 'label' attribute (GraphML/GEXF) or as the key (GML/Pajek).
    for (const [id, attrs] of Object.entries(ref.nodes)) {
      const n = node(ds, 'net:' + id);
      if (attrs.label) assert.equal(n.label, attrs.label[1], `${file} label of ${id}`);
      for (const [k, [ty, v]] of Object.entries(attrs)) {
        if (['label', 'id', 'x', 'y', 'shape', 'shape_type', 'viz', 'graphics'].includes(k)) continue;
        assert.equal(n.attrs[k], v, `${file} ${id}.${k}`);
        assert.equal(typeof n.attrs[k], ty === 'str' ? 'string' : ty === 'bool' ? 'boolean' : 'number', `${file} ${id}.${k} type`);
      }
    }
  }
});

test('parse errors become a warning, not a crash', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nfe-'));
  writeFileSync(join(dir, 'bad.graphml'), '<?xml version="1.0"?><graphml><graph edgedefault="directed"><node id="a"></graph></graphml>');
  const { source } = await runImporter(imp, [join(dir, 'bad.graphml')]);
  assert.match(warning(source, 'parse-error').message, /Mismatched/);
});
