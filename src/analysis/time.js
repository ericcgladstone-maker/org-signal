// Networks over time: windowed series, shift detection, before/after.
//
// Each window rebuilds the network from that window's events with the same
// construction settings (forEachEvidence over an event subset), so a tie in
// week 3 means exactly what a tie in the full network means. Turn-taking
// across a window boundary is not counted.

import { buildNetwork, normalizeSettings } from './construct.js';
import { computeNodeMetrics } from './metrics.js';
import { computeNetworkMetrics } from './network.js';
import { createRng } from './rng.js';
import { quantile } from './uncertainty.js';

const DAY = 86400000;
const COUNT_METRICS = new Set(['degree', 'inDegree', 'outDegree', 'strength', 'inStrength', 'outStrength']);

// ---- windows -------------------------------------------------------------------

export function makeWindows(tMin, tMax, window = 'week', step = null) {
  const out = [];
  if (!(tMax >= tMin)) return out;
  if (typeof window === 'number' || (typeof window === 'object' && window)) {
    const size = typeof window === 'number' ? window : window.size;
    const st = step || (typeof window === 'object' && window.step) || size;
    for (let s = tMin; s <= tMax; s += st) out.push({ start: s, end: s + size, label: new Date(s).toISOString().slice(0, 16).replace('T', ' ') });
    return out;
  }
  let s = floorTo(tMin, window);
  while (s <= tMax) {
    const e = addUnit(s, window);
    out.push({ start: s, end: e, label: labelFor(s, window) });
    s = e;
  }
  return out;
}

export function floorTo(t, unit) {
  const d = new Date(t);
  if (unit === 'day') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (unit === 'week') { const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); return day - ((d.getUTCDay() + 6) % 7) * DAY; } // Monday
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  throw new Error(`Unknown window unit: ${unit}`);
}
function addUnit(t, unit) {
  if (unit === 'day') return t + DAY;
  if (unit === 'week') return t + 7 * DAY;
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}
function labelFor(t, unit) {
  const iso = new Date(t).toISOString();
  if (unit === 'month') return iso.slice(0, 7);
  if (unit === 'week') return 'w/c ' + iso.slice(0, 10);
  return iso.slice(0, 10);
}

// Timed event indices sorted by time, plus their times, within [start, end).
export function sortedEvents(ds, start = null, end = null) {
  const ev = ds.events;
  const idx = [];
  for (let i = 0; i < ev.count; i++) {
    const t = ev.t[i];
    if (!Number.isFinite(t)) continue;
    if (start != null && t < start) continue;
    if (end != null && t >= end) continue;
    idx.push(i);
  }
  idx.sort((a, b) => ev.t[a] - ev.t[b] || a - b);
  const order = Int32Array.from(idx);
  const times = Float64Array.from(idx, i => ev.t[i]);
  return { order, times };
}

function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

export function eventsBetween(sorted, start, end) {
  return sorted.order.subarray(lowerBound(sorted.times, start), lowerBound(sorted.times, end));
}

// ---- timeSeries ------------------------------------------------------------------

