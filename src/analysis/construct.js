// Network construction: Dataset events -> weighted ties.
//
// Construction is a visible, recorded choice (CONTRACTS principle 4). Each rule
// turns one kind of evidence into ties; every tie keeps per-rule evidence
// amounts and a bitmask of the visibility layers its evidence came from, and
// edgeEvidence() can replay the rules to show the events behind any tie.
//
// The rule engine (forEachEvidence) is shared by buildNetwork, edgeEvidence,
// bootstrap resampling (event multiplicities) and time windows (event subsets),
// so all of them agree exactly on what counts as a tie.

import { EVENT_TYPES, ROLES, VISIBILITY, VIEWS } from '../core/model.js';

export const RULES = ['reply', 'mention', 'dm', 'to', 'cc', 'bcc', 'adjacency', 'copresence', 'declared', 'repost', 'like', 'follow', 'reaction'];
export const RULE_INFO = {
  reply: 'A replied to a message by B',
  mention: 'A mentioned B (@name)',
  dm: 'A sent B a direct message',
  to: 'A emailed B (To)',
  cc: 'A copied B (Cc)',
  bcc: 'A blind-copied B (Bcc)',
  adjacency: 'A posted right after B in the same conversation (turn-taking, inferred)',
  copresence: 'A and B attended the same meeting or event',
  declared: 'A named B (survey or hand-drawn tie)',
  repost: 'A reposted something by B',
  like: 'A liked something by B',
  follow: 'A follows B',
  reaction: 'A reacted to a message by B',
};
// Layers are context visibilities; bit i of layerMask = VISIBILITY[i].
export const LAYERS = VISIBILITY;

const T = Object.fromEntries(EVENT_TYPES.map((t, i) => [t, i]));
const R = Object.fromEntries(ROLES.map((r, i) => [r, i]));
const RI = Object.fromEntries(RULES.map((r, i) => [r, i]));
const UNKNOWN_VIS = VISIBILITY.indexOf('unknown');
// Roles that address people directly; used for the broadcast cutoff.
const ADDRESS_ROLES = new Set([R.to, R.cc, R.bcc, R.dm, R.mention]);
// Context kinds where turn-taking is meaningful. Email threads and meetings
// have their own explicit evidence; surveys and canvases have no sequence.
const NO_ADJACENCY_KINDS = new Set(['email_thread', 'meeting', 'survey', 'canvas']);
const DEFAULT_WEIGHT = { adjacency: 0.5 };
const GROUP_CHAT_KINDS = new Set(['group_dm', 'chat']);

// ---- defaults ----------------------------------------------------------------

