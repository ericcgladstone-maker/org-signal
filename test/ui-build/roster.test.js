import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRoster, makeRelation, parseRosterText, formTemplate, parseRosterResponses, mergeResponses, toDataset, responsesFromDataset, RELATION_PRESETS, rosterFromResponses, tiesFor } from '../../src/builders/roster.js';
import { parseCSV } from '../../src/importers/tabular.js';
import { pairKey, cellValue, parseAdjacencyCSV, adjacencyCSV } from '../../src/builders/matrix.js';
import { eventTargets } from '../../src/core/model.js';

function abc() {
  const m = newRoster();
  m.people = [{ id: 'A', label: 'Ann', attrs: { dept: 'Ops' } }, { id: 'B', label: 'Bo', attrs: { dept: 'R&D' } }, { id: 'C', label: 'Cy', attrs: {} }];
  m.relations = [{ id: 'r', ...RELATION_PRESETS[2], scale: 'valued', max: 5 }];
  return m;
}

test('parseRosterText: lines and CSV with attributes, duplicates dropped', () => {
  const a = parseRosterText('Ann\nBo\n\n ann \nCy');
  assert.deepEqual(a.people.map(p => p.label), ['Ann', 'Bo', 'Cy']);
  assert.deepEqual(a.duplicates, ['ann']);
  const b = parseRosterText('name,dept,tenure\nAnn,Ops,3\n"Lee, Bo",R&D,5');
  assert.deepEqual(b.people.map(p => p.label), ['Ann', 'Lee, Bo']);
  assert.equal(b.people[1].attrs.dept, 'R&D');
  assert.deepEqual(b.attrColumns, [{ key: 'dept', type: 'text' }, { key: 'tenure', type: 'number' }]);
});

test('merge rules on a hand example', () => {
  // A->B 3, A->C 2 (A's answers); B->A 5 (B's answer); C answered nothing.
  const resp = [
    { personId: 'A', ties: { r: { [pairKey('A', 'B')]: 3, [pairKey('A', 'C')]: 2 } } },
    { personId: 'B', ties: { r: { [pairKey('B', 'A')]: 5 } } },
    { personId: 'C', ties: { r: {} } },
  ];
  const people = abc().people;
  const u = mergeResponses(resp, 'r', 'union', people);
  // {A,B}: reported both ways -> max(3,5) = 5; {A,C}: one-sided -> 2.
  assert.deepEqual(u.ties, { 'A|B': 5, 'A|C': 2 });
  assert.equal(u.directed, false);
  assert.equal(u.stats.reciprocated, 1); assert.equal(u.stats.oneSided, 1);
  const i = mergeResponses(resp, 'r', 'intersection', people);
  // Only {A,B} is reciprocated -> min(3,5) = 3.
  assert.deepEqual(i.ties, { 'A|B': 3 });
  const r = mergeResponses(resp, 'r', 'respondent', people);
  assert.deepEqual(r.ties, { 'A|B': 3, 'A|C': 2, 'B|A': 5 });
  assert.equal(r.directed, true);
  // Union when only the later-ordered person reported: C->A only -> stored as A|C.
  const late = mergeResponses([{ personId: 'C', ties: { r: { 'C|A': 1 } } }], 'r', 'union', people);
  assert.deepEqual(late.ties, { 'A|C': 1 });
});

test('form template: Google Forms and Qualtrics column shapes', () => {
  const m = abc();
  const t = formTemplate(m);
  const g = parseCSV(t.googleCsv).rows;
  assert.deepEqual(g[0], ['Timestamp', 'Your name',
    'Who do you go to for advice about work? [Ann]', 'Who do you go to for advice about work? [Bo]', 'Who do you go to for advice about work? [Cy]']);
  assert.equal(g.length, 4);
  assert.equal(g[2][1], 'Bo');
  const q = parseCSV(t.qualtricsCsv).rows;
  assert.deepEqual(q[0], ['StartDate', 'EndDate', 'ResponseId', 'Q1', 'Q2_1', 'Q2_2', 'Q2_3']);
  assert.equal(q[1][5], 'Who do you go to for advice about work? - Bo');
  assert.equal(q[2][4], '{"ImportId":"QID2_1"}');
  assert.match(t.instructions, /Checkbox grid/);
  assert.match(t.instructions, /Matrix table/);
});

