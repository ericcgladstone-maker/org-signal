// Consistency across entry points and runs.
//
//   engine        createEngine({ worker: false }) and the worker path (the real
//                 worker-side code behind structured clone, as
//                 test/analysis/engine.test.js does) return exactly what the
//                 pure functions return, method by method.
//   determinism   every seeded step gives identical output for the same seed;
//                 how much it varies across seeds is measured.
//   one window    a time series with a single window spanning the data equals
//                 the network of the dated events with includeIsolates off
//                 (what a window is), measure by measure.
//   additivity    with counts and no turn-taking, strength summed over windows
//                 equals strength of the whole period; activity sums to the
//                 dated events.

import { isDeepStrictEqual } from 'node:util';
import { createEngine, attachWorker } from '../../../src/analysis/engine.js';
import * as A from '../../../src/analysis/index.js';
import { NODE_METRICS } from '../../../src/analysis/metrics.js';
import { generate } from '../../../src/generator/index.js';
import { makeCase, toNet, tally, close, quantiles } from '../lib.mjs';

export const name = 'consistency';
export const title = 'Consistency (engine vs pure functions, determinism, time windows)';

function fakeWorkerFactory() {
  return () => {
    let dead = false;
    const w = { onmessage: null, onerror: null };
    const scope = { onmessage: null, postMessage(msg) { const data = structuredClone(msg); setImmediate(() => { if (!dead) w.onmessage?.({ data }); }); } };
    attachWorker(scope);
    w.postMessage = (msg, transfer = []) => { const data = structuredClone(msg, { transfer }); setImmediate(() => { if (!dead) scope.onmessage({ data }); }); };
    w.terminate = () => { dead = true; };
    return w;
  };
}

// Structured clone turns some shapes (Sets, functions) into others; compare
// what a caller of the worker sees with what the pure function returned after
// the same clone.
const same = (a, b) => isDeepStrictEqual(structuredClone(a), structuredClone(b));

const SPECS = [
  { context: 'workplace', medium: 'slack', structure: 'distributed', size: 40, content: 'light' },
  { context: 'personal', medium: 'whatsapp', structure: 'close-knit', size: 30, content: 'light' },
  { context: 'online', medium: 'x', structure: 'polarized', size: 60, content: 'light' },
  { context: 'workplace', medium: 'email', structure: 'siloed', size: 40, content: 'light' },
  { context: 'survey', medium: 'survey', structure: 'classroom', content: 'none' },
];