// Turn on only the rules whose evidence exists in this dataset, with counts so
// the settings drawer can say why each rule is on or off.
export function defaultSettings(ds) {
  const ev = ds.events;
  const roleCount = new Float64Array(ROLES.length);
  for (let j = 0; j < ev.tgt.length; j++) roleCount[ev.role[j]]++;
  const typeCount = new Float64Array(EVENT_TYPES.length);
  let parentReplies = 0, untargetedShared = 0, untargetedGroupChat = 0, messages = 0, timed = 0;
  // Evidence from sources that declare their ties undirected (source.directed === false).
  const undirectedSource = (ds.meta?.sources || []).map(s => s.directed === false);
  let undirectedEvidence = 0;
  for (let i = 0; i < ev.count; i++) {
    const ty = ev.type[i];
    typeCount[ty]++;
    const nT = ev.tOff[i + 1] - ev.tOff[i];
    if (undirectedSource[ev.source[i]] && ty !== T.copresence) undirectedEvidence += nT;
    if (Number.isFinite(ev.t[i])) timed++;
    if (ty !== T.message) continue;
    messages++;
    if (ev.parent[i] >= 0) parentReplies++;
    const c = ev.context[i];
    if (nT === 0 && c >= 0 && !NO_ADJACENCY_KINDS.has(ds.contexts.kinds[c])) {
      untargetedShared++;
      if (GROUP_CHAT_KINDS.has(ds.contexts.kinds[c])) untargetedGroupChat++;
    }
  }
  const evidence = {
    reply: roleCount[R.reply] + parentReplies,
    mention: roleCount[R.mention],
    dm: roleCount[R.dm],
    to: roleCount[R.to], cc: roleCount[R.cc], bcc: roleCount[R.bcc],
    // Turn-taking is inferred when group chats carry no per-message targets
    // (WhatsApp, Telegram, iMessage groups: ties exist only through it), or
    // when many messages in shared spaces name nobody.
    adjacency: timed > 0 && messages > 0 && (untargetedGroupChat > 0 || untargetedShared / messages >= 0.3) ? untargetedShared : 0,
    copresence: typeCount[T.copresence],
    declared: typeCount[T.declared],
    repost: typeCount[T.repost], like: typeCount[T.like], follow: typeCount[T.follow], reaction: typeCount[T.reaction],
  };
  const rules = {};
  for (const r of RULES) rules[r] = { on: evidence[r] > 0, weight: DEFAULT_WEIGHT[r] ?? 1, evidence: evidence[r] };
  rules.adjacency.windowMin = 10;
  rules.copresence.normalize = true;
  // Directed unless most evidence has no direction: co-attendance, or ties
  // from sources that declare themselves undirected (LinkedIn connections,
  // undirected network files, drawn networks). In a directed network those
  // ties are entered in both directions (see forEachEvidence).
  const total = RULES.reduce((s, r) => s + (rules[r].on ? evidence[r] : 0), 0);
  const undirectedShare = (evidence.copresence + undirectedEvidence) / (total || 1);
  const directed = total === 0 ? !undirectedSource.length || !undirectedSource.every(Boolean) : undirectedShare < 0.5;
  const visibility = [...new Set(Array.from(ds.contexts.visibility, v => VISIBILITY[v]))];
  if (!visibility.includes('unknown')) visibility.push('unknown');
  let hasBots = false;
  for (let i = 0; i < ds.nodes.count; i++) if (ds.nodes.isBot[i]) { hasBots = true; break; }
  return {
    rules,
    directed,
    weighting: 'count',
    minWeight: 0,
    maxRecipients: 25,
    time: { start: null, end: null },
    visibility,
    media: null,
    excludeBots: true,
    excludeNodes: [],
    includeIsolates: true,
    _hasBots: hasBots,
  };
}

// Fill missing fields so callers may pass partial settings.
export function normalizeSettings(ds, s = {}) {
  const d = defaultSettings(ds);
  const rules = {};
  for (const r of RULES) rules[r] = { ...d.rules[r], ...(s.rules?.[r] || {}) };
  return { ...d, ...s, rules, time: { ...d.time, ...(s.time || {}) } };
}

// ---- rule engine ---------------------------------------------------------------

