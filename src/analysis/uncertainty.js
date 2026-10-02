// How sure are we? Null models and bootstrap resampling.
//
// nullModel: compare an observed network statistic with the same statistic on
// degree-preserving randomisations of the network. If a "finding" (high
// reciprocity, clustering, homophily, modularity) is typical of random graphs
// with the same degrees, it is a property of the degree sequence, not of the
// organisation.
//
// resampleRanks: bootstrap over events. Resample events with replacement,
// rebuild the network with the same settings, recompute the metric and record
// each node's rank. A node "ranked first" whose interval spans 1..9 is not a
// finding.

import { makeGraph, graphOf } from './graph.js';
import { createRng } from './rng.js';
import { transitivity, overallReciprocity, degreeAssortativity } from './network.js';
import { triangles, burt, brandes } from './metrics.js';
import { modularity, detectCommunities } from './communities.js';
import { attrCodes, edgeMixing, mixingAssortativity, eiIndex } from './groups.js';
import { buildNetwork, normalizeSettings } from './construct.js';
import { computeNodeMetrics } from './metrics.js';

export const NULL_STATS = ['reciprocity', 'transitivity', 'avgClustering', 'degreeAssortativity', 'attrAssortativity', 'eiIndex', 'modularity'];

// opts: { stats, reps = 100, seed = 1, swapsPerEdge = 10, ds, attr, membership,
//         nodeStats: ['constraint', 'effectiveSize', 'betweenness'], onProgress }
export function nullModel(net, opts = {}) {
  const reps = opts.reps ?? 100;
  const rng = createRng(opts.seed ?? 1);
  const progress = opts.onProgress || (() => {});
  const g0 = graphOf(net);
  const needsAttr = (s) => s === 'attrAssortativity' || s === 'eiIndex';
  let stats = (opts.stats || NULL_STATS).filter(s => NULL_STATS.includes(s));
  if (!net.directed) stats = stats.filter(s => s !== 'reciprocity');
  const codes = opts.ds && opts.attr ? attrCodes(net, opts.ds, opts.attr) : null;
  if (!codes) stats = stats.filter(s => !needsAttr(s));
  let membership = opts.membership ? Int32Array.from(opts.membership) : null;
  if (stats.includes('modularity') && !membership) membership = detectCommunities(net, { seed: opts.seed ?? 1 }).membership;

  const statFns = {
    reciprocity: (g) => overallReciprocity(g),
    transitivity: (g) => transitivity(g),
    avgClustering: (g) => { const t = triangles(g); let s = 0; for (let i = 0; i < g.n; i++) s += t.clustering[i]; return g.n ? s / g.n : 0; },
    degreeAssortativity: (g) => degreeAssortativity(g),
    attrAssortativity: (g) => mixingAssortativity(edgeMixing(g, codes.codes, codes.values.length, false)),
    eiIndex: (g) => eiIndex(g, codes.codes),
    modularity: (g) => modularity(g, membership),
  };
  // Null graphs are compared as binary graphs: rewiring moves ties, and a
  // weighted statistic would mix the effect of structure with that of weights.
  const gBin = makeGraph(g0.n, net.edges.src, net.edges.dst, null, net.directed, net.edges.count);
  const observed = {};
  for (const s of stats) observed[s] = statFns[s](gBin);

  const nodeStats = (opts.nodeStats || []).filter(s => ['constraint', 'effectiveSize', 'betweenness'].includes(s) && !(s === 'betweenness' && g0.n > (opts.maxNodesForBetweenness ?? 1500)));
  const nodeFn = (g) => {
    const r = {};
    if (nodeStats.includes('constraint') || nodeStats.includes('effectiveSize')) { const b = burt(g); r.constraint = b.constraint; r.effectiveSize = b.effectiveSize; }
    if (nodeStats.includes('betweenness')) r.betweenness = brandes(g, {}).betweenness;
    return r;
  };
  const nodeObserved = nodeStats.length ? nodeFn(gBin) : null;
  const samples = Object.fromEntries(stats.map(s => [s, new Float64Array(reps)]));
  const nodeSum = {}, nodeSq = {}, nodeGe = {};
  for (const s of nodeStats) { nodeSum[s] = new Float64Array(g0.n); nodeSq[s] = new Float64Array(g0.n); nodeGe[s] = new Float64Array(g0.n); }

  const swaps = Math.round((opts.swapsPerEdge ?? 10) * net.edges.count);
  const rewire = createRewirer(g0.n, net.edges.src, net.edges.dst, net.directed);
  let accepted = 0;
  for (let r = 0; r < reps; r++) {
    accepted += rewire.shuffle(swaps, rng);
    const g = makeGraph(g0.n, rewire.src, rewire.dst, null, net.directed, rewire.m);
    for (const s of stats) samples[s][r] = statFns[s](g);
    if (nodeStats.length) {
      const nr = nodeFn(g);
      for (const s of nodeStats) for (let i = 0; i < g0.n; i++) {
        const x = nr[s][i];
        if (!Number.isFinite(x)) continue;
        nodeSum[s][i] += x; nodeSq[s][i] += x * x;
        if (x >= nodeObserved[s][i]) nodeGe[s][i]++;
      }
    }
    progress((r + 1) / reps, `null model ${r + 1}/${reps}`);
  }

  const res = {};
  for (const s of stats) res[s] = summarise(observed[s], samples[s]);
  const meta = { reps, seed: opts.seed ?? 1, swapsPerEdge: opts.swapsPerEdge ?? 10, acceptedSwapShare: swaps * reps ? accepted / (swaps * reps) : 0,
    model: net.directed ? 'directed edge swaps preserving every in- and out-degree' : 'double edge swaps preserving every degree', binary: true };
  if (codes) meta.attr = opts.attr;
  if (nodeStats.length) {
    res.nodes = {};
    for (const s of nodeStats) {
      const mean = new Float64Array(g0.n), sd = new Float64Array(g0.n), z = new Float64Array(g0.n), pUpper = new Float64Array(g0.n);
      for (let i = 0; i < g0.n; i++) {
        mean[i] = nodeSum[s][i] / reps;
        sd[i] = Math.sqrt(Math.max(0, nodeSq[s][i] / reps - mean[i] ** 2) * (reps / Math.max(1, reps - 1)));
        z[i] = sd[i] > 0 ? (nodeObserved[s][i] - mean[i]) / sd[i] : NaN;
        pUpper[i] = (nodeGe[s][i] + 1) / (reps + 1);
      }
      res.nodes[s] = { observed: nodeObserved[s], mean, sd, z, pUpper };
    }
  }
  res.meta = meta;
  return res;
}

