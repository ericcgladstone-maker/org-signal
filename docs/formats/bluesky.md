# Bluesky (AT Protocol) account repository export

Status: **high confidence**. Checked against the atproto repository spec, the official lexicons and the Bluesky app source. We also downloaded a real public repo CAR (`atproto.com`, 804 KB) and parsed it with `@atcute/repo` in Node to confirm the record shapes below. Weak spot: the `chat.jsonl` line schema is **UNVERIFIED**.

## 1. How it's obtained

| Route | Who | Output |
|---|---|---|
| App: Settings → Account → **Export my data** → "Download profile data" | account holder | `repo.car` (filename hard-coded in social-app) |
| Same dialog → "Download chat data" | account holder | `chat.jsonl`: **only messages you sent**, not received |
| `GET https://<pds>/xrpc/com.atproto.sync.getRepo?did=<did>` | **anyone, no auth** (public data) | CAR, `Content-Type: application/vnd.ipld.car` |

Notes:
- Delay: immediate (a synchronous download).
- The PDS host comes from the DID document's `service[id="#atproto_pds"].serviceEndpoint`. `bsky.social` is an entryway, and real repos live on hosts like `https://<name>.us-east.host.bsky.network`.
- Blobs (images/video) aren't in the CAR. Get them with `com.atproto.sync.listBlobs` / `getBlob`. Not needed for networks.

Tested from a shell with an `Origin` header (2026-10-02): `plc.directory`, `public.api.bsky.app` and the PDS `getRepo` all return `access-control-allow-origin: *`. So a browser-only tool **can** fetch any public repo by handle with no server:
1. `public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=…` → DID
2. `plc.directory/<did>` → PDS
3. `<pds>/xrpc/com.atproto.sync.getRepo?did=…`

`did:web` DIDs resolve via `https://<host>/.well-known/did.json`. CORS there depends on the host and is **UNVERIFIED**.

## 2. Container

```
repo.car                         # CAR v1 (DASL CAR), single binary file
├── header: varint(len) + DAG-CBOR { roots: [<commit CID>], version: 1 }
└── blocks: varint(len) + CID + DAG-CBOR bytes, repeated
    ├── commit  { did, version: 3, data: <MST root CID>, rev: <TID>, prev: null, sig: bytes }
    ├── MST nodes { l, e: [ { p, k, v, t } ] }    # key-compressed Merkle Search Tree
    └── records  (one block per record)
```

Logical view after MST walk (keys are `<collection NSID>/<record key>`):

```
did:plc:abc123…/
├── app.bsky.actor.profile/self
├── app.bsky.feed.post/<tid>…
├── app.bsky.feed.like/<tid>…
├── app.bsky.feed.repost/<tid>…
├── app.bsky.graph.follow/<tid>…
├── app.bsky.graph.block/<tid>…
├── app.bsky.graph.list/<tid>, app.bsky.graph.listitem/<tid>, app.bsky.graph.starterpack/<tid>
├── app.bsky.feed.threadgate/<tid>, app.bsky.feed.postgate/<tid>, app.bsky.feed.generator/<rkey>
├── chat.bsky.actor.declaration/self
└── <any third-party NSID>/…      # e.g. the real sample had place.stream.*, community.lexicon.calendar.*, site.standard.*
```

Repo format version is `3`, and v2 is "mostly compatible". Block order is **not guaranteed**: parsers must tolerate arbitrary order, duplicates and extra blocks.

## 3. Record schemas (lexicon field names; examples synthetic)

Every record has `$type` equal to its collection. `createdAt` is a lexicon `datetime`: RFC 3339 with a required timezone, usually `Z` with ms. Second precision without fraction also occurs (`"2026-04-24T19:30:53Z"` seen in the real repo).

### app.bsky.feed.post (rkey = TID)

| field | type | notes |
|---|---|---|
| text | string (≤300 graphemes) | |
| createdAt | datetime | **client-asserted** (can be backdated) |
| reply | {root: strongRef, parent: strongRef} | strongRef = `{uri: "at://<did>/app.bsky.feed.post/<rkey>", cid}` |
| facets[] | {index:{byteStart,byteEnd}, features:[union]} | features: `app.bsky.richtext.facet#mention {did}`, `#link {uri}`, `#tag {tag}`. **Offsets are UTF-8 byte offsets** |
| embed | union | `app.bsky.embed.record` {record: strongRef} = **quote**. `recordWithMedia` {record:{record: strongRef}, media}. Also images/video/external/gallery |
| langs[], tags[], labels | | |
| entities[] | deprecated | old mention/link format. Ignore or fall back |

