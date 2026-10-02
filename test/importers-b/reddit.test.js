import { test } from 'node:test';
import assert from 'node:assert/strict';
import reddit, { classifyCsvHeader, parseExportDate, createdMs, ZSTD_HELP } from '../../src/importers/reddit.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes } from './helpers.js';
import { DatasetBuilder } from '../../src/core/model.js';

test('header classification and time parsing', () => {
  assert.equal(classifyCsvHeader('id,permalink,date,ip,subreddit,gildings,link,parent,body,media'), 'comments');
  assert.equal(classifyCsvHeader('id,permalink,date,ip,subreddit,gildings,title,url,body'), 'posts');
  assert.equal(classifyCsvHeader('id,permalink,thread_id,date,ip,from,to,subject,body'), 'messages');
  assert.equal(classifyCsvHeader('message_id,created_at,updated_at,username,message,thread_parent_message_id,channel_url,subreddit,channel_name,conversation_type'), 'chat');
  assert.equal(classifyCsvHeader('﻿subreddit'.replace('﻿', '')), 'subscribed');
  assert.equal(classifyCsvHeader('id,permalink,direction'), null);
  // LinkedIn's messages.csv must not be taken for Reddit's.
  assert.equal(classifyCsvHeader('CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE'), null);
  assert.equal(parseExportDate('2024-05-02 18:11:04 UTC'), Date.UTC(2024, 4, 2, 18, 11, 4));
  assert.equal(createdMs(1714670000), 1714670000000);
  assert.equal(createdMs('1714670100'), 1714670100000);
  assert.ok(Number.isNaN(createdMs('')));
});

test('data request export: ego, PMs, chats, comments, friends', async () => {
  const fs = await fsFromFixtures('reddit/gdpr');
  const { det, ds } = await runImport(reddit, fs);
  assert.ok(det.score >= 0.9, det.reason);
  const src = source(ds);
  assert.equal(src.view, 'ego');
  assert.equal(src.egoKey, 'reddit:river_otter_77');
  const ev = events(ds);
  const ego = 'reddit:river_otter_77';

  const posts = ev.filter(e => e.key?.startsWith('reddit:t3_'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].t, Date.UTC(2024, 4, 1, 12));
  assert.equal(posts[0].context, 'reddit:subreddit:urbanplanning');
  assert.equal(posts[0].visibility, 'public');
  const comments = ev.filter(e => e.key?.startsWith('reddit:t1_'));
  assert.equal(comments.length, 3); // split file comments_2.csv included
  assert.ok(comments.every(e => e.actor === ego && e.targets.length === 0));
  assert.equal(comments[0].text, 'Agree with this,\nmostly.');
  assert.equal(comments[0].t, Date.UTC(2024, 4, 2, 18, 11, 4));
  // The comment on the ego's own post resolves its parent.
  assert.equal(comments[1].parent, posts[0].i);
  assert.equal(comments[0].parent, -1);
  assert.equal(comments[2].context, 'reddit:subreddit:cycling');

  const pms = ev.filter(e => e.key?.startsWith('reddit:t4_'));
  assert.equal(pms.length, 4);
  assert.equal(pms[0].actor, ego);
  assert.deepEqual(pms[0].targets, [['reddit:maple_owl', 'dm']]);
  assert.equal(pms[1].actor, 'reddit:maple_owl');
  assert.deepEqual(pms[1].targets, [[ego, 'dm']]);
  assert.equal(pms[0].context, pms[1].context); // empty thread_id: grouped by pair
  assert.equal(pms[0].visibility, 'direct');
  assert.deepEqual(pms[2].targets, [['reddit:pine_marten', 'dm']]);
  assert.equal(node(ds, 'reddit:pine_marten').label, 'Pine_Marten');
  assert.deepEqual(pms[3].targets, []); // modmail to r/urbanplanning

  const chats = ev.filter(e => e.key?.startsWith('reddit:chat:'));
  assert.equal(chats.length, 5);
  const m2 = chats.find(e => e.key === 'reddit:chat:m2');
  assert.deepEqual(m2.targets, [[ego, 'dm'], [ego, 'reply']]);
  assert.equal(m2.visibility, 'direct');
  assert.equal(m2.parent, chats.find(e => e.key === 'reddit:chat:m1').i);
  const m5 = chats.find(e => e.key === 'reddit:chat:m5');
  assert.deepEqual(m5.targets, [[ego, 'reply']]); // group: reply only, no broadcast
  assert.equal(m5.visibility, 'group');
  assert.equal(context(ds, 'reddit:group_dm:sendbird_group_channel_bbb').name, 'Trail crew');
  assert.equal(context(ds, 'reddit:group_dm:sendbird_group_channel_bbb').members.length, 3);
  const m4 = chats.find(e => e.key === 'reddit:chat:m4');
  assert.equal(m4.t, Date.UTC(2024, 1, 2, 10, 2));

  const fr = ev.find(e => e.type === 'declared');
  assert.deepEqual(fr.targets, [['reddit:maple_owl', 'declared']]);
  assert.ok(Number.isNaN(fr.t));
  assert.equal(node(ds, ego).attrs.subscribed_subreddits, 'urbanplanning; cycling');

  const codes = warningCodes(ds);
  for (const c of ['ego-inferred', 'reply-author-unknown', 'message-to-subreddit', 'friends-undated']) assert.ok(codes.includes(c), c);
  assert.equal(src.warnings.find(w => w.code === 'reply-author-unknown').count, 1);
});

