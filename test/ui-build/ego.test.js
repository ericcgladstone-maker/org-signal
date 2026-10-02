import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/builders/ego.js';
import { eventTargets, eventType } from '../../src/core/model.js';
import { parseCSV } from '../../src/importers/tabular.js';

function sample() {
  let s = E.newSession({ caseId: 'P014', egoLabel: 'Ego One', now: Date.UTC(2026, 3, 2) });
  s = E.addGenerator(s, { preset: 'discuss', cap: 3 });
  s = E.addGenerator(s, { preset: 'advice' });
  s = E.addInterpreter(s, { preset: 'relationship' });
  s = E.addInterpreter(s, { preset: 'closeness' });
  s = E.addInterpreter(s, { preset: 'years_known' });
  const add = (n, g) => { const r = E.addAlter(s, n, g); s = r.session; return r; };
  add('Avery Lee', 'discuss'); add('Jordan Park', 'discuss'); add('Sam Ortiz', 'discuss');
  add('avery  lee', 'advice'); add('Kim Ng', 'advice');
  return s;
}

test('dedupe across generators and per-generator cap', () => {
  let s = sample();
  assert.equal(s.alters.length, 4);
  const avery = s.alters.find(a => a.label === 'Avery Lee');
  assert.deepEqual(avery.generators, ['discuss', 'advice']);
  let r = E.addAlter(s, 'Ana Ruiz', 'discuss');
  assert.equal(r.status, 'cap');
  assert.equal(r.session.alters.length, 4);
  r = E.addAlter(s, 'AVERY LEE', 'advice');
  assert.equal(r.status, 'duplicate-same');
  r = E.addAlter(s, 'Jordan Park', 'advice');
  assert.equal(r.status, 'duplicate-other');
  assert.equal(r.session.alters.length, 4);
  assert.equal(E.addAlter(s, '   ', 'advice').status, 'empty');
  // removing from one generator keeps the alter
  s = E.removeAlter(s, avery.id, 'advice');
  assert.deepEqual(s.alters.find(a => a.id === avery.id).generators, ['discuss']);
});

test('implied ties from contexts plus overrides', () => {
  let s = sample();
  const [a, b, c, d] = s.alters.map(x => x.id);
  s = E.addContext(s, 'Work');
  s = E.addContext(s, 'Family');
  const [w, f] = s.contexts.map(x => x.id);
  s = E.assignContext(s, a, w); s = E.assignContext(s, b, w); s = E.assignContext(s, c, w);
  s = E.assignContext(s, d, f);
  assert.equal(E.impliedTies(s).size, 3);
  assert.equal(E.tie(s, a, b), true);
  assert.equal(E.tie(s, a, d), false);
  s = E.toggleTie(s, a, b);           // exception: a and b do not know each other
  s = E.toggleTie(s, c, d);           // exception: c knows d
  assert.equal(E.tie(s, a, b), false);
  assert.equal(E.tie(s, d, c), true);
  assert.equal(Object.keys(s.ties).length, 2);
  s = E.toggleTie(s, b, a);           // back to implied: override dropped
  assert.equal(Object.keys(s.ties).length, 1);
  const list = E.tieList(s);
  assert.equal(list.length, 6);
  assert.equal(list.filter(p => p.on).length, 4);
  assert.equal(list.find(p => p.key === E.pairKey(c, d)).source, 'added');
  const p = E.progress(s);
  assert.equal(p.steps.ties, 1);
  assert.ok(p.fraction > 0 && p.fraction < 1);
});

test('toDataset shape', () => {
  let s = sample();
  const [a, b, c] = s.alters.map(x => x.id);
  s = E.setInterpreter(s, a, 'closeness', '4');
  s = E.setInterpreter(s, a, 'relationship', 'friend');
  s = E.setInterpreter(s, b, 'years_known', '12');
  s = E.toggleTie(s, a, b); s = E.toggleTie(s, b, c);
  const ds = E.toDataset(s);
  const src = ds.meta.sources[0];
  assert.equal(src.view, 'ego');
  assert.equal(src.context, 'survey');
  assert.equal(src.egoKey, `ego:${s.egoId}`);
  assert.equal(ds.nodes.count, 5);
  const egoIdx = ds.nodes.keys.indexOf(src.egoKey);
  assert.equal(ds.nodes.attrs[egoIdx].kind, 'ego');
  const ai = ds.nodes.keys.indexOf(`alter:${s.egoId}:${s.alters[0].uuid}`);
  assert.equal(ds.nodes.attrs[ai].closeness, 4);
  assert.equal(ds.nodes.attrs[ai].relationship, 'friend');
  assert.equal(ds.nodes.attrs[ai].generators, 'Important matters;Advice');
  assert.equal(ds.nodes.attrs[ds.nodes.keys.indexOf(`alter:${s.egoId}:${s.alters[1].uuid}`)].years_known, 12);
  // ego->alter: one per (alter, generator): 3 discuss + 2 advice = 5; alter-alter: 2
  const egoEv = [], aaEv = [];
  for (let i = 0; i < ds.events.count; i++) {
    assert.equal(eventType(ds, i), 'declared');
    assert.equal(eventTargets(ds, i)[0][1], 'declared');
    (ds.events.actor[i] === egoIdx ? egoEv : aaEv).push(i);
  }
  assert.equal(egoEv.length, 5);
  assert.equal(aaEv.length, 2);
  const ctxNames = egoEv.map(i => ds.contexts.names[ds.events.context[i]]);
  assert.equal(ctxNames.filter(n => n === 'Important matters').length, 3);
  assert.equal(ctxNames.filter(n => n === 'Advice').length, 2);
  assert.equal(ds.contexts.kinds[ds.events.context[aaEv[0]]], 'survey');
  assert.equal(ds.events.t[0], Date.UTC(2026, 3, 2));
  assert.throws(() => E.toDataset(E.newSession()), /at least one/);
});