```json
{ "$type": "app.bsky.feed.post",
  "text": "great notes @river-otter.example.com, see thread",
  "createdAt": "2025-03-04T15:20:11.482Z", "langs": ["en"],
  "reply": {
    "root":   { "uri": "at://did:plc:rootauthor00000000000/app.bsky.feed.post/3lk2aaaaaaa2a", "cid": "bafyreia…" },
    "parent": { "uri": "at://did:plc:parentauth0000000000/app.bsky.feed.post/3lk2bbbbbbb2b", "cid": "bafyreib…" } },
  "facets": [ { "index": { "byteStart": 12, "byteEnd": 36 },
      "features": [ { "$type": "app.bsky.richtext.facet#mention", "did": "did:plc:riverotter000000000000" } ] } ] }
```

### app.bsky.feed.like / app.bsky.feed.repost

`{ subject: strongRef(post), createdAt, via?: strongRef }`. The **target author DID sits inside `subject.uri`** (`at://<did>/…`), so the ego→author tie needs no lookup.

```json
{ "$type": "app.bsky.feed.repost", "createdAt": "2025-03-04T16:00:00.000Z",
  "subject": { "uri": "at://did:plc:pinemarten00000000000/app.bsky.feed.post/3lk2ccccccc2c", "cid": "bafyreic…" } }
```

### app.bsky.graph.follow / app.bsky.graph.block

`{ subject: <did>, createdAt, via?: strongRef }` (`via` = starter pack, follow only).

```json
{ "$type": "app.bsky.graph.follow", "subject": "did:plc:riverotter000000000000", "createdAt": "2024-11-20T08:01:02.003Z" }
```

### app.bsky.graph.list / listitem

- list = `{name, purpose: "app.bsky.graph.defs#curatelist|#modlist|#referencelist", description, createdAt}`
- listitem = `{subject: did, list: at-uri, createdAt}`

These are curated groupings: useful as node attributes or a separate "declared" layer.

### app.bsky.actor.profile (rkey `self`)

`{displayName, description, avatar(blob), banner(blob), pronouns?, website?, pinnedPost?, joinedViaStarterPack?, createdAt?}`. **No handle**: the handle lives in the DID document (`alsoKnownAs: ["at://handle"]`).

### threadgate / postgate

- threadgate `{post: at-uri, allow[], hiddenReplies[], createdAt}`: reply restrictions.
- postgate `{post, detachedEmbeddingUris[], embeddingRules[]}`.

Both are visibility/moderation metadata for ego posts.

### chat.jsonl (optional DM export)

From `chat.bsky.actor.exportAccountData` (lexicon declares only `application/jsonl` output, no schema). Bluesky's chat service is closed-source, so the line schema is **UNVERIFIED**. The `chat.bsky.convo.defs#messageView` shape (`id, rev, text, facets, sender{did}, sentAt`, plus a convo id) is a plausible but unconfirmed guess. Inspect a real file before building this importer.

## 4. Mapping to the internal model

| internal | post | like / repost | follow / block |
|---|---|---|---|
| actor | repo DID (commit `did`) | repo DID | repo DID |
| targets | reply: DID in `reply.parent.uri`. Mentions: `facets[].features[#mention].did`. Quote: DID in `embed.record.uri` (or `embed.record.record.uri`) | DID in `subject.uri` | `subject` DID |
| timestamp | `createdAt` → UTC (`Date.parse` handles `Z`/offsets) | same | same |
| context id | `reply.root.uri` (else own post uri = new thread root) | – | – |
| parent | `reply.parent.uri` | `subject.uri` | – |
| visibility | public. Threadgate restricts replies, not visibility | public | public |
| text | `text` | – | – |
| node attrs | ego: profile record. Others: DID only (handle/name need `app.bsky.actor.getProfiles`, CORS-OK, ≤25 per call) | | |

- **Declared ties:** follow (ego→subject), block (negative), listitem (list membership).
- **Interaction events:** reply, mention, quote, repost, like (each with a timestamp).
- DIDs are the stable node key (`did:plc:` 24-char base32 or `did:web:<host>`). Handles change and are display only.
- The record key TID also encodes a time: 53 bits of µs since epoch, base32-sortable `234567abcdefghijklmnopqrstuvwxyz`. That is a fallback if `createdAt` is absent or implausible.

## 5. Observation note

