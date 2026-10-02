import { test } from 'node:test';
import assert from 'node:assert/strict';
import slack from '../../src/importers/slack.js';
import { DatasetBuilder } from '../../src/core/model.js';
import { FileSet } from '../../src/core/fileset.js';
import { runImporter, fixture, zipFolder, events, node, ctx, countBy, warning } from './helpers.js';

const STD = fixture('slack', 'standard');

function checkStandard(ds, source) {
  assert.equal(source.format, 'slack');
  assert.equal(source.view, 'full');
  assert.equal(source.variant, 'full');
  assert.equal(source.tz, 'UTC');

  // Nodes: six users from users.json plus one bot without a user id.
  assert.equal(ds.nodes.count, 7);
  const ana = node(ds, 'slack:U01ANARUIZ0');
  assert.equal(ana.label, 'Ana Ruiz');
  assert.equal(ana.attrs.email, 'ana.ruiz@example.org');
  assert.equal(ana.attrs.title, 'Engineer');
  assert.equal(ana.attrs.admin, true);
  assert.deepEqual(ana.platformIds, { slack: 'U01ANARUIZ0' });
  assert.equal(node(ds, 'slack:W01BENOKAF0').label, 'Ben Okafor'); // W-prefixed id
  assert.equal(node(ds, 'slack:U01CHENLI00').attrs.guest, 'multi-channel');
  assert.equal(node(ds, 'slack:U01DANAPARK').attrs.deleted, true);
  assert.equal(node(ds, 'slack:U01BOTUSER0').isBot, true);
  assert.equal(node(ds, 'slack:bot:B01DEPLOYBOT').isBot, true);
  assert.equal(node(ds, 'slack:bot:B01DEPLOYBOT').label, 'deploybot');
  assert.equal(ana.isBot, false);

  // Visibility comes from the metadata file, not the id prefix.
  assert.equal(ds.contexts.count, 6);
  assert.equal(ctx(ds, 'slack:C01GENERAL0').visibility, 'public');
  assert.equal(ctx(ds, 'slack:G01OLDPUBLC').visibility, 'public');   // G id listed in channels.json
  assert.equal(ctx(ds, 'slack:C02APOLLO00').visibility, 'private');  // C id listed in groups.json
  assert.equal(ctx(ds, 'slack:D07ABCDEF12').visibility, 'direct');
  assert.equal(ctx(ds, 'slack:D07ABCDEF12').kind, 'dm');
  assert.equal(ctx(ds, 'slack:G03MPIM0001').visibility, 'group');
  assert.equal(ctx(ds, 'slack:G03MPIM0001').kind, 'group_dm');
  assert.equal(ctx(ds, 'slack:orphan').visibility, 'unknown');
  assert.equal(ctx(ds, 'slack:C01GENERAL0').members.length, 4);
  assert.equal(ctx(ds, 'slack:C01GENERAL0').name, '#general');

  const ev = events(ds);
  assert.deepEqual(countBy(ev, e => e.type), { message: 12, reaction: 3, join: 1, leave: 1, copresence: 1 });
  const byKey = k => ev.find(e => e.key === k);

  const root = byKey('slack:C01GENERAL0:1709551234.001200');
  assert.equal(root.t, 1709551234001);
  assert.equal(root.actor, 'slack:U01ANARUIZ0');
  assert.deepEqual(root.targets, [['slack:W01BENOKAF0', 'mention']]); // text + blocks deduped, @here not dyadic
  assert.equal(root.text, 'Draft is up, @ben can you review? R&D <3 @here');
  assert.equal(root.visibility, 'public');

  const reply = byKey('slack:C01GENERAL0:1709552100.002300');
  assert.deepEqual(reply.targets, [['slack:U01ANARUIZ0', 'reply']]);
  assert.equal(reply.parent, root.i);

  // Parent absent from the data: reply target still drawn from parent_user_id.
  // ts 1709600000 is 2024-03-05 in UTC but sits in the 2024-03-04 file.
  const orphanReply = byKey('slack:C01GENERAL0:1709600000.000300');
  assert.equal(orphanReply.t, 1709600000000);
  assert.equal(new Date(orphanReply.t).toISOString().slice(0, 10), '2024-03-05');
  assert.deepEqual(orphanReply.targets, [['slack:W01BENOKAF0', 'reply'], ['slack:U01ANARUIZ0', 'mention']]);
  assert.equal(orphanReply.parent, -1);
  assert.equal(orphanReply.text, 'Following up @ana');

  // Old-style reply without parent_user_id: author found by thread_ts lookup.
  const bcast = byKey('slack:C01GENERAL0:1709600100.000400');
  assert.deepEqual(bcast.targets, [['slack:U01ANARUIZ0', 'reply']]);
  assert.equal(bcast.parent, root.i);

  const bot1 = byKey('slack:C01GENERAL0:1709555000.000200');
  assert.equal(bot1.actor, 'slack:bot:B01DEPLOYBOT');
  const bot2 = byKey('slack:C01GENERAL0:1709650100.000700');
  assert.equal(bot2.actor, 'slack:U01BOTUSER0');
  assert.deepEqual(bot2.targets, [['slack:U01CHENLI00', 'mention']]); // mention found in attachments
  assert.equal(source.counts['bot-messages'], 2);

  const join = ev.find(e => e.type === 'join');
  assert.equal(join.actor, 'slack:U01DANAPARK');
  assert.equal(join.t, 1709554000000);
  assert.equal(join.context, 'slack:C01GENERAL0');
  assert.equal(ev.find(e => e.type === 'leave').t, 1709650000001);

  const reactions = ev.filter(e => e.type === 'reaction');
  assert.deepEqual(reactions.map(r => r.actor).sort(), ['slack:U01CHENLI00', 'slack:U01CHENLI00', 'slack:W01BENOKAF0']);
  for (const r of reactions) {
    assert.deepEqual(r.targets, [['slack:U01ANARUIZ0', 'subject']]);
    assert.equal(r.parent, root.i);
    assert.equal(r.weight, 1);
  }
  assert.equal(warning(source, 'slack-reactions-truncated').count, 3);

  const huddle = ev.find(e => e.type === 'copresence');
  assert.equal(huddle.t, 1709650210000);
  assert.equal(huddle.actor, 'slack:U01ANARUIZ0');
  assert.deepEqual(huddle.targets, [['slack:W01BENOKAF0', 'attendee'], ['slack:U01CHENLI00', 'attendee']]);

  // DMs: partner as 'dm'; a mention of the partner is not repeated.
  const dm = ev.filter(e => e.context === 'slack:D07ABCDEF12');
  assert.deepEqual(dm.map(e => [e.actor, e.targets]), [
    ['slack:U01ANARUIZ0', [['slack:W01BENOKAF0', 'dm']]],
    ['slack:W01BENOKAF0', [['slack:U01ANARUIZ0', 'dm']]],
  ]);
  assert.equal(dm[0].visibility, 'direct');
  const mp = ev.find(e => e.context === 'slack:G03MPIM0001');
  // Group DM: a mention is kept beside the roster 'dm' role.
  assert.deepEqual(mp.targets, [['slack:U01ANARUIZ0', 'dm'], ['slack:W01BENOKAF0', 'dm'], ['slack:W01BENOKAF0', 'mention']]);
  assert.equal(mp.text, 'group hello @ben');
  assert.equal(mp.visibility, 'group');

  const rnd = ev.find(e => e.context === 'slack:G01OLDPUBLC');
  assert.equal(rnd.text, 'lunch? see #general @eng');
  assert.deepEqual(rnd.targets, []);

  assert.equal(source.counts.messages, 12);
  assert.equal(source.counts['duplicates-skipped'], 1);
  assert.equal(source.counts['edit-delete-records-skipped'], 1);
  assert.equal(source.counts['metadata-events-skipped'], 1);
  assert.equal(source.counts['broadcast-mentions'], 1);
  assert.equal(warning(source, 'slack-unknown-conversation').count, 1);
  assert.equal(warning(source, 'slack-usergroup-mentions').count, 1);
  assert.equal(warning(source, 'unresolved-parent').count, 1);
  assert.equal(warning(source, 'slack-public-only'), null);
}