test('Network Canvas CSV columns and categorical expansion', () => {
  let s = sample();
  const [a, b] = s.alters.map(x => x.id);
  s = E.setInterpreter(s, a, 'relationship', 'coworker');
  s = E.setInterpreter(s, a, 'closeness', '5');
  s = E.toggleTie(s, a, b);
  const files = E.toNetworkCanvasCSV(s, { exportedAt: '2026-04-10T09:00:00.000Z' });
  assert.deepEqual(files.map(f => f.name.replace(s.id, 'SID')), ['P014_SID_ego.csv', 'P014_SID_attributeList_Person.csv', 'P014_SID_edgeList_knows.csv']);
  const [ego, alt, edge] = files.map(f => parseCSV(f.text).rows);
  assert.deepEqual(ego[0], ['networkCanvasEgoUUID', 'networkCanvasCaseID', 'networkCanvasSessionID', 'networkCanvasProtocolName',
    'sessionStart', 'sessionFinish', 'sessionExported', 'APP_VERSION', 'COMMIT_HASH', 'name']);
  assert.equal(ego[1][0], s.egoId);
  // the respondent's name is exported, and an exported session is finished
  assert.equal(ego[1][9], s.egoLabel);
  assert.equal(ego[1][5], '2026-04-10T09:00:00.000Z');
  assert.deepEqual(alt[0].slice(0, 4), ['nodeID', 'networkCanvasEgoUUID', 'networkCanvasUUID', 'name']);
  const rel = E.INTERPRETER_PRESETS[0].options.map(o => `relationship_${o.value}`);
  assert.deepEqual(alt[0].slice(4, 4 + rel.length), rel);
  assert.ok(alt[0].includes('closeness') && alt[0].includes('years_known') && alt[0].includes('gen_important_matters') && alt[0].includes('gen_advice'));
  const row1 = Object.fromEntries(alt[0].map((h, i) => [h, alt[1][i]]));
  assert.equal(row1.nodeID, '1');
  assert.equal(row1.relationship_coworker, 'true');
  assert.equal(row1.relationship_friend, 'false');
  assert.equal(row1.closeness, '5');
  assert.equal(row1.gen_advice, 'true');
  assert.deepEqual(edge[0], ['edgeID', 'from', 'to', 'networkCanvasEgoUUID', 'networkCanvasUUID', 'networkCanvasSourceUUID', 'networkCanvasTargetUUID']);
  assert.equal(edge.length, 2);
  assert.deepEqual(edge[1].slice(0, 3), ['1', '1', '2']);
  assert.equal(edge[1][5], s.alters[0].uuid);
});

test('Network Canvas CSV round trip back to a session', () => {
  let s = sample();
  const [a, b, c] = s.alters.map(x => x.id);
  s = E.setInterpreter(s, a, 'relationship', 'family');
  s = E.setInterpreter(s, b, 'closeness', '2');
  s = E.toggleTie(s, a, c);
  const files = E.toNetworkCanvasCSV(s);
  for (const tmpl of [s, undefined]) {
    const r = E.fromNetworkCanvasCSV(files, { template: tmpl });
    assert.equal(r.egoId, s.egoId);
    assert.equal(r.caseId, 'P014');
    assert.equal(r.alters.length, 4);
    assert.deepEqual(r.alters.map(x => x.label), s.alters.map(x => x.label));
    assert.equal(r.generators.length, 2);
    assert.equal(r.alters[0].generators.length, 2);
    const rel = r.interpreters.find(i => i.name === 'relationship');
    assert.equal(rel.type, 'categorical');
    assert.equal(r.alters[0].attrs.relationship, 'family');
    assert.equal(String(r.alters[1].attrs.closeness), '2');
    const on = E.tieList(r).filter(p => p.on);
    assert.equal(on.length, 1);
    assert.deepEqual([on[0].a, on[0].b].map(id => r.alters.find(x => x.id === id).label).sort(), ['Avery Lee', 'Sam Ortiz']);
    // and it still builds a dataset
    assert.equal(E.toDataset(r).nodes.count, 5);
  }
});

