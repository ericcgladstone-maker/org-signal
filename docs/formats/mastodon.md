# Mastodon account archive and CSV exports

Status: **high confidence**. Taken directly from Mastodon `main` source (`BackupService`, ActivityPub serializers, `TagManager#to/#cc`, `Export`), cross-checked with a sample archive on GitHub. Other fediverse servers (Pleroma/Akkoma, Misskey, GoToSocial, …) export differently: **not covered, UNVERIFIED**.

## 1. How it's obtained

| Export | Where | Notes |
|---|---|---|
| Archive (zip) | Preferences → Import and export → Data export → "Request your archive" | **One request per 6 days** (`BackupPolicy::MIN_AGE = 6.days`). Background job, then email "backup ready". Filename `archive-<YYYYMMDDHHMMSS>-<32 hex>.zip`. A new archive deletes older ones. Delay: minutes to hours (queue dependent) |
| CSVs | same page, per-item links | instant download. Filenames = controller names (below) |

Available CSVs (from the `Export` model): `following_accounts.csv`, `lists.csv`, `blocked_accounts.csv`, `muted_accounts.csv`, `blocked_domains.csv`, `bookmarks.csv` (also `custom_filters.json`). **There is no followers CSV.**

## 2. Archive tree

```
archive-20250102031500-0123456789abcdef0123456789abcdef.zip
├── actor.json            # ActivityPub Person; outbox/likes/bookmarks rewritten to local filenames
├── outbox.json           # OrderedCollection of Create / Announce activities (ALL own statuses, incl. DMs)
├── likes.json            # OrderedCollection of status URI strings
├── bookmarks.json        # OrderedCollection of status URI strings
├── avatar.<ext>          # optional
├── header.<ext>          # optional
└── media_attachments/files/123/456/789/original/<hash>.<ext>   # deep id-sharded paths
```

`outbox.json` is written as **one giant JSON document** (streamed in batches server-side, but a single object on disk).

## 3. Record schemas

### actor.json (Person)

Keys seen:
- `@context`, `id`, `type`, `preferredUsername`, `name`, `summary` (HTML), `url`, `published`
- `following`, `followers` (collection URIs, **not** contents)
- `inbox`, `outbox`→`"outbox.json"`, `likes`→`"likes.json"`, `bookmarks`→`"bookmarks.json"`
- `featured`, `featuredTags`, `manuallyApprovesFollowers`, `discoverable`, `indexable`, `memorial`
- `publicKey`, `tag`, `attachment` (profile fields), `endpoints`
- `icon.url`→`"avatar.png"`, `image.url`→`"header.jpg"`

`id` is the ego's actor URI: `https://<host>/users/<username>`, or `https://<host>/ap/users/<numericId>` for new local accounts on Mastodon **4.5+** (numeric AP ids).

### outbox.json

```json
{ "@context": [ "https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1", { "…": "…" } ],
  "id": "outbox.json", "type": "OrderedCollection", "totalItems": 3,
  "orderedItems": [ /* activities */ ] }
```

**Create** (own post, reply or DM):

| field | notes |
|---|---|
| id | `<status uri>/activity` |
| type | `"Create"` |
| actor | ego actor URI |
| published | ISO-8601 UTC, second precision (`2025-01-01T11:00:00Z`) |
| to, cc | addressing (see visibility table) |
| object.type | `Note` (or `Question` for polls) |
| object.id / url | status URI / web URL |
| object.inReplyTo | parent status URI or null |
| object.attributedTo | ego |
| object.content | **HTML** (`<p>`, `<span class="h-card">` mention links) |
| object.contentMap | `{lang: html}` |
| object.summary | content warning text or null |
| object.sensitive | bool |
| object.tag[] | `{type:"Mention", href: actorURI, name:"@user@domain"}`, `{type:"Hashtag", href, name:"#tag"}`, `{type:"Emoji", …}` |
| object.conversation | `tag:<host>,<date>:objectId=<n>:objectType=Conversation` or remote URI (OStatus legacy) |
| object.context | newer servers: conversation URI (`…/contexts/<accountId>-<convId>`). Absent on older versions |
| object.attachment[] | `{type:"Document", mediaType, url: "media_attachments/files/…" (rewritten to relative path), name: alt text}` |
| object.quote / quoteUri / _misskey_quote | quoted status URI (Mastodon 4.4+ quote posts). Older archives: none |
| object.updated | present if edited |
| object.replies / likes / shares | collection stubs (counts only, no actors) |

