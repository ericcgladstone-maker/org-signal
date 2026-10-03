// Shell logic from the UX pass (2026-10-02): notices that keep errors and
// pause, progress text for screen readers, stable community numbering and
// the rebuild summary, short names, and the Ask view's names-to-codes layer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../../src/ui/store.js';
import { registerActions, orderCommunities, rebuildSummary, settingsChanges, formatProgress, shortName } from '../../src/ui/actions.js';
import { fileBase } from '../../src/ui/services/exporters.js';
import { engine } from '../../src/ui/services/engine.js';
import { pseudonymize, decodeNames, analystEngine } from '../../src/ui/services/llm.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
registerActions();

test('notices: info dismisses itself, errors stay until dismissed, timers pause while read', async () => {
  const a = store.actions;
  const info = a.notify('info', 'Saved', { timeout: 30 });
  const err = a.notify('error', 'Failed');
  const held = a.notify('warn', 'Check this', { timeout: 30 });
  a.pauseNotices();
  await sleep(60);
  let ids = store.get().notices.map(n => n.id);
  assert.ok(ids.includes(info) && ids.includes(held), 'paused notices stay');
  a.resumeNotices();
  await sleep(1700); // a resumed timer gets at least 1.5 s so the reader can finish
  ids = store.get().notices.map(n => n.id);
  assert.ok(!ids.includes(info) && !ids.includes(held));
  assert.ok(ids.includes(err), 'errors are never dismissed automatically');
  a.dismiss(err);
  assert.equal(store.get().notices.length, 0);
});

test('notices carry an optional detail list and action', () => {
  const id = store.actions.notify('info', 'Rebuilt', { detail: ['Tie weight: count to log'], action: { label: 'Show', onClick() {} }, timeout: 0 });
  const n = store.get().notices.find(x => x.id === id);
  assert.deepEqual(n.detail, ['Tie weight: count to log']);
  assert.equal(n.action.label, 'Show');
  store.actions.dismiss(id);
});

test('progress messages are formatted for reading', () => {
  assert.equal(formatProgress('16916/1691607'), '16,916 of 1,691,607');
  assert.equal(formatProgress('50 of 11864 day files'), '50 of 11,864 day files');
  assert.equal(formatProgress('week of 6 Jan 2025, 4500 events'), 'week of 6 Jan 2025, 4,500 events');
  assert.equal(formatProgress(''), '');
});

test('communities: first load numbers by size', () => {
  const c = orderCommunities({ membership: Int32Array.from([2, 2, 2, 0, 1, 1]) });
  assert.deepEqual([...c.membership], [0, 0, 0, 2, 1, 1]);
  assert.deepEqual(c.sizes, [3, 2, 1]);
});

test('communities: a rebuild keeps numbers by overlap (D9)', () => {
  // Previous: people 0-3 in community 0, 4-6 in 1, 7-8 in 2 (dataset indices = network indices).
  const nodeIds = Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const prev = { membership: Int32Array.from([0, 0, 0, 0, 1, 1, 1, 2, 2]), nodeIds };
  // Engine ids are arbitrary and the second group grew: it must keep number 1.
  const next = orderCommunities({ membership: Int32Array.from([5, 5, 5, 3, 3, 3, 3, 9, 9]) }, prev, nodeIds);
  assert.deepEqual([...next.membership], [0, 0, 0, 1, 1, 1, 1, 2, 2]);
  assert.deepEqual(next.sizes, [3, 4, 2]);
  // Matching kept identities, so the numbers no longer follow size, and the
  // result says so (the reports then do not claim "numbered by size").
  assert.equal(next.numbering, 'matched');
  assert.equal(orderCommunities({ membership: Int32Array.from([2, 2, 2, 0, 1, 1]) }).numbering, 'size');
  // A community that vanishes leaves no empty number.
  const merged = orderCommunities({ membership: Int32Array.from([0, 0, 0, 0, 0, 0, 0, 1, 1]) }, prev, nodeIds);
  assert.equal(merged.count, 2);
  assert.deepEqual([...new Set(merged.membership)].sort(), [0, 1]);
});

test('rebuild summary: counts, moved people and the settings that changed', () => {
  const nodeIds = Int32Array.from([0, 1, 2, 3]);
  const before = { n: 4, edgeCount: 5, nodeIds, communities: { count: 2, membership: Int32Array.from([0, 0, 1, 1]) }, settings: { weighting: 'count', rules: { reply: { on: true, weight: 1 } } } };
  const after = { n: 4, edgeCount: 3, nodeIds, communities: { count: 2, membership: Int32Array.from([0, 0, 0, 1]) }, settings: { weighting: 'log', rules: { reply: { on: true, weight: 1 }, mention: { on: true, weight: 1 } } } };
  const s = rebuildSummary(before, after);
  assert.equal(s.lines[0], '4 people, 3 ties (was 5)');
  assert.match(s.lines[1], /1 person changed community/);
  assert.ok(s.changes.includes('Added ties from mentions'));
  assert.ok(s.changes.includes('Tie weight: count of evidence to log of count'));
  assert.ok(s.changes.some(x => /Betweenness and closeness ignore tie weights/.test(x)));
  assert.deepEqual(settingsChanges({ directed: true }, { directed: true }), []);
});

