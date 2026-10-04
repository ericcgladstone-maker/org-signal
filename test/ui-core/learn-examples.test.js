// Learn's worked-example cards state only what the examples show (M6): every
// decimal a card quotes appears in the example notes, whose numbers are
// checked against the analysis in test/ui-build/examples.test.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES as CARDS } from '../../src/ui/views/learn/concepts.js';
import { EXAMPLES } from '../../src/builders/examples.js';

const notes = EXAMPLES.flatMap(x => x.lookFor).join(' ');

test('every number on a worked-example card is one the example notes check', () => {
  for (const c of CARDS) {
    for (const num of c.what.match(/\d+\.\d+/g) || []) assert.ok(notes.includes(num), `${c.id}: ${num}`);
  }
});

test('the cards no longer say what the examples contradict', () => {
  const all = CARDS.map(c => c.what).join(' ');
  assert.doesNotMatch(all, /low constraint|not the most contacts|Two circles|barely moves/);
});
