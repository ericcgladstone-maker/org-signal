import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsNode from 'node:fs';
import telegram from '../../src/importers/telegram.js';
import { FileSet } from '../../src/core/fileset.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes, countBy, fixture } from './helpers.js';

const T0 = 1731571964 * 1000;
const EGO = 'telegram:user100000001', BEN = 'telegram:user100000002', CLEO = 'telegram:user100000003';

test('telegram: detects full and single-chat exports, rejects others', async () => {
  const full = await telegram.detect(await fsFromFixtures('telegram/DataExport_2026-10-02'));
  assert.ok(full.score >= 0.9, full.reason);
  const single = await telegram.detect(await fsFromFixtures('telegram/ChatExport_2026-10-02'));
  assert.ok(single.score >= 0.9, single.reason);
  assert.equal((await telegram.detect(await fsFromMemory({ 'result.json': '{"foo": 1}' }))).score, 0);
  assert.equal((await telegram.detect(await fsFromMemory({ 'other.json': '{"chats": {}}' }))).score, 0);
});

test('telegram: full export maps chats, replies, mentions, reactions, service events and frequent contacts', async () => {
  const { ds } = await runImport(telegram, await fsFromFixtures('telegram/DataExport_2026-10-02'));
  const src = source(ds);
  assert.equal(src.view, 'ego');
  assert.equal(src.egoKey, EGO);
  assert.equal(src.tz, 'UTC');
  assert.equal(src.medium, 'telegram');
  const evs = events(ds);
  assert.deepEqual(countBy(evs, e => e.type), { declared: 2, message: 9, reaction: 1, copresence: 1, join: 4, leave: 1 });
  assert.equal(src.counts.messages, 9);
  assert.equal(src.counts['unsupported-messages'], 1);
  assert.equal(src.counts['chats-excluded'], 1);

  // Ego and contacts
  assert.equal(node(ds, EGO).label, 'Ana Kovač');
  assert.equal(node(ds, EGO).platformIds.username, 'ana_k');
  assert.equal(node(ds, BEN).label, 'Ben Ito');
  assert.equal(node(ds, BEN).attrs.telegram_contact, true);

  // Frequent contacts: declared, weighted by rating, flagged
  const decl = evs.filter(e => e.type === 'declared');
  assert.deepEqual(decl.map(e => [e.actor, e.targets]), [[EGO, [[BEN, 'declared']]], [EGO, [[CLEO, 'declared']]]]);
  assert.ok(Math.abs(decl[0].weight - 0.83) < 1e-6);
  assert.ok(Number.isNaN(decl[0].t));
  assert.equal(node(ds, BEN).attrs.telegram_top_people_rating, 0.83);
  assert.ok(warningCodes(ds).includes('telegram-rating-weight'));

  // Direct chat
  const dm = context(ds, 'telegram:dm:100000002');
  assert.equal(dm.visibility, 'direct');
  assert.equal(dm.kind, 'dm');
  const m1 = evs.find(e => e.key === 'telegram:msg:chats:100000002:1');
  assert.equal(m1.t, T0);
  assert.equal(m1.actor, EGO);
  assert.equal(m1.text, 'Ping @ben_ito');
  assert.deepEqual(m1.targets, [[BEN, 'dm'], ['telegram:username:ben_ito', 'mention']]);
  const m2 = evs.find(e => e.key === 'telegram:msg:chats:100000002:2');
  assert.equal(m2.t, T0 + 60000);
  assert.deepEqual(m2.targets, [[EGO, 'dm'], [EGO, 'reply']]);
  assert.equal(m2.parent, m1.i);
  const r = evs.find(e => e.type === 'reaction');
  assert.equal(r.actor, EGO);
  assert.deepEqual(r.targets, [[BEN, 'subject']]);
  assert.equal(r.parent, m2.i);
  assert.equal(r.text, '\u{1F44D}');
  assert.ok(Number.isNaN(r.t));
  const call = evs.find(e => e.type === 'copresence');
  assert.deepEqual([call.actor, call.targets, call.t], [EGO, [[BEN, 'attendee']], T0 + 120000]);

  // Group
  const g = context(ds, 'telegram:group_dm:1234567890');
  assert.equal(g.visibility, 'group');
  assert.equal(g.name, 'Field Ops');
  const m11 = evs.find(e => e.key === 'telegram:msg:chats:1234567890:11');
  assert.deepEqual(m11.targets, [[BEN, 'mention']]); // mention_name carries the user id; no broadcast targets
  const m13 = evs.find(e => e.key === 'telegram:msg:chats:1234567890:13');
  assert.deepEqual(m13.targets, [[CLEO, 'reply']]);
  assert.equal(m13.parent, m11.i);
  assert.equal(evs.find(e => e.key === 'telegram:msg:chats:1234567890:15').text, 'rich hello');
  assert.equal(evs.find(e => e.key === 'telegram:msg:chats:1234567890:16').parent, -1);
  assert.equal(node(ds, 'telegram:user100000009').label, 'Deleted account');
  const m18 = evs.find(e => e.key === 'telegram:msg:chats:1234567890:18');
  assert.deepEqual(m18.targets, [[EGO, 'mention'], ['telegram:username:some_one', 'mention']]);
  const joins = evs.filter(e => e.type === 'join').map(e => [e.actor, e.targets]);
  assert.deepEqual(joins, [
    [EGO, []],
    [CLEO, [[EGO, 'subject']]],
    [BEN, [[CLEO, 'subject']]],
    ['telegram:name:dmitri volk', [[CLEO, 'subject']]],
  ]);
  const leave = evs.find(e => e.type === 'leave');
  assert.deepEqual([leave.actor, leave.targets, leave.t], [BEN, [], T0 + 1040000]);
  const members = new Set(g.members.map(i => ds.nodes.keys[i]));
  for (const k of [EGO, BEN, CLEO, 'telegram:name:dmitri volk']) assert.ok(members.has(k), k);

  // Left chats are imported; excluded types are not.
  assert.ok(context(ds, 'telegram:group_dm:555'));
  assert.equal(context(ds, 'telegram:channel:4444'), null);
  assert.equal(context(ds, 'telegram:dm:5555'), null);
  assert.equal(context(ds, 'telegram:dm:100000001'), null);

  const w = warningCodes(ds);
  for (const c of ['identity-by-name', 'mention-by-username', 'rich-message', 'cross-chat-reply', 'reactions-partial', 'reaction-time-unknown', 'channels-excluded', 'bot-chats-excluded', 'group-migrated']) assert.ok(w.includes(c), c);
  // Ids stay strings everywhere
  for (const k of ds.nodes.keys) assert.equal(typeof k, 'string');
});

