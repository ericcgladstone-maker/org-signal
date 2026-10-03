// Construction rules vs a naive reimplementation.
//
// Random event datasets (every event type, role, context kind, visibility,
// bots, undated events, parents resolved and not, broadcasts, meetings above
// the size cap, turn-taking runs) are built with DatasetBuilder and turned
// into networks under random settings. An independent, deliberately simple
// reading of the rules in docs/api/analysis.md ("Construction") computes the
// ties from the generator's own event records (not from the built dataset's
// arrays), and every tie, node, weight, per-rule amount, layer mask and
// dropped-event count must agree with buildNetwork.
//
// Where the implementation follows a different but defensible reading of the
// doc, the reference has a switch for that reading (KNOWN below). A mismatch
// that disappears with a known switch is counted under that switch, not as a
// failure; the switches are the discrepancies this check reports.

import { DatasetBuilder, VISIBILITY, ROLES, EVENT_TYPES } from '../../../src/core/model.js';
import { buildNetwork, edgeEvidence, RULES } from '../../../src/analysis/construct.js';
import { createRng } from '../../../src/analysis/rng.js';
import { tally } from '../lib.mjs';

export const name = 'construction';
export const title = 'Construction rules vs a naive reimplementation';

const KINDS = ['channel', 'dm', 'group_dm', 'chat', 'email_thread', 'meeting', 'survey', 'thread', 'canvas'];
const MEDIA = ['chat', 'email', 'meeting', 'social', 'declared'];
const NO_ADJ = new Set(['email_thread', 'meeting', 'survey', 'canvas']);
const ADDRESS = new Set(['to', 'cc', 'bcc', 'dm', 'mention']);
const SUBJECT_RULE = { declared: 'declared', repost: 'repost', like: 'like', follow: 'follow', reaction: 'reaction' };
const MIN = 60000;
const T0 = Date.UTC(2026, 2, 2, 9);

// Readings of the doc where the implementation chose differently (see the
// report at the end of run()):
//   adjacencyNotSymmetric: turn-taking ties from a source with directed:false
//     are entered in one direction only (doc: every tie from such a source is
//     entered in both directions in a directed network).
//   excludedTargetNotGiven: a reply or subject target that is a bot (or an
//     excluded person) does not count as "given", so the tie falls back to the
//     resolved parent's author (doc: the parent is used only when no target
//     is given).
//   declaredParentFallback: a declared event without a subject target ties to
//     its resolved parent's author (doc lists the parent fallback only for
//     reply, repost, like, follow and reaction).
//   declaredFallbackDoubleCount: as declaredParentFallback, and when the
//     parent's author is also a declared target of the event the tie is
//     counted twice (doc: the same target and rule within one event counts
//     once).
//   excludedBotCountedAsBot: with excludeBots off, an event by a bot listed in
//     excludeNodes is counted under dropped.bots instead of dropped.excluded
//     (summary only; the ties are right).
export const KNOWN = ['adjacencyNotSymmetric', 'excludedTargetNotGiven', 'declaredParentFallback', 'declaredFallbackDoubleCount', 'excludedBotCountedAsBot'];

// ---- random datasets ----------------------------------------------------------------

