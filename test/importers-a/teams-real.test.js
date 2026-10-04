// Microsoft Teams data as it really comes (fixtures and their sources:
// test/fixtures/importers-a/teams/real-structure/README.md), run through the
// real import pipeline: detection, planning, importer, report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, openAsBlob } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSet } from '../../src/core/fileset.js';
import { runImport } from '../../src/core/pipeline.js';
import { fixture, events, node, ctx, countBy, warning } from './helpers.js';

const REAL = (...p) => fixture('teams', 'real-structure', ...p);
const ANA = 'teams:3c9f1a2e-5b7d-4e8a-9c1f-2d3e4f5a6b7c';
const BEN = 'teams:7d2e4f6a-8b1c-4d3e-a5f7-9b0c1d2e3f4a';
const CHEN = 'teams:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DANA = 'teams:e9f8a7b6-c5d4-4e3f-a2b1-c0d9e8f7a6b5';
const GROUP = 'teams:19:5a1c9e7b3d2f4a6c8e0b1d3f5a7c9e1b@thread.v2';
const ONE = 'teams:19:3c9f1a2e-5b7d-4e8a-9c1f-2d3e4f5a6b7c_7d2e4f6a-8b1c-4d3e-a5f7-9b0c1d2e3f4a@unq.gbl.spaces';
const MEET = 'teams:19:meeting_ZmljdGlvbmFsLW1lZXRpbmctMDAwMS1hYmNkZWY0NTY3ODk@thread.v2';
const TEAM = 'c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f';
const GENERAL = `teams:${TEAM}/19:0f1e2d3c4b5a69788796a5b4c3d2e1f0@thread.tacv2`;
const LEADS = `teams:${TEAM}/19:9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b@thread.tacv2`;

async function pipe(input) {
  const fs = input instanceof FileSet ? input : await FileSet.fromPaths([].concat(input));
  const r = await runImport(fs);
  const source = r.dataset.meta.sources[0];
  return { ...r, ds: r.dataset, source, rep: r.report.sources[0], ev: events(r.dataset) };
}
const byKey = (ev, k) => ev.find(e => e.key === k);

test('Graph: /me/chats?$expand=members plus message pages (array of pages, delta page)', async () => {
  const { detections, plan, unclaimed, ds, source, rep, ev } = await pipe(REAL('graph-me'));
  assert.equal(detections[0].id, 'teams');
  assert.deepEqual(plan.map(p => [p.id, p.files.length]), [['teams', 4]]);
  assert.deepEqual(unclaimed, []);
  assert.deepEqual(countBy(ev, e => e.type), { message: 10, reaction: 2 });
  // Every message in the files is accounted for: 10 kept + 4 system events
  // (systemEventMessage and unknownFutureValue, from: null).
  assert.equal(source.counts['system-events-skipped'], 4);
  assert.equal(source.counts['deleted-messages'], 1);
  assert.equal(source.counts['bot-messages'], 1);
  assert.equal(source.counts['broadcast-mentions'], 1); // the "everyone" (chat) mention
  assert.equal(rep.counts.messages, 10);

  assert.equal(ctx(ds, GROUP).name, 'Launch crew');
  assert.equal(ctx(ds, GROUP).members.length, 4);
  assert.equal(ctx(ds, ONE).visibility, 'direct');
  assert.equal(ctx(ds, MEET).kind, 'meeting');
  assert.equal(warning(source, 'teams-members-inferred'), null);
  assert.equal(warning(source, 'teams-chat-type-inferred'), null);

  const g = byKey(ev, `${GROUP}:1709551234567`);
  assert.equal(g.t, Date.UTC(2024, 2, 4, 11, 20, 34, 567));
  assert.equal(g.text, 'Thanks @Ben Okafor, merging now & @Launch crew please review');
  assert.deepEqual(g.targets.filter(t => t[1] === 'mention'), [[BEN, 'mention']]);
  const reacts = ev.filter(e => e.type === 'reaction');
  assert.deepEqual(reacts.map(e => [e.actor, e.text, e.parent === g.i]).sort(), [[BEN, '💯', true], [CHEN, 'like', true]]);
  // Reply with quote (messageReference): a reply tie to the quoted author and a parent link.
  const q = byKey(ev, `${GROUP}:1709560800000`);
  assert.equal(q.text, 'Agreed, shipping Friday.');
  assert.ok(q.targets.some(([n, r]) => n === ANA && r === 'reply'));
  assert.equal(q.parent, g.i);
  assert.equal(source.counts['quoted-replies'], 1);
  // External (federated) member and a meeting guest.
  assert.equal(node(ds, DANA).attrs.external, true);
  assert.equal(node(ds, DANA).attrs.email, 'dana.park@fabrikam.example');
  assert.equal(node(ds, 'teams:5f4e3d2c1b0a99887766554433221100').label, 'Alex (Guest)');
  assert.equal(node(ds, 'teams:app:28b7c6d5-e4f3-4a2b-9c1d-0e9f8a7b6c5d').isBot, true);
  // Entities decoded (&#8212; &nbsp;).
  assert.equal(byKey(ev, `${GROUP}:1709557200000`).text, 'Hi all — glad to help from Fabrikam.');
  // Two people are in every chat, so whose dump this is cannot be told; it says so.
  assert.equal(source.view, 'ego');
  assert.ok(warning(source, 'teams-ego-unknown'));
});

