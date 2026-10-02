import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bluesky, { tidToMs, parseAtUri, facetMentions, quotedUri, looksLikeCar, fetchRepo } from '../../src/importers/bluesky.js';
import { fsFromFixtures, fsFromMemory, runImport, events, node, context, source, warningCodes, countBy, fixture } from './helpers.js';

const EGO = 'bsky:did:plc:otterlab0000000000000000';
const RIVER = 'bsky:did:plc:riverotter000000000000';
const PARENT = 'bsky:did:plc:parentauth0000000000000';
const PINE = 'bsky:did:plc:pinemarten00000000000000';
const BADGER = 'bsky:did:plc:badger0000000000000000000';

test('TID decoding: 53-bit microseconds above a 10-bit clock id', () => {
  assert.equal(tidToMs('2222222222222'), 0);
  // Independent encoding of 2025-03-04T15:20:11.482Z with clock id 0.
  const ms = Date.UTC(2025, 2, 4, 15, 20, 11, 482);
  let v = BigInt(ms) * 1000n << 10n, s = '';
  for (let i = 0; i < 13; i++) { s = '234567abcdefghijklmnopqrstuvwxyz'[Number(v & 31n)] + s; v >>= 5n; }
  assert.equal(tidToMs(s), ms);
  assert.ok(Number.isNaN(tidToMs('self')));
  assert.ok(Number.isNaN(tidToMs('zzzzzzzzzzzzz'))); // top bit set
});

test('at-uri, facet byte offsets and quote embeds', () => {
  assert.deepEqual(parseAtUri('at://did:plc:abc/app.bsky.feed.post/3lk2'), { did: 'did:plc:abc', collection: 'app.bsky.feed.post', rkey: '3lk2' });
  assert.equal(parseAtUri('https://x'), null);
  // Spec example: "great notes @river-otter.example.com, see thread" with byteStart 12, byteEnd 36.
  const m = facetMentions('great notes @river-otter.example.com, see thread', [{ index: { byteStart: 12, byteEnd: 36 }, features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:riverotter000000000000' }] }]);
  assert.deepEqual(m, [{ did: 'did:plc:riverotter000000000000', label: '@river-otter.example.com' }]);
  assert.equal(quotedUri({ $type: 'app.bsky.embed.record', record: { uri: 'at://a/b/c' } }), 'at://a/b/c');
  assert.equal(quotedUri({ $type: 'app.bsky.embed.recordWithMedia', record: { record: { uri: 'at://d/e/f' } } }), 'at://d/e/f');
  assert.equal(quotedUri({ $type: 'app.bsky.embed.images' }), null);
});

test('CAR byte signature', () => {
  assert.ok(looksLikeCar(new Uint8Array(readFileSync(fixture('bluesky', 'repo.car')).subarray(0, 32))));
  assert.ok(!looksLikeCar(new TextEncoder().encode('{"roots": [], "version": 1}')));
});

test('imports a real repo.car: posts, replies, facet mentions, quotes, likes, reposts, deduped follows', async () => {
  const fs = await fsFromFixtures('bluesky/repo.car');
  const { det, ds } = await runImport(bluesky, fs);
  assert.ok(det.score >= 0.9);
  const src = source(ds);
  assert.equal(src.view, 'authored');
  assert.equal(src.format, 'bluesky');
  assert.equal(src.egoKey, EGO);
  assert.equal(src.tz, 'UTC');
  assert.equal(src.counts.posts, 5);
  assert.equal(src.counts.follows, 2);
  assert.equal(src.counts.blocks, 1);
  assert.equal(src.counts['non-bluesky-records'], 2); // chat.bsky.* and place.stream.*
  const w = warningCodes(ds);
  for (const c of ['duplicate-follow', 'createdat-mismatch', 'createdat-missing', 'non-bluesky-records', 'blocks-skipped']) assert.ok(w.includes(c), c);

  const evs = events(ds);
  assert.deepEqual(countBy(evs, e => e.type), { message: 5, repost: 3, like: 1, follow: 2 });
  for (const e of evs) assert.equal(e.actor, EGO);

  const p1 = evs.find(e => e.text?.startsWith('caf'));
  assert.equal(p1.t, Date.UTC(2025, 2, 4, 15, 20, 11, 482));
  assert.deepEqual(p1.targets, [[RIVER, 'mention']]);
  assert.equal(node(ds, RIVER).label, '@river-otter.example.com');
  assert.equal(p1.visibility, 'public');

  const p2 = evs.find(e => e.text === '@parent.example agreed');
  assert.deepEqual(p2.targets, [[PARENT, 'reply']]); // mention of the parent author not double counted
  assert.equal(p2.context, 'bsky:thread:at://did:plc:rootauthor0000000000000/app.bsky.feed.post/3lk2aaaaaaa2a');
  assert.equal(p2.parent, -1); // parent post not in an authored repo

  const p3 = evs.find(e => e.text === 'quoting this');
  assert.equal(p3.t, Date.UTC(2025, 2, 5, 9, 0, 0));
  const quotes = evs.filter(e => e.key?.startsWith('bsky:quote:'));
  assert.deepEqual(quotes.map(q => q.targets[0]).sort(), [[BADGER, 'subject'], [PINE, 'subject']]);

  const p4 = evs.find(e => e.text === 'old post imported');
  assert.equal(p4.t, Date.UTC(2019, 0, 1)); // createdAt kept, mismatch only warned
  const p5 = evs.find(e => e.text === 'continuing my thread');
  assert.equal(p5.t, Date.UTC(2025, 2, 7, 12)); // TID fallback
  assert.equal(p5.parent, p1.i); // self-reply resolves within the repo
  assert.equal(p5.context, p1.context);
  assert.deepEqual(p5.targets, []); // self-reply is not a tie

  const like = evs.find(e => e.type === 'like');
  assert.equal(like.t, Date.UTC(2025, 2, 4, 17));
  assert.deepEqual(like.targets, [[PINE, 'subject']]);
  const follows = evs.filter(e => e.type === 'follow');
  assert.deepEqual(follows.map(f => [f.targets[0][0], f.t]), [[RIVER, Date.UTC(2024, 10, 20, 8, 1, 2, 3)], [PINE, Date.UTC(2024, 11, 1)]]);

  const ego = node(ds, EGO);
  assert.equal(ego.label, 'Otter Lab');
  assert.equal(ego.attrs.description, 'Synthetic test account');
  assert.equal(node(ds, PINE).attrs.bsky_lists, 'Mustelids');
  assert.equal(context(ds, p2.context).kind, 'thread');
});

test('chat.jsonl is detected but not parsed (schema unverified)', async () => {
  const line = JSON.stringify({ id: 'm1', sentAt: '2025-01-01T00:00:00Z', sender: { did: 'did:plc:x' }, text: 'hi' });
  const fs = await fsFromMemory({ 'chat.jsonl': line + '\n' });
  const { det, ds } = await runImport(bluesky, fs);
  assert.ok(det.score >= 0.5 && det.score < 0.9);
  assert.ok(warningCodes(ds).includes('bluesky-chat-unverified'));
  assert.equal(ds.events.count, 0);
});

test('non-CAR input is not claimed', async () => {
  const fs = await fsFromMemory({ 'notes.txt': 'hello', 'data.json': '{"roots":1}' });
  assert.equal((await bluesky.detect(fs)).score, 0);
});

function fakeFetch(routes) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => r, arrayBuffer: async () => r.buffer ?? r };
  };
  f.calls = calls;
  return f;
}