export function randomRecord(seed) {
  const r = createRng(`construct|${seed}`);
  const N = 2 + r.int(12);
  const isBot = Array.from({ length: N }, () => (r() < 0.12 ? 1 : 0));
  const S = 1 + r.int(3);
  const sources = Array.from({ length: S }, () => ({ medium: MEDIA[r.int(MEDIA.length)], directed: r() < 0.3 ? false : undefined }));
  const C = r.int(7);
  // Contexts are created while source 0 is current: without an explicit
  // medium they take source 0's.
  const contexts = Array.from({ length: C }, () => {
    const kind = KINDS[r.int(KINDS.length)];
    const explicit = r() < 0.7;
    return { kind, vis: VISIBILITY[r.int(VISIBILITY.length)], medium: explicit ? MEDIA[r.int(MEDIA.length)] : sources[0].medium, explicitMedium: explicit };
  });
  const E = r.int(45);
  // Chatty datasets: most messages untargeted in one or two contexts, so
  // consecutive turns (and the windowMin boundary) are common.
  const chatty = C > 0 && r() < 0.4;
  const events = [];
  const pickType = () => { const x = r(); return x < 0.5 ? 'message' : x < 0.6 ? 'copresence' : x < 0.7 ? 'declared' : x < 0.95 ? ['reaction', 'repost', 'like', 'follow'][r.int(4)] : ['join', 'leave'][r.int(2)]; };
  let clock = T0;
  for (let i = 0; i < E; i++) {
    const type = pickType();
    const actor = r.int(N);
    const targets = [];
    const nt = r() < (chatty && type === 'message' ? 0.75 : 0.35) ? 0 : r() < 0.1 ? 4 + r.int(8) : 1 + r.int(3);
    for (let k = 0; k < nt; k++) {
      const x = r() < 0.05 ? actor : r.int(N);
      let role;
      if (type === 'copresence') role = r() < 0.8 ? (r() < 0.7 ? 'attendee' : 'member') : ROLES[r.int(ROLES.length)];
      else if (nt > 3 && r() < 0.7) role = ['to', 'cc', 'mention', 'dm', 'bcc'][r.int(5)];
      else role = ROLES[r.int(ROLES.length)];
      targets.push([x, role]);
      if (r() < 0.1) targets.push([x, role]);   // repeated target in one event
    }
    // Clock steps of 0..14 minutes so turn-taking gaps straddle windowMin;
    // some events share a timestamp, some are undated.
    clock += Math.round([0, 0, 0.5, 1, 1, 3, 4.999, 5, 5.001, 9.999, 10, 10, 10.001, 15, 60][r.int(15)] * MIN);
    const t = r() < 0.08 ? NaN : clock;
    const weight = r() < 0.6 ? 1 : r() < 0.5 ? 1 + r.int(3) : [0.3, 1.7, 0.1, 2.25, 0][r.int(5)];
    const context = chatty ? (r() < 0.8 ? 0 : r.int(C)) : C && r() < 0.85 ? r.int(C) : -1;
    const parentKey = r() < 0.3 ? 'e' + (r() < 0.85 ? r.int(E) : E + 5) : null;
    events.push({ type, actor, targets, context, t, weight, parentKey, key: 'e' + i, source: r.int(S) });
  }
  // DatasetBuilder assigns events to the current source: group by source.
  events.sort((a, b) => a.source - b.source);
  return { N, isBot, sources, contexts, events };
}

export function buildDataset(rec, { repeat = null } = {}) {
  const b = new DatasetBuilder({ name: 'construct' });
  let cur = 0;
  b.beginSource({ format: 'test', medium: rec.sources[0].medium, ...(rec.sources[0].directed === false ? { directed: false } : {}) });
  for (let i = 0; i < rec.N; i++) b.node('p:' + i, { label: 'P' + i, isBot: !!rec.isBot[i] });
  rec.contexts.forEach((c, i) => b.context('c' + i, { kind: c.kind, visibility: c.vis, ...(c.explicitMedium ? { medium: c.medium } : {}) }));
  rec.events.forEach((e, i) => {
    while (cur < e.source) { cur++; b.beginSource({ format: 'test', medium: rec.sources[cur].medium, ...(rec.sources[cur].directed === false ? { directed: false } : {}) }); }
    const times = repeat ? repeat[i] : 1;
    for (let k = 0; k < times; k++) b.event({ type: e.type, t: e.t, actor: e.actor, targets: e.targets, context: e.context, key: e.key, parentKey: e.parentKey, weight: e.weight });
  });
  while (cur < rec.sources.length - 1) { cur++; b.beginSource({ format: 'test', medium: rec.sources[cur].medium }); }
  return b.build();
}

