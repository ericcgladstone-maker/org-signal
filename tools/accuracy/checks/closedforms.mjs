// Closed forms: textbook values for graphs whose measures are known exactly,
// at every size from 1 to `count` (and a few large ones). Nothing here depends
// on networkx; each formula is derived in the comment beside it.

import { networkFromEdges } from '../../../src/analysis/construct.js';
import { computeNodeMetrics } from '../../../src/analysis/metrics.js';
import { computeNetworkMetrics } from '../../../src/analysis/network.js';
import { tally, close } from '../lib.mjs';

export const name = 'closedforms';
export const title = 'Closed-form values (star, path, ring, complete, bipartite, empty)';

const TOL = 1e-12;
const H = (k) => { let s = 0; for (let i = 1; i <= k; i++) s += 1 / i; return s; };
const range = (k) => Array.from({ length: k }, (_, i) => i);

// Each family: (n) -> { edges, directed, node: { metric: (i) -> value }, network: { key: value } }.
// Values that are undefined are NaN; `skip` lists what the formula does not cover at this n.
const FAMILIES = {
  // Undirected star, centre 0.
  star: (n) => {
    const leaves = n - 1;
    // PageRank: x_c = (1-a)/n + a * sum(leaves), x_l = (1-a)/n + a x_c / (n-1).
    const a = 0.85, b = (1 - a) / n;
    const xc = n > 1 ? (b + a * leaves * b) / (1 - a * a) : 1;
    const xl = n > 1 ? b + (a * xc) / leaves : 0;
    return {
      edges: range(leaves).map(i => [0, i + 1]), directed: false,
      node: {
        degree: i => (i === 0 ? leaves : 1),
        betweenness: i => (i === 0 && n > 2 ? 1 : 0),
        closeness: i => (n < 2 ? 0 : i === 0 ? 1 : (1 + (n - 2) / 2) / (n - 1)),
        eigenvector: i => (n < 2 ? 0 : i === 0 ? Math.SQRT1_2 : Math.SQRT1_2 / Math.sqrt(leaves)),
        pagerank: i => (i === 0 ? xc : xl),
        clustering: () => 0,
        coreNumber: () => (n > 1 ? 1 : 0),
        constraint: i => (n < 2 ? NaN : i === 0 ? 1 / leaves : 1),
        effectiveSize: i => (n < 2 ? NaN : i === 0 ? leaves : 1),
      },
      network: {
        density: n > 1 ? 2 / n : 0, transitivity: 0, avgClustering: 0, components: n ? 1 : 0,
        degreeCentralization: n > 2 ? 1 : 0, diameter: n > 2 ? 2 : n === 2 ? 1 : 0,
        // ordered pairs: 2(n-1) at distance 1, (n-1)(n-2) at distance 2.
        avgPathLength: n > 1 ? (2 * (n - 1)) / n : NaN,
        degreeAssortativity: n > 2 ? -1 : NaN,
        // strengths n-1 and 1 (x n-1): sum |xi - xj| over ordered pairs = 2 (n-1)(n-2).
        strengthGini: n > 1 ? (n - 2) / (2 * n) : 0,
      },
    };
  },
  // Undirected path 0 - 1 - ... - n-1.
  path: (n) => {
    const s = Math.sqrt(range(n).reduce((acc, i) => acc + Math.sin((Math.PI * (i + 1)) / (n + 1)) ** 2, 0));
    return {
      edges: range(n - 1).map(i => [i, i + 1]), directed: false,
      node: {
        // Ordered pairs (s, t) with s < i < t or t < i < s: 2 i (n-1-i).
        betweenness: i => (n > 2 ? (2 * i * (n - 1 - i)) / ((n - 1) * (n - 2)) : 0),
        closeness: i => (n > 1 ? (H(i) + H(n - 1 - i)) / (n - 1) : 0),
        // Eigenvectors of the path's adjacency: sin(pi k (i+1) / (n+1)), k = 1 leading.
        eigenvector: i => (n > 1 ? Math.sin((Math.PI * (i + 1)) / (n + 1)) / s : 0),
        clustering: () => 0,
        coreNumber: () => (n > 1 ? 1 : 0),
        // Inner nodes: two contacts not tied to each other.
        constraint: i => (n < 2 ? NaN : i === 0 || i === n - 1 ? 1 : 0.5),
        effectiveSize: i => (n < 2 ? NaN : i === 0 || i === n - 1 ? 1 : 2),
      },
      network: {
        diameter: Math.max(0, n - 1), avgPathLength: n > 1 ? (n + 1) / 3 : NaN, transitivity: 0, components: n ? 1 : 0,
        // Max degree 2 (n >= 3); the two ends fall short by 1 each.
        degreeCentralization: n > 2 ? 2 / ((n - 1) * (n - 2)) : 0,
      },
    };
  },
  // Undirected ring.
  ring: (n) => {
    if (n < 3) return null;
    // S = sum over k = 1..n-1 of the ring distance min(k, n-k). Every ordered
    // pair (s, t) puts d - 1 interior nodes on its shortest paths (split
    // evenly when two exist), so per node: (n S - n(n-1)) / n.
    let S = 0, Hs = 0;
    for (let k = 1; k < n; k++) { const d = Math.min(k, n - k); S += d; Hs += 1 / d; }
    return {
      edges: range(n).map(i => [i, (i + 1) % n]), directed: false,
      node: {
        betweenness: () => (S - (n - 1)) / ((n - 1) * (n - 2)),
        closeness: () => Hs / (n - 1),
        eigenvector: () => 1 / Math.sqrt(n), pagerank: () => 1 / n,
        clustering: () => (n === 3 ? 1 : 0), coreNumber: () => 2,
        constraint: () => (n === 3 ? 1.125 : 0.5), effectiveSize: () => (n === 3 ? 1 : 2),
      },
      network: { diameter: Math.floor(n / 2), avgPathLength: S / (n - 1), density: 2 / (n - 1), degreeCentralization: 0, strengthGini: 0, transitivity: n === 3 ? 1 : 0, degreeAssortativity: NaN },
    };
  },
  complete: (n) => ({
    edges: range(n).flatMap(a => range(n).filter(b => b > a).map(b => [a, b])), directed: false,
    node: {
      degree: () => n - 1, betweenness: () => 0, closeness: () => (n > 1 ? 1 : 0),
      eigenvector: () => (n > 1 ? 1 / Math.sqrt(n) : 0), pagerank: () => 1 / n,
      clustering: () => (n > 2 ? 1 : 0), coreNumber: () => n - 1,
      // p = 1/(n-1); indirect p_iq p_qj over n-2 third parties.
      constraint: () => (n > 1 ? (2 * n - 3) ** 2 / (n - 1) ** 3 : NaN),
      effectiveSize: () => (n > 1 ? 1 : NaN),
      egoDensity: () => (n > 2 ? 1 : NaN),
    },
    network: { density: n > 1 ? 1 : 0, transitivity: n > 2 ? 1 : 0, avgClustering: n > 2 ? 1 : 0, diameter: n > 1 ? 1 : 0, avgPathLength: n > 1 ? 1 : NaN, degreeCentralization: 0, strengthGini: 0, components: n ? 1 : 0 },
  }),
  // Complete bipartite K(a, b), a = floor(n/2).
  bipartite: (n) => {
    const a = Math.floor(n / 2), b = n - a;
    if (a < 1) return null;
    const side = i => (i < a ? 'A' : 'B');
    const z = Math.sqrt(2);
    return {
      edges: range(a).flatMap(x => range(b).map(y => [x, a + y])), directed: false,
      node: {
        // B-B ordered pairs b(b-1) each split over a middle nodes.
        betweenness: i => (n > 2 ? (side(i) === 'A' ? (b * (b - 1)) / a : (a * (a - 1)) / b) / ((n - 1) * (n - 2)) : 0),
        eigenvector: i => (side(i) === 'A' ? 1 / (z * Math.sqrt(a)) : 1 / (z * Math.sqrt(b))),
        clustering: () => 0, coreNumber: () => Math.min(a, b),
        closeness: i => (n > 1 ? (side(i) === 'A' ? b + (a - 1) / 2 : a + (b - 1) / 2) / (n - 1) : 0),
      },
      network: { density: (a * b) / ((n * (n - 1)) / 2), transitivity: 0, diameter: a > 1 || b > 1 ? 2 : 1 },
    };
  },
  empty: (n) => ({
    edges: [], directed: false,
    node: { degree: () => 0, strength: () => 0, betweenness: () => 0, closeness: () => 0, eigenvector: () => 0, pagerank: () => 1 / n, clustering: () => 0, coreNumber: () => 0, constraint: () => NaN, effectiveSize: () => NaN, egoDensity: () => NaN, reciprocity: () => NaN },
    network: { density: 0, components: n, isolates: n, largestComponentShare: n ? 1 / n : 0, avgPathLength: NaN, diameter: 0, transitivity: 0, avgClustering: 0, strengthGini: 0, degreeAssortativity: NaN, degreeCentralization: 0 },
  }),
  // Directed path 0 -> 1 -> ... -> n-1.
  dpath: (n) => ({
    edges: range(n - 1).map(i => [i, i + 1]), directed: true,
    node: {
      betweenness: i => (n > 2 ? (i * (n - 1 - i)) / ((n - 1) * (n - 2)) : 0),
      // Distances toward i: from every s < i.
      closeness: i => (n > 1 ? H(i) / (n - 1) : 0),
      reciprocity: () => (n > 1 ? 0 : NaN), inDegree: i => (i > 0 ? 1 : 0), outDegree: i => (i < n - 1 ? 1 : 0),
    },
    network: { density: n > 1 ? 1 / n : 0, reciprocity: n > 1 ? 0 : NaN, strongComponents: n, components: n ? 1 : 0, diameter: Math.max(0, n - 1),
      // ordered reachable pairs (s < t): mean of t - s.
      avgPathLength: n > 1 ? (n + 1) / 3 : NaN },
  }),
  // Directed ring.
  dring: (n) => (n < 3 ? null : {
    edges: range(n).map(i => [i, (i + 1) % n]), directed: true,
    node: {
      // sum over k = 1..n-1 of (k - 1) interior nodes, shared by n nodes.
      betweenness: () => 0.5, closeness: () => H(n - 1) / (n - 1), pagerank: () => 1 / n, reciprocity: () => 0,
    },
    network: { strongComponents: 1, reciprocity: 0, diameter: n - 1, avgPathLength: n / 2 },
  }),
  // Directed complete: every tie reciprocated.
  dcomplete: (n) => ({
    edges: range(n).flatMap(a => range(n).filter(b => b !== a).map(b => [a, b])), directed: true,
    node: { reciprocity: () => (n > 1 ? 1 : NaN), egoDensity: () => (n > 2 ? 1 : NaN), degree: () => 2 * (n - 1), pagerank: () => 1 / n, betweenness: () => 0, clustering: () => (n > 2 ? 1 : 0) },
    network: { reciprocity: n > 1 ? 1 : NaN, density: n > 1 ? 1 : 0, strongComponents: n ? 1 : 0 },
  }),
  // In-star: every leaf points to the centre 0.
  instar: (n) => ({
    edges: range(n - 1).map(i => [i + 1, 0]), directed: true,
    node: { closeness: i => (n > 1 && i === 0 ? 1 : 0), betweenness: () => 0, inDegree: i => (i === 0 ? n - 1 : 0) },
    network: { strongComponents: n, avgPathLength: n > 1 ? 1 : NaN, diameter: n > 1 ? 1 : 0 },
  }),
};