// opts: { window: 'day'|'week'|'month'|ms|{size, step}, step, start, end,
//         metrics: node metrics per window (default degree, strength),
//         network: true, attr: group activity by this attribute, maxWindows, onProgress }
export function timeSeries(ds, settings, opts = {}) {
  const s = normalizeSettings(ds, settings);
  const progress = opts.onProgress || (() => {});
  const start = opts.start ?? s.time?.start ?? null, end = opts.end ?? s.time?.end ?? null;
  const sorted = sortedEvents(ds, start, end);
  const N = ds.nodes.count;
  if (!sorted.order.length) return { windows: [], node: {}, network: {}, ties: { formed: [], dissolved: [], persisted: [], jaccard: [] }, activity: { node: [], total: [] }, meta: { empty: true } };
  const tMin = start ?? sorted.times[0], tMax = (end != null ? end - 1 : sorted.times[sorted.times.length - 1]);
  let windows = makeWindows(tMin, tMax, opts.window ?? 'week', opts.step ?? null);
  const maxW = opts.maxWindows ?? 520;
  if (windows.length > maxW) throw new Error(`${windows.length} windows requested; the limit is ${maxW}. Use a longer window.`);
  const metrics = opts.metrics ?? ['degree', 'strength'];
  const node = Object.fromEntries(metrics.map(m => [m, []]));
  const network = {};
  const ties = { formed: [], dissolved: [], persisted: [], jaccard: [] };
  const activity = { node: [], total: [] };
  let groupInfo = null;
  if (opts.attr) {
    const values = [...new Set(ds.nodes.attrs.map(a => a?.[opts.attr]).filter(v => v !== undefined && v !== null && v !== '').map(String))].sort();
    const vi = new Map(values.map((v, i) => [v, i]));
    const code = Int32Array.from(ds.nodes.attrs, a => (a?.[opts.attr] == null ? -1 : vi.get(String(a[opts.attr])) ?? -1));
    const sizes = new Array(values.length).fill(0);
    for (const c of code) if (c >= 0) sizes[c]++;
    groupInfo = { attr: opts.attr, values, sizes, code, counts: values.map(() => []), ties: values.map(() => []) };
  }
  const wSettings = { ...s, time: { start: null, end: null }, includeIsolates: false };
  const nodeOk = (i) => !(s.excludeBots && ds.nodes.isBot[i]);
  let prevKeys = null;
  windows.forEach((win, wi) => {
    const evs = eventsBetween(sorted, win.start, win.end);
    const net = buildNetwork(ds, wSettings, { events: evs });
    win.events = evs.length; win.nodes = net.n; win.ties = net.edges.count;
    // Share of the window inside the observed period: the first and last
    // windows are usually partial, and their low counts are not shifts.
    win.coverage = Math.max(0, Math.min(win.end, tMax + 1) - Math.max(win.start, tMin)) / (win.end - win.start);
    const nm = metrics.length && net.n ? computeNodeMetrics(net, { which: metrics, approx: opts.approx ?? 'auto', seed: opts.seed ?? 1 }) : {};
    for (const m of metrics) {
      const arr = new Float64Array(N).fill(COUNT_METRICS.has(m) ? 0 : NaN);
      if (nm[m]) for (let v = 0; v < net.n; v++) arr[net.nodeIds[v]] = nm[m][v];
      node[m].push(arr);
    }
    if (opts.network !== false) {
      const r = net.n ? computeNetworkMetrics(net, { pathSources: Math.min(net.n, 200) }) : {};
      for (const [k, v] of Object.entries(r)) if (typeof v === 'number') (network[k] ||= new Array(windows.length).fill(NaN))[wi] = v;
    }
    // Share of ties that cross groups of opts.attr. A reorg or a silo changes
    // who talks to whom more than how much, and shows up here first.
    if (groupInfo) {
      let cross = 0, coded = 0;
      for (let e = 0; e < net.edges.count; e++) {
        const ga = groupInfo.code[net.nodeIds[net.edges.src[e]]], gb = groupInfo.code[net.nodeIds[net.edges.dst[e]]];
        if (ga < 0 || gb < 0) continue;
        coded++; if (ga !== gb) cross++;
      }
      (network.crossGroupShare ||= new Array(windows.length).fill(NaN))[wi] = coded ? cross / coded : NaN;
      (network.codedTies ||= new Array(windows.length).fill(NaN))[wi] = coded;
    }
    // Tie turnover between consecutive windows (dataset node pairs).
    const keys = new Set();
    for (let e = 0; e < net.edges.count; e++) keys.add(net.nodeIds[net.edges.src[e]] * N + net.nodeIds[net.edges.dst[e]]);
    if (prevKeys) {
      let kept = 0;
      for (const k of keys) if (prevKeys.has(k)) kept++;
      ties.formed.push(keys.size - kept); ties.dissolved.push(prevKeys.size - kept); ties.persisted.push(kept);
      const uni = keys.size + prevKeys.size - kept;
      ties.jaccard.push(uni ? kept / uni : NaN);
    } else { ties.formed.push(keys.size); ties.dissolved.push(0); ties.persisted.push(0); ties.jaccard.push(NaN); }
    prevKeys = keys;
    // Activity: events acted per person (any type), honouring bot exclusion.
    const act = new Float64Array(N);
    let tot = 0;
    for (let k = 0; k < evs.length; k++) { const a = ds.events.actor[evs[k]]; if (nodeOk(a)) { act[a]++; tot++; } }
    activity.node.push(act); activity.total.push(tot);
    if (groupInfo) {
      const c = new Array(groupInfo.values.length).fill(0);
      for (let i = 0; i < N; i++) if (act[i] && groupInfo.code[i] >= 0) c[groupInfo.code[i]] += act[i];
      groupInfo.values.forEach((_, g) => groupInfo.counts[g].push(c[g]));
    }
    progress((wi + 1) / windows.length, `window ${wi + 1}/${windows.length}`);
  });
  if (groupInfo) activity.group = { attr: groupInfo.attr, values: groupInfo.values, sizes: groupInfo.sizes, counts: groupInfo.counts };
  return { windows, node, network, ties, activity, meta: { window: opts.window ?? 'week', metrics, eventsInRange: sorted.order.length, undatedExcluded: countUndated(ds) } };
}

