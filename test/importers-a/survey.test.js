import { test } from 'node:test';
import assert from 'node:assert/strict';
import survey from '../../src/importers/survey.js';
import nc from '../../src/importers/network-canvas.js';
import { runImporter, fixture, events, node, ctx, countBy, warning } from './helpers.js';
import { FileSet } from '../../src/core/fileset.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('egor long, EgoWeb headers: two ego interviews, alters never merged across egos', async () => {
  const { ds, source, detect } = await runImporter(survey, fixture('survey', 'egoweb'));
  assert.equal(detect.score, 0.85);
  assert.equal(detect.files.length, 3);
  assert.equal(source.format, 'egor-long');
  assert.equal(source.view, 'ego');
  assert.equal(source.egoKey, null);
  assert.deepEqual(source.egoKeys, ['survey:1', 'survey:2']);
  assert.equal(ds.nodes.count, 2 + 5);
  // "Avery" named by both egos stays two nodes
  assert.equal(node(ds, 'survey:1:1').label, 'Avery');
  assert.equal(node(ds, 'survey:2:1').label, 'Avery');
  assert.deepEqual(node(ds, 'survey:1').attrs, { age: 34, sex: 'w', interview_date: '2024-03-04T10:00:00Z', kind: 'ego', interview: '1' });
  assert.deepEqual(node(ds, 'survey:1:3').attrs, { name: 'Sam', closeness: 5, sex: 'm', kind: 'alter', interview: '1' });
  const ev = events(ds);
  const egoTies = ev.filter(e => e.actor === 'survey:1' || e.actor === 'survey:2');
  assert.deepEqual(egoTies.map(e => [e.actor, e.targets[0][0], e.weight, e.t]), [
    ['survey:1', 'survey:1:1', 4, Date.UTC(2024, 2, 4, 10)],
    ['survey:1', 'survey:1:2', 2, Date.UTC(2024, 2, 4, 10)],
    ['survey:1', 'survey:1:3', 5, Date.UTC(2024, 2, 4, 10)],
    ['survey:2', 'survey:2:1', 3, Date.UTC(2024, 2, 5, 15, 30)],
    ['survey:2', 'survey:2:2', 1, Date.UTC(2024, 2, 5, 15, 30)],
  ]);
  const aa = ev.filter(e => !egoTies.includes(e));
  // weight-0 row dropped, tie to unknown alter 9 skipped with a warning
  assert.deepEqual(aa.map(e => [e.actor, e.targets[0][0], e.weight]), [
    ['survey:1:1', 'survey:1:2', 1], ['survey:1:2', 'survey:1:3', 2], ['survey:2:1', 'survey:2:2', 1],
  ]);
  assert.equal(warning(source, 'unresolved-edge-endpoint').count, 1);
  assert.equal(warning(source, 'multiple-egos').count, 1);
  assert.equal(ctx(ds, 'survey:1').members.length, 4);
  assert.equal(ctx(ds, 'survey:1').kind, 'survey');
});

test('egor long, openeddi headers: single ego sets egoKey; tie_strength used as weight', async () => {
  const { ds, source } = await runImporter(survey, fixture('survey', 'openeddi'));
  assert.equal(source.egoKey, 'survey:P7');
  assert.equal(warning(source, 'multiple-egos'), null);
  assert.equal(node(ds, 'survey:P7:10').label, 'Kim');
  const ev = events(ds);
  assert.deepEqual(ev.map(e => [e.actor, e.targets[0][0], e.weight]), [
    ['survey:P7', 'survey:P7:10', 3], ['survey:P7', 'survey:P7:11', 1], ['survey:P7:10', 'survey:P7:11', 1],
  ]);
  assert.ok(ev.every(e => Number.isNaN(e.t)));
});

