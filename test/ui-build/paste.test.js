import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseTies, toDataset } from '../../src/builders/paste.js';
import { eventTargets } from '../../src/core/model.js';

const one = s => parseLine(s).ties?.[0];

test('undirected forms', () => {
  for (const s of ['Ann - Bo', 'Ann -- Bo', 'Ann, Bo', 'Ann\tBo', 'Ann;Bo']) {
    assert.deepEqual(one(s), { from: 'Ann', to: 'Bo', directed: false, weight: 1 }, s);
  }
});

test('directed forms and arrows', () => {
  assert.deepEqual(one('Ann -> Bo'), { from: 'Ann', to: 'Bo', directed: true, weight: 1 });
  assert.deepEqual(one('Ann <- Bo'), { from: 'Bo', to: 'Ann', directed: true, weight: 1 });
  assert.equal(parseLine('Ann <-> Bo').ties.length, 2);
  assert.deepEqual(one('Ann->Bo'), { from: 'Ann', to: 'Bo', directed: true, weight: 1 });
});

test('weights', () => {
  assert.equal(one('Ann, Bo, 3').weight, 3);
  assert.equal(one('Ann\tBo\t2.5').weight, 2.5);
  assert.equal(one('Ann -> Bo, 4').weight, 4);
  assert.equal(one('Ann - Bo 2').weight, 2);
  assert.match(parseLine('Ann, Bo, x').error, /not a number/);
  assert.match(parseLine('Ann, Bo, -1').error, /greater than zero/);
});

test('quoted names and hyphenated names', () => {
  assert.deepEqual(one('"Smith, Ann", "Lee, Bo", 2'), { from: 'Smith, Ann', to: 'Lee, Bo', directed: false, weight: 2 });
  assert.deepEqual(one('Mary-Kate - Bo'), { from: 'Mary-Kate', to: 'Bo', directed: false, weight: 1 });
  assert.match(parseLine('"Smith, Ann, Bo').error, /not closed/);
});

test('errors, comments, blanks, self-ties with line numbers', () => {
  const p = parseTies('# team\nAnn - Bo\n\nlonely\nCy -> Cy\nBo, Cy, 2, 9\nCy -> Ann');
  assert.equal(p.ties.length, 2);
  assert.deepEqual(p.errors.map(e => e.line), [4, 5, 6]);
  assert.deepEqual(p.nodes.sort(), ['Ann', 'Bo', 'Cy']);
  assert.equal(p.directed, true);
  assert.equal(p.lines.length, 7);
  assert.equal(p.lines[0].kind, 'comment');
  assert.equal(p.lines[2].kind, 'blank');
  assert.equal(p.ties[1].line, 7);
});

test('toDataset', () => {
  const ds = toDataset(parseTies('Ann - Bo\nBo -> Cy, 2\nAnn - Bo'));
  assert.equal(ds.nodes.count, 3);
  // With an arrow in the paste the network is directed, so each undirected
  // line is written both ways (Ann->Bo, Bo->Ann), as Draw does.
  assert.equal(ds.events.count, 5);
  const s = ds.meta.sources[0];
  assert.equal(s.view, 'full'); assert.equal(s.context, 'custom'); assert.equal(s.format, 'paste'); assert.equal(s.directed, true);
  assert.equal(ds.nodes.keys[0], 'paste:ann');
  assert.deepEqual([ds.events.actor[0], ...eventTargets(ds, 0)[0]], [0, 1, 'declared']);
  assert.deepEqual([ds.events.actor[1], ...eventTargets(ds, 1)[0]], [1, 0, 'declared']);
  assert.equal(ds.events.weight[2], 2);
  assert.deepEqual(eventTargets(ds, 2), [[2, 'declared']]);
  // An all-undirected paste stays one event per line.
  assert.equal(toDataset(parseTies('Ann - Bo\nBo - Cy')).events.count, 2);
  assert.throws(() => toDataset(parseTies('')), /no ties/);
});
