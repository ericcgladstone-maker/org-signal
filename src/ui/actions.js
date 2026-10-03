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
//   startOver()             clear everything loaded in this tab and return to Data (masthead: "Clear loaded data")
//   setExplain(on)          the Explanations switch (kept as the one localStorage preference)
//   loadSample()            load the sample organization; stays on the view it was asked from
//   openDrawer() / closeDrawer()   construction settings drawer

import { store, writeExplainPref } from './store.js';
import { engine, engineStatus } from './services/engine.js';
import { mergeDatasets, importReport } from './services/pipeline.js';
import { NODE_METRICS } from './services/glossary.js';

// Navigation in workflow order (decision 2): get a network, explore it,
// report on it, and Learn. `desc` is the one line shown under the label in
// the phone menu and as the link's title on desktop; `purpose` and `shows`
// feed the purposeful empty state (NeedsData) and the view intros, so a
// student can tell what a view is for before anything is loaded.
export const NAV_GROUPS = [
  { id: 'get', label: 'Get a network' },
  { id: 'explore', label: 'Explore' },
  { id: 'report', label: 'Report' },
  { id: 'learn', label: 'Learn' },
];

export const VIEWS = [
  { id: 'data', label: 'Data', group: 'get', desc: 'Import your exports or open a saved project' },
  { id: 'build', label: 'Build', group: 'get', desc: 'Draw, paste or survey a small network' },
  { id: 'generate', label: 'Generate', group: 'get', desc: 'Synthetic organizations with known answers' },
  { id: 'network', label: 'Network', group: 'explore', sep: true, desc: 'The map and whole-network numbers',
    purpose: 'What does the whole network look like, and is it different from chance?',
    shows: ['The map of who is tied to whom, colored by group or community', 'Whole-network numbers such as density and clustering, compared with random networks', 'Who stands out: most contacts, most often between others, closest to everyone'] },
  { id: 'people', label: 'People', group: 'explore', desc: 'Every person\u2019s measures, ranked',
    purpose: 'Who has the most ties, who connects groups, and who is close to everyone?',
    shows: ['Every person\u2019s measures in one table you can sort', 'How settled each ranking is when the data is resampled', 'A profile for each person with their contacts'] },
  { id: 'groups', label: 'Groups', group: 'explore', desc: 'Do ties stay inside groups?',
    purpose: 'Do ties stay inside departments, teams or communities, or cross them?',
    shows: ['How many ties run within and between each pair of groups', 'The E-I index and assortativity, compared with chance', 'Each group\u2019s size and how tied together it is'] },
  { id: 'content', label: 'Content', group: 'explore', desc: 'What people wrote about, and in what tone',
    purpose: 'What did people write about, and in what tone?',
    shows: ['The tone of messages by person, group or week', 'Distinctive words and recurring topics', 'Whether new words spread along ties'] },
  { id: 'time', label: 'Time', group: 'explore', desc: 'How the network changed',
    purpose: 'How did the network change over time?',
    shows: ['Measures week by week (or day, or month)', 'Weeks that stand out from the ones before them', 'A before and after comparison around a date you choose'] },
  { id: 'methods', label: 'Methods & Export', group: 'report', sep: true, desc: 'Methods appendix, network files and projects' },
  { id: 'ask', label: 'Ask', group: 'report', desc: 'Questions in plain language (optional AI)' },
  { id: 'learn', label: 'Learn', group: 'learn', sep: true, desc: 'The ideas, the terms and worked examples' },
];

export const viewInfo = id => VIEWS.find(v => v.id === id) || null;

// The URL hash names the view, optionally with a Learn concept
// (#learn/betweenness) or parameters after "?" that the view reads itself
// (#build?example=two-cliques-broker, see docs/api/ui-core.md).
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const path = raw.split('?')[0];
  const [head, ...rest] = path.split('/');
  const view = VIEWS.some(v => v.id === head) ? head : null;
  let key = null;
  if (view === 'learn' && rest.length) { try { key = decodeURIComponent(rest.join('/')) || null; } catch { key = null; } }
  return { view, key };
}