// Calls emit(a, b, rule, amount, eventIndex, visIndex, symmetric) for every
// piece of tie evidence that survives the filters. a and b are dataset node
// indices. symmetric=true (copresence) means the evidence has no direction.
//
// opts.events: optional Int32Array of event indices to consider (time windows).
// opts.mult:   optional per-event multiplicity (bootstrap); 0 drops the event.
// Returns counts of what was dropped and why, for the summary.
export function forEachEvidence(ds, settings, emit, opts = {}) {
  const ev = ds.events, N = ds.nodes.count;
  const s = settings;
  const on = RULES.map(r => !!s.rules[r]?.on);
  const nodeOk = new Uint8Array(N).fill(1);
  if (s.excludeBots) for (let i = 0; i < N; i++) if (ds.nodes.isBot[i]) nodeOk[i] = 0;
  for (const x of s.excludeNodes || []) if (x >= 0 && x < N) nodeOk[x] = 0;
  const visOk = new Uint8Array(VISIBILITY.length);
  for (const v of s.visibility ?? VISIBILITY) { const k = VISIBILITY.indexOf(v); if (k >= 0) visOk[k] = 1; }
  if (!s.visibility) visOk.fill(1);
  const media = s.media && s.media.length ? new Set(s.media) : null;
  const start = s.time?.start ?? null, end = s.time?.end ?? null;
  const timeFiltered = start != null || end != null;
  const maxR = s.maxRecipients > 0 ? s.maxRecipients : Infinity;
  const copMax = s.rules.copresence?.maxSize > 0 ? s.rules.copresence.maxSize : maxR;
  const copNorm = s.rules.copresence?.normalize !== false;
  const mult = opts.mult || null;
  const sources = ds.meta?.sources || [];
  // Ties from a source that declares itself undirected have no direction:
  // they are emitted as symmetric evidence, like co-attendance.
  const symSource = sources.map(x => x.directed === false);

  const drop = { events: 0, used: 0, bots: 0, time: 0, undated: 0, visibility: 0, media: 0, broadcast: 0, copresenceLarge: 0, excluded: 0 };
  const adjSeq = on[RI.adjacency] ? [] : null;

  const each = (i) => {
    drop.events++;
    const m = mult ? mult[i] : 1;
    if (m === 0) return;
    const t = ev.t[i];
    if (timeFiltered) {
      if (!Number.isFinite(t)) { drop.undated++; return; }
      if ((start != null && t < start) || (end != null && t >= end)) { drop.time++; return; }
    }
    const actor = ev.actor[i];
    if (!nodeOk[actor]) { if (ds.nodes.isBot[actor]) drop.bots++; else drop.excluded++; return; }
    const c = ev.context[i];
    const vis = c >= 0 ? ds.contexts.visibility[c] : UNKNOWN_VIS;
    if (!visOk[vis]) { drop.visibility++; return; }
    if (media) {
      const med = c >= 0 ? ds.contexts.medium[c] : sources[ev.source[i]]?.medium;
      if (!media.has(med)) { drop.media++; return; }
    }
    drop.used++;
    const ty = ev.type[i];
    const amt = ev.weight[i] * m;
    const a0 = ev.tOff[i], a1 = ev.tOff[i + 1];

    if (ty === T.copresence) {
      if (!on[RI.copresence]) return;
      const people = [actor];
      for (let j = a0; j < a1; j++) {
        const r = ev.role[j], x = ev.tgt[j];
        if ((r === R.attendee || r === R.member) && nodeOk[x] && !people.includes(x)) people.push(x);
      }
      const k = people.length;
      if (k < 2) return;
      if (k > copMax) { drop.copresenceLarge++; return; }
      const per = copNorm ? amt / (k - 1) : amt;
      for (let p = 0; p < k; p++) for (let q = p + 1; q < k; q++) emit(people[p], people[q], RI.copresence, per, i, vis, true);
      return;
    }

    // Broadcast cutoff: count distinct addressees.
    let broadcast = false;
    if (maxR !== Infinity && a1 - a0 > maxR) {
      const seen = new Set();
      for (let j = a0; j < a1; j++) if (ADDRESS_ROLES.has(ev.role[j])) seen.add(ev.tgt[j]);
      if (seen.size > maxR) { broadcast = true; drop.broadcast++; }
    }
    let hasReplyTarget = false, hasSubject = false;
    const done = a1 - a0 > 1 ? new Set() : null;
    for (let j = a0; j < a1; j++) {
      const x = ev.tgt[j], role = ev.role[j];
      if (!nodeOk[x] || x === actor) continue;
      let rule = -1;
      switch (role) {
        case R.reply: rule = RI.reply; hasReplyTarget = true; break;
        case R.mention: rule = broadcast ? -1 : RI.mention; break;
        case R.dm: rule = broadcast ? -1 : RI.dm; break;
        case R.to: rule = broadcast ? -1 : RI.to; break;
        case R.cc: rule = broadcast ? -1 : RI.cc; break;
        case R.bcc: rule = broadcast ? -1 : RI.bcc; break;
        case R.declared: rule = RI.declared; break;
        case R.subject: rule = subjectRule(ty); hasSubject = true; break;
        default: rule = -1;
      }
      if (rule < 0 || !on[rule]) continue;
      if (done) { const k = rule * N + x; if (done.has(k)) continue; done.add(k); }
      emit(actor, x, rule, amt, i, vis, symSource[ev.source[i]] === true);
    }
    // A reply, repost, like or reaction whose parent is in the data but whose
    // importer did not name the parent's author as a target.
    const p = ev.parent[i];
    if (p >= 0 && (ty === T.message ? !hasReplyTarget : !hasSubject)) {
      const rule = ty === T.message ? RI.reply : subjectRule(ty);
      const x = ev.actor[p];
      if (rule >= 0 && on[rule] && x !== actor && nodeOk[x]) emit(actor, x, rule, amt, i, vis, symSource[ev.source[i]] === true);
    }
    if (adjSeq && ty === T.message && a0 === a1 && c >= 0 && Number.isFinite(t) && !NO_ADJACENCY_KINDS.has(ds.contexts.kinds[c])) adjSeq.push(i);
    else if (adjSeq && ty === T.message && c >= 0 && Number.isFinite(t) && !NO_ADJACENCY_KINDS.has(ds.contexts.kinds[c])) adjSeq.push(-1 - i); // addressed: part of the sequence, creates no adjacency tie
  };

  if (opts.events) for (let k = 0; k < opts.events.length; k++) each(opts.events[k]);
  else for (let i = 0; i < ev.count; i++) each(i);

  // Turn-taking: in each context, the first message of a new speaker's run is
  // read as a response to the previous speaker, if it came within windowMin.
  if (adjSeq && adjSeq.length) {
    const win = (s.rules.adjacency.windowMin ?? 10) * 60000;
    const idx = (k) => (k < 0 ? -1 - k : k);
    adjSeq.sort((x, y) => {
      const a = idx(x), b = idx(y);
      return ev.context[a] - ev.context[b] || ev.t[a] - ev.t[b] || a - b;
    });
    for (let k = 1; k < adjSeq.length; k++) {
      if (adjSeq[k] < 0) continue;
      const i = adjSeq[k], prev = idx(adjSeq[k - 1]);
      if (ev.context[prev] !== ev.context[i]) continue;
      const a = ev.actor[i], b = ev.actor[prev];
      if (a === b || ev.t[i] - ev.t[prev] > win) continue;
      const c = ev.context[i];
      emit(a, b, RI.adjacency, ev.weight[i] * (mult ? mult[i] : 1), i, ds.contexts.visibility[c], false);
    }
  }
  return drop;
}

