// store.actions, registered by the shell at startup. Every view and the
// builders change app state only through these (or plain store.set for
// view-local UI state), so loading, rebuilding and job bookkeeping happen in
// one place.
//
//   loadDataset(ds, { mode: 'replace'|'add', name })  merge when adding, load into the
//       engine, build with defaultSettings, compute metrics. Resolves when done; throws on failure.
//   rebuild(settings)       rebuild the network with new construction settings
//   setView(view)           switch view, update the URL hash, move focus to the heading
//   select(nodes)           shared selection (dataset node indices)
//   notify(level, text)     transient notice (info | warn | error)
//   runJob(label, fn)       fn(signal, progress) with a status-bar entry and cancel
//   openDrawer() / closeDrawer()   construction settings drawer

import { store } from './store.js';
import { engine, engineStatus } from './services/engine.js';
import { mergeDatasets, importReport } from './services/pipeline.js';
import { NODE_METRICS } from './services/glossary.js';

export const VIEWS = [
  { id: 'data', label: 'Data' },
  { id: 'network', label: 'Network' },
  { id: 'people', label: 'People' },
  { id: 'groups', label: 'Groups' },
  { id: 'content', label: 'Content' },
  { id: 'time', label: 'Time' },
  { id: 'generate', label: 'Generate', sep: true },
  { id: 'build', label: 'Build' },
  { id: 'ask', label: 'Ask', sep: true },
  { id: 'methods', label: 'Methods & Export' },
];

let jobSeq = 0;
let noticeSeq = 0;

function runJob(label, fn, { indeterminate = false } = {}) {
  const id = ++jobSeq;
  const ctrl = new AbortController();
  const job = { id, label, progress: indeterminate ? null : 0, message: '', cancel: () => ctrl.abort() };
  store.set(s => ({ jobs: [...s.jobs, job] }));
  const update = (progress, message) => store.set(s => ({ jobs: s.jobs.map(j => (j.id === id ? { ...j, progress: Number.isFinite(progress) ? progress : j.progress, message: message ?? j.message } : j)) }));
  const done = () => store.set(s => ({ jobs: s.jobs.filter(j => j.id !== id) }));
  let p;
  try { p = Promise.resolve(fn(ctrl.signal, update)); } catch (e) { p = Promise.reject(e); }
  return p.then(r => { done(); if (ctrl.signal.aborted) throw abortError(); return r; }, e => { done(); throw ctrl.signal.aborted ? abortError() : e; });
}

function abortError() { const e = new Error('Cancelled'); e.name = 'AbortError'; return e; }

function notify(level, text, { timeout } = {}) {
  const id = ++noticeSeq;
  const n = { id, level, text: String(text) };
  store.set(s => ({ notice: n, notices: [...(s.notices || []).slice(-3), n] }));
  const ms = timeout ?? (level === 'error' ? 12000 : level === 'warn' ? 9000 : 5000);
  if (ms > 0) setTimeout(() => dismiss(id), ms);
  return id;
}

function dismiss(id) {
  store.set(s => ({ notices: (s.notices || []).filter(n => n.id !== id), notice: s.notice?.id === id ? null : s.notice }));
}

function setView(view, { focus = true } = {}) {
  if (!VIEWS.some(v => v.id === view)) view = 'data';
  if (location.hash.slice(1).split('?')[0] !== view) history.replaceState(null, '', `${location.pathname}${location.search}#${view}`);
  store.set({ view, __focusOnView: focus, ui: { ...(store.get().ui || {}), menuOpen: false } });
  if (focus) window.scrollTo({ top: 0 });
}

function select(nodes) {
  const arr = Array.isArray(nodes) ? nodes : nodes == null ? [] : [nodes];
  store.set({ selection: arr.filter(x => Number.isInteger(x) && x >= 0) });
}

