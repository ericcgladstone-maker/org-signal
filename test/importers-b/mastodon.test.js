import { test } from 'node:test';
import assert from 'node:assert/strict';
import mastodon, { visibilityOf, acctFromMention } from '../../src/importers/mastodon.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes, countBy } from './helpers.js';

const EGO = 'mastodon:otter@social.example';
const MARTEN = 'mastodon:marten@other.example';
const HERON = 'mastodon:heron@birds.example';
const KITE = 'mastodon:kite@birds.example';
const BADGER = 'mastodon:badger@social.example';
const PUB = 'https://www.w3.org/ns/activitystreams#Public';
const F = 'https://s.example/users/a/followers';

test('visibility from addressing follows the spec table', () => {
  assert.equal(visibilityOf([PUB], [F], F), 'public');
  assert.equal(visibilityOf([F], [PUB], F), 'unlisted');
  assert.equal(visibilityOf([F], ['https://x/users/b'], F), 'private');
  assert.equal(visibilityOf(['https://x/users/b'], [], F), 'direct');
  assert.equal(visibilityOf(['as:Public'], [], F), 'public');
  assert.equal(visibilityOf([], ['Public'], F), 'unlisted');
});

test('Mention name to acct, never from the URI path', () => {
  assert.equal(acctFromMention('@marten@other.example', 'https://other.example/users/marten'), 'marten@other.example');
  assert.equal(acctFromMention('@heron@birds.example', 'https://birds.example/ap/users/116000000000000001'), 'heron@birds.example');
  assert.equal(acctFromMention('@Badger', 'https://social.example/users/badger'), 'badger@social.example');
});

test('imports a Mastodon archive with CSVs', async () => {
  const fs = await fsFromFixtures('mastodon/archive');
  const { det, ds } = await runImport(mastodon, fs);
  assert.ok(det.score >= 0.95);
  const src = source(ds);
  assert.equal(src.view, 'ego');
  assert.equal(src.egoKey, EGO);
  assert.equal(src.tz, 'UTC');
  assert.equal(src.counts.statuses, 9);
  assert.equal(src.counts.boosts, 3);
  assert.equal(src.counts['direct-messages'], 2);
  assert.equal(src.counts.likes, 3);
  assert.equal(src.counts.bookmarks, 1);
  assert.equal(src.counts.follows, 3);
  const w = warningCodes(ds);
  for (const c of ['reply-author-unknown', 'boost-author-heuristic', 'undated-likes', 'heuristic-likes-author', 'unknown-likes-author', 'undated-bookmarks', 'undated-follows']) assert.ok(w.includes(c), c);

  const evs = events(ds);
  assert.deepEqual(countBy(evs, e => e.type), { message: 9, repost: 4, like: 4, follow: 3 });
  const byText = s => evs.find(e => e.type === 'message' && e.text.includes(s));

  const e1 = byText('agreed');
  assert.equal(e1.text, '@marten agreed & thanks!');
  assert.equal(e1.t, Date.UTC(2025, 0, 5, 9, 30));
  assert.deepEqual(e1.targets, [[MARTEN, 'reply']]); // auto-mention of the parent author not double counted
  assert.equal(e1.visibility, 'public');

  const e2 = byText('hello');
  assert.deepEqual(e2.targets, [[BADGER, 'mention'], [HERON, 'mention']]);
  assert.equal(e2.context, 'mastodon:thread:https://social.example/contexts/1-77'); // `context` preferred over `conversation`

  assert.equal(byText('quiet').visibility, 'public'); // unlisted
  assert.equal(src.counts.unlisted, 1);
  const e4 = byText('for followers');
  assert.equal(e4.visibility, 'private');
  assert.deepEqual(e4.targets, [[MARTEN, 'mention']]);

  const e5 = byText('private note');
  assert.deepEqual(e5.targets, [[HERON, 'dm']]);
  assert.equal(e5.visibility, 'direct');
  assert.equal(context(ds, e5.context).kind, 'dm');
  const e6 = byText('plan');
  assert.deepEqual(e6.targets.sort(), [[HERON, 'dm'], [KITE, 'dm']]);
  assert.equal(e6.visibility, 'group');

  assert.deepEqual(byText('void').targets, []);
  const e8 = byText('look at this');
  assert.equal(e8.text, '[CW: spoilers] look at this');
  const quote = evs.find(e => e.key === 'mastodon:quote:https://social.example/users/otter/statuses/113000000000000008');
  assert.deepEqual(quote.targets, [[MARTEN, 'subject']]);

  const boosts = evs.filter(e => e.key?.startsWith('mastodon:boost:'));
  assert.deepEqual(boosts.map(b => [b.t, b.targets]), [
    [Date.UTC(2025, 0, 13, 17), [[MARTEN, 'subject']]],
    [Date.UTC(2025, 0, 14, 18), [['mastodon:https://far.example/users/vole', 'subject']]],
    [Date.UTC(2025, 0, 15, 19), []], // self-boost
  ]);

  const e12 = byText('another thing');
  assert.equal(e12.parent, e1.i); // self-reply resolves to own status
  assert.deepEqual(e12.targets, []);

  const likes = evs.filter(e => e.type === 'like');
  for (const l of likes) assert.ok(Number.isNaN(l.t));
  assert.deepEqual(likes.map(l => l.targets), [[[MARTEN, 'subject']], [['mastodon:https://ap.example/ap/users/987', 'subject']], [], [[HERON, 'subject']]]);

  const follows = evs.filter(e => e.type === 'follow');
  assert.deepEqual(follows.map(f => f.targets[0][0]), [MARTEN, HERON, 'mastodon:newperson@x.example']);
  for (const f of follows) { assert.equal(f.actor, EGO); assert.ok(Number.isNaN(f.t)); }

  // Identity reconciliation: the 4.5 numeric actor URI and the CSV address are one node.
  const heron = node(ds, HERON);
  assert.equal(heron.platformIds.mastodon, 'https://birds.example/ap/users/116000000000000001');
  assert.equal(heron.attrs.show_boosts, 'false');
  assert.equal(heron.attrs.mastodon_lists, 'Birds');
  assert.equal(heron.attrs.instance, 'birds.example');
  assert.equal(node(ds, MARTEN).attrs.mastodon_lists, 'Mustelids');
  assert.equal(node(ds, EGO).label, 'Otter Lab');
  assert.ok(!ds.nodes.keys.some(k => k.includes('/users/marten')));
});

test('following CSV alone uses the account option', async () => {
  const fs = await fsFromMemory({ 'following_accounts.csv': '\ufeffAccount address,Show boosts,Notify on new posts,Languages\nmarten@other.example,true,false,\n' });
  const { det, ds } = await runImport(mastodon, fs, { account: '@Otter@social.example' });
  assert.ok(det.score >= 0.9);
  assert.equal(source(ds).egoKey, EGO);
  const evs = events(ds);
  assert.equal(evs.length, 1);
  assert.deepEqual(evs[0].targets, [[MARTEN, 'subject']]);
  const { ds: ds2 } = await runImport(mastodon, fs);
  assert.ok(warningCodes(ds2).includes('ego-unknown'));
});

test('unrelated JSON and CSV are not claimed', async () => {
  const fs = await fsFromMemory({ 'outbox.json': '{"id":"x","type":"Collection"}', 'a.csv': 'name,email\n' });
  assert.equal((await mastodon.detect(fs)).score, 0);
});
