// Perceived networks: cognitive social structures (Krackhardt 1987).
//
// Each informant k reports the whole network as they see it: a directed binary
// matrix R_k over the same roster. From the stack of reports:
//   LAS (locally aggregated structure): the tie i->j is decided only by the two
//     people involved, informant i (about their own tie) and informant j.
//       union        R_i(i,j) OR  R_j(i,j)
//       intersection R_i(i,j) AND R_j(i,j)
//     A person without their own report contributes nothing (union then rests on
//     the other side; intersection is absent). Those people are listed.
//   Consensus structure: i->j is present when the share of informants reporting
//     it is at least the threshold (0.5 = at least half of the informants).
// Accuracy compares one informant's matrix with a criterion (the consensus, or
// an observed reference network) over all ordered pairs i != j.
//
// Model (plain JSON):
//   { version, name, people: [{ id, label }], relation: { name, question },
//     informants: [{ id, personId|null, label, ties: { 'i|j': 1 } }] }

import { DatasetBuilder, eventTargets } from '../core/model.js';
import { uid, slug, normName } from './common.js';
import { pairKey, splitKey, orderedPairs, nameIndex } from './matrix.js';

export function newCSS() {
  return { version: 1, name: 'Perceived network', people: [], relation: { name: 'Advice', question: 'Who goes to whom for advice?' }, informants: [] };
}

export function addInformant(css, personId = null) {
  const p = css.people.find(x => x.id === personId);
  const inf = { id: uid('i'), personId: p ? p.id : null, label: p ? p.label : `Informant ${css.informants.length + 1}`, ties: {} };
  return { ...css, informants: [...css.informants, inf] };
}

const has = (ties, i, j) => !!ties[pairKey(i, j)];

// Share of informants reporting each ordered pair: Map('i|j' -> share).
export function agreement(css) {
  const n = css.informants.length;
  const out = new Map();
  if (!n) return out;
  for (const [i, j] of orderedPairs(css.people)) {
    let c = 0;
    for (const inf of css.informants) if (has(inf.ties, i, j)) c++;
    out.set(pairKey(i, j), c / n);
  }
  return out;
}

export function consensus(css, threshold = 0.5) {
  const ties = {};
  // A tiny epsilon keeps 0.5 * 2 / 4 style shares from falling under the
  // threshold through floating-point error.
  for (const [k, p] of agreement(css)) if (p > 0 && p >= threshold - 1e-12) ties[k] = 1;
  return ties;
}

export function las(css, rule = 'union') {
  const own = new Map();
  for (const inf of css.informants) if (inf.personId) own.set(inf.personId, inf.ties);
  const ties = {};
  for (const [i, j] of orderedPairs(css.people)) {
    const a = own.has(i) ? has(own.get(i), i, j) : null;
    const b = own.has(j) ? has(own.get(j), i, j) : null;
    const on = rule === 'intersection' ? a === true && b === true : a === true || b === true;
    if (on) ties[pairKey(i, j)] = 1;
  }
  const missing = css.people.filter(p => !own.has(p.id)).map(p => p.label);
  return Object.defineProperty(ties, 'missing', { value: missing, enumerable: false });
}

// Signal-detection counts of a perceived matrix against a criterion matrix.
export function accuracy(perceived, criterion, people) {
  let hits = 0, misses = 0, falseAlarms = 0, correctRejections = 0;
  for (const [i, j] of orderedPairs(people)) {
    const p = has(perceived, i, j), c = has(criterion, i, j);
    if (p && c) hits++; else if (c) misses++; else if (p) falseAlarms++; else correctRejections++;
  }
  const div = (a, b) => (b ? a / b : NaN);
  return {
    hits, misses, falseAlarms, correctRejections,
    hitRate: div(hits, hits + misses),
    falseAlarmRate: div(falseAlarms, falseAlarms + correctRejections),
    jaccard: div(hits, hits + misses + falseAlarms),
  };
}

export function perInformantAccuracy(css, { threshold = 0.5, reference = null } = {}) {
  const cons = consensus(css, threshold);
  return css.informants.map(inf => ({
    id: inf.id, label: inf.label, personId: inf.personId,
    reported: Object.keys(inf.ties).length,
    vsConsensus: accuracy(inf.ties, cons, css.people),
    vsReference: reference ? accuracy(inf.ties, reference, css.people) : null,
  }));
}

