// Two-mode (affiliation) networks against networkx.algorithms.bipartite
// (tools/accuracy/twomode.py): random bipartite datasets built through the
// real path (DatasetBuilder + addAffiliation, with repeated evidence, weights,
// same-mode noise ties and interleaved node order) -> buildNetwork's two-mode
// view and its projections -> the engine's measures.
//
// Compared per case:
//   two-mode degree, betweenness and closeness (Borgatti-Everett
//   normalization), Latapy clustering, two-mode density, Robins-Alexander
//   clustering, average bipartite clustering: networkx bipartite.*
//   projections onto each mode, count / Newman / binary weights, and a
//   minimum shared count: weighted_projected_graph,
//   collaboration_weighted_projected_graph, projected_graph (edge lists)
//   Barber's bipartite modularity of the detected partition: hand formula
// Plus Davis's Southern Women graph exactly as networkx ships it.
//
// Tolerance 1e-9 (relative above 1, absolute below); projection edge sets
// must match exactly and their weights to 1e-12.

import { DatasetBuilder, declareTwoMode, addAffiliation, addModeNode } from '../../../src/core/model.js';
import { buildNetwork } from '../../../src/analysis/construct.js';
import { computeNodeMetrics } from '../../../src/analysis/metrics.js';
import { computeNetworkMetrics } from '../../../src/analysis/network.js';
import { detectCommunities } from '../../../src/analysis/communities.js';
import { TWO_MODE_METRICS } from '../../../src/analysis/twomode.js';
import { createRng } from '../../../src/analysis/rng.js';
import { close, relErr, tally, pythonReferenceParallel, quantiles } from '../lib.mjs';

export const name = 'twomode';
export const title = 'Two-mode networks (networkx.algorithms.bipartite)';

const TOL = 1e-9;
const FAMILIES = ['gnp', 'gnp', 'sparse', 'dense', 'complete', 'star', 'twoComponents', 'path', 'tiny', 'oneEach'];

// spec -> { n, mode[], pairs: [[actor, event]] (dataset indices), noise: [[a, b]] same-mode }
export function makeTwoModeCase(spec) {
  const r = createRng(`twomode|${spec.family}|${spec.n0}|${spec.n1}|${spec.seed}`);
  let { n0, n1 } = spec;
  const n = n0 + n1;
  // Interleave the modes so dataset order is not "all actors first".
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = r.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const mode = new Array(n);
  const actors = [], events = [];
  order.forEach((slot, k) => { if (k < n0) { mode[slot] = 0; actors.push(slot); } else { mode[slot] = 1; events.push(slot); } });
  actors.sort((a, b) => a - b); events.sort((a, b) => a - b);
  const pairs = [];
  const p = spec.p ?? 0.3;
  const add = (a, e) => pairs.push([a, e]);
  switch (spec.family) {
    case 'complete': for (const a of actors) for (const e of events) add(a, e); break;
    case 'star': if (actors.length && events.length) { for (const a of actors) add(a, events[0]); for (const e of events) add(actors[0], e); } break;
    case 'twoComponents': {
      const ha = Math.floor(actors.length / 2), he = Math.floor(events.length / 2);
      actors.forEach((a, i) => events.forEach((e, j) => { if ((i < ha) === (j < he) && r() < 0.5) add(a, e); }));
      break;
    }
    case 'path': { const L = Math.min(actors.length, events.length); for (let i = 0; i < L; i++) { add(actors[i], events[i]); if (i + 1 < actors.length) add(actors[i + 1], events[i]); } break; }
    case 'sparse': for (const a of actors) for (const e of events) if (r() < Math.min(0.5, 1.5 / Math.max(1, events.length))) add(a, e); break;
    case 'dense': for (const a of actors) for (const e of events) if (r() < 0.75) add(a, e); break;
    default: for (const a of actors) for (const e of events) if (r() < p) add(a, e);
  }
  // Same-mode ties a two-mode view must drop (a survey tie between two people, say).
  const noise = [];
  if (r() < 0.3) for (let k = 0; k < 3; k++) { const L = r() < 0.5 ? actors : events; if (L.length > 1) { const a = L[r.int(L.length)], b = L[r.int(L.length)]; if (a !== b) noise.push([a, b]); } }
  return { spec, n, mode, pairs, noise, weights: pairs.map(() => (r() < 0.6 ? 1 : 1 + r.int(4))), repeat: pairs.map(() => (r() < 0.15 ? 2 : 1)), seed: spec.seed };
}

