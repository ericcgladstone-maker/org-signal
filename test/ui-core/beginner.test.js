// Beginner support (round 2, decision 1): navigation order and descriptions,
// #learn/<key> routing, the Explanations preference, verdict-first p wording,
// reliability notes filtered by context (L17), the calm small-network note
// (M7), and the Learn content against the glossary.

import test from 'node:test';
import assert from 'node:assert/strict';
import { store, readExplainPref } from '../../src/ui/store.js';
import { registerActions, VIEWS, NAV_GROUPS, parseHash } from '../../src/ui/actions.js';
import { pAtFloor, nullInWords, pShort, chanceWords, reliabilityFor, applicabilityView, termGloss } from '../../src/ui/components/common.js';
import { GLOSSARY, GLOSSARY_ALIASES } from '../../src/analysis/glossary.js';
import { SECTIONS, TEACH, TASKS, EXAMPLES } from '../../src/ui/views/learn/concepts.js';
import { DIAGRAMS } from '../../src/ui/views/learn/diagrams.js';

registerActions();

test('navigation: workflow order, every view described, explore views say what they are for', () => {
  assert.deepEqual(VIEWS.map(v => v.id), ['data', 'build', 'generate', 'network', 'people', 'groups', 'content', 'time', 'methods', 'ask', 'learn']);
  assert.deepEqual(NAV_GROUPS.map(g => g.id), ['get', 'explore', 'report', 'learn']);
  for (const v of VIEWS) {
    assert.ok(v.desc && v.desc.length < 60, `${v.id} has a one-line description`);
    assert.ok(NAV_GROUPS.some(g => g.id === v.group), `${v.id} is in a group`);
  }
  for (const id of ['network', 'people', 'groups', 'content', 'time']) {
    const v = VIEWS.find(x => x.id === id);
    assert.match(v.purpose, /\?$/, `${id} purpose is a question`);
    assert.ok(v.shows.length >= 2 && v.shows.length <= 3);
  }
});

test('hash: #learn/<key> opens Learn at a concept; other views keep their parameters', () => {
  assert.deepEqual(parseHash('#learn/betweenness'), { view: 'learn', key: 'betweenness' });
  assert.deepEqual(parseHash('#learn'), { view: 'learn', key: null });
  assert.deepEqual(parseHash('#build?example=path-and-star'), { view: 'build', key: null });
  assert.deepEqual(parseHash('#nope'), { view: null, key: null });
  store.actions.setView('learn/nullP', { focus: false });
  assert.equal(store.get().view, 'learn');
  assert.equal(store.get().learnKey, 'nullP');
  store.actions.setView('network', { focus: false });
  assert.equal(store.get().view, 'network');
});

test('Explanations: on by default, switchable, preference survives missing storage', () => {
  assert.equal(readExplainPref(), true, 'no storage in Node: default on');
  const mem = new Map();
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  try {
    store.actions.setExplain(false);
    assert.equal(store.get().explain, false);
    assert.equal(readExplainPref(), false);
    store.actions.setExplain(true);
    assert.equal(readExplainPref(), true);
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(readExplainPref(), true);
    store.actions.setExplain(false); // must not throw
    assert.equal(store.get().explain, false);
  } finally {
    delete globalThis.localStorage;
    store.set({ explain: true });
  }
});

test('p at its floor is said in words (decision 5)', () => {
  assert.equal(pAtFloor(1 / 201, 200), true);
  assert.equal(pAtFloor(0.01, 200), false);
  assert.equal(nullInWords(1 / 201, 200), 'none of the 200 random networks came this close (p ≤ 1/201)');
  assert.equal(nullInWords(8 / 201, 200), '7 of the 200 random networks came this close (p = 0.040)');
  assert.equal(nullInWords(1 / 101, 100, { what: 'shuffled timelines' }), 'none of the 100 shuffled timelines came this close (p ≤ 1/101)');
  assert.equal(pShort(1 / 201, 200), 'p ≤ 1/201');
  assert.equal(pShort(0.2, 200), 'p = 0.200');
  assert.equal(chanceWords(55), 'far more than chance');
  assert.equal(chanceWords(-2.5), 'less than chance');
  assert.equal(chanceWords(0.4), 'about what chance gives');
});