test('Graph: channel roots with $expand=replies, a /replies page, and the channel list', async () => {
  const { plan, unclaimed, ds, source, ev } = await pipe(REAL('graph-channel'));
  assert.deepEqual(unclaimed, []); // channels.json (no @odata.context) is read
  assert.equal(plan[0].files.length, 4);
  assert.deepEqual(countBy(ev, e => e.type), { message: 6, reaction: 1 });
  assert.equal(source.counts['system-events-skipped'], 1);
  // Nested replies are messages with reply ties to the root's author.
  const root = byKey(ev, `${GENERAL}:1709800000000`);
  const r1 = byKey(ev, `${GENERAL}:1709800100000`), r2 = byKey(ev, `${GENERAL}:1709800200000`);
  assert.deepEqual(r1.targets, [[ANA, 'reply']]);
  assert.equal(r1.parent, root.i);
  assert.deepEqual(r2.targets, [[ANA, 'reply'], [ANA, 'mention']]);
  assert.equal(ev.find(e => e.type === 'reaction').actor, ANA);
  // Channel and team mentions are broadcasts, not ties.
  assert.equal(source.counts['broadcast-mentions'], 2);
  assert.deepEqual(root.targets, []);
  // Privacy from the channel list.
  assert.equal(ctx(ds, GENERAL).visibility, 'public');
  assert.equal(ctx(ds, GENERAL).name, 'General');
  assert.equal(ctx(ds, LEADS).visibility, 'private');
  assert.equal(warning(source, 'teams-channel-visibility-unknown'), null);
  assert.deepEqual(byKey(ev, `${LEADS}:1709900300000`).targets, [[CHEN, 'reply']]);
  assert.equal(source.view, 'full');
});

test('Graph: Export API getAllMessages from two custodians (duplicates, 1:1 members from the chat id)', async () => {
  const { source, ev, ds } = await pipe(REAL('graph-getall'));
  assert.equal(ev.length, 3);
  assert.equal(source.counts['duplicates-skipped'], 2);
  assert.equal(source.counts['members-from-chat-id'], 2);
  assert.equal(warning(source, 'teams-members-inferred'), null);
  // Chen's message to Ben: Ben never wrote in that chat, but the chat id names him.
  const lunch = ev.find(e => e.text === 'Lunch?');
  assert.deepEqual(lunch.targets, [[BEN, 'dm']]);
  assert.equal(node(ds, CHEN).label, 'Chen Li');
});

test('Graph: a trimmed page whose messages name their chat only in @odata.context', async () => {
  const { source, ev, ds } = await pipe(REAL('graph-minimal'));
  assert.equal(ev.length, 2);
  assert.equal(source.counts['conversation-from-page-context'], 2);
  assert.equal(warning(source, 'teams-no-conversation'), null);
  assert.ok(ev.every(e => e.context === MEET));
  assert.equal(ctx(ds, MEET).kind, 'meeting');
  assert.deepEqual(ev[0].targets, [[ANA, 'dm']]);
});

test('Graph: one file per message (teams-chats-export layout)', async () => {
  const { detections, ds, ev, source } = await pipe(REAL('graph-per-message'));
  assert.equal(detections[0].id, 'teams');
  assert.equal(ev.length, 3);
  assert.equal(ctx(ds, GROUP).name, 'Launch crew');
  assert.equal(ctx(ds, GROUP).members.length, 3);
  assert.equal(warning(source, 'teams-members-inferred'), null);
});