// The dataset as an importer or hand builder would write it.
export function twoModeDataset(c) {
  const b = new DatasetBuilder({ name: 'twomode' });
  b.beginSource({ format: 'test', view: 'full', directed: false });
  declareTwoMode(b, ['People', 'Events']);
  for (let i = 0; i < c.n; i++) addModeNode(b, 'n:' + i, c.mode[i], { label: (c.mode[i] ? 'E' : 'P') + i });
  c.pairs.forEach(([a, e], k) => {
    for (let x = 0; x < c.repeat[k]; x++) addAffiliation(b, 'n:' + a, 'n:' + e, { weight: c.weights[k], t: Date.UTC(2026, 0, 1 + k) });
  });
  for (const [a, x] of c.noise) b.event({ type: 'declared', actor: a, targets: [[x, 'declared']] });
  return b.build();
}

export function caseMix(count, seed, { maxN0 = 40, maxN1 = 25, largeShare = 0.03 } = {}) {
  const r = createRng(`twomode-mix|${seed}`);
  const out = [];
  for (let i = 0; i < count; i++) {
    const family = FAMILIES[i % FAMILIES.length];
    const large = r() < largeShare;
    let n0 = large ? 100 + r.int(200) : 1 + r.int(maxN0), n1 = large ? 50 + r.int(100) : 1 + r.int(maxN1);
    if (family === 'tiny') { n0 = 1 + r.int(3); n1 = 1 + r.int(3); }
    if (family === 'oneEach') { n0 = 1 + r.int(2); n1 = 1; }
    out.push({ family, n0, n1, p: [0.05, 0.1, 0.2, 0.35, 0.6][r.int(5)], seed: seed * 100000 + i });
  }
  return out;
}

const DAVIS_ID = 'davis';

function engineSide(c, ds) {
  const net = buildNetwork(ds, { twoMode: { view: 'two-mode' } });
  const m = computeNodeMetrics(net, { approx: false });
  const nm = computeNetworkMetrics(net);
  const com = detectCommunities(net, { seed: c.seed ?? 1 });
  return { net, m, nm, com };
}

function compare(t, c, eng, ref, stats, where) {
  t.case();
  if (!ref || ref.error) { t.cmp(false, { ...where('python reference failed'), expected: ref?.error }); return; }
  const { net, m, nm, com } = eng;
  // Network order = dataset order (every node is kept, no bots).
  let identity = net.n === c.n;
  for (let v = 0; identity && v < net.n; v++) if (net.nodeIds[v] !== v) identity = false;
  t.cmp(identity, { ...where('network keeps every node in dataset order'), got: net.n, expected: c.n });
  if (!identity) return;
  t.cmp(net.edges.count === c.edgeSet.size, { ...where('two-mode view: one tie per affiliation, same-mode ties dropped'), got: net.edges.count, expected: c.edgeSet.size });
  for (const k of TWO_MODE_METRICS) {
    const exp = ref.node[k];
    if (exp == null) {   // networkx divides by zero (a mode of one node, say): the engine says NaN
      for (let v = 0; v < c.n; v++) t.cmp(!Number.isFinite(m[k]?.[v]) || k === 'twoModeDegree' || k === 'twoModeCloseness' || k === 'twoModeClustering', { ...where(`${k} undefined where networkx raises`, v), got: m[k]?.[v], expected: null });
      stats.undefinedCases[k] = (stats.undefinedCases[k] || 0) + 1;
      continue;
    }
    let maxErr = 0;
    for (let v = 0; v < c.n; v++) {
      const got = m[k][v], e = exp[v];
      if (Number.isFinite(got) && e != null) maxErr = Math.max(maxErr, relErr(got, e));
      t.cmp(close(got, e, TOL), { ...where(k, v), got, expected: e });
    }
    (stats.maxErr[k] ||= []).push(maxErr);
  }
  for (const k of ['twoModeDensity', 'robinsAlexander', 'twoModeAvgClustering']) {
    const e = ref.network[k];
    if (e == null) continue;
    t.cmp(close(nm[k], e, TOL), { ...where(`network.${k}`), got: nm[k], expected: e });
    stats.maxErr[k] = [Math.max(stats.maxErr[k]?.[0] || 0, relErr(nm[k], e))];
  }
  if (ref.barber != null || com.barberModularity != null) t.cmp(close(com.barberModularity, ref.barber, TOL), { ...where('barberModularity'), got: com.barberModularity, expected: ref.barber });
  // Every node gets a community; ids renumbered by first member.
  let next = 0, okIds = com.membership.length === c.n;
  for (let v = 0; okIds && v < c.n; v++) { if (com.membership[v] > next) okIds = false; if (com.membership[v] === next) next++; }
  t.cmp(okIds, { ...where('two-mode communities cover every node, ids by first member') });
}

