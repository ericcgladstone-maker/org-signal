import { test } from 'node:test';
import assert from 'node:assert/strict';
import discord, { parseDiscordTime, textMentions, channelTypeName } from '../../src/importers/discord.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes, countBy } from './helpers.js';

const EGO = 'discord:900000000000000001', NOVA = 'discord:900000000000000002', RIO = 'discord:900000000000000003', KAI = 'discord:900000000000000004';

test('time parsing covers every documented timestamp shape', () => {
  assert.equal(parseDiscordTime('2023-12-11 02:01:09'), Date.UTC(2023, 11, 11, 2, 1, 9)); // package JSON: no zone = UTC
  assert.equal(parseDiscordTime('2022-08-02 00:59:59.753000+00:00'), Date.UTC(2022, 7, 2, 0, 59, 59, 753)); // package CSV
  assert.equal(parseDiscordTime('2026-09-01T14:02:11.512+02:00'), Date.UTC(2026, 8, 1, 12, 2, 11, 512)); // DCE JSON
  assert.equal(parseDiscordTime('2026-09-03T10:00:00.1234567+02:00'), Date.UTC(2026, 8, 3, 8, 0, 0, 123)); // .NET "o"
  assert.ok(Number.isNaN(parseDiscordTime('')));
  assert.deepEqual(textMentions('a <@123456789012345678> b <@!223456789012345678> <@&323456789012345678> <#423456789012345678> <@123456789012345678>'), ['123456789012345678', '223456789012345678']);
  assert.equal(channelTypeName(1), 'DM');
  assert.equal(channelTypeName('3'), 'GROUP_DM');
  assert.equal(channelTypeName('GUILD_TEXT'), 'GUILD_TEXT');
  assert.equal(channelTypeName(12), 'PRIVATE_THREAD');
});

test('2025 package: c-prefix, messages.json with numeric 19-digit IDs, string types, Activity skipped', async () => {
  const fs = await fsFromFixtures('discord/pkg-2025');
  const { det, ds } = await runImport(discord, fs);
  assert.ok(det.score >= 0.9, det.reason);
  const s = source(ds);
  assert.equal(s.view, 'authored');
  assert.equal(s.egoKey, EGO);
  assert.equal(s.tz, 'UTC');
  assert.equal(s.counts.messages, 6);
  assert.equal(s.counts.channels, 5);
  assert.equal(s.counts.friends, 2); // type 2 (blocked) is not a friendship
  // PII from user.json is never retained
  assert.ok(!JSON.stringify(ds.nodes).includes('example.invalid'));
  assert.ok(!JSON.stringify(ds.meta).includes('203.0.113.9'));
  assert.equal(node(ds, EGO).label, 'Otter');

  const evs = events(ds);
  const msgs = evs.filter(e => e.type === 'message');
  assert.ok(msgs.every(e => e.actor === EGO));
  // Snowflake ids survive exactly (1180000000000000001 is not representable as a double).
  assert.notEqual(String(Number('1180000000000000001')), '1180000000000000001');
  const m1 = msgs.find(e => e.key === 'discord:msg:1180000000000000001');
  assert.ok(m1, 'exact 19-digit id kept');
  assert.equal(m1.t, Date.UTC(2023, 11, 11, 2, 1, 9));
  assert.deepEqual(m1.targets, [[NOVA, 'dm']]);
  assert.equal(m1.context, 'discord:dm:1100000000000000001');
  assert.equal(m1.visibility, 'direct');
  const m3 = msgs.find(e => e.key === 'discord:msg:1180000000000000003');
  assert.deepEqual(m3.targets, [[NOVA, 'dm'], [RIO, 'mention']]); // <@!id> legacy form

  const g = msgs.find(e => e.key === 'discord:msg:1180000000000000010');
  assert.deepEqual(g.targets, [[RIO, 'mention']]); // role and channel mentions ignored
  assert.equal(g.visibility, 'public');
  assert.equal(context(ds, 'discord:channel:1100000000000000002').name, 'general in Synthwave Club');
  // Missing timestamp: derived from the snowflake (Discord docs formula)
  const noTs = msgs.find(e => e.key === 'discord:msg:1180000000000000011');
  assert.equal(noTs.t, Number((1180000000000000011n >> 22n) + 1420070400000n));
  assert.ok(warningCodes(ds).includes('time-from-id'));

  const grp = msgs.find(e => e.key === 'discord:msg:1180000000000000020');
  assert.deepEqual(grp.targets, []);
  assert.equal(grp.visibility, 'group');
  assert.equal(context(ds, 'discord:group_dm:1100000000000000003').kind, 'group_dm');

  // DM lacking recipients resolved through index label "kai#1234" and relationships
  const k = msgs.find(e => e.key === 'discord:msg:1180000000000000030');
  assert.deepEqual(k.targets, [[KAI, 'dm']]);
  assert.equal(node(ds, KAI).label, 'kai#1234');
  assert.equal(node(ds, NOVA).label, 'nova_fox'); // '#0' discriminator dropped

  assert.equal(context(ds, 'discord:thread:1100000000000000005').visibility, 'private');
  const friends = evs.filter(e => e.type === 'declared');
  assert.deepEqual(friends.map(e => e.targets[0]), [[NOVA, 'declared'], [KAI, 'declared']]);
  assert.ok(friends.every(e => Number.isNaN(e.t)));
  assert.ok(warningCodes(ds).includes('outgoing-only'));
  assert.ok(ds.nodes.keys.every(k2 => typeof k2 === 'string'));
});