test('slack: standard export from a folder', async () => {
  const { ds, source, detect } = await runImporter(slack, STD);
  assert.equal(detect.score, 0.95);
  assert.ok(detect.files.includes('users.json'));
  assert.ok(detect.files.includes('general/2024-03-04.json'));
  checkStandard(ds, source);
});

test('slack: standard export from a zip with an extra top folder', async () => {
  const zip = zipFolder(STD, 'Example Slack export.zip', 'Example Slack export Mar 1 2024 - Mar 6 2024/');
  const { ds, source, detect } = await runImporter(slack, zip);
  assert.equal(detect.score, 0.95);
  checkStandard(ds, source);
});

test('slack: Enterprise Grid nested layout', async () => {
  const { ds, source, detect } = await runImporter(slack, fixture('slack', 'grid'));
  assert.match(detect.reason, /Grid/);
  assert.equal(source.variant, 'grid');
  assert.equal(ds.nodes.count, 2);
  const ann = node(ds, 'slack:W0AAA111111');
  assert.equal(ann.attrs.email, 'ann@grid.example');
  assert.equal(ann.attrs.title, 'Lead'); // merged from teams/Alpha/users.json
  assert.equal(ann.attrs.workspaces, 'T0ALPHA0000;T0BETA00000');
  assert.equal(ctx(ds, 'slack:C0ORGSHARE0').visibility, 'public');
  assert.equal(ctx(ds, 'slack:C0ALPHA0001').visibility, 'public');
  assert.equal(ctx(ds, 'slack:C0ALPHA0002').visibility, 'private');
  assert.equal(ctx(ds, 'slack:D0BETA00001').visibility, 'direct');
  const ev = events(ds);
  assert.equal(ev.length, 4);
  assert.deepEqual(ev.find(e => e.context === 'slack:C0ALPHA0002').targets, [['slack:W0AAA111111', 'mention']]);
  assert.deepEqual(ev.find(e => e.context === 'slack:D0BETA00001').targets, [['slack:W0AAA111111', 'dm']]);
  assert.equal(ev.find(e => e.context === 'slack:C0ORGSHARE0').t, 1714550400000);
  assert.equal(source.warnings.length, 0);
});

