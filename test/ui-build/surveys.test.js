// Shared surveys: links, response files, recombining, ego stitching; tie
// fields in the roster and ego builders; name carry-over helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../src/builders/share.js';
import * as R from '../../src/builders/roster.js';
import * as E from '../../src/builders/ego.js';
import { makeTieField, coerceTieValue, combineTieValues } from '../../src/builders/tiefields.js';
import { duplicateReason, likelyDuplicates, matchNames } from '../../src/builders/names.js';
import { runImport } from '../../src/core/pipeline.js';
import { buildNetwork, defaultSettings } from '../../src/analysis/construct.js';
import { eventAttrs, EVENT_TYPES } from '../../src/core/model.js';
import survey from '../../src/importers/survey-response.js';
import { FileSet } from '../../src/core/fileset.js';

const NAMES = ['Ana Ruiz', 'Ben Okafor', 'Cleo Park', 'Dev Shah', 'Eli Moss', 'Fay Lund'];

function roster({ fields = true, rule = 'union' } = {}) {
  let m = R.newRoster();
  m.name = 'Team survey';
  m.people = NAMES.map((l, i) => ({ id: 'p' + i, label: l, attrs: { dept: i < 3 ? 'Ops' : 'Sales', salary: 100 + i } }));
  m.attrColumns = [{ key: 'dept', type: 'categorical' }, { key: 'salary', type: 'number' }];
  m.relations = [
    { ...R.makeRelation({ name: 'Advice', question: 'Who do you go to for advice?' }), id: 'rA', fields: fields ? [makeTieField({ preset: 'tie_type' }), makeTieField({ preset: 'strength' })] : [] },
    { ...R.makeRelation({ name: 'Friend', question: 'Who is a friend?', scale: 'valued', max: 5 }), id: 'rF' },
  ];
  m.mode = 'multi';
  m.mergeRule = rule;
  m.share = { id: 's-team', createdAt: '2026-09-01T00:00:00.000Z' };
  return m;
}
const t0 = Date.parse('2026-09-02T10:00:00Z');
const respond = (def, i, adv = {}, fr = {}, at = t0 + i * 1000) => S.makeResponse(def, { personId: 'p' + i, label: NAMES[i] }, { rA: adv, rF: fr }, { now: at });
const items = (...rs) => rs.flatMap((r, k) => S.parseResponses(S.responseFileText(r), { file: `r${k}.json` }).responses);

// ---- links ----------------------------------------------------------------------

test('survey link round trip; names only, never attributes', () => {
  const def = S.surveyFromRoster(roster());
  assert.deepEqual(def.people[0], { id: 'p0', label: 'Ana Ruiz' });
  assert.ok(!JSON.stringify(def).includes('salary'));
  const link = S.surveyLink(def, 'https://app.example/x/index.html#data');
  assert.ok(link.url.startsWith('https://app.example/x/index.html#survey=1.'));
  assert.equal(link.tooLong, false);
  assert.ok(link.length < 1500, `small roster link is short (${link.length})`);
  const back = S.decodeSurvey(S.surveyFromHash(new URL(link.url).hash));
  assert.deepEqual(back, def);
  assert.equal(S.surveyHash(back), S.surveyHash(def));
  assert.equal(S.surveyFromHash('#network'), null);
});

test('link size limit: a large roster asks for the survey file', () => {
  const m = roster();
  // 100 people fit in a link; a very large roster does not.
  m.people = Array.from({ length: 100 }, (_, i) => ({ id: 'q' + i, label: `Person ${i} ${NAMES[i % 6]}`, attrs: {} }));
  const mid = S.surveyLink(S.surveyFromRoster(m), 'https://a.example/');
  assert.equal(mid.tooLong, false, `100 people: ${mid.length}`);
  m.people = Array.from({ length: 1500 }, (_, i) => ({ id: 'id' + i.toString(36) + Math.random().toString(36).slice(2, 8), label: `Firstname${i} Lastname${(i * 7919) % 1000}`, attrs: {} }));
  const big = S.surveyLink(S.surveyFromRoster(m), 'https://a.example/');
  assert.equal(big.tooLong, true, `1500 people: ${big.length}`);
  assert.ok(big.length > S.LINK_LIMIT);
  const file = S.parseSurveyFile(S.surveyFileText(S.surveyFromRoster(m)));
  assert.equal(file.people.length, 1500);
});