export function randomSettings(rec, seed) {
  const r = createRng(`settings|${seed}`);
  const rules = {};
  for (const x of RULES) rules[x] = { on: r() < 0.8, weight: [1, 1, 0.5, 2, 0, 1.3][r.int(6)] };
  rules.adjacency.windowMin = [0, 1, 5, 10, 10][r.int(5)];
  rules.copresence.normalize = r() < 0.6;
  const ms = [undefined, 0, 3, 5][r.int(4)];
  if (ms !== undefined) rules.copresence.maxSize = ms;
  const s = {
    rules,
    directed: r() < 0.5,
    weighting: ['count', 'log', 'binary'][r.int(3)],
    minWeight: [0, 0, 0, 1, 2.5][r.int(5)],
    maxRecipients: [0, 2, 3, 5, 25][r.int(5)],
    excludeBots: r() < 0.7,
    excludeNodes: Array.from({ length: rec.N }, (_, i) => i).filter(() => r() < 0.08),
    includeIsolates: r() < 0.5,
    visibility: r() < 0.5 ? [...VISIBILITY] : VISIBILITY.filter(() => r() < 0.7),
    media: r() < 0.6 ? null : MEDIA.filter(() => r() < 0.6),
    time: { start: null, end: null },
  };
  if (r() < 0.4) {
    s.time.start = r() < 0.7 ? T0 + r.int(60) * MIN : null;
    s.time.end = r() < 0.7 ? T0 + (30 + r.int(240)) * MIN : null;
  }
  return s;
}

// ---- the naive reference ----------------------------------------------------------------