test('fetchRepo resolves handle -> DID -> PDS -> getRepo (offline, injected fetch)', async () => {
  const car = new Uint8Array([1, 2, 3]);
  const did = 'did:plc:otterlab0000000000000000';
  const f = fakeFetch({
    'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=otter.example.com': { did },
    [`https://plc.directory/${did}`]: { id: did, alsoKnownAs: ['at://otter.example.com'], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.net/' }] },
    [`https://pds.example.net/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}`]: car,
  });
  const r = await fetchRepo('@Otter.Example.com', { fetch: f });
  assert.equal(r.did, did);
  assert.equal(r.handle, 'otter.example.com');
  assert.equal(r.pds, 'https://pds.example.net');
  assert.deepEqual([...r.bytes], [1, 2, 3]);
  assert.equal(f.calls.length, 3);
});

test('fetchRepo with did:web and error paths', async () => {
  const did = 'did:web:otter.example.org';
  const f = fakeFetch({
    'https://otter.example.org/.well-known/did.json': { id: did, service: [{ id: `${did}#atproto_pds`, serviceEndpoint: 'https://pds.otter.example.org' }] },
    [`https://pds.otter.example.org/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}`]: new Uint8Array([9]),
  });
  const r = await fetchRepo(did, { fetch: f });
  assert.equal(r.pds, 'https://pds.otter.example.org');
  assert.equal(r.handle, null);
  await assert.rejects(fetchRepo('nobody.example', { fetch: fakeFetch({}) }), /Handle lookup failed/);
  await assert.rejects(fetchRepo('did:key:z6Mk', { fetch: fakeFetch({}) }), /Unsupported DID method/);
  const noPds = fakeFetch({ 'https://plc.directory/did:plc:aaa': { service: [] } });
  await assert.rejects(fetchRepo('did:plc:aaa', { fetch: noPds }), /no #atproto_pds/);
});