test('damaged or newer links fail with a clear reason', () => {
  const def = S.surveyFromRoster(roster());
  const v = S.encodeSurvey(def);
  assert.throws(() => S.decodeSurvey(v.slice(0, v.length / 2)), /damaged or incomplete/);
  assert.throws(() => S.decodeSurvey('9.' + v.slice(2)), /newer version/);
  assert.throws(() => S.decodeSurvey('garbage'), /incomplete/);
  assert.throws(() => S.parseSurveyFile('{"format":"x"}'), /not an Org Signal survey/);
});

// ---- responses ------------------------------------------------------------------

test('response file: cleaned answers, checksum, text block survives email quoting', () => {
  const def = S.surveyFromRoster(roster());
  assert.throws(() => S.makeResponse(def, { personId: null, label: 'X' }, {}), /own name/);
  const r = respond(def, 0, { p1: { value: 1, fields: { tie_type: ['Advice', 'Bogus'], strength: '7' } }, p0: { value: 1 }, zz: { value: 1 } }, { p2: { value: 9 } });
  assert.equal(r.format, 'orgsignal-response');
  assert.equal(r.survey.id, 's-team');
  assert.match(r.checksum, /^crc32:[0-9a-f]{8}$/);
  assert.deepEqual(r.answers.rA, { p1: { value: 1, fields: { tie_type: ['Advice'] } } }); // self, unknown id, invalid strength dropped
  assert.deepEqual(r.answers.rF, { p2: { value: 5 } });                                    // clipped to the scale
  assert.deepEqual(S.verifyResponse(JSON.parse(S.responseFileText(r))), { ok: true });
  const tampered = JSON.parse(S.responseFileText(r));
  tampered.answers.rA.p3 = { value: 1 };
  assert.match(S.verifyResponse(tampered).reason, /checksum/);
  // Pasted into an email: quoted with '> ', wrapped, with text around it.
  const quoted = 'Hi, here it is:\n\n' + S.responseToText(r).split('\n').map(l => '> ' + l).join('\n') + '\nThanks';
  const p = S.parseResponses(quoted);
  assert.equal(p.responses.length, 1);
  assert.equal(p.responses[0].ok, true);
  assert.deepEqual(p.responses[0].response.answers, r.answers);
  // Two blocks in one paste.
  const two = S.parseResponses(S.responseToText(r) + '\n' + S.responseToText(respond(def, 1)));
  assert.equal(two.responses.length, 2);
  const cut = S.responseToText(r).replace(/\n[A-Za-z0-9_-]{64}\n/, '\n');
  assert.equal(S.parseResponses(cut).responses.filter(x => x.ok).length, 0);
});

