// Export column names and privacy (Networks 101 round, N1, N10, N11, N19):
// every format names rule evidence evidence_<rule>, carries a contacts column
// (and total_ties_in_out on a directed network, never a bare degree),
// numbers communities from 1, and by request leaves out contact details.
// Read back with networkx as the independent reader.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatasetBuilder } from '../../src/core/model.js';
import { buildNetwork } from '../../src/analysis/construct.js';
import { computeNodeMetrics } from '../../src/analysis/metrics.js';
import { exportGraphML, isContactAttr } from '../../src/exporters/graphml.js';
import { exportGEXF } from '../../src/exporters/gexf.js';
import { exportGML } from '../../src/exporters/gml.js';
import { exportNodesCSV, exportEdgesCSV, exportMetricsCSV } from '../../src/exporters/csv.js';

const NX = `
import networkx as nx, json, sys, csv, warnings
warnings.simplefilter('ignore')
kind, path = sys.argv[1], sys.argv[2]
if kind == 'csv':
    nodes = list(csv.DictReader(open(path + '.nodes', newline='', encoding='utf-8')))
    edges = list(csv.DictReader(open(path + '.edges', newline='', encoding='utf-8')))
    G = nx.DiGraph()
    for r in nodes: G.add_node(r['Id'], **{k: v for k, v in r.items() if k != 'Id'})
    for r in edges: G.add_edge(r['Source'], r['Target'], **{k: v for k, v in r.items() if k not in ('Source', 'Target')})
else:
    G = {'graphml': nx.read_graphml, 'gexf': nx.read_gexf, 'gml': nx.read_gml}[kind](path)
print(json.dumps({'nodes': {str(n): d for n, d in G.nodes(data=True)},
  'edgeKeys': sorted({k for _, _, d in G.edges(data=True) for k in d}),
  'edges': {f'{u}>{v}': d for u, v, d in G.edges(data=True)}}, default=str))
`;
const dir = mkdtempSync(join(tmpdir(), 'osn-'));
function nx(kind, text) {
  const p = join(dir, `g${Math.random().toString(36).slice(2)}.${kind}`);
  if (kind === 'csv') { writeFileSync(p + '.nodes', text.nodes); writeFileSync(p + '.edges', text.edges); } else writeFileSync(p, text);
  return JSON.parse(execFileSync('python3', ['-c', NX, kind, p], { encoding: 'utf8' }));
}

// Slack-like: three people, replies and mentions, one one-way tie, contact attributes.
function sample() {
  const b = new DatasetBuilder({ name: 'names' });
  b.beginSource({ format: 'slack', view: 'full' });
  const P = [['slack:U1', 'Ana', { email: 'ana@x.org', handle: 'ana', team_id: 'T1', dept: 'Design', 'Work Email': 'ana@work.org' }],
    ['slack:U2', 'Bo', { email: 'bo@x.org', handle: 'bo', team_id: 'T1', dept: 'Sales' }],
    ['slack:U3', 'Cy', { email: 'cy@x.org', handle: 'cy', team_id: 'T1', dept: 'Sales' }]];
  const ix = P.map(([k, label, attrs]) => b.node(k, { label, attrs }));
  const c = b.context('general', { name: 'general' });
  const ev = (a, t, role, n = 1) => { for (let k = 0; k < n; k++) b.event({ type: 'message', t: Date.UTC(2025, 0, 6 + k), actor: ix[a], targets: [[ix[t], role]], context: c }); };
  ev(0, 1, 'reply', 2); ev(1, 0, 'reply'); ev(1, 2, 'mention', 3); ev(2, 0, 'reply');
  return b.build();
}

const ds = sample();
const settings = { directed: true, rules: { reply: { on: true, weight: 1 }, mention: { on: true, weight: 1 } } };
const net = buildNetwork(ds, settings);
const nodeMetrics = computeNodeMetrics(net, { which: ['degree', 'inDegree', 'outDegree', 'reciprocity', 'betweenness'] });
delete nodeMetrics.meta;
const communities = { membership: Int32Array.from({ length: net.n }, (_, i) => (i === 0 ? 0 : 1)) };
const opts = { nodeMetrics, communities };
const idx = k => ds.nodes.keys.indexOf(k);
const at = k => net.index[idx(k)];