function subjectRule(ty) {
  switch (ty) {
    case T.repost: return RI.repost;
    case T.like: return RI.like;
    case T.follow: return RI.follow;
    case T.reaction: return RI.reaction;
    case T.declared: return RI.declared;
    default: return -1;
  }
}

// ---- buildNetwork ------------------------------------------------------------------

// opts (internal): { events, mult } passed through to forEachEvidence.
export function buildNetwork(ds, settingsIn, opts = {}) {
  const s = normalizeSettings(ds, settingsIn);
  const N = ds.nodes.count;
  const directed = !!s.directed;
  const ruleW = RULES.map(r => (s.rules[r]?.on ? Number(s.rules[r].weight ?? 1) : 0));
  const activeRules = RULES.filter(r => s.rules[r]?.on);
  const ruleSlot = RULES.map(r => activeRules.indexOf(r));
  const R_ = activeRules.length;

  const key = new Map();
  const ea = [], eb = [], raw = [], ev = [], mask = [];
  const add = (a, b, rule, amt, vis) => {
    const k = a * N + b;
    let e = key.get(k);
    if (e === undefined) {
      e = ea.length; key.set(k, e);
      ea.push(a); eb.push(b); raw.push(0); mask.push(0);
      for (let r = 0; r < R_; r++) ev.push(0);
    }
    raw[e] += amt * ruleW[rule];
    ev[e * R_ + ruleSlot[rule]] += amt;
    mask[e] |= 1 << vis;
  };
  const drop = forEachEvidence(ds, s, (a, b, rule, amt, i, vis, sym) => {
    if (!directed) { if (a < b) add(a, b, rule, amt, vis); else add(b, a, rule, amt, vis); }
    else { add(a, b, rule, amt, vis); if (sym) add(b, a, rule, amt, vis); }
  }, opts);

  // Keep ties with positive weight above the threshold.
  const minW = Number(s.minWeight) || 0;
  const keep = [];
  for (let e = 0; e < ea.length; e++) if (raw[e] > 0 && raw[e] >= minW) keep.push(e);

  // Network nodes: every eligible person (includeIsolates) or only those with ties.
  const inNet = new Uint8Array(N);
  if (s.includeIsolates) {
    for (let i = 0; i < N; i++) inNet[i] = 1;
    if (s.excludeBots) for (let i = 0; i < N; i++) if (ds.nodes.isBot[i]) inNet[i] = 0;
    for (const x of s.excludeNodes || []) if (x >= 0 && x < N) inNet[x] = 0;
  }
  for (const e of keep) { inNet[ea[e]] = 1; inNet[eb[e]] = 1; }
  const index = new Int32Array(N).fill(-1);
  let n = 0;
  for (let i = 0; i < N; i++) if (inNet[i]) index[i] = n++;
  const nodeIds = new Int32Array(n);
  for (let i = 0; i < N; i++) if (index[i] >= 0) nodeIds[index[i]] = i;

  // Canonical edge order (src, dst) so results never depend on event order.
  keep.sort((x, y) => index[ea[x]] - index[ea[y]] || index[eb[x]] - index[eb[y]]);
  const m = keep.length;
  const src = new Int32Array(m), dst = new Int32Array(m), w = new Float64Array(m), rawW = new Float64Array(m), layerMask = new Uint8Array(m);
  const byRule = {};
  for (const r of activeRules) byRule[r] = new Float64Array(m);
  const transform = s.weighting === 'log' ? (x) => Math.log1p(x) : s.weighting === 'binary' ? () => 1 : (x) => x;
  for (let k = 0; k < m; k++) {
    const e = keep[k];
    src[k] = index[ea[e]]; dst[k] = index[eb[e]];
    rawW[k] = raw[e]; w[k] = transform(raw[e]); layerMask[k] = mask[e];
    for (let r = 0; r < R_; r++) byRule[activeRules[r]][k] = ev[e * R_ + r];
  }

  const net = {
    n, nodeIds, index, directed,
    edges: { count: m, src, dst, w, raw: rawW, byRule, layerMask },
    settings: s,
    summary: null,
  };
  net.summary = summarize(net, drop, ea.length - m);
  return net;
}

