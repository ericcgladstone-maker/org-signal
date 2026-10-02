// Adapter over the analysis engine (src/analysis/engine.js, createEngine()).
//
// Views never call the engine directly; they call this adapter, which:
//  - speaks the Analysis contract (docs/CONTRACTS.md) to the real engine,
//    accepting a few likely method-name aliases so a rename touches one line;
//  - normalises results to the shapes the views use (below);
//  - translates node indices: views always speak DATASET node indices
//    (store.selection, labels, attrs), as do egoMetrics and edgeEvidence in
//    src/analysis. The engine's per-node metric arrays are in NETWORK order;
//    net.nodeIds maps network -> dataset and this adapter builds the inverse.
//
// Real engine expectations (method: arguments -> result):
//   load(ds)                                   keep the dataset in the worker
//   buildNetwork(settings, {signal,onProgress}) -> Network summary incl. n, nodeIds, directed, summary
//   computeNodeMetrics({which, approx})        -> { metric: Float64Array (network order) }
//   computeNetworkMetrics()                    -> { density, ... }
//   detectCommunities({resolution, seed})      -> { membership Int32Array, modularity, count }
//   applicability()                            -> { metric: { level, reason } }
//   graphForRender({...})                      -> { nodeIds, x, y, src, dst, w, byRule, layerMask }
//   groupMetrics(attrKey, {metrics})           -> { groups[], mixing, assortativity, eiIndex }
//   egoMetrics(dsNode, {attr}), nullModel({stats, reps, seed, attr, membership}),
//   resampleRanks(opts) -> { nodes[], meta }, timeSeries(opts), detectShifts(series, opts),
//   compareBeforeAfter(date, opts), affect(opts), keywords(opts), topics(opts),
//   diffusion(opts), edgeEvidence(dsA, dsB, {limit, bothDirections}) -> { total, events[] }
// Optional: glossary() -> { metric: { label, meaning, reliability } }, cancel(), terminate().

import { MOCK, tryImport, pickFn } from './modules.js';
import { setEngineGlossary } from './glossary.js';

let impl = null;          // the underlying engine object
let pureDefaults = null;  // defaultSettings(ds) from src/analysis/index.js when available
let status = { available: false, kind: 'none', reason: 'Not started' };

export function engineStatus() { return status; }

export async function initEngine() {
  if (impl) return status;
  if (MOCK) {
    const m = await import('./mock.js');
    impl = m.createMockEngine();
    pureDefaults = m.defaultSettings;
    status = { available: true, kind: 'mock', reason: 'Demo engine (?mock)' };
    return status;
  }
  const mod = await tryImport('../../analysis/engine.js');
  const create = pickFn(mod, ['createEngine']);
  if (!create) {
    status = { available: false, kind: 'none', reason: 'The analysis engine (src/analysis/engine.js) is not available in this build.' };
    return status;
  }
  try {
    impl = await create({ worker: true });
  } catch (e) {
    status = { available: false, kind: 'none', reason: `The analysis engine failed to start: ${e.message}` };
    return status;
  }
  const idx = await tryImport('../../analysis/index.js');
  pureDefaults = pickFn(idx, ['defaultSettings']);
  status = { available: true, kind: 'real', reason: '' };
  try {
    const g = await call(['glossary', 'getGlossary']);
    if (g) setEngineGlossary(g);
    else {
      const gm = await tryImport('../../analysis/glossary.js');
      setEngineGlossary(gm?.GLOSSARY || gm?.glossary || gm?.default || null);
    }
  } catch { /* glossary is optional */ }
  return status;
}

async function call(names, ...args) {
  const fn = pickFn(impl, names);
  if (!fn) throw new Error(`The analysis engine does not provide ${names[0]}().`);
  return fn(...args);
}

function has(names) { return !!pickFn(impl, names); }

// ---- state kept for index translation ----------------------------------------
let current = { nodeIds: null, toNet: null };

function setNodeIds(nodeIds, datasetCount) {
  const ids = nodeIds instanceof Int32Array ? nodeIds : Int32Array.from(nodeIds || []);
  const toNet = new Int32Array(datasetCount).fill(-1);
  for (let v = 0; v < ids.length; v++) toNet[ids[v]] = v;
  current = { nodeIds: ids, toNet };
}

export function netIndex(dsNode) { return current.toNet?.[dsNode] ?? -1; }
export function dsIndex(netNode) { return current.nodeIds?.[netNode] ?? -1; }

// ---- adapter API used by the views ---------------------------------------------

