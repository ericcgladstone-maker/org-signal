// Conformance, determinism and round-trip tests for the generator's X archive,
// WhatsApp, Telegram, LinkedIn, Discord (DiscordChatExporter) and Reddit
// (NDJSON dump) writers. Conformance checks are small independent parsers
// written against docs/formats, so a writer bug cannot hide behind the
// importer; round trips then feed the same bytes to the real importers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/generator/index.js';
import { unzipSync, strFromU8 } from '../../vendor/fflate.js';
import Papa from '../../vendor/papaparse.js';
import { FileSet } from '../../src/core/fileset.js';
import { DatasetBuilder, EVENT_TYPES } from '../../src/core/model.js';

const SPECS = {
  x: { context: 'online', medium: 'x', size: 200, seed: 21, output: 'native' },
  waIos: { context: 'personal', medium: 'whatsapp', size: 30, seed: 21, output: 'native', content: 'full' },
  waAndroidDe: { context: 'personal', medium: 'whatsapp', size: 30, seed: 21, output: 'native', platform: 'android', locale: 'de-DE' },
  waIosEs: { context: 'personal', medium: 'whatsapp', size: 30, seed: 21, output: 'native', locale: 'es-ES' },
  waAndroidFi: { context: 'personal', medium: 'whatsapp', size: 30, seed: 21, output: 'native', platform: 'android', locale: 'fi-FI' },
  waChat: { context: 'personal', medium: 'whatsapp', size: 30, seed: 21, output: 'native', observation: 'chat' },
  telegram: { context: 'personal', medium: 'telegram', size: 30, seed: 21, output: 'native' },
  telegramChat: { context: 'personal', medium: 'telegram', size: 30, seed: 21, output: 'native', observation: 'chat' },
  linkedin: { context: 'professional', medium: 'linkedin', size: 120, seed: 21, output: 'native' },
  discord: { context: 'community', medium: 'discord', size: 60, seed: 21, output: 'native', timespan: { start: '2025-04-07', days: 21 } },
  reddit: { context: 'community', medium: 'reddit', size: 60, seed: 21, output: 'native', timespan: { start: '2025-04-07', days: 14 } },
  redditSample: { context: 'community', medium: 'reddit', size: 60, seed: 21, output: 'native', timespan: { start: '2025-04-07', days: 14 }, observation: { view: 'sample', rate: 0.5 } },
};
const cache = new Map();
const gen = k => { if (!cache.has(k)) cache.set(k, generate(SPECS[k])); return cache.get(k); };
const unz = f => unzipSync(f.bytes);
const text = b => strFromU8(b);
const typeCounts = ds => { const o = {}; for (let i = 0; i < ds.events.count; i++) { const t = EVENT_TYPES[ds.events.type[i]]; o[t] = (o[t] || 0) + 1; } return o; };

// ---- determinism --------------------------------------------------------------

test('every writer is byte-identical for the same spec and seed', () => {
  for (const k of ['x', 'waIos', 'waAndroidDe', 'telegram', 'linkedin', 'discord', 'reddit']) {
    const a = generate(SPECS[k]).files, b = generate(SPECS[k]).files;
    assert.equal(a.length, b.length, k);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i].path, b[i].path, k);
      assert.deepEqual(a[i].bytes, b[i].bytes, `${k}: ${a[i].path}`);
    }
  }
});

// ---- X archive ----------------------------------------------------------------

const ytd = s => JSON.parse(s.slice(s.indexOf('=') + 1));