// Pairs informants disagree about most. With share p reporting the tie, the
// disagreement is 4 p (1 - p): 1 at an even split, 0 when everyone agrees.
export function disagreement(css, { limit = 20 } = {}) {
  const label = new Map(css.people.map(p => [p.id, p.label]));
  const rows = [];
  for (const [k, p] of agreement(css)) {
    if (p <= 0 || p >= 1) continue;
    const [i, j] = splitKey(k);
    rows.push({ from: i, to: j, fromLabel: label.get(i), toLabel: label.get(j), share: p, score: 4 * p * (1 - p) });
  }
  rows.sort((a, b) => b.score - a.score || a.fromLabel.localeCompare(b.fromLabel) || a.toLabel.localeCompare(b.toLabel));
  return rows.slice(0, limit);
}

// A loaded Dataset as a reference network over the roster: any event from
// actor to a target becomes a directed binary tie, matched by name.
export function referenceFromDataset(ds, people) {
  if (!ds) return null;
  const idx = nameIndex(people);
  const byNode = new Array(ds.nodes.count);
  for (let n = 0; n < ds.nodes.count; n++) byNode[n] = idx.get(normName(ds.nodes.labels[n])) ?? null;
  const matched = byNode.filter(Boolean).length;
  if (!matched) return { ties: {}, matched: 0 };
  const ties = {};
  for (let e = 0; e < ds.events.count; e++) {
    const a = byNode[ds.events.actor[e]];
    if (!a) continue;
    for (const [t] of eventTargets(ds, e)) { const b = byNode[t]; if (b && b !== a) ties[pairKey(a, b)] = 1; }
  }
  return { ties, matched };
}

// views: 'consensus' | 'las-union' | 'las-intersection' | informant id
export function viewTies(css, view, { threshold = 0.5 } = {}) {
  if (view === 'consensus') return consensus(css, threshold);
  if (view === 'las-union') return las(css, 'union');
  if (view === 'las-intersection') return las(css, 'intersection');
  return css.informants.find(i => i.id === view)?.ties ?? {};
}

export function viewLabel(css, view, threshold = 0.5) {
  if (view === 'consensus') return `Consensus (at least ${Math.round(threshold * 100)}% of informants)`;
  if (view === 'las-union') return 'Locally aggregated, union';
  if (view === 'las-intersection') return 'Locally aggregated, intersection';
  const inf = css.informants.find(i => i.id === view);
  return inf ? `As seen by ${inf.label}` : view;
}

export function toDataset(css, { view = 'consensus', threshold = 0.5 } = {}) {
  if (!css.people.length) throw new Error('The roster is empty.');
  if (!css.informants.length) throw new Error('Add at least one informant.');
  const ties = viewTies(css, view, { threshold });
  const b = new DatasetBuilder({ name: `${css.name || 'Perceived network'}: ${viewLabel(css, view, threshold)}` });
  b.beginSource({ format: 'css', family: 'survey', medium: 'survey', view: 'full', context: 'survey', directed: true,
    fileNames: [], cssView: view, threshold: view === 'consensus' ? threshold : null, informants: css.informants.length });
  const keyOf = new Map(), used = new Set();
  const agree = agreement(css);
  for (const p of css.people) {
    let k = 'cs:' + slug(p.label);
    while (used.has(k)) k += '_';
    used.add(k); keyOf.set(p.id, k);
    b.node(k, { label: p.label, attrs: { informant: css.informants.some(i => i.personId === p.id) } });
  }
  const ctx = b.context('cs:' + slug(css.relation?.name || 'relation'), { name: css.relation?.name || 'Relation', kind: 'survey', visibility: 'private', medium: 'survey' });
  for (const k of Object.keys(ties)) {
    const [i, j] = splitKey(k);
    if (!keyOf.has(i) || !keyOf.has(j)) continue;
    // In the consensus view the weight is the share of informants who reported
    // the tie, so the network carries how strongly it was agreed on.
    const weight = view === 'consensus' ? agree.get(k) || 1 : 1;
    b.event({ type: 'declared', actor: b.nodeIndex(keyOf.get(i)), targets: [[b.nodeIndex(keyOf.get(j)), 'declared']], context: ctx, weight });
    b.stat('ties');
  }
  if (view.startsWith('las')) { const miss = ties.missing?.length; if (miss) b.warn('css-missing-self-report', 'People without their own report; their ties rest on the other person only', miss); }
  return b.build();
}