test('parse Google Forms responses', () => {
  const m = abc();
  const csv = 'Timestamp,Your name,Who do you go to for advice about work? [Ann],Who do you go to for advice about work? [Bo],Who do you go to for advice about work? [Cy]\n'
    + '2026/04/01 10:00:00,Ann,,4,2\n2026/04/01 10:05:00, bo ,5,,\n2026/04/01 10:09:00,Zed,1,,\n';
  const r = parseRosterResponses(csv, m);
  assert.equal(r.format, 'google-forms');
  assert.equal(r.respondents.length, 2);
  assert.deepEqual(r.respondents[0].ties.r, { 'A|B': 4, 'A|C': 2 });
  assert.deepEqual(r.respondents[1].ties.r, { 'B|A': 5 });
  assert.deepEqual(r.unmatchedNames, ['Zed']);
});

test('parse Qualtrics three-header-row responses with checkbox labels', () => {
  const m = abc();
  m.relations[0].scale = 'binary';
  const csv = [
    'StartDate,EndDate,ResponseId,Q1,Q2_1,Q2_2,Q2_3',
    'Start Date,End Date,Response ID,What is your name?,Who do you go to for advice about work? - Ann,Who do you go to for advice about work? - Bo,Who do you go to for advice about work? - Cy',
    '{"ImportId":"startDate"},{"ImportId":"endDate"},{"ImportId":"_recordId"},{"ImportId":"QID1"},{"ImportId":"QID2_1"},{"ImportId":"QID2_2"},{"ImportId":"QID2_3"}',
    '2026-04-01 10:00:00,2026-04-01 10:04:00,R_1,Cy,Yes,Yes,',
  ].join('\n');
  const r = parseRosterResponses(csv, m);
  assert.equal(r.format, 'qualtrics');
  assert.deepEqual(r.respondents[0].ties.r, { 'C|A': 1, 'C|B': 1 });
});

test('cellValue and adjacency CSV round trip', () => {
  assert.equal(cellValue(''), 0); assert.equal(cellValue('No'), 0); assert.equal(cellValue('Yes'), 1);
  assert.equal(cellValue('3'), 3); assert.equal(cellValue('4 - Close'), 4);
  const people = abc().people;
  const ties = { 'A|B': 1, 'C|A': 1 };
  const back = parseAdjacencyCSV(adjacencyCSV(people, ties), people);
  assert.deepEqual(back.ties, ties);
  assert.deepEqual(parseAdjacencyCSV(',Ann,Zed\nAnn,0,1\n', people).unknown, ['Zed']);
});

test('toDataset: single informant and multi with merge rule', () => {
  const m = abc();
  m.ties = { r: { 'A|B': 2, 'B|C': 1 } };
  m.attrColumns = [{ key: 'dept', type: 'text' }];
  const ds = toDataset(m);
  const s = ds.meta.sources[0];
  assert.equal(s.view, 'full'); assert.equal(s.context, 'survey'); assert.equal(s.format, 'roster'); assert.equal(s.directed, true);
  assert.equal(ds.nodes.count, 3); assert.equal(ds.events.count, 2);
  assert.equal(ds.nodes.keys[0], 'roster:ann');
  assert.equal(ds.nodes.attrs[1].dept, 'R&D');
  assert.equal(ds.events.weight[0], 2);
  assert.deepEqual(eventTargets(ds, 1), [[2, 'declared']]);
  assert.equal(ds.contexts.names[0], 'Advice');

  m.mode = 'multi'; m.mergeRule = 'intersection';
  m.responses = { respondents: [
    { personId: 'A', ties: { r: { 'A|B': 1 } } }, { personId: 'B', ties: { r: { 'B|A': 1, 'B|C': 1 } } }] };
  const ds2 = toDataset(m);
  assert.equal(ds2.events.count, 1);
  assert.equal(ds2.meta.sources[0].directed, false);
  assert.equal(ds2.nodes.attrs[2].responded, false);
  assert.equal(ds2.meta.sources[0].warnings[0].code, 'roster-nonrespondents');
  // A dataset read back into respondents gives the same reported ties.
  m.mergeRule = 'respondent';
  const back = responsesFromDataset(toDataset(m), m);
  assert.deepEqual(back.respondents.map(r => r.ties.r), [{ 'A|B': 1 }, { 'B|A': 1, 'B|C': 1 }]);
});

