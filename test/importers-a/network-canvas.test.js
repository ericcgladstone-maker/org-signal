import { test } from 'node:test';
import assert from 'node:assert/strict';
import nc, { cleanCell, typedValue, normName, isoMs } from '../../src/importers/network-canvas.js';
import survey from '../../src/importers/survey.js';
import { runImporter, fixture, events, node, ctx, countBy, warning, zipFolder } from './helpers.js';
import { FileSet } from '../../src/core/fileset.js';

const E1 = '6f1c0000-0000-4000-8000-000000000001';
const E2 = '6f1c0000-0000-4000-8000-000000000002';
const A = 'a1100000-0000-4000-8000-000000000001', B = 'b2200000-0000-4000-8000-000000000002', C = 'c3300000-0000-4000-8000-000000000003';
const V = 'f4400000-0000-4000-8000-000000000004', D = 'd4400000-0000-4000-8000-000000000004', F = 'e5500000-0000-4000-8000-000000000005';
const T1 = Date.UTC(2026, 3, 2, 14, 0, 11), T2 = Date.UTC(2026, 3, 3, 9, 30, 0);

test('cell helpers', () => {
  assert.equal(cleanCell("'+contractor"), '+contractor');
  assert.equal(cleanCell("'=SUM(A1)"), '=SUM(A1)');
  assert.equal(cleanCell("'plain"), "'plain");
  assert.equal(typedValue('0.31'), 0.31);
  assert.equal(typedValue('false'), false);
  assert.equal(typedValue('0,333', { decimalComma: true }), 0.333);
  assert.equal(typedValue('0,333'), '0,333');
  assert.equal(typedValue('  '), undefined);
  assert.equal(normName('  José   PÉREZ '), 'jose perez');
  assert.equal(isoMs('2026-04-02T14:00:11.000Z'), T1);
  assert.ok(Number.isNaN(isoMs('04/02/2026')));
});

test('NC CSV: two sessions joined by UUID, nodeIDs restart per session', async () => {
  const { ds, source, detect } = await runImporter(nc, fixture('network-canvas', 'csv'));
  assert.equal(detect.score, 0.95);
  assert.equal(detect.files.length, 10);
  assert.equal(source.format, 'network-canvas');
  assert.equal(source.view, 'ego');
  assert.equal(source.egoKey, null);
  assert.deepEqual(source.egoKeys, [`nc:${E1}`, `nc:${E2}`]);
  assert.equal(source.directed, false);
  assert.equal(ds.nodes.count, 2 + 4 + 2);

  const ego1 = node(ds, `nc:${E1}`);
  assert.equal(ego1.label, 'Ego P014');
  assert.deepEqual(ego1.attrs, { age: 37, team: 'Design', caseId: 'P014', sessionId: '9b2e0001', protocol: 'Work Advice Study', kind: 'ego', interview: 'P014' });

  const jordan = node(ds, `nc:${E1}:${B}`);
  assert.equal(jordan.label, 'Jordan');
  assert.equal(jordan.attrs.role, '+contractor'); // formula guard stripped
  assert.equal(jordan.attrs.nickname, 'ENCRYPTED');
  assert.equal(jordan.attrs.support_type_emotional, true);
  assert.equal(jordan.attrs.layout_x, 0.62);
  assert.equal(jordan.attrs.closeness, 5);
  assert.equal(jordan.attrs.nodeType, 'Person');
  assert.equal(node(ds, `nc:${E1}:${V}`).attrs.nodeType, 'Venue');
  assert.equal(node(ds, `nc:${E1}:${V}`).label, 'Cafe Uno');

  const ev = events(ds);
  assert.equal(ev.length, 6 + 4);
  assert.ok(ev.every(e => e.type === 'declared'));
  const egoTies = ev.filter(e => e.actor.split(':').length === 2);
  assert.deepEqual(egoTies.map(e => [e.targets[0][0].split(':')[2], e.weight, e.t, e.targets[0][1]]), [
    [A, 4, T1, 'declared'], [B, 5, T1, 'declared'], [C, 2, T1, 'declared'], [V, 1, T1, 'declared'],
    [D, 3, T2, 'declared'], [F, 5, T2, 'declared'],
  ]);
  const aa = ev.filter(e => e.actor.split(':').length === 3).map(e => [e.actor, e.targets[0][0], e.weight, e.context]);
  assert.deepEqual(aa, [
    [`nc:${E1}:${A}`, `nc:${E1}:${B}`, 2, `nc:${E1}#knows`],
    [`nc:${E1}:${B}`, `nc:${E1}:${C}`, 1, `nc:${E1}#knows`],
    // session 2 row had blank endpoint UUIDs: resolved from nodeIDs 1,2 of session 2 only
    [`nc:${E2}:${D}`, `nc:${E2}:${F}`, 3, `nc:${E2}#knows`],
    // advice ties exist only as an adjacency matrix: upper triangle, binary
    [`nc:${E2}:${D}`, `nc:${E2}:${F}`, 1, `nc:${E2}#advice`],
  ]);
  const c1 = ctx(ds, `nc:${E1}`);
  assert.equal(c1.kind, 'canvas');
  assert.equal(c1.visibility, 'private');
  assert.equal(c1.members.length, 5);
  assert.equal(warning(source, 'multiple-egos').count, 1);
  assert.equal(warning(source, 'encrypted-values').count, 1);
  assert.ok(warning(source, 'matrix-symmetrised'));
  assert.ok(warning(source, 'matrix-duplicate')); // knows matrix ignored: its edge list exists
  assert.equal(warning(source, 'missing-ego-record'), null);
  assert.equal(source.counts.alterAlterTies, 4);
  // the survey importer must not claim Network Canvas files
  assert.equal((await survey.detect(await FileSet.fromPaths([fixture('network-canvas', 'csv')]))).score, 0);
});