export const engine = {
  get kind() { return status.kind; },
  has,

  async defaultSettings(ds) {
    if (pureDefaults) return pureDefaults(ds);
    return call(['defaultSettings'], ds);
  },

  async load(ds, opts = {}) {
    await call(['load', 'setDataset', 'loadDataset'], ds, opts);
  },

  // Returns a summary { n, edgeCount, directed, nodeIds, summary, settings }.
  async build(settings, ds, opts = {}) {
    const net = await call(['buildNetwork', 'build'], settings, opts);
    const nodeIds = net?.nodeIds ?? null;
    if (nodeIds) setNodeIds(nodeIds, ds.nodes.count);
    return {
      n: net?.n ?? nodeIds?.length ?? 0,
      edgeCount: net?.edgeCount ?? net?.edges?.count ?? net?.summary?.edges ?? 0,
      directed: !!(net?.directed ?? settings.directed),
      nodeIds: current.nodeIds,
      summary: net?.summary ?? {},
      settings,
      version: Date.now(),
    };
  },

  nodeMetrics: (opts = {}) => call(['computeNodeMetrics', 'nodeMetrics'], opts),
  networkMetrics: (opts = {}) => call(['computeNetworkMetrics', 'networkMetrics'], opts),
  communities: (opts = {}) => call(['detectCommunities', 'communities'], opts),
  applicability: () => call(['applicability']),

  // Positions and ties for drawing, normalised to typed arrays in network order.
  // The engine keeps the strongest people and heaviest ties over budget;
  // the budget here covers the 5,000-person target.
  async render(opts = {}) {
    const r = await call(['graphForRender', 'render'], { maxNodes: 6000, maxEdges: 60000, ...opts });
    return normaliseRender(r);
  },

  groups: (attrKey, opts = {}) => call(['groupMetrics', 'groups'], attrKey, opts),
  // Dataset node indices, as src/analysis/groups.js egoMetrics expects.
  ego: (dsNode, opts = {}) => call(['egoMetrics', 'ego'], dsNode, opts),
  nullModel: (opts = {}) => call(['nullModel'], opts),
  resampleRanks: (opts = {}) => call(['resampleRanks'], opts),
  timeSeries: (opts = {}) => call(['timeSeries'], opts),
  shifts: (series, opts = {}) => call(['detectShifts', 'shifts'], series, opts),
  beforeAfter: (date, opts = {}) => call(['compareBeforeAfter', 'beforeAfter'], date, opts),
  affect: (opts = {}) => call(['affect'], opts),
  keywords: (opts = {}) => call(['keywords'], opts),
  topics: (opts = {}) => call(['topics'], opts),
  diffusion: (opts = {}) => call(['diffusion'], opts),
  // Dataset node indices, as src/analysis/construct.js edgeEvidence expects.
  async edgeEvidence(dsA, dsB, opts = {}) {
    const r = await call(['edgeEvidence'], dsA, dsB, opts);
    // The engine returns at most `limit` events; when it returns exactly that
    // many there may be more.
    return Array.isArray(r) ? { total: r.length, events: r, capped: opts.limit != null && r.length >= opts.limit } : r;
  },

  // Hands an arbitrary contract call through (used by the LLM analyst tools).
  raw: (name, ...args) => call([name], ...args),
  get impl() { return impl; },
};

function netIndex0(d) { return current.toNet ? current.toNet[d] : d; }

function toTyped(arr, T) {
  if (!arr) return null;
  return arr instanceof T ? arr : T.from(arr);
}

export function normaliseRender(r) {
  if (!r) return null;
  // Shape A (preferred): parallel typed arrays.
  if (r.x && r.y) {
    const nodeIds = toTyped(r.nodeIds || r.nodes?.ids || current.nodeIds, Int32Array);
    // Render index -> network index (metric arrays, communities). The engine
    // reorders and truncates over budget, so never assume identity.
    let netIndex = toTyped(r.nodes?.netIndex || r.netIndex, Int32Array);
    if (!netIndex) netIndex = Int32Array.from(nodeIds, d => netIndex0(d));
    return {
      nodeIds, netIndex,
      truncated: r.truncated || null,
      x: toTyped(r.x, Float32Array), y: toTyped(r.y, Float32Array),
      src: toTyped(r.src || r.edges?.src, Int32Array), dst: toTyped(r.dst || r.edges?.dst, Int32Array),
      w: toTyped(r.w || r.edges?.w, Float64Array),
      byRule: r.byRule || r.edges?.byRule || {},
      layerMask: toTyped(r.layerMask || r.edges?.layerMask, Uint8Array),
      directed: !!r.directed,
    };
  }
  // Shape B: interleaved positions.
  if (r.positions) {
    const n = r.positions.length / 2;
    const x = new Float32Array(n), y = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = r.positions[2 * i]; y[i] = r.positions[2 * i + 1]; }
    return normaliseRender({ ...r, x, y });
  }
  // Shape C: object lists.
  if (Array.isArray(r.nodes)) {
    const n = r.nodes.length;
    const x = new Float32Array(n), y = new Float32Array(n), ids = new Int32Array(n);
    const pos = new Map();
    r.nodes.forEach((nd, i) => { x[i] = nd.x; y[i] = nd.y; ids[i] = nd.node ?? nd.id ?? i; pos.set(nd.key ?? nd.id ?? i, i); });
    const m = r.edges?.length || 0;
    const src = new Int32Array(m), dst = new Int32Array(m), w = new Float64Array(m);
    (r.edges || []).forEach((e, k) => { src[k] = pos.get(e.source) ?? e.source; dst[k] = pos.get(e.target) ?? e.target; w[k] = e.weight ?? e.w ?? 1; });
    return { nodeIds: ids, x, y, src, dst, w, byRule: r.byRule || {}, layerMask: r.layerMask || new Uint8Array(m), directed: !!r.directed };
  }
  throw new Error('graphForRender returned an unrecognised shape');
}