// Straight from the doc. opts: { mult, subset, adjacencyNotSymmetric, excludedTargetNotGiven, declaredParentFallback }
export function naiveNetwork(rec, s, opts = {}) {
  const evs = rec.events;
  const keyIndex = new Map();
  evs.forEach((e, i) => keyIndex.set(e.key, i));
  const parentOf = (e) => (e.parentKey != null && keyIndex.has(e.parentKey) ? keyIndex.get(e.parentKey) : -1);
  const excluded = new Set(s.excludeNodes || []);
  const ok = (x) => !(s.excludeBots && rec.isBot[x]) && !excluded.has(x);
  const on = (rule) => !!s.rules[rule]?.on;
  const ruleW = (rule) => Number(s.rules[rule].weight ?? 1);
  const visAllowed = new Set(s.visibility);
  const mediaAllowed = s.media && s.media.length ? new Set(s.media) : null;
  const maxR = s.maxRecipients > 0 ? s.maxRecipients : Infinity;
  const copMax = s.rules.copresence.maxSize > 0 ? s.rules.copresence.maxSize : maxR;
  const timed = s.time.start != null || s.time.end != null;
  const drop = { considered: 0, used: 0, bots: 0, excluded: 0, time: 0, undated: 0, visibility: 0, media: 0, broadcast: 0, largeMeetings: 0 };
  const ties = new Map();   // 'a,b' -> { a, b, raw, byRule, mask }
  const add = (a, b, rule, amt, vis) => {
    const k = a + ',' + b;
    let x = ties.get(k);
    if (!x) { x = { a, b, raw: 0, byRule: {}, mask: 0 }; ties.set(k, x); }
    x.raw += ruleW(rule) * amt;
    x.byRule[rule] = (x.byRule[rule] || 0) + amt;
    x.mask |= 1 << VISIBILITY.indexOf(vis);
  };
  const emit = (a, b, rule, amt, vis, sym) => {
    if (!s.directed) { add(Math.min(a, b), Math.max(a, b), rule, amt, vis); return; }
    add(a, b, rule, amt, vis);
    if (sym) add(b, a, rule, amt, vis);
  };
  const seq = [];
  const list = opts.subset ? Array.from(opts.subset) : evs.map((_, i) => i);
  for (const i of list) {
    const e = evs[i];
    drop.considered++;
    const m = opts.mult ? opts.mult[i] : 1;
    if (m === 0) continue;
    if (timed) {
      if (!Number.isFinite(e.t)) { drop.undated++; continue; }
      if ((s.time.start != null && e.t < s.time.start) || (s.time.end != null && e.t >= s.time.end)) { drop.time++; continue; }
    }
    if (!ok(e.actor)) { if (rec.isBot[e.actor] && (s.excludeBots || opts.excludedBotCountedAsBot)) drop.bots++; else drop.excluded++; continue; }
    const ctx = e.context >= 0 ? rec.contexts[e.context] : null;
    const vis = ctx ? ctx.vis : 'unknown';
    if (!visAllowed.has(vis)) { drop.visibility++; continue; }
    if (mediaAllowed && !mediaAllowed.has(ctx ? ctx.medium : rec.sources[e.source].medium)) { drop.media++; continue; }
    drop.used++;
    const amt = Math.fround(e.weight) * m;
    const sym = rec.sources[e.source].directed === false;
    const targets = e.targets.filter(([x]) => x !== e.actor);   // the builder drops self-targets
    if (e.type === 'copresence') {
      if (!on('copresence')) continue;
      const people = [e.actor];
      for (const [x, role] of targets) if ((role === 'attendee' || role === 'member') && ok(x) && !people.includes(x)) people.push(x);
      const k = people.length;
      if (k < 2) continue;
      if (k > copMax) { drop.largeMeetings++; continue; }
      const per = s.rules.copresence.normalize === false ? amt : amt / (k - 1);
      for (let p = 0; p < k; p++) for (let q = p + 1; q < k; q++) emit(people[p], people[q], 'copresence', per, vis, true);
      continue;
    }
    const addressed = new Set(targets.filter(([, role]) => ADDRESS.has(role)).map(([x]) => x));
    const broadcast = addressed.size > maxR;
    if (broadcast) drop.broadcast++;
    const found = new Map();   // 'rule,x' -> [rule, x]: one per target and rule
    for (const [x, role] of targets) {
      if (!ok(x)) continue;
      let rule = null;
      if (role === 'reply') rule = 'reply';
      else if (ADDRESS.has(role)) rule = broadcast ? null : role;
      else if (role === 'declared') rule = 'declared';
      else if (role === 'subject') rule = SUBJECT_RULE[e.type] || null;
      if (rule && on(rule)) found.set(rule + ',' + x, [rule, x]);
    }
    const p = parentOf(e);
    const given = (role) => targets.some(([x, r]) => r === role && (!opts.excludedTargetNotGiven || ok(x)));
    let fallback = null;
    if (e.type === 'message' && !given('reply')) fallback = 'reply';
    else if (['repost', 'like', 'follow', 'reaction'].includes(e.type) && !given('subject')) fallback = e.type;
    else if ((opts.declaredParentFallback || opts.declaredFallbackDoubleCount) && e.type === 'declared' && !given('subject')) fallback = 'declared';
    if (fallback && p >= 0 && on(fallback)) {
      const x = evs[p].actor;
      const key = fallback + ',' + x + (opts.declaredFallbackDoubleCount && fallback === 'declared' ? ',parent' : '');
      if (x !== e.actor && ok(x)) found.set(key, [fallback, x]);
    }
    for (const [rule, x] of found.values()) emit(e.actor, x, rule, amt, vis, sym);
    if (on('adjacency') && e.type === 'message' && ctx && !NO_ADJ.has(ctx.kind) && Number.isFinite(e.t)) seq.push({ i, untargeted: targets.length === 0, m, vis, sym });
  }
  // Turn-taking per context in time order (event order breaks ties).
  if (seq.length) {
    const win = (s.rules.adjacency.windowMin ?? 10) * MIN;
    const byCtx = new Map();
    for (const x of seq) { const c = evs[x.i].context; if (!byCtx.has(c)) byCtx.set(c, []); byCtx.get(c).push(x); }
    for (const list2 of byCtx.values()) {
      list2.sort((p, q) => evs[p.i].t - evs[q.i].t || p.i - q.i);
      for (let k = 1; k < list2.length; k++) {
        const cur = list2[k], prev = list2[k - 1];
        if (!cur.untargeted) continue;
        const a = evs[cur.i].actor, b = evs[prev.i].actor;
        if (a === b || evs[cur.i].t - evs[prev.i].t > win) continue;
        emit(a, b, 'adjacency', Math.fround(evs[cur.i].weight) * cur.m, cur.vis, opts.adjacencyNotSymmetric ? false : cur.sym);
      }
    }
  }
  const minW = Number(s.minWeight) || 0;
  const kept = [...ties.values()].filter(x => x.raw > 0 && x.raw >= minW);
  const inNet = new Set();
  if (s.includeIsolates) for (let i = 0; i < rec.N; i++) if (ok(i)) inNet.add(i);
  for (const x of kept) { inNet.add(x.a); inNet.add(x.b); }
  const nodeIds = [...inNet].sort((a, b) => a - b);
  const tf = s.weighting === 'log' ? (x) => Math.log(1 + x) : s.weighting === 'binary' ? () => 1 : (x) => x;
  const deg = new Map();
  for (const x of kept) { deg.set(x.a, 1); deg.set(x.b, 1); }
  return {
    nodeIds, edges: kept.map(x => ({ ...x, w: tf(x.raw) })), drop,
    candidates: ties.size, isolates: nodeIds.filter(v => !deg.has(v)).length,
  };
}

