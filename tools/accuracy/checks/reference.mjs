// Reference agreement: every node, network, group and ego measure on random
// graphs from every family in lib.mjs against tools/accuracy/reference.py
// (networkx 3.2, exact numpy linear algebra, hand-written formulas).
//
// Tolerances: 1e-9 relative (absolute below 1) for every closed-form or
// combinatorial measure; 1e-6 for eigenvector and PageRank, which the engine
// computes by iteration (tol 1e-12 per node on the L1 change, Lanczos when
// power iteration stalls) and the reference solves exactly.

import { computeNodeMetrics, NODE_METRICS } from '../../../src/analysis/metrics.js';
import { computeNetworkMetrics } from '../../../src/analysis/network.js';
import { detectCommunities, modularity } from '../../../src/analysis/communities.js';
import { groupMetrics, egoMetrics } from '../../../src/analysis/groups.js';
import { graphOf } from '../../../src/analysis/graph.js';
import { createRng } from '../../../src/analysis/rng.js';
import { contactsOf } from '../../../src/ui/lib/measures.js';
import { caseMix, makeCase, canonicalEdges, toNet, caseAttrs, fakeDs, close, relErr, tally, pythonReferenceParallel, quantiles } from '../lib.mjs';

export const name = 'reference';
export const title = 'Reference agreement (networkx 3.2, numpy, hand-written)';

const TOL = 1e-9, TOL_ITER = 1e-6;
const NET_KEYS = ['density', 'reciprocity', 'transitivity', 'avgClustering', 'isolates', 'components', 'strongComponents', 'largestComponentShare', 'avgPathLength', 'diameter', 'degreeCentralization', 'strengthGini', 'meanDegree', 'degreeAssortativity'];

// Weighted path ties need exact arithmetic only where weights make them
// possible; continuous weights are compared in floating point.
const exactFor = (spec) => spec.weights !== 'float' && spec.weights !== 'skewed';

export function prepare(specs) {
  return specs.map((spec, id) => {
    const c = makeCase(spec);
    const net = toNet(c);
    const attrs = caseAttrs(c);
    const com = detectCommunities(net, { seed: spec.seed });
    const resolution = [0.5, 1, 1, 2][createRng(`res|${spec.seed}`).int(4)];
    return { id, spec, c, net, attrs, com, resolution };
  });
}

export function jobsFor(prepared) {
  return prepared.map(p => ({ id: p.id, n: p.c.n, directed: p.c.directed, edges: canonicalEdges(p.c), exact: exactFor(p.spec), cat: p.attrs.cat, num: p.attrs.num, membership: Array.from(p.com.membership), resolution: p.resolution }));
}

