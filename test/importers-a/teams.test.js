import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, openAsBlob } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import teams, { tarEntries, parseGraphTime, parseParticipants } from '../../src/importers/teams.js';
import { DatasetBuilder } from '../../src/core/model.js';
import { FileSet } from '../../src/core/fileset.js';
import { runImporter, fixture, events, node, ctx, countBy, warning } from './helpers.js';

const ANA = 'teams:11111111-2222-3333-4444-555555555555';
const BEN = 'teams:66666666-7777-8888-9999-000000000000';
const CHEN = 'teams:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const GROUP = 'teams:19:aaaabbbbccccdddd0000111122223333@thread.v2';
const ONE = 'teams:19:11111111-2222-3333-4444-555555555555_66666666-7777-8888-9999-000000000000@unq.gbl.spaces';
const MEET = 'teams:19:meeting_NzQ1example@thread.v2';
const CHAN = 'teams:team-1/19:general@thread.tacv2';

test('teams: Graph JSON in every container shape', async () => {
  const { ds, source, detect } = await runImporter(teams, fixture('teams', 'graph'));
  assert.equal(detect.score, 0.9);
  assert.equal(detect.files.length, 7); // chats, members, 5 message files
  assert.equal(source.variant, 'graph');
  assert.equal(source.view, 'full'); // channel messages present
  assert.equal(source.tz, 'UTC');

  const ev = events(ds);
  assert.deepEqual(countBy(ev, e => e.type), { message: 10, reaction: 1 });
  assert.equal(source.counts['duplicates-skipped'], 1);
  assert.equal(source.counts['system-events-skipped'], 1);
  assert.equal(source.counts['bot-messages'], 1);
  assert.equal(source.counts['broadcast-mentions'], 1);

  // Contexts and visibility from chats.json chatType.
  assert.equal(ctx(ds, GROUP).visibility, 'group');
  assert.equal(ctx(ds, GROUP).kind, 'group_dm');
  assert.equal(ctx(ds, GROUP).name, 'Apollo');
  assert.equal(ctx(ds, GROUP).members.length, 3);
  assert.equal(ctx(ds, ONE).visibility, 'direct');
  assert.equal(ctx(ds, MEET).kind, 'meeting');
  assert.equal(ctx(ds, MEET).visibility, 'group');
  assert.equal(ctx(ds, CHAN).visibility, 'unknown');

  const byKey = k => ev.find(e => e.key === k);
  const g1 = byKey(`${GROUP}:1709551234567`);
  assert.equal(g1.t, Date.UTC(2024, 2, 4, 11, 20, 34, 567));
  assert.equal(g1.actor, ANA);
  assert.deepEqual(g1.targets, [[BEN, 'dm'], [CHEN, 'dm'], [BEN, 'mention']]);
  assert.equal(g1.text, 'Thanks @Ben Okafor, merging now & done.');
  const like = ev.find(e => e.type === 'reaction');
  assert.equal(like.actor, BEN);
  assert.deepEqual(like.targets, [[ANA, 'subject']]);
  assert.equal(like.parent, g1.i);
  assert.equal(like.t, Date.UTC(2024, 2, 4, 11, 25, 2, 100));

  const bot = ev.find(e => e.actor === 'teams:app:app-123');
  assert.ok(bot);
  assert.equal(node(ds, 'teams:app:app-123').isBot, true);
  assert.equal(node(ds, ANA).attrs.email, 'ana.ruiz@example.org'); // from the members file
  assert.equal(node(ds, CHEN).attrs.external, true);                // federatedUser

  // 1:1 chat without a members file: members inferred from senders.
  assert.deepEqual(byKey(`${ONE}:1709552000000`).targets, [[BEN, 'dm']]);
  assert.equal(warning(source, 'teams-members-inferred').count, 2);

  // Channel replies: replyToId -> parent and reply target; absent root -> no target.
  const root = byKey(`${CHAN}:1709560000000`);
  assert.deepEqual(root.targets, []);
  const rep = byKey(`${CHAN}:1709560100000`);
  assert.deepEqual(rep.targets, [[ANA, 'reply']]);
  assert.equal(rep.parent, root.i);
  const late = byKey(`${CHAN}:1709560200000`);
  assert.deepEqual(late.targets, []);
  assert.equal(late.parent, -1);
  assert.equal(warning(source, 'teams-reply-parent-absent').count, 1);
  assert.equal(warning(source, 'unresolved-parent').count, 1);
  assert.ok(warning(source, 'teams-channel-visibility-unknown'));

  // NDJSON with the malformed timestamp from Microsoft's own docs.
  assert.equal(byKey(`${MEET}:1710658025123`).t, Date.UTC(2024, 2, 17, 6, 47, 5, 123));
  assert.equal(warning(source, 'teams-bad-time'), null);
});

