// Approximations: pivot-sampled betweenness and closeness (Brandes and Pich
// 2007, the default above 3,000 people) and sampled average path length
// (500 sources above 2,000 people) against the exact values, across graph
// families and sizes, with the default number of pivots max(256, 10 sqrt n).
//
// Reported per graph: Spearman rank correlation, overlap of the top 10 and
// the top 1%, error relative to the largest exact value, and the mean signed
// error over several pivot seeds (the estimator is unbiased, so this should
// be ~0). Also checks that every approximate result is labelled.

import { computeNodeMetrics } from '../../../src/analysis/metrics.js';
import { computeNetworkMetrics } from '../../../src/analysis/network.js';
import { makeCase, toNet, tally, spearman, topKOverlap, quantiles, mean } from '../lib.mjs';

export const name = 'approx';
export const title = 'Approximations (pivot betweenness and closeness, sampled path length)';

const FAMS = [
  { family: 'er', p: null }, { family: 'ba', m: 2 }, { family: 'sbm', groups: 6 }, { family: 'smallWorld', k: 6, beta: 0.05 }, { family: 'tree' },
];

export async function run({ count = 20, seed = 1, sizes = [800, 1500, 3000, 5000], seedsPerGraph = 3, log = () => {} } = {}) {
  const t = tally(name);
  const rows = [];
  for (let g = 0; g < count; g++) {
    const f = FAMS[g % FAMS.length];
    const n = sizes[Math.floor(g / FAMS.length) % sizes.length];
    const spec = { ...f, n, directed: g % 2 === 1, weights: 'unit', seed: seed * 1000 + g };
    if (f.family === 'er') spec.p = 4 / n;
    if (f.family === 'sbm') { spec.pIn = 30 / n; spec.pOut = 1 / n; }
    const net = toNet(makeCase(spec));
    t.case();
    const t0 = Date.now();
    const exact = computeNodeMetrics(net, { which: ['betweenness', 'closeness'], approx: false });
    const tExact = Date.now() - t0;
    const k = Math.max(256, Math.round(Math.sqrt(n) * 10));
    const reps = [];
    for (let s = 0; s < seedsPerGraph; s++) {
      const t1 = Date.now();
      const a = computeNodeMetrics(net, { which: ['betweenness', 'closeness'], approx: true, seed: s + 1 });
      const tA = Date.now() - t1;
      t.cmp(a.meta.betweenness?.approximate === true && a.meta.betweenness.pivots === Math.min(k, n) && a.meta.closeness?.approximate === true, { spec, what: 'approximate result labelled', got: a.meta.betweenness });
      reps.push({ a, tA });
    }
    const one = (key) => {
      const ex = exact[key];
      const maxEx = Math.max(...ex);
      const per = reps.map(({ a }) => {
        const ap = a[key];
        let maxAbs = 0;
        for (let i = 0; i < n; i++) maxAbs = Math.max(maxAbs, Math.abs(ap[i] - ex[i]));
        return { rho: spearman(ap, ex), top10: topKOverlap(ap, ex, 10), top1pct: topKOverlap(ap, ex, Math.max(1, Math.round(n / 100))), maxErrRel: maxEx ? maxAbs / maxEx : 0 };
      });
      // Bias: average of the seeds minus exact, relative to the mean exact value.
      const avg = new Float64Array(n);
      for (const { a } of reps) for (let i = 0; i < n; i++) avg[i] += a[key][i] / reps.length;
      const mEx = mean(ex);
      return { rho: mean(per.map(p => p.rho)), top10: mean(per.map(p => p.top10)), top1pct: mean(per.map(p => p.top1pct)), maxErrRel: Math.max(...per.map(p => p.maxErrRel)), meanBiasRel: mEx ? (mean(avg) - mEx) / mEx : 0 };
    };
    const row = { family: f.family, n, directed: spec.directed, m: net.edges.count, pivots: Math.min(k, n), exactMs: tExact, approxMs: Math.round(mean(reps.map(r => r.tA))), betweenness: one('betweenness'), closeness: one('closeness') };
    // Sampled average path length (computeNetworkMetrics samples above 2,000 nodes).
    if (n > 2000) {
      const ex = computeNetworkMetrics(net, { pathSources: n });
      const sm = computeNetworkMetrics(net, {});
      t.cmp(sm.pathLengthSampled === true, { spec, what: 'sampled path length labelled', got: sm.pathLengthSampled });
      row.avgPathLength = { exact: ex.avgPathLength, sampled: sm.avgPathLength, relErr: Math.abs(sm.avgPathLength - ex.avgPathLength) / ex.avgPathLength, diameterExact: ex.diameter, diameterSampled: sm.diameter };
    }
    rows.push(row);
    log(`approx ${f.family} n=${n} rho=${row.betweenness.rho.toFixed(3)} top10=${row.betweenness.top10.toFixed(2)}`);
  }
  const agg = (key, field) => quantiles(rows.map(r => r[key][field]));
  t.stats.graphs = rows.length;
  t.stats.betweenness = { spearman: agg('betweenness', 'rho'), top10: agg('betweenness', 'top10'), top1pct: agg('betweenness', 'top1pct'), maxErrRelToMax: agg('betweenness', 'maxErrRel'), meanBiasRel: agg('betweenness', 'meanBiasRel') };
  t.stats.closeness = { spearman: agg('closeness', 'rho'), top10: agg('closeness', 'top10'), maxErrRelToMax: agg('closeness', 'maxErrRel'), meanBiasRel: agg('closeness', 'meanBiasRel') };
  const pl = rows.filter(r => r.avgPathLength);
  if (pl.length) t.stats.avgPathLengthSampledRelErr = quantiles(pl.map(r => r.avgPathLength.relErr));
  t.stats.speedup = quantiles(rows.map(r => r.exactMs / Math.max(1, r.approxMs)));
  t.stats.rows = rows;
  return t.result();
}