// ---- comparison ---------------------------------------------------------------------

const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

// First difference between buildNetwork's result and the reference, or null.
export function diffNetworks(net, ref, s, { counts = true } = {}) {
  if (net.n !== ref.nodeIds.length || ref.nodeIds.some((d, v) => net.nodeIds[v] !== d)) return { what: 'nodes', got: Array.from(net.nodeIds), expected: ref.nodeIds };
  if (net.directed !== !!s.directed) return { what: 'directed', got: net.directed, expected: !!s.directed };
  const E = net.edges;
  const got = new Map();
  for (let e = 0; e < E.count; e++) got.set(net.nodeIds[E.src[e]] + ',' + net.nodeIds[E.dst[e]], e);
  if (E.count !== ref.edges.length) {
    const exp = new Set(ref.edges.map(x => x.a + ',' + x.b));
    return { what: 'edge count', got: E.count, expected: ref.edges.length, extra: [...got.keys()].filter(k => !exp.has(k)), missing: [...exp].filter(k => !got.has(k)) };
  }
  for (let e = 1; e < E.count; e++) if (E.src[e - 1] > E.src[e] || (E.src[e - 1] === E.src[e] && E.dst[e - 1] >= E.dst[e])) return { what: 'edge order', at: e };
  if (!net.directed) for (let e = 0; e < E.count; e++) if (E.src[e] >= E.dst[e]) return { what: 'undirected src < dst', at: e };
  const active = RULES.filter(r => s.rules[r]?.on);
  if (Object.keys(E.byRule).sort().join() !== [...active].sort().join()) return { what: 'byRule keys', got: Object.keys(E.byRule), expected: active };
  for (const x of ref.edges) {
    const k = x.a + ',' + x.b, e = got.get(k);
    if (e === undefined) return { what: 'missing tie', tie: k };
    if (!near(E.raw[e], x.raw)) return { what: 'raw', tie: k, got: E.raw[e], expected: x.raw };
    if (!near(E.w[e], x.w)) return { what: 'w', tie: k, got: E.w[e], expected: x.w };
    if (E.layerMask[e] !== x.mask) return { what: 'layerMask', tie: k, got: E.layerMask[e], expected: x.mask };
    for (const r of active) if (!near(E.byRule[r][e], x.byRule[r] || 0)) return { what: 'byRule.' + r, tie: k, got: E.byRule[r][e], expected: x.byRule[r] || 0 };
  }
  if (counts) {
    const sm = net.summary, d = sm.events.dropped;
    const pairs = [['edges', sm.edges, ref.edges.length], ['isolates', sm.isolates, ref.isolates], ['considered', sm.events.considered, ref.drop.considered],
      ['used', sm.events.used, ref.drop.used], ['tiesBelowMinWeight', sm.tiesBelowMinWeight, ref.candidates - ref.edges.length],
      ...['bots', 'excluded', 'time', 'undated', 'visibility', 'media', 'broadcast', 'largeMeetings'].map(k => [k, d[k], ref.drop[k]])];
    for (const [k, a, b] of pairs) if (a !== b) return { what: 'summary.' + k, got: a, expected: b };
  }
  return null;
}