function summarize(net, drop, droppedWeak) {
  const { n, edges } = net;
  const deg = new Int32Array(n);
  for (let e = 0; e < edges.count; e++) { deg[edges.src[e]]++; deg[edges.dst[e]]++; }
  let isolates = 0;
  for (let i = 0; i < n; i++) if (!deg[i]) isolates++;
  const byRule = {};
  for (const [r, arr] of Object.entries(edges.byRule)) {
    let ties = 0, evidence = 0;
    for (let e = 0; e < arr.length; e++) if (arr[e] > 0) { ties++; evidence += arr[e]; }
    byRule[r] = { ties, evidence };
  }
  const layers = {};
  LAYERS.forEach((l, b) => {
    let c = 0;
    for (let e = 0; e < edges.count; e++) if (edges.layerMask[e] & (1 << b)) c++;
    if (c) layers[l] = c;
  });
  let wMin = Infinity, wMax = -Infinity, wSum = 0;
  for (let e = 0; e < edges.count; e++) { const x = edges.w[e]; if (x < wMin) wMin = x; if (x > wMax) wMax = x; wSum += x; }
  return {
    nodes: n, edges: edges.count, isolates, directed: net.directed, weighting: net.settings.weighting,
    events: { considered: drop.events, used: drop.used, dropped: { bots: drop.bots, excluded: drop.excluded, time: drop.time, undated: drop.undated, visibility: drop.visibility, media: drop.media, broadcast: drop.broadcast, largeMeetings: drop.copresenceLarge } },
    tiesBelowMinWeight: droppedWeak,
    byRule, layers,
    weight: edges.count ? { min: wMin, max: wMax, mean: wSum / edges.count } : { min: 0, max: 0, mean: 0 },
  };
}