test('short names for the header chip and file names (D17)', () => {
  assert.equal(shortName('Synthetic workplace (slack, bridge-dependent, seed 1)'), 'Synthetic workplace');
  assert.ok(shortName('A very long dataset name that keeps going and going past the limit').length <= 32);
  assert.equal(fileBase({ meta: { name: 'Synthetic workplace (slack, bridge-dependent, seed 1)' } }), 'synthetic-workplace-seed1');
  // J14: generated data names its scenario in the chip and the file names.
  const gen = 'Synthetic workplace, bridge-dependent (Slack, seed 1)';
  assert.equal(shortName(gen, 40), 'Synthetic workplace, bridge-dependent');
  assert.equal(fileBase({ meta: { name: gen } }), 'synthetic-workplace-bridge-dependent-seed1');
  assert.equal(fileBase({ meta: { name: 'Acme Corp Slack export plus HR roster 2025' } }), 'acme-corp-slack-export');
  assert.equal(fileBase({ meta: {} }), 'network');
});

const ds = {
  meta: { name: 'Acme layoffs', sources: [{ format: 'slack', view: 'full', egoKey: 'slack:U1', fileNames: ['acme.zip'] }] },
  nodes: { count: 3, keys: ['slack:U1', 'email:bob.lee@x.org', 'slack:U3'], labels: ['Ada Arden', 'Bob Lee', 'Ada Smith'],
    attrs: [{ dept: 'Ops', email: 'ada@x.org', manager: 'Bob Lee' }, { dept: 'Eng', title: 'bob@x.org' }, {}], isBot: new Uint8Array(3), platformIds: [{}, {}, {}] },
  attributeSchema: [{ key: 'dept', type: 'categorical' }, { key: 'email', type: 'text' }, { key: 'manager', type: 'text' }, { key: 'title', type: 'categorical' }],
  contexts: { names: ['general', 'dm-ada-bob'] },
  events: { count: 2, text: ['Thanks Bob, ask Ada Arden or write to bob.lee@x.org', 'ok'] },
};

test('names to codes: the copy sent has codes, no identifying columns, scrubbed text (D8)', () => {
  const pc = pseudonymize(ds);
  assert.deepEqual(pc.ds.nodes.keys, ['P1', 'P2', 'P3']);
  assert.deepEqual(pc.ds.nodes.labels, ['P1', 'P2', 'P3']);
  assert.deepEqual(pc.ds.attributeSchema.map(a => a.key), ['dept', 'title']);
  assert.deepEqual(pc.ds.nodes.attrs[0], { dept: 'Ops' });
  assert.deepEqual(pc.ds.nodes.attrs[1], { dept: 'Eng' }, 'values that look like email addresses are dropped');
  assert.equal(pc.ds.meta.name, 'Dataset');
  assert.equal(pc.ds.meta.sources[0].egoKey, 'P1');
  assert.deepEqual(pc.ds.meta.sources[0].fileNames, []);
  assert.equal(pc.ds.events.text[0], 'Thanks P2, ask P1 or write to [email]');
  assert.equal(pc.ds.contexts.names[1], 'dm-ada-bob', 'lowercase fragments are not names as written');
  // "Ada" alone is two people: never guessed.
  assert.equal(pc.encodeQuestion('Is Ada more central than Bob Lee?'), 'Is [name] more central than P2?');
  // The original is untouched.
  assert.equal(ds.nodes.labels[0], 'Ada Arden');
  assert.equal(ds.events.text[0], 'Thanks Bob, ask Ada Arden or write to bob.lee@x.org');
});

test('names to codes: answers are decoded locally', () => {
  assert.equal(decodeNames('P2 links P1 and P3 [T1]; T12 is not a code.', ds), 'Bob Lee links Ada Arden and Ada Smith [T1]; T12 is not a code.');
  assert.equal(decodeNames('P9 is unknown', ds), 'P9 is unknown');
});

test('names to codes: tie evidence and content returned by the engine are scrubbed', async () => {
  store.set({ dataset: ds });
  const saved = { edgeEvidence: engine.edgeEvidence, keywords: engine.keywords };
  engine.edgeEvidence = async () => ({ total: 1, events: [{ actor: 1, actorLabel: 'Bob Lee', context: 'general', text: 'Ada Arden said hi to Bob' }] });
  engine.keywords = async () => ({ network: [{ term: 'Bob', score: 2 }, { term: 'roadmap', score: 1 }] });
  try {
    const eng = analystEngine(pseudonymize(ds));
    const [e] = await eng.edgeEvidence(0, 1, { limit: 10 });
    assert.deepEqual({ actorLabel: e.actorLabel, context: e.context, text: e.text }, { actorLabel: 'P2', context: 'general', text: 'P1 said hi to P2' });
    const kw = await eng.keywords({ by: 'network' });
    assert.deepEqual(kw.network.map(x => x.term), ['P2', 'roadmap']);
    // Without codes nothing is changed.
    const [raw] = await analystEngine().edgeEvidence(0, 1, {});
    assert.equal(raw.text, 'Ada Arden said hi to Bob');
  } finally {
    Object.assign(engine, saved);
    store.set({ dataset: null });
  }
});
