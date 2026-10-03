// Tie fields on events (events.attrs): builder, schema, JSON, transfer, merge,
// and the import worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder, toJSON, fromJSON, toTransfer, eventAttrs, inferEventAttributeSchema, cleanEventAttrs } from '../../src/core/model.js';
import { mergeDatasets, applyMerges } from '../../src/core/merge.js';
import { handle } from '../../src/workers/import.worker.js';

function sample(name = 'S') {
  const b = new DatasetBuilder({ name });
  b.beginSource({ format: 'test', tieFields: [{ key: 'freq', label: 'How often', type: 'choice', options: ['Monthly', 'Weekly', 'Daily'], ordered: true }] });
  const a = b.node('t:a'), c = b.node('t:c'), d = b.node('t:d');
  b.event({ type: 'declared', actor: a, targets: [[c, 'declared']], attrs: { freq: 'Daily', strength: 4, kind: ['Advice', 'Friendship'], blank: '', none: null } });
  b.event({ type: 'declared', actor: c, targets: [[d, 'declared']] });
  b.event({ type: 'declared', actor: d, targets: [[a, 'declared']], attrs: { freq: 'Weekly', notes: 'met at the offsite' } });
  return b.build();
}

test('builder keeps tie fields sparse and drops blanks', () => {
  const ds = sample();
  assert.equal(ds.events.attrs.length, 3);
  assert.deepEqual(ds.events.attrs[0], { freq: 'Daily', strength: 4, kind: ['Advice', 'Friendship'] });
  assert.equal(ds.events.attrs[1], null);
  assert.deepEqual(eventAttrs(ds, 1), {});
  assert.equal(eventAttrs(ds, 2).notes, 'met at the offsite');
  // No tie fields at all: the column is null, so big exports pay nothing.
  const b = new DatasetBuilder();
  b.beginSource({ format: 'x' });
  b.event({ type: 'message', actor: b.node('x:a'), targets: [[b.node('x:b'), 'to']] });
  const plain = b.build();
  assert.equal(plain.events.attrs, null);
  assert.deepEqual(plain.eventAttributeSchema, []);
  assert.deepEqual(eventAttrs(plain, 0), {});
  assert.equal(cleanEventAttrs({ a: '', b: [] }), null);
  assert.deepEqual(cleanEventAttrs({ a: ['x'] }), { a: 'x' });
});

test('schema: declared fields keep label and option order; others are inferred', () => {
  const ds = sample();
  const by = Object.fromEntries(ds.eventAttributeSchema.map(f => [f.key, f]));
  assert.equal(ds.eventAttributeSchema[0].key, 'freq');
  assert.equal(by.freq.label, 'How often');
  assert.deepEqual(by.freq.values, ['Monthly', 'Weekly', 'Daily']);
  assert.equal(by.freq.ordered, true);
  assert.equal(by.strength.type, 'numeric');
  assert.equal(by.kind.type, 'categorical');
  assert.deepEqual(by.kind.values, ['Advice', 'Friendship']);
  assert.ok(['text', 'categorical'].includes(by.notes.type));
  assert.deepEqual(inferEventAttributeSchema(ds), ds.eventAttributeSchema);
});

test('JSON round trip and worker transfer keep tie fields', () => {
  const ds = sample();
  const back = fromJSON(toJSON(ds));
  assert.deepEqual(back.events.attrs, ds.events.attrs);
  assert.deepEqual(back.eventAttributeSchema, ds.eventAttributeSchema);
  const { payload } = toTransfer(ds);
  assert.deepEqual(structuredClone(payload).events.attrs, ds.events.attrs);
  // A project saved before tie fields existed still reads.
  const old = JSON.parse(toJSON(ds));
  delete old.events.attrs; delete old.eventAttributeSchema;
  const oldDs = fromJSON(JSON.stringify(old));
  assert.deepEqual(eventAttrs(oldDs, 0), {});
  assert.deepEqual(inferEventAttributeSchema(oldDs).filter(f => !f.declared), []);
});

test('merge keeps each event its fields, also with datasets that have none', () => {
  const a = sample('A');
  const b = new DatasetBuilder({ name: 'B' });
  b.beginSource({ format: 'y' });
  b.event({ type: 'message', actor: b.node('t:a'), targets: [[b.node('t:z'), 'to']] });
  const m = mergeDatasets([b.build(), a]);
  assert.equal(m.events.count, 4);
  assert.equal(m.events.attrs[0], null);
  assert.deepEqual(m.events.attrs[1], a.events.attrs[0]);
  assert.deepEqual(m.events.attrs[3], a.events.attrs[2]);
  assert.ok(m.eventAttributeSchema.some(f => f.key === 'freq' && f.ordered));
  const mm = applyMerges(m, [['t:c', 't:z']]);
  assert.deepEqual(mm.events.attrs, m.events.attrs);
  // Neither has fields: still null.
  assert.equal(mergeDatasets([b.build(), b.build()]).events.attrs, null);
});

test('import worker carries tie fields from the shared-survey importer', async () => {
  const S = await import('../../src/builders/share.js');
  const def = S.validateSurvey({ format: 'orgsignal-survey', version: 1, id: 's1', kind: 'roster', title: 'T', intro: '', createdAt: '2026-01-01T00:00:00Z',
    people: [{ id: 'a', label: 'Ann' }, { id: 'b', label: 'Bo' }], combine: 'respondent',
    relations: [{ id: 'r', name: 'Advice', question: 'Who?', scale: 'binary', max: 5, fields: [{ key: 'strength', label: 'Strength', type: 'scale', max: 5 }] }] });
  const r = S.makeResponse(def, { personId: 'a', label: 'Ann' }, { r: { b: { value: 1, fields: { strength: 3 } } } });
  const posted = [];
  await handle({ type: 'run', files: [{ blob: new Blob([S.responseFileText(r)]), path: 'ann.json' }], opts: {} }, m => posted.push(m));
  const done = posted.find(m => m.type === 'done');
  assert.ok(done, JSON.stringify(posted.find(m => m.type === 'error')));
  assert.deepEqual(done.result.dataset.events.attrs, [{ strength: 3 }]);
  assert.equal(done.result.dataset.meta.sources[0].format, 'shared-survey');
});