function summarise(obs, xs) {
  const k = xs.length;
  let mean = 0;
  for (const x of xs) mean += x;
  mean /= k;
  let v = 0;
  for (const x of xs) v += (x - mean) ** 2;
  const sd = k > 1 ? Math.sqrt(v / (k - 1)) : 0;
  let ge = 0, le = 0, extreme = 0;
  for (const x of xs) { if (x >= obs) ge++; if (x <= obs) le++; if (Math.abs(x - mean) >= Math.abs(obs - mean)) extreme++; }
  const sorted = Float64Array.from(xs).sort();
  return {
    observed: obs, mean, sd,
    z: sd > 0 ? (obs - mean) / sd : NaN,
    p: (extreme + 1) / (k + 1),       // two-sided empirical p with the +1 correction
    pUpper: (ge + 1) / (k + 1),
    pLower: (le + 1) / (k + 1),
    lo: quantile(sorted, 0.025), hi: quantile(sorted, 0.975),
  };
}

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Degree-preserving rewiring over a mutable edge list. Rejects swaps that would
// create self-loops or duplicate ties, so the graph stays simple.
export function createRewirer(n, src0, dst0, directed) {
  const m = src0.length;
  const src = Int32Array.from(src0), dst = Int32Array.from(dst0);
  const key = (a, b) => (directed || a < b ? a * n + b : b * n + a);
  const set = new Set();
  for (let e = 0; e < m; e++) set.add(key(src[e], dst[e]));
  return {
    src, dst, m,
    shuffle(swaps, rng) {
      if (m < 2) return 0;
      let ok = 0;
      for (let s = 0; s < swaps; s++) {
        const e1 = rng.int(m), e2 = rng.int(m);
        if (e1 === e2) continue;
        const a = src[e1], b = dst[e1];
        let c = src[e2], d = dst[e2];
        if (!directed && rng() < 0.5) { const t = c; c = d; d = t; }
        // a-b, c-d  ->  a-d, c-b
        if (a === d || c === b || a === c || b === d) continue;
        const k1 = key(a, d), k2 = key(c, b);
        if (set.has(k1) || set.has(k2)) continue;
        set.delete(key(a, b)); set.delete(key(src[e2], dst[e2]));
        set.add(k1); set.add(k2);
        src[e1] = a; dst[e1] = d; src[e2] = c; dst[e2] = b;
        ok++;
      }
      return ok;
    },
  };
}