async function engineVsPure(t, ds, label) {
  for (const mode of ['inline', 'worker']) {
    const engine = mode === 'inline' ? createEngine({ worker: false }) : createEngine({ workerFactory: fakeWorkerFactory() });
    await engine.load(ds);
    const s0 = A.defaultSettings(ds);
    const settings = { ...s0, weighting: 'log' };
    const info = await engine.build(settings);
    const net = A.buildNetwork(ds, settings);
    const s = net.settings;
    const attr = ds.attributeSchema.find(a => a.type === 'categorical')?.key;
    const node = net.nodeIds[0] ?? 0;
    const evs = ds.events;
    let date = NaN;
    { const ts = Array.from(evs.t).filter(Number.isFinite).sort((a, b) => a - b); date = ts[Math.floor(ts.length / 2)]; }
    const com = A.detectCommunities(net, { seed: 3 });
    const series = A.timeSeries(ds, s, { window: 'week', attr });
    const cases = [
      ['build', info, { n: net.n, directed: net.directed, nodeIds: net.nodeIds, summary: net.summary, settings: net.settings }],
      ['nodeMetrics', await engine.nodeMetrics({}), A.computeNodeMetrics(net, {})],
      ['networkMetrics', await engine.networkMetrics({}), A.computeNetworkMetrics(net, {})],
      ['communities', await engine.communities({ seed: 3 }), com],
      ['groups', attr ? await engine.groups(attr) : null, attr ? A.groupMetrics(net, ds, attr) : null],
      ['ego', await engine.ego(node, { attr }), A.egoMetrics(net, node, { ds, attr })],
      ['nullModel', await engine.nullModel({ reps: 15, seed: 2, attr }), A.nullModel(net, { ds, membership: com.membership, reps: 15, seed: 2, attr })],
      ['resampleRanks', await engine.resampleRanks({ metric: 'degree', reps: 8, seed: 4 }), A.resampleRanks(ds, s, { metric: 'degree', reps: 8, seed: 4 })],
      ['timeSeries', await engine.timeSeries({ window: 'week', attr }), series],
      ['detectShifts', await engine.detectShifts(series, {}), A.detectShifts(series, { labels: ds.nodes.labels })],
      ['applicability', await engine.applicability(), A.applicability(ds, net)],
      ['edgeEvidence', net.edges.count ? await engine.edgeEvidence(net.nodeIds[net.edges.src[0]], net.nodeIds[net.edges.dst[0]], {}) : null, net.edges.count ? A.edgeEvidence(ds, net, net.nodeIds[net.edges.src[0]], net.nodeIds[net.edges.dst[0]], {}) : null],
      ['graphForRender', await engine.graphForRender({ iterations: 15, seed: 5 }), A.graphForRender(net, { iterations: 15, seed: 5, previous: new Map(), labels: ds.nodes.labels })],
    ];
    if (Number.isFinite(date)) cases.push(['compareBeforeAfter', await engine.compareBeforeAfter(date, { reps: 200, metricReps: 20, metrics: ['degree', 'strength', 'betweenness'] }), A.compareBeforeAfter(ds, s, date, { reps: 200, metricReps: 20, metrics: ['degree', 'strength', 'betweenness'] })]);
    if (evs.text.some(x => x)) {
      cases.push(['affect', await engine.affect({ by: ['node', 'overall'] }), A.affect(ds, { by: ['node', 'overall'] })]);
      cases.push(['keywords', await engine.keywords({ by: 'node' }), A.keywords(ds, { by: 'node' })]);
      cases.push(['topics', await engine.topics({ k: 4, iterations: 20, seed: 2 }), A.topics(ds, { k: 4, iterations: 20, seed: 2 })]);
      cases.push(['diffusion', await engine.diffusion({ reps: 20, seed: 2 }), A.diffusion(ds, net, { reps: 20, seed: 2 })]);
    }
    for (const [what, got, exp] of cases) {
      t.cmp(same(got, exp), { dataset: label, mode, what: `engine.${what} equals the pure function`, got: 'differs', expected: 'identical' });
    }
    engine.terminate();
  }
}

function determinism(t, ds, label, st) {
  const net = A.buildNetwork(ds, A.defaultSettings(ds));
  const s = net.settings;
  const runs = {
    communities: (seed) => A.detectCommunities(net, { seed }),
    nullModel: (seed) => A.nullModel(net, { reps: 10, seed }),
    resampleRanks: (seed) => A.resampleRanks(ds, s, { metric: 'degree', reps: 6, seed }),
    layout: (seed) => A.graphForRender(net, { iterations: 15, seed }),
    pivots: (seed) => A.computeNodeMetrics(net, { which: ['betweenness', 'closeness'], approx: true, pivots: Math.max(2, Math.floor(net.n / 3)), seed }),
    compareBeforeAfter: (seed) => { const tt = Array.from(ds.events.t).filter(Number.isFinite).sort((a, b) => a - b); return tt.length > 10 ? A.compareBeforeAfter(ds, s, tt[tt.length >> 1], { reps: 100, metricReps: 10, seed }) : null; },
  };
  if (ds.events.text.some(x => x)) {
    runs.topics = (seed) => A.topics(ds, { k: 4, iterations: 20, seed });
    runs.diffusion = (seed) => A.diffusion(ds, net, { reps: 20, seed });
  }
  for (const [what, f] of Object.entries(runs)) {
    const a = f(7), b = f(7), c = f(8);
    t.cmp(isDeepStrictEqual(a, b), { dataset: label, what: `${what}: same seed, identical output` });
    (st.seedVaries[what] ||= { cases: 0, differed: 0 }).cases++;
    if (!isDeepStrictEqual(a, c)) st.seedVaries[what].differed++;
  }
  // Louvain across seeds: how much does the partition move?
  const qs = [], counts = new Set();
  for (let seed = 1; seed <= 10; seed++) { const r = A.detectCommunities(net, { seed }); qs.push(r.modularity); counts.add(r.count); }
  st.louvainModularitySpread.push(Math.max(...qs) - Math.min(...qs));
}