const blob = (o) => new Blob([JSON.stringify(o)]);

test('slack: public-only export, canvas folders ignored, detection rules', async () => {
  const fs = await FileSet.from([
    { blob: blob([{ id: 'U1', name: 'a', real_name: 'A' }]), path: 'users.json' },
    { blob: blob([{ id: 'C1', name: 'general', members: ['U1'] }]), path: 'channels.json' },
    { blob: blob([{ type: 'message', user: 'U1', text: 'x', ts: '1700000000.000001' }]), path: 'general/2023-11-14.json' },
    { blob: blob([{ type: 'message', user: 'U1', text: 'c', ts: '1700000001.000001' }]), path: 'FC:F07XYZ/2023-11-14.json' },
  ]);
  const d = await slack.detect(fs);
  assert.equal(d.score, 0.95);
  assert.ok(!d.files.includes('FC:F07XYZ/2023-11-14.json'));
  const builder = new DatasetBuilder();
  await slack.import(fs, { builder, options: {} });
  const ds = builder.build();
  const s = ds.meta.sources[0];
  assert.equal(s.variant, 'public-only');
  assert.ok(warning(s, 'slack-public-only'));
  assert.equal(ds.contexts.count, 1);
  assert.equal(ds.events.count, 1);
  assert.equal(s.counts['canvas-folders-skipped'], 1);

  // Without metadata files it is not claimed.
  const fs2 = await FileSet.from([{ blob: blob([]), path: 'general/2023-11-14.json' }, { blob: blob([]), path: 'x/y.json' }]);
  assert.equal((await slack.detect(fs2)).score, 0);
});

test('slack: aborts when the signal fires', async () => {
  const fs = await FileSet.fromPaths([STD]);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(slack.import(fs, { builder: new DatasetBuilder(), options: {}, signal: ac.signal }), { name: 'AbortError' });
});
