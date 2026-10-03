// Statistics: do the uncertainty tools say what they claim?
//
//   degrees     every null-model replicate keeps every in/out degree, stays
//               simple and keeps the tie count (replicating nullModel's own
//               chain, which is confirmed by reproducing its reported means).
//   calibration graphs drawn from the null itself (heavily rewired) should
//               give p-values that are uniform or conservative: the share
//               with p <= 0.05 at most about 5%.
//   power       planted structure (blocks, triangles, homophily) is detected.
//   bootstrap   resampleRanks intervals on simulated event data where the true
//               ranks are known: coverage of the true rank.
//   shifts      robust z and CUSUM on simulated flat series (false alarms per
//               series) and planted steps (detection within one window).
//   before/after compareBeforeAfter on stationary data: p roughly uniform.

import { nullModel, createRewirer, resampleRanks, ranks } from '../../../src/analysis/uncertainty.js';
import { transitivity, overallReciprocity } from '../../../src/analysis/network.js';
import { makeGraph } from '../../../src/analysis/graph.js';
import { networkFromEdges } from '../../../src/analysis/construct.js';
import { robustShifts, cusumShifts, compareBeforeAfter } from '../../../src/analysis/time.js';
import { createRng } from '../../../src/analysis/rng.js';
import { computeNodeMetrics } from '../../../src/analysis/metrics.js';
import { DatasetBuilder } from '../../../src/core/model.js';
import { makeCase, toNet, tally, quantiles, mean } from '../lib.mjs';

export const name = 'stats';
export const title = 'Statistics (null models, calibration, bootstrap coverage, shift detection)';

const degSeq = (n, src, dst) => {
  const o = new Int32Array(n), i = new Int32Array(n);
  for (let e = 0; e < src.length; e++) { o[src[e]]++; i[dst[e]]++; }
  return { o, i };
};

// ---- null-model degree preservation ------------------------------------------------

function degreeChecks(t, count, seed) {
  let replicates = 0;
  const fams = ['er', 'ba', 'sbm', 'star', 'complete', 'smallWorld', 'bipartite', 'multi'];
  for (let k = 0; k < count; k++) {
    const spec = { family: fams[k % fams.length], n: 10 + (k * 7) % 90, directed: k % 2 === 1, weights: 'int', seed: seed * 1000 + k };
    const net = toNet(makeCase(spec));
    const n = net.n, reps = 20, s = 1 + (k % 5);
    t.case();
    const ref = degSeq(n, net.edges.src, net.edges.dst);
    const rw = createRewirer(n, net.edges.src, net.edges.dst, net.directed);
    const rng = createRng(s);
    const swaps = Math.round(10 * net.edges.count);
    const tv = [];
    for (let r = 0; r < reps; r++) {
      rw.shuffle(swaps, rng);
      replicates++;
      const d = degSeq(n, rw.src, rw.dst);
      let ok = rw.m === net.edges.count;
      for (let v = 0; v < n && ok; v++) ok = net.directed ? d.o[v] === ref.o[v] && d.i[v] === ref.i[v] : d.o[v] + d.i[v] === ref.o[v] + ref.i[v];
      const seen = new Set();
      for (let e = 0; e < rw.m && ok; e++) {
        const a = rw.src[e], b = rw.dst[e];
        const key = net.directed || a < b ? a * n + b : b * n + a;
        ok = a !== b && !seen.has(key);
        seen.add(key);
      }
      t.cmp(ok, { spec, what: 'null replicate keeps degrees, tie count and simplicity', rep: r });
      tv.push(transitivity(makeGraph(n, rw.src, rw.dst, null, net.directed, rw.m)));
    }
    // The chain above is nullModel's own: same rng, same swaps, same order.
    const nm = nullModel(net, { stats: ['transitivity'], reps, seed: s });
    if (nm.transitivity && Number.isFinite(nm.transitivity.mean)) t.cmp(Math.abs(nm.transitivity.mean - mean(tv)) < 1e-12, { spec, what: 'replicated chain reproduces nullModel mean', got: nm.transitivity.mean, expected: mean(tv) });
  }
  return { graphs: count, replicates };
}

// ---- p-value calibration and power -------------------------------------------------

