// Export -> re-import -> recompute.
//
// For random graphs (every family, both directions, every weight scheme, up to
// a few hundred nodes, with categorical and numeric attributes and isolates),
// write each export format (src/exporters), read it back with the real
// network-files importer through a FileSet, rebuild the network with the
// default settings and with the direction forced to the original, map nodes
// back (by key, else by the label the format keeps) and compare node set, tie
// set, weights, attributes and every recomputed measure.
//
// Precision: every text format writes weights with String(x), the shortest
// representation that parses back to the same float64, so the files are
// lossless. The Dataset stores event weights as Float32Array
// (src/core/model.js build()), so after re-import a weight w becomes
// Math.fround(w): exact for integers and dyadic values (int, tied, unit
// schemes), relative error up to 6e-8 for continuous weights. The comparison
// therefore uses the original graph with float32 weights as the expectation
// (tolerance 1e-9) and records the float64 drift separately.

import { DatasetBuilder } from '../../../src/core/model.js';
import { FileSet } from '../../../src/core/fileset.js';
import importer from '../../../src/importers/network-files.js';
import { networkFromEdges, buildNetwork, defaultSettings } from '../../../src/analysis/construct.js';
import { computeNodeMetrics } from '../../../src/analysis/metrics.js';
import { computeNetworkMetrics } from '../../../src/analysis/network.js';
import { groupMetrics } from '../../../src/analysis/groups.js';
import { exportGraphML } from '../../../src/exporters/graphml.js';
import { exportGEXF } from '../../../src/exporters/gexf.js';
import { exportGML } from '../../../src/exporters/gml.js';
import { exportPajek } from '../../../src/exporters/pajek.js';
import { exportUCINET, dlLabels } from '../../../src/exporters/ucinet.js';
import { exportCSV } from '../../../src/exporters/csv.js';
import { caseMix, makeCase, canonicalEdges, caseAttrs, close, relErr, tally } from '../lib.mjs';

export const name = 'roundtrip';
export const title = 'Export, re-import and recompute (GraphML, GEXF, GML, Pajek, UCINET DL, Gephi CSV)';

const NODE_KEYS = ['degree', 'inDegree', 'outDegree', 'strength', 'betweenness', 'betweennessWeighted', 'closeness', 'closenessWeighted', 'eigenvector', 'pagerank', 'clustering', 'coreNumber', 'constraint', 'effectiveSize'];
const ITERATIVE = new Set(['eigenvector', 'pagerank']);

// What each format can carry. attrs: node attributes come back; key: the
// node id is the dataset key (else the label); isolates: nodes without ties
// survive; direction: an explicit directed/undirected flag.
export const FORMATS = {
  graphml: { attrs: true, key: true, isolates: true, direction: true, files: (ds, net) => [['g.graphml', exportGraphML(ds, net)]] },
  gexf: { attrs: true, key: true, isolates: true, direction: true, files: (ds, net) => [['g.gexf', exportGEXF(ds, net)]] },
  gml: { attrs: true, key: false, isolates: true, direction: true, files: (ds, net) => [['g.gml', exportGML(ds, net)]] },
  pajek: { attrs: false, key: false, isolates: true, direction: true, files: (ds, net) => [['g.net', exportPajek(ds, net)]] },
  'dl-edgelist': { attrs: false, key: false, isolates: true, direction: false, dl: true, files: (ds, net) => [['g.dl', exportUCINET(ds, net)]] },
  'dl-fullmatrix': { attrs: false, key: false, isolates: true, direction: false, dl: true, maxN: 500, files: (ds, net) => [['g.dl', exportUCINET(ds, net, { format: 'fullmatrix' })]] },
  'csv-nodes-edges': { attrs: true, key: true, isolates: true, direction: true, files: (ds, net) => { const c = exportCSV(ds, net); return [['edges.csv', c.edges], ['nodes.csv', c.nodes]]; } },
  'csv-edges': { attrs: false, key: true, isolates: false, direction: true, labels: false, files: (ds, net) => [['edges.csv', exportCSV(ds, net).edges]] },
};