test('X archive: layout, wrappers, manifest and string ids', () => {
  const { files, groundTruth } = gen('x');
  assert.equal(files.length, 1);
  assert.match(files[0].path, /^twitter-\d{4}-\d{2}-\d{2}-[0-9a-f]+\.zip$/);
  const z = unz(files[0]);
  const m = text(z['data/manifest.js']);
  assert.match(m, /^window\.__THAR_CONFIG = \{/);
  const manifest = ytd(m);
  assert.equal(manifest.userInfo.accountId, groundTruth.observation.egoKey.slice(2));
  const listed = new Set();
  for (const [type, info] of Object.entries(manifest.dataTypes)) {
    assert.match(type, /^[a-z][A-Za-z]*$/, 'dataTypes keys are camelCase');
    for (const f of info.files) {
      listed.add(f.fileName);
      const s = text(z[f.fileName]);
      // Global name uses underscores; file name uses hyphens.
      assert.ok(s.startsWith(`window.${f.globalName} = `), f.fileName);
      assert.match(f.globalName, /^YTD\.[a-z_]+\.part\d+$/);
      const arr = ytd(s);
      assert.ok(Array.isArray(arr));
      assert.equal(String(arr.length), f.count, `count for ${f.fileName}`);
      assert.equal(typeof f.count, 'string');
    }
  }
  for (const p of Object.keys(z)) if (/^data\/.*\.js$/.test(p) && p !== 'data/manifest.js') assert.ok(listed.has(p), `${p} listed in manifest`);
  assert.equal(text(z['data/block.js']), 'window.YTD.block.part0 = [ ]');
  assert.ok(text(z['data/direct-messages-group.js']).startsWith('window.YTD.direct_messages_group.part0 ='));

  const tweets = ytd(text(z['data/tweets.js'])).map(x => x.tweet);
  assert.ok(tweets.length > 0);
  const ids = new Set();
  let replies = 0, rts = 0;
  for (const t of tweets) {
    for (const k of ['id', 'id_str', 'favorite_count', 'retweet_count']) assert.equal(typeof t[k], 'string', k);
    assert.equal(t.id, t.id_str);
    assert.match(t.created_at, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} \+0000 \d{4}$/);
    assert.ok(t.display_text_range.every(x => typeof x === 'string'));
    for (const u of t.entities.user_mentions) { assert.equal(typeof u.id_str, 'string'); assert.ok(u.indices.every(x => typeof x === 'string')); }
    assert.ok(!/[<>]/.test(t.full_text.replace(/&lt;|&gt;/g, '')), 'full_text is HTML-escaped');
    // Snowflake time matches created_at (to the second).
    const ms = Number((BigInt(t.id) >> 22n) + 1288834974657n);
    if (!/^RT @/.test(t.full_text)) assert.ok(Math.abs(ms - Date.parse(t.created_at)) < 1000, 'snowflake decodes to created_at');
    if (t.in_reply_to_status_id_str) { replies++; assert.equal(typeof t.in_reply_to_user_id_str, 'string'); }
    if (/^RT @\w+:/.test(t.full_text)) { rts++; assert.equal(t.entities.user_mentions[0].screen_name, /^RT @(\w+):/.exec(t.full_text)[1]); }
    ids.add(t.id);
  }
  assert.equal(ids.size, tweets.length, 'tweet ids unique');
  assert.ok(replies + rts > 0, 'some replies or retweets');
  for (const f of ['follower', 'following']) for (const x of ytd(text(z[`data/${f}.js`]))) {
    assert.equal(typeof x[f].accountId, 'string');
    assert.equal(x[f].userLink, `https://twitter.com/intent/user?user_id=${x[f].accountId}`);
  }
  for (const l of ytd(text(z['data/like.js']))) { assert.equal(typeof l.like.tweetId, 'string'); assert.equal(l.like.expandedUrl, `https://twitter.com/i/web/status/${l.like.tweetId}`); }
  for (const c of ytd(text(z['data/direct-messages.js']))) {
    assert.match(c.dmConversation.conversationId, /^\d+-\d+$/);
    const ts = c.dmConversation.messages.map(m => Date.parse(m.messageCreate.createdAt));
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i] <= ts[i - 1], 'DMs reverse chronological');
    for (const m of c.dmConversation.messages) assert.match(m.messageCreate.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }
});

// ---- WhatsApp -----------------------------------------------------------------

// The reference header regex from the spec (whatsapp-chat-parser v4).
const SHARED = /^(?:‎|‏)*\[?(\d{1,4}[-/.]\s?\d{1,4}[-/.]\s?\d{1,4})[,.]?\s\D*?(\d{1,2}[.:]\d{1,2}(?:[.:]\d{1,2})?)(?:\s([ap]\.?\s?m\.?))?\]?(?:\s-|:)?\s/i;

