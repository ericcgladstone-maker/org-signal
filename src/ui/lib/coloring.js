// What the people are colored by, shared by the Network map and the People
// swatches (L6, N21): one choice, one assignment of colors, so Sales is the
// same hue in both views. The choice lives here (not in either view) and is
// reset per dataset to the default grouping.

import { sequentialScale, tokens } from './palette.js';
import { groupColoring } from './grouping.js';
import { orderedValues, defaultGroupAttr, isBookkeeping } from './dsutil.js';
import { fmtAttr, humanize } from './format.js';

let choice = { ds: null, value: null };

// The same default as Groups (defaultGroupAttr): a coarse department-like
// attribute, else the communities.
export function defaultColor(ds, communities, attrs, net = null) {
  // Two-mode view: which kind of node each one is comes first.
  if (net?.twoMode?.view === 'two-mode' && net.twoMode.mode) return 'mode';
  const key = defaultGroupAttr(ds, { communities });
  if (key && attrs.some(a => a.key === key)) return `attr:${key}`;
  if (communities) return 'community';
  const plain = attrs.filter(x => !isBookkeeping(x));
  const a = plain.find(x => (x.values?.length ?? 0) <= 8) || plain[0];
  return a ? `attr:${a.key}` : 'none';
}

// net (optional): the current network, so a two-mode view starts colored by
// mode and a choice of 'mode' falls back once the view has one mode only.
export function getColorBy(ds, communities, attrs, net = null) {
  const modeGone = choice.value === 'mode' && !(net?.twoMode?.view === 'two-mode' && net.twoMode.mode);
  const modeNew = net?.twoMode?.view === 'two-mode' && choice.view !== 'two-mode';
  if (choice.ds !== ds || choice.value == null || modeGone || modeNew) choice = { ds, value: defaultColor(ds, communities, attrs, net) };
  choice.view = net?.twoMode?.view ?? null;
  return choice.value;
}

export function setColorBy(ds, value) { choice = { ...choice, ds, value }; }

// Coloring over network indices (0..net.n-1).
//   { kind: 'cat' | 'seq' | 'none', gc, of(v), key(v), title, community, scale, metric }
// label(k) names a measure for the sequential case.
export function nodeColoring({ ds, net, communities, colorBy, attrs = [], nodeMetrics = null, label = k => k }) {
  const t = tokens();
  const dsOf = v => (net.nodeIds ? net.nodeIds[v] : v);
  if (colorBy === 'mode' && net?.twoMode?.mode) {
    // Two-mode networks: the two kinds of node (women and events), named.
    const tm = net.twoMode;
    const counts = [0, 0];
    for (let v = 0; v < net.n; v++) counts[tm.mode[v]]++;
    const gc = groupColoring([0, 1].map(m => ({ value: String(m), label: tm.labels[m], count: counts[m] })));
    const key = v => String(tm.mode[v]);
    return { kind: 'cat', mode: true, gc, of: v => gc.color(key(v)), key, title: 'Kind of node (two-mode)', short: 'kind of node', labels: tm.labels };
  }
  if (colorBy === 'community' && communities?.membership) {
    const k = communities.count ?? 0;
    const sizes = communities.sizes || Array.from({ length: k }, (_, i) => communities.membership.filter(m => m === i).length);
    const key = v => String(communities.membership[v]);
    const gc = groupColoring(Array.from({ length: k }, (_, c) => ({ value: String(c), label: `Community ${c + 1}`, count: sizes[c] })));
    return { kind: 'cat', community: true, gc, of: v => gc.color(key(v)), key, title: 'Community (found by Louvain)', short: 'community' };
  }
  if (colorBy?.startsWith('attr:')) {
    const key = colorBy.slice(5);
    const ov = orderedValues(ds, key);
    const a = attrs.find(x => x.key === key);
    // Color order comes from the whole dataset (so colors never shift); the
    // counts shown are the people actually in this network, so an excluded
    // bot or filtered-out person is not listed as "Not recorded".
    const inNet = new Map();
    let missing = 0;
    for (let v = 0; v < net.n; v++) {
      const x = ds.nodes.attrs[dsOf(v)]?.[key];
      if (x == null || x === '') missing++; else inNet.set(String(x), (inNet.get(String(x)) || 0) + 1);
    }
    const gc = groupColoring(ov.map(o => ({ value: o.value, label: fmtAttr(key, o.value), count: inNet.get(String(o.value)) || 0 })), { missing });
    const keyOf = v => { const x = ds.nodes.attrs[dsOf(v)]?.[key]; return x == null || x === '' ? '' : String(x); };
    const title = a?.label || humanize(key);
    return { kind: 'cat', gc, of: v => gc.color(keyOf(v)), key: keyOf, title, short: title.toLowerCase() };
  }
  if (colorBy?.startsWith('metric:')) {
    const m = colorBy.slice(7);
    const arr = nodeMetrics?.[m];
    if (!arr) return { kind: 'none', of: () => t.node, title: null };
    const fin = Array.from(arr).filter(Number.isFinite);
    const sc = sequentialScale(Math.min(...fin), Math.max(...fin));
    return { kind: 'seq', of: v => sc(arr[v]), scale: sc, title: label(m), short: label(m).toLowerCase(), metric: m };
  }
  return { kind: 'none', of: () => t.node, title: null };
}
