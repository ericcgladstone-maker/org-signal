// Beginner support (round 2, decision 1): navigation order and descriptions,
// #learn/<key> routing, the Interpretive notes preference, verdict-first p wording,
// reliability notes filtered by context (L17), the calm small-network note
// (M7), and the Learn content against the glossary.

import test from 'node:test';
import assert from 'node:assert/strict';
import { store, readExplainPref } from '../../src/ui/store.js';
import { registerActions, VIEWS, NAV_GROUPS, parseHash } from '../../src/ui/actions.js';
import { pAtFloor, nullInWords, pShort, chanceWords, reliabilityFor, applicabilityView, applicabilityReason, termGloss, SMALL_NETWORK_NOTE, HOWTO_PARTS } from '../../src/ui/components/common.js';
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
    // Copy audit 2026-10-04: a statement of what the view reports, not a question.
    assert.match(v.purpose, /\.$/, `${id} purpose is a statement`);
    assert.doesNotMatch(v.purpose, /\?/, `${id} purpose asks no question`);
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

test('Interpretive notes: on by default, switchable, preference survives missing storage', () => {
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
  assert.equal(nullInWords(1 / 201, 200), 'none of the 200 random networks came this far from their average (p ≤ 1/201)');
  assert.equal(nullInWords(8 / 201, 200), '7 of the 200 random networks came at least this far from their average (p = 0.040)');
  assert.equal(nullInWords(1 / 101, 100, { what: 'shuffled timelines', sided: 'upper' }), 'none of the 100 shuffled timelines reached the observed value (p ≤ 1/101)');
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
  // Wherever a reason is printed, the engine's small-network reason reads as the copy audit's sentence.
  assert.equal(SMALL_NETWORK_NOTE, 'Small network. Individual ties have substantial leverage on many measures. Comparisons across networks should therefore be interpreted cautiously.');
  assert.equal(applicabilityReason({ level: 'caution', reasons: ['Very small network: single ties move these numbers a lot.', 'One person\'s export.'] }), `${SMALL_NETWORK_NOTE} One person's export.`);
  assert.equal(applicabilityReason({ level: 'na', reason: 'Needs direction.' }), 'Needs direction.');
});

test('the shared explanatory grammar: Interpretation with Definition, Scale, In this network, Caution', () => {
  assert.deepEqual(HOWTO_PARTS, { means: 'Definition.', scale: 'Scale.', example: 'In this network.', mistake: 'Caution.' });
  // Learn sections use the audit's labels; the cautions are statements, not "common mistake" gerunds.
  assert.deepEqual(SECTIONS.map(s => s.title), ['Basics', 'Person-level centrality', 'Personal networks', 'Whole network', 'Groups', 'Random-network comparisons and uncertainty', 'Two-mode networks', 'Surveys', 'Time and content']);
  for (const [k, t] of Object.entries(TEACH)) if (t.mistake) assert.doesNotMatch(t.mistake, /^(Reading|Calling|Treating|Comparing|Expecting|Counting|Using|Forgetting|Missing|Trusting|Confusing|Ignoring|Leaving|Asking|Concluding|Switching|Hand-computing|Ranking)\b/, `${k}: caution, not a mistake gerund`);
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
  assert.deepEqual(EXAMPLES.map(x => x.id), ['two-cliques-broker', 'path-and-star', 'ring-small-world', 'class-friendships', 'clubs-two-mode', 'ego-10']);
  // Learn names each example as Build opens it.
  assert.deepEqual(EXAMPLES.map(x => x.title), ['Two teams and a broker', 'A path of six people', 'A ring (compare with the small world)', 'Class friendships with majors', 'Students and clubs (two-mode)', 'An ego network: you and 10 people']);
  // Two-mode concepts and their figures.
  for (const k of ['twoMode', 'affiliation', 'projection', 'borgattiEverett']) assert.ok(SECTIONS.find(s => s.id === 'twomode').keys.includes(k) && TEACH[k], k);
  for (const d of ['twoMode', 'projection']) assert.ok(DIAGRAMS[d]);
});