function chatTexts(files) {
  return files.map(f => {
    if (f.path.endsWith('.zip')) { const z = unz(f); assert.deepEqual(Object.keys(z), ['_chat.txt']); return { path: f.path, text: text(z['_chat.txt']) }; }
    return { path: f.path, text: text(f.bytes) };
  });
}

function checkGrammar(chats, { ios }) {
  let headers = 0, cont = 0;
  for (const { text: t } of chats) {
    const lines = t.replace(/\n$/, '').split('\n');
    assert.ok(SHARED.test(lines[0]), 'first line is a header');
    for (const l of lines) {
      if (SHARED.test(l)) {
        headers++;
        assert.equal(l.replace(/^‎/, '').startsWith('['), ios, `platform style: ${l}`);
        if (!ios) assert.match(l, / - /);
      } else { cont++; assert.ok(!/^\[?\d{1,4}[./-]\d{1,4}[./-]\d{1,4}/.test(l), 'continuation does not look like a header'); }
    }
  }
  return { headers, cont };
}

test('WhatsApp iOS en-US: zip per chat, _chat.txt grammar, LRM and NNBSP marks', () => {
  const { files } = gen('waIos');
  assert.ok(files.length > 3);
  for (const f of files) assert.match(f.path, /^WhatsApp Chat - .+\.zip$/);
  const chats = chatTexts(files);
  const { headers, cont } = checkGrammar(chats, { ios: true });
  assert.ok(headers > 100 && cont > 0, 'multi-line messages present');
  const all = chats.map(c => c.text).join('\n');
  assert.match(all, /^‎\[\d{1,2}\/\d{1,2}\/\d{2}, \d{1,2}:\d{2}:\d{2} (AM|PM)\] [^:]+: ‎Messages and calls are end-to-end encrypted/m, 'E2E notice with LRM and NNBSP');
  assert.match(all, /: ‎(Image|Video|Sticker|Audio|GIF) omitted$/mi, 'media omitted with LRM');
  assert.match(all, /‎<This message was edited\.>$/m);
  assert.match(all, /@⁨[^⁩]+⁩/, 'mention isolates');
});

test('WhatsApp Android de-DE and fi-FI, iOS es-ES: locale date/time shapes', () => {
  const de = chatTexts(gen('waAndroidDe').files);
  for (const f of gen('waAndroidDe').files) assert.match(f.path, /^WhatsApp Chat with .+\.txt$/);
  checkGrammar(de, { ios: false });
  const deAll = de.map(c => c.text).join('\n');
  assert.match(deAll, /^\d{2}\.\d{2}\.\d{2}, \d{2}:\d{2} - [^:]+: /m);
  assert.match(deAll, /<Media omitted>/);
  assert.match(deAll, /^\d{2}\.\d{2}\.\d{2}, \d{2}:\d{2} - Messages and calls are end-to-end encrypted/m, 'Android system line has no author');
  const fi = chatTexts(gen('waAndroidFi').files);
  checkGrammar(fi, { ios: false });
  assert.match(fi.map(c => c.text).join('\n'), /^\d{1,2}\.\d{1,2}\.\d{4} klo \d{1,2}\.\d{2} - /m);
  const es = chatTexts(gen('waIosEs').files);
  checkGrammar(es, { ios: true });
  assert.match(es.map(c => c.text).join('\n'), /\[\d{1,2}\/\d{1,2}\/\d{2}, \d{1,2}:\d{2}:\d{2} [ap]\. m\.\] /);
});

test('WhatsApp chat view writes one conversation', () => {
  const { files, dataset } = gen('waChat');
  assert.equal(files.length, 1);
  assert.equal(dataset.contexts.count, 1);
});

// ---- Telegram -----------------------------------------------------------------

test('Telegram full and single-chat export: shape, unixtime strings, entities, replies', () => {
  const { files } = gen('telegram');
  assert.match(files[0].path, /^DataExport_\d{4}-\d{2}-\d{2}\.zip$/);
  const z = unz(files[0]);
  const [p] = Object.keys(z);
  assert.match(p, /^DataExport_\d{4}-\d{2}-\d{2}\/result\.json$/);
  const raw = text(z[p]);
  assert.match(raw, /^\{\n "about"/, 'one-space indentation');
  const res = JSON.parse(raw);
  assert.equal(typeof res.personal_information.user_id, 'number');
  assert.ok(res.contacts.list.length > 0 && res.chats.list.length > 0);
  let replies = 0, service = 0, mentions = 0;
  for (const c of res.chats.list) {
    assert.ok(['personal_chat', 'private_group', 'private_supergroup'].includes(c.type));
    assert.equal(typeof c.id, 'number');
    const ids = new Set();
    let prev = -1;
    for (const m of c.messages) {
      assert.ok(m.id > prev, 'ascending ids'); prev = m.id; ids.add(m.id);
      assert.match(m.date_unixtime, /^\d+$/);
      assert.match(m.date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, 'local date, no offset');
      assert.ok(Array.isArray(m.text_entities));
      assert.ok(typeof m.text === 'string' || Array.isArray(m.text));
      // text and text_entities carry the same characters
      const flat = Array.isArray(m.text) ? m.text.map(x => (typeof x === 'string' ? x : x.text)).join('') : m.text;
      assert.equal(flat, m.text_entities.map(e => e.text).join(''));
      if (m.type === 'message') assert.match(m.from_id, /^user\d+$/);
      if (m.type === 'service') { service++; assert.match(m.actor_id, /^user\d+$/); assert.ok(m.action); }
      if (m.reply_to_message_id) { replies++; assert.ok(ids.has(m.reply_to_message_id), 'reply parent exists earlier in the chat'); }
      if (m.text_entities.some(e => e.type === 'mention_name')) mentions++;
    }
  }
  assert.ok(replies > 0 && service > 0 && mentions > 0);
  const single = JSON.parse(text(Object.values(unz(gen('telegramChat').files[0]))[0]));
  assert.ok(single.name && single.type && Array.isArray(single.messages) && !single.chats);
  assert.match(Object.keys(unz(gen('telegramChat').files[0]))[0], /^ChatExport_\d{4}-\d{2}-\d{2}\/result\.json$/);
});

// ---- LinkedIn -----------------------------------------------------------------

test('LinkedIn: zip name, Connections preamble and headers, per-file date formats', () => {
  const { files } = gen('linkedin');
  assert.match(files[0].path, /^Complete_LinkedInDataExport_\d{2}-\d{2}-\d{4}\.zip$/);
  const z = unz(files[0]);
  const conn = text(z['Connections.csv']).split('\n');
  assert.equal(conn[0], 'Notes:');
  assert.match(conn[1], /^"When exporting your connection data, you may notice that some of the email addresses are missing\..*answer\/261"$/);
  assert.equal(conn[2], '');
  assert.equal(conn[3], 'First Name,Last Name,URL,Email Address,Company,Position,Connected On');
  const rows = Papa.parse(conn.slice(3).join('\n'), { header: true, skipEmptyLines: true }).data;
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.match(r['Connected On'], /^\d{2} [A-Z][a-z]{2} \d{4}$/);
    assert.match(r.URL, /^https:\/\/www\.linkedin\.com\/in\/[a-z0-9-]+$/);
  }
  assert.ok(rows.filter(r => r['Email Address']).length < rows.length / 2, 'emails mostly missing');
  const msg = text(z['messages.csv']);
  assert.ok(msg.startsWith('CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER,ATTACHMENTS,IS MESSAGE DRAFT,IS CONVERSATION DRAFT\n'));
  const mrows = Papa.parse(msg, { header: true, skipEmptyLines: true }).data;
  assert.ok(mrows.length > 0);
  for (const r of mrows) { assert.match(r.DATE, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/); assert.equal(r.FOLDER, 'INBOX'); assert.equal(r['IS MESSAGE DRAFT'], 'No'); }
  const inv = Papa.parse(text(z['Invitations.csv']), { header: true, skipEmptyLines: true });
  assert.deepEqual(inv.meta.fields, ['From', 'To', 'Sent At', 'Message', 'Direction', 'inviterProfileUrl', 'inviteeProfileUrl']);
  for (const r of inv.data) { assert.match(r['Sent At'], /^\d{1,2}\/\d{1,2}\/\d{2}, \d{1,2}:\d{2} (AM|PM)$/); assert.ok(['INCOMING', 'OUTGOING'].includes(r.Direction)); }
  for (const f of ['Profile.csv', 'Positions.csv', 'Education.csv']) assert.ok(z[f], f);
  assert.match(text(z['Positions.csv']), /^Company Name,Title,Description,Location,Started On,Finished On\n/);
});

// ---- Discord ------------------------------------------------------------------

test('Discord: DiscordChatExporter JSON per channel, references and reactions resolve', () => {
  const { files } = gen('discord');
  assert.ok(files.length >= 2);
  let replies = 0, reactions = 0;
  for (const f of files) {
    const m = /^(.+) - Text Channels - (.+) \[(\d+)\]\.json$/.exec(f.path);
    assert.ok(m, f.path);
    const doc = JSON.parse(text(f.bytes));
    assert.equal(doc.channel.id, m[3]);
    assert.equal(doc.channel.type, 'GuildTextChat');
    assert.equal(doc.messageCount, doc.messages.length);
    assert.equal(typeof doc.guild.id, 'string');
    const ids = new Set();
    for (const msg of doc.messages) {
      assert.match(msg.id, /^\d{17,20}$/);
      assert.match(msg.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
      assert.ok(['Default', 'Reply', 'GuildMemberJoin'].includes(msg.type));
      assert.equal(typeof msg.author.id, 'string');
      assert.equal(typeof msg.author.isBot, 'boolean');
      for (const k of ['attachments', 'embeds', 'stickers', 'reactions', 'mentions', 'inlineEmojis']) assert.ok(Array.isArray(msg[k]), k);
      if (msg.type === 'Reply') {
        replies++;
        assert.equal(msg.reference.type, 'Default');
        assert.ok(ids.has(msg.reference.messageId), 'reply references an earlier message in this channel');
        assert.equal(msg.reference.channelId, doc.channel.id);
      }
      for (const r of msg.reactions) { reactions++; assert.equal(r.count, r.users.length); assert.ok(r.emoji.name && r.emoji.code); }
      ids.add(msg.id);
    }
  }
  assert.ok(replies > 0 && reactions > 0);
});

// ---- Reddit -------------------------------------------------------------------

function readDump(files) {
  const subs = [], coms = [];
  for (const f of files) {
    const lines = text(f.bytes).split('\n').filter(Boolean);
    const objs = lines.map(l => JSON.parse(l));
    for (const o of objs) assert.deepEqual(Object.keys(o), Object.keys(o).slice().sort(), 'keys sorted');
    for (let i = 1; i < objs.length; i++) assert.ok(objs[i].created_utc > objs[i - 1].created_utc || (objs[i].created_utc === objs[i - 1].created_utc && parseInt(objs[i].id, 36) > parseInt(objs[i - 1].id, 36)), 'ordered by (created_utc, id)');
    if (/_submissions\.ndjson$/.test(f.path)) subs.push(...objs); else if (/_comments\.ndjson$/.test(f.path)) coms.push(...objs); else assert.fail(f.path);
  }
  return { subs, coms };
}

test('Reddit: NDJSON dumps with prefixed parents that resolve', () => {
  const { subs, coms } = readDump(gen('reddit').files);
  assert.ok(subs.length > 0 && coms.length > 0);
  const subIds = new Set(subs.map(s => s.id)), comIds = new Set(coms.map(c => c.id));
  for (const s of subs) {
    assert.match(s.id, /^[0-9a-z]+$/); assert.equal(s.name, 't3_' + s.id);
    assert.equal(typeof s.created_utc, 'number'); assert.match(s.subreddit_id, /^t5_/); assert.match(s.author_fullname, /^t2_/);
    assert.ok(typeof s.title === 'string' && s.title.length > 0);
  }
  for (const c of coms) {
    assert.equal(c.name, 't1_' + c.id);
    assert.match(c.link_id, /^t3_/); assert.match(c.parent_id, /^t[13]_/);
    assert.ok(subIds.has(c.link_id.slice(3)), 'link resolves');
    assert.ok(c.parent_id.startsWith('t3_') ? c.parent_id === c.link_id : comIds.has(c.parent_id.slice(3)), 'parent resolves');
  }
  assert.ok(coms.some(c => c.author === 'AutoModerator' && c.distinguished === 'moderator'));
  for (const s of subs) assert.equal(s.num_comments, coms.filter(c => c.link_id === 't3_' + s.id).length);
});

test('Reddit sample view keeps only sampled authors', () => {
  const full = readDump(gen('reddit').files), samp = readDump(gen('redditSample').files);
  assert.ok(samp.coms.length < full.coms.length && samp.coms.length > 0);
  assert.ok(!samp.coms.some(c => c.author === 'AutoModerator'));
});

// ---- round trips through the real importers ------------------------------------

let registry = null, loadError = null;
try { registry = await import('../../src/importers/registry.js'); } catch (e) { loadError = e; }

async function roundTrip(files, expectId, options = {}) {
  const fs = await FileSet.from(files.map(f => ({ blob: new Blob([f.bytes]), path: f.path })));
  const det = await registry.detectAll(fs);
  assert.equal(det[0]?.importer.id, expectId, `detected ${det.map(d => d.importer.id + ':' + d.score).join(', ')}`);
  const builder = new DatasetBuilder();
  await det[0].importer.import(fs, { builder, options, progress: () => {}, signal: new AbortController().signal });
  return builder.build();
}

const haveImporter = id => !loadError && registry?.importerById(id);
const rt = (name, id, fn) => (haveImporter(id) ? test(name, fn) : test.skip(`${name} (importer ${id} not available: ${loadError?.message || 'not registered'})`, () => {}));

// A full-view dataset lists every member; an export only shows people who
// posted, reacted or were mentioned. Every imported person must be one of ours.
function sameKeysSubset(imported, ours) {
  const keys = new Set(ours.nodes.keys);
  const humans = imported.nodes.keys.filter((k, i) => !imported.nodes.isBot[i]);
  const missing = humans.filter(k => !keys.has(k));
  assert.deepEqual(missing, [], 'imported people keys exist in the generated dataset');
  assert.ok(imported.nodes.count <= ours.nodes.count);
}

// Count events of a type in our dataset whose actor is the ego.
function egoCount(ds, egoKey, type, pred = () => true) {
  const ego = ds.nodes.keys.indexOf(egoKey);
  const ti = EVENT_TYPES.indexOf(type);
  let n = 0;
  for (let i = 0; i < ds.events.count; i++) if (ds.events.type[i] === ti && ds.events.actor[i] === ego && pred(i)) n++;
  return n;
}

rt('round trip: X archive -> x-archive importer', 'x-archive', async () => {
  const { files, dataset, groundTruth } = gen('x');
  const ds = await roundTrip(files, 'x-archive');
  const z = unz(files[0]);
  const counts = Object.fromEntries(Object.entries(ytd(text(z['data/manifest.js'])).dataTypes).map(([k, v]) => [k, v.files.reduce((s, f) => s + Number(f.count), 0)]));
  const got = typeCounts(ds);
  const egoKey = groundTruth.observation.egoKey;
  assert.equal(ds.meta.sources[0].egoKey, egoKey, 'same ego key');
  // Our ego view also holds others' replies and likes aimed at the ego, which an
  // archive never shows, so compare the ego's own actions.
  const ownPosts = egoCount(dataset, egoKey, 'message', i => dataset.events.context[i] < 0);
  const dmContexts = new Set(); for (let c = 0; c < dataset.contexts.count; c++) if (dataset.contexts.kinds[c] === 'dm') dmContexts.add(c);
  let dms = 0; for (let i = 0; i < dataset.events.count; i++) if (dmContexts.has(dataset.events.context[i])) dms++;
  assert.equal(got.message, ownPosts + dms, 'tweets (non-retweet) + DMs');
  assert.equal(got.repost, egoCount(dataset, egoKey, 'repost'));
  assert.equal(got.like, egoCount(dataset, egoKey, 'like'));
  assert.equal(got.follow, counts.follower + counts.following, 'follow lists are a snapshot');
  // Mentioned and replied-to accounts land on the same x:<id> keys as ours.
  const ours = new Set(dataset.nodes.keys);
  const shared = ds.nodes.keys.filter(k => ours.has(k)).length;
  assert.ok(shared >= Math.min(ds.nodes.count, dataset.nodes.count) * 0.5, `shared node keys ${shared}`);
});

rt('round trip: WhatsApp iOS and Android -> whatsapp importer', 'whatsapp', async () => {
  for (const k of ['waIos', 'waAndroidDe']) {
    const { files, dataset } = gen(k);
    // US month-first dates are ambiguous in short chats (spec: offer a manual
    // override), so tell the importer the order the phone used.
    const ds = await roundTrip(files, 'whatsapp', { timezone: 'UTC', dateOrder: k === 'waIos' ? 'month-first' : 'day-first' });
    const got = typeCounts(ds), ours = typeCounts(dataset);
    assert.equal(got.message, ours.message, `${k}: message count`);
    assert.equal(ds.nodes.count, dataset.nodes.count, `${k}: participants`);
    // Joins and leaves are system lines in the export; our ego-view dataset drops
    // them because they carry no target (see report), so only check presence.
    assert.ok((got.join || 0) + (got.leave || 0) > 0, `${k}: membership notices parsed`);
    // Times: iOS keeps seconds, Android minutes. Compare sorted time lists.
    const ta = Array.from(ds.events.t).filter((_, i) => ds.events.type[i] === 0).sort((a, b) => a - b);
    const tb = Array.from(dataset.events.t).filter((_, i) => dataset.events.type[i] === 0).sort((a, b) => a - b);
    const tol = k === 'waIos' ? 1000 : 60000;
    let bad = 0; for (let i = 0; i < ta.length; i++) if (Math.abs(ta[i] - tb[i]) > tol) bad++;
    assert.equal(bad, 0, `${k}: times match within ${tol} ms`);
  }
});

rt('round trip: Telegram -> telegram importer', 'telegram', async () => {
  const { files, dataset } = gen('telegram');
  const ds = await roundTrip(files, 'telegram');
  const res = JSON.parse(text(Object.values(unz(files[0]))[0]));
  const inFile = res.chats.list.reduce((s, c) => s + c.messages.filter(m => m.type === 'message').length, 0);
  const got = typeCounts(ds);
  assert.equal(got.message, inFile);
  // Deleted messages are absent from Telegram exports but present in our dataset.
  assert.ok(got.message <= typeCounts(dataset).message && got.message >= typeCounts(dataset).message * 0.95);
  assert.equal(ds.nodes.count, dataset.nodes.count);
  const ours = new Set(dataset.nodes.keys);
  assert.ok(ds.nodes.keys.every(k => ours.has(k)), 'telegram:user<N> keys match');
});

rt('round trip: LinkedIn -> linkedin importer', 'linkedin', async () => {
  const { files, dataset } = gen('linkedin');
  const ds = await roundTrip(files, 'linkedin');
  const got = typeCounts(ds), ours = typeCounts(dataset);
  assert.equal(got.message, ours.message);
  // The importer adds a declared tie per invitation as well as per connection.
  const z = unz(files[0]);
  const conns = text(z['Connections.csv']).split('\n').slice(4).filter(Boolean).length;
  assert.equal(ours.declared, conns, 'our ego view has one declared tie per connection');
  assert.ok(got.declared >= conns);
  assert.equal(ds.nodes.count, dataset.nodes.count);
});

rt('round trip: Discord (DCE JSON) -> discord importer', 'discord', async () => {
  const { files, dataset } = gen('discord');
  const ds = await roundTrip(files, 'discord');
  const got = typeCounts(ds), ours = typeCounts(dataset);
  assert.equal(got.message, ours.message);
  assert.equal(got.join || 0, ours.join || 0);
  // DCE lists each user once per emoji per message, so repeat reactions collapse.
  assert.ok(got.reaction <= ours.reaction && got.reaction >= ours.reaction * 0.9);
  sameKeysSubset(ds, dataset);
});

rt('round trip: Reddit NDJSON -> reddit importer', 'reddit', async () => {
  const { files, dataset } = gen('reddit');
  const ds = await roundTrip(files, 'reddit');
  assert.equal(typeCounts(ds).message, typeCounts(dataset).message);
  sameKeysSubset(ds, dataset);
});