test('friends option off drops declared ties', async () => {
  const { ds } = await runImport(discord, await fsFromFixtures('discord/pkg-2025'), { friends: false });
  assert.equal(events(ds).filter(e => e.type === 'declared').length, 0);
});

test('2021 package: wrapper folder, lowercase, no c-prefix, CSV with CRLF multi-line, numeric types, localised account folder', async () => {
  const fs = await fsFromFixtures('discord/pkg-2021');
  const { det, ds } = await runImport(discord, fs);
  assert.ok(det.score >= 0.9);
  const s = source(ds);
  assert.equal(s.egoKey, EGO);
  assert.ok(!warningCodes(ds).includes('no-user-json'));
  assert.equal(s.counts.messages, 3);
  const msgs = events(ds);
  const a = msgs.find(e => e.key === 'discord:msg:950000000000000001');
  assert.equal(a.text, 'multi-line\r\nmessage');
  assert.equal(a.t, Date.UTC(2022, 2, 1, 18, 22, 10, 120));
  assert.deepEqual(a.targets, [[NOVA, 'dm']]); // "Deleted User" and ego dropped
  assert.ok(warningCodes(ds).includes('deleted-user'));
  const b = msgs.find(e => e.key === 'discord:msg:950000000000000002');
  assert.equal(b.t, Date.UTC(2022, 2, 1, 17, 0, 0)); // +02:00 honoured
  const c = msgs.find(e => e.key === 'discord:msg:950000000000000010');
  assert.deepEqual(c.targets, [[KAI, 'mention']]);
  assert.equal(c.context, 'discord:channel:1100000000000000102');
  assert.equal(node(ds, EGO).label, 'otter_ego#4321');
});

test('package without user.json infers the ego from DM recipients', async () => {
  const fs = await fsFromMemory({
    'Messages/index.json': '{"1100000000000000001":"Direct Message with nova_fox#0"}',
    'Messages/c1100000000000000001/channel.json': '{"id":"1100000000000000001","type":1,"recipients":["900000000000000001","900000000000000002"]}',
    'Messages/c1100000000000000001/messages.json': '[{"ID":1180000000000000001,"Timestamp":"2023-12-11 02:01:09","Contents":"x","Attachments":""}]',
    'Messages/c1100000000000000007/channel.json': '{"id":"1100000000000000007","type":1,"recipients":["900000000000000001","900000000000000004"]}',
    'Messages/c1100000000000000007/messages.json': '[]',
  });
  const { ds } = await runImport(discord, fs);
  assert.equal(source(ds).egoKey, EGO);
  assert.ok(warningCodes(ds).includes('no-user-json'));
  assert.deepEqual(events(ds)[0].targets, [[NOVA, 'dm']]);
});

