// Construction rules vs the naive reimplementation in
// tools/accuracy/checks/construction.mjs, on a fixed seed set, plus one
// pinning test per difference between docs/api/analysis.md and construct.js
// found by the campaign (reported to the analysis owner; construct.js is not
// changed here).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder } from '../../src/core/model.js';
import { buildNetwork, RULES } from '../../src/analysis/construct.js';
import * as C from '../../tools/accuracy/checks/construction.mjs';

const MIN = 60000;
const T0 = Date.UTC(2026, 2, 2, 9);

test('buildNetwork matches the naive rules on 400 random datasets x 3 settings', async () => {
  const r = await C.run({ count: 400, seed: 7 });
  assert.equal(r.failed, 0, JSON.stringify(r.failures.slice(0, 2)));
  assert.ok(r.stats.tiesCompared > 3000 && r.stats.edgeEvidenceTies > 2000, JSON.stringify(r.stats));
  // Every difference found is one of the known, reported ones.
  for (const k of Object.keys(r.stats.knownDifferences)) assert.ok(C.KNOWN.includes(k));
});

test('the comparison is not vacuous: a wrong copresence normalisation or cutoff is caught', () => {
  const all = Object.fromEntries(C.KNOWN.map(k => [k, true]));
  let caught = 0;
  for (let d = 0; d < 300; d++) {
    const rec = C.randomRecord(d), s = C.randomSettings(rec, d);
    const net = buildNetwork(C.buildDataset(rec), s);
    const wrong = { ...s, maxRecipients: s.maxRecipients ? s.maxRecipients + 1 : 2, rules: { ...s.rules, copresence: { ...s.rules.copresence, normalize: !s.rules.copresence.normalize } } };
    if (C.diffNetworks(net, C.naiveNetwork(rec, wrong, all), s)) caught++;
  }
  assert.ok(caught > 30, `${caught} of 300 perturbed references caught`);
});

// ---- pinned differences ---------------------------------------------------------------

function only(rules, extra = {}) {
  const r = {};
  for (const x of RULES) r[x] = { on: false, weight: 1 };
  for (const x of rules) r[x] = { on: true, weight: 1 };
  return { rules: r, directed: true, weighting: 'count', maxRecipients: 25, excludeBots: true, excludeNodes: [], includeIsolates: true, visibility: ['public', 'private', 'direct', 'group', 'unknown'], media: null, time: { start: null, end: null }, ...extra };
}
const ties = (ds, net) => Array.from({ length: net.edges.count }, (_, e) => [ds.nodes.labels[net.nodeIds[net.edges.src[e]]], ds.nodes.labels[net.nodeIds[net.edges.dst[e]]], net.edges.raw[e]]);

test('pinned: turn-taking from a source marked directed:false is one-directional (doc says undirected-source ties go both ways)', () => {
  const b = new DatasetBuilder({ source: { format: 't', directed: false } });
  const A = b.node('t:a', { label: 'A' }), B = b.node('t:b', { label: 'B' });
  const c = b.context('g', { kind: 'chat', visibility: 'group' });
  b.event({ actor: B, t: T0, context: c });
  b.event({ actor: A, t: T0 + MIN, context: c });
  const ds = b.build();
  // Current behaviour: A -> B only. A turn-taking tie is directional by
  // nature, so the doc sentence should exclude it (reported).
  assert.deepEqual(ties(ds, buildNetwork(ds, only(['adjacency']))), [['A', 'B', 1]]);
});

test('pinned: a declared event without a subject ties to its resolved parent\'s author (not in the doc)', () => {
  const b = new DatasetBuilder({ source: { format: 't' } });
  const A = b.node('t:a', { label: 'A' }), B = b.node('t:b', { label: 'B' });
  b.event({ actor: B, t: T0, key: 'm' });
  b.event({ type: 'declared', actor: A, t: T0 + MIN, parentKey: 'm' });
  const ds = b.build();
  assert.deepEqual(ties(ds, buildNetwork(ds, only(['declared']))), [['A', 'B', 1]]);
});

test('reported: a declared target who also wrote the parent is counted once', { skip: 'reported: construct.js:317-322 emits the parent fallback for declared events without de-duplicating it against the declared targets, so this tie gets raw 2' }, () => {
  const b = new DatasetBuilder({ source: { format: 't' } });
  const A = b.node('t:a', { label: 'A' }), B = b.node('t:b', { label: 'B' });
  b.event({ actor: B, t: T0, key: 'm' });
  b.event({ type: 'declared', actor: A, t: T0 + MIN, parentKey: 'm', targets: [[B, 'declared']] });
  const ds = b.build();
  assert.deepEqual(ties(ds, buildNetwork(ds, only(['declared']))), [['A', 'B', 1]]);
});

test('reported: a reply whose reply target is a bot does not fall back to the parent author', { skip: 'reported: construct.js:298 skips excluded targets before hasReplyTarget/hasSubject are set, so the parent fallback (317-322) fires although a target was given' }, () => {
  const b = new DatasetBuilder({ source: { format: 't' } });
  const A = b.node('t:a', { label: 'A' }), B = b.node('t:b', { label: 'B' });
  const Bot = b.node('t:bot', { label: 'Bot', isBot: true });
  b.event({ actor: B, t: T0, key: 'm' });
  b.event({ actor: A, t: T0 + MIN, parentKey: 'm', targets: [[Bot, 'reply']] });
  const ds = b.build();
  assert.deepEqual(ties(ds, buildNetwork(ds, only(['reply']))), []);
});

test('reported: with excludeBots off, an excluded bot\'s events count as excluded, not bots', { skip: 'reported: construct.js:251 tests isBot without excludeBots when attributing the drop' }, () => {
  const b = new DatasetBuilder({ source: { format: 't' } });
  const A = b.node('t:a', { label: 'A' }), Bot = b.node('t:bot', { label: 'Bot', isBot: true });
  b.event({ actor: Bot, t: T0, targets: [[A, 'dm']] });
  const ds = b.build();
  const d = buildNetwork(ds, only(['dm'], { excludeBots: false, excludeNodes: [Bot] })).summary.events.dropped;
  assert.deepEqual([d.bots, d.excluded], [0, 1]);
});