test('telegram: options include channels and bot chats', async () => {
  const { ds } = await runImport(telegram, await fsFromFixtures('telegram/DataExport_2026-10-02'), { includeChannels: true, includeBotChats: true });
  assert.equal(context(ds, 'telegram:channel:4444').visibility, 'public');
  assert.ok(context(ds, 'telegram:dm:5555'));
  assert.equal(node(ds, 'telegram:user5555').isBot, true);
});

test('telegram: result is identical when the file arrives in tiny chunks (streaming)', async () => {
  const p = fixture('telegram/DataExport_2026-10-02/result.json');
  const bytes = fsNode.readFileSync(p);
  const entry = {
    path: 'DataExport_2026-10-02/result.json', size: bytes.length, isDir: false,
    stream: () => new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 5) c.enqueue(new Uint8Array(bytes.subarray(i, i + 5))); c.close(); } }),
    bytes: async () => new Uint8Array(bytes), text: async () => bytes.toString('utf8'),
  };
  const { ds: a } = await runImport(telegram, new FileSet([entry]));
  const { ds: b } = await runImport(telegram, await fsFromFixtures('telegram/DataExport_2026-10-02'));
  assert.deepEqual(events(a), events(b));
});

test('telegram: single-chat export infers ego from the personal chat and uses view chat', async () => {
  const { ds } = await runImport(telegram, await fsFromFixtures('telegram/ChatExport_2026-10-02'));
  const src = source(ds);
  assert.equal(src.view, 'chat');
  assert.equal(src.egoKey, EGO);
  const evs = events(ds);
  assert.equal(evs.length, 3);
  assert.deepEqual(evs.map(e => [e.actor, e.targets, e.t]), [
    [CLEO, [], T0],
    [EGO, [[CLEO, 'dm'], [CLEO, 'reply']], T0 + 5000],
    [CLEO, [[EGO, 'dm']], T0 + 9000],
  ]);
  assert.ok(warningCodes(ds).includes('dm-ego-unknown'));
});