// Which known readings (alone, then together) make the reference agree.
function explain(net, rec, s, opts) {
  for (const k of KNOWN) if (!diffNetworks(net, naiveNetwork(rec, s, { ...opts, [k]: true }), s)) return [k];
  const all = Object.fromEntries(KNOWN.map(k => [k, true]));
  if (!diffNetworks(net, naiveNetwork(rec, s, { ...opts, ...all }), s)) return KNOWN.filter(k => diffNetworks(net, naiveNetwork(rec, s, { ...opts, ...all, [k]: false }), s));
  return null;
}

// Greedy shrink of a failing record: drop events, then targets, then nodes'
// bot flags, while the same mismatch persists. Returns a compact description.
export function shrink(rec, s, fails) {
  let cur = structuredClone(rec);
  const stillFails = (r) => { try { return fails(r); } catch { return false; } };
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = cur.events.length - 1; i >= 0; i--) {
      const r = structuredClone(cur);
      const gone = r.events.splice(i, 1)[0];
      // Keep parents meaningful: keys stay as they are; a removed parent just becomes unresolved.
      if (gone && stillFails(r)) { cur = r; changed = true; }
    }
    for (let i = 0; i < cur.events.length; i++) for (let j = cur.events[i].targets.length - 1; j >= 0; j--) {
      const r = structuredClone(cur);
      r.events[i].targets.splice(j, 1);
      if (stillFails(r)) { cur = r; changed = true; }
    }
  }
  return {
    N: cur.N, bots: cur.isBot.map((b, i) => (b ? i : -1)).filter(i => i >= 0),
    sources: cur.sources, contexts: cur.contexts.map(c => ({ kind: c.kind, vis: c.vis, medium: c.medium })),
    events: cur.events.map(e => ({ type: e.type, actor: e.actor, targets: e.targets, context: e.context, t: Number.isFinite(e.t) ? (e.t - T0) / MIN + ' min' : 'undated', weight: e.weight, key: e.key, parentKey: e.parentKey, source: e.source })),
  };
}

// ---- run --------------------------------------------------------------------------------