test('makeRelation gives ids', () => {
  const r = makeRelation(RELATION_PRESETS[0]);
  assert.ok(r.id); assert.equal(r.scale, 'binary');
});

// A Google Forms responses export, as a teacher downloads it (P5, P6).
const FORM = [
  'Timestamp,Your name,Who do you spend free time with? [Ann Lee],Who do you spend free time with? [Bo Park],Who do you spend free time with? [Cy Ortiz],Who do you spend free time with? [Di Ng]',
  '9/15/2025 9:44:01,Ann Lee,,Yes,Yes,',
  '9/15/2025 9:50:12,Bo Park,Yes,,,',
  '9/15/2025 10:02:40,Di Ng,,,Yes,',
  '9/15/2025 10:05:00,Ed Ruiz,Yes,,,',
].join('\n');

test('parseRosterText: a survey responses file is not a list of names', () => {
  const r = parseRosterText(FORM);
  assert.equal(r.survey, true);
  assert.equal(r.people.length, 0);
});

test('parseRosterText: a table without a name column asks which column, then uses it', () => {
  const t = 'id,first,dept\n1,Ana,Eng\n2,Ben,Ops\n3,Cara,Eng';
  const r = parseRosterText(t);
  assert.equal(r.needsColumn, true);
  assert.deepEqual(r.headers, ['id', 'first', 'dept']);
  const p = parseRosterText(t, { nameColumn: 'first' });
  assert.deepEqual(p.people.map(x => x.label), ['Ana', 'Ben', 'Cara']);
  assert.deepEqual(p.people[0].attrs, { id: '1', dept: 'Eng' });
  // or each whole line is a name ("Lee, Ann" style lists)
  assert.deepEqual(parseRosterText('Lee, Ann\nPark, Bo', { nameColumn: '' }).people.map(x => x.label), ['Lee, Ann', 'Park, Bo']);
});

test('rosterFromResponses: the file is the roster, its questions and its answers', () => {
  const m = rosterFromResponses(FORM, { file: 'Friendship survey (Responses).csv' });
  assert.deepEqual(m.people.map(p => p.label), ['Ann Lee', 'Bo Park', 'Cy Ortiz', 'Di Ng', 'Ed Ruiz']);
  assert.equal(m.relations.length, 1);
  assert.equal(m.relations[0].question, 'Who do you spend free time with?');
  assert.equal(m.relations[0].name, 'Spend free time with');
  assert.equal(m.mode, 'multi');
  assert.equal(m.mergeRule, 'union');
  assert.equal(m.name, 'Friendship survey (Responses)');
  assert.equal(m.responses.respondents.length, 4);
  assert.equal(m.responses.file, 'Friendship survey (Responses).csv');
  // union: Ann-Bo (both), Ann-Cy, Di-Cy, Ed-Ann
  const t = tiesFor(m, m.relations[0].id);
  assert.equal(Object.keys(t.ties).length, 4);
  assert.equal(t.stats.reciprocated, 1);
  assert.equal(rosterFromResponses('Ann\nBo'), null);
  const ds = toDataset(m);
  assert.equal(ds.nodes.count, 5);
});
