// Contract-faithful fakes for developing and testing the UI before (or
// without) the real modules. Loaded only behind the ?mock URL flag.
//
// Everything here follows docs/CONTRACTS.md shapes: the dataset is built with
// DatasetBuilder, the engine answers every Analysis-contract method, the
// pipeline returns { dataset, report, detections }. The numbers are honest
// computations on a small synthetic organisation (graph metrics are exact on
// small networks, sampled on big ones), but the methods are deliberately
// simple: this is a test double, not a second analysis engine.

import { DatasetBuilder, EVENT_TYPES, ROLES, VISIBILITY } from '../../core/model.js';
import { Graph, louvain, forceAtlas2 } from '../../../vendor/graphology.js';
import { RULES } from '../lib/dsutil.js';

// ---- seeded randomness -------------------------------------------------------

function rng(seed = 7) {
  let a = seed >>> 0 || 1;
  const r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = n => Math.floor(r() * n);
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  return r;
}

const sleep = ms => new Promise(res => setTimeout(res, ms));
function abortable(signal) { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); }

// ---- synthetic organisation -------------------------------------------------

const FIRST = ['Ada', 'Bram', 'Cleo', 'Dev', 'Esme', 'Felix', 'Gita', 'Hugo', 'Ines', 'Jun', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sami', 'Tess', 'Uma', 'Vik', 'Wren', 'Xavi', 'Yara', 'Zed'];
const LAST = ['Arden', 'Bell', 'Corr', 'Dale', 'Ennis', 'Frost', 'Gale', 'Hart', 'Irwin', 'Jost', 'Keel', 'Lund', 'Marsh', 'Nolan', 'Orr', 'Pike', 'Quill', 'Reyes', 'Stone', 'Toll'];
const DEPTS = ['Research', 'Engineering', 'Operations', 'Sales', 'People'];
const LOCS = ['North office', 'South office', 'Remote'];
const VOCAB = {
  Research: ['model', 'sample', 'estimate', 'survey', 'variance', 'cohort', 'replication', 'hypothesis'],
  Engineering: ['deploy', 'build', 'latency', 'bug', 'release', 'pipeline', 'schema', 'review'],
  Operations: ['vendor', 'invoice', 'schedule', 'facility', 'budget', 'contract', 'shipment', 'audit'],
  Sales: ['client', 'pipeline', 'renewal', 'pricing', 'demo', 'quota', 'proposal', 'lead'],
  People: ['hiring', 'onboarding', 'benefits', 'policy', 'review', 'training', 'wellbeing', 'offer'],
};
const COMMON = ['meeting', 'today', 'update', 'thanks', 'plan', 'question', 'draft', 'notes', 'week', 'team'];
const POS = ['great', 'thanks', 'good', 'happy', 'nice', 'love', 'excellent'];
const NEG = ['problem', 'late', 'worried', 'blocked', 'bad', 'frustrating', 'issue'];

export function mockDataset({ n = 96, seed = 11, days = 180, name = 'Demo organisation (synthetic)' } = {}) {
  const r = rng(seed);
  const b = new DatasetBuilder({ name });
  const t0 = Date.UTC(2026, 0, 5);
  const DAY = 86400000;

  // Source 1: a full Slack-like workspace export.
  b.beginSource({ format: 'slack', family: 'workplace', medium: 'chat', view: 'full', context: 'workplace', tz: 'UTC', fileNames: ['demo-workspace.zip'] });
  const people = [];
  for (let i = 0; i < n; i++) {
    const dept = DEPTS[i % DEPTS.length];
    const label = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}${i >= FIRST.length * LAST.length ? ' ' + i : ''}`;
    const idx = b.node(`slack:U${String(1000 + i)}`, {
      label,
      attrs: { department: dept, role: i % 9 === 0 ? 'Manager' : 'Individual contributor', location: LOCS[(i * 7) % 3], tenure_years: 1 + ((i * 13) % 14) },
      platformIds: { slack: `U${1000 + i}` },
    });
    people.push({ idx, dept, i, label });
  }
  const bot = b.node('slack:B0001', { label: 'Standup bot', isBot: true });
  const chans = DEPTS.map(d => b.context(`slack:C-${d}`, { name: `#${d.toLowerCase()}`, kind: 'channel', visibility: 'public', medium: 'chat' }));
  const general = b.context('slack:C-general', { name: '#general', kind: 'channel', visibility: 'public', medium: 'chat' });
  const priv = b.context('slack:G-leads', { name: 'leads', kind: 'channel', visibility: 'private', medium: 'chat' });
  const byDept = Object.fromEntries(DEPTS.map(d => [d, people.filter(p => p.dept === d)]));
  const brokers = new Set(people.filter(p => p.i % 17 === 3).map(p => p.idx));
  const msgsPer = n > 1000 ? 12 : 40;
  let k = 0;
  const lastInCtx = new Map();
  for (const p of people) {
    const m = Math.max(4, Math.round(msgsPer * (0.4 + r() * 1.4)));
    for (let j = 0; j < m; j++) {
      const t = t0 + r() * days * DAY;
      const cross = brokers.has(p.idx) ? 0.5 : 0.12;
      const otherDept = r() < cross ? r.pick(DEPTS) : p.dept;
      const target = r.pick(byDept[otherDept]);
      const ctx = r() < 0.15 ? general : r() < 0.04 && p.i % 9 === 0 ? priv : chans[DEPTS.indexOf(otherDept)];
      const dm = r() < 0.18;
      const words = [];
      const nw = 4 + r.int(8);
      for (let w = 0; w < nw; w++) words.push(r() < 0.55 ? r.pick(VOCAB[otherDept]) : r.pick(COMMON));
      // Affect: Operations gets a little more negative in the second half.
      const late = t > t0 + days * DAY / 2;
      const negBias = otherDept === 'Operations' && late ? 0.45 : 0.15;
      if (r() < 0.35) words.push(r() < negBias ? r.pick(NEG) : r.pick(POS));
      // Diffusion: "roadmap" spreads from Research after day 60.
      if (t > t0 + 60 * DAY && (p.dept === 'Research' || r() < (t - t0) / (days * DAY) * 0.25) && r() < 0.3) words.push('roadmap');
      const key = `m${k++}`;
      const targets = [];
      let parentKey = null;
      if (dm) targets.push([target.idx, 'dm']);
      else if (r() < 0.45) targets.push([target.idx, 'mention']);
      if (!dm && r() < 0.35 && lastInCtx.has(ctx)) {
        const prev = lastInCtx.get(ctx);
        parentKey = prev.key;
        targets.push([prev.actor, 'reply']);
      }
      const ctxId = dm ? b.context(`slack:D-${Math.min(p.idx, target.idx)}-${Math.max(p.idx, target.idx)}`, { name: 'Direct message', kind: 'dm', visibility: 'direct', medium: 'chat', members: [p.idx, target.idx] }) : ctx;
      b.event({ type: 'message', t, actor: p.idx, targets, context: ctxId, key, parentKey, text: words.join(' ') });
      b.stat('messages');
      if (!dm) lastInCtx.set(ctx, { key, actor: p.idx });
      if (r() < 0.08) { b.event({ type: 'reaction', t: t + 60000, actor: target.idx, targets: [[p.idx, 'subject']], context: ctxId, parentKey: key }); b.stat('reactions'); }
    }
  }
  for (let d = 0; d < days; d += 1) b.event({ type: 'message', t: t0 + d * DAY + 9 * 3600000, actor: bot, targets: [], context: general, text: 'Daily standup reminder' });
  b.warn('unknown-user', 'Messages from accounts missing from users.json (kept with their raw id)', 3);
  b.warn('edited-messages', 'Edited messages: the latest version is kept', 41);

  // Source 2: calendar meetings (copresence), the same people by email.
  b.beginSource({ format: 'calendar', family: 'workplace', medium: 'meeting', view: 'full', context: 'workplace', tz: 'UTC', fileNames: ['team-calendar.ics'] });
  const nMeet = Math.round(n * 0.8);
  for (let mI = 0; mI < nMeet; mI++) {
    const dept = r.pick(DEPTS);
    const size = 3 + r.int(5);
    const att = new Set();
    while (att.size < size) att.add(r() < 0.8 ? r.pick(byDept[dept]).idx : r.pick(people).idx);
    const [org, ...rest] = [...att];
    const ctx = b.context(`cal:M${mI}`, { name: `${dept} sync`, kind: 'meeting', visibility: 'group', medium: 'meeting' });
    b.event({ type: 'copresence', t: t0 + r() * days * DAY, actor: org, targets: rest.map(x => [x, 'attendee']), context: ctx });
    b.stat('meetings');
  }
  b.warn('recurring-expanded', 'Recurring meetings expanded within the export window', 12);
  b.warn('no-attendees', 'Meetings with no attendee list were skipped', 5);

  // Source 3: one person's mailbox (ego view), with a duplicate identity for
  // the identity-review step to find.
  b.beginSource({ format: 'mbox', family: 'workplace', medium: 'email', view: 'ego', context: 'workplace', tz: 'UTC', fileNames: ['ada.mbox'], egoKey: 'email:ada.arden@example.org' });
  const egoE = b.node('email:ada.arden@example.org', { label: 'Ada Arden', platformIds: { email: 'ada.arden@example.org' } });
  const contacts = people.slice(1, 18).map(p => b.node(`email:${p.label.toLowerCase().replace(/\s+/g, '.')}@example.org`, { label: p.label, platformIds: { email: `${p.label.toLowerCase().replace(/\s+/g, '.')}@example.org` } }));
  const thread = b.context('email:T1', { name: 'Quarterly plan', kind: 'email_thread', visibility: 'private', medium: 'email' });
  for (let e = 0; e < 60; e++) {
    const to = r.pick(contacts);
    const cc = r() < 0.3 ? [[r.pick(contacts), 'cc']] : [];
    const out = r() < 0.5;
    b.event({ type: 'message', t: t0 + r() * days * DAY, actor: out ? egoE : to, targets: [[out ? to : egoE, 'to'], ...cc], context: thread, text: r() < 0.5 ? 'quarterly plan budget draft' : null });
    b.stat('emails');
  }
  b.warn('missing-date', 'Messages without a parseable Date header', 2);

  return b.build();
}

// ---- replay: rebuild a Dataset through DatasetBuilder ----------------------
// Used by the fake merge, identity merge and profile join. mapKey lets a node
// be renamed onto another (merging identities); extraAttrs adds attributes.

export function replay(datasets, { name, mapKey = k => k, extraAttrs = null } = {}) {
  const b = new DatasetBuilder({ name: name || datasets.map(d => d.meta.name).join(' + ') });
  for (const ds of datasets) {
    const nodeMap = new Int32Array(ds.nodes.count);
    const ctxMap = new Int32Array(ds.contexts.count);
    let sourceOpen = -1;
    const ensureSource = sid => {
      if (sourceOpen === sid) return;
      const s = ds.meta.sources[sid];
      if (s.__replayed == null) {
        const { id, counts, warnings, ...info } = s;
        const nid = b.beginSource(info);
        b.source.counts = { ...counts };
        b.source.warnings = warnings.map(w => ({ ...w }));
        s.__replayed = nid;
      } else b._source = s.__replayed;
      sourceOpen = sid;
    };
    for (const s of ds.meta.sources) delete s.__replayed;
    if (!ds.meta.sources.length) b.beginSource({ format: 'unknown' });
    else ensureSource(0);
    for (let i = 0; i < ds.nodes.count; i++) {
      const key = mapKey(ds.nodes.keys[i]);
      const extra = extraAttrs?.get(key) || null;
      nodeMap[i] = b.node(key, { label: ds.nodes.labels[i], attrs: { ...ds.nodes.attrs[i], ...(extra || {}) }, isBot: !!ds.nodes.isBot[i], platformIds: ds.nodes.platformIds[i] });
    }
    for (let c = 0; c < ds.contexts.count; c++) {
      ctxMap[c] = b.context(ds.contexts.keys[c], { name: ds.contexts.names[c], kind: ds.contexts.kinds[c], visibility: VISIBILITY[ds.contexts.visibility[c]], medium: ds.contexts.medium[c], members: ds.contexts.members[c]?.map(m => nodeMap[m]) });
    }
    const e = ds.events;
    for (let i = 0; i < e.count; i++) {
      ensureSource(e.source[i]);
      const targets = [];
      for (let j = e.tOff[i]; j < e.tOff[i + 1]; j++) targets.push([nodeMap[e.tgt[j]], ROLES[e.role[j]]]);
      b.event({ type: EVENT_TYPES[e.type[i]], t: e.t[i], actor: nodeMap[e.actor[i]], targets, context: e.context[i] >= 0 ? ctxMap[e.context[i]] : -1, key: e.keys[i], parentKey: e.parent[i] >= 0 ? e.keys[e.parent[i]] : null, text: e.text[i], weight: e.weight[i] });
    }
    for (const s of ds.meta.sources) delete s.__replayed;
  }
  const out = b.build();
  // replay re-resolves parents; drop duplicate unresolved-parent warnings it adds.
  for (const s of out.meta.sources) {
    const seen = new Set();
    s.warnings = s.warnings.filter(w => { const k = w.code; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  return out;
}

// ---- fake analysis -----------------------------------------------------------

const RI = Object.fromEntries(RULES.map((r, i) => [r, i]));
const T = Object.fromEntries(EVENT_TYPES.map((t, i) => [t, i]));
const R = Object.fromEntries(ROLES.map((r, i) => [r, i]));

export function defaultSettings(ds) {
  const ev = {};
  for (const r of RULES) ev[r] = 0;
  const e = ds.events;
  for (let i = 0; i < e.count; i++) {
    const ty = e.type[i];
    if (ty === T.copresence) ev.copresence++;
    if (ty === T.reaction) ev.reaction++;
    if (ty === T.repost) ev.repost++;
    if (ty === T.like) ev.like++;
    if (ty === T.follow) ev.follow++;
    if (ty === T.declared) ev.declared++;
    for (let j = e.tOff[i]; j < e.tOff[i + 1]; j++) {
      const role = ROLES[e.role[j]];
      if (ty === T.message && role in ev) ev[role]++;
    }
  }
  const rules = {};
  for (const r of RULES) rules[r] = { on: ev[r] > 0, weight: r === 'adjacency' ? 0.5 : 1, evidence: ev[r] };
  rules.adjacency.windowMin = 10;
  rules.copresence.normalize = true;
  let hasBots = false;
  for (let i = 0; i < ds.nodes.count; i++) if (ds.nodes.isBot[i]) hasBots = true;
  return {
    rules, directed: true, weighting: 'count', minWeight: 0, maxRecipients: 25,
    time: { start: null, end: null }, visibility: [...VISIBILITY], media: null,
    excludeBots: true, excludeNodes: [], includeIsolates: true, _hasBots: hasBots,
  };
}

function forEachTie(ds, s, emit, { mult = null, start = null, end = null } = {}) {
  const e = ds.events;
  const visOk = new Set((s.visibility || VISIBILITY).map(v => VISIBILITY.indexOf(v)));
  const media = s.media?.length ? new Set(s.media) : null;
  const ts = s.time?.start ?? start, te = s.time?.end ?? end;
  for (let i = 0; i < e.count; i++) {
    if (mult && !mult[i]) continue;
    const t = e.t[i];
    if ((ts != null || te != null) && (!Number.isFinite(t) || (ts != null && t < ts) || (te != null && t >= te))) continue;
    if (start != null && !(t >= start)) continue;
    if (end != null && !(t < end)) continue;
    const a = e.actor[i];
    if (s.excludeBots && ds.nodes.isBot[a]) continue;
    if (s.excludeNodes?.includes(a)) continue;
    const c = e.context[i];
    if (!visOk.has(c >= 0 ? ds.contexts.visibility[c] : 4)) continue;
    if (media && !media.has(c >= 0 ? ds.contexts.medium[c] : 'unknown')) continue;
    const ty = e.type[i];
    const amt = (mult ? mult[i] : 1) * e.weight[i];
    const a0 = e.tOff[i], a1 = e.tOff[i + 1];
    if (ty === T.copresence) {
      if (!s.rules.copresence?.on) continue;
      const ppl = [a];
      for (let j = a0; j < a1; j++) if (!ppl.includes(e.tgt[j])) ppl.push(e.tgt[j]);
      if (ppl.length > (s.maxRecipients || Infinity)) continue;
      const per = s.rules.copresence.normalize !== false ? amt / (ppl.length - 1) : amt;
      for (let p = 0; p < ppl.length; p++) for (let q = p + 1; q < ppl.length; q++) emit(ppl[p], ppl[q], RI.copresence, per * s.rules.copresence.weight, i, c, true);
      continue;
    }
    if (a1 - a0 > (s.maxRecipients || Infinity)) continue;
    for (let j = a0; j < a1; j++) {
      const x = e.tgt[j];
      if (s.excludeBots && ds.nodes.isBot[x]) continue;
      let rule = ROLES[e.role[j]];
      if (rule === 'subject') rule = EVENT_TYPES[ty];
      if (rule === 'attendee' || rule === 'member') continue;
      if (!(rule in RI) || !s.rules[rule]?.on) continue;
      emit(a, x, RI[rule], amt * s.rules[rule].weight, i, c, false);
    }
  }
}

export function buildNetwork(ds, settings, opts = {}) {
  const s = settings;
  const pair = new Map();
  const present = new Uint8Array(ds.nodes.count);
  forEachTie(ds, s, (a, b, rule, amt, i, c, sym) => {
    let x = a, y = b;
    if (!s.directed || sym) { if (x > y) { const tt = x; x = y; y = tt; } }
    const key = x * 1e6 + y;
    let p = pair.get(key);
    if (!p) { p = { a: x, b: y, w: 0, by: new Float64Array(RULES.length), mask: 0 }; pair.set(key, p); }
    p.w += amt; p.by[rule] += amt; p.mask |= 1 << (c >= 0 ? ds.contexts.visibility[c] : 4);
    present[a] = 1; present[b] = 1;
    if (s.directed && sym) { /* copresence counted once, both directions below */ }
  }, opts);
  if (s.includeIsolates) for (let i = 0; i < ds.nodes.count; i++) if (!(s.excludeBots && ds.nodes.isBot[i]) && !s.excludeNodes?.includes(i)) present[i] = 1;
  const nodeIds = [];
  const toNet = new Int32Array(ds.nodes.count).fill(-1);
  for (let i = 0; i < ds.nodes.count; i++) if (present[i]) { toNet[i] = nodeIds.length; nodeIds.push(i); }
  const list = [];
  for (const p of pair.values()) {
    let w = p.w;
    if (s.weighting === 'log') w = Math.log1p(w);
    else if (s.weighting === 'binary') w = 1;
    if (w < (s.minWeight || 0) || w <= 0) continue;
    list.push({ ...p, w });
  }
  const m = list.length;
  const edges = { count: m, src: new Int32Array(m), dst: new Int32Array(m), w: new Float64Array(m), byRule: {}, layerMask: new Uint8Array(m) };
  for (const r of RULES) edges.byRule[r] = new Float64Array(m);
  list.forEach((p, k) => {
    edges.src[k] = toNet[p.a]; edges.dst[k] = toNet[p.b]; edges.w[k] = p.w; edges.layerMask[k] = p.mask;
    RULES.forEach((r, ri) => { edges.byRule[r][k] = p.by[ri]; });
  });
  for (const r of RULES) if (!edges.byRule[r].some(x => x > 0)) delete edges.byRule[r];
  const n = nodeIds.length;
  return { n, nodeIds: Int32Array.from(nodeIds), directed: !!s.directed, edges, settings: s, summary: { nodes: n, edges: m, density: n > 1 ? m / (n * (n - 1) / (s.directed ? 1 : 2)) : 0 } };
}

function adjacency(net, undirected = false) {
  const nb = Array.from({ length: net.n }, () => new Map());
  const { src, dst, w, count } = net.edges;
  for (let k = 0; k < count; k++) {
    const a = src[k], b = dst[k];
    nb[a].set(b, (nb[a].get(b) || 0) + w[k]);
    if (!net.directed || undirected) nb[b].set(a, (nb[b].get(a) || 0) + w[k]);
  }
  return nb;
}

function brandes(net, nb, sources) {
  const n = net.n;
  const bc = new Float64Array(n);
  const close = new Float64Array(n);
  for (const s of sources) {
    const stack = [], pred = Array.from({ length: n }, () => []), sigma = new Float64Array(n), dist = new Int32Array(n).fill(-1);
    sigma[s] = 1; dist[s] = 0;
    const q = [s]; let h = 0;
    while (h < q.length) { const v = q[h++]; stack.push(v); for (const wv of nb[v].keys()) { if (dist[wv] < 0) { dist[wv] = dist[v] + 1; q.push(wv); } if (dist[wv] === dist[v] + 1) { sigma[wv] += sigma[v]; pred[wv].push(v); } } }
    for (let v = 0; v < n; v++) if (dist[v] > 0) close[s] += 1 / dist[v];
    const delta = new Float64Array(n);
    while (stack.length) { const wv = stack.pop(); for (const v of pred[wv]) delta[v] += sigma[v] / sigma[wv] * (1 + delta[wv]); if (wv !== s) bc[wv] += delta[wv]; }
  }
  const scale = sources.length < n ? n / sources.length : 1;
  const norm = n > 2 ? 1 / ((n - 1) * (n - 2)) : 1;
  for (let v = 0; v < n; v++) { bc[v] *= scale * norm * (net.directed ? 1 : 2) / (net.directed ? 1 : 2); close[v] = close[v] / Math.max(1, n - 1); }
  return { bc, close };
}

export function computeNodeMetrics(net, { which = null, approx = false } = {}) {
  const n = net.n;
  const out = {};
  const nbOut = adjacency(net);
  const nbU = adjacency(net, true);
  const deg = new Float64Array(n), indeg = new Float64Array(n), outdeg = new Float64Array(n), str = new Float64Array(n), instr = new Float64Array(n), outstr = new Float64Array(n);
  const { src, dst, w, count } = net.edges;
  for (let k = 0; k < count; k++) { outdeg[src[k]]++; indeg[dst[k]]++; outstr[src[k]] += w[k]; instr[dst[k]] += w[k]; }
  for (let v = 0; v < n; v++) { deg[v] = nbU[v].size; str[v] = net.directed ? instr[v] + outstr[v] : outstr[v] + instr[v]; }
  Object.assign(out, { degree: deg, strength: str });
  if (net.directed) Object.assign(out, { inDegree: indeg, outDegree: outdeg, inStrength: instr, outStrength: outstr });
  const sample = n > 800 || approx;
  const r = rng(3);
  const sources = sample ? Array.from({ length: Math.min(n, 200) }, () => r.int(n)) : [...Array(n).keys()];
  const { bc, close } = brandes(net, nbU, [...new Set(sources)]);
  out.betweenness = bc; out.closeness = close;
  // PageRank (power iteration on the directed graph).
  const pr = new Float64Array(n).fill(1 / Math.max(1, n));
  for (let it = 0; it < 40; it++) {
    const nx = new Float64Array(n).fill(0.15 / n);
    let dangling = 0;
    for (let v = 0; v < n; v++) { const ws = [...nbOut[v].values()].reduce((a, b) => a + b, 0); if (!ws) { dangling += pr[v]; continue; } for (const [u, x] of nbOut[v]) nx[u] += 0.85 * pr[v] * x / ws; }
    for (let v = 0; v < n; v++) nx[v] += 0.85 * dangling / n;
    pr.set(nx);
  }
  out.pagerank = pr;
  const ev = new Float64Array(n).fill(1);
  for (let it = 0; it < 60; it++) { const nx = new Float64Array(n); for (let v = 0; v < n; v++) for (const [u, x] of nbU[v]) nx[u] += ev[v] * x; const mx = Math.max(...nx) || 1; for (let v = 0; v < n; v++) ev[v] = nx[v] / mx; }
  out.eigenvector = ev;
  const cl = new Float64Array(n), cons = new Float64Array(n), eff = new Float64Array(n), egoD = new Float64Array(n), core = new Float64Array(n), rec = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    const ns = [...nbU[v].keys()]; const kdeg = ns.length;
    let links = 0;
    for (let a = 0; a < kdeg; a++) for (let b = a + 1; b < kdeg; b++) if (nbU[ns[a]].has(ns[b])) links++;
    cl[v] = kdeg < 2 ? NaN : links / (kdeg * (kdeg - 1) / 2);
    egoD[v] = cl[v];
    eff[v] = kdeg ? kdeg - (2 * links) / kdeg : NaN;
    const tot = [...nbU[v].values()].reduce((a, b) => a + b, 0) || 1;
    let c = 0;
    for (const j of ns) { let pij = nbU[v].get(j) / tot; for (const q of ns) if (q !== j && nbU[q].has(j)) { const tq = [...nbU[q].values()].reduce((a, b) => a + b, 0) || 1; pij += (nbU[v].get(q) / tot) * (nbU[q].get(j) / tq); } c += pij * pij; }
    cons[v] = kdeg ? c : NaN;
    if (net.directed) { let both = 0; for (const u of nbOut[v].keys()) if (nbOut[u].has(v)) both++; rec[v] = nbOut[v].size ? both / nbOut[v].size : NaN; }
  }
  // k-core by peeling
  const d = Float64Array.from(deg); const removed = new Uint8Array(n);
  let kc = 0;
  for (let left = n; left > 0;) { let changed = true; while (changed) { changed = false; for (let v = 0; v < n; v++) if (!removed[v] && d[v] <= kc) { removed[v] = 1; core[v] = kc; left--; changed = true; for (const u of nbU[v].keys()) d[u]--; } } kc++; if (kc > n) break; }
  Object.assign(out, { clustering: cl, coreNumber: core, constraint: cons, effectiveSize: eff, egoDensity: egoD });
  if (net.directed) out.reciprocity = rec;
  if (which) for (const k of Object.keys(out)) if (!which.includes(k)) delete out[k];
  out.meta = sample ? { betweenness: { approximate: true, pivots: 200, method: 'sampled sources (demo engine)' }, closeness: { approximate: true, pivots: 200 } } : {};
  return out;
}

function toGraph(net) {
  const g = new Graph({ type: 'undirected' });
  for (let v = 0; v < net.n; v++) g.addNode(v);
  const { src, dst, w, count } = net.edges;
  for (let k = 0; k < count; k++) { const a = src[k], b = dst[k]; if (a === b) continue; if (g.hasEdge(a, b)) g.updateEdgeAttribute(a, b, 'weight', x => x + w[k]); else g.addEdge(a, b, { weight: w[k] }); }
  return g;
}

export function computeNetworkMetrics(net) {
  const n = net.n, m = net.edges.count;
  const nb = adjacency(net, true);
  let tri = 0, trip = 0, recip = 0;
  for (let v = 0; v < n; v++) { const ns = [...nb[v].keys()]; const k = ns.length; trip += k * (k - 1) / 2; for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) if (nb[ns[a]].has(ns[b])) tri++; }
  if (net.directed) { const set = new Set(); for (let k = 0; k < m; k++) set.add(net.edges.src[k] * 1e6 + net.edges.dst[k]); for (let k = 0; k < m; k++) if (set.has(net.edges.dst[k] * 1e6 + net.edges.src[k])) recip++; }
  const comp = new Int32Array(n).fill(-1); let nc = 0; const sizes = [];
  for (let v = 0; v < n; v++) { if (comp[v] >= 0) continue; const q = [v]; comp[v] = nc; let s = 0; while (q.length) { const x = q.pop(); s++; for (const u of nb[x].keys()) if (comp[u] < 0) { comp[u] = nc; q.push(u); } } sizes.push(s); nc++; }
  const deg = nb.map(x => x.size); const maxd = Math.max(0, ...deg);
  const str = nb.map(x => [...x.values()].reduce((a, b) => a + b, 0)).sort((a, b) => a - b);
  const tot = str.reduce((a, b) => a + b, 0) || 1;
  let gini = 0; str.forEach((x, i) => { gini += (2 * (i + 1) - n - 1) * x; }); gini /= n * tot;
  let cl = 0, cln = 0;
  for (let v = 0; v < n; v++) { const ns = [...nb[v].keys()]; if (ns.length < 2) continue; let l = 0; for (let a = 0; a < ns.length; a++) for (let b = a + 1; b < ns.length; b++) if (nb[ns[a]].has(ns[b])) l++; cl += l / (ns.length * (ns.length - 1) / 2); cln++; }
  // average path length from a sample of sources inside the largest component
  const big = sizes.indexOf(Math.max(...sizes));
  let pl = 0, pc = 0; const r = rng(5);
  const inBig = [...Array(n).keys()].filter(v => comp[v] === big);
  for (let s = 0; s < Math.min(60, inBig.length); s++) { const src0 = inBig[r.int(inBig.length)]; const dist = new Int32Array(n).fill(-1); dist[src0] = 0; const q = [src0]; let h = 0; while (h < q.length) { const x = q[h++]; for (const u of nb[x].keys()) if (dist[u] < 0) { dist[u] = dist[x] + 1; q.push(u); pl += dist[u]; pc++; } } }
  return {
    nodes: n, edges: m, ties: m, directed: net.directed,
    density: n > 1 ? m / (n * (n - 1) / (net.directed ? 1 : 2)) : 0,
    reciprocity: net.directed && m ? recip / m : NaN,
    transitivity: trip ? tri / trip : 0,
    avgClustering: cln ? cl / cln : 0,
    components: nc,
    largestComponentShare: n ? Math.max(...sizes) / n : 0,
    avgPathLength: pc ? pl / pc : NaN,
    degreeCentralization: n > 2 ? deg.reduce((a, d) => a + (maxd - d), 0) / ((n - 1) * (n - 2)) : 0,
    strengthGini: gini,
  };
}

export function detectCommunities(net, { resolution = 1, seed = 1 } = {}) {
  const g = toGraph(net);
  const r = rng(seed);
  const res = louvain.detailed(g, { resolution, rng: r, getEdgeWeight: 'weight' });
  const membership = new Int32Array(net.n);
  // Renumber communities by size so community 0 is the largest (stable colours).
  const sizes = new Map();
  for (let v = 0; v < net.n; v++) sizes.set(res.communities[v], (sizes.get(res.communities[v]) || 0) + 1);
  const order = [...sizes.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const ren = new Map(order.map((c, i) => [c, i]));
  for (let v = 0; v < net.n; v++) membership[v] = ren.get(res.communities[v]);
  const sz = new Array(res.count).fill(0); for (const c of membership) sz[c]++;
  return { membership, modularity: res.modularity, count: res.count, nontrivial: sz.filter(x => x > 1).length, sizes: sz, resolution, seed };
}

export function layout(net, { seed = 1 } = {}) {
  const g = toGraph(net);
  const r = rng(seed);
  const n = net.n;
  g.forEachNode((v) => { const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 100; g.setNodeAttribute(v, 'x', Math.cos(a) * rad); g.setNodeAttribute(v, 'y', Math.sin(a) * rad); });
  const iterations = n > 2000 ? 40 : n > 500 ? 120 : 300;
  forceAtlas2.assign(g, { iterations, settings: { ...forceAtlas2.inferSettings(g), barnesHutOptimize: n > 300, gravity: 1, scalingRatio: 4, strongGravityMode: true } });
  const x = new Float32Array(n), y = new Float32Array(n);
  g.forEachNode((v, a) => { x[+v] = a.x; y[+v] = a.y; });
  return { x, y };
}

// Shapes below follow src/analysis/{groups,uncertainty,time}.js as landed.
function codesFor(net, ds, attrKey, membership) {
  const lab = new Array(net.n);
  for (let v = 0; v < net.n; v++) {
    const raw = attrKey === '__community' ? membership?.[v] : ds.nodes.attrs[net.nodeIds[v]][attrKey];
    lab[v] = raw == null || raw === '' ? '' : String(raw);
  }
  const counts = new Map();
  for (const l of lab) if (l !== '') counts.set(l, (counts.get(l) || 0) + 1);
  const values = [...counts.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const idx = new Map(values.map((v, i) => [v, i]));
  return { codes: Int32Array.from(lab, l => (l === '' ? -1 : idx.get(l))), values };
}

function mixingOf(net, codes, k) {
  const counts = Array.from({ length: k }, () => new Float64Array(k));
  const weights = Array.from({ length: k }, () => new Float64Array(k));
  const { src, dst, w, count } = net.edges;
  let I = 0, E = 0;
  for (let e = 0; e < count; e++) {
    const a = codes[src[e]], b = codes[dst[e]];
    if (a < 0 || b < 0) continue;
    counts[a][b]++; weights[a][b] += w[e];
    if (!net.directed && a !== b) { counts[b][a]++; weights[b][a] += w[e]; }
    if (a === b) I++; else E++;
  }
  return { counts, weights, I, E };
}

function assortOf(M) {
  const k = M.length; let tot = 0;
  for (const r of M) for (const x of r) tot += x;
  if (!tot) return NaN;
  let tr = 0, ab = 0; const a = new Float64Array(k), b = new Float64Array(k);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { const e = M[i][j] / tot; if (i === j) tr += e; a[i] += e; b[j] += e; }
  for (let i = 0; i < k; i++) ab += a[i] * b[i];
  return ab === 1 ? NaN : (tr - ab) / (1 - ab);
}

export function groupMetrics(net, ds, attrKey, { membership = null } = {}) {
  const { codes, values } = codesFor(net, ds, attrKey, membership);
  const k = values.length;
  let known = 0; for (const c of codes) if (c >= 0) known++;
  const res = { attr: attrKey, type: 'categorical', coverage: net.n ? known / net.n : 0, nodesWithValue: known, values };
  if (!k) return { ...res, groups: [], mixing: null, assortativity: NaN, eiIndex: NaN };
  const size = new Float64Array(k); for (const c of codes) if (c >= 0) size[c]++;
  const { counts, weights, I, E } = mixingOf(net, codes, k);
  const possible = (a, b) => (a === b ? (net.directed ? size[a] * (size[a] - 1) : size[a] * (size[a] - 1) / 2) : size[a] * size[b]);
  const density = counts.map((row, a) => Array.from(row, (c, b) => (possible(a, b) ? c / possible(a, b) : NaN)));
  const groups = values.map((value, a) => {
    let ext = 0; for (let b = 0; b < k; b++) if (b !== a) ext += counts[a][b] + (net.directed ? counts[b][a] : 0);
    const internal = counts[a][a];
    return { value, size: size[a], internalTies: internal, externalTies: ext, density: density[a][a], eiIndex: internal + ext ? (ext - internal) / (ext + internal) : NaN };
  });
  // Tie-end mixing (undirected ties counted both ways) for assortativity.
  const ends = counts.map((r, a) => Array.from(r, (c, b) => (net.directed ? c : (a === b ? 2 * c : c))));
  return { ...res, groups, mixing: { values, counts: counts.map(r => Array.from(r)), weights: weights.map(r => Array.from(r)), density }, assortativity: assortOf(ends), eiIndex: I + E ? (E - I) / (E + I) : NaN, withinTies: I, betweenTies: E };
}

export function egoMetrics(net, dsNode, { ds = null, attr = null } = {}) {
  const v = [...net.nodeIds].indexOf(dsNode);
  if (v < 0) return { node: dsNode, inNetwork: false };
  const nb = adjacency(net, true);
  const ns = [...nb[v].keys()];
  let links = 0; for (let a = 0; a < ns.length; a++) for (let b = a + 1; b < ns.length; b++) if (nb[ns[a]].has(ns[b])) links++;
  const k = ns.length;
  const m = computeNodeMetrics(net, { which: ['constraint', 'effectiveSize'] });
  const res = { node: dsNode, inNetwork: true, size: k, strength: [...nb[v].values()].reduce((a, b) => a + b, 0), tiesAmongAlters: links, density: k > 1 ? links / (k * (k - 1) / 2) : NaN, effectiveSize: m.effectiveSize[v], efficiency: k ? m.effectiveSize[v] / k : NaN, constraint: m.constraint[v], alters: ns.map(u => net.nodeIds[u]) };
  if (ds && attr) {
    const ev = ds.nodes.attrs[dsNode][attr];
    const vals = ns.map(u => ds.nodes.attrs[net.nodeIds[u]][attr]).filter(x => x != null);
    const cnt = new Map(); for (const x of vals) cnt.set(x, (cnt.get(x) || 0) + 1);
    let blau = 1; for (const c of cnt.values()) blau -= (c / vals.length) ** 2;
    Object.assign(res, { attr, altersWithValue: vals.length, diversity: vals.length ? blau : NaN, egoValue: ev ?? null, homophily: ev != null && vals.length ? vals.filter(x => x === ev).length / vals.length : NaN });
  }
  return res;
}

function summarise(obs, xs) {
  const k = xs.length; const mean = xs.reduce((a, b) => a + b, 0) / (k || 1);
  const sd = k > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (k - 1)) : 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return { observed: obs, mean, sd, z: sd > 0 ? (obs - mean) / sd : NaN, p: (xs.filter(x => Math.abs(x - mean) >= Math.abs(obs - mean)).length + 1) / (k + 1), lo: sorted[Math.floor(k * 0.025)], hi: sorted[Math.min(k - 1, Math.ceil(k * 0.975) - 1)] };
}

// Degree-preserving null is the real engine's; the mock shuffles tie ends
// (configuration-model flavour) which is close enough for UI work.
export function nullModel(net, { stats = ['reciprocity', 'transitivity', 'avgClustering'], reps = 50, seed = 1, ds = null, attr = null, membership = null } = {}) {
  const r = rng(seed);
  let use = stats.filter(s => !(s === 'reciprocity' && !net.directed));
  const codes = ds && attr ? codesFor(net, ds, attr, membership) : null;
  if (!codes) use = use.filter(s => s !== 'attrAssortativity' && s !== 'eiIndex');
  const statOf = (nt) => {
    const out = {};
    const nm = use.some(s => ['reciprocity', 'transitivity', 'avgClustering'].includes(s)) ? computeNetworkMetrics(nt) : {};
    for (const s of use) {
      if (s in nm) out[s] = nm[s];
      else if (s === 'attrAssortativity' || s === 'eiIndex') {
        const mx = mixingOf(nt, codes.codes, codes.values.length);
        out.attrAssortativity = assortOf(mx.counts.map((rr, a) => Array.from(rr, (c, b) => (nt.directed ? c : a === b ? 2 * c : c))));
        out.eiIndex = mx.I + mx.E ? (mx.E - mx.I) / (mx.E + mx.I) : NaN;
      } else if (s === 'modularity' && membership) {
        // Newman modularity on the binary symmetrised graph.
        const deg = new Float64Array(nt.n); const inside = new Map(); const tot = new Map(); let m2 = 0;
        for (let e = 0; e < nt.edges.count; e++) { const a = nt.edges.src[e], b = nt.edges.dst[e]; deg[a]++; deg[b]++; m2 += 2; if (membership[a] === membership[b]) inside.set(membership[a], (inside.get(membership[a]) || 0) + 2); }
        for (let v = 0; v < nt.n; v++) tot.set(membership[v], (tot.get(membership[v]) || 0) + deg[v]);
        let q = 0; for (const [c, d] of tot) q += (inside.get(c) || 0) / m2 - (d / m2) ** 2;
        out.modularity = q;
      }
    }
    return out;
  };
  const obs = statOf(net);
  const samples = Object.fromEntries(use.map(s => [s, []]));
  const m = net.edges.count;
  for (let k = 0; k < reps; k++) {
    const dst = Int32Array.from(net.edges.dst);
    for (let i = m - 1; i > 0; i--) { const j = r.int(i + 1); const t = dst[i]; dst[i] = dst[j]; dst[j] = t; }
    const st = statOf({ ...net, edges: { ...net.edges, dst } });
    for (const s of use) samples[s].push(st[s]);
  }
  const res = {};
  for (const s of use) res[s] = summarise(obs[s], samples[s].filter(Number.isFinite));
  res.meta = { reps, seed, model: 'tie-end shuffle preserving out-degrees (demo engine)', binary: true, ...(codes ? { attr } : {}) };
  return res;
}

export function resampleRanks(ds, settings, { metric = 'betweenness', reps = 30, top = 10, seed = 1, limit } = {}) {
  const r = rng(seed);
  const base = buildNetwork(ds, settings);
  const vals0 = computeNodeMetrics(base, { which: [metric], approx: true })[metric];
  const rankArr = (vals) => { const o = [...vals.keys()].sort((a, b) => (vals[b] || 0) - (vals[a] || 0)); const rk = new Int32Array(vals.length); o.forEach((v, i) => { rk[v] = i + 1; }); return rk; };
  const rk0 = rankArr(vals0);
  const samples = Array.from({ length: base.n }, () => []);
  const inTop = new Int32Array(base.n);
  const idx = new Map([...base.nodeIds].map((d, v) => [d, v]));
  for (let k = 0; k < reps; k++) {
    const mult = new Uint32Array(ds.events.count);
    for (let i = 0; i < ds.events.count; i++) mult[r.int(ds.events.count)]++;
    const bn = buildNetwork(ds, settings, { mult });
    const v1 = computeNodeMetrics(bn, { which: [metric], approx: true })[metric];
    const x = new Float64Array(base.n);
    bn.nodeIds.forEach((d, j) => { const i = idx.get(d); if (i != null) x[i] = v1[j] || 0; });
    const rk = rankArr(x);
    for (let i = 0; i < base.n; i++) { samples[i].push(rk[i]); if (rk[i] <= top) inTop[i]++; }
  }
  const order = [...Array(base.n).keys()].sort((a, b) => rk0[a] - rk0[b]);
  const nodes = order.slice(0, limit ?? base.n).map(i => { const s = samples[i].sort((a, b) => a - b); return { node: base.nodeIds[i], label: ds.nodes.labels[base.nodeIds[i]], value: vals0[i], rank: rk0[i], lo: s[Math.floor(s.length * 0.025)], hi: s[Math.min(s.length - 1, Math.ceil(s.length * 0.975) - 1)], median: s[Math.floor(s.length / 2)], topShare: inTop[i] / reps }; });
  return nodes;
}

export function applicability(ds, net) {
  const views = new Set(ds.meta.sources.map(s => s.view));
  const onlyEgo = views.size > 0 && [...views].every(v => v === 'ego');
  const mixed = views.has('ego') && views.size > 1;
  const out = {};
  const keys = ['degree', 'inDegree', 'outDegree', 'strength', 'inStrength', 'outStrength', 'betweenness', 'closeness', 'eigenvector', 'pagerank', 'clustering', 'coreNumber', 'reciprocity', 'constraint', 'effectiveSize', 'egoDensity', 'density', 'transitivity', 'avgClustering', 'communities', 'groups', 'affect', 'keywords', 'topics', 'diffusion', 'timeSeries'];
  for (const k of keys) out[k] = { level: 'ok', reasons: [] };
  const flag = (ks, level, reason) => { for (const k of ks) { if (level === 'na' || out[k].level === 'ok') out[k].level = level; out[k].reasons.push(reason); } };
  const whole = ['betweenness', 'closeness', 'eigenvector', 'pagerank', 'coreNumber', 'communities'];
  if (onlyEgo) flag(['betweenness', 'closeness'], 'na', "This is one person's export: every path runs through its owner.");
  else if (mixed) flag(whole, 'caution', "Some sources are one person's export; their owners look more central than they are.");
  if (!net.directed) { flag(['inDegree', 'outDegree', 'inStrength', 'outStrength'], 'na', 'The network is undirected; in and out are the same as degree.'); flag(['reciprocity'], 'na', 'Reciprocity needs a directed network.'); }
  out.affect = { level: 'caution', reasons: ['Lexicon sentiment is approximate: it misses sarcasm, jargon and context.'] };
  return out;
}

function monthWindows(ds, window) {
  let lo = Infinity, hi = -Infinity;
  for (const t of ds.events.t) if (t === t) { if (t < lo) lo = t; if (t > hi) hi = t; }
  const out = [];
  if (!Number.isFinite(lo)) return out;
  const DAY = 86400000;
  if (window === 'day') { let s = Date.UTC(new Date(lo).getUTCFullYear(), new Date(lo).getUTCMonth(), new Date(lo).getUTCDate()); while (s <= hi) { out.push({ start: s, end: s + DAY, label: new Date(s).toISOString().slice(0, 10) }); s += DAY; } return out; }
  if (window === 'week') { const d = new Date(lo); let s = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY; while (s <= hi) { out.push({ start: s, end: s + 7 * DAY, label: 'w/c ' + new Date(s).toISOString().slice(0, 10) }); s += 7 * DAY; } return out; }
  const d = new Date(lo); let y = d.getUTCFullYear(), m = d.getUTCMonth();
  for (;;) { const s = Date.UTC(y, m, 1); if (s > hi) break; const e = Date.UTC(y, m + 1, 1); out.push({ start: s, end: e, label: new Date(s).toISOString().slice(0, 7) }); m++; }
  return out;
}

export function timeSeries(ds, settings, { window = 'week', metrics = ['degree', 'strength'], attr = null } = {}) {
  const windows = monthWindows(ds, window);
  const N = ds.nodes.count;
  const node = Object.fromEntries(metrics.map(m => [m, []]));
  const network = {};
  const ties = { formed: [], dissolved: [], persisted: [], jaccard: [] };
  const activity = { node: [], total: [] };
  let prev = null;
  const gvals = attr ? [...new Set(ds.nodes.attrs.map(a => a[attr]).filter(v => v != null).map(String))].sort() : null;
  const gcounts = gvals ? gvals.map(() => []) : null;
  windows.forEach((win, wi) => {
    const net = buildNetwork(ds, { ...settings, includeIsolates: false, time: { start: win.start, end: win.end } });
    let evs = 0; const act = new Float64Array(N);
    for (let i = 0; i < ds.events.count; i++) { const t = ds.events.t[i]; if (t >= win.start && t < win.end) { const a = ds.events.actor[i]; if (settings.excludeBots && ds.nodes.isBot[a]) continue; evs++; act[a]++; } }
    win.events = evs; win.nodes = net.n; win.ties = net.edges.count;
    const nm = net.n ? computeNodeMetrics(net, { which: metrics }) : {};
    for (const m of metrics) { const arr = new Float64Array(N); if (nm[m]) net.nodeIds.forEach((d, v) => { arr[d] = nm[m][v]; }); node[m].push(arr); }
    const r = net.n ? computeNetworkMetrics(net) : {};
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') (network[k] ||= new Array(windows.length).fill(NaN))[wi] = v;
    const keys = new Set(); for (let e = 0; e < net.edges.count; e++) keys.add(net.nodeIds[net.edges.src[e]] * N + net.nodeIds[net.edges.dst[e]]);
    if (prev) { let kept = 0; for (const k of keys) if (prev.has(k)) kept++; ties.formed.push(keys.size - kept); ties.dissolved.push(prev.size - kept); ties.persisted.push(kept); const u = keys.size + prev.size - kept; ties.jaccard.push(u ? kept / u : NaN); }
    else { ties.formed.push(keys.size); ties.dissolved.push(0); ties.persisted.push(0); ties.jaccard.push(NaN); }
    prev = keys;
    activity.node.push(act); activity.total.push(evs);
    if (gvals) gvals.forEach((g, gi) => { let c = 0; for (let i = 0; i < N; i++) if (String(ds.nodes.attrs[i][attr]) === g) c += act[i]; gcounts[gi].push(c); });
  });
  if (gvals) activity.group = { attr, values: gvals, counts: gcounts };
  return { windows, node, network, ties, activity, meta: { window, metrics } };
}

export function detectShifts(series, { threshold = 3.5, baseline = 8, labels = null, nodeMetric = null } = {}) {
  const find = (x) => {
    const out = []; let run = null;
    for (let t = 4; t < x.length; t++) {
      const base = x.slice(Math.max(0, t - baseline), t).filter(Number.isFinite).sort((a, b) => a - b);
      if (base.length < 4 || !Number.isFinite(x[t])) { run = null; continue; }
      const med = base[Math.floor(base.length / 2)];
      const dev = base.map(v => Math.abs(v - med)).sort((a, b) => a - b);
      const scale = Math.max(dev[Math.floor(dev.length / 2)] * 1.4826, 0.05 * Math.abs(med), 1e-9);
      const z = (x[t] - med) / scale;
      if (Math.abs(z) >= threshold) { const dir = z > 0 ? 'up' : 'down'; if (run && run.direction === dir && run.end === t - 1) { run.end = t; run.length++; } else { run = { window: t, end: t, length: 1, value: x[t], baseline: med, z, peak: t, direction: dir }; out.push(run); } } else run = null;
    }
    return out;
  };
  const W = series.windows; const out = [];
  const push = (target, id, label, metric, list) => { for (const s of list) out.push({ target, id, label, metric, ...s, start: W[s.window]?.start, windowLabel: W[s.window]?.label }); };
  for (const k of ['ties', 'density', 'reciprocity', 'transitivity', 'nodes']) if (series.network[k]) push('network', null, k, k, find(series.network[k]));
  push('network', null, 'activity', 'activity', find(series.activity.total));
  if (series.activity.group) series.activity.group.values.forEach((v, g) => push('group', v, `${series.activity.group.attr} = ${v}`, 'activity', find(series.activity.group.counts[g])));
  out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return { shifts: out, meta: { method: 'robust', threshold, baseline, windows: W.length } };
}

export function compareBeforeAfter(ds, settings, date, { metrics = ['degree', 'strength', 'betweenness'], reps = 500, seed = 1 } = {}) {
  let lo = Infinity, hi = -Infinity; for (const t of ds.events.t) if (t === t) { lo = Math.min(lo, t); hi = Math.max(hi, t); }
  const span = Math.min(date - lo, hi + 1 - date);
  if (!(span > 0)) throw new Error('The date must fall inside the data with events on both sides.');
  const s2 = { ...settings, includeIsolates: false };
  const before = buildNetwork(ds, { ...s2, time: { start: date - span, end: date } });
  const after = buildNetwork(ds, { ...s2, time: { start: date, end: date + span } });
  const mb = computeNodeMetrics(before, { which: metrics }), ma = computeNodeMetrics(after, { which: metrics });
  const ib = new Map([...before.nodeIds].map((d, v) => [d, v])), ia = new Map([...after.nodeIds].map((d, v) => [d, v]));
  const people = new Set([...before.nodeIds, ...after.nodeIds]);
  const r = rng(seed);
  const node = {};
  for (const m of metrics) {
    const pairs = [];
    for (const i of people) { const xb = ib.has(i) ? mb[m][ib.get(i)] : 0, xa = ia.has(i) ? ma[m][ia.get(i)] : 0; if (Number.isFinite(xb) && Number.isFinite(xa)) pairs.push({ node: i, before: xb, after: xa, diff: xa - xb, label: ds.nodes.labels[i] }); }
    const k = pairs.length; const md = pairs.reduce((a, p) => a + p.diff, 0) / (k || 1);
    const sd = k > 1 ? Math.sqrt(pairs.reduce((a, p) => a + (p.diff - md) ** 2, 0) / (k - 1)) : 0;
    let ext = 0; for (let q = 0; q < reps; q++) { let s = 0; for (const p of pairs) s += r() < 0.5 ? p.diff : -p.diff; if (Math.abs(s / k) >= Math.abs(md) - 1e-12) ext++; }
    const sorted = [...pairs].sort((a, b) => b.diff - a.diff);
    node[m] = { n: k, meanBefore: pairs.reduce((a, p) => a + p.before, 0) / (k || 1), meanAfter: pairs.reduce((a, p) => a + p.after, 0) / (k || 1), meanDiff: md, sdDiff: sd, dz: sd ? md / sd : NaN, p: (ext + 1) / (reps + 1), topIncreases: sorted.slice(0, 10).filter(p => p.diff > 0), topDecreases: sorted.slice(-10).reverse().filter(p => p.diff < 0) };
  }
  const nb = computeNetworkMetrics(before), na = computeNetworkMetrics(after);
  const network = {}; for (const k of Object.keys(nb)) if (typeof nb[k] === 'number') network[k] = { before: nb[k], after: na[k], diff: na[k] - nb[k] };
  const key = (net, e) => `${net.nodeIds[net.edges.src[e]]}-${net.nodeIds[net.edges.dst[e]]}`;
  const kb = new Set(), ka = new Set(); for (let e = 0; e < before.edges.count; e++) kb.add(key(before, e)); for (let e = 0; e < after.edges.count; e++) ka.add(key(after, e));
  let kept = 0; for (const x of ka) if (kb.has(x)) kept++;
  return { date, span, before: { start: date - span, end: date, nodes: before.n, ties: before.edges.count }, after: { start: date, end: date + span, nodes: after.n, ties: after.edges.count }, node, network, ties: { formed: ka.size - kept, dissolved: kb.size - kept, persisted: kept, jaccard: kept / (ka.size + kb.size - kept || 1) }, meta: { test: 'paired sign-flip permutation test on per-person differences', reps, effectSize: "Cohen's d_z = mean difference / sd of differences" } };
}

// --- content ---
const LEX = Object.fromEntries([...POS.map(w => [w, 2]), ...NEG.map(w => [w, -2])]);
function tokens(s) { return String(s).toLowerCase().match(/[a-z][a-z'-]+/g) || []; }
const STOP = new Set(['the', 'and', 'a', 'to', 'of', 'in', 'for', 'on', 'is', 'it', 'daily', 'standup', 'reminder']);

// Content shapes follow src/analysis/content (docs/api/analysis.md).
function unitOf(ds, i, by, attr, window) {
  if (by === 'overall') return ['all', 'All messages'];
  if (by === 'visibility') { const c = ds.events.context[i]; const v = c >= 0 ? VISIBILITY[ds.contexts.visibility[c]] : 'unknown'; return [v, v]; }
  if (by === 'window') { const t = ds.events.t[i]; if (!Number.isFinite(t)) return null; const d = new Date(t); const k = window === 'week' ? t - (t % (7 * 86400000)) : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); return [k, new Date(k).toISOString().slice(0, window === 'week' ? 10 : 7)]; }
  if (by === 'node') { const a = ds.events.actor[i]; return [a, ds.nodes.labels[a]]; }
  if (by === 'group') { const v = ds.nodes.attrs[ds.events.actor[i]][attr]; return v == null ? null : [String(v), String(v)]; }
  return null;
}

export function affect(ds, { by = 'overall', attr = null, window = 'month' } = {}) {
  const acc = new Map(); let withText = 0, scored = 0, messages = 0;
  for (let i = 0; i < ds.events.count; i++) {
    if (EVENT_TYPES[ds.events.type[i]] !== 'message' || ds.nodes.isBot[ds.events.actor[i]]) continue;
    messages++;
    const tx = ds.events.text[i]; if (!tx) continue; withText++;
    const u = unitOf(ds, i, by, attr, window); if (!u) continue;
    let sc = 0; for (const t of tokens(tx)) sc += LEX[t] || 0;
    const comp = sc / Math.sqrt(sc * sc + 15);
    scored++;
    const o = acc.get(u[0]) || { key: u[0], label: u[1], n: 0, sum: 0, sq: 0, pos: 0, neg: 0 };
    o.n++; o.sum += comp; o.sq += comp * comp; if (comp >= 0.05) o.pos++; else if (comp <= -0.05) o.neg++;
    acc.set(u[0], o);
  }
  const groups = [...acc.values()].map(o => { const mean = o.sum / o.n; const sd = Math.sqrt(Math.max(0, o.sq / o.n - mean * mean)); return { key: o.key, label: o.label, n: o.n, mean, sd, se: sd / Math.sqrt(o.n), posShare: o.pos / o.n, negShare: o.neg / o.n }; });
  groups.sort((a, b) => (by === 'window' ? a.key - b.key : b.n - a.n));
  return { coverage: { messages, withText, scored, likelyNonEnglish: 0 }, note: 'Demo engine: tiny word list, not VADER.', by: { [by]: groups }, groups };
}

export function keywords(ds, { by = 'group', attr = null, k = 10, window = 'month' } = {}) {
  const tf = new Map(); const df = new Map();
  for (let i = 0; i < ds.events.count; i++) {
    const tx = ds.events.text[i]; if (!tx || ds.nodes.isBot[ds.events.actor[i]]) continue;
    const u = unitOf(ds, i, by, attr, window); if (!u) continue;
    const m = tf.get(u[0]) || { label: u[1], c: new Map(), tokens: 0 };
    for (const t of tokens(tx)) if (!STOP.has(t)) { m.c.set(t, (m.c.get(t) || 0) + 1); m.tokens++; }
    tf.set(u[0], m);
  }
  for (const m of tf.values()) for (const t of m.c.keys()) df.set(t, (df.get(t) || 0) + 1);
  const U = tf.size;
  const units = [...tf.entries()].map(([key, m]) => ({ key, label: m.label, tokens: m.tokens, terms: [...m.c.entries()].map(([term, count]) => ({ term, count, tfidf: (count / (m.tokens || 1)) * (Math.log((1 + U) / (1 + df.get(term))) + 1) })).sort((a, b) => b.tfidf - a.tfidf).slice(0, k) }));
  return { by, units, overall: [], meta: { method: 'TF-IDF (demo engine)' } };
}

export function topics(ds, { k = 5, seed = 1 } = {}) {
  const docs = []; for (let i = 0; i < ds.events.count; i++) if (ds.events.text[i] && !ds.nodes.isBot[ds.events.actor[i]]) docs.push(tokens(ds.events.text[i]).filter(t => !STOP.has(t)));
  const vocab = Object.entries(VOCAB).slice(0, Math.min(k, 5));
  const counts = vocab.map(() => 0);
  for (const d of docs) { let best = -1, bs = 0; vocab.forEach(([, words], j) => { const sc = d.filter(t => words.includes(t)).length; if (sc > bs) { bs = sc; best = j; } }); if (best >= 0) counts[best]++; }
  const tot = counts.reduce((a, b) => a + b, 0) || 1;
  return { topics: vocab.map(([, words], j) => ({ id: j, share: counts[j] / tot, terms: words.map((w, r) => ({ term: w, weight: 1 / (r + 1) })), distinctive: words.slice(0, 3) })), byNode: [], meta: { k, seed, documents: docs.length, method: 'Demo engine keyword clusters (not LDA)' } };
}

export function diffusion(ds, net, { terms = ['roadmap'], reps = 200, seed = 1 } = {}) {
  const toNet = new Map(); for (let v = 0; v < net.n; v++) toNet.set(net.nodeIds[v], v);
  const nb = adjacency(net, true);
  const r = rng(seed);
  const out = terms.map(term => {
    const first = new Map();
    for (let i = 0; i < ds.events.count; i++) {
      const tx = ds.events.text[i]; if (!tx || !tokens(tx).includes(term.toLowerCase())) continue;
      const a = ds.events.actor[i], t = ds.events.t[i]; if (!first.has(a) || first.get(a) > t) first.set(a, t);
    }
    const adopters = [...first.entries()].sort((a, b) => a[1] - b[1]);
    const exposedOf = (times) => { const res = new Map(); for (const [a, t] of times) { const v = toNet.get(a); if (v == null) continue; let from = null; for (const u of nb[v].keys()) { const tu = times.get(net.nodeIds[u]); if (tu != null && tu < t && (from == null || tu > times.get(from))) from = net.nodeIds[u]; } res.set(a, from); } return res; };
    const share = (times) => { const e = exposedOf(times); const vals = [...e.values()]; return vals.length > 1 ? vals.filter(x => x != null).length / (vals.length - 1) : NaN; };
    const obsMap = new Map(adopters);
    const observed = share(obsMap);
    const ts = adopters.map(x => x[1]); const nulls = [];
    for (let q = 0; q < reps; q++) { const sh = ts.slice(); for (let i = sh.length - 1; i > 0; i--) { const j = r.int(i + 1); [sh[i], sh[j]] = [sh[j], sh[i]]; } nulls.push(share(new Map(adopters.map(([a], i) => [a, sh[i]])))); }
    const mean = nulls.reduce((a, b) => a + b, 0) / reps; const sd = Math.sqrt(nulls.reduce((a, b) => a + (b - mean) ** 2, 0) / (reps - 1)) || 1e-9;
    const ex = exposedOf(obsMap);
    return { term, adopters: adopters.length, first: ts[0], last: ts[ts.length - 1], exposedShare: observed, null: { mean, sd, z: (observed - mean) / sd, pUpper: (nulls.filter(x => x >= observed).length + 1) / (reps + 1), reps },
      adoptions: adopters.map(([a, t]) => ({ node: a, label: ds.nodes.labels[a], t, exposed: ex.get(a) != null, from: ex.get(a) ?? null })) };
  });
  return { terms: out, meta: { reps, seed } };
}

// a, b are DATASET node indices (as in src/analysis/construct.js).
export function edgeEvidence(ds, net, a, b, { limit = 50, bothDirections = true } = {}) {
  const out = [];
  let total = 0;
  forEachTie(ds, net.settings, (x, y, rule, amt, i, c) => {
    const fwd = x === a && y === b, rev = x === b && y === a;
    if (!(fwd || ((bothDirections || !net.directed) && rev))) return;
    total++;
    if (out.length < limit) {
      const tx = ds.events.text[i];
      out.push({ event: i, t: ds.events.t[i], type: EVENT_TYPES[ds.events.type[i]], rule: RULES[rule], amount: amt, from: x, to: y, actor: ds.events.actor[i], actorLabel: ds.nodes.labels[ds.events.actor[i]], context: c >= 0 ? ds.contexts.names[c] : null, visibility: c >= 0 ? VISIBILITY[ds.contexts.visibility[c]] : 'unknown', text: tx ? (tx.length > 280 ? tx.slice(0, 277) + '...' : tx) : null });
    }
  });
  out.sort((p, q) => (p.t || 0) - (q.t || 0));
  return out;
}

// ---- fake engine -------------------------------------------------------------

export function createMockEngine() {
  let ds = null, net = null, communities = null, pos = null;
  const delay = async (signal, ms = 30) => { await sleep(ms); abortable(signal); };
  return {
    kind: 'mock',
    async load(d) { ds = d; net = null; return { nodes: ds.nodes.count, events: ds.events.count }; },
    defaultSettings: async (d) => defaultSettings(d || ds),
    async buildNetwork(settings, { signal, onProgress } = {}) {
      onProgress?.(0.1, 'Building ties'); await delay(signal);
      net = buildNetwork(ds, settings); communities = null; pos = null;
      onProgress?.(1, 'Network built');
      return { n: net.n, nodeIds: net.nodeIds, directed: net.directed, edgeCount: net.edges.count, settings, summary: net.summary };
    },
    async computeNodeMetrics({ which, approx, signal, onProgress } = {}) { onProgress?.(0.2, 'Centrality'); await delay(signal); return computeNodeMetrics(net, { which, approx }); },
    async computeNetworkMetrics() { return computeNetworkMetrics(net); },
    async detectCommunities(opts = {}) { communities = detectCommunities(net, opts); return communities; },
    async applicability() { return applicability(ds, net); },
    async graphForRender({ signal, onProgress } = {}) {
      onProgress?.(0.3, 'Layout'); await delay(signal);
      if (!pos) pos = layout(net, { seed: 1 });
      return { nodeIds: net.nodeIds, x: pos.x, y: pos.y, src: net.edges.src, dst: net.edges.dst, w: net.edges.w, byRule: net.edges.byRule, layerMask: net.edges.layerMask, directed: net.directed };
    },
    async groupMetrics(attrKey, opts = {}) { await delay(opts.signal); return groupMetrics(net, ds, attrKey, { membership: opts.membership || communities?.membership }); },
    async egoMetrics(node, opts = {}) { return egoMetrics(net, node, { ds, attr: opts.attr }); },
    async nullModel(opts = {}) { await delay(opts.signal, 60); return nullModel(net, { ...opts, ds, membership: opts.membership || communities?.membership }); },
    async resampleRanks(opts = {}) { await delay(opts.signal, 60); return resampleRanks(ds, net.settings, opts); },
    async timeSeries(opts = {}) { await delay(opts.signal); return timeSeries(ds, net.settings, opts); },
    async detectShifts(series, opts = {}) { return detectShifts(series, { labels: ds.nodes.labels, ...opts }); },
    async compareBeforeAfter(date, opts = {}) { await delay(opts.signal); return compareBeforeAfter(ds, net.settings, date, opts); },
    async affect(opts) { return affect(ds, opts); },
    async keywords(opts) { return keywords(ds, opts); },
    async topics(opts) { return topics(ds, opts); },
    async diffusion(opts) { return diffusion(ds, net, opts); },
    async edgeEvidence(a, b, opts) { return edgeEvidence(ds, net, a, b, opts); },
    async glossary() { return null; },
    terminate() {},
  };
}

// ---- fake pipeline, identity, merge, tabular, profile -------------------------

export const mockImporters = [
  { id: 'slack', label: 'Slack export', family: 'workplace', options: [{ key: 'tz', label: 'Time zone', type: 'text', default: 'UTC' }, { key: 'includeBots', label: 'Keep bot messages', type: 'boolean', default: false }] },
  { id: 'calendar', label: 'Calendar (.ics)', family: 'workplace', options: [{ key: 'expandRecurring', label: 'Expand recurring meetings', type: 'boolean', default: true }] },
  { id: 'mbox', label: 'Email (mbox)', family: 'workplace', options: [{ key: 'ownerEmail', label: 'Mailbox owner address', type: 'text', default: '' }] },
  { id: 'tabular', label: 'Generic CSV (map columns)', family: 'tabular', options: [] },
];

export async function mockDetect(input) {
  const name = input.name.toLowerCase();
  const scores = mockImporters.map(imp => {
    let score = 0.05, reason = 'No matching files';
    if (imp.id === 'slack' && /slack|workspace|\.zip$/.test(name)) { score = 0.92; reason = 'Found users.json, channels.json and per-day message files'; }
    if (imp.id === 'calendar' && /\.ics$|calendar/.test(name)) { score = 0.9; reason = 'Found VCALENDAR with VEVENT entries'; }
    if (imp.id === 'mbox' && /\.mbox$|\.eml$/.test(name)) { score = 0.88; reason = 'Found From_ separator lines'; }
    if (imp.id === 'tabular' && /\.(csv|tsv)$/.test(name)) { score = 0.5; reason = 'Delimited text with a header row'; }
    return { importer: imp, score, reason };
  }).sort((a, b) => b.score - a.score);
  return scores;
}

export async function mockImport(inputs, { onProgress, signal } = {}) {
  for (let i = 1; i <= 8; i++) { await sleep(70); abortable(signal); onProgress?.(i / 8, `Reading ${inputs[0]?.name || 'input'} (${i}/8)`); }
  const dataset = mockDataset({});
  return { dataset, report: null, detections: inputs.map(x => ({ input: x.name, importer: x.importer })) };
}

export function mockSuggestMatches(ds) {
  const byLabel = new Map();
  const out = [];
  for (let i = 0; i < ds.nodes.count; i++) {
    const l = ds.nodes.labels[i].toLowerCase();
    if (byLabel.has(l)) {
      const j = byLabel.get(l);
      out.push({ a: j, b: i, score: 0.93, evidence: [`Same display name "${ds.nodes.labels[i]}"`, `${ds.nodes.keys[j].split(':')[0]} and ${ds.nodes.keys[i].split(':')[0]} accounts`, 'Email local part matches the name'] });
    } else byLabel.set(l, i);
  }
  return out.slice(0, 20);
}

export function mockApplyMerges(ds, merges) {
  const map = new Map();
  for (const { a, b } of merges) map.set(ds.nodes.keys[b], ds.nodes.keys[a]);
  return replay([ds], { name: ds.meta.name, mapKey: k => map.get(k) ?? k });
}

export function mockMergeDatasets(list) { return replay(list); }

export function mockSuggestMapping(headers) {
  const find = re => headers.find(h => re.test(h)) ?? null;
  return { source: find(/^(from|source|sender|actor|author|ego)/i), target: find(/^(to|target|recipient|alter|receiver)/i), time: find(/(time|date|ts)/i), weight: find(/(weight|count|strength)/i), text: find(/(text|body|message|content)/i), context: find(/(channel|thread|context|room)/i), type: null };
}

export function mockJoinProfiles(ds, rows, { keyColumn, matchOn = 'label', columns }) {
  const index = new Map();
  for (let i = 0; i < ds.nodes.count; i++) {
    const v = matchOn === 'key' ? ds.nodes.keys[i] : matchOn === 'email' ? ds.nodes.platformIds[i]?.email : ds.nodes.labels[i];
    if (v) index.set(String(v).toLowerCase(), i);
  }
  const extra = new Map(); let matched = 0; const unmatched = [];
  for (const row of rows) {
    const k = String(row[keyColumn] ?? '').toLowerCase(); const i = index.get(k);
    if (i == null) { unmatched.push(row[keyColumn]); continue; }
    matched++;
    extra.set(ds.nodes.keys[i], Object.fromEntries(columns.map(c => [c, row[c]])));
  }
  const dataset = replay([ds], { name: ds.meta.name, extraAttrs: extra });
  return { dataset, report: { rows: rows.length, matched, unmatched: unmatched.length, unmatchedExamples: unmatched.slice(0, 8), ambiguous: 0, columns, nodesWithoutRow: ds.nodes.count - matched } };
}

// ---- fake methods appendix (used only if src/llm/methods.js is missing) -------

export function mockMethods(ds, settings) {
  const on = Object.entries(settings?.rules || {}).filter(([, r]) => r.on).map(([k, r]) => `${k} (weight ${r.weight})`);
  return `## Data\n\n${ds.meta.sources.length} sources were imported: ${ds.meta.sources.map(s => `${s.format} (${s.view} view)`).join(', ')}.\n\n## Network construction\n\nTies were built from these rules: ${on.join(', ')}. Ties were ${settings?.directed ? 'directed' : 'undirected'} and weighted by ${settings?.weighting}. Bots were ${settings?.excludeBots ? 'excluded' : 'kept'}.\n\n## Measures\n\nCentrality measures follow standard definitions. Betweenness on networks above 1,000 people is estimated from a sample of source nodes.\n\n## Uncertainty\n\nNull models use random graphs with the same number of people and ties; rank intervals come from resampling 80% of events.`;
}