test('recombine: who responded, who did not, duplicates (latest wins), another survey rejected', () => {
  const m = roster();
  const def = S.surveyFromRoster(m);
  const other = S.surveyFromRoster({ ...m, share: { id: 's-other', createdAt: m.share.createdAt }, name: 'Other survey' });
  const r0old = respond(def, 0, { p1: { value: 1 } }, {}, t0);
  const r0new = respond(def, 0, { p2: { value: 1 } }, {}, t0 + 60000);
  const r1 = respond(def, 1, { p0: { value: 1, fields: { strength: 2 } } });
  const r3 = respond(def, 3, { p0: { value: 1 } });
  const x = respond(other, 4, { p0: { value: 1 } });
  const bad = { ...JSON.parse(S.responseFileText(respond(def, 5))), checksum: 'crc32:00000000' };
  const all = [...items(r0new, r1, r3, x, r0old), { response: bad, ...S.verifyResponse(bad), file: 'bad.json' }];
  const res = S.recombine(all, { survey: def });
  assert.deepEqual(res.responded.sort(), ['Ana Ruiz', 'Ben Okafor', 'Dev Shah']);
  assert.deepEqual(res.missing, ['Cleo Park', 'Eli Moss', 'Fay Lund']);
  assert.equal(res.duplicates.length, 1);
  assert.equal(res.duplicates[0].label, 'Ana Ruiz');
  assert.deepEqual(Object.keys(res.accepted.find(a => a._who.personId === 'p0').answers.rA), ['p2']);
  assert.equal(res.rejected.length, 1);
  assert.equal(res.rejected[0].title, 'Other survey');
  assert.equal(res.invalid.length, 1);
  const notes = S.recombineNotes(res).map(n => n.text).join('\n');
  assert.match(notes, /3 of 6 people responded/);
  assert.match(notes, /No response from Cleo Park, Eli Moss, Fay Lund/);
  assert.match(notes, /Ana Ruiz sent 2 responses; the latest/);
  assert.match(notes, /different survey \("Other survey"\)/);
  assert.match(notes, /bad.json could not be used: its checksum/);
  // Without the organizer's definition the most answered survey is the reference.
  const auto = S.recombine(items(r1, r3, x));
  assert.equal(auto.survey.id, 's-team');
  assert.equal(auto.rejected.length, 1);
});

test('recombine with the merge rules, tie fields included', () => {
  const def = S.surveyFromRoster(roster());
  const rs = items(
    respond(def, 0, { p1: { value: 1, fields: { strength: 4, tie_type: ['Advice'] } }, p2: { value: 1 } }),
    respond(def, 1, { p0: { value: 1, fields: { strength: 2, tie_type: ['Friendship'] } } }),
  );
  const res = S.recombine(rs, { survey: def });
  const advice = ds => {
    const out = {};
    for (let e = 0; e < ds.events.count; e++) {
      if (ds.contexts.names[ds.events.context[e]] !== 'Advice') continue;
      out[`${ds.nodes.labels[ds.events.actor[e]]}>${ds.nodes.labels[ds.events.tgt[ds.events.tOff[e]]]}`] = eventAttrs(ds, e);
    }
    return out;
  };
  const union = S.recombinedDataset(res, { mergeRule: 'union' });
  // Each nomination is credited to the person who made it, with their own
  // answers (C5); the tie's weight is the strength rating, combined by the rule (C1).
  assert.deepEqual(advice(union), {
    'Ana Ruiz>Ben Okafor': { relation: 'Advice', strength: 4, tie_type: 'Advice' },
    'Ben Okafor>Ana Ruiz': { relation: 'Advice', strength: 2, tie_type: 'Friendship' },
    'Ana Ruiz>Cleo Park': { relation: 'Advice' },
  });
  assert.equal(union.meta.sources[0].directed, false);
  const tieW = (ds, a, b) => {
    const net = buildNetwork(ds, defaultSettings(ds));
    const i = net.index[ds.nodes.labels.indexOf(a)], j = net.index[ds.nodes.labels.indexOf(b)];
    for (let e = 0; e < net.edges.count; e++) if ((net.edges.src[e] === i && net.edges.dst[e] === j) || (net.edges.src[e] === j && net.edges.dst[e] === i)) return net.edges.w[e];
    return null;
  };
  assert.equal(tieW(union, 'Ana Ruiz', 'Ben Okafor'), 4, 'union: the larger rating');
  assert.equal(tieW(union, 'Ana Ruiz', 'Cleo Park'), 1, 'not rated: counts 1');
  assert.ok(union.meta.sources[0].warnings.some(w => w.code === 'roster-tie-weight'));
  const inter = S.recombinedDataset(res, { mergeRule: 'intersection' });
  assert.deepEqual(Object.keys(advice(inter)).sort(), ['Ana Ruiz>Ben Okafor', 'Ben Okafor>Ana Ruiz']);
  assert.equal(tieW(inter, 'Ana Ruiz', 'Ben Okafor'), 2, 'reciprocated only: the smaller rating');
  const asRep = S.recombinedDataset(res, { mergeRule: 'respondent' });
  assert.deepEqual(advice(asRep)['Ben Okafor>Ana Ruiz'], { relation: 'Advice', strength: 2, tie_type: 'Friendship' });
  assert.equal(asRep.meta.sources[0].directed, true);
  // The survey's own rule by default; organizer attributes when given.
  const withAttrs = S.recombinedDataset(res, { people: roster().people });
  assert.equal(withAttrs.nodes.attrs[0].dept, 'Ops');
  assert.equal(withAttrs.nodes.attrs[0].responded, true);
  assert.equal(withAttrs.nodes.attrs[5].responded, false);
  assert.equal(withAttrs.meta.sources[0].format, 'shared-survey');
  assert.deepEqual(withAttrs.meta.sources[0].survey.missing, ['Cleo Park', 'Dev Shah', 'Eli Moss', 'Fay Lund']);
});