**Announce** (boost): `{id, type:"Announce", actor, published, to, cc, object: "<boosted status URI>"}`. `object` is a **string URI**, except a self-boost of an own followers-only post, where it's the inlined Note. `cc` includes the **boosted author's actor URI**.

```json
{ "id": "https://social.example/users/otter/statuses/113000000000000002/activity",
  "type": "Create", "actor": "https://social.example/users/otter",
  "published": "2025-01-05T09:30:00Z",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "cc": ["https://social.example/users/otter/followers", "https://other.example/users/marten"],
  "object": { "id": "https://social.example/users/otter/statuses/113000000000000002", "type": "Note",
    "inReplyTo": "https://other.example/users/marten/statuses/998877",
    "published": "2025-01-05T09:30:00Z", "attributedTo": "https://social.example/users/otter",
    "to": ["https://www.w3.org/ns/activitystreams#Public"],
    "cc": ["https://social.example/users/otter/followers", "https://other.example/users/marten"],
    "content": "<p><span class=\"h-card\"><a href=\"https://other.example/@marten\" class=\"u-url mention\">@<span>marten</span></a></span> agreed!</p>",
    "tag": [ { "type": "Mention", "href": "https://other.example/users/marten", "name": "@marten@other.example" } ],
    "conversation": "tag:other.example,2025-01-05:objectId=4455:objectType=Conversation",
    "sensitive": false, "summary": null, "attachment": [] } }
```

### likes.json / bookmarks.json

`{ "@context": "…", "id": "likes.json", "type": "OrderedCollection", "orderedItems": ["https://host/users/x/statuses/123", …] }`. Status URIs only: **no timestamp, no author field**. The author can only be guessed from the URI path (`/users/<name>/statuses/<id>` on Mastodon, `/ap/users/<n>/…` on 4.5+, other software differs), so treat the author as **heuristic**.

### CSVs (exact headers from source)

| file | header | rows |
|---|---|---|
| following_accounts.csv | `Account address,Show boosts,Notify on new posts,Languages` | `marten@other.example,true,false,` |
| muted_accounts.csv | `Account address,Hide notifications` | `troll@bad.example,true` |
| blocked_accounts.csv | *(no header)* | `user@domain` |
| lists.csv | *(no header)* | `List title,user@domain` (one row per member) |
| blocked_domains.csv | *(no header)* | `domain` |
| bookmarks.csv | *(no header)* | status URI |

Addresses are `user@domain` (local accounts include the local domain).

## 4. Mapping to the internal model

**Visibility from addressing** (`ActivityPub::TagManager#to/#cc`, `Public` = `https://www.w3.org/ns/activitystreams#Public`, also accept `as:Public` / `Public`):

| visibility | to | cc |
|---|---|---|
| public | [Public] | [followers, …mentions] |
| unlisted | [followers] | [Public, …mentions] |
| private (followers-only) | [followers] | […mentions] |
| direct (and `limited`) | […mentioned actors] | [] |

Rule: Public in `to` → public; Public in `cc` → unlisted; ego followers collection present → followers-only; else → direct. Boosts copy their own addressing.

| internal | Create (Note) | Announce | likes.json | following CSV |
|---|---|---|---|---|
| actor | `actor` (ego) | ego | ego | ego |
| targets | reply: author of `inReplyTo` (from Mention tags, or URI path heuristic); mentions: `tag[type=Mention].href`; DMs: `to` actor URIs | boosted author: non-collection URI in `cc`, else parse `object` | author heuristic from URI | `Account address` |
| timestamp | `published` ISO UTC | `published` | none | none |
| context id | `object.context` ?? `object.conversation` | – | – | – |
| parent | `object.inReplyTo` | `object` | status URI | – |
| text | strip HTML from `content`. `summary` = CW | – | – | – |
| node attrs | Mention `name` gives `@user@domain` (good label). Domain = instance (useful attribute) | | | Show boosts / Notify flags |

- **Declared ties:** following CSV (ego→X), lists (curated groups), blocks/mutes (negative).
- **Interaction events:** reply, mention, DM (direct posts), boost, quote (4.4+), like (target status only).

Node identity: actor URI from tags/addressing, or `user@domain` from CSV/Mention `name`. These differ, so reconcile via the `name` field of Mention tags (`@user@domain`). Unmatched CSV accts and URIs stay separate unless WebFinger-resolved, which needs network and remote CORS (**UNVERIFIED**, often blocked).