// Short display name for what is loaded: the dataset name without its
// parenthetical detail ("Synthetic workplace (slack, ...)" -> "Synthetic workplace").
export function shortName(name, max = 32) {
  // Drop parentheticals (file details) but keep a survey's combine rule, so
  // "Shared survey (union)" and "(reciprocated only)" stay distinguishable (C13).
  let s = String(name || 'Untitled').replace(/\s*\(([^)]*)\)\s*/g, (m, inner) => (/^(union|reciprocated( only)?|as reported)$/i.test(inner.trim()) ? ` (${inner.trim()}) ` : ' ')).replace(/\s+/g, ' ').trim() || String(name || 'Untitled');
  // Shorten the name, never the combine rule after it.
  const m = s.match(/\s\((union|reciprocated( only)?|as reported)\)$/i);
  const tail = m ? m[0] : '';
  let base = tail ? s.slice(0, -tail.length) : s;
  const room = Math.max(8, max - tail.length);
  if (base.length > room) base = `${base.slice(0, room - 1).replace(/[\s,;:+-]+\S*$/, '')}\u2026`;
  return base + tail;
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
  // The same notice twice (a download announced by the shared helper and by
  // its view) shows once: the older copy goes.
  for (const o of store.get().notices || []) if (o.level === level && o.text === String(text)) dismiss(o.id);
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
  // 'learn/<key>' opens Learn at that concept.
  let key = null;
  if (typeof view === 'string' && view.startsWith('learn/')) ({ view, key } = parseHash(view));
  if (!VIEWS.some(v => v.id === view)) view = 'data';
  if (hasDOM) {
    const cur = parseHash(location.hash);
    // Keep any "?..." parameters when the view is unchanged (the view reads them).
    if (cur.view !== view || (view === 'learn' && cur.key !== key)) {
      const target = view === 'learn' && key ? `learn/${encodeURIComponent(key)}` : view;
      history.replaceState(null, '', `${location.pathname}${location.search}#${target}`);
    }
  }
  store.set({ view, learnKey: view === 'learn' ? key : store.get().learnKey, __focusOnView: focus && !key, ui: { ...(store.get().ui || {}), menuOpen: false } });
  if (focus && hasDOM) window.scrollTo({ top: 0 });
}

// The Explanations switch: store field plus the one localStorage preference.
function setExplain(on) {
  store.set({ explain: !!on });
  writeExplainPref(!!on);
  announce(on ? 'Explanations on.' : 'Explanations off.');
}

// The sample organization (the Data view's preset of Generate), loadable from
// any empty state. The generator hands off to Network; return to the view
// the reader asked from, so "explore the sample" fills the page they are on.
async function loadSample() {
  const back = store.get().view;
  try {
    const [{ SAMPLE_SPEC }, { generateAndAnalyze }] = await Promise.all([import('./views/data.js'), import('./generate/index.js')]);
    await generateAndAnalyze(SAMPLE_SPEC);
  } catch (e) {
    notify('error', `Could not load the sample: ${e.message}`);
    return false;
  }
  const ok = !!store.get().dataset;
  if (ok && !['data', 'generate', 'build'].includes(back) && store.get().view !== back) setView(back);
  return ok;
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
// What a rebuild changed (D9). The wording lives in lib/rebuild.js so it can be
// tested (N16, N17); RULE_LABEL is re-exported for the views that import it here.
export { RULE_LABEL, rebuildSummary, settingsChanges } from './lib/rebuild.js';
import { rebuildSummary } from './lib/rebuild.js';

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
    loadDataset, rebuild, setView, select, notify, dismiss, runJob, startOver, announce, pauseNotices, resumeNotices, setExplain, loadSample,
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