test('Graph: more than 400 message files in several chat folders are all claimed and read', async () => {
  const items = [];
  const chats = ['19_aaaa_thread.v2', '19_bbbb_thread.v2', '19_cccc_thread.v2'];
  let k = 0;
  for (const c of chats) {
    for (let i = 0; i < 180; i++, k++) {
      const id = String(1709546400000 + k * 1000);
      const user = [ANA, BEN, CHEN][k % 3].slice(6);
      items.push({ path: `archive/data/${c}/msg_${id}.json`, blob: new Blob([JSON.stringify({ id, replyToId: null, messageType: 'message', createdDateTime: new Date(+id).toISOString(), chatId: c.replace(/_thread/, '@thread').replace(/^19_/, '19:'), from: { application: null, device: null, user: { id: user, displayName: null, userIdentityType: 'aadUser' } }, body: { contentType: 'text', content: 'm' + k } }, null, 2)]) });
    }
  }
  items.push({ path: 'archive/data/19_cccc_thread.v2/hosted.png', blob: new Blob([new Uint8Array(8)]) });
  const fs = await FileSet.from(items);
  const { plan, unclaimed, source } = await pipe(fs);
  assert.equal(plan[0].files.length, 540);
  assert.deepEqual(unclaimed, ['data/19_cccc_thread.v2/hosted.png']);
  assert.equal(source.counts.messages, 540);
});

test('Graph PowerShell: Get-MgChat / Get-MgChatMessage | ConvertTo-Json (PascalCase, AdditionalProperties)', async () => {
  const { detections, ds, ev, source } = await pipe(REAL('graph-powershell'));
  assert.equal(detections[0].id, 'teams');
  assert.deepEqual(countBy(ev, e => e.type), { message: 3, reaction: 1 });
  assert.equal(source.counts['system-events-skipped'], 1);
  assert.equal(ctx(ds, GROUP).name, 'Launch crew');
  assert.equal(ctx(ds, GROUP).members.length, 3);
  assert.equal(node(ds, ANA).attrs.email, 'ana.ruiz@contoso.example'); // from Members[].AdditionalProperties
  const thanks = byKey(ev, `${GROUP}:1709551234567`);
  assert.equal(thanks.text, 'Thanks @Ben Okafor');
  assert.ok(thanks.targets.some(([n, r]) => n === BEN && r === 'mention'));
  assert.equal(thanks.t, Date.UTC(2024, 2, 4, 11, 20, 34, 567));
});

test('Graph PowerShell 5.1 output: UTF-16 with BOM, enums as numbers, /Date(ms)/ dates', async () => {
  const m = (id, user, type) => ({ Id: id, ChatId: '19:abc@thread.v2', MessageType: type, CreatedDateTime: `/Date(${id})/`, Body: { Content: 'hi ' + id, ContentType: 0, AdditionalProperties: {} }, From: user ? { User: { Id: user, DisplayName: 'U' + user, UserIdentityType: 0, AdditionalProperties: {} }, AdditionalProperties: {} } : null, Mentions: [], Reactions: [], Attachments: [], AdditionalProperties: {} });
  const json = JSON.stringify([m('1709546400000', 'u1', 0), m('1709546460000', 'u2', 0), m('1709546520000', null, 4)], null, 2);
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')]);
  const fs = await FileSet.from([{ blob: new Blob([bytes]), path: 'mychats20240305.json' }]);
  const { detections, ev, source } = await pipe(fs);
  assert.equal(detections[0].id, 'teams');
  assert.equal(ev.length, 2);
  assert.equal(ev[0].t, 1709546400000);
  assert.equal(ev[0].text, 'hi 1709546400000');
  assert.deepEqual(ev[0].targets, [['teams:u2', 'dm']]);
  assert.equal(source.counts['system-events-skipped'], 1);
});

// The Teams Free download is a .tar named after the account; build one the way
// python's tarfile does (an independent tar writer) around the fixture.
const tdir = mkdtempSync(join(tmpdir(), 'osa-teams-real-'));
const TAR = join(tdir, '8_live_cid.0123456789abcdef_export.tar');
execFileSync('python3', ['-c', `
import tarfile, io, sys
out, msgs = sys.argv[1], sys.argv[2]
with tarfile.open(out, 'w', format=tarfile.PAX_FORMAT) as t:
    def add(n, b):
        ti = tarfile.TarInfo(n); ti.size = len(b); t.addfile(ti, io.BytesIO(b))
    add('messages.json', open(msgs, 'rb').read())
    add('media/0-weu-d3-fictional.json', b'{"filename":"menu.pdf"}')
    add('media/0-weu-d3-fictional.pdf', b'%PDF-1.4' * 64)
    add('skype-parser/index.html', b'<html></html>')
`, TAR, REAL('free', 'messages.json')]);

