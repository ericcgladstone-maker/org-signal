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
//   notify(level, text, { timeout, detail, action })   notice (info | warn | error); errors stay until dismissed
//   announce(text)          screen-reader announcement through the shell's permanent live region
//   focus(target, { fallback })    move focus after an action (selector or element), once the view has rendered
//   runJob(label, fn)       fn(signal, progress) with a status-bar entry and cancel
//   startOver()             clear everything loaded in this tab and return to Data
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

// Short display name for what is loaded: the dataset name without its
// parenthetical detail ("Synthetic workplace (slack, ...)" -> "Synthetic workplace").
export function shortName(name, max = 32) {
  let s = String(name || 'Untitled').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim() || String(name || 'Untitled');
  if (s.length > max) s = `${s.slice(0, max - 1).replace(/[\s,;:+-]+\S*$/, '')}\u2026`;
  return s;
}

let jobSeq = 0;
let noticeSeq = 0;

// ---- announcements ---------------------------------------------------------------
// One permanent polite live region (rendered by the shell), so the first
// message is never lost to a region that appears with it, and progress is
// announced at phase changes and quarter marks only: a job that reports every
// 55 ms must not flood a screen reader (A5).

const hasDOM = typeof document !== 'undefined';
let lastSpoken = { text: '', at: 0 };

export function announce(text) {
  if (!hasDOM || !text) return;
  const el = document.getElementById('announcer');
  if (!el) return;
  // Re-setting identical text is not re-read; nudge it so repeats are heard.
  el.textContent = text === lastSpoken.text ? `${text}\u00a0` : text;
  lastSpoken = { text, at: Date.now() };
}

// Progress messages come from importers and the engine as raw counts
// ("16916/1691607", "50 of 11864 day files"); format them for reading.
export function formatProgress(message) {
  if (!message) return '';
  const g = x => Number(x).toLocaleString('en-US');
  return String(message)
    .replace(/(\d+)\s*\/\s*(\d+)/g, (_, a, b) => `${g(a)} of ${g(b)}`)
    // Group long counts, but leave years ("week of 6 Jan 2025") alone.
    .replace(/(?<![\d.,])(\d{4,})(?![\d.,])/g, (_, a) => (a.length === 4 && /^(19|20)/.test(a) ? a : g(a)));
}

// What a message says once its counts are removed: a change here is a new phase.
const phaseOf = m => String(m || '').replace(/[\d.,%/]+/g, '#').replace(/\s+/g, ' ').trim();

function runJob(label, fn, { indeterminate = false } = {}) {
  const id = ++jobSeq;
  const ctrl = new AbortController();
  const job = { id, label, progress: indeterminate ? null : 0, message: '', cancel: () => ctrl.abort() };
  store.set(s => ({ jobs: [...s.jobs, job] }));
  announce(`${label}: started.`);
  let spokenQuarter = 0, spokenPhase = '', spokenAt = Date.now();
  const update = (progress, message) => {
    store.set(s => ({ jobs: s.jobs.map(j => (j.id === id ? { ...j, progress: Number.isFinite(progress) ? progress : j.progress, message: message ?? j.message } : j)) }));
    const q = Number.isFinite(progress) ? Math.floor(progress * 4) : 0;
    const phase = phaseOf(message);
    const now = Date.now();
    if (q > spokenQuarter && q < 4) { spokenQuarter = q; spokenAt = now; announce(`${label}: ${q * 25}%`); }
    else if (message && phase !== spokenPhase && now - spokenAt > 2500) { spokenPhase = phase; spokenAt = now; announce(`${label}: ${formatProgress(message)}`); }
  };
  const done = () => store.set(s => ({ jobs: s.jobs.filter(j => j.id !== id) }));
  let p;
  try { p = Promise.resolve(fn(ctrl.signal, update)); } catch (e) { p = Promise.reject(e); }
  return p.then(
    r => { done(); if (ctrl.signal.aborted) { announce(`${label}: cancelled.`); throw abortError(); } announce(`${label}: done.`); return r; },
    e => { done(); announce(`${label}: ${ctrl.signal.aborted ? 'cancelled' : 'failed'}.`); throw ctrl.signal.aborted ? abortError() : e; });
}

function abortError() { const e = new Error('Cancelled'); e.name = 'AbortError'; return e; }

// ---- notices -----------------------------------------------------------------------
// Info and warnings dismiss themselves; errors stay until dismissed (A11).
// Timers pause while the pointer or focus is in the notice stack, so nothing
// vanishes while it is being read or acted on.