// Order communities by size so colour slot 1 is always the largest group;
// ids from the engine are arbitrary.
function orderCommunities(c) {
  if (!c?.membership) return c;
  const k = Math.max(-1, ...c.membership) + 1;
  const sizes = new Array(k).fill(0);
  for (const m of c.membership) if (m >= 0) sizes[m]++;
  const order = sizes.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(x => x[1]);
  const rank = new Int32Array(k); order.forEach((old, i) => { rank[old] = i; });
  const membership = Int32Array.from(c.membership, m => (m >= 0 ? rank[m] : -1));
  return { ...c, membership, sizes: order.map(i => sizes[i]), count: k };
}

async function computeAll(signal, progress) {
  progress(0.35, 'Centrality and local structure');
  const node = await engine.nodeMetrics({ which: NODE_METRICS, signal, onProgress: (f, m) => progress(0.35 + 0.35 * (f || 0), m) });
  if (signal.aborted) throw abortError();
  progress(0.72, 'Whole-network measures');
  const network = await engine.networkMetrics({ signal });
  progress(0.82, 'Communities');
  const communities = orderCommunities(await engine.communities({ resolution: 1, seed: 1, signal }).catch(() => null));
  progress(0.92, 'Applicability');
  const applicability = await engine.applicability().catch(() => ({}));
  const meta = node?.meta || {};
  const nodeArrays = {};
  for (const [k, v] of Object.entries(node || {})) if (k !== 'meta' && v && typeof v.length === 'number') nodeArrays[k] = v;
  return { metrics: { node: nodeArrays, network, meta }, communities, applicability };
}

async function rebuild(settings) {
  const ds = store.get().dataset;
  if (!ds) throw new Error('No dataset loaded.');
  return runJob('Building network', async (signal, progress) => {
    progress(0.05, 'Applying construction rules');
    const net = await engine.build(settings, ds, { signal, onProgress: (f, m) => progress(0.05 + 0.25 * (f || 0), m) });
    if (signal.aborted) throw abortError();
    const r = await computeAll(signal, progress);
    store.set({ settings, network: net, ...r, selection: store.get().selection.filter(i => i < ds.nodes.count) });
    return net;
  });
}

async function loadDataset(ds, { mode = 'replace', name } = {}) {
  if (!ds?.nodes || !ds?.events) throw new Error('loadDataset needs a Dataset (from DatasetBuilder.build()).');
  const st = engineStatus();
  if (!st.available) throw new Error(st.reason || 'The analysis engine is not available.');
  const prev = store.get();
  let dataset = ds;
  let datasets = [ds];
  if (mode === 'add' && prev.dataset) {
    dataset = await mergeDatasets([prev.dataset, ds], { name: name || `${prev.dataset.meta.name} + ${ds.meta.name}` });
    datasets = [...prev.datasets, ds];
  }
  return runJob(`Loading ${dataset.meta?.name || 'dataset'}`, async (signal, progress) => {
    progress(0.02, 'Loading into the analysis engine');
    await engine.load(dataset);
    const settings = await engine.defaultSettings(dataset);
    progress(0.05, 'Building network');
    const net = await engine.build(settings, dataset, { signal, onProgress: (f, m) => progress(0.05 + 0.25 * (f || 0), m) });
    if (signal.aborted) throw abortError();
    const r = await computeAll(signal, progress);
    const report = await importReport(dataset);
    store.set({ datasets, dataset, settings, network: net, ...r, report, selection: [] });
    return dataset;
  });
}

export function registerActions() {
  Object.assign(store.actions, {
    loadDataset, rebuild, setView, select, notify, dismiss, runJob,
    openDrawer: () => store.set({ ui: { ...(store.get().ui || {}), drawer: true } }),
    closeDrawer: () => store.set({ ui: { ...(store.get().ui || {}), drawer: false } }),
    // Replace the active dataset with a derived one (identity merges, profile
    // joins) while keeping the list of loaded sources.
    replaceDataset: async (ds) => {
      const datasets = store.get().datasets;
      await loadDataset(ds, { mode: 'replace' });
      store.set({ datasets: datasets.length ? datasets : [ds] });
    },
  });
}
