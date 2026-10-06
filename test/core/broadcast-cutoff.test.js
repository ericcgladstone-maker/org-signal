// The importers' "more than N recipients / participants" notices must count exactly
// what the default network leaves out (2026-10-05).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BROADCAST_CUTOFF } from '../../src/core/model.js';
import { DatasetBuilder } from '../../src/core/model.js';
import { defaultSettings } from '../../src/analysis/construct.js';
import email from '../../src/importers/email.js';
import calendar from '../../src/importers/calendar.js';

test('default broadcast cutoff: one value for the notices and the network', () => {
  const b = new DatasetBuilder(); b.beginSource({ format: 'test', family: 'workplace', medium: 'test', view: 'full', context: 'workplace', fileNames: [] });
  const ds = b.build();
  assert.equal(defaultSettings(ds).maxRecipients, DEFAULT_BROADCAST_CUTOFF);
  const opt = imp => (typeof imp.options === 'function' ? imp.options() : imp.options || []).find(o => /^max(Recipients|Attendees)$/.test(o.key));
  for (const imp of [email, calendar]) { const o = opt(imp); assert.ok(o, `${imp.id}: cutoff option present`); assert.equal(o.default, DEFAULT_BROADCAST_CUTOFF, imp.id); }
});

test('a source with duplicate records says so once', () => {
  const b = new DatasetBuilder(); b.beginSource({ format: 'test', family: 'workplace', medium: 'test', view: 'full', context: 'workplace', fileNames: [] });
  b.stat('duplicates-skipped', 3);
  const ds = b.build();
  const w = ds.meta.sources[0].warnings.filter(x => /duplicate/.test(x.code));
  assert.equal(w.length, 1); assert.equal(w[0].count, 3);
});