// ---- edgeEvidence ----------------------------------------------------------------

// The events that created the tie between dataset nodes a and b, under the
// network's own settings. For directed networks only a->b evidence is returned
// unless opts.bothDirections. Copresence evidence matches either direction.
// Returns an array of event summaries, oldest first, at most `limit`.
export function edgeEvidence(ds, net, a, b, { limit = 50, bothDirections = false } = {}) {
  const out = [];
  const any = !net.directed || bothDirections;
  forEachEvidence(ds, net.settings, (x, y, rule, amt, i, vis, sym) => {
    const fwd = x === a && y === b, rev = x === b && y === a;
    if (!(fwd || ((any || sym) && rev))) return;
    out.push({ i, rule: RULES[rule], amount: amt, from: x, to: y });
  });
  out.sort((p, q) => (ds.events.t[p.i] || 0) - (ds.events.t[q.i] || 0) || p.i - q.i);
  return out.slice(0, limit).map(o => summarizeEvent(ds, o));
}

export function summarizeEvent(ds, o) {
  const ev = ds.events, i = o.i, c = ev.context[i];
  const text = ev.text?.[i];
  return {
    event: i,
    t: ev.t[i],
    type: EVENT_TYPES[ev.type[i]],
    rule: o.rule,
    amount: o.amount,
    from: o.from, to: o.to,
    actor: ev.actor[i],
    actorLabel: ds.nodes.labels[ev.actor[i]],
    context: c >= 0 ? ds.contexts.names[c] : null,
    visibility: c >= 0 ? VISIBILITY[ds.contexts.visibility[c]] : 'unknown',
    text: text ? (text.length > 280 ? text.slice(0, 277) + '...' : text) : null,
  };
}

// Which views the dataset's sources record (for applicability).
export function sourceViews(ds) {
  const views = new Set((ds.meta?.sources || []).map(s => s.view || VIEWS.FULL));
  return views;
}

// ---- networks from plain edge lists --------------------------------------------------

// Build a Network directly from [a, b, weight] triples over nodes 0..n-1, for
// reference graphs, generator ground truth and tests. Duplicate ties are summed;
// in undirected networks a-b and b-a are the same tie.
export function networkFromEdges(n, edgeList, { directed = false, nodeIds = null, settings = {} } = {}) {
  const key = new Map();
  const ea = [], eb = [], ew = [];
  for (const [a0, b0, w0 = 1] of edgeList) {
    if (a0 === b0) continue;
    const a = directed ? a0 : Math.min(a0, b0), b = directed ? b0 : Math.max(a0, b0);
    const k = a * n + b;
    const e = key.get(k);
    if (e === undefined) { key.set(k, ea.length); ea.push(a); eb.push(b); ew.push(w0); } else ew[e] += w0;
  }
  const order = ea.map((_, i) => i).sort((x, y) => ea[x] - ea[y] || eb[x] - eb[y]);
  const m = order.length;
  const src = Int32Array.from(order, i => ea[i]), dst = Int32Array.from(order, i => eb[i]);
  const w = Float64Array.from(order, i => ew[i]);
  const ids = nodeIds ? Int32Array.from(nodeIds) : Int32Array.from({ length: n }, (_, i) => i);
  let maxId = n - 1;
  for (const d of ids) if (d > maxId) maxId = d;
  const index = new Int32Array(maxId + 1).fill(-1);
  ids.forEach((d, i) => { index[d] = i; });
  const net = {
    n, nodeIds: ids, index, directed,
    edges: { count: m, src, dst, w, raw: Float64Array.from(w), byRule: {}, layerMask: new Uint8Array(m) },
    settings: { directed, weighting: 'count', rules: {}, ...settings },
    summary: null,
  };
  net.summary = { nodes: n, edges: m, directed, weighting: 'count', fromEdgeList: true };
  return net;
}
