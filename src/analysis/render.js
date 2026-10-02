// Node and edge arrays for the WebGL renderer, with an optional ForceAtlas2
// layout. Positions are deterministic: the starting layout comes from a seeded
// RNG (or from earlier positions of the same people, so rebuilding the network
// with different rules moves the picture as little as possible), and
// ForceAtlas2 runs a fixed number of iterations.

import { Graph, forceAtlas2 } from '../../vendor/graphology.js';
import { graphOf } from './graph.js';
import { createRng } from './rng.js';

// opts: { maxNodes = 3000, maxEdges = 30000, layout = true, iterations = 150, seed = 1,
//         previous: Map(datasetNode -> [x, y]), labels: ds.nodes.labels }
// Returns { directed, nodes: { count, ids, netIndex, strength, labels, x, y },
//   edges: { count, src, dst (render indices), w, layerMask, byRule }, truncated,
//   and flat aliases nodeIds, x, y, src, dst, w, byRule, layerMask }.
export function graphForRender(net, opts = {}) {
  const g = graphOf(net);
  const { n } = g;
  const maxNodes = opts.maxNodes ?? 3000, maxEdges = opts.maxEdges ?? 30000;
  // Keep the strongest people when the network is larger than the renderer budget.
  const strength = new Float64Array(n);
  for (let e = 0; e < net.edges.count; e++) { strength[net.edges.src[e]] += net.edges.w[e]; strength[net.edges.dst[e]] += net.edges.w[e]; }
  let keep = Array.from({ length: n }, (_, i) => i);
  if (n > maxNodes) keep = keep.sort((a, b) => strength[b] - strength[a] || a - b).slice(0, maxNodes).sort((a, b) => a - b);
  const pos = new Int32Array(n).fill(-1);
  keep.forEach((v, i) => { pos[v] = i; });
  let edges = [];
  for (let e = 0; e < net.edges.count; e++) {
    const a = pos[net.edges.src[e]], b = pos[net.edges.dst[e]];
    if (a >= 0 && b >= 0) edges.push(e);
  }
  const edgeTotal = edges.length;
  if (edges.length > maxEdges) edges = edges.sort((x, y) => net.edges.w[y] - net.edges.w[x] || x - y).slice(0, maxEdges).sort((x, y) => x - y);
  const K = keep.length;
  const out = {
    directed: net.directed,
    nodes: {
      count: K,
      ids: Int32Array.from(keep, v => net.nodeIds[v]),
      netIndex: Int32Array.from(keep),
      strength: Float32Array.from(keep, v => strength[v]),
      labels: opts.labels ? keep.map(v => opts.labels[net.nodeIds[v]]) : null,
      x: null, y: null,
    },
    edges: {
      count: edges.length,
      src: Int32Array.from(edges, e => pos[net.edges.src[e]]),
      dst: Int32Array.from(edges, e => pos[net.edges.dst[e]]),
      w: Float32Array.from(edges, e => net.edges.w[e]),
    },
    truncated: { nodes: n - K, edges: edgeTotal - edges.length },
  };
  // Per-edge evidence for colouring by rule or layer.
  out.edges.layerMask = Uint8Array.from(edges, e => net.edges.layerMask[e]);
  out.edges.byRule = Object.fromEntries(Object.entries(net.edges.byRule || {}).map(([r, a]) => [r, Float32Array.from(edges, e => a[e])]));
  if (opts.layout !== false) {
    const xy = layout(out, opts);
    out.nodes.x = xy.x; out.nodes.y = xy.y;
  }
  // Flat aliases (same arrays, no copy) for renderers that want parallel
  // arrays at the top level (src/ui/services/engine.js normaliseRender).
  Object.assign(out, { nodeIds: out.nodes.ids, x: out.nodes.x, y: out.nodes.y, src: out.edges.src, dst: out.edges.dst, w: out.edges.w, byRule: out.edges.byRule, layerMask: out.edges.layerMask });
  return out;
}

function layout(r, opts) {
  const rng = createRng(opts.seed ?? 1);
  const prev = opts.previous || null;
  const G = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false });
  const K = r.nodes.count;
  const R = Math.sqrt(K) * 10;
  for (let i = 0; i < K; i++) {
    const p = prev?.get(r.nodes.ids[i]);
    G.addNode(i, p ? { x: p[0], y: p[1] } : { x: (rng() - 0.5) * R, y: (rng() - 0.5) * R });
  }
  for (let e = 0; e < r.edges.count; e++) {
    const a = r.edges.src[e], b = r.edges.dst[e];
    if (G.hasEdge(a, b)) G.updateEdgeAttribute(a, b, 'weight', w => w + r.edges.w[e]);
    else G.addEdge(a, b, { weight: r.edges.w[e] });
  }
  if (r.edges.count) {
    const settings = { ...forceAtlas2.inferSettings(G), barnesHutOptimize: K > 1000, edgeWeightInfluence: 1 };
    forceAtlas2.assign(G, { iterations: opts.iterations ?? 150, settings, getEdgeWeight: 'weight' });
  }
  const x = new Float32Array(K), y = new Float32Array(K);
  G.forEachNode((key, a) => { x[+key] = a.x; y[+key] = a.y; });
  return { x, y };
}