// A draw from the null: the base graph rewired with 100 swaps per tie on an
// independent stream.
function nullDraw(net, seed) {
  const rw = createRewirer(net.n, net.edges.src, net.edges.dst, net.directed);
  rw.shuffle(100 * net.edges.count, createRng(`draw|${seed}`));
  return networkFromEdges(net.n, Array.from({ length: rw.m }, (_, e) => [rw.src[e], rw.dst[e], 1]), { directed: net.directed });
}

function attrDs(n, groups, rng, planted = null) {
  return {
    nodes: { count: n, attrs: Array.from({ length: n }, (_, i) => ({ team: 'T' + (planted ? i % groups : rng.int(groups)) })), labels: [], isBot: new Uint8Array(n) },
    attributeSchema: [{ key: 'team', type: 'categorical' }],
  };
}

function calibration(t, trials, seed, reps) {
  const STATS = ['transitivity', 'avgClustering', 'degreeAssortativity', 'reciprocity', 'attrAssortativity', 'eiIndex', 'modularity'];
  const P = Object.fromEntries(STATS.map(s => [s, { p: [], pUpper: [], pLower: [], z: [] }]));
  for (let k = 0; k < trials; k++) {
    const directed = k % 2 === 1;
    const fam = ['er', 'ba', 'sbm'][k % 3];
    const spec = { family: fam, n: 40 + (k * 13) % 80, directed, weights: 'unit', seed: seed * 10000 + k, p: 0.06, m: 2, pIn: 0.25, pOut: 0.03 };
    const base = toNet(makeCase(spec));
    if (base.edges.count < 10) continue;
    const obs = nullDraw(base, spec.seed);
    const rng = createRng(`cal|${spec.seed}`);
    const ds = attrDs(obs.n, 3, rng);
    const membership = Int32Array.from({ length: obs.n }, (_, i) => i % 4);
    const r = nullModel(obs, { reps, seed: k + 1, ds, attr: 'team', membership });
    t.case();
    for (const s of STATS) if (r[s] && r[s].p != null) { P[s].p.push(r[s].p); P[s].pUpper.push(r[s].pUpper); P[s].pLower.push(r[s].pLower); P[s].z.push(r[s].z); }
  }
  const out = {};
  for (const s of STATS) {
    const ps = P[s].p;
    if (!ps.length) continue;
    const share = (a, x) => a.filter(v => v <= x + 1e-12).length / a.length;
    // KS distance of the two-sided p to Uniform(0, 1).
    const sorted = [...ps].sort((a, b) => a - b);
    let ks = 0;
    sorted.forEach((v, i) => { ks = Math.max(ks, Math.abs(v - (i + 1) / sorted.length), Math.abs(v - i / sorted.length)); });
    out[s] = { trials: ps.length, pLe05: share(ps, 0.05), pLe10: share(ps, 0.10), pUpperLe05: share(P[s].pUpper, 0.05), pLowerLe05: share(P[s].pLower, 0.05), ks, deciles: quantiles(ps, [0.1, 0.25, 0.5, 0.75, 0.9]), zMean: mean(P[s].z), zSd: Math.sqrt(mean(P[s].z.filter(Number.isFinite).map(z => z * z)) - mean(P[s].z) ** 2) };
    // Under the null P(p <= 0.05) should be <= 0.05; allow binomial noise.
    const se = Math.sqrt(0.05 * 0.95 / ps.length);
    t.cmp(out[s].pLe05 <= 0.05 + 3 * se + 0.01, { what: `calibration ${s}: share of p <= 0.05 under the null`, got: out[s].pLe05, expected: '<= 0.05' });
  }
  return out;
}