## 5. Observation note

**Ego view.** You see:
- all of the ego's own statuses (including followers-only and DMs **sent**)
- boosts
- liked/bookmarked URIs
- the following list

Not visible:
- **followers** (no export)
- replies/mentions/DMs **received**
- who boosted or liked ego posts (collections hold counts only)
- ties among others
- like timestamps

Instance domain is a strong community attribute.

## 6. Auto-detection signature

- Zip containing root `outbox.json` and `actor.json`. `outbox.json` has `"type":"OrderedCollection"` and `"id":"outbox.json"`, and `actor.json` has `"outbox":"outbox.json"`. Sniff the first 4 KB of each.
- `likes.json` / `bookmarks.json` with `"id":"likes.json"` / `"bookmarks.json"`.
- CSV with first line exactly `Account address,Show boosts,Notify on new posts,Languages` (following). Older versions had only `Account address,Show boosts` (**UNVERIFIED** exact history), so match the prefix `Account address`.
- Headerless 2-column CSV of `text,user@domain` → lists.csv (ask the user to confirm).

## 7. Versions, quirks, pitfalls

- `content` is HTML. Use `DOMParser` in a Worker-less context, or a regex tag-strip in the Worker. Mentions in HTML are display only, so use `tag[]`.
- `published` has second precision and UTC `Z`.
- **Actor URI schemes vary**: `/users/<name>` vs `/ap/users/<id>` (4.5+) vs other software (`/u/…`, `/@…`). Never parse the username from URIs when a `Mention.name` is available.
- Remote replies: `inReplyTo` may point to a deleted or unknown status. The author is resolvable only if a matching Mention tag exists (Mastodon auto-mentions the parent author in replies, so this usually works).
- Mastodon ids in URIs are 64-bit snowflake-like numbers. Keep them as strings.
- Size: the outbox is about 2–4 KB per status, so 50k statuses ≈ 100–200 MB as one JSON document. Media can be GBs.

## 8. Browser feasibility

- Unzip with `fflate`/`zip.js` and skip `media_attachments/`.
- `outbox.json` is a single document: for large ones use a streaming JSON parser (`@streamparser/json` with path `$.orderedItems.*`) in a Worker. Smaller ones: `JSON.parse`.
- CSV via `papaparse`.
- Optional enrichment (WebFinger, remote actor fetch) is generally not CORS-enabled on remote instances (**UNVERIFIED** per instance). Design as offline-only.

## Sources

Official (Mastodon source, `main` branch):
- `BackupService` (archive layout, Create/Announce choice, likes/bookmarks as URIs, filename): https://github.com/mastodon/mastodon/blob/main/app/services/backup_service.rb
- `BackupPolicy` (6-day limit): https://github.com/mastodon/mastodon/blob/main/app/policies/backup_policy.rb
- `BackupWorker` (deletes old backups, email): https://github.com/mastodon/mastodon/blob/main/app/workers/backup_worker.rb
- `Export` model (CSV headers): https://github.com/mastodon/mastodon/blob/main/app/models/export.rb
- Export filename concern: https://github.com/mastodon/mastodon/blob/main/app/controllers/concerns/settings/export_controller_concern.rb
- Exports controllers list: https://github.com/mastodon/mastodon/tree/main/app/controllers/settings/exports
- Note / CreateNote / AnnounceNote serializers: https://github.com/mastodon/mastodon/tree/main/app/serializers/activitypub
- `TagManager#to/#cc` (visibility addressing, Public constant): https://github.com/mastodon/mastodon/blob/main/app/lib/activitypub/tag_manager.rb
- Numeric AP routes and `id_scheme`: https://github.com/mastodon/mastodon/blob/main/config/routes.rb , https://github.com/mastodon/mastodon/blob/main/app/models/account.rb , CHANGELOG 4.5.0 https://github.com/mastodon/mastodon/blob/main/CHANGELOG.md

Community:
- Example archive (structure; contents partly synthetic): https://github.com/dvorakroth/fedi-archive-tool/tree/HEAD/example-archives/ish@ish.works
- likes.json real sample shape: https://github.com/stephane-klein/sklein.xyz/blob/HEAD/archives.sklein.xyz/src/mamot.fr/likes.json
- Fossilizer test fixture: https://github.com/lmorchard/fossilizer/blob/HEAD/src/resources/test/outbox.json
- Search-result writeups (not relied on for fields): https://www.raymondcamden.com/2024/07/21/an-online-mastodon-archive-viewer