test('username option overrides inference', async () => {
  const fs = await fsFromMemory({ 'comments.csv': 'id,permalink,date,ip,subreddit,gildings,link,parent,body,media\nabc,p,2024-01-01 00:00:00 UTC,,AskX,0,l,t3_q,hi,\n' });
  const { ds } = await runImport(reddit, fs, { username: 'u/Some_User' });
  assert.equal(source(ds).egoKey, 'reddit:some_user');
  assert.equal(node(ds, 'reddit:some_user').label, 'Some_User');
  assert.equal(context(ds, 'reddit:subreddit:askx').name, 'r/AskX');
});

test('Pushshift / Arctic Shift dump: two-pass reply network', async () => {
  const fs = await fsFromFixtures('reddit/dump');
  const { det, ds } = await runImport(reddit, fs);
  assert.ok(det.score >= 0.9, det.reason);
  const src = source(ds);
  assert.equal(src.view, 'full'); // single-subreddit extract
  assert.equal(src.tz, 'UTC');
  assert.equal(src.counts.comments, 6);
  assert.equal(src.counts.submissions, 1);
  const ev = events(ds);
  const byKey = Object.fromEntries(ev.map(e => [e.key, e]));
  // Top-level comment -> submission author (reply-to-OP).
  assert.deepEqual(byKey['reddit:t1_lq7b001'].targets, [['reddit:river_otter_77', 'reply']]);
  assert.equal(byKey['reddit:t1_lq7b001'].parent, byKey['reddit:t3_1abcd2'].i);
  assert.equal(byKey['reddit:t1_lq7b001'].t, 1714670000000);
  // Reply to a comment; created_utc given as a string.
  assert.deepEqual(byKey['reddit:t1_lq7b002'].targets, [['reddit:maple_owl', 'reply']]);
  assert.equal(byKey['reddit:t1_lq7b002'].t, 1714670100000);
  // [deleted] author dropped; reply to it kept without target.
  assert.equal(byKey['reddit:t1_lq7b003'], undefined);
  assert.deepEqual(byKey['reddit:t1_lq7b004'].targets, []);
  // Parent outside the data: kept without target.
  assert.deepEqual(byKey['reddit:t1_lq7b006'].targets, []);
  // Self reply: no self tie.
  assert.deepEqual(byKey['reddit:t1_lq7b007'].targets, []);
  assert.equal(node(ds, 'reddit:automoderator').isBot, true);
  assert.equal(node(ds, 'reddit:river_otter_77').platformIds.reddit, 't2_aaa');
  assert.ok(!ds.nodes.keys.includes('reddit:[deleted]'));
  assert.equal(byKey['reddit:t3_1abcd2'].text, 'Bike lanes\n\nThoughts?');
  assert.equal(byKey['reddit:t3_1abcd2'].context, 'reddit:subreddit:urbanplanning');
  const w = Object.fromEntries(src.warnings.map(x => [x.code, x.count]));
  assert.equal(w['deleted-author'], 2);
  assert.equal(w['reply-to-deleted'], 1);
  assert.equal(w['parent-outside-data'], 1);
  assert.equal(w['bad-line'], 1);
});

test('JSON array dump and authored view', async () => {
  const fs = await fsFromMemory({ 'user_comments.json': JSON.stringify([
    { author: 'solo', body: 'a', created_utc: 1700000000, id: 'c1', link_id: 't3_p', parent_id: 't3_p', subreddit: 'a' },
    { author: 'solo', body: 'b', created_utc: 1700000001, id: 'c2', link_id: 't3_q', parent_id: 't3_q', subreddit: 'b' },
  ]) });
  const { ds } = await runImport(reddit, fs);
  assert.equal(source(ds).view, 'authored');
  assert.equal(source(ds).egoKey, 'reddit:solo');
  assert.equal(events(ds).length, 2);
});

test('.zst dumps are detected and explained, not parsed', async () => {
  const fs = await fsFromFixtures('reddit/zst');
  const d = await reddit.detect(fs);
  assert.ok(d.score >= 0.5);
  assert.match(d.reason, /zstd -d --long=31/);
  const b = new DatasetBuilder();
  await assert.rejects(reddit.import(fs, { builder: b, options: {} }), e => e.message === ZSTD_HELP && /zstd -d --long=31/.test(e.message));
  // Mixed with readable data: imported, .zst reported.
  const mixed = await fsFromFixtures('reddit/dump', 'reddit/zst');
  const { ds } = await runImport(reddit, mixed);
  const w = ds.meta.sources[0].warnings.find(x => x.code === 'zst-skipped');
  assert.equal(w.count, 2);
});

test('does not claim unrelated files', async () => {
  const fs = await fsFromMemory({ 'data.json': '{"hello": 1}', 'x.csv': 'a,b\n1,2\n' });
  assert.equal((await reddit.detect(fs)).score, 0);
});