// Labels with the characters exports have to escape (XML, GML entities,
// Pajek quotes, non-ASCII), unique per node.
const AWKWARD = ['José Pérez', '北京', 'A & B "q" <t>', "O'Neil", 'tab\tname', 'Zoë'];
function labelFor(i, seed) { return (seed + i) % 7 === 0 ? `${AWKWARD[i % AWKWARD.length]} ${i}` : `P${i}`; }

export function caseDataset(c) {
  const at = caseAttrs(c);
  const n = c.n;
  const ds = {
    nodes: {
      count: n,
      keys: Array.from({ length: n }, (_, i) => `acc:${i}`),
      labels: Array.from({ length: n }, (_, i) => labelFor(i, c.spec.seed)),
      attrs: Array.from({ length: n }, (_, i) => ({ ...(at.cat[i] == null ? {} : { grp: at.cat[i] }), ...(at.num[i] == null ? {} : { num: at.num[i] }) })),
      isBot: new Uint8Array(n),
    },
    attributeSchema: [{ key: 'grp', type: 'categorical' }, { key: 'num', type: 'numeric' }],
  };
  return ds;
}

export async function importText(files, { edgeListDirection = 'directed' } = {}) {
  const fs = await FileSet.from(files.map(([p, t]) => ({ blob: new Blob([t]), path: p })));
  const builder = new DatasetBuilder({ name: 'roundtrip' });
  await importer.import(fs, { builder, options: { edgeListDirection }, progress() {}, signal: new AbortController().signal });
  return builder.build();
}

// Re-imported dataset node -> original node index, or -1.
function mapping(ds, ds2, net, fmt) {
  const byKey = new Map(ds.nodes.keys.map((k, i) => [k, i]));
  const byLabel = new Map(ds.nodes.labels.map((l, i) => [l, i]));
  const byLabelNorm = new Map(ds.nodes.labels.map((l, i) => [l.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim(), i]));
  const dl = fmt.dl ? new Map(dlLabels(ds, net).map((l, i) => [l.toUpperCase(), net.nodeIds[i]])) : null;
  return ds2.nodes.keys.map((k, j) => {
    const id = k.startsWith('net:') ? k.slice(4) : k;
    if (byKey.has(id)) return byKey.get(id);
    const lab = ds2.nodes.labels[j];
    if (dl) return dl.get(String(lab).toUpperCase()) ?? -1;
    return byLabel.get(lab) ?? byLabelNorm.get(lab) ?? -1;
  });
}

