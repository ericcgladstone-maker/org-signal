import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCSS, agreement, consensus, las, accuracy, perInformantAccuracy, disagreement, referenceFromDataset, toDataset } from '../../src/builders/perceived.js';
import { DatasetBuilder } from '../../src/core/model.js';

// Three people, each also an informant.
//   A reports  A->B, B->C, C->A
//   B reports  A->B, B->A, B->C
//   C reports  B->C, C->B
// Shares over 3 informants: AB 2/3, AC 0, BA 1/3, BC 3/3, CA 1/3, CB 1/3.
function css() {
  const c = newCSS();
  c.people = [{ id: 'A', label: 'Ann' }, { id: 'B', label: 'Bo' }, { id: 'C', label: 'Cy' }];
  c.informants = [
    { id: 'iA', personId: 'A', label: 'Ann', ties: { 'A|B': 1, 'B|C': 1, 'C|A': 1 } },
    { id: 'iB', personId: 'B', label: 'Bo', ties: { 'A|B': 1, 'B|A': 1, 'B|C': 1 } },
    { id: 'iC', personId: 'C', label: 'Cy', ties: { 'B|C': 1, 'C|B': 1 } },
  ];
  return c;
}
const keys = t => Object.keys(t).sort();

test('agreement shares', () => {
  const a = agreement(css());
  assert.equal(a.get('A|B'), 2 / 3); assert.equal(a.get('A|C'), 0); assert.equal(a.get('B|C'), 1); assert.equal(a.get('C|B'), 1 / 3);
});

test('consensus at thresholds', () => {
  assert.deepEqual(keys(consensus(css(), 0.5)), ['A|B', 'B|C']);
  assert.deepEqual(keys(consensus(css(), 1 / 3)), ['A|B', 'B|A', 'B|C', 'C|A', 'C|B']);
  assert.deepEqual(keys(consensus(css(), 1)), ['B|C']);
});

test('LAS union and intersection', () => {
  // AB: A yes, B yes -> both.  BA: B yes, A no -> union only.  BC: B yes, C yes -> both.
  // CA: C no, A yes -> union only.  CB: C yes, B no -> union only.  AC: neither.
  assert.deepEqual(keys(las(css(), 'union')), ['A|B', 'B|A', 'B|C', 'C|A', 'C|B']);
  assert.deepEqual(keys(las(css(), 'intersection')), ['A|B', 'B|C']);
  // Without Cy's own report: BC rests on Bo alone for union, absent for intersection.
  const c = css(); c.informants = c.informants.slice(0, 2);
  const u = las(c, 'union'), i = las(c, 'intersection');
  assert.ok(u['B|C']); assert.ok(!i['B|C']);
  assert.deepEqual(u.missing, ['Cy']);
});

test('accuracy against consensus (hand counts)', () => {
  const c = css(), cons = consensus(c, 0.5); // {AB, BC}
  // Ann: AB hit, BC hit, CA false alarm; AC, BA, CB correct rejections.
  assert.deepEqual(accuracy(c.informants[0].ties, cons, c.people),
    { hits: 2, misses: 0, falseAlarms: 1, correctRejections: 3, hitRate: 1, falseAlarmRate: 0.25, jaccard: 2 / 3 });
  // Cy: BC hit, AB miss, CB false alarm -> hit rate 1/2, Jaccard 1/3.
  const cy = accuracy(c.informants[2].ties, cons, c.people);
  assert.equal(cy.hitRate, 0.5); assert.equal(cy.falseAlarmRate, 0.25); assert.equal(cy.jaccard, 1 / 3);
  const all = perInformantAccuracy(c, { reference: { 'A|B': 1 } });
  assert.equal(all.length, 3);
  // Bo vs reference {AB}: AB hit, BA and BC false alarms -> Jaccard 1/3.
  assert.equal(all[1].vsReference.jaccard, 1 / 3);
  assert.equal(all[1].reported, 3);
});

test('disagreement ranks split pairs', () => {
  const d = disagreement(css());
  // AB (2/3) and BA, CA, CB (1/3) all score 4 * 2/3 * 1/3 = 8/9; BC (unanimous) and AC (nobody) are left out.
  assert.equal(d.length, 4);
  for (const r of d) assert.ok(Math.abs(r.score - 8 / 9) < 1e-12);
  assert.ok(!d.some(r => r.from === 'B' && r.to === 'C'));
});

test('reference from a loaded dataset, matched by name', () => {
  const b = new DatasetBuilder({ name: 'obs' });
  b.beginSource({ format: 'x' });
  const a = b.node('x:1', { label: 'ann' }), o = b.node('x:2', { label: 'Bo' }), z = b.node('x:3', { label: 'Zed' });
  b.event({ type: 'message', actor: a, targets: [[o, 'to'], [z, 'cc']] });
  const ref = referenceFromDataset(b.build(), css().people);
  assert.deepEqual(ref.ties, { 'A|B': 1 });
  assert.equal(ref.matched, 2);
});

test('toDataset for consensus, LAS and one informant', () => {
  const c = css();
  const ds = toDataset(c, { view: 'consensus', threshold: 0.5 });
  assert.equal(ds.meta.sources[0].view, 'full');
  assert.equal(ds.meta.sources[0].context, 'survey');
  assert.equal(ds.events.count, 2);
  // Weight carries the share of informants: AB 2/3, BC 1.
  assert.ok(Math.abs(ds.events.weight[0] - 2 / 3) < 1e-6);
  assert.equal(toDataset(c, { view: 'las-union' }).events.count, 5);
  assert.equal(toDataset(c, { view: 'iC' }).events.count, 2);
  assert.equal(toDataset(c, { view: 'iC' }).events.weight[0], 1);
});