const timers = new Map(); // id -> { remaining, started, handle }
let paused = false;

function arm(id) {
  const t = timers.get(id);
  if (!t || paused) return;
  t.started = Date.now();
  t.handle = setTimeout(() => dismiss(id), t.remaining);
}

function pauseNotices() {
  if (paused) return;
  paused = true;
  for (const t of timers.values()) { clearTimeout(t.handle); t.remaining = Math.max(1500, t.remaining - (Date.now() - t.started)); }
}

function resumeNotices() {
  if (!paused) return;
  paused = false;
  for (const id of timers.keys()) arm(id);
}

// notify(level, text, { timeout, detail: [lines], action: { label, onClick } })
function notify(level, text, { timeout, detail, action } = {}) {
  const id = ++noticeSeq;
  const n = { id, level, text: String(text), detail: detail?.length ? detail.map(String) : null, action: action || null };
  store.set(s => ({ notice: n, notices: [...(s.notices || []).slice(-3), n] }));
  const ms = timeout ?? (level === 'error' ? 0 : level === 'warn' ? 12000 : detail?.length ? 10000 : 6000);
  if (ms > 0) { timers.set(id, { remaining: ms, started: Date.now(), handle: null }); arm(id); }
  return id;
}

function dismiss(id) {
  const t = timers.get(id);
  if (t) { clearTimeout(t.handle); timers.delete(id); }
  // If focus is inside the notice being removed, hand it to the view heading
  // rather than letting it fall to the page body.
  const holder = hasDOM && document.activeElement?.closest?.(`[data-notice="${id}"]`);
  store.set(s => ({ notices: (s.notices || []).filter(n => n.id !== id), notice: s.notice?.id === id ? null : s.notice }));
  if (holder) focusTarget(null);
}

// ---- focus --------------------------------------------------------------------------
// After an action re-renders or removes the control that had focus, focus
// should land somewhere meaningful (A8). focusTarget waits two frames for the
// view to render, then focuses the target (a selector or element), making it
// programmatically focusable if needed; it falls back to the active view's
// heading.

function viewHeading() {
  return hasDOM ? document.querySelector('main .view__title, main h1') : null;
}

export function focusTarget(target, { fallback = true, scroll = true } = {}) {
  if (!hasDOM) return;
  const go = () => {
    let el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el?.isConnected) el = fallback ? viewHeading() : null;
    if (!el) return;
    if (el.tabIndex < 0 && !el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: !scroll });
    if (scroll) el.scrollIntoView?.({ block: 'nearest' });
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
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

