import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContexts, validObservations, options, defaultForm, applyChange, toSpec, describe, sizeNote, FALLBACK_CONTEXTS } from '../../src/builders/generate-spec.js';

// The shape src/generator/index.js listContexts() returns today.
const LIST = [
  { id: 'workplace', label: 'Workplace', description: 'An organization.', media: ['slack', 'email', 'calendar', 'network'],
    params: [{ key: 'size', label: 'People', type: 'int', min: 8, max: 50000, default: 120 }, { key: 'locations', label: 'Office locations', type: 'int', min: 1, max: 6, default: 3 }],
    defaults: { size: 120, locations: 3 }, presets: [{ id: 'distributed', label: 'Distributed', params: {} }, { id: 'siloed', label: 'Siloed', params: { crossShare: 0.12 } }],
    timespan: { start: '2025-01-06', days: 90 }, observations: ['full', 'ego', 'authored', 'chat', 'sample'], nativeMedia: ['slack', 'email'] },
  { id: 'personal', label: 'Personal', media: [{ id: 'whatsapp', label: 'WhatsApp' }], params: { size: { type: 'int', min: 5, max: 400, default: 60 }, closeness: { choices: ['low', 'high'] } },
    presets: { circle: { label: 'Circle' } }, observations: ['ego', 'chat'] },
];
const C = normalizeContexts(LIST);

test('normalises array and object schemas', () => {
  assert.equal(C[0].media[0].id, 'slack');
  assert.equal(C[0].media[0].label, 'Slack');
  assert.equal(C[0].media[2].native, false);
  assert.equal(C[0].media[0].native, true);
  assert.equal(C[1].params.length, 2);
  assert.equal(C[1].params[1].type, 'choice');
  assert.deepEqual(C[1].params[1].choices.map(c => c.id), ['low', 'high']);
  assert.equal(C[1].presets[0].id, 'circle');
  assert.equal(C[1].defaults.size, 60);
});

test('only realistic observations per medium', () => {
  assert.deepEqual(validObservations(C[0], 'slack'), ['full']);
  assert.deepEqual(validObservations(C[0], 'email'), ['ego', 'full']);
  assert.deepEqual(validObservations(C[1], 'whatsapp'), ['ego', 'chat']);
  const o = options(C, { ...defaultForm(C), medium: 'slack' });
  assert.equal(o.observations.find(x => x.id === 'ego').enabled, false);
  assert.match(o.observations.find(x => x.id === 'ego').reason, /Slack export/);
  assert.ok(!o.params.some(p => p.key === 'size'));
});

test('native output disables media without a writer', () => {
  const o = options(C, { ...defaultForm(C), output: 'native' });
  assert.equal(o.media.find(m => m.id === 'calendar').enabled, false);
  assert.equal(o.media.find(m => m.id === 'slack').enabled, true);
});

test('changing upstream resets invalid downstream choices', () => {
  let f = defaultForm(C);
  assert.equal(f.observation, 'full');
  let r = applyChange(C, f, { medium: 'email' });
  assert.equal(r.form.observation, 'full'); // still valid for email
  r = applyChange(C, { ...r.form, observation: 'ego' }, { medium: 'slack' });
  assert.equal(r.form.observation, 'full');
  assert.match(r.notes[0], /Observation changed/);
  r = applyChange(C, r.form, { context: 'personal' });
  assert.equal(r.form.medium, 'whatsapp');
  assert.equal(r.form.observation, 'ego');
  assert.equal(r.form.size, 60);
  r = applyChange(C, r.form, { size: 100000 });
  assert.equal(r.form.size, 400);
});

test('spec and description', () => {
  const f = { ...defaultForm(C), structure: 'siloed', seed: 7, params: { locations: 2, blank: '' } };
  const s = toSpec(f, { output: 'native' });
  assert.deepEqual(s, { context: 'workplace', medium: 'slack', size: 120, seed: 7, structure: 'siloed', content: 'light', observation: 'full', output: 'native',
    timespan: { start: '2025-01-06', days: 90 }, locations: 2 });
  const d = describe(C, f);
  assert.match(d.what, /120 people over 90 days/);
  assert.match(d.what, /Siloed/);
  assert.match(d.native, /Slack export importer/);
  assert.equal(d.nativeAvailable, true);
  assert.equal(describe(C, { ...f, medium: 'calendar' }).nativeAvailable, false);
  assert.equal(sizeNote(100).level, 'info');
  assert.equal(sizeNote(9000).level, 'warn');
});

test('fallback schema is flagged dev-only', () => {
  const fb = normalizeContexts(FALLBACK_CONTEXTS);
  assert.ok(fb.every(c => c.devFallback));
  assert.deepEqual(fb.map(c => c.id), ['workplace', 'online', 'professional', 'personal', 'community', 'survey']);
});
