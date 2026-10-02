import { test } from 'node:test';
import assert from 'node:assert/strict';
import xArchive from '../../src/importers/x-archive.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes } from './helpers.js';

const EGO = 'x:1400000000000000001';
const T = (y, mo, d, h, mi, s, ms = 0) => Date.UTC(y, mo - 1, d, h, mi, s, ms);

test('modern archive: detection via manifest.js', async () => {
  const fs = await fsFromFixtures('x-archive/modern/twitter-2025-01-22-abc');
  const det = await xArchive.detect(fs);
  assert.equal(det.score, 0.98);
});

test('modern archive: ego, tweets, retweets, quotes, notes, likes, follows, DMs', async () => {
  const fs = await fsFromFixtures('x-archive/modern/twitter-2025-01-22-abc');
  const { ds } = await runImport(xArchive, fs);
  const src = source(ds);
  assert.equal(src.view, 'ego');
  assert.equal(src.egoKey, EGO);
  assert.equal(src.tz, 'UTC');
  assert.equal(src.medium, 'x');
  const ego = node(ds, EGO);
  assert.equal(ego.label, 'Example Org');
  assert.deepEqual(ego.platformIds, { x: '1400000000000000001', handle: 'example_org' });
  assert.equal(ego.attrs.location, 'Riverbank');
  assert.ok(!JSON.stringify(ds.nodes.attrs).includes('owner@example.invalid'), 'email must be dropped');

  const ev = events(ds);
  const byKey = k => ev.find(e => e.key === k);

  // Manifest-driven: part1 read, unlisted part9 ignored, listed-but-missing like-part1 warned.
  assert.equal(byKey('x:tweet:1700000000000000900'), undefined);
  assert.equal(src.counts.tweets, 8);
  assert.ok(warningCodes(ds).includes('missing-part'));

  // Spec example reply: reply target river_otter, mention pine_marten; the
  // visible @river_otter is not double counted as a mention.
  const t1 = byKey('x:tweet:1700000000000000101');
  assert.equal(t1.type, 'message');
  assert.equal(t1.t, T(2024, 3, 5, 14, 2, 11));
  assert.deepEqual(t1.targets, [['x:222000111', 'reply'], ['x:333000222', 'mention']]);
  assert.equal(t1.context, 'x:thread:1700000000000000055');
  assert.equal(t1.visibility, 'public');
  assert.equal(node(ds, 'x:222000111').label, 'River Otter');
  assert.equal(node(ds, 'x:222000111').platformIds.handle, 'river_otter');

  // Self-reply: self target dropped, prefix mention skipped, same thread, parent resolved.
  const t2 = byKey('x:tweet:1700000000000000102');
  assert.deepEqual(t2.targets, [['x:333000222', 'mention']]);
  assert.equal(t2.context, 'x:thread:1700000000000000055');
  assert.equal(t2.parent, t1.i);

  // Retweets via "RT @": original author from user_mentions[0]; unknown handle -> handle node.
  const rt = byKey('x:tweet:1700000000000000103');
  assert.equal(rt.type, 'repost');
  assert.deepEqual(rt.targets, [['x:333000222', 'subject']]);
  assert.equal(rt.text, 'RT @pine_marten: big news & more');
  assert.deepEqual(byKey('x:tweet:1700000000000000104').targets, [['x:@ghost_acct', 'subject']]);
  assert.ok(warningCodes(ds).includes('handle-only-node'));

  // Missing in_reply_to_screen_name still gives a reply tie by id.
  assert.deepEqual(byKey('x:tweet:1700000000000000108').targets, [['x:777000666', 'reply']]);

  // Quote via status URL: handle resolved case-insensitively to the id seen in mentions.
  assert.equal(byKey('x:tweet:1700000000000000105').type, 'message');
  const q = byKey('x:quote:1700000000000000105');
  assert.equal(q.type, 'repost');
  assert.deepEqual(q.targets, [['x:222000111', 'subject']]);

  // id "-1" mention skipped; entities decoded.
  const t6 = byKey('x:tweet:1700000000000000106');
  assert.deepEqual(t6.targets, []);
  assert.equal(t6.text, 'hi @gone <3');
  assert.ok(warningCodes(ds).includes('unresolved-mention'));

  // Long-form note text replaces the truncated full_text (heuristic link).
  assert.equal(byKey('x:tweet:1700000000000000107').text, 'This is the start of a long note that goes on and on well past the limit.');

  // Likes: undated, no author target, flagged.
  const likes = ev.filter(e => e.type === 'like');
  assert.equal(likes.length, 2);
  assert.ok(likes.every(l => Number.isNaN(l.t) && l.targets.length === 0 && l.actor === EGO));
  assert.equal(likes[0].text, 'a liked tweet & more');
  assert.ok(warningCodes(ds).includes('undated-likes'));
  assert.equal(src.warnings.find(w => w.code === 'undated-likes').count, 2);

  // Follows: ego follows X (actor ego); follower Y (actor Y, subject ego).
  const follows = ev.filter(e => e.type === 'follow');
  assert.deepEqual(follows.map(f => [f.actor, f.targets]), [
    [EGO, [['x:555000444', 'subject']]],
    [EGO, [['x:222000111', 'subject']]],
    ['x:444000333', [[EGO, 'subject']]],
  ]);
  assert.ok(follows.every(f => Number.isNaN(f.t)));

  // 1:1 DMs: chronological order restored, dm targets, direct visibility.
  const dms = ev.filter(e => e.context === 'x:dm:1400000000000000001-222000111');
  assert.deepEqual(dms.map(d => [d.actor, d.targets, d.t]), [
    ['x:222000111', [[EGO, 'dm']], T(2022, 1, 27, 15, 58, 52, 744)],
    [EGO, [['x:222000111', 'dm']], T(2022, 1, 27, 16, 0, 0)],
  ]);
  assert.equal(context(ds, 'x:dm:1400000000000000001-222000111').visibility, 'direct');
  assert.equal(context(ds, 'x:dm:1400000000000000001-222000111').kind, 'dm');

  // Group DM: join/leave events, no broadcast targets, name from conversationNameUpdate.
  const g = context(ds, 'x:group_dm:1612345678901234567');
  assert.equal(g.visibility, 'group');
  assert.equal(g.name, 'Otter planning');
  assert.equal(g.members.length, 3);
  const gev = ev.filter(e => e.context === 'x:group_dm:1612345678901234567');
  assert.deepEqual(gev.map(e => [e.type, e.actor, e.targets, e.t]), [
    ['join', EGO, [['x:222000111', 'subject']], T(2024, 3, 6, 8, 58, 0)],
    ['join', 'x:333000222', [[EGO, 'subject']], T(2024, 3, 6, 9, 0, 0)],
    ['leave', 'x:333000222', [], T(2024, 3, 6, 9, 10, 0)],
    ['message', 'x:222000111', [], T(2024, 3, 6, 9, 15, 0, 120)],
  ]);

  // Ids stay strings everywhere.
  assert.ok(ds.nodes.keys.every(k => typeof k === 'string'));
  assert.ok(ds.nodes.platformIds.every(p => p.x === undefined || typeof p.x === 'string'));
  assert.ok(ev.filter(e => e.key).every(e => /^x:(tweet|quote|like|dm):\d+$/.test(e.key)));
});

test('legacy 2020 archive: tweet.js, same-line array, missing wrapper, empty follower list, no manifest', async () => {
  const fs = await fsFromFixtures('x-archive/legacy');
  const det = await xArchive.detect(fs);
  assert.equal(det.score, 0.9);
  const { ds } = await runImport(xArchive, fs);
  assert.equal(source(ds).egoKey, 'x:1100000000000000009');
  const ev = events(ds);
  assert.equal(ev.length, 2);
  assert.deepEqual(ev[0].targets, [['x:222000111', 'reply']]); // prefix mention skipped
  assert.equal(ev[0].t, T(2021, 3, 21, 12, 53, 22));
  assert.equal(ev[1].text, 'no wrapper here');
  assert.equal(ev[1].actor, 'x:1100000000000000009');
});

test('detect ignores unrelated JS and research JSONL', async () => {
  const fs = await fsFromMemory({ 'app.js': 'const x = 1;', 'tweets.jsonl': '{"data":[]}' });
  assert.equal((await xArchive.detect(fs)).score, 0);
});