test('the importer reads a drop of response files and recombines them', async () => {
  const m = roster();
  const def = S.surveyFromRoster(m);
  const other = S.surveyFromRoster({ ...m, share: { id: 's-other', createdAt: m.share.createdAt }, name: 'Other survey' });
  const files = [
    { blob: new Blob([S.responseFileText(respond(def, 0, { p1: { value: 1, fields: { strength: 5 } } }))]), path: 'team-response-ana.json' },
    { blob: new Blob([S.responseFileText(respond(def, 1, { p0: { value: 1 } }))]), path: 'team-response-ben.json' },
    { blob: new Blob(['Fwd: my answers\n' + S.responseToText(respond(def, 2, { p0: { value: 1 } }))]), path: 'pasted.txt' },
    { blob: new Blob([S.responseFileText(respond(other, 4, { p0: { value: 1 } }))]), path: 'other.json' },
    { blob: new Blob([S.surveyFileText(def)]), path: 'team.survey.json' },
  ];
  const fs = await FileSet.from(files);
  const d = await survey.detect(fs);
  assert.ok(d.score >= 0.9, d.reason);
  assert.equal(d.files.length, 5);
  const { dataset, report } = await runImport(files);
  assert.equal(dataset.meta.sources.length, 1);
  const src = dataset.meta.sources[0];
  assert.equal(src.format, 'shared-survey');
  assert.deepEqual(src.survey.responded.sort(), ['Ana Ruiz', 'Ben Okafor', 'Cleo Park']);
  assert.equal(src.survey.rejected, 1);
  const codes = src.warnings.map(w => w.code);
  for (const c of ['survey-responded', 'survey-nonrespondents', 'survey-other-survey', 'combine-rule']) assert.ok(codes.includes(c), c);
  assert.equal(dataset.nodes.count, 6);
  assert.ok(report);
  const net = buildNetwork(dataset, { directed: false, tieFields: { weight: 'strength' } });
  assert.ok(net.edges.count >= 2);
});

// ---- ego surveys ----------------------------------------------------------------

function egoProtocol() {
  let s = E.newSession({ protocolName: 'Advice ties' });
  s = E.addGenerator(s, { preset: 'advice' });
  s = E.addGenerator(s, { preset: 'social' });
  s = E.addInterpreter(s, { preset: 'closeness' });
  s = E.addTieField(s, { preset: 'frequency' });
  return s;
}
function egoResponse(def, who, picks, { contexts = [], ties = [], at = t0 } = {}) {
  let s = S.respondentSession(def, who);
  for (const [gen, list] of Object.entries(picks)) for (const x of list) {
    const r = E.addAlter(s, x.label, s.generators[gen].id, { personId: x.personId });
    s = r.session;
    if (x.close) s = E.setInterpreter(s, r.alter.id, 'closeness', x.close);
    if (x.freq) s = E.setTieValue(s, r.alter.id, 'frequency', x.freq);
  }
  for (const c of contexts) { s = E.addContext(s, c.name, { fromAnswers: false }); for (const lab of c.members) s = E.assignContext(s, s.alters.find(a => a.label === lab).id, s.contexts.at(-1).id); }
  for (const [a, b] of ties) s = E.toggleTie(s, s.alters.find(x => x.label === a).id, s.alters.find(x => x.label === b).id);
  return S.makeResponse(def, who, S.egoAnswers(s), { now: at });
}