test('teams: a chats-only dump is one person\'s view; ego inferred', async () => {
  const dir = fixture('teams', 'graph', 'messages');
  const { source } = await runImporter(teams, [join(dir, 'oneonone.json'), join(dir, 'meeting.ndjson')]);
  assert.equal(source.view, 'ego');
  assert.equal(source.egoKey, ANA);
});

test('teams: time parsing is explicit', () => {
  assert.equal(parseGraphTime('2021-03-1706:47:05.123Z'), Date.UTC(2021, 2, 17, 6, 47, 5, 123));
  assert.equal(parseGraphTime('2024-03-04T11:20:34Z'), Date.UTC(2024, 2, 4, 11, 20, 34));
  assert.ok(Number.isNaN(parseGraphTime('garbage')));
  assert.ok(Number.isNaN(parseGraphTime(null)));
});

// Tar files built by python's tarfile (independent reference) in three formats.
const tdir = mkdtempSync(join(tmpdir(), 'osa-tar-'));
const LONG = 'media/' + 'very-long-folder-name-'.repeat(6) + '/attachment-0001.json';
execFileSync('python3', ['-c', `
import tarfile, io, sys, json
d, msgs, longp = sys.argv[1], sys.argv[2], sys.argv[3]
data = open(msgs, 'rb').read()
for fmt, name in [(tarfile.GNU_FORMAT, 'gnu'), (tarfile.PAX_FORMAT, 'pax'), (tarfile.USTAR_FORMAT, 'ustar')]:
    with tarfile.open(f'{d}/{name}.tar', 'w', format=fmt) as t:
        def add(n, b):
            ti = tarfile.TarInfo(n); ti.size = len(b); t.addfile(ti, io.BytesIO(b))
        dd = tarfile.TarInfo('skype-parser'); dd.type = tarfile.DIRTYPE; t.addfile(dd)
        add('skype-parser/index.html', b'<html></html>' * 100)
        add(longp if fmt != tarfile.USTAR_FORMAT else 'media/x/attachment-0001.json', b'{"x":1}' * 77)
        add('messages.json', data)
    listing = [(m.name, m.size, m.isfile()) for m in tarfile.open(f'{d}/{name}.tar')]
    open(f'{d}/{name}.json', 'w').write(json.dumps(listing))
`, tdir, fixture('teams', 'free', 'messages.json'), LONG]);

for (const fmt of ['gnu', 'pax', 'ustar']) {
  test(`teams: tar reader matches python tarfile (${fmt})`, async () => {
    const expected = JSON.parse(readFileSync(join(tdir, fmt + '.json'), 'utf8'));
    const got = [];
    let msgBytes = null;
    for await (const e of tarEntries((await openAsBlob(join(tdir, fmt + '.tar'))).stream(), n => n === 'messages.json')) {
      got.push([e.name.replace(/\/$/, ''), e.size, e.type === 'file']);
      if (e.data) msgBytes = e.data;
    }
    assert.deepEqual(got, expected);
    if (fmt !== 'ustar') assert.ok(got.some(g => g[0] === LONG && LONG.length > 100));
    assert.deepEqual(Buffer.from(msgBytes), readFileSync(fixture('teams', 'free', 'messages.json')));
  });
}

test('teams: tar reader rejects a non-tar stream', async () => {
  const bad = new Blob([new Uint8Array(1024).fill(65)]);
  await assert.rejects(async () => { for await (const _ of tarEntries(bad.stream())) { /* drain */ } }, /checksum/);
});

