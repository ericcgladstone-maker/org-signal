import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsNode from 'node:fs';
import imessage, { appleDateMs, normalizeHandle, stripAssociatedGuid, parseExporterTxt } from '../../src/importers/imessage.js';
import { decodeAttributedBody } from '../../src/importers/lib/typedstream.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes, fixture } from './helpers.js';

// Fixtures: test/fixtures/importers-b/imessage/make_fixture.py builds chat.db and
// wal/chat.db with python's sqlite3 using the schema in docs/formats/imessage.md.

const APPLE = 978307200; // spec: seconds from 1970-01-01 to 2001-01-01

// typedstream built independently of the decoder, exactly as the spec describes:
// header, NSString marker, a few bytes, '+', length (1 byte < 0x81 | 0x81 u16 LE | 0x82 u32 LE), UTF-8.
function blob(text, { lenMode } = {}) {
  const body = new TextEncoder().encode(text);
  const n = body.length;
  let ln;
  if (lenMode === 0x82 || n > 0xffff) ln = [0x82, n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  else if (lenMode === 0x81 || n >= 0x81) ln = [0x81, n & 255, (n >> 8) & 255];
  else ln = [n];
  const enc = s => [...new TextEncoder().encode(s)];
  return Uint8Array.from([0x04, 0x0b, ...enc('streamtyped'), 0x81, 0xe8, 0x03, 0x84, 0x01, 0x40, 0x84, 0x84, 0x84, 0x12, ...enc('NSAttributedString'), 0x00,
    0x84, 0x84, 0x08, ...enc('NSObject'), 0x00, 0x85, 0x92, 0x84, 0x84, 0x84, 0x08, ...enc('NSString'), 0x01, 0x94, 0x84, 0x01, 0x2b, ...ln, ...body, 0x86, 0x84]);
}

test('attributedBody typedstream decoder: short, 0x81 and 0x82 lengths, multibyte, malformed', () => {
  assert.equal(decodeAttributedBody(blob('hello back')), 'hello back');
  const long = 'y'.repeat(300);
  assert.equal(decodeAttributedBody(blob(long)), long);
  assert.equal(decodeAttributedBody(blob('short', { lenMode: 0x81 })), 'short');
  assert.equal(decodeAttributedBody(blob('wide', { lenMode: 0x82 })), 'wide');
  assert.equal(decodeAttributedBody(blob('café \u{1F44D}')), 'café \u{1F44D}');
  assert.equal(decodeAttributedBody(new Uint8Array([1, 2, 3])), null);
  const b = blob('truncated text');
  assert.equal(decodeAttributedBody(b.subarray(0, b.length - 10)), null);
  assert.equal(decodeAttributedBody(null), null);
});

test('Apple epoch: nanoseconds and seconds, 0 is unknown', () => {
  const secs = Date.UTC(2023, 0, 1, 12) / 1000 - APPLE;
  assert.equal(appleDateMs(secs), (secs + APPLE) * 1000);
  assert.equal(appleDateMs(secs * 1e9), Date.UTC(2023, 0, 1, 12));
  assert.equal(appleDateMs(Date.UTC(2015, 5, 1, 8) / 1000 - APPLE), Date.UTC(2015, 5, 1, 8));
  assert.ok(Number.isNaN(appleDateMs(0)));
  assert.ok(Number.isNaN(appleDateMs(null)));
});

test('handle normalisation and associated guid prefixes', () => {
  assert.deepEqual(normalizeHandle('+1 (555) 555-0199'), { key: 'imessage:+15555550199', kind: 'phone', value: '+15555550199' });
  assert.deepEqual(normalizeHandle('Ann.Example@Example.com'), { key: 'imessage:ann.example@example.com', kind: 'email', value: 'ann.example@example.com' });
  assert.equal(stripAssociatedGuid('p:0/ABC-123'), 'ABC-123');
  assert.equal(stripAssociatedGuid('bp:ABC-123'), 'ABC-123');
  assert.equal(stripAssociatedGuid('ABC-123'), 'ABC-123');
});

test('detects chat.db by SQLite magic and Messages tables; ignores other SQLite and text', async () => {
  const d = await imessage.detect(await fsFromFixtures('imessage/chat.db'));
  assert.ok(d.score >= 0.9, d.reason);
  const other = await fsFromMemory({ 'notes.db': 'SQLite format 3\u0000 CREATE TABLE notes(a)' });
  assert.equal((await imessage.detect(other)).score, 0);
  const plain = await fsFromMemory({ 'readme.txt': 'hello\nworld\n' });
  assert.equal((await imessage.detect(plain)).score, 0);
  const wa = await fsFromMemory({ 'chat.txt': '12/03/2024, 09:15 - Ann: hi\n' });
  assert.equal((await imessage.detect(wa)).score, 0);
});

test('chat.db import: ego view, dm vs group, dates, attributedBody, tapbacks, replies, group actions', async () => {
  const { ds } = await runImport(imessage, await fsFromFixtures('imessage/chat.db'));
  const s = source(ds);
  assert.equal(s.view, 'ego');
  assert.equal(s.tz, 'UTC');
  assert.equal(s.egoKey, 'imessage:me');
  assert.equal(s.medium, 'imessage');
  assert.deepEqual(ds.nodes.keys.slice().sort(), ['imessage:+15555550123', 'imessage:+15555550199', 'imessage:ann.example@example.com', 'imessage:me']);
  assert.equal(node(ds, 'imessage:me').platformIds.own_handles, 'me@example.com');
  assert.equal(node(ds, 'imessage:+15555550199').label, '+1 (555) 555-0199');
  assert.equal(node(ds, 'imessage:+15555550123').platformIds.apple_person, 'PC-1');

  // iMessage and SMS 1:1 chats with the same number merge into one dm context.
  const dm = context(ds, 'imessage:dm:+15555550123');
  assert.equal(dm.kind, 'dm');
  assert.equal(dm.visibility, 'direct');
  const grp = context(ds, 'imessage:group_dm:iMessage;+;chat123456789');
  assert.equal(grp.visibility, 'group');
  assert.equal(grp.name, 'Trail Crew');
  assert.equal(grp.members.length, 4);
  assert.equal(ds.contexts.count, 2);

  const ev = events(ds);
  const sum = ev.map(e => [e.type, e.actor, e.targets, e.context === 'imessage:dm:+15555550123' ? 'dm' : 'group', e.text]);
  const P1 = 'imessage:+15555550123', ANN = 'imessage:ann.example@example.com', P3 = 'imessage:+15555550199', ME = 'imessage:me';
  assert.deepEqual(sum, [
    ['message', P1, [[ME, 'dm']], 'dm', 'no date'],
    ['message', ME, [[P1, 'dm']], 'dm', 'old sms'],
    ['message', ME, [[P1, 'dm']], 'dm', 'hi there'],
    ['message', P1, [[ME, 'dm']], 'dm', 'hello back'],
    ['reaction', P1, [[ME, 'subject']], 'dm', 'loved'],
    ['join', P3, [], 'group', null],
    ['message', ANN, [], 'group', 'group hello'],
    ['message', ME, [[ANN, 'reply']], 'group', 'reply in thread'],
    ['leave', P3, [], 'group', null],
    ['message', ANN, [], 'group', 'Long note ' + 'x'.repeat(190)],
    ['message', P1, [], 'group', 'café \u2603 \u{1F44D}'],
    ['reaction', P1, [[ANN, 'subject']], 'group', 'laughed'],
    ['leave', P3, [], 'group', null],
  ]);
  assert.ok(Number.isNaN(ev[0].t));
  assert.equal(ev[1].t, Date.UTC(2015, 5, 1, 8, 0, 0)); // seconds-based row
  assert.equal(ev[2].t, Date.UTC(2023, 0, 1, 12, 0, 0)); // nanosecond row
  assert.equal(ev[3].t, Date.UTC(2023, 0, 1, 12, 1, 30));
  assert.equal(ev[4].parent, 2); // tapback 'p:0/M1' resolved to M1
  assert.equal(ev[7].parent, 6); // thread_originator_guid M5
  assert.equal(ev[11].parent, 6); // 'p:0/M5'
  assert.equal(ev[5].t, Date.UTC(2023, 1, 1, 8));

  assert.equal(s.counts.messages, 8);
  assert.equal(s.counts.reactions, 2);
  assert.equal(s.counts['tapbacks-removed'], 1);
  assert.equal(s.counts['tapbacks-cancelled'], 1); // like added then removed by the same person
  assert.equal(s.counts.joins, 1);
  assert.equal(s.counts.leaves, 2);
  assert.equal(s.counts.renames, 1);
  assert.equal(s.counts['attributed-body-decoded'], 3);
  assert.equal(s.counts.replies, 1);
  const codes = warningCodes(ds);
  assert.ok(codes.includes('orphaned-messages'));
  assert.equal(s.warnings.find(w => w.code === 'orphaned-messages').count, 1);
  assert.ok(codes.includes('missing-date'));
  assert.ok(!codes.includes('wal-mode-copy'));
  assert.ok(!codes.includes('unresolved-parent'));
});

test('WAL-mode database opens and warns with .backup instructions; a -wal sidecar gets a stronger warning', async () => {
  const header = fsNode.readFileSync(fixture('imessage/wal/chat.db')).subarray(18, 20);
  assert.deepEqual([...header], [2, 2]);
  const { ds } = await runImport(imessage, await fsFromFixtures('imessage/wal/chat.db'));
  assert.equal(source(ds).counts.messages, 8);
  const w = source(ds).warnings.find(x => x.code === 'wal-mode-copy');
  assert.ok(w && w.message.includes('.backup'));

  const bytes = fsNode.readFileSync(fixture('imessage/wal/chat.db'));
  const fs2 = await fsFromMemory({ 'Messages/chat.db': bytes, 'Messages/chat.db-wal': new Uint8Array(32) });
  const r2 = await runImport(imessage, fs2);
  assert.ok(warningCodes(r2.ds).includes('wal-not-applied'));
  assert.ok(r2.ds.meta.sources[0].warnings.find(x => x.code === 'wal-not-applied').message.includes('sqlite3 ~/Library/Messages/chat.db ".backup'));
});

test('imessage-exporter TXT parser: double-space hours, read suffix, announcements, tapbacks, reply marker', () => {
  const blocks = parseExporterTxt(fsNode.readFileSync(fixture('imessage/txt/Trail Crew - 3.txt'), 'utf8'));
  assert.equal(blocks.length, 7); // includes the indented duplicate
  assert.deepEqual(blocks[0], { kind: 'message', wall: [2022, 5, 17, 17, 29, 42], sender: 'Me', lines: ['Can you send the Q3 deck?'], reply: false, tapbacks: [] });
  assert.equal(blocks[2].reply, true);
  assert.deepEqual(blocks[3], { kind: 'announcement', wall: [2022, 5, 17, 18, 3, 0], text: 'Lena Whitford added Raj Patel to the conversation.' });
  assert.deepEqual(blocks[4].lines, ['Thanks both', 'Liked by everyone, he said', '', 'really']);
  assert.deepEqual(blocks[4].tapbacks, [{ name: 'loved', who: 'Lena Whitford' }]);
  assert.deepEqual(blocks[5].wall, [2022, 5, 18, 0, 0, 5]); // 12 AM
  assert.deepEqual(blocks[6].wall, [2022, 5, 18, 12, 30, 0]); // 12 PM
});

test('TXT import: dedupes thread replies, infers group vs direct, applies time zone', async () => {
  const { det, ds } = await runImport(imessage, await fsFromFixtures('imessage/txt'), { timezone: 'America/New_York' });
  assert.ok(det.score >= 0.85);
  const s = source(ds);
  assert.equal(s.tz, 'America/New_York');
  assert.equal(s.view, 'ego');
  assert.ok(!warningCodes(ds).includes('timezone-unknown'));
  assert.equal(s.counts['duplicate-thread-replies'], 1);
  assert.equal(s.warnings.find(w => w.code === 'identity-by-name').count, 2);
  assert.ok(warningCodes(ds).includes('reply-parent-unknown'));

  const ev = events(ds);
  const g = ev.filter(e => e.context === 'imessage:group_dm:txt/Trail Crew');
  assert.equal(context(ds, 'imessage:group_dm:txt/Trail Crew').visibility, 'group');
  assert.deepEqual(g.map(e => [e.type, e.actor, e.targets]), [
    ['message', 'imessage:me', []],
    ['message', 'imessage:name:lena whitford', []],
    ['join', 'imessage:name:raj patel', []],
    ['message', 'imessage:name:raj patel', []],
    ['reaction', 'imessage:name:lena whitford', [['imessage:name:raj patel', 'subject']]],
    ['message', 'imessage:lena@example.com', []],
    ['leave', 'imessage:name:raj patel', []],
  ]);
  assert.equal(g[0].t, Date.UTC(2022, 4, 17, 21, 29, 42)); // 5:29:42 PM EDT
  assert.equal(g[5].t, Date.UTC(2022, 4, 18, 4, 0, 5));
  assert.equal(g[4].parent, g[3].i);
  assert.equal(g[3].text, 'Thanks both\nLiked by everyone, he said\n\nreally');

  const d = ev.filter(e => e.context === 'imessage:dm:txt/+15555550199');
  assert.equal(context(ds, 'imessage:dm:txt/+15555550199').visibility, 'direct');
  assert.deepEqual(d.map(e => [e.actor, e.targets, e.text]), [
    ['imessage:+15555550199', [['imessage:me', 'dm']], 'Hey'],
    ['imessage:me', [['imessage:+15555550199', 'dm']], 'Hi\nEdited 10 seconds later: Hi!'],
  ]);
  assert.equal(d[0].t, Date.UTC(2023, 0, 5, 13, 0, 0)); // EST

  const o = ev.filter(e => e.context === 'imessage:chat:txt/orphaned');
  assert.equal(o.length, 1);
  assert.deepEqual(o[0].targets, []);
});

test('TXT import without a time zone reads wall clock as UTC and warns', async () => {
  const { ds } = await runImport(imessage, await fsFromFixtures('imessage/txt'));
  assert.equal(source(ds).tz, 'unknown');
  assert.ok(warningCodes(ds).includes('timezone-unknown'));
  const first = events(ds).find(e => e.text === 'Can you send the Q3 deck?');
  assert.equal(first.t, Date.UTC(2022, 4, 17, 17, 29, 42));
});