function power(t, trials, seed, reps) {
  const res = { transitivity: [], attrAssortativity: [], modularity: [], reciprocity: [] };
  for (let k = 0; k < trials; k++) {
    const n = 60 + (k * 11) % 60;
    const spec = { family: 'sbm', n, directed: false, weights: 'unit', seed: seed * 20000 + k, groups: 3, pIn: 0.3, pOut: 0.02 };
    const net = toNet(makeCase(spec));
    const ds = attrDs(n, 3, null, true);
    const membership = Int32Array.from({ length: n }, (_, i) => i % 3);
    const r = nullModel(net, { stats: ['transitivity', 'attrAssortativity', 'modularity'], reps, seed: 1, ds, attr: 'team', membership });
    for (const s of ['transitivity', 'attrAssortativity', 'modularity']) res[s].push(r[s].pUpper);
    // Directed with planted reciprocity: every tie returned with prob 0.5.
    const rng = createRng(`recip|${k}`);
    const e = [];
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b && rng() < 0.03) { e.push([a, b, 1]); if (rng() < 0.5) e.push([b, a, 1]); }
    const dn = networkFromEdges(n, e, { directed: true });
    res.reciprocity.push(nullModel(dn, { stats: ['reciprocity'], reps, seed: 1 }).reciprocity.pUpper);
    t.case();
  }
  const out = {};
  for (const [s, ps] of Object.entries(res)) {
    out[s] = { trials: ps.length, detected: ps.filter(p => p <= 0.05).length / ps.length };
    t.cmp(out[s].detected >= 0.9, { what: `power ${s} on planted structure`, got: out[s].detected, expected: '>= 0.9' });
  }
  return out;
}

// ---- bootstrap rank coverage -----------------------------------------------------

function bootstrapCoverage(t, datasets, seed, reps) {
  const cov = { strength: [], betweenness: [], degree: [] };
  const width = { strength: [], betweenness: [], degree: [] };
  const topCov = { strength: [] };
  for (let k = 0; k < datasets; k++) {
    const rng = createRng(`boot|${seed}|${k}`);
    const n = 25 + rng.int(30);
    const b = new DatasetBuilder({ name: 'boot', source: { format: 'test', view: 'full', directed: false } });
    const ps = Array.from({ length: n }, (_, i) => b.node('p:' + i, { label: 'P' + i }));
    const ch = b.context('c', { kind: 'dm', visibility: 'direct' });
    // True tie rates: a random graph, gamma-ish heterogeneous rates; strong
    // enough that almost every true tie is seen at least once.
    const rate = new Map();
    for (let a = 0; a < n; a++) for (let c = a + 1; c < n; c++) if (rng() < 0.15) rate.set(a * n + c, 2 + (-Math.log(1 - rng())) * 6);
    for (const [key, lam] of rate) {
      const a = Math.floor(key / n), c = key % n;
      // Poisson(lam) by inversion.
      let x = 0, p = Math.exp(-lam), F = p;
      const u = rng();
      while (u > F) { x++; p *= lam / x; F += p; }
      for (let r = 0; r < x; r++) { const fwd = rng() < 0.5; b.event({ actor: ps[fwd ? a : c], t: Date.UTC(2026, 0, 1) + rng.int(90) * 86400000, context: ch, targets: [[ps[fwd ? c : a], 'dm']] }); }
    }
    const ds = b.build();
    const settings = { directed: false, weighting: 'count', includeIsolates: true };
    // Truth: expected strength (sum of rates), true degree, betweenness of the true graph.
    const trueStrength = new Float64Array(n), trueDeg = new Float64Array(n);
    const tEdges = [];
    for (const [key, lam] of rate) { const a = Math.floor(key / n), c = key % n; trueStrength[a] += lam; trueStrength[c] += lam; trueDeg[a]++; trueDeg[c]++; tEdges.push([a, c, 1]); }
    const truth = { strength: ranks(trueStrength), degree: ranks(trueDeg) };
    {
      const tn = networkFromEdges(n, tEdges);
      truth.betweenness = ranks(computeBetweenness(tn));
    }
    for (const metric of ['strength', 'degree', 'betweenness']) {
      const res = resampleRanks(ds, settings, { metric, reps, seed: k + 1, approx: false });
      for (const row of res) {
        const i = row.node; // dataset index = person index here
        const tr = truth[metric][i];
        const hit = tr >= row.lo && tr <= row.hi;
        cov[metric].push(hit ? 1 : 0);
        width[metric].push(row.hi - row.lo);
        if (metric === 'strength' && tr <= 5) topCov.strength.push(hit ? 1 : 0);
      }
    }
    t.case();
  }
  const out = {};
  for (const m of Object.keys(cov)) out[m] = { nodes: cov[m].length, coverage: mean(cov[m]), medianWidth: quantiles(width[m], [0.5]).q50 };
  out.strengthTop5Coverage = mean(topCov.strength);
  return out;
}