export async function run({ count = 300, seed = 1, log = () => {}, settingsPerDataset = 3 } = {}) {
  const t = tally(name);
  const explained = Object.fromEntries(KNOWN.map(k => [k, 0]));
  const examples = {};
  let ties = 0, evidenceChecked = 0, multChecked = 0, subsetChecked = 0, events = 0;
  const started = Date.now();
  for (let d = 0; d < count; d++) {
    const dsSeed = seed * 1e6 + d;
    const rec = randomRecord(dsSeed);
    const ds = buildDataset(rec);
    events += rec.events.length;
    for (let k = 0; k < settingsPerDataset; k++) {
      const s = randomSettings(rec, `${dsSeed}|${k}`);
      const caseId = { dataset: dsSeed, settings: `${dsSeed}|${k}` };
      t.case();
      const net = buildNetwork(ds, s);
      ties += net.edges.count;
      const diff = diffNetworks(net, naiveNetwork(rec, s), s);
      if (diff) {
        const why = explain(net, rec, s, {});
        if (why) {
          for (const w of why) {
            explained[w]++;
            if (!examples[w]) examples[w] = { ...caseId, diff, minimal: shrink(rec, s, (r) => { const n2 = buildNetwork(buildDataset(r), s); return !!diffNetworks(n2, naiveNetwork(r, s), s) && !!explain(n2, r, s, {})?.includes(w); }), settings: s };
          }
          t.cmp(true);
        } else {
          t.cmp(false, { ...caseId, check: 'buildNetwork vs naive rules', diff, minimal: shrink(rec, s, (r) => { const n2 = buildNetwork(buildDataset(r), s); return !!diffNetworks(n2, naiveNetwork(r, s), s) && !explain(n2, r, s, {}); }), settings: s });
        }
      } else t.cmp(true);
      const all = Object.fromEntries(KNOWN.map(x => [x, true]));
      // From here on the reference uses the implementation's readings, so each
      // remaining check tests one mechanism only.

      // edgeEvidence: per-rule amounts over a tie's events add up to byRule.
      const E = net.edges;
      for (let e = 0; e < E.count && e < 6; e++) {
        const a = net.nodeIds[E.src[e]], b = net.nodeIds[E.dst[e]];
        const evd = edgeEvidence(ds, net, a, b, { limit: 1e9 });
        const sum = {};
        for (const x of evd) sum[x.rule] = (sum[x.rule] || 0) + x.amount;
        evidenceChecked++;
        const bad = Object.keys(E.byRule).find(r => !near(sum[r] || 0, E.byRule[r][e]));
        t.cmp(!bad, { ...caseId, check: 'edgeEvidence sums to byRule', tie: [a, b], rule: bad, got: bad && sum[bad], expected: bad && E.byRule[bad][e] });
      }

      // Bootstrap multiplicities: against the reference with amount x mult,
      // and (turn-taking off) against a dataset with the events repeated.
      const r = createRng(`mult|${dsSeed}|${k}`);
      const mult = Uint32Array.from(rec.events, () => r.int(3));
      const nm = buildNetwork(ds, s, { mult });
      const dm = diffNetworks(nm, naiveNetwork(rec, s, { mult, ...all }), s);
      t.cmp(!dm, { ...caseId, check: 'mult vs reference', diff: dm });
      const sNoAdj = { ...s, rules: { ...s.rules, adjacency: { ...s.rules.adjacency, on: false } } };
      // Multiplicities 1..2 here: dropping a parent from a real dataset
      // unresolves its replies, while a zero multiplicity keeps the parent's
      // author known (the reply itself was resampled), by design.
      const mult12 = Uint32Array.from(mult, x => 1 + (x % 2));
      const nm2 = buildNetwork(ds, sNoAdj, { mult: mult12 });
      const nd = buildNetwork(buildDataset(rec, { repeat: Array.from(mult12) }), sNoAdj);
      const dd = diffNetworks(nm2, { nodeIds: Array.from(nd.nodeIds), edges: Array.from({ length: nd.edges.count }, (_, e) => ({ a: nd.nodeIds[nd.edges.src[e]], b: nd.nodeIds[nd.edges.dst[e]], raw: nd.edges.raw[e], w: nd.edges.w[e], mask: nd.edges.layerMask[e], byRule: Object.fromEntries(Object.entries(nd.edges.byRule).map(([q, arr]) => [q, arr[e]])) })) }, sNoAdj, { counts: false });
      t.cmp(!dd, { ...caseId, check: 'mult vs repeated events', diff: dd });
      multChecked++;

      // Event subsets (time windows): against the reference over the subset.
      const subset = Int32Array.from(rec.events.map((_, i) => i).filter(() => r() < 0.6).sort(() => r() - 0.5));
      const ns = buildNetwork(ds, s, { events: subset });
      const ds2 = diffNetworks(ns, naiveNetwork(rec, s, { subset, ...all }), s);
      t.cmp(!ds2, { ...caseId, check: 'event subset vs reference', diff: ds2 });
      subsetChecked++;
    }
    if (d % 100 === 0) log(`construction ${d}/${count}`);
  }
  t.stats = {
    datasets: count, settings: t.cases, events, tiesCompared: ties, edgeEvidenceTies: evidenceChecked, multCases: multChecked, subsetCases: subsetChecked,
    knownDifferences: explained, seconds: (Date.now() - started) / 1000,
  };
  t.stats.examples = examples;
  t.notes.push(
    'Reference reads docs/api/analysis.md (Construction); event weights are float32 (DatasetBuilder), so the reference applies Math.fround.',
    'Conventions taken where the doc is silent (the implementation agrees): self-ties never form; the broadcast cutoff counts every distinct addressee, bots included; copresence size k and normalisation count eligible people only (bots and excluded people are ignored); an event is untargeted for turn-taking only if it has no targets at all (an audience-only member list makes it addressed); turn-taking ties form when the gap is <= windowMin; copresence.maxSize <= 0 means "use maxRecipients"; minWeight compares raw (before the weighting transform); filters apply in the order time, actor, visibility, media for the dropped counts.',
    'Bootstrap multiplicity scales a turn-taking tie by the multiplicity; a dataset with the message really repeated would count the repeat as a run by one speaker (once). The repeated-events comparison therefore turns adjacency off.',
    'Known differences between doc and implementation are counted in stats.knownDifferences with a shrunk example in stats.examples.',
  );
  return t.result();
}
