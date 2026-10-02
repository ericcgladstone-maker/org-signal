// Small, cheap readers over a Dataset for the UI: labels, attribute choices,
// time extents, histograms and "which construction rules have evidence".
// Anything heavier than a single pass over the event columns belongs in the
// analysis engine, not here.

import { EVENT_TYPES, ROLES, VISIBILITY } from '../../core/model.js';

export const RULES = ['reply', 'mention', 'dm', 'to', 'cc', 'bcc', 'adjacency', 'copresence', 'declared', 'repost', 'like', 'follow', 'reaction'];

export const RULE_TEXT = {
  reply: 'A replies to B',
  mention: 'A mentions B',
  dm: 'A sends B a direct message',
  to: 'A emails B (To)',
  cc: 'A copies B (Cc)',
  bcc: 'A blind-copies B (Bcc)',
  adjacency: 'A posts right after B in the same conversation',
  copresence: 'A and B attend the same meeting or share a small space',
  declared: 'A names B in a survey or hand-built network',
  repost: 'A reposts B',
  like: 'A likes B',
  follow: 'A follows B',
  reaction: 'A reacts to B',
};

export function label(ds, i) {
  if (!ds || i == null || i < 0) return '';
  return ds.nodes.labels[i] ?? ds.nodes.keys[i];
}

// Attributes that can colour or group nodes: categorical-ish with few values,
// at least one of them shared by two or more people (so names, emails and
// other per-person labels are not offered as "groups").
const groupableCache = new WeakMap();
export function groupableAttributes(ds) {
  if (!ds) return [];
  if (groupableCache.has(ds)) return groupableCache.get(ds);
  const out = (ds.attributeSchema || []).filter(a => {
    if (!['categorical', 'boolean', 'ordinal'].includes(a.type)) return false;
    const k = a.values?.length ?? 0;
    if (k < 2 || k > 60) return false;
    let withValue = 0;
    for (const at of ds.nodes.attrs) if (at[a.key] !== undefined && at[a.key] !== null && at[a.key] !== '') withValue++;
    return withValue > k;
  });
  groupableCache.set(ds, out);
  return out;
}

export function numericAttributes(ds) {
  if (!ds) return [];
  return (ds.attributeSchema || []).filter(a => a.type === 'numeric' || a.type === 'ordinal');
}

// Values of a categorical attribute ordered by size over the whole dataset,
// then by name. This order is what fixes colour assignment.
export function orderedValues(ds, key) {
  const counts = new Map();
  for (const a of ds.nodes.attrs) {
    const v = a[key];
    if (v === undefined || v === null || v === '') continue;
    counts.set(String(v), (counts.get(String(v)) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]) => ({ value: v, count: n }));
}

export function timeExtent(ds) {
  let lo = Infinity, hi = -Infinity;
  const t = ds?.events?.t;
  if (!t) return [NaN, NaN];
  for (let i = 0; i < t.length; i++) { const x = t[i]; if (x === x) { if (x < lo) lo = x; if (x > hi) hi = x; } }
  return lo === Infinity ? [NaN, NaN] : [lo, hi];
}

export function sourceStats(ds) {
  const n = ds.meta.sources.length;
  const out = Array.from({ length: n }, () => ({ lo: Infinity, hi: -Infinity, events: 0, undated: 0, text: 0, actors: new Set() }));
  const { t, source, actor, text } = ds.events;
  for (let i = 0; i < ds.events.count; i++) {
    const s = out[source[i]];
    if (!s) continue;
    s.events++;
    s.actors.add(actor[i]);
    const x = t[i];
    if (x === x) { if (x < s.lo) s.lo = x; if (x > s.hi) s.hi = x; } else s.undated++;
    if (text[i]) s.text++;
  }
  return out.map(s => ({ ...s, actors: s.actors.size, lo: s.lo === Infinity ? NaN : s.lo, hi: s.hi === -Infinity ? NaN : s.hi }));
}