test('Teams Free export .tar: special lists, bots, member objects, quotes, mentions, reactions', async () => {
  const fs = await FileSet.from([{ blob: await openAsBlob(TAR), path: '8_live_cid.0123456789abcdef_export.tar' }]);
  const { detections, ds, source, ev, rep } = await pipe(fs);
  assert.equal(detections[0].id, 'teams');
  assert.equal(source.variant, 'teams-free');
  const OWNER = 'teams:8:live:.cid.0123456789abcdef', BEA = 'teams:8:live:.cid.b0b1b2b3b4b5b6b7', CAL = 'teams:8:live:cal.morgan', DEV = 'teams:8:live:.cid.d0d1d2d3d4d5d6d7';
  const BOT = 'teams:28:0d5d6cea-3e5f-4c7b-8a2e-1f2e3d4c5b6a';
  assert.equal(source.egoKey, OWNER);
  // 15 entries in MessageList outside the 48: lists: 10 messages + 5 system/call/poll entries.
  assert.equal(rep.counts.messages, 10);
  assert.equal(source.counts['system-events-skipped'], 5);
  assert.equal(warning(source, 'teams-free-special-lists').count, 2); // 48:calllogs, 48:notes
  assert.ok(!ds.contexts.keys.some(k => k.startsWith('teams:48:')));
  // 28: is a 1:1 chat with a bot.
  assert.equal(ctx(ds, BOT).visibility, 'direct');
  assert.equal(node(ds, BOT).isBot, true);
  // Members given as [{ MemberMri }].
  assert.equal(ctx(ds, 'teams:19:7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d@thread.v2').members.length, 3);
  assert.equal(warning(source, 'teams-members-inferred'), null);
  // Quote: the quoted text is not repeated; the parent is the quoted message.
  const reply = byKey(ev, `teams:${BEA.slice(6)}:1782900060000`);
  assert.equal(reply.text, 'Yes! Of course');
  assert.equal(reply.parent, byKey(ev, `teams:${BEA.slice(6)}:1782900000000`).i);
  assert.equal(reply.actor, OWNER); // sender given as a contacts URL
  // Mention in a group chat.
  const chap = ev.find(e => /^Chapter 3/.test(e.text || ''));
  assert.ok(chap.targets.some(([n, r]) => n === DEV && r === 'mention'));
  // Reactions from properties.emotions (array and JSON-string forms).
  const reacts = ev.filter(e => e.type === 'reaction');
  assert.deepEqual(reacts.map(e => [e.actor, e.targets[0][0], e.text]).sort(), [[OWNER, BEA, 'heart'], [OWNER, DEV, 'like'], [CAL, DEV, 'like']]);
  assert.equal(reacts.find(e => e.text === 'heart').t, 1782900510000);
  assert.equal(source.counts['deleted-messages'], 1);
  assert.equal(node(ds, BEA).label, 'Bea Stone');
});

test('Purview (new experience) items report with display-name headers', async () => {
  const { detections, plan, ds, source, ev, rep, unclaimed } = await pipe(REAL('purview-new'));
  assert.equal(detections[0].id, 'teams'); // not the edge-list reader ("Sender", "To")
  assert.deepEqual(plan.map(p => p.id), ['teams']);
  assert.equal(unclaimed.length, 1); // Summary_*.csv
  assert.equal(source.variant, 'purview');
  assert.equal(ev.length, 2);
  assert.ok(ev.every(e => e.type === 'copresence'));
  assert.equal(source.counts['duplicates-skipped'], 1);
  assert.equal(source.counts['non-teams-items-skipped'], 1);
  assert.equal(ev[0].t, Date.UTC(2024, 2, 5, 11));
  const chan = ev.find(e => e.context === 'teams:purview:b4d5f6a7-1c2d-4e3f-8a4b-6c7d8e9f0a11');
  assert.equal(ctx(ds, chan.context).name, 'General');
  assert.equal(ctx(ds, chan.context).kind, 'channel');
  assert.deepEqual(chan.targets.map(t => t[0]).sort(), ['teams:ana.ruiz@contoso.example', 'teams:chen.li@contoso.example']);
  assert.ok(rep.cannotShow.some(l => /Purview item report lists the participants/.test(l)));
});