test('every format names rule evidence evidence_<rule> (networkx)', () => {
  const want = ['evidence_mention', 'evidence_reply'];
  for (const [kind, text] of [['graphml', exportGraphML(ds, net, opts)], ['gexf', exportGEXF(ds, net, opts)], ['gml', exportGML(ds, net, opts)],
    ['csv', { nodes: exportNodesCSV(ds, net, opts), edges: exportEdgesCSV(ds, net, opts) }]]) {
    const g = nx(kind, text);
    for (const k of want) assert.ok(g.edgeKeys.includes(k), `${kind} has ${k}: ${g.edgeKeys}`);
    assert.ok(!g.edgeKeys.some(k => /^w_?(reply|mention)/.test(k)), `${kind}: no w_ names`);
  }
  // The values agree: Ana replied to Bo twice.
  const gm = nx('graphml', exportGraphML(ds, net, opts));
  assert.equal(gm.edges['slack:U1>slack:U2'].evidence_reply, 2);
  const gx = nx('gexf', exportGEXF(ds, net, opts));
  assert.equal(gx.edges['slack:U1>slack:U2'].evidence_reply, 2);
});

test('contacts and total ties are exported, never a bare degree; communities from 1 (networkx)', () => {
  const g = nx('graphml', exportGraphML(ds, net, opts));
  const ana = g.nodes['slack:U1'];
  // Ana: ties with Bo (both ways) and Cy (Cy -> Ana): 2 contacts, 3 directed ties.
  assert.equal(ana.contacts, 2);
  assert.equal(ana.total_ties_in_out, 3);
  assert.equal(ana.degree, undefined);
  assert.equal(ana.community, 1);
  assert.equal(g.nodes['slack:U2'].community, 2);
  assert.equal(nodeMetrics.degree[at('slack:U1')], 3);
  const gx = nx('gexf', exportGEXF(ds, net, opts));
  assert.equal(gx.nodes['slack:U1'].contacts, 2);
  assert.equal(gx.nodes['slack:U1'].community, 1);
  const gl = nx('gml', exportGML(ds, net, opts));
  assert.equal(gl.nodes.Ana.contacts, 2);
  assert.equal(gl.nodes.Ana.total_ties_in_out, 3);
  const head = exportMetricsCSV(ds, net, opts).split('\r\n')[0].split(',');
  assert.deepEqual(head.slice(0, 3), ['Id', 'Label', 'contacts']);
  assert.ok(head.includes('total_ties_in_out') && !head.includes('degree'));
  // Undirected: contacts only (degree is the same number).
  const und = buildNetwork(ds, { ...settings, directed: false });
  const m2 = computeNodeMetrics(und, { which: ['degree'] }); delete m2.meta;
  const h2 = exportMetricsCSV(ds, und, { nodeMetrics: m2 }).split('\r\n')[0].split(',');
  assert.deepEqual(h2, ['Id', 'Label', 'contacts']);
});

test('contact details are left out on request: columns and account ids (networkx)', () => {
  assert.ok(['email', 'handle', 'team_id', 'Work Email', 'phone', 'user_id', 'website'].every(isContactAttr));
  assert.ok(!['dept', 'title', 'domain', 'name', 'tenure'].some(isContactAttr));
  const priv = { ...opts, omitContacts: true };
  for (const [kind, text] of [['graphml', exportGraphML(ds, net, priv)], ['gexf', exportGEXF(ds, net, priv)], ['gml', exportGML(ds, net, priv)],
    ['csv', { nodes: exportNodesCSV(ds, net, priv), edges: exportEdgesCSV(ds, net, priv) }]]) {
    const g = nx(kind, text);
    const all = JSON.stringify(g);
    for (const s of ['ana@x.org', 'ana@work.org', 'slack:U1', 'T1', '"handle"']) assert.ok(!all.includes(s), `${kind} leaks ${s}`);
    const one = Object.values(g.nodes).find(d => d.label === 'Ana' || d.Label === 'Ana') || g.nodes.Ana;
    assert.ok(one, `${kind}: Ana is still there`);
    assert.equal(String(one.dept), 'Design');
    assert.equal(Object.keys(g.edges).length, net.edges.count);
  }
  // Ids stay consistent between the node and edge tables.
  const nodes = exportNodesCSV(ds, net, priv), edges = exportEdgesCSV(ds, net, priv);
  const ids = new Set(nodes.split('\r\n').slice(1, -1).map(r => r.split(',')[0]));
  for (const r of edges.split('\r\n').slice(1, -1)) { const [s, t] = r.split(','); assert.ok(ids.has(s) && ids.has(t)); }
  // Without the option the keys and emails stay (files join back to the data).
  assert.match(exportGraphML(ds, net, opts), /ana@x\.org/);
});
