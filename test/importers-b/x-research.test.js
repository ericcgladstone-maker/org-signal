import { test } from 'node:test';
import assert from 'node:assert/strict';
import xResearch, { ID_ONLY_MESSAGE, GNIP_MESSAGE } from '../../src/importers/x-research.js';
import xArchive from '../../src/importers/x-archive.js';
import { DatasetBuilder } from '../../src/core/model.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes } from './helpers.js';

const T = (y, mo, d, h, mi, s, ms = 0) => Date.UTC(y, mo - 1, d, h, mi, s, ms);
const by = (ev, k) => ev.find(e => e.key === k);
const TW_URL = 'https://api.twitter.com/2/tweets/search/all?query=otters';

test('v2 pages (twarc2 raw): dedupe, includes as context only, cross-page resolution, edits, provenance', async () => {
  const fs = await fsFromFixtures('x-research/v2');
  const { det, ds } = await runImport(xResearch, fs);
  assert.equal(det.score, 0.95);
  const src = source(ds);
  assert.equal(src.view, 'sample');
  assert.equal(src.format, 'x-research');
  assert.equal(src.egoKey, null);
  assert.deepEqual(src.queries, [TW_URL]);
  assert.equal(src.counts.tweets, 5);
  const ev = events(ds);
  assert.equal(ev.filter(e => e.key === 'x:tweet:1800000000000000201').length, 1);

  const t201 = by(ev, 'x:tweet:1800000000000000201');
  assert.equal(t201.actor, 'x:100000001');
  assert.equal(t201.t, T(2024, 5, 2, 13, 20, 5));
  assert.deepEqual(t201.targets, [['x:100000002', 'reply'], ['x:100000003', 'mention']]);
  assert.equal(t201.context, 'x:thread:1800000000000000150');
  assert.equal(t201.visibility, 'public');

  // Retweet author from includes.tweets.
  const rt = by(ev, 'x:tweet:1800000000000000202');
  assert.equal(rt.type, 'repost');
  assert.deepEqual(rt.targets, [['x:100000002', 'subject']]);
  // Quote whose referenced tweet's author is only in an earlier page's includes.
  assert.deepEqual(by(ev, 'x:quote:1800000000000000203').targets, [['x:100000005', 'subject']]);
  // Edit chain: older version dropped, latest kept.
  assert.equal(by(ev, 'x:tweet:1800000000000000204'), undefined);
  assert.equal(by(ev, 'x:tweet:1800000000000000205').context, 'x:thread:1800000000000000204');
  // Username-only mention resolved through includes.users.
  assert.deepEqual(by(ev, 'x:tweet:1800000000000000206').targets, [['x:100000001', 'mention']]);

  // Labels/attrs only for nodes that exist; includes-only users are not nodes.
  assert.equal(node(ds, 'x:100000001').label, 'Otter Lab');
  assert.equal(node(ds, 'x:100000001').attrs.followers, 120);
  assert.equal(node(ds, 'x:100000003').label, 'Pine Marten');
  assert.equal(node(ds, 'x:100000009'), null);
  const w = warningCodes(ds);
  for (const c of ['api-errors', 'duplicate-tweets', 'edit-superseded', 'unresolved-parent']) assert.ok(w.includes(c), c);
  assert.ok(ds.nodes.keys.every(k => typeof k === 'string'));
});

test('gzipped twarc2 JSONL is detected and streamed', async () => {
  const fs = await fsFromFixtures('x-research/v2gz');
  const { det, ds } = await runImport(xResearch, fs);
  assert.equal(det.score, 0.95);
  assert.equal(events(ds).length, 1);
});

test('twarc2 flattened tweets', async () => {
  const fs = await fsFromFixtures('x-research/flat');
  const { det, ds } = await runImport(xResearch, fs);
  assert.equal(det.score, 0.9);
  const ev = events(ds);
  assert.deepEqual(by(ev, 'x:tweet:1800000000000000201').targets, [['x:100000002', 'reply'], ['x:100000003', 'mention']]);
  assert.deepEqual(by(ev, 'x:tweet:1800000000000000202').targets, [['x:100000002', 'subject']]);
  assert.equal(node(ds, 'x:100000002').label, 'River Otter');
});

test('v1.1 tweets: extended_tweet, retweeted_status, quoted_status, reply-chain threads, bare 64-bit ids', async () => {
  const fs = await fsFromFixtures('x-research/v11');
  const { det, ds } = await runImport(xResearch, fs);
  assert.equal(det.score, 0.85);
  const ev = events(ds);
  const a = by(ev, 'x:tweet:1050118621198921728');
  assert.equal(a.t, T(2018, 10, 10, 20, 19, 24));
  assert.ok(a.text.endsWith('skin tone modifiers @river_otter'));
  assert.deepEqual(a.targets, [['x:2244994945', 'mention']]);
  assert.equal(a.context, 'x:thread:1050118621198921728');

  const b = by(ev, 'x:tweet:1050118621198921729');
  assert.equal(b.text, '@otterapi agreed & more');
  assert.deepEqual(b.targets, [['x:6253282', 'reply']]); // prefix mention outside display_text_range skipped
  assert.equal(b.parent, a.i);
  assert.equal(b.context, 'x:thread:1050118621198921728');
  assert.equal(by(ev, 'x:tweet:1050118621198921730').context, 'x:thread:1050118621198921728');

  const rt = by(ev, 'x:tweet:1050118621198921731');
  assert.equal(rt.type, 'repost');
  assert.equal(rt.actor, 'x:3333333');
  assert.deepEqual(rt.targets, [['x:6253282', 'subject']]);
  assert.ok(rt.text.includes('skin tone modifiers'), 'RT text comes from retweeted_status');
  assert.deepEqual(by(ev, 'x:quote:1050118621198921732').targets, [['x:2244994945', 'subject']]);
  const w = warningCodes(ds);
  assert.ok(w.includes('gnip-unsupported'));
  assert.ok(w.includes('bad-json-line'));
});