test('ego survey without a roster: one ego network per respondent', () => {
  const def = S.surveyFromEgo(egoProtocol(), { id: 's-ego' });
  assert.equal(def.people.length, 0);
  const back = S.decodeSurvey(S.surveyFromHash(new URL(S.surveyLink(def, 'http://x/').url).hash));
  assert.equal(back.ego.tieFields[0].key, 'frequency');
  const r1 = egoResponse(def, { label: 'Quinn' }, { 0: [{ label: 'Rae', freq: 'Weekly' }, { label: 'Sol' }] }, { contexts: [{ name: 'Work', members: ['Rae', 'Sol'] }] });
  const r2 = egoResponse(def, { label: 'Tam' }, { 0: [{ label: 'Rae' }], 1: [{ label: 'Uma' }] });
  const res = S.recombine(items(r1, r2), { survey: def });
  const ds = S.recombinedDataset(res);
  assert.equal(ds.meta.sources.length, 2);
  assert.ok(ds.meta.sources.every(s => s.view === 'ego' && s.format === 'shared-survey'));
  assert.equal(ds.nodes.count, 2 + 2 + 2); // two egos, their alters kept apart
  const rae = ds.events.attrs.find(a => a && a.frequency);
  assert.deepEqual(rae, { frequency: 'Weekly' });
  // Re-importing gives the same node keys.
  assert.deepEqual(S.recombinedDataset(res).nodes.keys, ds.nodes.keys);
});

test('ego survey against a roster: stitched into one network; perceived ties can be left out', () => {
  const m = roster({ fields: false });
  const def = S.surveyFromEgo(egoProtocol(), { id: 's-stitch', roster: m.people, askTies: true });
  assert.ok(!JSON.stringify(def).includes('Sales'));
  const P = i => ({ label: NAMES[i], personId: 'p' + i });
  const r0 = egoResponse(def, { label: NAMES[0], personId: 'p0' }, { 0: [{ ...P(1), close: '5', freq: 'Daily' }, P(2)], 1: [P(2)] }, { contexts: [{ name: 'Work', members: [NAMES[1], NAMES[2]] }] });
  const r1 = egoResponse(def, { label: NAMES[1], personId: 'p1' }, { 0: [P(0), { label: 'Zed Outsider' }] });
  const res = S.recombine(items(r0, r1), { survey: def });
  assert.deepEqual(res.missing, NAMES.slice(2));
  const ds = S.recombinedDataset(res, { people: m.people });
  // Roster people are the nodes (same keys as the roster builder), plus one off-list name.
  assert.equal(ds.nodes.count, 7);
  assert.equal(ds.nodes.keys[0], 'roster:ana-ruiz');
  assert.equal(ds.nodes.attrs[0].dept, 'Ops');
  const [own, perceived] = ds.meta.sources;
  assert.equal(own.view, 'full'); assert.equal(own.directed, true);
  assert.equal(perceived.directed, false);
  const D = EVENT_TYPES.indexOf('declared');
  const evs = [];
  for (let e = 0; e < ds.events.count; e++) {
    assert.equal(ds.events.type[e], D);
    evs.push({ from: ds.nodes.labels[ds.events.actor[e]], to: ds.nodes.labels[ds.events.tgt[ds.events.tOff[e]]], ctx: ds.contexts.names[ds.events.context[e]], a: eventAttrs(ds, e) });
  }
  const anaBen = evs.find(x => x.from === 'Ana Ruiz' && x.to === 'Ben Okafor');
  assert.deepEqual(anaBen.a, { report: 'own', frequency: 'Daily', closeness: '5 Very close' });
  assert.equal(evs.filter(x => x.from === 'Ana Ruiz' && x.to === 'Cleo Park').length, 2); // named under two questions
  const perc = evs.filter(x => x.a.report === 'perceived');
  assert.equal(perc.length, 1);
  assert.equal(perc[0].ctx, 'Perceived by Ana Ruiz');
  assert.deepEqual([perc[0].from, perc[0].to].sort(), ['Ben Okafor', 'Cleo Park']);
  assert.equal(perc[0].a.perceived_by, 'Ana Ruiz');
  // Construction: perceived ties are left out by default (C2); with them, Ben-Cleo is a tie.
  const idx = l => ds.nodes.labels.indexOf(l);
  const has = (net, a, b) => { const i = net.index[idx(a)], j = net.index[idx(b)]; for (let e = 0; e < net.edges.count; e++) if ((net.edges.src[e] === i && net.edges.dst[e] === j) || (net.edges.src[e] === j && net.edges.dst[e] === i)) return true; return false; };
  assert.deepEqual(defaultSettings(ds).tieFields.filters, [{ key: 'report', values: ['own'] }]);
  const byDefault = buildNetwork(ds, defaultSettings(ds));
  assert.ok(!has(byDefault, 'Ben Okafor', 'Cleo Park'));
  // A person named under two questions is one tie of weight 1 (C4).
  const anaCleo = (() => { const i = byDefault.index[idx('Ana Ruiz')], j = byDefault.index[idx('Cleo Park')]; for (let e = 0; e < byDefault.edges.count; e++) if (byDefault.edges.src[e] === i && byDefault.edges.dst[e] === j) return byDefault.edges.w[e]; return null; })();
  assert.equal(anaCleo, 1);
  const all = buildNetwork(ds, { directed: false, tieFields: { filters: [] } });
  assert.ok(has(all, 'Ben Okafor', 'Cleo Park'));
  const ownOnly = buildNetwork(ds, { directed: false, tieFields: { filters: [{ key: 'report', values: ['own'] }] } });
  assert.ok(!has(ownOnly, 'Ben Okafor', 'Cleo Park'));
  assert.ok(has(ownOnly, 'Ana Ruiz', 'Ben Okafor'));
  assert.ok(ds.meta.sources[0].warnings.some(w => w.code === 'survey-off-roster'));
});

