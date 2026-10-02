import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatasetBuilder } from '../../src/core/model.js';
import imp from '../../src/importers/network-files.js';
import { exportGraphML } from '../../src/exporters/graphml.js';
import { exportGEXF } from '../../src/exporters/gexf.js';
import { exportGML } from '../../src/exporters/gml.js';
import { exportPajek } from '../../src/exporters/pajek.js';
import { exportUCINET } from '../../src/exporters/ucinet.js';
import { exportCSV } from '../../src/exporters/csv.js';
import { runImporter, events, node } from './helpers.js';

// networkx as the independent reader (duplicated from network-files.test.js so
// importing that file does not re-run its tests here).
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
const nx = (kind, path) => JSON.parse(execFileSync('python3', ['-c', NX_READ, kind, path], { encoding: 'utf8' }));

const dir = mkdtempSync(join(tmpdir(), 'osx-'));
const write = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };

// A small dataset with the awkward cases: non-ASCII, XML metacharacters, a
// control character, duplicate labels, typed attributes, an isolate.
function makeDataset() {
  const b = new DatasetBuilder({ name: 'export test', source: { format: 'test' } });
  const N = [
    ['x:ana', 'José Pérez', { team: 'Design', tenure: 3, score: 0.5, remote: true }],
    ['x:bei', '北京', { team: 'Ops', tenure: 10, score: 1.25, remote: false }],
    ['x:amp', 'A & B "quoted" <tag>', { team: 'Design', tenure: 1 }],
    ['x:ctl', 'ctrl\u0001char\nline', { score: 2 }],
    ['x:sam1', 'Sam', {}],
    ['x:sam2', 'Sam', {}],
    ['x:iso', 'Isolate', { team: 'Ops' }],
  ];
  for (const [k, label, attrs] of N) b.node(k, { label, attrs });
  const c = b.context('c', { name: 'c' });
  b.event({ type: 'message', t: Date.UTC(2024, 0, 5, 9), actor: 0, targets: [[1, 'dm']], context: c });
  b.event({ type: 'message', t: Date.UTC(2024, 0, 5, 17), actor: 0, targets: [[1, 'dm']], context: c });
  b.event({ type: 'message', t: Date.UTC(2024, 0, 9, 12), actor: 0, targets: [[1, 'dm']], context: c });
  b.event({ type: 'message', t: Date.UTC(2024, 1, 1), actor: 1, targets: [[2, 'mention']], context: c });
  b.event({ type: 'message', t: NaN, actor: 4, targets: [[5, 'dm']], context: c });
  return b.build();
}

function net(directed, edges, byRule) {
  const n = 7;
  return {
    n, nodeIds: Int32Array.from({ length: n }, (_, i) => i), directed,
    edges: { count: edges.length, src: Int32Array.from(edges.map(e => e[0])), dst: Int32Array.from(edges.map(e => e[1])), w: Float64Array.from(edges.map(e => e[2])), byRule },
  };
}

const ds = makeDataset();
const D_EDGES = [[0, 1, 2], [0, 1, 1], [1, 2, 1.5], [2, 3, 1], [4, 5, 3], [3, 0, 0.5]];
const directed = net(true, D_EDGES, { dm: Float64Array.from([2, 1, 0, 0, 3, 0]), mention: Float64Array.from([0, 0, 1.5, 1, 0, 0.5]) });
const undirected = net(false, [[0, 1, 2], [1, 2, 1], [4, 5, 1]]);
const opts = { nodeMetrics: { pagerank: Float64Array.from([0.3, 0.2, 0.1, 0.1, 0.1, 0.1, NaN]) }, communities: { membership: Int32Array.from([0, 0, 1, 1, 2, 2, 3]) } };
const KEYS = ds.nodes.keys;
const LABELS = ['José Pérez', '北京', 'A & B "quoted" <tag>', 'ctrlchar\nline', 'Sam', 'Sam', 'Isolate'];

function checkXmlRead(ref, { keyed = k => k } = {}) {
  assert.deepEqual(Object.keys(ref.nodes).sort(), KEYS.map(keyed).sort());
  for (let i = 0; i < KEYS.length; i++) assert.equal(ref.nodes[keyed(KEYS[i])].label[1], LABELS[i]);
  const ana = ref.nodes[keyed('x:ana')];
  assert.deepEqual(ana.team, ['str', 'Design']);
  assert.deepEqual(ana.tenure, ['int', 3]);
  assert.deepEqual(ana.score, ['float', 0.5]);
  assert.deepEqual(ana.remote, ['bool', true]);
  assert.deepEqual(ana.pagerank, ['float', 0.3]);
  assert.deepEqual(ana.community, ['int', 0]);
  assert.equal(ref.nodes[keyed('x:iso')].pagerank, undefined); // NaN omitted
}