function checkFree(ds, source) {
  assert.equal(source.variant, 'teams-free');
  assert.equal(source.view, 'ego');
  assert.equal(source.egoKey, 'teams:8:live:.cid.owner0000');
  assert.ok(warning(source, 'teams-free-unofficial-schema'));
  const ev = events(ds);
  assert.equal(ev.length, 3);
  assert.equal(source.counts['system-events-skipped'], 1);
  const book = 'teams:19:3c1fbook@thread.v2';
  assert.equal(ctx(ds, book).visibility, 'group');   // 19: prefix
  assert.equal(ctx(ds, book).members.length, 3);     // from the JSON-string members field
  assert.equal(ctx(ds, 'teams:8:live:.cid.bbbb').visibility, 'direct'); // 8: prefix
  assert.deepEqual(ev[0].targets, [['teams:8:live:.cid.owner0000', 'dm'], ['teams:8:live:.cid.cccc', 'dm']]);
  assert.equal(ev[0].t, Date.UTC(2024, 2, 4, 11, 20, 34, 567));
  assert.equal(ev[0].text, 'Chapter 3 by Friday?');
  // The owner's sender is a contacts URL; the MRI is extracted.
  assert.equal(ev[2].actor, 'teams:8:live:.cid.owner0000');
  assert.deepEqual(ev[2].targets, [['teams:8:live:.cid.bbbb', 'dm']]);
  assert.equal(node(ds, 'teams:8:live:.cid.bbbb').label, 'Bea Stone');
}

test('teams: Teams Free export from a .tar', async () => {
  const { ds, source, detect } = await runImporter(teams, join(tdir, 'pax.tar'));
  assert.equal(detect.score, 0.8);
  checkFree(ds, source);
});

test('teams: Teams Free messages.json already extracted', async () => {
  const { ds, source, detect } = await runImporter(teams, fixture('teams', 'free'));
  assert.equal(detect.score, 0.85);
  checkFree(ds, source);
});

test('teams: Purview Items.csv gives transcript co-participation only', async () => {
  const { ds, source, detect } = await runImporter(teams, fixture('teams', 'purview'));
  assert.equal(detect.score, 0.8);
  assert.equal(source.variant, 'purview');
  assert.ok(warning(source, 'purview-participants-only'));
  assert.ok(warning(source, 'purview-custodians-only'));
  assert.equal(warning(source, 'purview-name-only-participants').count, 1);
  assert.equal(source.counts['duplicates-skipped'], 1);
  assert.equal(source.counts['non-teams-items-skipped'], 1);
  const ev = events(ds);
  assert.equal(ev.length, 2);
  assert.ok(ev.every(e => e.type === 'copresence'));
  assert.deepEqual(ev[0].targets, [['teams:ben@example.org', 'attendee']]);
  assert.equal(ev[0].actor, 'teams:ana@example.org');
  assert.equal(ev[0].t, Date.UTC(2024, 2, 4, 11, 20, 34));
  assert.equal(ev[0].visibility, 'direct');
  assert.equal(ev[1].t, Date.UTC(2024, 2, 5, 14, 30)); // "3/5/2024 2:30:00 PM", month first
  assert.deepEqual(ev[1].targets, [['teams:ben@example.org', 'attendee'], ['teams:name:chen li', 'attendee']]);
  assert.equal(ctx(ds, 'teams:purview:conv-2').name, 'General');
  assert.equal(node(ds, 'teams:ana@example.org').attrs.email, 'ana@example.org');
});

test('teams: participant list parsing', () => {
  assert.deepEqual(parseParticipants('"Okafor, Ben" <Ben@x.org>, Ana <a@x.org>; Chen Li; d@x.org'), [
    { name: 'Okafor, Ben', email: 'ben@x.org' }, { name: 'Ana', email: 'a@x.org' },
    { name: 'Chen Li', email: null }, { name: '', email: 'd@x.org' }]);
});

test('teams: not claimed for unrelated JSON', async () => {
  const fs = await FileSet.from([{ blob: new Blob(['{"a":1}']), path: 'data.json' }]);
  assert.equal((await teams.detect(fs)).score, 0);
  const b = new DatasetBuilder();
  await teams.import(fs, { builder: b, options: {} });
  assert.equal(b.build().meta.sources.length, 0);
});
