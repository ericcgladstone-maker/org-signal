// Communities: Louvain (graphology) on the symmetrised weighted graph, seeded,
// with community ids renumbered by first appearance so the same seed always
// yields the same labels. Modularity is recomputed here (Newman 2004, with
// resolution) rather than taken from Louvain so it is defined identically for
// any partition the UI or the null model hands in.

import { UndirectedGraph, louvain } from '../../vendor/graphology.js';
import { graphOf } from './graph.js';
import { createRng } from './rng.js';

export function detectCommunities(net, { resolution = 1, seed = 1 } = {}) {
  const g = graphOf(net);
  const { n } = g, U = g.und;
  const G = new UndirectedGraph();
  for (let v = 0; v < n; v++) G.addNode(v);
  for (let v = 0; v < n; v++) for (let p = U.off[v]; p < U.off[v + 1]; p++) {
    const u = U.adj[p];
    if (u > v) G.addEdge(v, u, { weight: U.w[p] });
  }
  const membership = new Int32Array(n);
  if (G.size === 0) {
    for (let v = 0; v < n; v++) membership[v] = v;
  } else {
    const res = louvain.detailed(G, { resolution, rng: createRng(seed), getEdgeWeight: 'weight' });
    const remap = new Map();
    for (let v = 0; v < n; v++) {
      const c = res.communities[v];
      if (!remap.has(c)) remap.set(c, remap.size);
      membership[v] = remap.get(c);
    }
  }
  const count = Math.max(-1, ...membership) + 1;
  const sizes = new Int32Array(count);
  for (let v = 0; v < n; v++) sizes[membership[v]]++;
  let nontrivial = 0;
  for (const s of sizes) if (s > 1) nontrivial++;
  return { membership, modularity: modularity(g, membership, resolution), count, nontrivial, sizes: Array.from(sizes), resolution, seed };
}

// Q = sum_c [ W_c / W - resolution * (S_c / 2W)^2 ] on the symmetrised weighted
// graph, W = total tie weight, W_c = weight inside c, S_c = total strength in c.
export function modularity(g, membership, resolution = 1) {
  const { n } = g, U = g.und;
  let W = 0;
  const inside = new Map(), strength = new Map();
  for (let v = 0; v < n; v++) {
    const cv = membership[v];
    for (let p = U.off[v]; p < U.off[v + 1]; p++) {
      const u = U.adj[p], x = U.w[p];
      strength.set(cv, (strength.get(cv) || 0) + x);
      if (u > v) { W += x; if (membership[u] === cv) inside.set(cv, (inside.get(cv) || 0) + x); }
    }
  }
  if (!W) return NaN;
  let Q = 0;
  for (const [c, s] of strength) Q += (inside.get(c) || 0) / W - resolution * (s / (2 * W)) ** 2;
  return Q;
}

export { graphOf };
