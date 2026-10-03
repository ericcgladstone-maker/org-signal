// Methods appendix on two-mode data: names the network analyzed, the
// projection weighting, and cites the two-mode references it used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetBuilder, addAffiliation, declareTwoMode } from '../../src/core/model.js';
import { buildNetwork } from '../../src/analysis/construct.js';
import { buildMethodsAppendix } from '../../src/llm/methods.js';

function clubs() {
  const b = new DatasetBuilder({ name: 'clubs' });
  b.beginSource({ format: 'test', directed: false });
  declareTwoMode(b, ['Students', 'Clubs']);
  for (const [p, q] of [['a', 'x'], ['b', 'x'], ['a', 'y'], ['b', 'y'], ['c', 'y']]) addAffiliation(b, 's:' + p, 'c:' + q);
  return b.build();
}

test('methods appendix describes the two-mode view and cites Borgatti and Everett', () => {
  const ds = clubs();
  const net = buildNetwork(ds, { twoMode: { view: 'two-mode' } });
  const md = buildMethodsAppendix({ dataset: ds, settings: net.settings, network: net, metrics: ['twoModeDegree', 'twoModeBetweenness'], networkStats: ['twoModeDensity', 'robinsAlexander'] });
  assert.match(md, /two-mode \(students and clubs\)/);
  assert.match(md, /Borgatti, S\. P\., & Everett, M\. G\. \(1997\)/);
  assert.match(md, /Robins, G\., & Alexander, M\. \(2004\)/);
});

test('methods appendix describes a Newman-weighted projection with its minimum shared count', () => {
  const ds = clubs();
  const net = buildNetwork(ds, { twoMode: { view: 'mode1', projection: 'newman', minShared: 2 } });
  const md = buildMethodsAppendix({ dataset: ds, settings: net.settings, network: net });
  assert.match(md, /projection onto clubs: two clubs are tied when they share at least 2 of the students/);
  assert.match(md, /Newman, M\. E\. J\. \(2001\)/);
  assert.doesNotMatch(md, /Breiger/);
});