// ---- builders: tie fields, typed columns, names ------------------------------------

test('roster: tie fields in single-informant mode, relation field, typed columns', () => {
  let m = roster();
  m.mode = 'single';
  m = R.setTieAttrs(m, 'rA', 'p0', 'p1', { strength: '3', tie_type: ['Advice'] });
  assert.equal(m.ties.rA['p0|p1'], 1, 'a detail records the tie');
  m = { ...m, ties: { ...m.ties, rF: { 'p0|p1': 4 } } };
  const ds = R.toDataset(m);
  const attrs = ds.events.attrs.filter(Boolean);
  assert.deepEqual(attrs[0], { relation: 'Advice', strength: 3, tie_type: 'Advice' });
  assert.deepEqual(attrs[1], { relation: 'Friend' });
  assert.deepEqual(ds.meta.sources[0].tieFields.map(f => f.key), ['relation', 'tie_type', 'strength']);
  // Clearing the tie clears its details.
  const cleared = R.pruneTieAttrs({ ...m, ties: { ...m.ties, rA: {} } });
  assert.deepEqual(cleared.tieAttrs.rA, {});
  // Typed columns.
  let t = R.renameAttrColumn(m, 'dept', 'team');
  assert.equal(t.people[0].attrs.team, 'Ops');
  assert.equal(t.people[0].attrs.dept, undefined);
  t = R.removeAttrColumn(t, 'salary');
  assert.deepEqual(t.attrColumns.map(c => c.key), ['team']);
  const bad = { ...m, people: m.people.map((p, i) => (i === 2 ? { ...p, attrs: { ...p.attrs, salary: 'n/a' } } : p)) };
  assert.deepEqual(R.badAttrValues(bad, 'salary'), ['Cleo Park']);
  assert.equal(R.toDataset({ ...m, attrColumns: [{ key: 'salary', type: 'number' }] }).nodes.attrs[0].salary, 100);
});

