// Construction rules on small hand-built datasets with known ties and weights.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder, VIEWS } from '../../src/core/model.js';
import { buildNetwork, defaultSettings, evidenceCounts, edgeEvidence, RULES } from '../../src/analysis/construct.js';

const MIN = 60000;
const T0 = Date.UTC(2026, 0, 5, 9);

function people(b, n, opts = {}) {
  return Array.from({ length: n }, (_, i) => b.node(`t:${String.fromCharCode(97 + i)}`, { label: String.fromCharCode(65 + i), ...(opts[i] || {}) }));
}

// Settings with only the named rules on (weight 1 unless given).
function only(ds, rules, extra = {}) {
  const s = defaultSettings(ds);
  for (const r of RULES) s.rules[r] = { ...s.rules[r], on: false, weight: 1 };
  for (const [r, w] of Object.entries(rules)) s.rules[r] = { ...s.rules[r], on: true, weight: w };
  return { ...s, ...extra };
}

function tie(net, a, b) {
  const x = net.index[a], y = net.index[b];
  if (x < 0 || y < 0) return null;
  const [p, q] = net.directed || x < y ? [x, y] : [y, x];
  for (let e = 0; e < net.edges.count; e++) {
    if (net.edges.src[e] === p && net.edges.dst[e] === q) {
      const byRule = {};
      for (const [r, arr] of Object.entries(net.edges.byRule)) if (arr[e]) byRule[r] = arr[e];
      return { w: net.edges.w[e], raw: net.edges.raw[e], byRule, mask: net.edges.layerMask[e] };
    }
  }
  return null;
}

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg ?? ''} ${a} != ${b}`);

test('reply ties from reply targets and from resolved parents', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const [A, B, C] = people(b, 3);
  const ch = b.context('c1', { kind: 'channel', visibility: 'public' });
  b.event({ actor: B, t: T0, context: ch, key: 'm1', text: 'hi' });
  b.event({ actor: A, t: T0 + MIN, context: ch, targets: [[B, 'reply']] });           // explicit
  b.event({ actor: C, t: T0 + 2 * MIN, context: ch, parentKey: 'm1' });              // parent only
  b.event({ actor: B, t: T0 + 3 * MIN, context: ch, parentKey: 'm1' });             // self reply: no tie
  b.event({ actor: C, t: T0 + 4 * MIN, context: ch, parentKey: 'm1', targets: [[A, 'mention']] }); // reply + mention
  const ds = b.build();
  const net = buildNetwork(ds, only(ds, { reply: 1, mention: 1 }, { directed: true }));
  assert.deepEqual(tie(net, A, B).byRule, { reply: 1 });
  assert.deepEqual(tie(net, C, B).byRule, { reply: 2 });
  assert.deepEqual(tie(net, C, A).byRule, { mention: 1 });
  assert.equal(tie(net, B, B), null);
  assert.equal(net.edges.count, 3);
});

test('mention, dm, to, cc, bcc with rule weights and repeated events', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const [A, B, C, D, E] = people(b, 5);
  for (let k = 0; k < 3; k++) b.event({ actor: A, t: T0 + k, targets: [[B, 'mention']] });
  b.event({ actor: A, t: T0, targets: [[C, 'dm']] });
  b.event({ actor: A, t: T0, targets: [[B, 'to'], [C, 'cc'], [D, 'bcc'], [D, 'bcc']] }); // duplicate bcc counted once
  b.event({ actor: E, t: T0, targets: [[A, 'to']], weight: 2 });
  const ds = b.build();
  const s = only(ds, { mention: 1, dm: 1, to: 1, cc: 0.5, bcc: 0.25 }, { directed: true });
  const net = buildNetwork(ds, s);
  assert.deepEqual(tie(net, A, B).byRule, { mention: 3, to: 1 });
  close(tie(net, A, B).w, 4);
  assert.deepEqual(tie(net, A, C).byRule, { dm: 1, cc: 1 });
  close(tie(net, A, C).w, 1.5);
  close(tie(net, A, D).w, 0.25);
  close(tie(net, E, A).w, 2, 'event weight multiplies evidence');
  assert.deepEqual(net.summary.byRule.mention, { ties: 1, evidence: 3 });
});

test('broadcast cutoff drops addressed ties of mass messages but keeps replies', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const ps = people(b, 26);
  const [A, B] = ps;
  b.event({ actor: A, t: T0, targets: ps.slice(1).map(p => [p, 'to']) });   // 25 recipients
  b.event({ actor: B, t: T0, targets: [...ps.slice(2).map(p => [p, 'to']), [A, 'reply']] }); // 24 to + reply = 25 addressees? reply is not an addressee
  const ds = b.build();
  let net = buildNetwork(ds, only(ds, { to: 1, reply: 1 }, { maxRecipients: 24, directed: true }));
  assert.equal(tie(net, A, B), null, '25 recipients > 24: broadcast');
  assert.deepEqual(tie(net, B, A).byRule, { reply: 1 });
  assert.equal(tie(net, B, ps[5])?.byRule.to, 1, 'B addressed 24 people: not a broadcast');
  assert.equal(net.summary.events.dropped.broadcast, 1);
  net = buildNetwork(ds, only(ds, { to: 1 }, { maxRecipients: 0, directed: true }));
  assert.equal(tie(net, A, B).byRule.to, 1, 'maxRecipients 0 disables the cutoff');
});

test('adjacency: turn-taking within the window, same context only', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.CHAT } });
  const [A, B, C, D] = people(b, 4);
  const c1 = b.context('c1', { kind: 'chat', visibility: 'group' });
  const c2 = b.context('c2', { kind: 'chat', visibility: 'group' });
  const em = b.context('e1', { kind: 'email_thread', visibility: 'private' });
  b.event({ actor: A, t: T0, context: c1 });
  b.event({ actor: B, t: T0 + 5 * MIN, context: c1 });       // B -> A
  b.event({ actor: B, t: T0 + 6 * MIN, context: c1 });       // same speaker: nothing
  b.event({ actor: D, t: T0 + 7 * MIN, context: c2 });       // other context
  b.event({ actor: C, t: T0 + 30 * MIN, context: c1 });      // 24 min after B: outside 10 min
  b.event({ actor: A, t: T0 + 32 * MIN, context: c1 });      // A -> C
  b.event({ actor: D, t: T0 + 33 * MIN, context: c1, targets: [[A, 'mention']] }); // addressed: no adjacency tie
  b.event({ actor: B, t: T0 + 34 * MIN, context: c1 });      // B -> D (previous message, even though addressed)
  b.event({ actor: A, t: T0 + 1 * MIN, context: em });
  b.event({ actor: B, t: T0 + 2 * MIN, context: em });       // email threads: no adjacency
  const ds = b.build();
  const s = only(ds, { adjacency: 0.5 }, { directed: true });
  s.rules.adjacency.windowMin = 10;
  const net = buildNetwork(ds, s);
  assert.deepEqual(tie(net, B, A).byRule, { adjacency: 1 });
  close(tie(net, B, A).w, 0.5);
  assert.deepEqual(tie(net, A, C).byRule, { adjacency: 1 });
  assert.deepEqual(tie(net, B, D).byRule, { adjacency: 1 });
  assert.equal(tie(net, C, B), null);
  assert.equal(tie(net, D, A), null);
  assert.equal(net.edges.count, 3);
  s.rules.adjacency.windowMin = 30;
  assert.deepEqual(tie(buildNetwork(ds, s), C, B).byRule, { adjacency: 1 }, 'wider window');
});

test('copresence: cliques among attendees with 1/(k-1) normalisation', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.EGO } });
  const [A, B, C, D, E] = people(b, 5);
  const mt = b.context('m1', { kind: 'meeting', visibility: 'private' });
  b.event({ type: 'copresence', actor: A, t: T0, context: mt, targets: [[B, 'attendee'], [C, 'attendee'], [D, 'attendee']] });
  b.event({ type: 'copresence', actor: A, t: T0 + 1, context: mt, targets: [[B, 'attendee']] });
  const ds = b.build();
  let net = buildNetwork(ds, only(ds, { copresence: 1 }, { directed: false }));
  close(tie(net, B, C).w, 1 / 3);
  close(tie(net, A, B).w, 1 / 3 + 1);
  assert.equal(net.edges.count, 6);
  assert.equal(tie(net, A, E), null);
  net = buildNetwork(ds, only(ds, { copresence: 1 }, { directed: true }));
  assert.equal(net.edges.count, 12, 'directed: both directions');
  close(tie(net, C, B).w, 1 / 3);
  const s = only(ds, { copresence: 1 }, { directed: false });
  s.rules.copresence.normalize = false;
  net = buildNetwork(ds, s);
  close(tie(net, B, C).w, 1);
  s.rules.copresence.maxSize = 3;
  net = buildNetwork(ds, s);
  assert.equal(tie(net, B, C), null, 'meeting of 4 > maxSize 3 dropped');
  assert.equal(net.summary.events.dropped.largeMeetings, 1);
  close(tie(net, A, B).w, 1);
});

test('declared, repost, like, follow and reaction ties', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const [A, B, C, D] = people(b, 4);
  b.event({ type: 'declared', actor: A, targets: [[B, 'declared']], weight: 3 });
  b.event({ actor: C, t: T0, key: 'p1', text: 'post' });
  b.event({ type: 'repost', actor: A, t: T0 + 1, parentKey: 'p1' });
  b.event({ type: 'like', actor: B, t: T0 + 2, targets: [[C, 'subject']] });
  b.event({ type: 'follow', actor: D, t: T0 + 3, targets: [[C, 'subject']] });
  b.event({ type: 'reaction', actor: D, t: T0 + 4, parentKey: 'p1', weight: 2 });
  b.event({ type: 'join', actor: D, t: T0 + 5, targets: [[A, 'member']] });   // no tie
  const ds = b.build();
  const s = defaultSettings(ds);
  for (const r of ['declared', 'repost', 'like', 'follow', 'reaction']) assert.ok(s.rules[r].on, r);
  assert.ok(!s.rules.mention.on && !s.rules.copresence.on);
  const net = buildNetwork(ds, { ...s, directed: true });
  assert.deepEqual(tie(net, A, B).byRule, { declared: 3 });
  assert.deepEqual(tie(net, A, C).byRule, { repost: 1 });
  assert.deepEqual(tie(net, B, C).byRule, { like: 1 });
  assert.deepEqual(tie(net, D, C).byRule, { follow: 1, reaction: 2 });
  assert.equal(tie(net, D, A), null);
});

test('bots are excluded as actors and as targets unless asked', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const [A, B, BOT] = people(b, 3, { 2: { isBot: true } });
  b.event({ actor: BOT, t: T0, targets: [[A, 'mention']] });
  b.event({ actor: A, t: T0, targets: [[BOT, 'mention'], [B, 'mention']] });
  const ds = b.build();
  const s = only(ds, { mention: 1 }, { directed: true });
  assert.equal(defaultSettings(ds).excludeBots, true);
  let net = buildNetwork(ds, s);
  assert.equal(net.index[BOT], -1);
  assert.equal(net.edges.count, 1);
  assert.equal(net.summary.events.dropped.bots, 1);
  net = buildNetwork(ds, { ...s, excludeBots: false });
  assert.equal(net.edges.count, 3);
  net = buildNetwork(ds, { ...s, excludeNodes: [B] });
  assert.equal(net.edges.count, 0);
  assert.equal(net.index[B], -1);
});

test('time window, undated events, visibility and media filters', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL, medium: 'chat' } });
  const [A, B, C] = people(b, 3);
  const pub = b.context('pub', { kind: 'channel', visibility: 'public', medium: 'slack' });
  const dm = b.context('dm', { kind: 'dm', visibility: 'direct', medium: 'slack' });
  const mail = b.context('mail', { kind: 'email_thread', visibility: 'private', medium: 'email' });
  b.event({ actor: A, t: T0, context: pub, targets: [[B, 'mention']] });
  b.event({ actor: A, t: T0 + 10 * MIN, context: dm, targets: [[B, 'dm']] });
  b.event({ actor: A, t: NaN, context: pub, targets: [[C, 'mention']] });
  b.event({ actor: B, t: T0 + 20 * MIN, context: mail, targets: [[C, 'to']] });
  const ds = b.build();
  const s = only(ds, { mention: 1, dm: 1, to: 1 }, { directed: true });
  let net = buildNetwork(ds, s);
  assert.equal(net.edges.count, 3, 'undated events count when no window is set');
  net = buildNetwork(ds, { ...s, time: { start: T0 + MIN, end: T0 + 15 * MIN } });
  assert.deepEqual(tie(net, A, B).byRule, { dm: 1 });
  assert.equal(net.edges.count, 1);
  assert.equal(net.summary.events.dropped.undated, 1);
  assert.equal(net.summary.events.dropped.time, 2);
  net = buildNetwork(ds, { ...s, visibility: ['public'] });
  assert.deepEqual(tie(net, A, B).byRule, { mention: 1 });
  assert.equal(net.summary.events.dropped.visibility, 2);
  net = buildNetwork(ds, { ...s, media: ['email'] });
  assert.equal(net.edges.count, 1);
  assert.ok(tie(net, B, C));
  // Layers: A->B evidence came from a public channel and a DM.
  net = buildNetwork(ds, s);
  assert.equal(tie(net, A, B).mask, (1 << 0) | (1 << 2));
  assert.deepEqual(net.summary.layers, { public: 2, direct: 1, private: 1 });
});

test('undirected merge, weighting transforms, minWeight and isolates', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const [A, B, C, D] = people(b, 4);
  b.event({ actor: A, t: T0, targets: [[B, 'dm']] });
  b.event({ actor: A, t: T0, targets: [[B, 'dm']] });
  b.event({ actor: B, t: T0, targets: [[A, 'dm']] });
  b.event({ actor: C, t: T0, targets: [[A, 'dm']] });
  const ds = b.build();
  const s = only(ds, { dm: 1 }, { directed: false });
  let net = buildNetwork(ds, s);
  close(tie(net, A, B).w, 3);
  close(tie(net, B, A).w, 3);
  assert.equal(net.n, 4, 'isolate D included by default');
  assert.equal(net.summary.isolates, 1);
  net = buildNetwork(ds, { ...s, includeIsolates: false });
  assert.equal(net.n, 3);
  assert.equal(net.index[D], -1);
  net = buildNetwork(ds, { ...s, weighting: 'log' });
  close(tie(net, A, B).w, Math.log1p(3));
  close(tie(net, A, B).raw, 3);
  net = buildNetwork(ds, { ...s, weighting: 'binary' });
  close(tie(net, A, B).w, 1);
  net = buildNetwork(ds, { ...s, minWeight: 2 });
  assert.equal(net.edges.count, 1);
  assert.equal(net.summary.tiesBelowMinWeight, 1);
  net = buildNetwork(ds, { ...s, directed: true });
  close(tie(net, A, B).w, 2);
  close(tie(net, B, A).w, 1);
});

test('defaultSettings turns on only rules with evidence and picks direction', () => {
  const b = new DatasetBuilder({ source: { format: 'ics', view: VIEWS.EGO } });
  const [A, B, C] = people(b, 3);
  const mt = b.context('m', { kind: 'meeting', visibility: 'private' });
  for (let k = 0; k < 5; k++) b.event({ type: 'copresence', actor: A, t: T0 + k, context: mt, targets: [[B, 'attendee'], [C, 'attendee']] });
  b.event({ actor: A, t: T0, targets: [[B, 'to']] });
  const ds = b.build();
  const s = defaultSettings(ds);
  assert.equal(s.rules.copresence.on, true);
  assert.equal(s.rules.to.on, true);
  assert.equal(s.rules.mention.on, false);
  assert.equal(s.rules.adjacency.on, false);
  assert.equal(s.directed, false, 'mostly co-attendance: undirected');
  assert.equal(s.rules.copresence.normalize, true);
  assert.equal(s.maxRecipients, 25);
  // A partial settings object is completed from the defaults.
  const net = buildNetwork(ds, { weighting: 'binary' });
  assert.equal(net.directed, false);
  assert.equal(net.settings.rules.copresence.on, true);
});

test('edgeEvidence returns the events behind a tie', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const [A, B, C] = people(b, 3);
  const ch = b.context('c', { name: 'general', kind: 'channel', visibility: 'public' });
  b.event({ actor: A, t: T0 + 2, context: ch, targets: [[B, 'mention']], text: 'second' });
  b.event({ actor: A, t: T0 + 1, context: ch, targets: [[B, 'mention']], text: 'first' });
  b.event({ actor: B, t: T0 + 3, context: ch, targets: [[A, 'mention']], text: 'back' });
  b.event({ actor: A, t: T0 + 4, context: ch, targets: [[C, 'mention']], text: 'other' });
  const ds = b.build();
  const net = buildNetwork(ds, only(ds, { mention: 1 }, { directed: true }));
  const ev = edgeEvidence(ds, net, A, B, {});
  assert.deepEqual(ev.map(e => e.text), ['first', 'second']);
  assert.equal(ev[0].rule, 'mention');
  assert.equal(ev[0].context, 'general');
  assert.equal(ev[0].actorLabel, 'A');
  assert.equal(edgeEvidence(ds, net, A, B, { bothDirections: true }).length, 3);
  assert.equal(edgeEvidence(ds, net, A, B, { limit: 1 }).length, 1);
  const und = buildNetwork(ds, only(ds, { mention: 1 }, { directed: false }));
  assert.equal(edgeEvidence(ds, und, B, A).length, 3);
});

test('sources that declare undirected ties: symmetric evidence and an undirected default', () => {
  const b = new DatasetBuilder({ source: { format: 'graphml', view: VIEWS.FULL, directed: false } });
  const [A, B, C] = people(b, 3);
  b.event({ type: 'declared', actor: A, targets: [[B, 'declared']] });
  b.event({ type: 'declared', actor: B, targets: [[C, 'declared']] });
  const ds = b.build();
  assert.equal(defaultSettings(ds).directed, false);
  const net = buildNetwork(ds, { ...defaultSettings(ds), directed: true });
  assert.deepEqual(tie(net, A, B).byRule, { declared: 1 });
  assert.deepEqual(tie(net, B, A).byRule, { declared: 1 }, 'entered in both directions');
  assert.equal(net.edges.count, 4);
  // Mixed: a directed source with more evidence keeps the network directed.
  b.beginSource({ format: 'slack', view: VIEWS.FULL });
  for (let k = 0; k < 5; k++) b.event({ actor: C, t: T0 + k, targets: [[A, 'dm']] });
  const mixed = b.build();
  assert.equal(defaultSettings(mixed).directed, true);
  const mnet = buildNetwork(mixed, defaultSettings(mixed));
  assert.equal(tie(mnet, A, C), null, 'directed-source ties keep their direction');
  assert.ok(tie(mnet, C, B), 'undirected-source ties still go both ways');
});

test('group chats without per-message targets turn adjacency on', () => {
  const b = new DatasetBuilder({ source: { format: 'whatsapp', view: VIEWS.CHAT } });
  const [A, B, C] = people(b, 3);
  const g = b.context('w:g', { kind: 'group_dm', visibility: 'group', members: [A, B, C] });
  const ch = b.context('s:c', { kind: 'channel', visibility: 'public' });
  b.event({ actor: A, t: T0, context: g, text: 'hi' });
  b.event({ actor: B, t: T0 + MIN, context: g, text: 'hello' });
  // Many addressed messages elsewhere keep the untargeted share well under 30%.
  for (let k = 0; k < 20; k++) b.event({ actor: C, t: T0 + k, context: ch, targets: [[A, 'mention']] });
  const ds = b.build();
  const s = defaultSettings(ds);
  assert.equal(s.rules.adjacency.on, true);
  const net = buildNetwork(ds, s);
  assert.deepEqual(tie(net, B, A).byRule, { adjacency: 1 });
});

// Regression: defaultSettings counted reply evidence as reply targets plus
// every message with a parent, so a threaded reply whose importer named the
// parent's author (Slack) counted twice and a reply in one's own thread
// counted once though it makes no tie. The Slack walkthrough world showed
// 32,183 replies in Construction settings for a network built from 13,709.
test('rule evidence counts are the pieces of evidence the network is built from', () => {
  const b = new DatasetBuilder({ source: { format: 't', view: VIEWS.FULL } });
  const [A, B, C] = people(b, 3);
  const ch = b.context('c1', { kind: 'channel', visibility: 'public' });
  b.event({ actor: B, t: T0, context: ch, key: 'm1', text: 'hi' });
  b.event({ actor: A, t: T0 + MIN, context: ch, parentKey: 'm1', targets: [[B, 'reply']] }); // target and parent: one reply
  b.event({ actor: C, t: T0 + 2 * MIN, context: ch, parentKey: 'm1' });                    // parent only: one reply
  b.event({ actor: B, t: T0 + 3 * MIN, context: ch, parentKey: 'm1' });                    // own thread: none
  b.event({ actor: A, t: T0 + 4 * MIN, context: ch, targets: [[A, 'mention'], [C, 'mention']] }); // self-mention: none
  const ds = b.build();
  const ev = evidenceCounts(ds);
  assert.equal(ev.reply, 2);
  assert.equal(ev.mention, 1);
  const s = defaultSettings(ds);
  assert.equal(s.rules.reply.evidence, 2);
  const net = buildNetwork(ds, { ...s, excludeBots: false });
  assert.equal(net.summary.byRule.reply.evidence, ev.reply);
  assert.equal(net.summary.byRule.mention.evidence, ev.mention);
});

test('rule evidence counts match the network for a generated Slack export', async () => {
  const { generate } = await import('../../src/generator/index.js');
  const { dataset: ds } = generate({ context: 'workplace', medium: 'slack', structure: 'bridge-dependent', size: 30, seed: 7, timespan: { days: 30 }, output: 'native' });
  const ev = evidenceCounts(ds);
  const s = defaultSettings(ds);
  const net = buildNetwork(ds, { ...s, excludeBots: false });
  for (const r of RULES) {
    if (!(ev[r] > 0)) continue;
    assert.equal(s.rules[r].evidence, ev[r], r);
    assert.equal(net.summary.byRule[r]?.evidence, ev[r], r);
  }
  assert.ok(ev.reply > 0 && ev.reaction > 0);
});
