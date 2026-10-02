// Test helpers: a tiny stand-in for the analysis engine (which is written in
// parallel and must not be imported by the generator), built on graphology.

import { UndirectedGraph, louvain, betweenness } from '../../vendor/graphology.js';
import { ROLES } from '../../src/core/model.js';

// Undirected weighted network from every actor -> target pair in the dataset.
export function simpleNetwork(ds, { roles = null } = {}) {
  const g = new UndirectedGraph();
  for (let k = 0; k < ds.nodes.count; k++) if (!ds.nodes.isBot[k]) g.addNode(String(k));
  const e = ds.events;
  for (let i = 0; i < e.count; i++) {
    const a = e.actor[i];
    if (ds.nodes.isBot[a]) continue;
    for (let j = e.tOff[i]; j < e.tOff[i + 1]; j++) {
      const b = e.tgt[j];
      if (b === a || ds.nodes.isBot[b]) continue;
      if (roles && !roles.includes(ROLES[e.role[j]])) continue;
      if (!g.hasNode(String(b))) continue;
      const [x, y] = a < b ? [a, b] : [b, a];
      if (g.hasEdge(String(x), String(y))) g.updateEdgeAttribute(String(x), String(y), 'weight', w => w + 1);
      else g.addEdge(String(x), String(y), { weight: 1 });
    }
  }
  return g;
}

export function analyze(ds, { seed = 1 } = {}) {
  const g = simpleNetwork(ds);
  const membership = new Int32Array(ds.nodes.count).fill(-1);
  let s = seed >>> 0 || 1;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const comm = louvain(g, { rng, getEdgeWeight: 'weight' });
  for (const [k, c] of Object.entries(comm)) membership[+k] = c;
  const bt = betweenness(g, { getEdgeWeight: null });
  const btw = new Float64Array(ds.nodes.count);
  for (const [k, v] of Object.entries(bt)) btw[+k] = v;
  return { graph: g, membership, nodeMetrics: { betweenness: btw } };
}