test('GraphML export reads back in networkx and in our importer', async () => {
  const text = exportGraphML(ds, directed, opts);
  assert.ok(!/\u0001/.test(text));
  const p = write('out.graphml', text);
  const ref = nx('graphml', p);
  assert.equal(ref.directed, true); assert.equal(ref.multi, true);
  checkXmlRead(ref);
  assert.deepEqual(ref.edges.map(e => e[2]).sort(), [0.5, 1, 1, 1.5, 2, 3]);
  const { ds: back, source } = await runImporter(imp, [p]);
  assert.equal(source.directed, true);
  assert.deepEqual(back.nodes.keys, KEYS.map(k => 'net:' + k));
  assert.deepEqual(back.nodes.labels, LABELS);
  assert.deepEqual(node(back, 'net:x:ana').attrs, { team: 'Design', tenure: 3, score: 0.5, remote: true, pagerank: 0.3, community: 0 });
  assert.deepEqual(events(back).map(e => [e.actor, e.targets[0][0], e.weight]), D_EDGES.map(([a, b, w]) => ['net:' + KEYS[a], 'net:' + KEYS[b], w]));
  // rule weights are written as extra edge keys, which the importer reports as dropped
  assert.match(source.warnings.find(w => w.code === 'edge-attrs-dropped').message, /w_dm, w_mention/);
  const u = nx('graphml', write('u.graphml', exportGraphML(ds, undirected)));
  assert.equal(u.directed, false); assert.equal(u.edges.length, 3);
});

test('GEXF static export reads back in networkx and in our importer', async () => {
  const p = write('out.gexf', exportGEXF(ds, directed, opts));
  const ref = nx('gexf', p);
  assert.equal(ref.directed, true);
  checkXmlRead(ref);
  assert.deepEqual(ref.edges.map(e => e[2]).sort(), [0.5, 1, 1, 1.5, 2, 3]);
  const { ds: back } = await runImporter(imp, [p]);
  assert.deepEqual(back.nodes.labels, LABELS);
  assert.deepEqual(node(back, 'net:x:bei').attrs, { team: 'Ops', tenure: 10, score: 1.25, remote: false, pagerank: 0.2, community: 0 });
  assert.equal(events(back).length, 6);
  // the second parallel edge carries a kind, so it lands in its own relation context
  assert.equal(events(back).filter(e => e.context.endsWith('#parallel-2')).length, 1);
});

test('GEXF dynamic export: dateTime spells (own importer) and date spells (networkx)', async () => {
  const text = exportGEXF(ds, directed, { dynamic: true });
  assert.match(text, /mode="dynamic"/);
  assert.match(text, /<spell start="2024-01-05T09:00:00Z" end="2024-01-05T09:00:00Z"\/>/);
  const { ds: back } = await runImporter(imp, [write('dyn.gexf', text)]);
  const ev = events(back);
  // the first parallel edge holds the three dated ana->bei events, total weight 2 preserved
  const ab = ev.filter(e => e.actor === 'net:x:ana' && e.targets[0][0] === 'net:x:bei' && !e.context.includes('#'));
  assert.deepEqual(ab.map(e => e.t), [Date.UTC(2024, 0, 5, 9), Date.UTC(2024, 0, 5, 17), Date.UTC(2024, 0, 9, 12)]);
  assert.ok(Math.abs(ab.reduce((s, e) => s + e.weight, 0) - 2) < 1e-6);
  const byDay = write('dyn-date.gexf', exportGEXF(ds, directed, { dynamic: true, timeformat: 'date' }));
  const ref = nx('gexf', byDay);
  assert.equal(ref.edges.length, 6);
  const raw = execFileSync('python3', ['-c', `
import networkx as nx, sys, json
G = nx.read_gexf(sys.argv[1])
print(json.dumps(sorted([str(d.get('spells')) for u, v, d in G.edges(data=True) if d.get('spells')])))`, byDay], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(raw), ["[('2024-01-05', '2024-01-05'), ('2024-01-09', '2024-01-09')]", "[('2024-02-01', '2024-02-01')]"]);
});

test('GML export: ASCII only, entities, unique labels, multigraph, networkx and own read', async () => {
  const text = exportGML(ds, directed, opts);
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text), 'GML must be 7-bit ASCII');
  assert.match(text, /multigraph 1/);
  const p = write('out.gml', text);
  const ref = nx('gml', p);
  const labels = ['José Pérez', '北京', 'A & B "quoted" <tag>', 'ctrlchar line', 'Sam', 'Sam (2)', 'Isolate'];
  assert.deepEqual(Object.keys(ref.nodes).sort(), [...labels].sort());
  assert.equal(ref.directed, true); assert.equal(ref.multi, true);
  const ana = ref.nodes['José Pérez'];
  assert.deepEqual(ana.key, ['str', 'x:ana']);
  assert.deepEqual(ana.tenure, ['int', 3]);
  assert.deepEqual(ana.score, ['float', 0.5]);
  assert.deepEqual(ana.remote, ['int', 1]); // GML has no boolean
  assert.deepEqual(ana.pagerank, ['float', 0.3]);
  assert.deepEqual(ref.edges.map(e => e[2]).sort(), [0.5, 1, 1, 1.5, 2, 3]);
  const { ds: back } = await runImporter(imp, [p]);
  assert.deepEqual(back.nodes.labels, labels);
  assert.equal(node(back, 'net:Sam (2)').attrs.key, 'x:sam2');
  assert.equal(events(back).length, 6);
});

