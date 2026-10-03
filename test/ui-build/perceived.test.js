import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCSS, agreement, consensus, las, accuracy, perInformantAccuracy, disagreement, referenceFromDataset, toDataset, setUndirected, setReportTie, symmetryCheck, bestPerceiver, undirectedOf, isMutualRelation, toggleInformantTie, setInformantTie, reportedCount } from '../../src/builders/perceived.js';
import { defaultSettings, buildNetwork, computeNetworkMetrics } from '../../src/analysis/index.js';
import { DatasetBuilder } from '../../src/core/model.js';

// Three people, each also an informant.
//   A reports  A->B, B->C, C->A
//   B reports  A->B, B->A, B->C
//   C reports  B->C, C->B
// Shares over 3 informants: AB 2/3, AC 0, BA 1/3, BC 3/3, CA 1/3, CB 1/3.
function css() {
  const c = newCSS();
  c.relation = { name: 'Advice', question: '', undirected: false };
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

// Maya's A11 (findings-maya.md): four students report a 10-person friendship
// network. Priya ticks each friendship in both cells; the others tick one.
const N = ['Maya', 'Priya', 'Jordan', 'Sam', 'Alex', 'Bea', 'Chen', 'Dana', 'Eli', 'Fatima'];
const T = [['Maya', 'Priya'], ['Maya', 'Jordan'], ['Priya', 'Jordan'], ['Priya', 'Alex'], ['Alex', 'Bea'], ['Jordan', 'Bea'], ['Sam', 'Chen'], ['Sam', 'Dana'], ['Chen', 'Dana'], ['Dana', 'Eli'], ['Eli', 'Fatima'], ['Chen', 'Fatima'], ['Jordan', 'Sam']];
const same = (a, b) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
const without = (L, R) => L.filter(t => !R.some(r => same(r, t)));
const REPORTS = {
  Maya: [...without(T, [['Eli', 'Fatima'], ['Chen', 'Fatima']]), ['Maya', 'Bea']],
  Priya: [...T, ['Jordan', 'Alex']],
  Jordan: [...T, ['Jordan', 'Chen'], ['Jordan', 'Dana']],
  Sam: [['Sam', 'Chen'], ['Sam', 'Dana'], ['Chen', 'Dana'], ['Dana', 'Eli'], ['Eli', 'Fatima'], ['Chen', 'Fatima'], ['Jordan', 'Sam'], ['Maya', 'Priya'], ['Jordan', 'Bea'], ['Maya', 'Alex']],
};
function maya({ relation }) {
  let c = newCSS();
  if (relation) c.relation = relation;
  c.people = N.map(n => ({ id: n, label: n }));
  c.informants = Object.keys(REPORTS).map(n => ({ id: 'i' + n, personId: n, label: n, ties: {} }));
  c.informants = c.informants.map(inf => {
    let ties = {};
    for (const [a, b] of REPORTS[inf.label]) {
      const [x, y] = N.indexOf(a) < N.indexOf(b) ? [a, b] : [b, a];
      // The way each student entered it, without the builder's mirroring.
      ties[`${x}|${y}`] = 1;
      if (inf.label === 'Priya') ties[`${y}|${x}`] = 1;
    }
    return { ...inf, ties };
  });
  return c;
}
const r2 = x => Math.round(x * 100) / 100;

test('M1: friendship is mutual by default; mixed entry no longer changes who perceives best', () => {
  assert.equal(undirectedOf(newCSS()), true);
  assert.ok(isMutualRelation('Friendship') && isMutualRelation('Knows') && !isMutualRelation('Advice'));
  const c = maya({});
  const acc = perInformantAccuracy(c, { threshold: 0.5 });
  assert.deepEqual(acc.map(a => r2(a.vsConsensus.jaccard)), [0.79, 0.93, 0.87, 0.64]);
  assert.deepEqual(acc.map(a => a.reported), [12, 14, 15, 10]);
  assert.deepEqual(bestPerceiver(acc), { labels: ['Priya'], jaccard: acc[1].vsConsensus.jaccard, tied: false });
  assert.equal(Object.keys(consensus(c, 0.5)).length / 2, 13);
  // Ticking one cell mirrors it.
  const t = setReportTie(c, {}, 'Maya', 'Bea', 1);
  assert.deepEqual(Object.keys(t).sort(), ['Bea|Maya', 'Maya|Bea']);
});

test('M1: as a directed relation, the mixed entry is flagged; switching to mutual mirrors the ticks', () => {
  const d = maya({ relation: { name: 'Friendship', question: '', undirected: false } });
  const acc = perInformantAccuracy(d, { threshold: 0.5 });
  assert.ok(acc[1].vsConsensus.jaccard < 0.5, 'the reported problem: Priya scored worst');
  const sym = symmetryCheck(d);
  assert.equal(sym.mixed, true);
  assert.deepEqual(sym.twoWay, ['Priya']);
  const u = setUndirected(d, true);
  assert.equal(r2(perInformantAccuracy(u, { threshold: 0.5 })[1].vsConsensus.jaccard), 0.93);
  assert.equal(symmetryCheck(u).mixed, false);
});

test('M2: the consensus of a mutual relation is analyzed as undirected', () => {
  const ds = toDataset(maya({}), { view: 'consensus', threshold: 0.5 });
  assert.equal(ds.meta.sources[0].directed, false);
  assert.equal(ds.events.count, 13);
  const net = buildNetwork(ds, defaultSettings(ds));
  assert.equal(net.directed, false);
  assert.equal(net.edges.count, 13);
  assert.equal(computeNetworkMetrics(net).components, 1);
  assert.ok(ds.meta.sources[0].warnings.some(w => w.code === 'css-consensus-weight'), 'the weight is explained (M18)');
});

test('mutual: clicking the mirror of a ticked pair keeps it; pairs are counted once', () => {
  const c = maya({});
  let inf = { id: 'x', personId: 'Priya', label: 'Priya', ties: {} };
  inf = toggleInformantTie(c, inf, 'Maya', 'Bea');
  assert.deepEqual(Object.keys(inf.ties).sort(), ['Bea|Maya', 'Maya|Bea']);
  // Priya ticks the second cell too: still ticked (was cleared before).
  inf = toggleInformantTie(c, inf, 'Bea', 'Maya');
  assert.deepEqual(Object.keys(inf.ties).sort(), ['Bea|Maya', 'Maya|Bea']);
  assert.equal(reportedCount(c, inf.ties), 1);
  // A further click on either cell clears the pair; so does an explicit clear.
  assert.deepEqual(toggleInformantTie(c, inf, 'Bea', 'Maya').ties, {});
  const once = toggleInformantTie(c, { ...inf, ties: {}, mirrored: {} }, 'Maya', 'Bea');
  assert.deepEqual(toggleInformantTie(c, once, 'Maya', 'Bea').ties, {});
  assert.deepEqual(setInformantTie(c, once, 'Bea', 'Maya', 0).ties, {});
  // Directed relations toggle each cell on its own.
  const d = { ...c, relation: { name: 'Advice', undirected: false } };
  const t1 = toggleInformantTie(d, { id: 'y', ties: {} }, 'Maya', 'Bea');
  assert.deepEqual(Object.keys(t1.ties), ['Maya|Bea']);
  assert.deepEqual(toggleInformantTie(d, t1, 'Maya', 'Bea').ties, {});
  // Twelve friendships ticked in both cells are twelve ties.
  let p = { id: 'z', ties: {} };
  for (const [a, b] of T.slice(0, 12)) { p = toggleInformantTie(c, p, a, b); p = toggleInformantTie(c, p, b, a); }
  assert.equal(reportedCount(c, p.ties), 12);
});

test('scores leave the informant out (checked against an independent Python computation)', () => {
  // scratchpad loo.py: Maya 11/1/2 0.7857, Priya 13/1/0 0.9286, Jordan 13/2/0 0.8667, Sam 9/1/4 0.6429
  const acc = perInformantAccuracy(maya({}), { threshold: 0.5 });
  assert.deepEqual(acc.map(a => [a.vsOthers.hits, a.vsOthers.falseAlarms, a.vsOthers.misses]), [[11, 1, 2], [13, 1, 0], [13, 2, 0], [9, 1, 4]]);
  assert.deepEqual(acc.map(a => Math.round(a.vsOthers.jaccard * 1e4) / 1e4), [0.7857, 0.9286, 0.8667, 0.6429]);
  assert.deepEqual(bestPerceiver(acc, 'vsOthers').labels, ['Priya']);
  // Two informants: each is scored against the other's report.
  const two = { ...maya({}), informants: maya({}).informants.slice(0, 2) };
  assert.ok(perInformantAccuracy(two).every(a => a.vsOthers && Number.isFinite(a.vsOthers.jaccard)));
});

test('a network built from the study is never its reference (circular)', () => {
  const c = maya({});
  const ds = toDataset(c, { view: 'consensus', threshold: 0.5 });
  const ref = referenceFromDataset(ds, c.people);
  assert.equal(ref.fromStudy, true);
  assert.equal(ref.matched, 0);
});

test('mutual off: informants who differ in symmetry are flagged; all two-way suggests mutual', () => {
  const d = maya({ relation: { name: 'Friendship', question: '', undirected: false } });
  const sym = symmetryCheck(d);
  assert.equal(sym.mixed, true);
  const all = setUndirected(setUndirected(d, true), false);
  const s2 = symmetryCheck(all);
  assert.equal(s2.mixed, false);
  assert.equal(s2.allTwoWay, true);
});
