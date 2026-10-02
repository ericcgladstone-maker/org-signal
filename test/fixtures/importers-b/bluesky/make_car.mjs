// Builds repo.car for the bluesky tests with atcute's own MST + CAR writer, so
// the importer parses a structurally real repository (signed-commit shape, MST
// key compression, CID-verified blocks).
//
// Run: ATCUTE=<path to node_modules/@atcute> node make_car.mjs
// (the lead's scratchpad vendor-build/node_modules has the packages).
import { writeFileSync } from 'node:fs';
const A = process.env.ATCUTE;
const cbor = await import(`${A}/cbor/dist/index.js`);
const cid = await import(`${A}/cid/dist/index.js`);
const mst = await import(`${A}/mst/dist/index.js`);
const carw = await import(`${A}/car/dist/index.js`);

const ALPH = '234567abcdefghijklmnopqrstuvwxyz';
// TID = 0 | 53-bit microseconds | 10-bit clock id, base32-sortable, 13 chars.
function tid(ms, clock = 7) {
  let v = (BigInt(ms) * 1000n << 10n) | BigInt(clock);
  let s = '';
  for (let i = 0; i < 13; i++) { s = ALPH[Number(v & 31n)] + s; v >>= 5n; }
  return s;
}

const EGO = 'did:plc:otterlab0000000000000000';
const RIVER = 'did:plc:riverotter000000000000';
const PARENT = 'did:plc:parentauth0000000000000';
const ROOT = 'did:plc:rootauthor0000000000000';
const PINE = 'did:plc:pinemarten00000000000000';
const BADGER = 'did:plc:badger0000000000000000000';
const ms = s => Date.parse(s);

const recs = [];
const add = (coll, rkey, rec) => recs.push([`${coll}/${rkey}`, { $type: coll, ...rec }]);
const T = {
  p1: '2025-03-04T15:20:11.482Z', p2: '2025-03-04T16:00:00.000Z', p3: '2025-03-05T09:00:00Z',
  p4: '2025-03-06T10:00:00.000Z', like: '2025-03-04T17:00:00.000Z', repost: '2025-03-04T18:00:00.000Z',
  f1: '2024-11-20T08:01:02.003Z', f2: '2024-11-21T08:00:00.000Z', f3: '2024-12-01T00:00:00.000Z',
};
add('app.bsky.actor.profile', 'self', { displayName: 'Otter Lab', description: 'Synthetic test account', createdAt: '2024-11-01T00:00:00.000Z' });
// p1: multibyte text before the mention so byte offsets differ from UTF-16 offsets.
const p1text = 'caf\u00e9 \u{1F44D} @river-otter.example.com see thread';
const pre = new TextEncoder().encode('caf\u00e9 \u{1F44D} ').length;
const men = new TextEncoder().encode('@river-otter.example.com').length;
add('app.bsky.feed.post', tid(ms(T.p1)), { text: p1text, createdAt: T.p1, langs: ['en'],
  facets: [{ index: { byteStart: pre, byteEnd: pre + men }, features: [{ $type: 'app.bsky.richtext.facet#mention', did: RIVER }] },
           { index: { byteStart: 0, byteEnd: 4 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'cafe' }] }] });
// p2: reply (parent and root by different authors) that also mentions the parent author.
add('app.bsky.feed.post', tid(ms(T.p2)), { text: '@parent.example agreed', createdAt: T.p2,
  reply: { root: { uri: `at://${ROOT}/app.bsky.feed.post/3lk2aaaaaaa2a`, cid: 'bafyreiaaaa' }, parent: { uri: `at://${PARENT}/app.bsky.feed.post/3lk2bbbbbbb2b`, cid: 'bafyreibbbb' } },
  facets: [{ index: { byteStart: 0, byteEnd: 15 }, features: [{ $type: 'app.bsky.richtext.facet#mention', did: PARENT }] }] });
