import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteBigInts, parseJSON, parseYTD, streamJSON } from '../../src/importers/lib/json.js';
import { fixMojibake, fixMojibakeDeep, decodeEntities, stripHtml } from '../../src/importers/lib/text.js';
import { isoMs, isoUtcMs, twitterDateMs, snowflakeMs, X_EPOCH, DISCORD_EPOCH, zonedToUtc, tzOffsetMs } from '../../src/importers/lib/time.js';

test('quoteBigInts keeps long ids exact and leaves strings and floats alone', () => {
  const raw = '{"ID": 1234567890123456789, "s": "9999999999999999999", "f": 1.2345678901234567e5, "n": -12345678901234567, "small": 42, "ts": 1700000000000}';
  const v = parseJSON(raw);
  assert.equal(v.ID, '1234567890123456789');
  assert.equal(v.s, '9999999999999999999');
  assert.equal(v.f, 1.2345678901234567e5);
  assert.equal(v.n, '-12345678901234567');
  assert.equal(v.small, 42);
  assert.equal(v.ts, 1700000000000);
  assert.equal(quoteBigInts('{"a":"x\\"1234567890123456789"}'), '{"a":"x\\"1234567890123456789"}');
});

test('parseYTD handles window.YTD wrappers, same-line arrays and the manifest prefix', () => {
  assert.deepEqual(parseYTD('window.YTD.follower.part0 = [ ]'), []);
  assert.deepEqual(parseYTD('window.YTD.tweet.part0 = [ {\n "tweet": {"id_str": "1"} } ]'), [{ tweet: { id_str: '1' } }]);
  assert.equal(parseYTD('window.__THAR_CONFIG = {"userInfo":{"accountId":"1400000000000000001"}}').userInfo.accountId, '1400000000000000001');
});

async function collect(src, pats, opts) { const out = []; for await (const x of streamJSON(src, pats, opts)) out.push(x); return out; }

function chunked(str, size) {
  const bytes = new TextEncoder().encode(str);
  return new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size)); c.close(); } });
}

test('streamJSON yields matched values in order across arbitrary chunk boundaries', async () => {
  const doc = JSON.stringify({ about: 'x', chats: { list: [
    { name: 'A "q" é', id: 1, messages: [{ id: 1, text: ['a', { t: 'b]}' }] }, { id: 2, text: '{' }] },
    { name: 'B', id: 2, messages: [] },
    { name: 'C', id: 3, messages: [{ id: 3, big: 0 }] },
  ] }, tail: [1, 2] }).replace('"big":0', '"big":12345678901234567890');
  const pats = ['chats.list.*.name', 'chats.list.*.messages.*'];
  const whole = await collect(doc, pats);
  for (const size of [1, 2, 3, 7, 64]) {
    const got = await collect(chunked(doc, size), pats);
    assert.deepEqual(got, whole, `chunk size ${size}`);
  }
  assert.deepEqual(whole.map(x => x.path.join('.')), ['chats.list.0.name', 'chats.list.0.messages.0', 'chats.list.0.messages.1', 'chats.list.1.name', 'chats.list.2.name', 'chats.list.2.messages.0']);
  assert.equal(whole[0].value, 'A "q" é');
  assert.deepEqual(whole[1].value, { id: 1, text: ['a', { t: 'b]}' }] });
  assert.equal(whole[5].value.big, '12345678901234567890');
});

test('streamJSON handles top-level arrays, scalars, escaped keys and a BOM', async () => {
  assert.deepEqual((await collect('﻿[1, true, null, "x", {"a":1}]', ['*'])).map(x => x.value), [1, true, null, 'x', { a: 1 }]);
  assert.deepEqual((await collect('{"k\\"ey": {"v": 5}, "n": -1.5e3}', ['k"ey.v', 'n'])).map(x => x.value), [5, -1500]);
  assert.deepEqual(await collect('{"a": []}', ['a.*']), []);
  assert.deepEqual((await collect(' 12 ', [''])).map(x => x.value), [12]);
});

