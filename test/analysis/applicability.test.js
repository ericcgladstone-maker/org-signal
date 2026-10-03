import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder, VIEWS } from '../../src/core/model.js';
import { buildNetwork, defaultSettings } from '../../src/analysis/construct.js';
import { applicability, APPLICABILITY_KEYS } from '../../src/analysis/applicability.js';
import { NODE_METRICS } from '../../src/analysis/metrics.js';
import { messageDataset } from './helpers.js';

test('every metric gets a level and a reason when not ok', () => {
  const ds = messageDataset(40, 800, { text: () => 'quarterly planning notes' });
  const ap = applicability(ds, buildNetwork(ds, defaultSettings(ds)));
  for (const k of [...NODE_METRICS, ...APPLICABILITY_KEYS]) {
    assert.ok(['ok', 'caution', 'na'].includes(ap[k].level), k);
    if (ap[k].level !== 'ok') assert.ok(ap[k].reason.length > 10, k);
  }
  assert.equal(ap.betweenness.level, 'ok');
  assert.equal(ap.groups.level, 'ok');
  assert.equal(ap.affect.level, 'caution', 'lexicon sentiment always carries a caution');
  assert.equal(ap.hierarchy.level, 'na');
});

test('ego view: path measures are artifacts, ego measures apply', () => {
  const b = new DatasetBuilder({ source: { format: 'mbox', view: VIEWS.EGO, egoKey: 'e:me' } });
  const me = b.node('e:me');
  const others = Array.from({ length: 10 }, (_, i) => b.node('e:' + i));
  for (const o of others) b.event({ actor: me, t: Date.UTC(2026, 0, 1) + o, targets: [[o, 'to']] });
  const ds = b.build();
  const ap = applicability(ds, buildNetwork(ds, defaultSettings(ds)));
  assert.equal(ap.betweenness.level, 'na');
  assert.match(ap.betweenness.reason, /one person's export/);
  assert.equal(ap.closeness.level, 'na');
  assert.equal(ap.ego.level, 'ok');
  assert.deepEqual(ap._context.egoNodes, [me]);
  assert.equal(ap.groups.level, 'na', 'no attributes loaded');
  assert.equal(ap.affect.level, 'na', 'no text');
});

test('undirected, binary, disconnected and copresence-only networks are flagged', () => {
  const b = new DatasetBuilder({ source: { format: 'ics', view: VIEWS.FULL } });
  const ps = Array.from({ length: 8 }, (_, i) => b.node('c:' + i, { attrs: { manager_id: 'c:0', team: i < 4 ? 'a' : 'b' } }));
  const mt = b.context('m', { kind: 'meeting' });
  b.event({ type: 'copresence', actor: ps[0], t: 1, context: mt, targets: [[ps[1], 'attendee'], [ps[2], 'attendee']] });
  b.event({ type: 'copresence', actor: ps[4], t: 2, context: mt, targets: [[ps[5], 'attendee'], [ps[6], 'attendee']] });
  const ds = b.build();
  const net = buildNetwork(ds, { ...defaultSettings(ds), weighting: 'binary' });
  assert.equal(net.directed, false);
  const ap = applicability(ds, net);
  assert.equal(ap.reciprocity.level, 'na');
  assert.equal(ap.inDegree.level, 'na');
  assert.equal(ap.betweennessWeighted.level, 'na');
  assert.equal(ap.eigenvector.level, 'caution');
  assert.match(ap.eigenvector.reason, /components/);
  assert.equal(ap.clustering.level, 'caution');
  assert.match(ap.betweenness.reason, /Managers/);
  assert.equal(ap.hierarchy.level, 'ok');
  assert.equal(ap.timeSeries.level, 'caution');
});

test('ego-network interview: interview caveats, not mailbox ones', () => {
  const b = new DatasetBuilder({ source: { format: 'ego-interview', family: 'survey', medium: 'survey', view: VIEWS.EGO, egoKey: 'ego:1', directed: true } });
  const ego = b.node('ego:1', { label: 'Ego' });
  const alters = Array.from({ length: 6 }, (_, i) => b.node('alter:' + i, { label: 'A' + i }));
  for (const a of alters) b.event({ type: 'declared', actor: ego, t: Date.UTC(2026, 0, 1), targets: [[a, 'declared']] });
  b.event({ type: 'declared', actor: alters[0], t: Date.UTC(2026, 0, 1), targets: [[alters[1], 'declared']] });
  b.event({ type: 'declared', actor: alters[2], t: Date.UTC(2026, 0, 1), targets: [[alters[3], 'declared']] });
  const ds = b.build();
  const ap = applicability(ds, buildNetwork(ds, { ...defaultSettings(ds), directed: true }));
  assert.equal(ap.reciprocity.level, 'na');
  assert.match(ap.reciprocity.reason, /respondent reports every tie/);
  assert.equal(ap.reciprocityNetwork.level, 'na');
  assert.equal(ap.inDegree.level, 'na');
  assert.match(ap.egoDensity.reason, /perceived, not observed/);
  assert.equal(ap.betweenness.level, 'na');
  assert.match(ap.betweenness.reason, /interview/);
  for (const k of Object.keys(ap)) if (ap[k].reason) assert.doesNotMatch(ap[k].reason, /messages the owner sent|one person's export/, k);
  assert.equal(ap.ego.level, 'ok');
});

test('ego exports caution group comparisons', () => {
  const b = new DatasetBuilder({ source: { format: 'mbox', view: VIEWS.EGO, egoKey: 'e:me' } });
  const me = b.node('e:me');
  const others = Array.from({ length: 12 }, (_, i) => b.node('e:' + i, { attrs: { team: 'T' + (i % 3) } }));
  for (const o of others) b.event({ actor: me, t: Date.UTC(2026, 0, 1) + o, targets: [[o, 'to']] });
  const ds = b.build();
  const ap = applicability(ds, buildNetwork(ds, defaultSettings(ds)));
  assert.equal(ap.groups.level, 'caution');
  assert.match(ap.groups.reason, /what the owner saw/);
});

test('many chats from one person\'s export: the owner bridges by construction; constraint and effective size carry the reason (C3)', () => {
  const b = new DatasetBuilder({ source: { format: 'whatsapp', family: 'personal', view: VIEWS.CHAT, context: 'personal', egoKey: 'w:me' } });
  const me = b.node('w:me');
  const t0 = Date.UTC(2026, 0, 1);
  let k = 0;
  for (let c = 0; c < 4; c++) {
    if (c) b.beginSource({ format: 'whatsapp', family: 'personal', view: VIEWS.CHAT, context: 'personal', egoKey: 'w:me' });
    const ps = Array.from({ length: 3 }, (_, i) => b.node(`w:${c}-${i}`));
    for (const p of ps) { b.event({ actor: p, t: t0 + (k++) * 60000, targets: [[me, 'dm']] }); b.event({ actor: me, t: t0 + (k++) * 60000, targets: [[p, 'dm']] }); }
  }
  const ds = b.build();
  const ap = applicability(ds, buildNetwork(ds, defaultSettings(ds)));
  assert.equal(ap.betweenness.level, 'na');
  assert.match(ap.betweenness.reason, /4 conversations from one person's export/);
  assert.doesNotMatch(ap.betweenness.reason, /single conversation/i);
  for (const m of ['constraint', 'effectiveSize']) {
    assert.equal(ap[m].level, 'caution', m);
    assert.match(ap[m].reason, /by construction/);
  }
  // One chat alone keeps the single-conversation wording.
  const one = new DatasetBuilder({ source: { format: 'whatsapp', family: 'personal', view: VIEWS.CHAT, context: 'personal' } });
  const q = Array.from({ length: 4 }, (_, i) => one.node('o:' + i));
  for (let i = 0; i < 12; i++) one.event({ actor: q[i % 4], t: t0 + i * 60000, targets: [[q[(i + 1) % 4], 'dm']] });
  const ds1 = one.build();
  assert.match(applicability(ds1, buildNetwork(ds1, defaultSettings(ds1))).betweenness.reason, /single conversation/i);
});