test('tie field values are typed and combined', () => {
  const f = makeTieField({ preset: 'strength' });
  assert.equal(coerceTieValue(f, '4'), 4);
  assert.equal(coerceTieValue(f, '9'), undefined);
  const c = makeTieField({ preset: 'frequency' });
  assert.equal(coerceTieValue(c, 'weekly'), 'Weekly');
  assert.equal(coerceTieValue(c, 'Hourly'), undefined);
  assert.equal(c.ordered, true);
  const fields = [f, makeTieField({ preset: 'tie_type' })];
  assert.deepEqual(combineTieValues(fields, { strength: 2, tie_type: ['Advice'] }, { strength: 4, tie_type: ['Support'] }, 'union'), { strength: 4, tie_type: ['Advice', 'Support'] });
  assert.equal(combineTieValues(fields, { strength: 2 }, { strength: 4 }, 'intersection').strength, 2);
});

test('ego: tie fields on ego ties, merging two alters, roster ids', () => {
  let s = egoProtocol();
  const g = s.generators[0].id, g2 = s.generators[1].id;
  let r = E.addAlter(s, 'Jon', g); s = r.session; const jon = r.alter;
  r = E.addAlter(s, 'Jonathan Reyes', g2); s = r.session; const full = r.alter;
  s = E.setTieValue(s, jon.id, 'frequency', 'Daily');
  s = E.setInterpreter(s, full.id, 'closeness', '4');
  s = E.mergeAlters(s, full.id, jon.id);
  assert.equal(s.alters.length, 1);
  assert.deepEqual(s.alters[0].generators, [g2, g]);
  assert.deepEqual(s.alters[0].tie, { frequency: 'Daily' });
  assert.equal(s.alters[0].attrs.closeness, '4');
  // Carry-over by id: name the same alter under another question.
  r = E.addAlter(s, 'Kim', g); s = r.session;
  r = E.addAlter(s, null, g2, { alterId: r.alter.id });
  assert.equal(r.status, 'duplicate-other');
  // Roster ids: same person whatever the spelling.
  r = E.addAlter(r.session, 'Ana Ruiz', g, { personId: 'p0' });
  r = E.addAlter(r.session, 'ana ruiz', g2, { personId: 'p0' });
  assert.equal(r.status, 'duplicate-other');
  const ds = E.toDataset(r.session);
  const withF = ds.events.attrs.filter(Boolean);
  assert.ok(withF.some(a => a.frequency === 'Daily'));
  assert.equal(ds.meta.sources[0].tieFields[0].key, 'frequency');
  const back = E.sessionFromJSON(E.sessionToJSON(r.session));
  assert.deepEqual(back.tieFields, r.session.tieFields);
  assert.equal(back.alters.find(a => a.personId === 'p0').label, 'Ana Ruiz');
});

test('names: likely duplicates and type-ahead order', () => {
  assert.equal(duplicateReason('Jon', 'Jonathan Reyes'), 'short');
  assert.equal(duplicateReason('J. Reyes', 'Jonathan Reyes'), 'initial');
  assert.equal(duplicateReason('Jonathon Reyes', 'Jonathan Reyes'), 'spelling');
  assert.equal(duplicateReason('Ana Ruiz', 'Ana Lopez'), 'first-name');
  assert.equal(duplicateReason('ANA  RUIZ', 'Ana Ruiz'), 'same');
  assert.equal(duplicateReason('Ben Okafor', 'Cleo Park'), null);
  assert.equal(duplicateReason('Al', 'Alice Wu'), null); // too short to say
  const list = NAMES.map((l, i) => ({ id: 'p' + i, label: l }));
  assert.deepEqual(likelyDuplicates('Ana', list).map(x => x.label), ['Ana Ruiz']);
  assert.deepEqual(matchNames('park', list).map(x => x.label), ['Cleo Park']);
  assert.deepEqual(matchNames('e', list).map(x => x.label).slice(0, 2), ['Eli Moss', 'Ben Okafor']);
  assert.equal(matchNames('', list).length, 6);
});