test('Pajek export: quoted unique labels survive networkx shlex and our reader', async () => {
  const p = write('out.net', exportPajek(ds, directed, opts));
  const ref = nx('pajek', p);
  const labels = ['José Pérez', '北京', 'A & B "quoted" <tag>', 'ctrl char line', 'Sam', 'Sam (2)', 'Isolate'];
  assert.deepEqual(Object.keys(ref.nodes).sort(), [...labels].sort());
  assert.equal(ref.edges.length, 6);
  assert.deepEqual(ref.edges.map(e => e[2]).sort(), [0.5, 1, 1, 1.5, 2, 3]);
  const { ds: back, source } = await runImporter(imp, [p]);
  assert.equal(source.directed, true);
  assert.deepEqual(back.nodes.labels, labels);
  assert.deepEqual(events(back).map(e => e.weight), D_EDGES.map(e => e[2]));
  const u = await runImporter(imp, [write('u.net', exportPajek(ds, undirected))]);
  assert.equal(u.source.directed, false);
});

test('UCINET DL export: sanitised labels, isolates kept, parallel edges summed, round trip', async () => {
  const text = exportUCINET(ds, directed);
  assert.match(text, /^dl n=7 format=edgelist1\nlabels:\nJose_Perez,n2,A_B_quoted_tag,ctrl_char_line,Sam,Sam_2,Isolate\nlabels embedded\ndata:\n/);
  const { ds: back, source } = await runImporter(imp, [write('out.dl', text)]);
  assert.equal(back.nodes.count, 7);
  assert.equal(source.directed, true);
  assert.deepEqual(events(back).map(e => [e.actor.slice(4), e.targets[0][0].slice(4), e.weight]),
    [['Jose_Perez', 'n2', 3], ['n2', 'A_B_quoted_tag', 1.5], ['A_B_quoted_tag', 'ctrl_char_line', 1], ['ctrl_char_line', 'Jose_Perez', 0.5], ['Sam', 'Sam_2', 3]]);
  // undirected: written both ways, read back as one undirected tie each
  const u = await runImporter(imp, [write('u.dl', exportUCINET(ds, undirected))]);
  assert.equal(u.source.directed, false);
  assert.equal(events(u.ds).length, 3);
  const fm = await runImporter(imp, [write('fm.dl', exportUCINET(ds, directed, { format: 'fullmatrix' }))]);
  assert.deepEqual(events(fm.ds).map(e => e.weight).sort(), [0.5, 1, 1.5, 3, 3]);
});

test('CSV export: Gephi node/edge tables parse with python csv and re-import with types', async () => {
  const { nodes, edges, metrics } = exportCSV(ds, directed, opts);
  const pn = write('nodes.csv', nodes), pe = write('edges.csv', edges), pm = write('metrics.csv', metrics);
  const parsed = JSON.parse(execFileSync('python3', ['-c', `
import csv, json, sys
print(json.dumps([list(csv.reader(open(p, newline='', encoding='utf-8'))) for p in sys.argv[1:]], ensure_ascii=False))`, pn, pe, pm], { encoding: 'utf8' }));
  const [n, e, m] = parsed;
  assert.deepEqual(n[0], ['Id', 'Label', 'team', 'tenure', 'score', 'remote', 'pagerank', 'community']);
  assert.deepEqual(n.slice(1).map(r => r[1]), ['José Pérez', '北京', 'A & B "quoted" <tag>', 'ctrl\u0001char\nline', 'Sam', 'Sam', 'Isolate']);
  assert.deepEqual(n[1], ['x:ana', 'José Pérez', 'Design', '3', '0.5', 'true', '0.3', '0']);
  assert.deepEqual(e[0], ['Source', 'Target', 'Type', 'Weight', 'w_dm', 'w_mention']);
  assert.deepEqual(e[1], ['x:ana', 'x:bei', 'Directed', '2', '2', '0']);
  assert.equal(e.length, 7);
  assert.deepEqual(m[0], ['Id', 'Label', 'pagerank', 'community']);
  const { ds: back, source } = await runImporter(imp, [pn, pe]);
  assert.equal(source.format, 'gephi-csv');
  assert.deepEqual(node(back, 'net:x:ana').attrs, { team: 'Design', tenure: 3, score: 0.5, remote: true, pagerank: 0.3, community: 0 });
  assert.equal(node(back, 'net:x:ctl').label, 'ctrl\u0001char\nline');
  assert.deepEqual(events(back).map(x => x.weight), D_EDGES.map(x => x[2]));
});