function countUndated(ds) {
  let c = 0;
  for (let i = 0; i < ds.events.count; i++) if (!Number.isFinite(ds.events.t[i])) c++;
  return c;
}

// ---- shifts ----------------------------------------------------------------------------

// Robust z of each window against the median and MAD of the preceding
// `baseline` windows. Flags |z| >= threshold, merging consecutive windows in
// the same direction into one shift. The scale has a floor (5% of the median,
// and the mean absolute deviation) so a perfectly flat baseline does not turn
// any change into an infinite z.
//
// count: true for count series (activity, ties, degree). Counts have Poisson
// noise of about sqrt(mean) even when recent windows happened to agree, so
// the scale is floored at sqrt(median) as well.
// noise: optional (t, median) -> sampling sd of window t, a further floor
// (binomial noise for shares computed from few ties).
export function robustShifts(x, { threshold = 3.5, baseline = 8, minBaseline = 4, count = false, noise = null } = {}) {
  const out = [];
  let run = null;
  for (let t = minBaseline; t < x.length; t++) {
    const base = [];
    for (let k = Math.max(0, t - baseline); k < t; k++) if (Number.isFinite(x[k])) base.push(x[k]);
    if (base.length < minBaseline || !Number.isFinite(x[t])) { run = null; continue; }
    base.sort((a, b) => a - b);
    const med = quantile(base, 0.5);
    const dev = base.map(v => Math.abs(v - med)).sort((a, b) => a - b);
    const mad = quantile(dev, 0.5) * 1.4826;
    const meanAbs = (dev.reduce((s, v) => s + v, 0) / dev.length) * 1.2533;
    const scale = Math.max(mad, meanAbs, 0.05 * Math.abs(med), count ? Math.sqrt(Math.max(med, 1)) : 0, noise ? noise(t, med) || 0 : 0, 1e-9);
    const z = (x[t] - med) / scale;
    if (Math.abs(z) >= threshold) {
      const dir = z > 0 ? 'up' : 'down';
      if (run && run.direction === dir && run.end === t - 1) { run.end = t; run.length++; if (Math.abs(z) > Math.abs(run.z)) { run.z = z; run.peak = t; } }
      else { run = { window: t, end: t, length: 1, value: x[t], baseline: med, z, peak: t, direction: dir }; out.push(run); }
    } else run = null;
  }
  return out;
}