// Compare one prepared case with its reference; records into tally t.
export function compareCase(t, p, ref, stats) {
  const { spec, net, c } = p;
  const where = (what, i) => ({ spec, what, i });
  t.case();
  if (!ref || ref.error) { t.cmp(false, { ...where('python reference failed'), got: null, expected: ref?.error }); return; }
  const m = computeNodeMetrics(net, { approx: false });
  for (const k of NODE_METRICS) {
    const exp = ref.node[k] ?? (k.startsWith('in') || k.startsWith('out') ? ref.node[k.replace(/^(in|out)/, '').replace(/^./, s => s.toLowerCase())] : null);
    if (!exp) continue;
    const iter = k === 'eigenvector' || k === 'pagerank';
    let maxErr = 0;
    for (let i = 0; i < c.n; i++) {
      const got = m[k][i], e = exp[i];
      const ok = close(got, e, iter ? TOL_ITER : TOL);
      if (Number.isFinite(got) && e != null) maxErr = Math.max(maxErr, relErr(got, e));
      t.cmp(ok, { ...where(k, i), got, expected: e });
    }
    (stats.maxErr[k] ||= []).push(maxErr);
  }
  if (m.meta.eigenvector && !m.meta.eigenvector.converged) stats.eigenNotConverged = (stats.eigenNotConverged || 0) + 1;
  if (m.meta.eigenvector?.method && m.meta.eigenvector.method !== 'power') stats.eigenLanczos = (stats.eigenLanczos || 0) + 1;
  if (ref.node._eigenRatio > 0.99) stats.eigenSmallGap = (stats.eigenSmallGap || 0) + 1;
  if (ref.node._nxSinkNaN) stats.nxSinkNaN = (stats.nxSinkNaN || 0) + ref.node._nxSinkNaN;
  if (ref.node._burtCrossChecked) stats.burtCrossChecked = (stats.burtCrossChecked || 0) + 1;
  // Contacts as the People view derives them from degree and reciprocity.
  const contacts = contactsOf(m, net.directed);
  for (let i = 0; i < c.n; i++) t.cmp(contacts[i] === ref.node.contacts[i], { ...where('contacts (ui/lib/measures.js)', i), got: contacts[i], expected: ref.node.contacts[i] });

  const r = computeNetworkMetrics(net);
  for (const k of NET_KEYS) {
    if (!(k in ref.network) && !(k in r)) continue;
    if (k === 'strongComponents' && !net.directed) continue;
    t.cmp(close(r[k], ref.network[k], TOL), { ...where(`network.${k}`), got: r[k], expected: ref.network[k] });
  }
  // Communities: a partition, ids by first member, modularity as networkx.
  const g = graphOf(net);
  const mem = p.com.membership;
  let okIds = true, next = 0;
  for (let v = 0; v < c.n; v++) { if (mem[v] > next) okIds = false; if (mem[v] === next) next++; }
  t.cmp(okIds && p.com.count === next, { ...where('communities ids renumbered by first member'), got: Array.from(mem).slice(0, 20), expected: 'first-appearance order' });
  t.cmp(p.com.sizes.reduce((s, x) => s + x, 0) === c.n, { ...where('community sizes sum to n'), got: p.com.sizes, expected: c.n });
  const refQ = ref.network.modularity;
  t.cmp(close(modularity(g, mem, p.resolution), refQ, TOL), { ...where(`modularity(resolution ${p.resolution})`), got: modularity(g, mem, p.resolution), expected: refQ });
  if (p.resolution === 1) t.cmp(close(p.com.modularity, refQ, TOL), { ...where('detectCommunities().modularity'), got: p.com.modularity, expected: refQ });

  // Groups.
  if (ref.groups) {
    const ds = fakeDs(p.attrs);
    const gm = groupMetrics(net, ds, 'grp');
    const G = ref.groups;
    for (const k of ['assortativity', 'assortativityWeighted', 'eiIndex', 'eiIndexWeighted', 'withinTies', 'betweenTies', 'coverage']) {
      if (!(k in G)) continue;
      t.cmp(close(gm[k], G[k], TOL), { ...where(`groups.${k}`), got: gm[k], expected: G[k] });
    }
    if (G.groups) {
      t.cmp(JSON.stringify(gm.values) === JSON.stringify(G.values), { ...where('group value order'), got: gm.values, expected: G.values });
      G.groups.forEach((eg, gi) => {
        const gg = gm.groups[gi];
        for (const k of ['size', 'internalTies', 'externalTies', 'density', 'externalDensity', 'eiIndex']) t.cmp(close(gg?.[k], eg[k], TOL), { ...where(`group[${eg.value}].${k}`), got: gg?.[k], expected: eg[k] });
      });
    }
    const gn = groupMetrics(net, ds, 'num');
    t.cmp(close(gn.numericAssortativity, G.numericAssortativity, TOL), { ...where('numericAssortativity'), got: gn.numericAssortativity, expected: G.numericAssortativity });
    // Ego measures for a sample of people (dataset index = network index here).
    const rng = createRng(`ego|${spec.seed}`);
    for (let s = 0; G.ego && s < Math.min(c.n, 8); s++) {
      const v = rng.int(c.n);
      const e = egoMetrics(net, v, { ds, attr: 'grp' });
      const ego = G.ego[v];
      const pairs = [['size', ref.node.contacts[v]], ['density', ref.node.egoDensity[v]], ['effectiveSize', ref.node.effectiveSize[v]], ['constraint', ref.node.constraint[v]], ['strength', ref.node.strength[v]],
        ['efficiency', ref.node.contacts[v] ? ref.node.effectiveSize[v] / ref.node.contacts[v] : null],
        ['altersWithValue', ego.known], ['diversity', ego.diversity], ['diversityNormalized', ego.diversityNormalized], ['homophily', ego.homophily], ['homophilyWeighted', ego.homophilyWeighted], ['egoEI', ego.egoEI]];
      for (const [k, x] of pairs) t.cmp(close(e[k], x, TOL), { ...where(`ego.${k}`, v), got: e[k], expected: x });
    }
  }
}

export async function run({ count = 1500, seed = 1, log = () => {}, maxN, largeShare } = {}) {
  const t = tally(name);
  const specs = caseMix(count, seed, { maxN, largeShare });
  const t0 = Date.now();
  const prepared = prepare(specs);
  log(`reference: ${prepared.length} cases prepared; running python reference`);
  const refs = await pythonReferenceParallel(jobsFor(prepared));
  const tPy = Date.now();
  const stats = { maxErr: {} };
  for (const p of prepared) compareCase(t, p, refs[String(p.id)], stats);
  t.stats.seconds = { total: (Date.now() - t0) / 1000, python: (tPy - t0) / 1000 };
  t.stats.sizes = quantiles(prepared.map(p => p.c.n));
  t.stats.edges = quantiles(prepared.map(p => p.net.edges.count));
  t.stats.byFamily = Object.fromEntries([...new Set(specs.map(s => s.family))].map(f => [f, specs.filter(s => s.family === f).length]));
  t.stats.directedShare = specs.filter(s => s.directed).length / specs.length;
  t.stats.maxRelError = Object.fromEntries(Object.entries(stats.maxErr).map(([k, a]) => [k, Math.max(...a)]));
  t.stats.eigenvectorNotConverged = stats.eigenNotConverged || 0;
  t.stats.eigenvectorLanczosFallback = stats.eigenLanczos || 0;
  t.stats.eigenvectorSmallGapCases = stats.eigenSmallGap || 0;
  t.stats.networkxSinkNaN = stats.nxSinkNaN || 0;
  t.stats.burtCrossCheckedWithNetworkx = stats.burtCrossChecked || 0;
  t.notes.push('Tolerance 1e-9 (relative above 1, absolute below); eigenvector and PageRank 1e-6 against exact linear algebra.');
  return t.result();
}