function computeBetweenness(net) { return computeNodeMetrics(net, { which: ['betweenness'], approx: false }).betweenness; }

// ---- shift detection on simulated series ------------------------------------------

function poisson(rng, lam) {
  if (lam > 50) { const z = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); return Math.max(0, Math.round(lam + Math.sqrt(lam) * z)); }
  let x = 0, p = Math.exp(-lam), F = p;
  const u = rng();
  while (u > F) { x++; p *= lam / x; F += p; }
  return x;
}

function shiftStudy(t, series, seed) {
  const rng = createRng(`shift|${seed}`);
  const L = 26, at = 14;
  const cfg = [
    { label: 'robust 3.5 (network)', f: (x) => robustShifts(x, { threshold: 3.5, count: true }) },
    { label: 'robust 4.5 (group)', f: (x) => robustShifts(x, { threshold: 4.5, count: true }) },
    { label: 'robust 5 (node)', f: (x) => robustShifts(x, { threshold: 5, count: true }) },
    { label: 'cusum h=6 (network)', f: (x) => cusumShifts(x, { h: 6, count: true }) },
    { label: 'cusum h=12 (node)', f: (x) => cusumShifts(x, { h: 12, count: true }) },
  ];
  const out = {};
  for (const lam of [5, 30, 200]) {
    for (const c of cfg) {
      let alarms = 0, any = 0;
      const steps = { '+50%': 0, '-50%': 0, '+100%': 0 };
      for (let s = 0; s < series; s++) {
        const flat = Array.from({ length: L }, () => poisson(rng, lam));
        const r = c.f(flat);
        alarms += r.length; if (r.length) any++;
        for (const [lbl, mult] of [['+50%', 1.5], ['-50%', 0.5], ['+100%', 2]]) {
          const x = Array.from({ length: L }, (_, i) => poisson(rng, i >= at ? lam * mult : lam));
          // CUSUM's window is where the run started; robust's the first flagged window.
          if (c.f(x).some(h => Math.abs((h.detected ?? h.window) - at) <= 1 || Math.abs(h.window - at) <= 1)) steps[lbl]++;
        }
      }
      out[`${c.label} @ mean ${lam}`] = { series, falseAlarmsPerSeries: alarms / series, seriesWithAlarm: any / series, detectedWithin1: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, v / series])) };
      t.case();
    }
  }
  // The documented robust threshold should keep false alarms per flat count
  // series low (a dataset scans ~10 network series). At a mean of 5 per
  // window the Poisson right tail and the noisy 8-window median make 3.5
  // behave like z ~ 2.8 (about 0.1 alarms per 26-window series); that is
  // reported in the stats and docs/accuracy.md, not asserted.
  for (const lam of [30, 200]) {
    const r = out[`robust 3.5 (network) @ mean ${lam}`];
    t.cmp(r.falseAlarmsPerSeries <= 0.05, { what: `robust 3.5 false alarms per flat Poisson(${lam}) series`, got: r.falseAlarmsPerSeries, expected: '<= 0.05' });
  }
  return out;
}

// ---- before / after on stationary data ----------------------------------------