// Two-sided tabular CUSUM on values standardised by the first `baseline`
// windows (median / MAD). k = allowance, h = decision threshold, in sd units.
// The scale gets the same floors as robustShifts (count, noise).
export function cusumShifts(x, { baseline = 8, k = 0.5, h = 5, count = false, noise = null } = {}) {
  const base = x.slice(0, baseline).filter(Number.isFinite).sort((a, b) => a - b);
  if (base.length < 3) return [];
  const med = quantile(base, 0.5);
  const dev = base.map(v => Math.abs(v - med)).sort((a, b) => a - b);
  const meanAbs = (dev.reduce((s2, v) => s2 + v, 0) / dev.length) * 1.2533;
  const scale = Math.max(quantile(dev, 0.5) * 1.4826, meanAbs, 0.05 * Math.abs(med), count ? Math.sqrt(Math.max(med, 1)) : 0, noise ? noise(Math.floor(baseline / 2), med) || 0 : 0, 1e-9);
  const out = [];
  let hi = 0, lo = 0, startHi = baseline, startLo = baseline;
  for (let t = baseline; t < x.length; t++) {
    if (!Number.isFinite(x[t])) continue;
    const z = (x[t] - med) / scale;
    if (hi === 0) startHi = t;
    if (lo === 0) startLo = t;
    hi = Math.max(0, hi + z - k); lo = Math.max(0, lo - z - k);
    if (hi > h) { out.push({ window: startHi, detected: t, direction: 'up', statistic: hi, baseline: med, value: x[t] }); hi = 0; }
    if (lo > h) { out.push({ window: startLo, detected: t, direction: 'down', statistic: lo, baseline: med, value: x[t] }); lo = 0; }
  }
  return out;
}

// series: the result of timeSeries(). Scans network metrics, tie turnover,
// group activity and (for the most active `topNodes` people) a node metric.
// opts: { method: 'robust'|'cusum', threshold, baseline, nodeMetric, topNodes, labels (ds.nodes.labels) }
export function detectShifts(series, opts = {}) {
  const method = opts.method || 'robust';
  const find = (x, count = false, thr = null, noise = null) => (method === 'cusum'
    ? cusumShifts(x, { baseline: opts.baseline ?? 8, h: thr ?? opts.threshold ?? 6, count, noise })
    : robustShifts(x, { threshold: thr ?? opts.threshold ?? 3.5, baseline: opts.baseline ?? 8, minBaseline: opts.minBaseline ?? 4, count, noise }));
  const W = series.windows || [];
  const minCov = opts.minCoverage ?? 0.6;
  const partial = W.map(w => (w.coverage ?? 1) < minCov);
  const out = [];
  const raw = find;
  const findMasked = (x, count, thr, noise) => { scanned++; return raw(Array.from(x, (v, i) => (partial[i] ? NaN : v)), count, thr, noise); };
  // Shares computed from m ties carry binomial noise sqrt(p(1-p)/m_eff).
  // Reciprocated ties come in pairs (m_eff = m/2) and each triangle closes
  // three triples (m_eff = m/3). Density from m ties has Poisson noise of
  // about density/sqrt(m).
  const tiesAt = (t) => Math.max(1, series.network?.ties?.[t] || 0);
  const binom = (div) => (t, med) => { const p = Math.min(0.95, Math.max(0.05, med)); return Math.sqrt(p * (1 - p) / Math.max(1, tiesAt(t) / div)); };
  const codedAt = (t) => Math.max(1, series.network?.codedTies?.[t] || tiesAt(t));
  const NOISE = {
    reciprocity: binom(2),
    transitivity: binom(3),
    density: (t, med) => Math.abs(med) / Math.sqrt(tiesAt(t)),
    crossGroupShare: (t, med) => { const p = Math.min(0.95, Math.max(0.05, med)); return Math.sqrt(p * (1 - p) / codedAt(t)); },
    tieRetention: binom(1),
  };
  let scanned = 0;
  // Scanning hundreds of people multiplies false alarms; node series use a
  // stricter threshold unless the caller sets one.
  const nodeThr = opts.nodeThreshold ?? (method === 'cusum' ? 12 : 5);
  const COUNTS = new Set(['ties', 'nodes', 'activity', 'degree', 'inDegree', 'outDegree']);
  const push = (target, id, label, metric, list) => {
    for (const s of list) out.push({ target, id, label, metric, ...s, start: W[s.window]?.start, windowLabel: W[s.window]?.label });
  };
  const netKeys = opts.networkMetrics || ['ties', 'density', 'reciprocity', 'transitivity', 'nodes', 'crossGroupShare'];
  for (const k of netKeys) if (series.network?.[k]) push('network', null, k === 'crossGroupShare' ? `cross-${series.activity?.group?.attr ?? 'group'} share of ties` : k, k, findMasked(series.network[k], COUNTS.has(k), null, NOISE[k] || null));
  // Tie turnover: the share of last window's ties that persist (Jaccard). Rewiring
  // without a change in volume (a reorg) shows up here and nowhere else.
  if (series.ties?.jaccard) push('network', null, 'tie retention (Jaccard with previous window)', 'tieRetention', findMasked(series.ties.jaccard, false, null, NOISE.tieRetention));
  if (series.ties?.dissolved) push('network', null, 'ties dissolved', 'tiesDissolved', findMasked([NaN, ...series.ties.dissolved.slice(1)], true));
  if (series.activity?.total) push('network', null, 'activity', 'activity', findMasked(series.activity.total, true));
  if (series.ties?.formed) push('network', null, 'ties formed', 'tiesFormed', findMasked([NaN, ...series.ties.formed.slice(1)], true));
  const grp = series.activity?.group;
  // Every group is scanned separately, so like node series they get a stricter
  // threshold: on flat synthetic workplaces the default threshold raised about
  // 0.8 false alarms per dataset from group activity alone.
  const groupThr = opts.groupThreshold ?? (method === 'cusum' ? 9 : 4.5);
  if (grp) grp.values.forEach((v, g) => push('group', v, `${grp.attr} = ${v}`, 'activity', findMasked(grp.counts[g], true, groupThr)));
  const metric = opts.nodeMetric || Object.keys(series.node || {})[0];
  if (metric && series.node?.[metric]?.length) {
    const arrs = series.node[metric];
    const N = arrs[0].length;
    const total = new Float64Array(N);
    for (const act of series.activity?.node || []) for (let i = 0; i < N; i++) total[i] += act[i];
    const top = Array.from({ length: N }, (_, i) => i).filter(i => total[i] > 0).sort((a, b) => total[b] - total[a]).slice(0, opts.topNodes ?? 200);
    for (const i of top) push('node', i, opts.labels?.[i] ?? String(i), metric, findMasked(arrs.map(a => a[i]), COUNTS.has(metric), nodeThr));
  }
  out.sort((a, b) => Math.abs(b.z ?? b.statistic) - Math.abs(a.z ?? a.statistic));
  return { shifts: out, meta: { method, threshold: opts.threshold ?? (method === 'cusum' ? 6 : 3.5), nodeThreshold: nodeThr, groupThreshold: groupThr, baseline: opts.baseline ?? 8, windows: W.length, seriesScanned: scanned, partialWindowsSkipped: partial.filter(Boolean).length } };
}