test('egor wide one-file: semicolons, decimal comma, netsize drops empty slots', async () => {
  const { ds, source, detect } = await runImporter(survey, fixture('survey', 'wide'));
  assert.equal(detect.score, 0.7);
  assert.equal(source.format, 'egor-wide');
  assert.equal(ds.nodes.count, 2 + 3 + 2);
  assert.equal(node(ds, 'survey:2:3'), null);
  assert.deepEqual(node(ds, 'survey:1').attrs, { sex: 'w', age: '66 - 100', netsize: 3, kind: 'ego', interview: '1' });
  assert.deepEqual(node(ds, 'survey:2:2').attrs, { sex: 'w', closeness: 0.333, slot: 2, kind: 'alter', interview: '2' });
  const ev = events(ds);
  assert.deepEqual(ev.map(e => [e.actor, e.targets[0][0], e.weight]), [
    ['survey:1', 'survey:1:1', 0.75], ['survey:1', 'survey:1:2', 0.5], ['survey:1', 'survey:1:3', 0.25],
    ['survey:1:1', 'survey:1:2', 2], ['survey:1:2', 'survey:1:3', 3],
    ['survey:2', 'survey:2:1', 1], ['survey:2', 'survey:2:2', Math.fround(0.333)], // weights are Float32
    ['survey:2:1', 'survey:2:2', 1],
  ]);
  assert.equal(warning(source, 'pair-outside-netsize').count, 2);
  assert.ok(warning(source, 'pair-values-as-weights'));
});

test('egor wide with a user-supplied pair-column pattern', async () => {
  const { ds } = await runImporter(survey, fixture('survey', 'wide'), { aaRegex: '^X(?<src>\\d+)\\.to\\.(?<tgt>3)$' });
  // only pairs ending in slot 3 are ties now; the others become ego attributes
  const aa = events(ds).filter(e => e.actor.split(':').length === 3);
  assert.deepEqual(aa.map(e => [e.actor, e.targets[0][0]]), [['survey:1:2', 'survey:1:3']]);
  assert.equal(node(ds, 'survey:1').attrs['X1.to.2'], 2);
});

test('Qualtrics: roster matrix is a full network, free recall a separate ego source', async () => {
  const { ds, detect } = await runImporter(survey, fixture('survey', 'qualtrics'));
  assert.equal(detect.score, 0.85);
  const [roster, recall] = ds.meta.sources;
  assert.equal(ds.meta.sources.length, 2);
  assert.equal(roster.format, 'qualtrics');
  assert.equal(roster.view, 'full');
  assert.equal(recall.view, 'ego');
  assert.deepEqual(recall.egoKeys, ['survey:avery lin', 'survey:jose perez']);
  // respondent "jose  perez" is the roster member "José Pérez"
  const jose = node(ds, 'survey:jose perez');
  assert.equal(jose.label, 'José Pérez');
  assert.equal(jose.attrs.roster, true);
  assert.equal(jose.attrs.respondent, true);
  assert.equal(jose.attrs.responseId, 'R_2bbb');
  const ev = events(ds);
  const rosterEv = ev.filter(e => e.context === 'survey:advice_survey.csv#Q5');
  // EndDate is America/Denver wall time per the import row (MST, UTC-7)
  assert.deepEqual(rosterEv.map(e => [e.actor, e.targets[0][0], e.weight, e.t]), [
    ['survey:avery lin', 'survey:jordan pike', 1, Date.UTC(2024, 2, 4, 18, 20, 34)],
    ['survey:avery lin', 'survey:jose perez', 1, Date.UTC(2024, 2, 4, 18, 20, 34)],
    ['survey:jose perez', 'survey:avery lin', 1, Date.UTC(2024, 2, 5, 16, 12)],
    ['survey:morgan lee', 'survey:avery lin', 1, Date.UTC(2024, 2, 6, 23, 5)],
  ]);
  assert.equal(ctx(ds, 'survey:advice_survey.csv#Q5').name, 'Who do you go to for advice?');
  assert.equal(warning(roster, 'self-nominations').count, 1);
  assert.equal(warning(roster, 'respondent-not-in-roster').count, 1);
  assert.equal(warning(roster, 'tz-assumed'), null);
  const recallEv = ev.filter(e => e.context === 'survey:avery lin' || e.context === 'survey:jose perez');
  assert.deepEqual(recallEv.map(e => [e.actor, e.targets[0][0]]), [
    ['survey:avery lin', 'survey:avery lin:Q3_1'], ['survey:avery lin', 'survey:avery lin:Q3_2'], ['survey:jose perez', 'survey:jose perez:Q3_1'],
  ]);
  const dana = node(ds, 'survey:avery lin:Q3_1');
  assert.equal(dana.label, 'Dana Wu');
  assert.equal(dana.attrs.Q4, 5);
  assert.equal(node(ds, 'survey:avery lin:Q3_2').attrs.Q4, 3);
  // the free-recall alter "Avery Lin" named by José is not the roster Avery (ego view, never merged)
  assert.equal(node(ds, 'survey:jose perez:Q3_1').label, 'Avery Lin');
  assert.equal(ev.length, 4 + 3);
});

