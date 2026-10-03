// Invariances: what must not change (or must change in a known way) when the
// same network is presented differently.
//
//   permutation   relabel nodes at random: every node measure moves with its
//                 node, every network measure is unchanged (1e-12; float sums
//                 run in a different order).
//   edge order    shuffle the edge list and split repeated evidence: arrays are
//                 bit-identical after the canonical sort (split weights 1e-12).
//   isolates      add k isolates: local measures unchanged; betweenness,
//                 closeness, density, average clustering rescale by the
//                 documented normalisations.
//   weight scale  multiply every weight by c: weighted betweenness, eigenvector,
//                 PageRank, constraint, effective size, modularity unchanged;
//                 strength and weighted closeness scale by c.
//   unit weights  weighted path measures equal the unweighted ones.
//   symmetric     a directed network with every tie in both directions (equal
//                 weights) gives the undirected values (degree x 2).

import { networkFromEdges } from '../../../src/analysis/construct.js';
import { computeNodeMetrics, NODE_METRICS } from '../../../src/analysis/metrics.js';
import { computeNetworkMetrics } from '../../../src/analysis/network.js';
import { detectCommunities, modularity } from '../../../src/analysis/communities.js';
import { graphOf } from '../../../src/analysis/graph.js';
import { createRng } from '../../../src/analysis/rng.js';
import { caseMix, makeCase, toNet, tally, close } from '../lib.mjs';

export const name = 'invariance';
export const title = 'Invariances (relabeling, edge order, isolates, weight scale, symmetry)';

const TOL = 1e-12;
// Two independently converged power iterations agree to ~1e-9 (stopping rule
// n * 1e-12 on the L1 change), so eigenvector and PageRank compare at 1e-8.
const tolFor = (k) => (k === 'eigenvector' || k === 'pagerank' ? 1e-8 : k === 'effectiveSize' || k === 'betweennessWeighted' || k === 'closenessWeighted' ? 1e-10 : TOL);
const NETK = ['density', 'reciprocity', 'transitivity', 'avgClustering', 'isolates', 'components', 'strongComponents', 'largestComponentShare', 'avgPathLength', 'diameter', 'degreeCentralization', 'strengthGini', 'meanDegree', 'degreeAssortativity'];
const metrics = (net) => computeNodeMetrics(net, { approx: false });
const sameBits = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