function oneWindow(t, ds, label) {
  const s = A.normalizeSettings(ds, A.defaultSettings(ds));
  const tt = Array.from(ds.events.t).filter(Number.isFinite);
  if (!tt.length) return;
  const tMin = Math.min(...tt), tMax = Math.max(...tt);
  const metrics = NODE_METRICS;
  const ts = A.timeSeries(ds, s, { window: { size: tMax - tMin + 1 }, metrics, approx: false });
  t.cmp(ts.windows.length === 1, { dataset: label, what: 'one window spans the data', got: ts.windows.length });
  const ref = A.buildNetwork(ds, { ...s, includeIsolates: false, time: { start: tMin, end: tMax + 1 } });
  const rm = A.computeNodeMetrics(ref, { which: metrics, approx: false });
  for (const m of metrics) {
    const COUNT = ['degree', 'inDegree', 'outDegree', 'strength', 'inStrength', 'outStrength'].includes(m);
    for (let i = 0; i < ds.nodes.count; i++) {
      const v = ref.index[i];
      const exp = v >= 0 ? rm[m][v] : COUNT ? 0 : NaN;
      t.cmp(Object.is(ts.node[m][0][i], exp) || close(ts.node[m][0][i], exp, 1e-12), { dataset: label, what: `one window: node ${m}`, i, got: ts.node[m][0][i], expected: exp });
    }
  }
  const rn = A.computeNetworkMetrics(ref, { pathSources: Math.min(ref.n, 200) });
  for (const [k, v] of Object.entries(rn)) if (typeof v === 'number') t.cmp(Object.is(ts.network[k]?.[0], v) || close(ts.network[k]?.[0], v, 1e-12), { dataset: label, what: `one window: network.${k}`, got: ts.network[k]?.[0], expected: v });
  // Additivity: counts, no turn-taking, all evidence dated.
  const s2 = { ...s, weighting: 'count', minWeight: 0, rules: { ...s.rules, adjacency: { ...s.rules.adjacency, on: false } } };
  const weekly = A.timeSeries(ds, s2, { window: 'week', metrics: ['strength', 'degree'], network: false });
  const whole = A.buildNetwork(ds, { ...s2, includeIsolates: false, time: { start: weekly.meta.start, end: weekly.meta.end } });
  const ws = A.computeNodeMetrics(whole, { which: ['strength'] }).strength;
  for (let i = 0; i < ds.nodes.count; i++) {
    let sum = 0;
    for (const arr of weekly.node.strength) sum += arr[i];
    const exp = whole.index[i] >= 0 ? ws[whole.index[i]] : 0;
    t.cmp(close(sum, exp, 1e-9), { dataset: label, what: 'weekly strength sums to the whole period', i, got: sum, expected: exp });
  }
  let dated = 0;
  for (let i = 0; i < ds.events.count; i++) if (Number.isFinite(ds.events.t[i]) && !(s.excludeBots && ds.nodes.isBot[ds.events.actor[i]])) dated++;
  const act = weekly.activity.total.reduce((a, b) => a + b, 0);
  t.cmp(act === dated, { dataset: label, what: 'weekly activity sums to the dated events', got: act, expected: dated });
}

export async function run({ count = 10, seed = 1, log = () => {} } = {}) {
  const t = tally(name);
  const st = { seedVaries: {}, louvainModularitySpread: [] };
  for (let k = 0; k < count; k++) {
    const spec = SPECS[k % SPECS.length];
    const gseed = seed * 1000 + k;
    const { dataset: ds } = generate({ ...spec, seed: gseed, output: 'dataset' });
    const label = `${spec.context}/${spec.medium}/${spec.structure} seed ${gseed}`;
    t.case();
    await engineVsPure(t, ds, label);
    determinism(t, ds, label, st);
    oneWindow(t, ds, label);
    log(`consistency ${label}: ${t.failures.length} failures so far`);
  }
  // Random graphs: Louvain spread across seeds on planted blocks.
  for (let k = 0; k < count; k++) {
    const net = toNet(makeCase({ family: 'sbm', n: 120, groups: 4, pIn: 0.15, pOut: 0.03, directed: false, weights: 'unit', seed: seed * 5000 + k }));
    const qs = [];
    for (let s2 = 1; s2 <= 10; s2++) qs.push(A.detectCommunities(net, { seed: s2 }).modularity);
    st.louvainModularitySpread.push(Math.max(...qs) - Math.min(...qs));
  }
  t.stats.seedVaries = st.seedVaries;
  t.stats.louvainModularitySpreadOver10Seeds = quantiles(st.louvainModularitySpread);
  return t.result();
}
