// Data view, exports and reports (Networks 101 round 2, R5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileBase } from '../../src/ui/services/exporters.js';

test('file names keep a survey combine rule (C13)', () => {
  assert.equal(fileBase({ meta: { name: 'SOC101 A4 friendship (union)' } }), 'soc101-a4-friendship-union');
  assert.equal(fileBase({ meta: { name: 'SOC101 A4 friendship (reciprocated only)' } }), 'soc101-a4-friendship-reciprocated');
  assert.equal(fileBase({ meta: { name: 'European Union trade' } }), 'european-union-trade');
});