// One case through one format. Returns a list of problems (strings) and
// stats; an empty list means a lossless round trip for what the format carries.
export async function roundTrip(c, fmtName, { t = null } = {}) {
  const fmt = FORMATS[fmtName];
  const ds = caseDataset(c);
  const edges = canonicalEdges(c);
  const net = networkFromEdges(c.n, edges, { directed: c.directed });
  const problems = [], losses = [];
  const ds2 = await importText(fmt.files(ds, net));
  const s2 = defaultSettings(ds2);
  const netDefault = buildNetwork(ds2, s2);
  const net2 = buildNetwork(ds2, { ...s2, directed: c.directed });
  const map = mapping(ds, ds2, net, fmt);
  if (map.some(x => x < 0)) { problems.push(`unmapped nodes: ${ds2.nodes.labels.filter((_, j) => map[j] < 0).slice(0, 3).join(', ')}`); return { problems, losses }; }
  if (new Set(map).size !== map.length) problems.push('two re-imported nodes map to one original');

  // Node set.
  const deg = new Int32Array(c.n);
  for (const [a, b] of edges) { deg[a]++; deg[b]++; }
  const expectedNodes = fmt.isolates ? c.n : deg.filter(d => d > 0).length;
  if (ds2.nodes.count !== expectedNodes) problems.push(`node count ${ds2.nodes.count}, expected ${expectedNodes}`);
  if (!fmt.isolates && expectedNodes < c.n) losses.push('isolates');

  // Direction. DL has no flag: a symmetric matrix reads as undirected.
  if (netDefault.directed !== c.directed) {
    let symmetric = true;
    if (c.directed) {
      const w = new Map(edges.map(([a, b, x]) => [a + ',' + b, Math.fround(x)]));
      for (const [a, b, x] of edges) if (w.get(b + ',' + a) !== Math.fround(x)) { symmetric = false; break; }
    }
    // A Gephi edge table says Directed/Undirected per row: with no rows the
    // direction cannot be read (the importer's default is directed).
    if (fmtName.startsWith('csv') && !edges.length) losses.push('direction (no ties to read it from)');
    else if (fmt.direction || !symmetric) problems.push(`direction ${netDefault.directed}, expected ${c.directed}`);
    else losses.push('direction (symmetric directed graph read as undirected)');
  }

  // Ties and weights, against float32 weights (see header).
  const exp = new Map(edges.map(([a, b, w]) => [a + ',' + b, w]));
  const got = new Map();
  for (let e = 0; e < net2.edges.count; e++) {
    let a = map[net2.nodeIds[net2.edges.src[e]]], b = map[net2.nodeIds[net2.edges.dst[e]]];
    if (!c.directed && a > b) [a, b] = [b, a];
    got.set(a + ',' + b, net2.edges.w[e]);
  }
  if (got.size !== exp.size) problems.push(`ties ${got.size}, expected ${exp.size}`);
  let maxDrift = 0;
  for (const [k, w] of exp) {
    if (!got.has(k)) { problems.push(`tie ${k} missing`); break; }
    if (got.get(k) !== Math.fround(w)) { problems.push(`tie ${k} weight ${got.get(k)}, expected ${Math.fround(w)} (float32 of ${w})`); break; }
    maxDrift = Math.max(maxDrift, Math.abs(got.get(k) - w) / Math.abs(w));
  }

  // Labels.
  for (let j = 0; j < ds2.nodes.count; j++) {
    const orig = ds.nodes.labels[map[j]];
    if (fmt.dl || fmt.labels === false) continue;
    if (ds2.nodes.labels[j] !== orig) {
      const norm = orig.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
      if (ds2.nodes.labels[j] === norm || ds2.nodes.labels[j] === orig.replace(/[\r\n\t]+/g, ' ')) losses.push('label whitespace normalised');
      else problems.push(`label ${JSON.stringify(ds2.nodes.labels[j])}, expected ${JSON.stringify(orig)}`);
    }
  }

  // Attributes.
  if (fmt.attrs) {
    for (let j = 0; j < ds2.nodes.count; j++) {
      const a = ds.nodes.attrs[map[j]], b = ds2.nodes.attrs[j];
      for (const k of ['grp', 'num']) if ((a[k] ?? null) !== (b[k] ?? null)) { problems.push(`attr ${k} of ${ds.nodes.labels[map[j]]}: ${b[k]}, expected ${a[k]}`); break; }
    }
    const extra = (ds2.attributeSchema || []).map(x => x.key).filter(k => !['grp', 'num'].includes(k));
    if (extra.length) losses.push(`extra attributes: ${extra.join(',')}`);
  }

  // Measures: the re-imported network (forced direction) against the
  // original graph with float32 weights, node by node through the mapping.
  if (!fmt.isolates && expectedNodes < c.n) return { problems, losses, maxDrift };
  const expNet = networkFromEdges(c.n, edges.map(([a, b, w]) => [a, b, Math.fround(w)]), { directed: c.directed });
  const m1 = computeNodeMetrics(expNet, { which: NODE_KEYS, approx: false });
  const m2 = computeNodeMetrics(net2, { which: NODE_KEYS, approx: false });
  for (const k of NODE_KEYS) {
    const tol = ITERATIVE.has(k) ? 1e-7 : 1e-9;
    for (let v = 0; v < net2.n; v++) {
      const i = map[net2.nodeIds[v]];
      if (!close(m2[k][v], m1[k][i], tol)) { problems.push(`${k}[${ds.nodes.labels[i]}] ${m2[k][v]}, expected ${m1[k][i]}`); break; }
    }
  }
  const n1 = computeNetworkMetrics(expNet), n2 = computeNetworkMetrics(net2);
  for (const [k, v] of Object.entries(n1)) if (typeof v === 'number' && !close(n2[k], v, 1e-9)) problems.push(`network ${k} ${n2[k]}, expected ${v}`);
  if (fmt.attrs) {
    const g1 = groupMetrics(expNet, ds, 'grp'), g2 = groupMetrics(net2, ds2, 'grp');
    for (const k of ['assortativity', 'assortativityWeighted', 'eiIndex', 'eiIndexWeighted']) if (!close(g2[k], g1[k], 1e-9)) problems.push(`groups ${k} ${g2[k]}, expected ${g1[k]}`);
    const h1 = groupMetrics(expNet, ds, 'num'), h2 = groupMetrics(net2, ds2, 'num');
    if (!close(h2.numericAssortativity, h1.numericAssortativity, 1e-9)) problems.push(`numericAssortativity ${h2.numericAssortativity}, expected ${h1.numericAssortativity}`);
  }
  return { problems, losses, maxDrift };
}