test('twarc-csv: JSON-encoded mention lists, multi-line text, Excel-mangled ids', async () => {
  const fs = await fsFromFixtures('x-research/twarccsv');
  const { det, ds } = await runImport(xResearch, fs);
  assert.equal(det.score, 0.95);
  const ev = events(ds);
  assert.equal(ev.length, 2);
  const a = by(ev, 'x:tweet:1800000000000000201');
  assert.deepEqual(a.targets, [['x:100000002', 'reply'], ['x:100000003', 'mention']]);
  assert.equal(a.text, '@river_otter thanks! cc @pine_marten\nsecond line');
  assert.equal(a.t, T(2024, 5, 2, 13, 20, 5));
  assert.deepEqual(by(ev, 'x:tweet:1800000000000000202').targets, [['x:100000002', 'subject']]);
  assert.ok(warningCodes(ds).includes('excel-mangled-ids'));
  assert.ok(warningCodes(ds).includes('row-without-author'));
  assert.deepEqual(source(ds).queries, [TW_URL]);
});

test('twarc json2csv: tweet_type, text mentions resolved by handle', async () => {
  const fs = await fsFromFixtures('x-research/json2csv');
  const { det, ds } = await runImport(xResearch, fs);
  assert.equal(det.score, 0.95);
  const ev = events(ds);
  const a = by(ev, 'x:tweet:1050118621198921728');
  assert.equal(a.t, T(2018, 10, 10, 20, 19, 24));
  assert.deepEqual(a.targets, [['x:2244994945', 'mention']]);
  assert.ok(warningCodes(ds).includes('mention-unresolved'));
  assert.deepEqual(by(ev, 'x:tweet:1050118621198921729').targets, [['x:6253282', 'reply']]);
  assert.equal(by(ev, 'x:tweet:1050118621198921731').type, 'repost');
  assert.deepEqual(by(ev, 'x:tweet:1050118621198921731').targets, [['x:6253282', 'subject']]);
  assert.deepEqual(by(ev, 'x:quote:1050118621198921732').targets, [['x:2244994945', 'subject']]);
  assert.equal(context(ds, 'x:thread:1050118621198921728').visibility, 'public');
});

test('ID-only datasets are detected and refused with an explanation', async () => {
  for (const dir of ['x-research/ids', 'x-research/idscsv']) {
    const fs = await fsFromFixtures(dir);
    assert.equal((await xResearch.detect(fs)).score, 0.6, dir);
    await assert.rejects(xResearch.import(fs, { builder: new DatasetBuilder(), options: {} }), { message: ID_ONLY_MESSAGE });
  }
  assert.match(ID_ONLY_MESSAGE, /rehydrat/i);
});

test('GNIP Activity Streams are reported unsupported', async () => {
  const fs = await fsFromFixtures('x-research/gnip');
  assert.equal((await xResearch.detect(fs)).score, 0.6);
  await assert.rejects(xResearch.import(fs, { builder: new DatasetBuilder(), options: {} }), { message: GNIP_MESSAGE });
});

test('personal archive files and unrelated JSON are not claimed', async () => {
  const fs = await fsFromMemory({ 'data/tweets.js': 'window.YTD.tweets.part0 = []', 'other.json': '{"a": 1}', 'notes.txt': 'hello' });
  assert.equal((await xResearch.detect(fs)).score, 0);
  const fs2 = await fsFromFixtures('x-research/v2');
  assert.equal((await xArchive.detect(fs2)).score, 0);
});

test('tweets.json as a JSON array, and a pretty-printed single API response', async () => {
  const tw = (id, author) => ({ id, author_id: author, text: 'hi', created_at: '2024-05-02T13:20:05.000Z', edit_history_tweet_ids: [id] });
  const arr = JSON.stringify([tw('1800000000000000401', '100000001'), tw('1800000000000000402', '100000002')], null, 2);
  const one = JSON.stringify({ data: [tw('1800000000000000403', '100000003')], includes: { users: [{ id: '100000003', username: 'c', name: 'Cee' }] }, meta: { result_count: 1 } }, null, 2);
  const fs = await fsFromMemory({ 'a/tweets.json': arr, 'a/response.json': one });
  const { det, ds } = await runImport(xResearch, fs);
  assert.ok(det.score >= 0.9);
  assert.deepEqual(events(ds).map(e => e.key).sort(), ['x:tweet:1800000000000000401', 'x:tweet:1800000000000000402', 'x:tweet:1800000000000000403']);
  assert.equal(node(ds, 'x:100000003').label, 'Cee');
});
