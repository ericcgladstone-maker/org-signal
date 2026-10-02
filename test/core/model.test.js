import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder, eventTargets, toJSON, fromJSON, VIEWS } from '../../src/core/model.js';

test('builder records nodes, contexts, events and resolves parents', () => {
  const b = new DatasetBuilder({ name: 't', source: { format: 'test', view: VIEWS.FULL } });
  const a = b.node('x:a', { label: 'Ann', attrs: { dept: 'Ops' } });
  const c = b.node('x:c', { label: 'Cy', attrs: { dept: 'Eng' } });
  assert.equal(b.node('x:a', { attrs: { level: 2 } }), a);
  const ch = b.context('x:#gen', { name: 'general', kind: 'channel', visibility: 'public' });
  b.event({ actor: a, t: 1000, context: ch, key: 'm1', text: 'hi <@c>', targets: [[c, 'mention']] });
  b.event({ actor: c, t: 2000, context: ch, key: 'm2', parentKey: 'm1', targets: [[a, 'reply'], [c, 'mention']] });
  b.event({ actor: c, t: 3000, context: ch, parentKey: 'missing' });
  const ds = b.build();
  assert.equal(ds.nodes.count, 2);
  assert.deepEqual(ds.nodes.attrs[a], { dept: 'Ops', level: 2 });
  assert.equal(ds.events.count, 3);
  assert.equal(ds.events.parent[1], 0);
  assert.equal(ds.events.parent[2], -1);
  assert.deepEqual(eventTargets(ds, 1), [[a, 'reply']]); // self-target dropped
  assert.equal(ds.meta.sources[0].warnings[0].code, 'unresolved-parent');
  assert.equal(ds.attributeSchema.find(s => s.key === 'dept').type, 'categorical');
  const back = fromJSON(toJSON(ds));
  assert.ok(back.events.t instanceof Float64Array);
  assert.equal(back.events.t[2], 3000);
});