export async function run({ count = 400, seed = 1, log = () => {} } = {}) {
  const t = tally(name);
  const specs = caseMix(count, seed + 7000, { maxN: 80, largeShare: 0 });
  const st = { louvainModularityChangedUnderRelabel: 0, louvainCases: 0 };
  for (const spec of specs) {
    const c = makeCase(spec);
    const n = c.n;
    const rng = createRng(`inv|${spec.seed}`);
    const net = toNet(c);
    const m = metrics(net), r = computeNetworkMetrics(net);
    const w = (what, extra = {}) => ({ spec, what, ...extra });
    t.case();

    // Permutation.
    const perm = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    const pnet = networkFromEdges(n, c.edges.map(([a, b, x]) => [perm[a], perm[b], x]), { directed: c.directed });
    const pm = metrics(pnet), pr = computeNetworkMetrics(pnet);
    for (const k of NODE_METRICS) for (let i = 0; i < n; i++) t.cmp(close(pm[k][perm[i]], m[k][i], tolFor(k)), w(`permutation ${k}`, { i, got: pm[k][perm[i]], expected: m[k][i] }));
    for (const k of NETK) if (k in r) t.cmp(close(pr[k], r[k], TOL), w(`permutation network.${k}`, { got: pr[k], expected: r[k] }));
    // Modularity of the same partition is invariant; Louvain's own result
    // depends on node order (documented: seed and order dependent).
    const com = detectCommunities(net, { seed: 1 });
    const pmem = new Int32Array(n);
    for (let i = 0; i < n; i++) pmem[perm[i]] = com.membership[i];
    const q0 = modularity(graphOf(net), com.membership), q1 = modularity(graphOf(pnet), pmem);
    t.cmp(close(q1, q0, TOL), w('permutation modularity(partition)', { got: q1, expected: q0 }));
    if (net.edges.count) { st.louvainCases++; if (!close(detectCommunities(pnet, { seed: 1 }).modularity, com.modularity, 1e-9)) st.louvainModularityChangedUnderRelabel++; }

    // Edge order (bit-identical) and split evidence.
    const shuffled = rng.shuffle(c.edges.map(e => [...e]));
    const snet = networkFromEdges(n, shuffled, { directed: c.directed });
    const sm = metrics(snet);
    // Repeated evidence for one tie is summed in input order, so with
    // duplicates the last bit of a weight may move; without them every array
    // must be bit-identical.
    const keys = new Set(c.edges.filter(([a, b]) => a !== b).map(([a, b]) => (c.directed || a < b ? a + ',' + b : b + ',' + a)));
    const simple = keys.size === c.edges.filter(([a, b]) => a !== b).length;
    for (const k of NODE_METRICS) {
      if (simple) t.cmp(sameBits(sm[k], m[k]), w(`edge order ${k} bit-identical`, { got: 'differs', expected: 'identical' }));
      else for (let i = 0; i < n; i++) t.cmp(close(sm[k][i], m[k][i], tolFor(k)), w(`edge order (duplicates) ${k}`, { i, got: sm[k][i], expected: m[k][i] }));
    }
    const split = [];
    for (const [a, b, x] of c.edges) { if (rng() < 0.5) split.push([a, b, x]); else { const f = 0.25 + rng() * 0.5; split.push([a, b, x * f], [c.directed ? a : b, c.directed ? b : a, x * (1 - f)]); } }
    const spm = metrics(networkFromEdges(n, split, { directed: c.directed }));
    for (const k of NODE_METRICS) for (let i = 0; i < n; i++) t.cmp(close(spm[k][i], m[k][i], Math.max(1e-10, tolFor(k))), w(`split evidence ${k}`, { i, got: spm[k][i], expected: m[k][i] }));

    // Isolates appended (labels n..n+k-1), then the whole graph relabelled.
    const k = 1 + rng.int(3), N = n + k;
    const iperm = rng.shuffle(Array.from({ length: N }, (_, i) => i));
    const inet = networkFromEdges(N, c.edges.map(([a, b, x]) => [iperm[a], iperm[b], x]), { directed: c.directed });
    const im = metrics(inet), ir = computeNetworkMetrics(inet);
    const bS = n > 2 ? ((n - 1) * (n - 2)) / ((N - 1) * (N - 2)) : 0, cS = n > 1 ? (n - 1) / (N - 1) : 0;
    for (const key of NODE_METRICS) {
      if (key === 'pagerank') continue; // teleport mass is spread over the new nodes too
      for (let i = 0; i < n; i++) {
        const base = m[key][i];
        const exp = key === 'betweenness' || key === 'betweennessWeighted' ? (n > 2 ? base * bS : 0) : key === 'closeness' || key === 'closenessWeighted' ? (n > 1 ? base * cS : 0) : base;
        t.cmp(close(im[key][iperm[i]], exp, tolFor(key)), w(`isolates ${key}`, { i, got: im[key][iperm[i]], expected: exp }));
      }
      for (let j = n; j < N; j++) {
        const x = im[key][iperm[j]];
        const ok = ['constraint', 'effectiveSize', 'egoDensity', 'reciprocity'].includes(key) ? Number.isNaN(x) : x === 0;
        t.cmp(ok, w(`isolate value ${key}`, { got: x, expected: 'NaN or 0' }));
      }
    }
    const isoExp = {
      transitivity: r.transitivity, avgPathLength: r.avgPathLength, diameter: r.diameter, degreeAssortativity: r.degreeAssortativity, reciprocity: r.reciprocity,
      components: r.components + k, isolates: r.isolates + k,
      density: n > 1 ? r.density * (n * (n - 1)) / (N * (N - 1)) : 0,
      avgClustering: n ? (r.avgClustering * n) / N : 0, meanDegree: n ? (r.meanDegree * n) / N : 0,
      largestComponentShare: n ? (r.largestComponentShare * n) / N : 1 / N,
    };
    for (const [key, exp] of Object.entries(isoExp)) t.cmp(close(ir[key], exp, TOL), w(`isolates network.${key}`, { got: ir[key], expected: exp }));

    // Weight scale.
    const cfac = [2, 0.37, 1000][rng.int(3)];
    const wnet = networkFromEdges(n, c.edges.map(([a, b, x]) => [a, b, x * cfac]), { directed: c.directed });
    const wm = metrics(wnet);
    for (const key of NODE_METRICS) for (let i = 0; i < n; i++) {
      const scale = ['strength', 'inStrength', 'outStrength', 'closenessWeighted'].includes(key) ? cfac : 1;
      t.cmp(close(wm[key][i], m[key][i] * scale, Math.max(1e-9, tolFor(key))), w(`weight x${cfac} ${key}`, { i, got: wm[key][i], expected: m[key][i] * scale }));
    }
    t.cmp(close(modularity(graphOf(wnet), com.membership), q0, 1e-12), w(`weight x${cfac} modularity`));

    // Unit weights: weighted path measures equal the unweighted ones.
    const unet = networkFromEdges(n, c.edges.map(([a, b]) => [a, b, 1]), { directed: c.directed });
    const um = metrics(unet);
    for (const [a, b] of [['betweennessWeighted', 'betweenness'], ['closenessWeighted', 'closeness']]) for (let i = 0; i < n; i++) {
      // Duplicate evidence sums to 2 or 3 even with unit weights; only a simple graph has all w = 1.
      if (unet.edges.w.some(x => x !== 1)) break;
      t.cmp(close(um[a][i], um[b][i], 1e-12), w(`unit weights ${a} = ${b}`, { i, got: um[a][i], expected: um[b][i] }));
    }

    // Symmetric directed = undirected.
    if (!c.directed) {
      const both = net.edges.count ? Array.from({ length: net.edges.count }, (_, e) => [net.edges.src[e], net.edges.dst[e], net.edges.w[e]]) : [];
      const dnet = networkFromEdges(n, both.flatMap(([a, b, x]) => [[a, b, x], [b, a, x]]), { directed: true });
      const dm = metrics(dnet), dr = computeNetworkMetrics(dnet);
      for (const key of ['betweenness', 'betweennessWeighted', 'closeness', 'closenessWeighted', 'pagerank', 'clustering', 'coreNumber', 'eigenvector', 'constraint', 'effectiveSize', 'egoDensity']) for (let i = 0; i < n; i++) t.cmp(close(dm[key][i], m[key][i], tolFor(key)), w(`symmetric directed ${key}`, { i, got: dm[key][i], expected: m[key][i] }));
      for (let i = 0; i < n; i++) {
        t.cmp(dm.degree[i] === 2 * m.degree[i], w('symmetric directed degree = 2 x undirected', { i, got: dm.degree[i], expected: 2 * m.degree[i] }));
        if (m.degree[i]) t.cmp(dm.reciprocity[i] === 1, w('symmetric directed reciprocity = 1', { i, got: dm.reciprocity[i] }));
      }
      for (const key of ['density', 'transitivity', 'avgClustering', 'components', 'avgPathLength', 'diameter', 'degreeCentralization']) t.cmp(close(dr[key], r[key], TOL), w(`symmetric directed network.${key}`, { got: dr[key], expected: r[key] }));
      if (net.edges.count) t.cmp(dr.reciprocity === 1, w('symmetric directed network.reciprocity = 1', { got: dr.reciprocity }));
    }
  }
  t.stats.cases = specs.length;
  t.stats.louvain = { cases: st.louvainCases, modularityChangedUnderRelabel: st.louvainModularityChangedUnderRelabel };
  t.notes.push('Louvain is seeded but visits nodes in index order, so relabelling can change the partition it finds (not a failure; the modularity of a fixed partition is invariant and checked).');
  return t.result();
}
