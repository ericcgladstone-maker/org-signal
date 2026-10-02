// Small derivations over the engine's node metrics that the Network and
// People views share: distinct contacts, ranks that admit ties, and the
// labels a measure takes on a directed network.

import { gloss } from '../services/glossary.js';
import { fmtInt } from './format.js';

// Distinct people tied to each person, in either direction.
//
// The engine's degree on a directed network is in + out (networkx), so a
// two-way tie counts twice. Node reciprocity is 2|in AND out| / (in + out),
// which gives the overlap exactly: contacts = degree - reciprocity * degree / 2.
// On an undirected network degree already counts each neighbor once.
export function contactsOf(node, directed) {
  const deg = node?.degree;
  if (!deg) return null;
  const out = new Float64Array(deg.length);
  const rec = node.reciprocity;
  for (let v = 0; v < deg.length; v++) {
    const d = deg[v];
    if (!Number.isFinite(d)) { out[v] = NaN; continue; }
    const r = directed && rec && Number.isFinite(rec[v]) ? rec[v] : 0;
    out[v] = Math.round(d - (r * d) / 2);
  }
  return out;
}

// The node metric map with `contacts` added in front, computed once per
// metrics object.
const withCache = new WeakMap();
export function withContacts(node, directed) {
  if (!node) return node;
  const hit = withCache.get(node);
  if (hit && hit.directed === directed) return hit.value;
  const contacts = contactsOf(node, directed);
  const value = contacts ? { contacts, ...node } : node;
  withCache.set(node, { directed, value });
  return value;
}

// Measure label for display. Degree on a directed network is the total of
// ties in and out, which is not a head count; say so in the name.
export function metricLabel(key, directed) {
  if (key === 'degree' && directed) return 'Total ties (in + out)';
  return gloss(key).label;
}

// Competition rank (1 = highest) with ties made visible.
// Returns { rank, last, n, tied } where rank..last is the span of positions
// people with this value share, or null when the value is undefined.
export function rankInfo(arr, v) {
  const x = arr?.[v];
  if (!Number.isFinite(x)) return null;
  let above = 0, same = 0, n = 0;
  for (let j = 0; j < arr.length; j++) {
    const y = arr[j];
    if (!Number.isFinite(y)) continue;
    n++;
    if (y > x) above++; else if (y === x) same++;
  }
  return { rank: above + 1, last: above + same, n, tied: same - 1 };
}

export function fmtRank(info) {
  if (!info) return 'not defined for this person';
  const { rank, last, n, tied } = info;
  if (tied <= 0) return `rank ${fmtInt(rank)} of ${fmtInt(n)}`;
  if (tied + 1 === n) return `same value for all ${fmtInt(n)} people`;
  return `rank ${fmtInt(rank)} to ${fmtInt(last)} of ${fmtInt(n)} (shared by ${fmtInt(tied + 1)} people)`;
}

// Measures the engine can resample for rank intervals.
export const RESAMPLABLE = ['degree', 'strength', 'betweenness', 'closeness', 'pagerank', 'eigenvector', 'constraint'];

// Node keys that are generated ids rather than something the user knows
// (a drawn node's "draw:n987846954f"); views show the key only otherwise.
export function displayKey(key) {
  const k = String(key ?? '');
  if (/^(draw|alter|ego|roster|paste|cs):/i.test(k)) return null;
  return k;
}

// Departed or deactivated accounts, as importers record them.
export function isDeactivated(ds, i) {
  const a = ds?.nodes?.attrs?.[i];
  return !!(a && (a.deactivated === true || a.deactivated === 'true'));
}

// Monthly values for one person. Months the data covers only in part (the
// first and last month of an export) are dropped: a month that is 9% covered
// shows a fall to zero that never happened. The value label is the latest
// month with a value.
export function sparkSeries(data, i, keys = ['degree', 'strength', 'betweenness']) {
  const keep = (data.windows || []).map((w, k) => ({ w, k })).filter(({ w }) => !(Number.isFinite(w.coverage) && w.coverage < 0.5));
  const metrics = keys.filter(m => data.node?.[m]).map(m => {
    const values = keep.map(({ w, k }) => ({ x: w.start, y: data.node[m][k]?.[i] ?? NaN }));
    const last = [...values].reverse().find(p => Number.isFinite(p.y)) || null;
    return { key: m, values, last };
  }).filter(m => m.values.some(p => Number.isFinite(p.y)));
  return { windows: keep.map(x => x.w), metrics };
}
