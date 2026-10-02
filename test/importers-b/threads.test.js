import { test } from 'node:test';
import assert from 'node:assert/strict';
import threads, { textMentions, followEntry, shapeEntry, usernameFromHref } from '../../src/importers/threads.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes, countBy } from './helpers.js';

const EGO = 'threads:otter.lab';
const ROOT = 'threads/instagram-otter.lab-2025-08-24-AbCdEfGh';

test('text mentions: usernames with dots/underscores, no trailing period, no e-mails', () => {
  assert.deepEqual(textMentions("sync with @pine.marten. and @River_Otter, mail a@b.com"), ['pine.marten', 'river_otter']);
  assert.deepEqual(textMentions('@a.b_c'), ['a.b_c']);
});

test('follow entries parse defensively across shapes', () => {
  assert.deepEqual(followEntry({ title: 'Pine', string_list_data: [{ href: 'https://www.threads.com/pine.marten', value: 'pine.marten', timestamp: 1730000000 }] }), { username: 'pine.marten', display: 'Pine', t: 1730000000000 });
  assert.deepEqual(followEntry({ title: 'heron.bird', string_list_data: [{ href: 'https://www.threads.net/heron.bird', timestamp: 1 }] }), { username: 'heron.bird', display: null, t: 1000 });
  assert.equal(followEntry({ title: '', string_list_data: [{ href: 'https://www.threads.net/kite.k' }] }).username, 'kite.k');
  assert.equal(usernameFromHref('https://www.threads.net/@badger.x/post/DZZZ'), 'badger.x');
});

test('localized string_map_data is classified by value shape, not label', () => {
  const r = shapeEntry({ '\u4f5c\u8005': { value: 'River.Otter' }, 'X': { href: 'https://www.threads.com/@river.otter/post/X1' }, 'Y': { timestamp: 1760000000 } });
  assert.deepEqual(r, { url: 'https://www.threads.com/@river.otter/post/X1', t: 1760000000000, author: 'river.otter' });
});

test('imports an Instagram-bundled Threads export (mojibake fixed, no invented reply ties)', async () => {
  const fs = await fsFromFixtures(ROOT);
  const { det, ds } = await runImport(threads, fs);
  assert.ok(det.score >= 0.9);
  const src = source(ds);
  assert.equal(src.view, 'ego');
  assert.equal(src.egoKey, EGO);
  assert.equal(src.tz, 'UTC');
  assert.equal(src.counts.posts, 3);
  assert.equal(src.counts.likes, 2);
  assert.equal(src.counts.followers, 2);
  assert.equal(src.counts.following, 1);
  assert.equal(src.counts.saved, 1);
  assert.equal(src.counts['saved-with-author'], 1);
  assert.equal(src.counts.blocked, 1);
  const rp = src.warnings.find(w => w.code === 'reply-parent-missing');
  assert.equal(rp.count, 1);
  assert.equal(src.warnings.find(w => w.code === 'mentions-from-text').count, 2);

  const evs = events(ds);
  assert.deepEqual(countBy(evs, e => e.type), { message: 3, like: 2, follow: 3 });
  assert.equal(evs.filter(e => e.targets.some(t => t[1] === 'reply')).length, 0);

  const p1 = evs[0];
  assert.equal(p1.text, "agreed \u2014 let's sync tomorrow with @pine.marten.");
  assert.equal(p1.t, 1754466859000);
  assert.deepEqual(p1.targets, [['threads:pine.marten', 'mention']]);
  assert.equal(p1.visibility, 'public');
  assert.equal(context(ds, p1.context).kind, 'feed');
  assert.equal(evs[1].text, 'caf\u00e9 day \u{1F44D} email me at a@b.com @River_Otter');
  assert.deepEqual(evs[1].targets, [['threads:river_otter', 'mention']]);
  assert.deepEqual(evs[2].targets, []); // self-mention

  const likes = evs.filter(e => e.type === 'like');
  assert.deepEqual(likes.map(l => [l.actor, l.targets, l.t, l.text]), [
    [EGO, [['threads:river.otter', 'subject']], 1760912834000, '\u{1F44D}'],
    [EGO, [['threads:badger.x', 'subject']], 1760912900000, '\u2764'],
  ]);
  const follows = evs.filter(e => e.type === 'follow');
  assert.deepEqual(follows.map(f => [f.actor, f.targets, f.t]), [
    [EGO, [['threads:river.otter', 'subject']], 1731000000000],
    ['threads:pine.marten', [[EGO, 'subject']], 1730000000000],
    ['threads:heron.bird', [[EGO, 'subject']], 1730000500000],
  ]);
  assert.equal(node(ds, 'threads:pine.marten').label, 'Pine Marten \u00e9cole');
  assert.equal(node(ds, EGO).label, 'Otter Lab \u00e9');
  assert.ok(!ds.nodes.keys.includes('threads:someone')); // Instagram's own followers file ignored
});

test('localized profile labels fall back to the profile href; private account', async () => {
  const fs = await fsFromMemory({
    'threads/personal_information.json': JSON.stringify({ text_post_app_text_post_app_profile: [{ string_map_data: { 'Nombre de usuario': { href: 'https://www.threads.net/Kite.K', value: 'Kite.K' }, 'Private Account': { value: 'True' } } }] }),
    'threads/threads_and_replies.json': JSON.stringify({ text_post_app_text_posts: [{ media: [{ title: 'hi', creation_timestamp: 1700000000 }] }] }),
  });
  const { ds } = await runImport(threads, fs);
  assert.equal(source(ds).egoKey, 'threads:kite.k');
  assert.equal(events(ds)[0].visibility, 'private');
});

test('HTML export is rejected with a re-export hint; other JSON not claimed', async () => {
  const fs = await fsFromFixtures('threads/html-export');
  assert.ok((await threads.detect(fs)).score >= 0.5);
  await assert.rejects(runImport(threads, fs), /choose JSON/);
  const other = await fsFromMemory({ 'threads/followers.json': '{"relationships_followers": []}' });
  assert.equal((await threads.detect(other)).score, 0);
});