test('NC CSV from a zip and with an explicit weight column', async () => {
  const zip = zipFolder(fixture('network-canvas', 'csv'), 'networkCanvasExport.zip');
  const { ds } = await runImporter(nc, zip, { weightColumn: 'layout_x' });
  const w = events(ds).filter(e => e.actor === `nc:${E1}` ).map(e => e.weight);
  assert.deepEqual(w.map(x => Math.round(x * 100) / 100), [0.31, 0.62, 0.5, 1]);
});

test('NC GraphML single graph: ego from graph data, ties from ego to every alter', async () => {
  const { ds, source, detect } = await runImporter(nc, fixture('network-canvas', 'graphml-single'));
  assert.equal(detect.score, 0.95);
  assert.equal(source.egoKey, `nc:${E1}`);
  assert.equal(source.warnings.length, 0);
  const ego = node(ds, `nc:${E1}`);
  assert.deepEqual(ego.attrs, { age: 37, caseId: 'P014', sessionId: '9b2e0001', protocol: 'Work Advice Study', kind: 'ego', interview: 'P014' });
  const b = node(ds, `nc:${E1}:${B}`);
  assert.equal(b.label, 'José & Co');
  assert.deepEqual(b.attrs, { closeness: 5, role: 'peer', support_type_advice: false, kind: 'alter', nodeType: 'Person', interview: 'P014' });
  const ev = events(ds);
  assert.deepEqual(ev.map(e => [e.actor, e.targets[0][0], e.weight, e.t]), [
    [`nc:${E1}`, `nc:${E1}:${A}`, 4, T1],
    [`nc:${E1}`, `nc:${E1}:${B}`, 5, T1],
    [`nc:${E1}:${A}`, `nc:${E1}:${B}`, 2, T1],
  ]);
});

test('NC GraphML merged Classic export: each <graph> is one ego', async () => {
  const { ds, source } = await runImporter(nc, fixture('network-canvas', 'graphml-merged'));
  assert.deepEqual(source.egoKeys, [`nc:${E1}`, `nc:${E2}`]);
  assert.equal(source.egoKey, null);
  assert.equal(ds.nodes.count, 2 + 2 + 3);
  const ev = events(ds);
  assert.deepEqual(countBy(ev, e => e.context), { [`nc:${E1}`]: 2, [`nc:${E1}#knows`]: 1, [`nc:${E2}`]: 3, [`nc:${E2}#knows`]: 2 });
  assert.equal(ev.filter(e => e.context === `nc:${E2}`)[0].t, T2);
  assert.ok(warning(source, 'multiple-egos'));
});

test('NC: sessions exported as both CSV and GraphML are counted once', async () => {
  const both = await runImporter(nc, [fixture('network-canvas', 'csv'), fixture('network-canvas', 'graphml-single')]);
  const csvOnly = await runImporter(nc, [fixture('network-canvas', 'csv')]);
  const gmlOnly = await runImporter(nc, [fixture('network-canvas', 'graphml-single')]);
  assert.equal(both.detect.files.length, 11);
  const egos = r => new Set(r.ds.meta.sources.flatMap(s => s.egoKeys || (s.egoKey ? [s.egoKey] : [])));
  const shared = [...egos(gmlOnly)].filter(k => egos(csvOnly).has(k));
  // Every GraphML session that is also in the CSVs adds no events.
  const expected = csvOnly.ds.events.count + (shared.length ? 0 : gmlOnly.ds.events.count);
  assert.equal(both.ds.events.count, expected);
  if (shared.length) assert.ok(warning(both.ds.meta.sources[0], 'duplicate-sessions-skipped'));
});