export async function run({ count = 60, extra = [100, 250, 500], log = () => {} } = {}) {
  const t = tally(name);
  const sizes = [...range(count).map(i => i + 1), ...extra];
  for (const [fam, make] of Object.entries(FAMILIES)) {
    for (const n of sizes) {
      const f = make(n);
      if (!f) continue;
      t.case();
      const net = networkFromEdges(n, f.edges, { directed: f.directed });
      const m = computeNodeMetrics(net, { approx: false });
      const r = computeNetworkMetrics(net);
      for (const [k, fn] of Object.entries(f.node)) {
        for (let i = 0; i < n; i++) {
          const exp = fn(i);
          // Eigenvector by iteration agrees to ~1e-9. Effective size sums k
          // terms (1 - redundancy) that nearly cancel on dense graphs (K250:
          // 1 - 1.4e-12), so its rounding grows with degree. Everything else
          // is exact to rounding.
          const tol = k === 'eigenvector' || k === 'pagerank' ? 1e-9 : k === 'effectiveSize' ? TOL * n : TOL;
          t.cmp(close(m[k][i], exp, tol), { family: fam, n, what: k, i, got: m[k][i], expected: exp });
        }
      }
      for (const [k, exp] of Object.entries(f.network)) t.cmp(close(r[k], exp, TOL), { family: fam, n, what: `network.${k}`, got: r[k], expected: exp });
    }
  }
  t.stats.sizes = sizes.length;
  t.stats.families = Object.keys(FAMILIES);
  return t.result();
}