test('fixMojibake repairs Meta byte-escaped UTF-8 and is idempotent', () => {
  const thumbs = 'ð\u009f\u0091\u008d'; // spec: thumbs-up as Meta writes it
  assert.equal(fixMojibake(thumbs), '\u{1F44D}');
  assert.equal(fixMojibake('\u00c3\u00a9'), '\u00e9'); // '\u00c3\u00a9' -> '\u00e9'
  assert.equal(fixMojibake('Ä\u008d'), 'č'); // spec: 'č'
  assert.equal(fixMojibake(fixMojibake(thumbs)), '\u{1F44D}');
  assert.equal(fixMojibake('café'), 'café'); // genuine Latin-1 kept
  assert.equal(fixMojibake('plain'), 'plain');
  assert.equal(fixMojibake('\u{1F44D} é'), '\u{1F44D} é');
  assert.deepEqual(fixMojibakeDeep({ n: ['\u00c3\u00a9'], x: 1 }), { n: ['\u00e9'], x: 1 });
});

test('entities and HTML stripping', () => {
  assert.equal(decodeEntities('a &amp; b &lt;3 &#39;x&#39; &#x1F44D;'), "a & b <3 'x' \u{1F44D}");
  assert.equal(stripHtml('<p><span class="h-card"><a href="x">@<span>marten</span></a></span> agreed &amp; done</p><p>two</p>'), '@marten agreed & done\ntwo');
});

test('time parsing', () => {
  assert.equal(twitterDateMs('Sun Mar 21 12:53:22 +0000 2021'), Date.UTC(2021, 2, 21, 12, 53, 22));
  assert.equal(twitterDateMs('Wed Oct 10 20:19:24 +0200 2018'), Date.UTC(2018, 9, 10, 18, 19, 24));
  assert.ok(Number.isNaN(twitterDateMs('nope')));
  assert.equal(isoMs('2022-01-27T15:58:52.744Z'), Date.UTC(2022, 0, 27, 15, 58, 52, 744));
  assert.ok(Number.isNaN(isoMs('2022-01-27 15:58:52')));
  assert.equal(isoUtcMs('2022-01-27 15:58:52'), Date.UTC(2022, 0, 27, 15, 58, 52));
  // Twitter's own doc example: id 1212092628029698048 was created 2019-12-31T19:26:16.000Z? Verify via formula independently:
  assert.equal(snowflakeMs('1212092628029698048', X_EPOCH), Number((1212092628029698048n >> 22n) + 1288834974657n));
  // Discord docs example: 175928847299117063 -> 2016-04-30 11:18:25.796 UTC
  assert.equal(snowflakeMs('175928847299117063', DISCORD_EPOCH), Date.UTC(2016, 3, 30, 11, 18, 25, 796));
  // Zones: New York EDT (-4h) and EST (-5h); DST gap (2:30 on 2024-03-10 does not exist) and overlap (1:30 on 2024-11-03 twice).
  assert.equal(zonedToUtc(2024, 7, 1, 12, 0, 0, 0, 'America/New_York'), Date.UTC(2024, 6, 1, 16));
  assert.equal(zonedToUtc(2024, 1, 1, 12, 0, 0, 0, 'America/New_York'), Date.UTC(2024, 0, 1, 17));
  assert.equal(zonedToUtc(2024, 11, 3, 1, 30, 0, 0, 'America/New_York'), Date.UTC(2024, 10, 3, 5, 30));
  assert.equal(zonedToUtc(2024, 1, 1, 12, 0, 0, 0, 'Asia/Kolkata'), Date.UTC(2024, 0, 1, 6, 30));
  assert.equal(zonedToUtc(2024, 1, 1, 12, 0, 0, 0, 'unknown'), Date.UTC(2024, 0, 1, 12));
  assert.equal(tzOffsetMs(Date.UTC(2024, 6, 1), 'Europe/Berlin'), 2 * 3600000);
});
