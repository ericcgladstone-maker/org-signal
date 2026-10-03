// Content measures against naive recomputations: VADER per message and
// aggregated, keyword counts and TF-IDF, and the tokenizer's documented rules.
// The heavy version is tools/accuracy/campaign.mjs (check 'content').

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentDataset, checkAffect, checkKeywords, checkTokenize } from '../../tools/accuracy/checks/content.mjs';
import { tally } from '../../tools/accuracy/lib.mjs';
import { DatasetBuilder } from '../../src/core/model.js';
import { keywords } from '../../src/analysis/content/keywords.js';

const ok = (t) => assert.equal(t.failures.length, 0, JSON.stringify(t.failures.slice(0, 3)));

test('tokenize follows each documented rule', () => {
  const t = tally('tokenize');
  checkTokenize(t);
  ok(t);
});

test('affect: per-message compound = vendor VADER on the cleaned text; every by-unit row = naive aggregation', () => {
  const t = tally('affect');
  for (const seed of [1, 2, 3, 4]) checkAffect(contentDataset(seed, { people: 8, messages: 200 }), t, `seed ${seed}`);
  assert.ok(t.comparisons > 1000);
  ok(t);
});

test('keywords: counts, token totals, tfidf and order = naive recount, for every by-unit', () => {
  const t = tally('keywords');
  for (const seed of [1, 2, 3]) {
    const ds = contentDataset(seed, { people: 8, messages: 300 });
    for (const by of ['node', 'group', 'context', 'source', 'visibility', 'window', 'overall']) checkKeywords(ds, t, `seed ${seed}`, { by, minTokens: 5 });
  }
  ok(t);
});

test('regression: keywords overall `messages` leaves out bots, like `count`', () => {
  // Before the fix `messages` came from the corpus document frequency, which
  // counts bot messages, so a term only a bot used twice had count 0 but
  // messages 2 (and a term used by a bot and a person had messages 2, count 1).
  const b = new DatasetBuilder({ source: { format: 't' } });
  const p = b.node('t:p', { label: 'Pat' }), bot = b.node('t:b', { label: 'Botty', isBot: true });
  b.event({ actor: p, t: Date.UTC(2026, 0, 1), text: 'quarterly forecast' });
  b.event({ actor: bot, t: Date.UTC(2026, 0, 2), text: 'quarterly reminder' });
  b.event({ actor: bot, t: Date.UTC(2026, 0, 3), text: 'quarterly reminder' });
  const r = keywords(b.build(), { by: 'overall', minTokens: 1, minCount: 1 });
  const q = r.overall.find(x => x.term === 'quarterly');
  assert.deepEqual([q.count, q.messages], [1, 1]);
  assert.equal(r.overall.find(x => x.term === 'reminder'), undefined);
});