function beforeAfterCalibration(t, datasets, seed) {
  // Stationary event streams (every pair keeps its rate across the date), so
  // p should be uniform; every third dataset is a group chat with untargeted
  // messages, so turn-taking ties are on and every metric is rebuilt per
  // relabelling. Power: the same with every rate doubled after the date.
  const ps = { degree: [], strength: [], betweenness: [] }, adj = { degree: [], strength: [] }, powerHits = { degree: 0, strength: 0 };
  let powerN = 0;
  const make = (k, boost) => {
    const rng = createRng(`ba|${seed}|${k}`);
    const n = 30 + rng.int(30);
    const chat = k % 3 === 2;
    const b = new DatasetBuilder({ name: 'ba', source: { format: 'test', view: 'full' } });
    const people = Array.from({ length: n }, (_, i) => b.node('p:' + i));
    const ch = b.context('c', { kind: chat ? 'group_dm' : 'dm', visibility: chat ? 'group' : 'direct' });
    const t0 = Date.UTC(2026, 0, 5), span = 120 * 86400000;
    const pairs = [];
    for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) if (a !== c && rng() < 0.08) pairs.push([a, c, 0.5 + rng() * 3]);
    for (const [a, c, lam] of pairs) {
      for (const [lo, mult] of [[0, 1], [0.5, boost]]) {
        const x = poisson(rng, lam * mult);
        for (let r = 0; r < x; r++) b.event({ actor: people[a], t: t0 + Math.floor((lo + rng() * 0.5) * span), context: ch, targets: chat ? [] : [[people[c], 'dm']] });
      }
    }
    return { ds: b.build(), date: t0 + span / 2, chat };
  };
  for (let k = 0; k < datasets; k++) {
    const { ds, date, chat } = make(k, 1);
    const metrics = k % 4 === 0 ? ['degree', 'strength', 'betweenness'] : ['degree', 'strength'];
    const r = compareBeforeAfter(ds, { directed: true }, date, { metrics, reps: 499, metricReps: 99, seed: k + 1 });
    for (const m of metrics) if (r.node[m]?.p != null && Number.isFinite(r.node[m].p)) (chat && m !== 'betweenness' ? adj : ps)[m].push(r.node[m].p);
    if (k % 5 === 0) {
      const pw = make(k + 100000, 1.5);
      const rp = compareBeforeAfter(pw.ds, { directed: true }, pw.date, { metrics: ['degree', 'strength'], reps: 499, seed: k + 1 });
      powerN++;
      for (const m of ['degree', 'strength']) if (rp.node[m].p <= 0.05) powerHits[m]++;
    }
    t.case();
  }
  const out = { stationary: {}, turnTaking: {}, power: { datasets: powerN, rateIncrease: 1.5, detected: Object.fromEntries(Object.entries(powerHits).map(([m, h]) => [m, h / Math.max(1, powerN)])) } };
  const summ = (a) => ({ datasets: a.length, pLe05: a.filter(p => p <= 0.05).length / a.length, pLe10: a.filter(p => p <= 0.1).length / a.length, deciles: quantiles(a, [0.1, 0.5, 0.9]) });
  for (const [m, a] of Object.entries(ps)) if (a.length) out.stationary[m] = summ(a);
  for (const [m, a] of Object.entries(adj)) if (a.length) out.turnTaking[m] = summ(a);
  for (const [grp, o] of [['stationary', out.stationary], ['turn-taking', out.turnTaking]]) for (const [m, x] of Object.entries(o)) {
    const se = Math.sqrt(0.05 * 0.95 / x.datasets);
    t.cmp(x.pLe05 <= 0.05 + 3 * se + 0.01, { what: `before/after ${m} (${grp}): share of p <= 0.05 on stationary data`, got: x.pLe05, expected: '<= 0.05' });
  }
  return out;
}

export async function run({ count = 300, seed = 1, reps = 99, log = () => {}, parts = ['degrees', 'calibration', 'power', 'bootstrap', 'shifts', 'beforeAfter'] } = {}) {
  const t = tally(name);
  const T = {};
  const time = (k, f) => { const t0 = Date.now(); const r = f(); T[k] = (Date.now() - t0) / 1000; log(`stats ${k} ${T[k]} s`); return r; };
  if (parts.includes('degrees')) t.stats.nullDegrees = time('degrees', () => degreeChecks(t, Math.max(8, Math.round(count / 3)), seed));
  if (parts.includes('calibration')) t.stats.calibration = time('calibration', () => calibration(t, count, seed, reps));
  if (parts.includes('power')) t.stats.power = time('power', () => power(t, Math.max(10, Math.round(count / 10)), seed, reps));
  if (parts.includes('bootstrap')) t.stats.bootstrap = time('bootstrap', () => bootstrapCoverage(t, Math.max(5, Math.round(count / 6)), seed, 200));
  if (parts.includes('shifts')) t.stats.shifts = time('shifts', () => shiftStudy(t, Math.max(100, count * 3), seed));
  if (parts.includes('beforeAfter')) t.stats.beforeAfter = time('beforeAfter', () => beforeAfterCalibration(t, Math.max(20, Math.round(count / 2)), seed));
  t.stats.seconds = T;
  return t.result();
}