// ---- before / after -------------------------------------------------------------------

// Compare equal-length periods either side of `date` (ms). opts: { span (ms),
// metrics, attr, reps (permutation reps), seed, approx }.
export function compareBeforeAfter(ds, settings, date, opts = {}) {
  const s = normalizeSettings(ds, settings);
  const sorted = sortedEvents(ds, s.time?.start ?? null, s.time?.end ?? null);
  if (!sorted.times.length) throw new Error('No dated events.');
  const t0 = sorted.times[0], t1 = sorted.times[sorted.times.length - 1] + 1;
  const span = opts.span ?? Math.min(date - t0, t1 - date);
  if (!(span > 0)) throw new Error('The date must fall inside the data with events on both sides.');
  const wSettings = { ...s, time: { start: null, end: null }, includeIsolates: false };
  const before = buildNetwork(ds, wSettings, { events: eventsBetween(sorted, date - span, date) });
  const after = buildNetwork(ds, wSettings, { events: eventsBetween(sorted, date, date + span) });
  const metrics = opts.metrics ?? ['degree', 'strength', 'betweenness', 'constraint'];
  const mb = before.n ? computeNodeMetrics(before, { which: metrics, approx: opts.approx ?? 'auto' }) : {};
  const ma = after.n ? computeNodeMetrics(after, { which: metrics, approx: opts.approx ?? 'auto' }) : {};
  const N = ds.nodes.count;
  const people = new Set([...before.nodeIds, ...after.nodeIds]);
  const rng = createRng(opts.seed ?? 1);
  const reps = opts.reps ?? 2000;
  const node = {};
  for (const m of metrics) {
    const pairs = [];
    for (const i of people) {
      const jb = before.index[i], ja = after.index[i];
      let xb = jb >= 0 && mb[m] ? mb[m][jb] : COUNT_METRICS.has(m) ? 0 : NaN;
      let xa = ja >= 0 && ma[m] ? ma[m][ja] : COUNT_METRICS.has(m) ? 0 : NaN;
      if (Number.isFinite(xb) && Number.isFinite(xa)) pairs.push({ node: i, before: xb, after: xa, diff: xa - xb });
    }
    node[m] = pairedSummary(pairs, rng, reps, ds);
  }
  const nb = before.n ? computeNetworkMetrics(before) : {}, na = after.n ? computeNetworkMetrics(after) : {};
  const network = {};
  for (const k of Object.keys({ ...nb, ...na })) if (typeof (nb[k] ?? na[k]) === 'number') network[k] = { before: nb[k], after: na[k], diff: (na[k] ?? NaN) - (nb[k] ?? NaN) };
  // Tie turnover across the date.
  const key = (net, e) => net.nodeIds[net.edges.src[e]] * N + net.nodeIds[net.edges.dst[e]];
  const kb = new Set(), ka = new Set();
  for (let e = 0; e < before.edges.count; e++) kb.add(key(before, e));
  for (let e = 0; e < after.edges.count; e++) ka.add(key(after, e));
  let kept = 0;
  for (const k of ka) if (kb.has(k)) kept++;
  const res = {
    date, span, before: { start: date - span, end: date, nodes: before.n, ties: before.edges.count }, after: { start: date, end: date + span, nodes: after.n, ties: after.edges.count },
    node, network,
    ties: { formed: ka.size - kept, dissolved: kb.size - kept, persisted: kept, jaccard: ka.size + kb.size - kept ? kept / (ka.size + kb.size - kept) : NaN },
    meta: { test: 'paired sign-flip permutation test on per-person differences', reps, effectSize: "Cohen's d_z = mean difference / sd of differences" },
  };
  if (opts.attr) {
    const groups = new Map();
    const countIn = (a0, a1) => { const c = new Map(); for (const i of eventsBetween(sorted, a0, a1)) { const v = ds.nodes.attrs[ds.events.actor[i]]?.[opts.attr]; if (v != null) c.set(String(v), (c.get(String(v)) || 0) + 1); } return c; };
    const cb = countIn(date - span, date), ca = countIn(date, date + span);
    for (const v of new Set([...cb.keys(), ...ca.keys()])) groups.set(v, { value: v, before: cb.get(v) || 0, after: ca.get(v) || 0 });
    res.groups = [...groups.values()].map(g => ({ ...g, ratio: g.before ? g.after / g.before : NaN })).sort((a, b) => (a.value < b.value ? -1 : 1));
  }
  return res;
}