test('reliability notes only say what can apply to this data (L17)', () => {
  const rel = GLOSSARY.betweenness.reliability;
  const tiny = reliabilityFor(rel, { n: 6, declaredOnly: true, ego: false });
  assert.doesNotMatch(tiny, /3,000|Spearman|resampling|construction rules/);
  assert.match(tiny, /Ignores tie weights/);
  const big = reliabilityFor(rel, { n: 5000, declaredOnly: false, ego: false });
  assert.match(big, /3,000/);
  assert.match(big, /resampling/);
  const contacts = reliabilityFor(GLOSSARY.contacts.reliability, { n: 8, declaredOnly: true, ego: false });
  assert.doesNotMatch(contacts, /broadcast cutoff/);
  assert.match(reliabilityFor(GLOSSARY.inDegree.reliability, { n: 50, ego: false }), /^Robust in full views\.$/);
  assert.match(reliabilityFor(GLOSSARY.inDegree.reliability, { n: 50, ego: true }), /owner/);
});

test('a small network is one calm note, not a CAUTION on every measure (M7)', () => {
  const small = applicabilityView({ level: 'caution', reasons: ['Very small network: single ties move these numbers a lot.'] });
  assert.equal(small.level, 'ok');
  assert.equal(small.small, true);
  const both = applicabilityView({ level: 'caution', reasons: ['Very small network: single ties move these numbers a lot.', 'One person\'s export.'] });
  assert.equal(both.level, 'caution');
  assert.equal(both.reason, 'One person\'s export.');
  assert.equal(applicabilityView({ level: 'na', reason: 'Needs direction.' }).reason, 'Needs direction.');
});

test('Learn: beginner concepts exist, every key is in the glossary, links go to real views', () => {
  for (const k of ['tie', 'directed', 'weight', 'ego', 'alter', 'nameGenerator', 'roster', 'plantedGroup', 'nullModel', 'nullZ', 'nullP', 'rankInterval', 'randomSeed']) {
    assert.ok(GLOSSARY[k], `glossary has ${k}`);
    assert.ok(GLOSSARY[k].meaning.length > 20);
  }
  assert.equal(termGloss('z').key, 'nullZ');
  assert.equal(termGloss('seed').key, 'randomSeed');
  for (const a of Object.values(GLOSSARY_ALIASES)) assert.ok(GLOSSARY[a]);
  const ids = new Set(VIEWS.map(v => v.id));
  for (const s of SECTIONS) for (const k of s.keys) assert.ok(GLOSSARY[k], `${s.id}: ${k} in glossary`);
  for (const [k, t] of Object.entries(TEACH)) {
    assert.ok(GLOSSARY[k], `teach ${k} is a glossary key`);
    for (const [, hash] of t.where || []) assert.ok(ids.has(hash), `${k}: ${hash} is a view`);
    if (t.diagram) assert.ok(DIAGRAMS[t.diagram], `${k}: diagram ${t.diagram}`);
  }
  for (const d of ['degree', 'betweenness', 'closeness', 'clustering', 'constraint']) assert.ok(DIAGRAMS[d]);
  // Every assignment has at least one entry in "Find it in the app".
  for (let i = 1; i <= 12; i++) assert.ok(TASKS.some(t => t.a === `A${i}`), `A${i}`);
  for (const t of TASKS) { assert.ok(ids.has(t.to)); for (const k of t.learn) assert.ok(GLOSSARY[k], k); }
  assert.deepEqual(EXAMPLES.map(x => x.id), ['two-cliques-broker', 'path-and-star', 'ring-small-world', 'class-friendships', 'ego-10']);
});
