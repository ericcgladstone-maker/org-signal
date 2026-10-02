import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGrouping, isBookkeepingAttr } from '../../src/analysis/groups.js';

const attr = (key, k, extra = {}) => ({ key, label: key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), type: 'categorical', values: Array.from({ length: k }, (_, i) => 'v' + i), coverage: 1, ...extra });
const ds = (schema, sources = [{ format: 'slack' }]) => ({ attributeSchema: schema, meta: { sources } });

test('default grouping: a department-like attribute with 3 to 15 levels, else communities', () => {
  // Slack + HR: Title (33 levels) and Tz come first in the schema; Dept wins.
  assert.equal(defaultGrouping(ds([attr('title', 33), attr('tz', 4), attr('dept', 8), attr('office', 3)])), 'dept');
  assert.equal(defaultGrouping(ds([attr('team_name', 6), attr('department', 5)])), 'department');
  // Personal exports: an employer known for 19% of people is not a default.
  assert.equal(defaultGrouping(ds([attr('company', 9, { coverage: 0.19 }), attr('is_phone_number', 2, { type: 'boolean' })])), null);
  // Survey bookkeeping: Responded is never the default.
  assert.equal(defaultGrouping(ds([attr('responded', 2, { type: 'boolean' })])), null);
  // Too many or too few levels.
  assert.equal(defaultGrouping(ds([attr('team', 40)])), null);
  assert.equal(defaultGrouping(ds([attr('team', 2)])), null);
  assert.equal(defaultGrouping(ds([attr('team', 4, { coverage: 0.3 })])), null);
  // Groups drawn by hand count even when there are only two.
  assert.equal(defaultGrouping(ds([attr('group', 2)], [{ format: 'draw' }])), 'group');
});

test('bookkeeping attributes are recognised', () => {
  for (const a of [attr('responded', 2, { type: 'boolean' }), attr('is_saved_contact', 2), attr('isEgo', 2), attr('deleted', 2), attr('tz_offset', 4), attr('kind', 2)]) assert.ok(isBookkeepingAttr(a), a.key);
  for (const a of [attr('dept', 5), attr('team', 3), attr('office', 4), attr('title', 30), attr('island', 3)]) assert.ok(!isBookkeepingAttr(a), a.key);
});