export async function run({ count = 200, seed = 1, log = () => {}, formats = Object.keys(FORMATS), maxN = 150, largeN = 300 } = {}) {
  const t = tally(name);
  const specs = caseMix(count, seed, { maxN, largeN, largeShare: 0.05 });
  const per = Object.fromEntries(formats.map(f => [f, { cases: 0, passed: 0, losses: {} }]));
  let maxDrift = 0;
  const t0 = Date.now();
  for (let i = 0; i < specs.length; i++) {
    const c = makeCase(specs[i]);
    for (const f of formats) {
      if (FORMATS[f].maxN && c.n > FORMATS[f].maxN) continue;
      t.case();
      per[f].cases++;
      let r;
      try { r = await roundTrip(c, f); } catch (err) { r = { problems: [`threw: ${err.message}`], losses: [] }; }
      const ok = t.cmp(!r.problems.length, { format: f, spec: c.spec, problems: r.problems.slice(0, 5) });
      if (ok) per[f].passed++;
      for (const l of new Set(r.losses)) per[f].losses[l] = (per[f].losses[l] || 0) + 1;
      if (r.maxDrift > maxDrift) maxDrift = r.maxDrift;
    }
    if (i % 50 === 0) log(`roundtrip ${i}/${specs.length}`);
  }
  for (const f of formats) per[f].passRate = per[f].cases ? per[f].passed / per[f].cases : NaN;
  t.stats.formats = per;
  t.stats.maxFloat32WeightDrift = maxDrift;
  t.stats.seconds = (Date.now() - t0) / 1000;
  t.notes.push('Files are lossless (shortest float64 text); the Dataset stores event weights as Float32Array, so continuous weights come back as Math.fround(w) (relative drift recorded in maxFloat32WeightDrift). Measures are compared with the float32-weighted original at 1e-9 (1e-7 eigenvector, pagerank).');
  t.notes.push('Expected format losses: Pajek and UCINET DL carry no attributes; DL has no direction flag (a symmetric directed graph reads back undirected); GML, Pajek and DL key nodes by label (GML keeps the dataset key as an extra `key` attribute; GML and Pajek turn tabs and newlines in labels into spaces; DL sanitises labels); an edge-only CSV drops isolates and labels, and a Gephi CSV without ties cannot say whether it was directed.');
  return t.result();
}