**Ego view, outgoing only.** The repo holds only what the ego *wrote*: their posts, likes, reposts and follows. Not visible:
- **followers** (those records live in other people's repos)
- replies/mentions/likes *received*
- ties among followers
- received DMs
- deleted records (deletion leaves no tombstone)
- mutes (private, stored on the PDS, not in the repo)

Incoming ties need either many repos or AppView queries (`app.bsky.graph.getFollowers`, `app.bsky.feed.getPostThread`). Because any public repo is downloadable, a tool can build a **multi-ego** network by importing several CARs, but each still adds only outgoing edges.

## 6. Auto-detection signature

- Extension `.car` or MIME `application/vnd.ipld.car`.
- Bytes: varint header length (typically one byte, e.g. `0x3a`), then a CBOR map of 2 entries (`0xa2`) with text keys `roots`/`version`. The real sample starts `3a a2 65 72 6f 6f 74 73` (`:¢eroots`). Check `bytes[1] === 0xa2` and that "roots" appears within the first ~16 bytes.
- Confirm by decoding the root block: a commit with `version === 3` and `did` starting `did:`.
- `chat.jsonl`: JSONL whose lines contain a `sentAt` and `sender.did` (**UNVERIFIED**, see above).

## 7. Versions, quirks, pitfalls

- **Untrusted input** (spec): cap CBOR depth and size and MST node fan-out. Expect dangling CIDs (blobs, records of other repos).
- Many **non-Bluesky collections** (third-party apps write to the same repo). Filter by `app.bsky.*` and ignore the rest, or surface them as "other activity".
- Facet byte offsets are UTF-8 based: `new TextEncoder().encode(text).slice(byteStart, byteEnd)`.
- `createdAt` is client-set and can be backdated or in the future. Flag records where `createdAt` and the rkey TID time differ by more than N days (imported posts from other platforms are a known case).
- Duplicate follows of the same DID can exist. Deduplicate by `subject`.
- Size: the real sample had ~1,800 records in 804 KB. Big accounts (100k+ likes) produce tens of MB. The spec targets single-digit millions of records max.
- Streamable block ordering (Sync v1.1) is not yet deployed (spec note, Feb 2026), so a stream parser buffers.

## 8. Browser feasibility

**Fully feasible.**
- `@atcute/repo` (v1.1.0): `fromUint8Array(buf)` or `fromStream(file.stream())` → iterate `{collection, rkey, cid, record}`. It verifies blocks by default (`verifyBlocks: false` to speed up). Depends on `@atcute/car`, `@atcute/cbor`, `@atcute/mst`. Tiny, ESM, browser-first.
- Lower-level alternatives:
  - `@ipld/car` (5.4.x) + `@ipld/dag-cbor` (10.x) / `cborg` (6.x), but you must walk the MST yourself
  - `@atproto/repo` (heavier, Node-leaning)
- Run in a Worker. Memory is about file size plus decoded records.

## Sources

Official:
- Bluesky blog "Download and Parse Repository Exports" (source md): https://github.com/bluesky-social/bsky-docs/blob/HEAD/blog/2023-11-06-repo-export.md (rendered: https://docs.bsky.app/blog/repo-export, TLS cert error when fetched)
- atproto Repository spec: https://github.com/bluesky-social/atproto-website/blob/HEAD/src/app/%5Blocale%5D/specs/repository/en.mdx
- TID spec: https://github.com/bluesky-social/atproto-website/blob/HEAD/src/app/%5Blocale%5D/specs/tid/en.mdx
- Lexicon datetime rules: https://github.com/bluesky-social/atproto-website/blob/HEAD/src/app/%5Blocale%5D/specs/lexicon/en.mdx
- Lexicons (post, like, repost, follow, block, listitem, profile, facet, threadgate, postgate, strongRef): https://github.com/bluesky-social/atproto/tree/main/lexicons/app/bsky
- Chat export lexicon: https://github.com/bluesky-social/atproto/blob/main/lexicons/chat/bsky/actor/exportAccountData.json and convo defs https://github.com/bluesky-social/atproto/blob/main/lexicons/chat/bsky/convo/defs.json
- App export dialog (`repo.car`, `chat.jsonl`): https://github.com/bluesky-social/social-app/blob/main/src/screens/Settings/components/ExportCarDialog.tsx
- Live endpoints tested for CORS: https://plc.directory/did:plc:ewvi7nxzyoun6zhxrhs64oiz , https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=atproto.com , `https://enoki.us-east.host.bsky.network/xrpc/com.atproto.sync.getRepo?did=did:plc:ewvi7nxzyoun6zhxrhs64oiz`

Community:
- `@atcute/repo` README and types (npm/unpkg): https://www.npmjs.com/package/@atcute/repo , https://unpkg.com/@atcute/repo@1.1.0/dist/types.d.ts
- npm metadata: `@atcute/car`, `@atcute/cbor`, `@ipld/car`, `@ipld/dag-cbor`, `cborg`, `@atproto/repo`
- Third-party guides (search results only): https://www.androidpolice.com/export-bluesky-data-tutorial/