test('DiscordChatExporter JSON: replies, reactions with reactors, bots, interactions, system kinds, offsets', async () => {
  const fs = await fsFromFixtures('discord/dce/Synthwave Club - Text Channels - general [1100000000000000002].json');
  const { det, ds } = await runImport(discord, fs);
  assert.ok(det.score >= 0.9);
  const s = source(ds);
  assert.equal(s.view, 'chat');
  assert.equal(s.tz, 'UTC');
  const evs = events(ds);
  const msgs = evs.filter(e => e.type === 'message');
  assert.equal(msgs.length, 6); // join and pin are not messages
  assert.equal(s.counts.joins, 1);
  assert.ok(warningCodes(ds).includes('system-messages-skipped'));

  const m1 = msgs.find(e => e.key === 'discord:msg:1200000000000000001');
  assert.equal(m1.t, Date.UTC(2026, 8, 1, 12, 0, 0));
  assert.equal(m1.visibility, 'public');
  assert.equal(m1.context, 'discord:channel:1100000000000000002');
  assert.equal(context(ds, 'discord:channel:1100000000000000002').name, 'general in Synthwave Club');

  const reply = msgs.find(e => e.key === 'discord:msg:1200000000000000002');
  assert.equal(reply.t, Date.UTC(2026, 8, 1, 12, 2, 11, 512));
  assert.equal(reply.actor, RIO);
  assert.deepEqual(reply.targets, [[NOVA, 'reply']]); // parent author also in mentions: deduped
  assert.equal(reply.parent, m1.i);

  const orphan = msgs.find(e => e.key === 'discord:msg:1200000000000000003');
  assert.deepEqual(orphan.targets, []);
  assert.ok(warningCodes(ds).includes('reply-parent-outside-export'));
  assert.ok(warningCodes(ds).includes('unresolved-parent'));

  const bot = msgs.find(e => e.key === 'discord:msg:1200000000000000006');
  assert.deepEqual(bot.targets, [[RIO, 'reply']]); // interaction.user is the human answered
  assert.equal(node(ds, 'discord:900000000000000099').isBot, true);
  const fwd = msgs.find(e => e.key === 'discord:msg:1200000000000000007');
  assert.equal(fwd.parent, -1); // forwards are not replies

  const reactions = evs.filter(e => e.type === 'reaction');
  assert.equal(reactions.length, 1);
  assert.equal(reactions[0].actor, RIO);
  assert.deepEqual(reactions[0].targets, [[NOVA, 'subject']]);
  assert.equal(reactions[0].parent, m1.i);
  assert.equal(reactions[0].t, m1.t);
  assert.equal(reactions[0].text, '\u{1F44D}');
  const codes = warningCodes(ds);
  for (const c of ['reaction-time-approximate', 'reactors-incomplete', 'exporter-local-time']) assert.ok(codes.includes(c), c);
  assert.equal(ds.meta.sources[0].warnings.find(w => w.code === 'reactors-incomplete').count, 1 + 3);

  const nova = node(ds, NOVA);
  assert.equal(nova.label, 'Nova');
  assert.equal(nova.attrs.roles, 'Mods');
  assert.equal(nova.platformIds.discord, '900000000000000002');
  assert.equal(msgs.find(e => e.key === 'discord:msg:1200000000000000008').text, 'été');
});

test('DCE folder: DM json gets dm targets, CSV imports sender/time only, one source per file', async () => {
  const { ds } = await runImport(discord, await fsFromFixtures('discord/dce'));
  assert.equal(ds.meta.sources.length, 3);
  const evs = events(ds);
  const dm = evs.filter(e => e.context === 'discord:dm:1100000000000000050');
  assert.equal(dm.length, 2);
  assert.deepEqual(dm.map(e => [e.actor, e.targets]), [[NOVA, [[RIO, 'dm']]], [RIO, [[NOVA, 'dm']]]]);
  assert.equal(dm[0].visibility, 'direct');
  assert.equal(dm[0].t, Date.UTC(2026, 8, 2, 9, 0, 0));
  const dmSrc = ds.meta.sources.find(s => s.fileNames[0].includes('rio.m'));
  assert.ok(!dmSrc.warnings.some(w => w.code === 'exporter-local-time')); // all +00:00
  const csv = evs.filter(e => e.context === 'discord:channel:1100000000000000060');
  assert.equal(csv.length, 2);
  assert.equal(csv[0].text, 'line one\r\nline two');
  assert.equal(csv[0].t, Date.UTC(2026, 8, 3, 8, 0, 0, 123));
  assert.equal(csv[1].actor, KAI);
  assert.deepEqual(csv[1].targets, []);
  const csvSrc = ds.meta.sources.find(s => s.fileNames[0].endsWith('.csv'));
  assert.ok(csvSrc.warnings.some(w => w.code === 'dce-csv-limited'));
  assert.equal(countBy(evs, e => e.type).message, 6 + 2 + 2);
});

test('DCE HTML is detected and refused with an explanation', async () => {
  const { det, ds } = await runImport(discord, await fsFromFixtures('discord/dce-html'));
  assert.ok(det.score >= 0.5);
  assert.equal(ds.events.count, 0);
  assert.ok(warningCodes(ds).includes('dce-html-unsupported'));
});

test('streamed DCE JSON keeps a bare-number 19-digit message id exact', async () => {
  const doc = '{"guild":{"id":"0","name":"Direct Messages"},"channel":{"id":"1100000000000000077","type":"GuildTextChat","name":"g"},"messages":[{"id":1234567890123456789,"type":"Default","timestamp":"2026-01-01T00:00:00+00:00","content":"x","author":{"id":900000000000000002,"name":"n","isBot":false},"reactions":[],"mentions":[]}]}';
  const { ds } = await runImport(discord, await fsFromMemory({ 'x.json': doc }));
  assert.equal(ds.events.keys[0], 'discord:msg:1234567890123456789');
  assert.equal(ds.nodes.keys[0], NOVA);
});

test('unrelated files are not claimed', async () => {
  const det = await discord.detect(await fsFromMemory({ 'a.json': '{"foo":1}', 'b.csv': 'id,name\n1,x\n', 'channel.json': '{"id":"1"}' }));
  assert.equal(det.score, 0);
});