test('JSON save and resume', () => {
  let s = sample();
  s = E.addContext(s, 'Work');
  s = E.assignContext(s, s.alters[0].id, s.contexts[0].id);
  s = E.toggleTie(s, s.alters[1].id, s.alters[2].id);
  const back = E.sessionFromJSON(E.sessionToJSON(s));
  assert.deepEqual(back, s);
  assert.throws(() => E.sessionFromJSON('{nope'), /valid JSON/);
  assert.throws(() => E.sessionFromJSON('{"kind":"other"}'), /not an ego session/);
  assert.throws(() => E.sessionFromJSON('{"generators":[]}'), /missing/);
});

test('removing a generator drops alters only it elicited', () => {
  let s = sample();
  s = E.removeGenerator(s, 'advice');
  assert.equal(s.alters.length, 3);
  assert.ok(!s.alters.some(a => a.generators.includes('advice')));
  s = E.removeInterpreter(s, s.interpreters[0].id);
  assert.equal(s.interpreters.length, 2);
  assert.equal(E.varName('How met?'), 'how_met');
  assert.equal(E.varName('1st'), 'v_1st');
});

test('a new setting starts with the people whose answers name it', () => {
  let s = sample();
  s = E.addInterpreter(s, { preset: 'how_met' });
  const [a, b, c, d] = s.alters.map(x => x.id);
  s = E.setInterpreter(s, a, 'how_met', 'school');
  s = E.setInterpreter(s, b, 'how_met', 'work');
  s = E.setInterpreter(s, c, 'relationship', 'coworker');
  s = E.setInterpreter(s, d, 'how_met', 'neighborhood');
  s = E.addContext(s, 'School');
  assert.deepEqual(s.contexts[0].members, [a]);
  s = E.addContext(s, 'Work');
  assert.deepEqual(s.contexts[1].members.sort(), [b, c].sort());
  s = E.addContext(s, 'Neighborhood');
  assert.deepEqual(s.contexts[2].members, [d]);
  s = E.addContext(s, 'Other');
  assert.deepEqual(s.contexts[3].members, []);
  s = E.addContext(s, 'School', { fromAnswers: false });
  assert.deepEqual(s.contexts[4].members, []);
});

test('Network Canvas round trip keeps the respondent, the settings and hand-made exceptions', () => {
  let s = sample();
  const [a, b, c, d] = s.alters.map(x => x.id);
  s = E.addContext(s, 'Work', { fromAnswers: false });
  for (const x of [a, b, c]) s = E.assignContext(s, x, s.contexts[0].id);
  s = E.toggleTie(s, a, b); // removed by hand inside Work
  s = E.toggleTie(s, c, d); // added by hand across settings
  const r = E.fromNetworkCanvasCSV(E.toNetworkCanvasCSV(s), { template: s });
  assert.equal(r.egoLabel, 'Ego One');
  assert.equal(r.egoAttrs.name, undefined);
  assert.deepEqual(r.contexts.map(x => x.name), ['Work']);
  assert.equal(r.contexts[0].members.length, 3);
  const src = new Map(E.tieList(r).map(p => [[p.a, p.b].map(id => r.alters.find(x => x.id === id).label).sort().join('+'), p.source]));
  assert.equal(src.get('Avery Lee+Jordan Park'), 'removed');
  assert.equal(src.get('Kim Ng+Sam Ortiz'), 'added');
  assert.equal(src.get('Avery Lee+Sam Ortiz'), 'context');
});

test('todo names what is left instead of a percentage', () => {
  let s = sample();
  const t = E.todo(s);
  assert.ok(t.some(x => /descriptions still blank/.test(x)));
  assert.ok(t.some(x => /not in any setting/.test(x)));
});

test('setting labels never overlap', () => {
  const items = [{ x: 400, y: 380, w: 100, anchor: 'middle' }, { x: 410, y: 380, w: 60, anchor: 'middle' }, { x: 100, y: 50, w: 50, anchor: 'start' }];
  const ys = E.placeLabels(items, { lineH: 15, midY: 220 });
  assert.equal(ys[0], 380);
  assert.equal(ys[1], 395); // below the middle line: moves down
  assert.equal(ys[2], 50);
  const up = E.placeLabels([{ x: 300, y: 40, w: 80, anchor: 'end' }, { x: 290, y: 40, w: 80, anchor: 'end' }], { lineH: 15, midY: 220 });
  assert.deepEqual(up, [40, 25]); // above it: moves up
});