// ---- bootstrap ranks -------------------------------------------------------------

// opts: { metric = 'betweenness', reps = 50, top = 10, seed = 1, approx, limit, onProgress, nodeMetricOpts }
// Returns [{ node (dataset index), label, value, rank, lo, hi, median, topShare, approximate? }]
// ordered by observed rank.
export function resampleRanks(ds, settings, opts = {}) {
  const metric = opts.metric || 'betweenness';
  const reps = opts.reps ?? 50, top = opts.top ?? 10, seed = opts.seed ?? 1;
  const progress = opts.onProgress || (() => {});
  const s = normalizeSettings(ds, settings);
  const net = buildNetwork(ds, s);
  const n = net.n;
  const mOpts = { which: [metric], approx: opts.approx ?? 'auto', seed, ...(opts.nodeMetricOpts || {}) };
  const obsAll = computeNodeMetrics(net, mOpts);
  const observed = obsAll[metric];
  const obsRank = ranks(observed);
  const rankSamples = Array.from({ length: n }, () => new Int32Array(reps));
  const inTop = new Int32Array(n);
  const rng = createRng(seed);
  const E = ds.events.count;
  const mult = new Uint32Array(E);
  // Resample within the events that pass the filters? Resampling all events is
  // equivalent: filtered events contribute nothing either way.
  for (let r = 0; r < reps; r++) {
    mult.fill(0);
    for (let k = 0; k < E; k++) mult[rng.int(E)]++;
    const bn = buildNetwork(ds, s, { mult });
    const vals = computeNodeMetrics(bn, { ...mOpts, seed: seed + r + 1 })[metric];
    // Map onto the observed network's nodes; a node absent from the resample scores 0.
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) { const j = bn.index[net.nodeIds[i]]; x[i] = j >= 0 && Number.isFinite(vals[j]) ? vals[j] : 0; }
    const rk = ranks(x);
    for (let i = 0; i < n; i++) { rankSamples[i][r] = rk[i]; if (rk[i] <= top) inTop[i]++; }
    progress((r + 1) / reps, `resample ${r + 1}/${reps}`);
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => obsRank[a] - obsRank[b] || a - b);
  const limit = opts.limit ?? n;
  const nodes = order.slice(0, limit).map(i => {
    const sorted = Float64Array.from(rankSamples[i]).sort();
    return {
      node: net.nodeIds[i], label: ds.nodes.labels[net.nodeIds[i]], value: observed[i], rank: obsRank[i],
      lo: quantile(sorted, 0.025), hi: quantile(sorted, 0.975), median: quantile(sorted, 0.5),
      topShare: inTop[i] / reps,
    };
  });
  // Contract shape: a plain array (survives structured clone and JSON).
  if (obsAll.meta[metric]?.approximate) for (const r of nodes) r.approximate = true;
  return nodes;
}

// Competition ranking (1 = highest). Ties share the best rank; NaN ranks last.
export function ranks(x) {
  const n = x.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const xa = Number.isFinite(x[a]) ? x[a] : -Infinity, xb = Number.isFinite(x[b]) ? x[b] : -Infinity;
    return xb - xa || a - b;
  });
  const r = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    r[i] = k > 0 && x[idx[k - 1]] === x[i] ? r[idx[k - 1]] : k + 1;
  }
  return r;
}