// p3: quote via embed.record, second-precision createdAt.
add('app.bsky.feed.post', tid(ms(T.p3)), { text: 'quoting this', createdAt: T.p3,
  embed: { $type: 'app.bsky.embed.record', record: { uri: `at://${PINE}/app.bsky.feed.post/3lk2ccccccc2c`, cid: 'bafyreicccc' } } });
// p4: quote via recordWithMedia, backdated createdAt (rkey TID is 2025-03-06, createdAt 2019).
add('app.bsky.feed.post', tid(ms(T.p4)), { text: 'old post imported', createdAt: '2019-01-01T00:00:00.000Z',
  embed: { $type: 'app.bsky.embed.recordWithMedia', record: { record: { uri: `at://${BADGER}/app.bsky.feed.post/3lk2ddddddd2d`, cid: 'bafyreidddd' } }, media: { $type: 'app.bsky.embed.images', images: [] } } });
// p5: no createdAt -> TID fallback; self-reply to p1 (thread root = p1).
const p1uri = `at://${EGO}/app.bsky.feed.post/${tid(ms(T.p1))}`;
add('app.bsky.feed.post', tid(ms('2025-03-07T12:00:00.000Z')), { text: 'continuing my thread',
  reply: { root: { uri: p1uri, cid: 'x' }, parent: { uri: p1uri, cid: 'x' } } });
add('app.bsky.feed.like', tid(ms(T.like)), { createdAt: T.like, subject: { uri: `at://${PINE}/app.bsky.feed.post/3lk2ccccccc2c`, cid: 'bafyreicccc' } });
add('app.bsky.feed.repost', tid(ms(T.repost)), { createdAt: T.repost, subject: { uri: `at://${PINE}/app.bsky.feed.post/3lk2ccccccc2c`, cid: 'bafyreicccc' } });
add('app.bsky.graph.follow', tid(ms(T.f1)), { subject: RIVER, createdAt: T.f1 });
add('app.bsky.graph.follow', tid(ms(T.f2)), { subject: RIVER, createdAt: T.f2 }); // duplicate subject
add('app.bsky.graph.follow', tid(ms(T.f3)), { subject: PINE, createdAt: T.f3 });
add('app.bsky.graph.block', tid(ms(T.f3), 9), { subject: BADGER, createdAt: T.f3 });
const listRkey = tid(ms('2024-12-02T00:00:00.000Z'));
add('app.bsky.graph.list', listRkey, { name: 'Mustelids', purpose: 'app.bsky.graph.defs#curatelist', createdAt: '2024-12-02T00:00:00.000Z' });
add('app.bsky.graph.listitem', tid(ms('2024-12-02T00:01:00.000Z')), { subject: PINE, list: `at://${EGO}/app.bsky.graph.list/${listRkey}`, createdAt: '2024-12-02T00:01:00.000Z' });
add('chat.bsky.actor.declaration', 'self', { allowIncoming: 'following' });
add('place.stream.chat.message', tid(ms(T.p1), 3), { text: 'third-party', createdAt: T.p1 });

const blocks = new mst.MemoryBlockStore();
const wr = new mst.NodeWrangler(new mst.NodeStore(blocks));
let root = null;
for (const [key, rec] of recs) {
  const bytes = cbor.encode(rec);
  const c = await cid.create(0x71, bytes);
  await blocks.put(cid.toString(c), bytes);
  root = await wr.putRecord(root, key, cid.toCidLink(c));
}
const commit = { did: EGO, version: 3, data: { $link: root }, rev: tid(ms('2025-03-08T00:00:00.000Z')), prev: null, sig: cbor.toBytes(new Uint8Array(64)) };
const cBytes = cbor.encode(commit);
const cCid = await cid.create(0x71, cBytes);
const out = [];
const all = [{ cid: cCid.bytes, data: cBytes }];
for (const [k, v] of blocks.blocks) all.push({ cid: cid.fromString(k).bytes, data: v });
for await (const chunk of carw.writeCarStream([cid.toCidLink(cCid)], all)) out.push(chunk);
writeFileSync(new URL('./repo.car', import.meta.url), Buffer.concat(out));
console.log('wrote repo.car', recs.length, 'records');