function compareProjections(t, c, ds, ref, stats, where) {
  const minSharedFor = 2 + (c.seed % 2);
  for (const view of ['mode0', 'mode1']) {
    const P = ref.projections?.[view];
    if (!P) continue;
    for (const how of ['count', 'newman', 'binary']) {
      const net = buildNetwork(ds, { twoMode: { view, projection: how } });
      const got = projEdges(net);
      const exp = P[how];
      cmpEdges(t, got, exp, where(`projection ${view} ${how}`), stats);
    }
    // Minimum shared count: the count projection without its thin pairs.
    const net = buildNetwork(ds, { twoMode: { view, projection: 'count', minShared: minSharedFor } });
    cmpEdges(t, projEdges(net), P.count.filter(e => e[2] >= minSharedFor), where(`projection ${view} count, minShared ${minSharedFor}`), stats);
    // Isolates of the mode stay in the projection, other-mode nodes leave.
    const want = c.mode.filter(x => x === (view === 'mode0' ? 0 : 1)).length;
    t.cmp(net.n === want, { ...where(`projection ${view} keeps every node of its mode`), got: net.n, expected: want });
  }
}

const projEdges = (net) => Array.from({ length: net.edges.count }, (_, e) => {
  const a = net.nodeIds[net.edges.src[e]], b = net.nodeIds[net.edges.dst[e]];
  return [Math.min(a, b), Math.max(a, b), net.edges.raw[e]];
}).sort((x, y) => x[0] - y[0] || x[1] - y[1]);

function cmpEdges(t, got, exp, w, stats) {
  t.cmp(got.length === exp.length, { ...w, what: w.what + ': edge count', got: got.length, expected: exp.length });
  if (got.length !== exp.length) return;
  for (let i = 0; i < got.length; i++) {
    const ok = got[i][0] === exp[i][0] && got[i][1] === exp[i][1] && close(got[i][2], exp[i][2], 1e-12);
    if (Number.isFinite(got[i][2])) stats.projMaxErr = Math.max(stats.projMaxErr, relErr(got[i][2], exp[i][2]));
    t.cmp(ok, { ...w, i, got: got[i], expected: exp[i] });
  }
}

const edgeSetOf = (c) => new Set(c.pairs.map(([a, e]) => Math.min(a, e) + ',' + Math.max(a, e)));

// Davis Southern Women as networkx has it, built through addAffiliation.
export function davisCase(ref) {
  const n = ref.names.length;
  const c = { spec: { family: 'davis', seed: 1 }, n, mode: ref.mode, pairs: ref.edges.map(([a, b]) => (ref.mode[a] === 0 ? [a, b] : [b, a])), noise: [], seed: 1 };
  c.weights = c.pairs.map(() => 1); c.repeat = c.pairs.map(() => 1);
  c.edgeSet = edgeSetOf(c);
  return c;
}