test('Qualtrics without a name column: respondents identified by ResponseId, with a warning', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'osa-q-'));
  // Same file with the name answers blanked.
  const rows = readFileSync(fixture('survey', 'qualtrics', 'advice_survey.csv'), 'utf8').split('\r\n');
  for (const name of ['Avery Lin', 'jose  perez', 'Morgan Lee']) rows[rows.findIndex(r => r.includes(',' + name + ','))] = rows.find(r => r.includes(',' + name + ',')).replace(',' + name + ',', ',,');
  writeFileSync(join(dir, 'anon.csv'), rows.join('\r\n'));
  const { ds } = await runImporter(survey, dir);
  const roster = ds.meta.sources[0];
  assert.ok(warning(roster, 'respondents-unmatched'));
  assert.equal(warning(roster, 'respondent-not-in-roster'), null);
  assert.ok(node(ds, 'survey:resp:R_1aaa'));
  assert.equal(node(ds, 'survey:resp:R_1aaa').label, 'Response R_1aaa');
  // nominations still point at roster names
  assert.equal(events(ds).filter(e => e.actor === 'survey:resp:R_2bbb' && e.context.endsWith('#Q5'))[0].targets[0][0], 'survey:avery lin');
});

test('Google Forms grid: roster ties per question, "Never" is no tie, time zone assumed', async () => {
  const { ds, source, detect } = await runImporter(survey, fixture('survey', 'forms'));
  assert.equal(detect.score, 0.75);
  assert.equal(source.format, 'google-forms');
  assert.equal(source.view, 'full');
  assert.equal(ds.nodes.count, 2);
  assert.equal(node(ds, 'survey:avery lin').attrs['Email Address'], 'avery@example.org');
  const ev = events(ds);
  assert.deepEqual(ev.map(e => [e.actor, e.targets[0][0], e.context, e.t]), [
    ['survey:jordan pike', 'survey:avery lin', 'survey:advice_form.csv#q1', Date.UTC(2024, 2, 4, 11, 20, 34)],
    ['survey:avery lin', 'survey:jordan pike', 'survey:advice_form.csv#q1', Date.UTC(2024, 2, 14, 9, 5)],
    ['survey:jordan pike', 'survey:avery lin', 'survey:advice_form.csv#q2', Date.UTC(2024, 2, 4, 11, 20, 34)],
  ]);
  assert.equal(ctx(ds, 'survey:advice_form.csv#q2').name, 'How often do you talk?');
  assert.ok(warning(source, 'tz-assumed'));
  const tz = await runImporter(survey, fixture('survey', 'forms'), { timeZone: 'Europe/Berlin' });
  assert.equal(events(tz.ds)[0].t, Date.UTC(2024, 2, 4, 10, 20, 34));
});

test('survey detection does not claim plain CSVs; NC does not claim survey files', async () => {
  for (const d of ['egoweb', 'qualtrics', 'forms', 'wide']) {
    assert.equal((await nc.detect(await FileSet.fromPaths([fixture('survey', d)]))).score, 0);
  }
  const fs = await FileSet.fromPaths([fixture('network-canvas', 'csv', 'P014_9b2e0001_edgeList_knows.csv')]);
  assert.equal((await survey.detect(fs)).score, 0);
});

test('all events are declared ties with declared targets', async () => {
  for (const d of ['egoweb', 'openeddi', 'wide', 'qualtrics', 'forms']) {
    const { ds } = await runImporter(survey, fixture('survey', d));
    const ev = events(ds);
    assert.ok(ev.length > 0);
    assert.deepEqual(countBy(ev, e => e.type), { declared: ev.length });
    assert.ok(ev.every(e => e.targets.length === 1 && e.targets[0][1] === 'declared'));
  }
});