// Number communities. On a first load, by size, so color slot 1 is the
// largest group (engine ids are arbitrary). On a rebuild, by overlap with the
// previous numbering (D9): each new community, largest first, takes the
// previous number it shares most people with, so a community that barely
// changed keeps its number and color. Unmatched communities take the free
// numbers in size order; numbers are then compacted in order so there are no
// empty slots. `prev` = { membership (network order), nodeIds } or null.
export function orderCommunities(c, prev = null, nodeIds = null) {
  if (!c?.membership) return c;
  let k = 0;
  for (const m of c.membership) if (m + 1 > k) k = m + 1;
  const sizes = new Array(k).fill(0);
  for (const m of c.membership) if (m >= 0) sizes[m]++;
  // Engine ids may be sparse; empty ids get no number.
  const bySize = sizes.map((s, i) => [s, i]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(x => x[1]);
  const label = new Int32Array(k).fill(-1);
  if (prev?.membership && prev.nodeIds && nodeIds) {
    // Previous community of each dataset node.
    const before = new Map();
    for (let v = 0; v < prev.membership.length; v++) if (prev.membership[v] >= 0) before.set(prev.nodeIds[v], prev.membership[v]);
    const overlap = Array.from({ length: k }, () => new Map());
    for (let v = 0; v < c.membership.length; v++) {
      const m = c.membership[v], p = before.get(nodeIds[v]);
      if (m >= 0 && p != null) overlap[m].set(p, (overlap[m].get(p) || 0) + 1);
    }
    const taken = new Set();
    for (const m of bySize) {
      const best = [...overlap[m].entries()].filter(([p]) => !taken.has(p)).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      if (best) { label[m] = best[0]; taken.add(best[0]); }
    }
    let next = 0;
    for (const m of bySize) if (label[m] < 0) { while (taken.has(next)) next++; label[m] = next; taken.add(next); }
    // Compact, keeping order: numbers left empty by communities that vanished are closed up.
    const used = [...new Set(bySize.map(m => label[m]))].sort((a, b) => a - b);
    const compact = new Map(used.map((l, i) => [l, i]));
    for (const m of bySize) label[m] = compact.get(label[m]);
  } else {
    bySize.forEach((old, i) => { label[old] = i; });
  }
  const membership = Int32Array.from(c.membership, m => (m >= 0 ? label[m] : -1));
  const outSizes = new Array(bySize.length).fill(0);
  for (const m of bySize) outSizes[label[m]] = sizes[m];
  return { ...c, membership, sizes: outSizes, count: bySize.length };
}

// What a rebuild changed, for the notice after "Apply and rebuild" (D9).
export const RULE_LABEL = { reply: 'replies', mention: 'mentions', dm: 'direct messages', to: 'To recipients', cc: 'Cc recipients', bcc: 'Bcc recipients', adjacency: 'turn-taking', copresence: 'meetings and co-presence', declared: 'declared ties', repost: 'reposts', like: 'likes', follow: 'follows', reaction: 'reactions' };
const WEIGHTING = { count: 'count of evidence', log: 'log of count', binary: 'present or absent' };
const day = t => (Number.isFinite(t) && t != null ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'open');

export function settingsChanges(a = {}, b = {}) {
  const out = [];
  for (const r of new Set([...Object.keys(a.rules || {}), ...Object.keys(b.rules || {})])) {
    const x = a.rules?.[r] || {}, y = b.rules?.[r] || {};
    const name = RULE_LABEL[r] || r;
    if (!!x.on !== !!y.on) out.push(`${y.on ? 'Added' : 'Removed'} ties from ${name}`);
    else if (y.on && (x.weight ?? 1) !== (y.weight ?? 1)) out.push(`Weight for ${name}: ${x.weight ?? 1} to ${y.weight ?? 1}`);
  }
  if (!!a.directed !== !!b.directed) out.push(`Direction: ${b.directed ? 'directed' : 'undirected'}`);
  if ((a.weighting || 'count') !== (b.weighting || 'count')) out.push(`Tie weight: ${WEIGHTING[a.weighting || 'count']} to ${WEIGHTING[b.weighting || 'count']}`);
  if ((a.minWeight ?? 0) !== (b.minWeight ?? 0)) out.push(`Minimum tie weight: ${a.minWeight ?? 0} to ${b.minWeight ?? 0}`);
  if ((a.maxRecipients ?? 0) !== (b.maxRecipients ?? 0)) out.push(`Broadcast cutoff: ${a.maxRecipients || 'none'} to ${b.maxRecipients || 'none'}`);
  if ((a.time?.start ?? null) !== (b.time?.start ?? null) || (a.time?.end ?? null) !== (b.time?.end ?? null)) out.push(`Time range: ${day(b.time?.start)} to ${day(b.time?.end)}`);
  if (JSON.stringify(a.visibility || null) !== JSON.stringify(b.visibility || null)) out.push('Visibility layers changed');
  if (JSON.stringify(a.media || null) !== JSON.stringify(b.media || null)) out.push('Media changed');
  if (!!a.excludeBots !== !!b.excludeBots) out.push(b.excludeBots ? 'Bots left out' : 'Bots included');
  if ((a.includeIsolates !== false) !== (b.includeIsolates !== false)) out.push(b.includeIsolates !== false ? 'People with no ties kept' : 'People with no ties left out');
  return out;
}

// Before/after summary of a rebuild. Counts people whose community number
// changed (after overlap matching), by dataset node.
export function rebuildSummary(before, after) {
  const n = x => Number(x || 0).toLocaleString('en-US');
  const lines = [];
  const was = (a, b) => (a === b ? '' : ` (was ${n(a)})`);
  lines.push(`${n(after.n)} people${was(before.n, after.n)}, ${n(after.edgeCount)} ties${was(before.edgeCount, after.edgeCount)}`);
  if (after.communities) {
    let moved = 0;
    if (before.communities?.membership && before.nodeIds) {
      const prev = new Map();
      for (let v = 0; v < before.communities.membership.length; v++) prev.set(before.nodeIds[v], before.communities.membership[v]);
      for (let v = 0; v < after.communities.membership.length; v++) {
        const p = prev.get(after.nodeIds[v]);
        if (p != null && p !== after.communities.membership[v]) moved++;
      }
    }
    lines.push(`${n(after.communities.count)} communities${was(before.communities?.count, after.communities.count)}; ${moved ? `${n(moved)} ${moved === 1 ? 'person' : 'people'} changed community` : 'nobody changed community'}`);
  }
  const changes = settingsChanges(before.settings, after.settings);
  if ((before.settings?.weighting || 'count') !== (after.settings?.weighting || 'count')) {
    changes.push('Betweenness and closeness ignore tie weights, so the weight setting does not change them; their weighted versions and strength do.');
  }
  return { lines, changes };
}

async function computeAll(signal, progress, prevCommunities = null, nodeIds = null) {
  progress(0.35, 'Centrality and local structure');
  const node = await engine.nodeMetrics({ which: NODE_METRICS, signal, onProgress: (f, m) => progress(0.35 + 0.35 * (f || 0), m) });
  if (signal.aborted) throw abortError();
  progress(0.72, 'Whole-network measures');
  const network = await engine.networkMetrics({ signal });
  progress(0.82, 'Communities');
  const communities = orderCommunities(await engine.communities({ resolution: 1, seed: 1, signal }).catch(() => null), prevCommunities, nodeIds);
  progress(0.92, 'Applicability');
  const applicability = await engine.applicability().catch(() => ({}));
  const meta = node?.meta || {};
  const nodeArrays = {};
  for (const [k, v] of Object.entries(node || {})) if (k !== 'meta' && v && typeof v.length === 'number') nodeArrays[k] = v;
  return { metrics: { node: nodeArrays, network, meta }, communities, applicability };
}

async function rebuild(settings, { quiet = false } = {}) {
  const st = store.get();
  const ds = st.dataset;
  if (!ds) throw new Error('No dataset loaded.');
  const before = { n: st.network?.n, edgeCount: st.network?.edgeCount, nodeIds: st.network?.nodeIds, communities: st.communities, settings: st.settings };
  return runJob('Building network', async (signal, progress) => {
    progress(0.05, 'Applying construction rules');
    const net = await engine.build(settings, ds, { signal, onProgress: (f, m) => progress(0.05 + 0.25 * (f || 0), m) });
    if (signal.aborted) throw abortError();
    const prev = before.communities?.membership && before.nodeIds ? { membership: before.communities.membership, nodeIds: before.nodeIds } : null;
    const r = await computeAll(signal, progress, prev, net?.nodeIds);
    const summary = rebuildSummary(before, { n: net?.n, edgeCount: net?.edgeCount, nodeIds: net?.nodeIds, communities: r.communities, settings });
    // lastRebuild lets views show what changed (e.g. a diff panel) after the notice is gone.
    store.set({ settings, network: net, ...r, selection: store.get().selection.filter(i => i < ds.nodes.count), lastRebuild: { at: Date.now(), ...summary }, methodsLog: {} });
    if (!quiet) notify('info', `Rebuilt: ${summary.lines.join('. ')}.`, { detail: summary.changes });
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
    // The generated world's ground truth belongs to the dataset it produced;
    // anything else replacing it drops it (see store.js `generated`).
    const gen = store.get().generated;
    const keepGen = gen && gen.datasetName === dataset.meta?.name;
    store.set({ datasets, dataset, settings, network: net, ...r, report, selection: [], lastRebuild: null, methodsLog: {}, ...(keepGen ? {} : { generated: null }) });
    return dataset;
  });
}

// Clear everything loaded in this tab (decision 7). Nothing is stored, so this
// is the whole session; `epoch` remounts the views so their local state goes too.
function startOver() {
  store.set(s => ({
    datasets: [], dataset: null, settings: null, network: null, metrics: null, communities: null, applicability: null,
    report: null, selection: [], generated: null, lastRebuild: null, methodsLog: {}, notices: [], notice: null,
    epoch: (s.epoch || 0) + 1, ui: { ...(s.ui || {}), drawer: false, menuOpen: false, profile: null, profileFile: null },
  }));
  for (const t of timers.values()) clearTimeout(t.handle);
  timers.clear();
  setView('data');
  announce('Cleared. Nothing is loaded.');
  focusTarget(null);
}

export function registerActions() {
  Object.assign(store.actions, {
    loadDataset, rebuild, setView, select, notify, dismiss, runJob, startOver, announce, pauseNotices, resumeNotices,
    focus: (target, opts) => focusTarget(target, opts),
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