export async function run({ count = 1000, seed = 1, log = () => {}, maxN0, maxN1, largeShare } = {}) {
  const t = tally(name);
  const specs = caseMix(count, seed, { maxN0, maxN1, largeShare });
  const t0 = Date.now();
  const cases = specs.map((spec, id) => {
    const c = makeTwoModeCase(spec);
    c.id = id; c.edgeSet = edgeSetOf(c);
    const ds = twoModeDataset(c);
    return { c, ds, eng: engineSide(c, ds) };
  });
  log(`twomode: ${cases.length} cases built; running python reference`);
  const jobs = cases.map(({ c, eng }) => ({ id: c.id, n: c.n, mode: c.mode, edges: [...c.edgeSet].map(k => k.split(',').map(Number)), membership: Array.from(eng.com.membership) }));
  // Davis: python first returns the graph, then scores the engine's partition.
  const davis0 = (await pythonReferenceParallel([{ id: DAVIS_ID, davis: true }], { script: 'twomode.py' }))[DAVIS_ID];
  const dc = davisCase(davis0);
  const dds = twoModeDataset(dc);
  const deng = engineSide(dc, dds);
  jobs.push({ id: DAVIS_ID, davis: true, membership: Array.from(deng.com.membership) });
  const refs = await pythonReferenceParallel(jobs, { script: 'twomode.py' });
  const tPy = Date.now();
  const stats = { maxErr: {}, undefinedCases: {}, projMaxErr: 0 };
  for (const { c, ds, eng } of cases) {
    const where = (what, i) => ({ spec: c.spec, what, i });
    compare(t, c, eng, refs[String(c.id)], stats, where);
    compareProjections(t, c, ds, refs[String(c.id)], stats, where);
  }
  const dwhere = (what, i) => ({ spec: { family: 'davis' }, what, i, name: i != null ? davis0.names[i] : undefined });
  compare(t, dc, deng, refs[DAVIS_ID], stats, dwhere);
  compareProjections(t, dc, dds, refs[DAVIS_ID], stats, dwhere);
  // A few headline Davis numbers for docs/accuracy.md.
  const ix = (nm) => davis0.names.indexOf(nm);
  t.stats.davis = {
    women: dc.mode.filter(x => x === 0).length, events: dc.mode.filter(x => x === 1).length, ties: deng.net.edges.count,
    twoModeDensity: deng.nm.twoModeDensity, robinsAlexander: deng.nm.robinsAlexander,
    evelynDegree: deng.m.twoModeDegree[ix('Evelyn Jefferson')], evelynBetweenness: deng.m.twoModeBetweenness[ix('Evelyn Jefferson')], evelynCloseness: deng.m.twoModeCloseness[ix('Evelyn Jefferson')],
    e8Degree: deng.m.twoModeDegree[ix('E8')], communities: deng.com.count, barberModularity: deng.com.barberModularity,
  };
  t.stats.seconds = { total: (Date.now() - t0) / 1000, python: (tPy - t0) / 1000 };
  t.stats.actors = quantiles(specs.map(s => s.n0));
  t.stats.events = quantiles(specs.map(s => s.n1));
  t.stats.ties = quantiles(cases.map(x => x.eng.net.edges.count));
  t.stats.byFamily = Object.fromEntries(FAMILIES.map(f => [f, specs.filter(s => s.family === f).length]));
  t.stats.maxRelError = Object.fromEntries(Object.entries(stats.maxErr).map(([k, a]) => [k, Math.max(...a)]));
  t.stats.projectionMaxRelError = stats.projMaxErr;
  t.stats.networkxUndefined = stats.undefinedCases;
  t.notes.push('Tolerance 1e-9 (relative above 1, absolute below) for measures; projection edge sets exact, weights 1e-12.');
  t.notes.push('Where networkx divides by zero (two-mode betweenness when a mode has one node and the other one or none), the engine returns NaN; counted under networkxUndefined.');
  return t.result();
}
