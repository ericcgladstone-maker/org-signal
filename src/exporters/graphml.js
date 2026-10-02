// GraphML export, plus the column helpers the other exporters share.
//
// Spec: docs/formats/network-files.md section 1. Written to open cleanly in
// networkx (read_graphml), Gephi and igraph: one directedness per file, node
// ids are the dataset node keys (unique strings), key ids equal attr.name
// where that is a plain identifier, only the basic GraphML types, UTF-8, and
// XML-illegal control characters stripped.

import { xmlEscape } from '../importers/xml.js';

// ---- shared helpers (used by gexf, gml, pajek, ucinet, csv) --------------------

// Node columns: dataset attributes (typed from attributeSchema), metrics, community.
// Returns [{ name, type: 'string'|'double'|'long'|'boolean', values: Array(n) }]
// with undefined for missing values.
export function nodeColumns(ds, net, { nodeMetrics, communities, attrs } = {}) {
  const n = net.n;
  const schema = new Map((ds.attributeSchema || []).map(s => [s.key, s]));
  const keys = attrs || (ds.attributeSchema || []).map(s => s.key);
  const cols = [];
  const taken = new Set(['id', 'label']);
  const uniq = name => { let k = name, i = 2; while (taken.has(k.toLowerCase())) k = `${name}_${i++}`; taken.add(k.toLowerCase()); return k; };
  for (const key of keys) {
    const s = schema.get(key);
    const raw = new Array(n);
    for (let i = 0; i < n; i++) raw[i] = ds.nodes.attrs[net.nodeIds[i]]?.[key];
    let type = 'string';
    const present = raw.filter(v => v !== undefined && v !== null && v !== '');
    if (!present.length) continue;
    const st = s?.type;
    if ((st === 'numeric' || st === 'ordinal' || present.every(v => typeof v === 'number')) && present.every(v => Number.isFinite(Number(v)) && String(v).trim() !== '')) {
      type = present.every(v => Number.isInteger(Number(v)) && Math.abs(Number(v)) < 2 ** 53) ? 'long' : 'double';
    } else if (st === 'boolean' || present.every(v => typeof v === 'boolean')) {
      if (present.every(v => typeof v === 'boolean' || /^(true|false|yes|no)$/i.test(String(v)))) type = 'boolean';
    }
    const values = raw.map(v => {
      if (v === undefined || v === null || v === '') return undefined;
      if (type === 'long' || type === 'double') return Number(v);
      if (type === 'boolean') return typeof v === 'boolean' ? v : /^(true|yes)$/i.test(String(v));
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
    cols.push({ name: uniq(key), source: key, type, values });
  }
  for (const [m, arr] of Object.entries(nodeMetrics || {})) {
    if (!arr) continue;
    const values = Array.from({ length: n }, (_, i) => (Number.isFinite(arr[i]) ? arr[i] : undefined));
    cols.push({ name: uniq(m), source: m, type: 'double', values });
  }
  const memb = communities ? (communities.membership || communities) : null;
  if (memb) cols.push({ name: uniq('community'), source: 'community', type: 'long', values: Array.from({ length: n }, (_, i) => (memb[i] >= 0 ? memb[i] : undefined)) });
  return cols;
}

// Plain-number text that every reader parses: no exponent surprises for integers.
export function fmtNum(x) {
  if (!Number.isFinite(x)) return x > 0 ? 'INF' : x < 0 ? '-INF' : 'NaN';
  return String(x);
}

export function nodeLabel(ds, net, i) {
  const di = net.nodeIds[i];
  return ds.nodes.labels[di] ?? ds.nodes.keys[di];
}
export function nodeKey(ds, net, i) { return ds.nodes.keys[net.nodeIds[i]]; }

// Labels made unique by suffix (" (2)", " (3)" ...), used where a reader keys nodes by label.
export function uniqueLabels(labels, clean = s => s) {
  const seen = new Map();
  const used = new Set();
  return labels.map(l => {
    let base = clean(String(l ?? '')) || 'node';
    let out = base;
    let k = seen.get(base) || 1;
    while (used.has(out)) out = `${base} (${++k})`;
    seen.set(base, k);
    used.add(out);
    return out;
  });
}

export function edgeRules(net) {
  return net.edges.byRule ? Object.keys(net.edges.byRule).filter(r => net.edges.byRule[r]) : [];
}

// ---- GraphML -----------------------------------------------------------------------

const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function exportGraphML(ds, net, opts = {}) {
  const cols = nodeColumns(ds, net, opts);
  const rules = edgeRules(net);
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">');
  const ids = new Set(['label', 'weight']);
  const keyId = (name, k) => { const id = SAFE_ID.test(name) && !ids.has(name) ? name : `d${k}`; ids.add(id); return id; };
  out.push('  <key id="label" for="node" attr.name="label" attr.type="string"/>');
  const colIds = cols.map((c, k) => keyId(c.name, k));
  cols.forEach((c, k) => out.push(`  <key id="${xmlEscape(colIds[k])}" for="node" attr.name="${xmlEscape(c.name)}" attr.type="${c.type}"/>`));
  out.push('  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>');
  const ruleIds = rules.map((r, k) => keyId(`w_${r}`, `r${k}`));
  rules.forEach((r, k) => out.push(`  <key id="${xmlEscape(ruleIds[k])}" for="edge" attr.name="w_${xmlEscape(r)}" attr.type="double"/>`));
  out.push(`  <graph id="G" edgedefault="${net.directed ? 'directed' : 'undirected'}">`);
  for (let i = 0; i < net.n; i++) {
    let s = `    <node id="${xmlEscape(nodeKey(ds, net, i))}"><data key="label">${xmlEscape(nodeLabel(ds, net, i))}</data>`;
    cols.forEach((c, k) => {
      const v = c.values[i];
      if (v === undefined) return;
      s += `<data key="${xmlEscape(colIds[k])}">${xmlEscape(c.type === 'double' || c.type === 'long' ? fmtNum(v) : String(v))}</data>`;
    });
    out.push(s + '</node>');
  }
  const E = net.edges;
  for (let e = 0; e < E.count; e++) {
    let s = `    <edge id="e${e}" source="${xmlEscape(nodeKey(ds, net, E.src[e]))}" target="${xmlEscape(nodeKey(ds, net, E.dst[e]))}"><data key="weight">${fmtNum(E.w[e])}</data>`;
    rules.forEach((r, k) => { const v = E.byRule[r][e]; if (v) s += `<data key="${xmlEscape(ruleIds[k])}">${fmtNum(v)}</data>`; });
    out.push(s + '</edge>');
  }
  out.push('  </graph>');
  out.push('</graphml>');
  return out.join('\n') + '\n';
}

export default exportGraphML;