// Counts of events per bin across [lo, hi]. Returns { lo, hi, bins: Int32Array, step }.
export function activityHistogram(ds, nbins = 60) {
  const [lo, hi] = timeExtent(ds);
  const bins = new Int32Array(nbins);
  if (!Number.isFinite(lo) || hi <= lo) return { lo, hi, bins, step: 0 };
  const step = (hi - lo) / nbins;
  const t = ds.events.t;
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (x === x) bins[Math.min(nbins - 1, Math.floor((x - lo) / step))]++;
  }
  return { lo, hi, bins, step };
}

export function hasText(ds) {
  const tx = ds?.events?.text;
  if (!tx) return false;
  let n = 0;
  for (let i = 0; i < tx.length; i++) if (tx[i]) { if (++n >= 5) return true; }
  return false;
}

export function textCoverage(ds) {
  const tx = ds.events.text;
  let n = 0, m = 0;
  for (let i = 0; i < tx.length; i++) if (EVENT_TYPES[ds.events.type[i]] === 'message') { m++; if (tx[i]) n++; }
  return m ? n / m : 0;
}

// How many events could feed each construction rule. Used to grey out rules
// with no evidence in the drawer. One pass over events and targets.
export function ruleEvidence(ds) {
  const out = Object.fromEntries(RULES.map(r => [r, 0]));
  if (!ds) return out;
  const e = ds.events;
  const typeName = EVENT_TYPES;
  for (let i = 0; i < e.count; i++) {
    const ty = typeName[e.type[i]];
    const a = e.tOff[i], b = e.tOff[i + 1];
    if (ty === 'copresence') out.copresence++;
    else if (ty === 'declared') out.declared++;
    else if (ty === 'repost') out.repost++;
    else if (ty === 'like') out.like++;
    else if (ty === 'follow') out.follow++;
    else if (ty === 'reaction') out.reaction++;
    if (ty === 'message' && e.context[i] >= 0) out.adjacency++;
    for (let j = a; j < b; j++) {
      const r = ROLES[e.role[j]];
      if (r in out && ty === 'message') out[r]++;
      else if (r === 'attendee') out.copresence++;
      else if (r === 'declared' && ty !== 'declared') out.declared++;
    }
  }
  return out;
}

export function visibilityPresent(ds) {
  const seen = new Set();
  for (let c = 0; c < ds.contexts.count; c++) seen.add(VISIBILITY[ds.contexts.visibility[c]]);
  return VISIBILITY.filter(v => seen.has(v));
}

export function mediaPresent(ds) {
  const seen = new Set(ds.contexts.medium.filter(Boolean));
  for (const s of ds.meta.sources) if (s.medium) seen.add(s.medium);
  return [...seen];
}

export function botCount(ds) {
  let n = 0;
  for (let i = 0; i < ds.nodes.count; i++) n += ds.nodes.isBot[i];
  return n;
}

// What a source's view lets you conclude. Shown in the import report beside
// the counts so nobody reads an ego export as an organisation chart.
export const VIEW_TEXT = {
  full: {
    name: 'Full network',
    can: 'Whole-network structure for the bounded group: centrality, brokerage, communities and group mixing.',
    cannot: 'Ties that happened outside this system or this group, and anyone who never used it.',
  },
  ego: {
    name: 'Ego network',
    can: 'Who this person interacts with, how often, and how their contacts cluster.',
    cannot: 'Ties among other people that the owner did not see, so whole-network measures (betweenness, communities across the organisation) are not meaningful.',
  },
  chat: {
    name: 'Single conversation',
    can: 'Who speaks to whom inside this one conversation and how that changes over time.',
    cannot: 'Anything about relationships outside this conversation.',
  },
  sample: {
    name: 'Sample',
    can: 'Patterns that hold within the sample, with the sampling frame stated.',
    cannot: 'Exact positions in the full population; centrality ranks are sample-dependent.',
  },
  authored: {
    name: 'Authored only',
    can: 'What one account wrote and whom it addressed.',
    cannot: 'Replies or activity by anyone else, so ties are one-sided by construction.',
  },
};