function pairedSummary(pairs, rng, reps, ds) {
  const k = pairs.length;
  if (!k) return { n: 0 };
  let mb = 0, ma = 0, md = 0;
  for (const p of pairs) { mb += p.before; ma += p.after; md += p.diff; }
  mb /= k; ma /= k; md /= k;
  let v = 0;
  for (const p of pairs) v += (p.diff - md) ** 2;
  const sd = k > 1 ? Math.sqrt(v / (k - 1)) : 0;
  // Sign-flip permutation test of mean difference = 0.
  let extreme = 0;
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (const p of pairs) s += rng() < 0.5 ? p.diff : -p.diff;
    if (Math.abs(s / k) >= Math.abs(md) - 1e-12) extreme++;
  }
  const sortedP = [...pairs].sort((a, b) => b.diff - a.diff);
  const lab = (p) => ({ ...p, label: ds.nodes.labels[p.node] });
  return {
    n: k, meanBefore: mb, meanAfter: ma, meanDiff: md, sdDiff: sd,
    dz: sd > 0 ? md / sd : NaN,
    p: (extreme + 1) / (reps + 1),
    topIncreases: sortedP.slice(0, 10).filter(p => p.diff > 0).map(lab),
    topDecreases: sortedP.slice(-10).reverse().filter(p => p.diff < 0).map(lab),
  };
}
