# X / Twitter research datasets (API JSON, JSONL, CSV flattenings)

Status: **high confidence** for v2 fields, the v1.1 retweet/quote/extended conventions (X official data dictionaries), twarc2 output shape and twarc-csv columns (source read). Ad-hoc CSV layouts vary by tool, so they get heuristics only.

## 1. How it's obtained

| Source | Who | Notes |
|---|---|---|
| X API v2 (`/2/tweets/search/*`, timelines, filtered stream) | paid API tiers | JSON pages of `{data, includes, meta}` |
| X API v1.1 / enterprise (GNIP "Native Enriched", "Activity Streams") | legacy, enterprise | one tweet object per record |
| twarc (v1.1) / twarc2 (v2) | researchers | writes `.jsonl` |
| Shared datasets (Zenodo, Harvard Dataverse, GitHub) | anyone | usually **ID-only ("dehydrated")** text files or CSVs of tweet ids, per X policy |

Redistribution policy (X Developer Policy): third parties may receive only Post/User/DM **IDs**. Hydrated objects are capped at 50,000 per recipient per day, and ID sharing at 1.5M per 30 days unless the sharer is an approved academic researcher. So many datasets users bring are **ID lists that need re-hydration**. A browser-only tool can't do that without API credentials, so treat ID-only files as **not importable**: detect them and explain.

## 2. File shapes

```
dataset/
├── results.jsonl         # twarc2: one API *response page* per line  ← most common v2 form
├── results.flat.jsonl    # twarc2 flatten: one *tweet* per line, includes inlined
├── tweets.jsonl          # twarc (v1.1): one v1.1 tweet per line
├── tweets.json           # sometimes a JSON array, or one API response
├── tweets.csv            # twarc-csv / twarc json2csv / custom pandas export
└── ids.txt               # dehydrated: one numeric id per line
```

## 3. Record schemas

### 3a. API v2 response page (twarc2 raw line)

```json
{
  "data": [ { "id": "1800000000000000201", "text": "@river_otter thanks! cc @pine_marten",
      "author_id": "100000001", "created_at": "2024-05-02T13:20:05.000Z",
      "conversation_id": "1800000000000000150", "in_reply_to_user_id": "100000002",
      "referenced_tweets": [ { "type": "replied_to", "id": "1800000000000000190" } ],
      "entities": { "mentions": [
          { "start": 0, "end": 12, "username": "river_otter", "id": "100000002" },
          { "start": 24, "end": 36, "username": "pine_marten", "id": "100000003" } ] },
      "public_metrics": { "retweet_count": 0, "reply_count": 1, "like_count": 3, "quote_count": 0 },
      "lang": "en", "edit_history_tweet_ids": ["1800000000000000201"] } ],
  "includes": {
    "users":  [ { "id": "100000001", "username": "otter_lab", "name": "Otter Lab" },
                { "id": "100000002", "username": "river_otter", "name": "River Otter" } ],
    "tweets": [ { "id": "1800000000000000190", "author_id": "100000002", "text": "...", "created_at": "2024-05-02T13:01:00.000Z" } ]
  },
  "meta": { "result_count": 1, "newest_id": "1800000000000000201", "oldest_id": "1800000000000000201", "next_token": "b26v89c19zqg8o3f" },
  "__twarc": { "url": "https://api.twitter.com/2/tweets/search/all?...", "version": "2.x", "retrieved_at": "2024-05-03T00:00:00+00:00" }
}
```

v2 tweet fields relevant to networks (from X data dictionary):

| field | type | meaning |
|---|---|---|
| id, text, edit_history_tweet_ids | string, string, string[] | **default fields**. Everything else is only present if requested |
| author_id | string | actor |
| created_at | ISO-8601 UTC (`…T19:26:16.000Z`) | timestamp |
| conversation_id | string | id of the root tweet of the thread, the **context id** |
| in_reply_to_user_id | string | author of the replied-to tweet |
| referenced_tweets[] | {type, id} | `type` ∈ `replied_to`, `quoted`, `retweeted` |
| entities.mentions[] | {start, end, username, id?} | `id` appears in current docs. Older examples only have `username`, so key by username via `includes.users` |
| public_metrics | {retweet_count, reply_count, like_count, quote_count, impression_count?, bookmark_count?} | |
| note_tweet | {text, entities} | full text for >280 chars |
| reply_settings | `everyone`/`mentioned_users`/`followers` | |
| lang, possibly_sensitive, geo, attachments, context_annotations | | |

Expansions place full objects in `includes.users` / `includes.tweets` / `includes.media` / `includes.places` / `includes.polls`. Missing (deleted/protected) referenced items produce an `errors[]` array.

v2 retweet: `text` begins `RT @user: …` (may be truncated), and `referenced_tweets:[{type:"retweeted",id}]`. Original author = `includes.tweets[id].author_id`.

### 3b. twarc2 flattened tweet (one per line)

Produced by `twarc2 flatten`. Each tweet gets:
- `author` (user object)
- `in_reply_to_user` (user object)
- `mentions[]` merged with user objects
- `referenced_tweets[]` merged with the referenced tweet, itself expanded (so `referenced_tweets[i].author` exists)
- `__twarc` (copied from its page)
- `matching_rules` (stream)

Missing includes become `{}`.

### 3c. API v1.1 tweet (twarc v1 / GNIP Native Enriched / older datasets)

| field | notes |
|---|---|
| id_str (use this, not `id`) | |
| created_at | `"Wed Oct 10 20:19:24 +0000 2018"` |
| user {id_str, screen_name, name, followers_count, …} | embedded author |
| text / full_text | `full_text` when fetched with `tweet_mode=extended`. Streaming/enterprise: `truncated:true` → read `extended_tweet.full_text` and `extended_tweet.entities` |
| in_reply_to_status_id_str, in_reply_to_user_id_str, in_reply_to_screen_name | reply |
| entities.user_mentions[] {id, id_str, screen_name, name, indices} | mentions |
| retweeted_status {…full tweet…} | **presence = retweet**. Always points to the original, never an intermediate RT |
| is_quote_status, quoted_status_id_str, quoted_status {…}, quoted_status_permalink | quote |
| retweet_count, favorite_count, reply_count/quote_count (enterprise only) | |

There is no `conversation_id` in v1.1. Reconstruct threads from `in_reply_to_status_id_str` chains.

Activity Streams (GNIP legacy) is a different vocabulary (`actor`, `object`, `verb: post|share`, `postedTime`). It hasn't been updated since 2017. **Not documented here beyond its existence**: the field names were not verified.

### 3d. CSV flattenings

**twarc-csv** (v2) default tweet columns (verified from source, abridged):

```
id, conversation_id, referenced_tweets.replied_to.id, referenced_tweets.retweeted.id,
referenced_tweets.quoted.id, author_id, in_reply_to_user_id, in_reply_to_username,
retweeted_user_id, retweeted_username, quoted_user_id, quoted_username, created_at, text,
lang, source, public_metrics.*, reply_settings, edit_history_tweet_ids, possibly_sensitive,
entities.mentions, entities.hashtags, entities.urls, …, author.id, author.username,
author.name, author.public_metrics.followers_count, …, geo.*, matching_rules,
__twarc.retrieved_at, __twarc.url, __twarc.version
```

- `entities.mentions` and other list columns are **JSON-encoded strings** by default (`--json-encode-lists`).
- `--merge-retweets` (default on) copies the original's text and metrics into RT rows.

**twarc v1 `json2csv`** columns:

```
id, tweet_url, created_at, parsed_created_at, user_screen_name, text, tweet_type, coordinates,
hashtags, media, urls, favorite_count, in_reply_to_screen_name, in_reply_to_status_id,
in_reply_to_user_id, lang, place, possibly_sensitive, retweet_count, retweet_or_quote_id,
retweet_or_quote_screen_name, retweet_or_quote_user_id, source, user_id, user_created_at, …
```

Other CSVs (pandas `json_normalize`, Brandwatch, academic dumps) need a **column-mapping UI** with presets for the two above. Common aliases to auto-suggest:
- `author_id|user_id|user.id_str|from_user_id`
- `created_at|timestamp|date`
- `in_reply_to_user_id|in_reply_to_user_id_str`
- `text|full_text|tweet`

## 4. Mapping to the internal model

| internal | v2 | v1.1 |
|---|---|---|
| actor | `author_id` | `user.id_str` |
| reply target | `in_reply_to_user_id` (and `referenced_tweets[replied_to]`) | `in_reply_to_user_id_str` |
| mention targets | `entities.mentions[].id` (or username→`includes.users`) | `entities.user_mentions[].id_str` (use `extended_tweet.entities` if truncated) |
| retweet target | author of `referenced_tweets[retweeted].id` (via includes) | `retweeted_status.user.id_str` |
| quote target | author of `referenced_tweets[quoted].id` | `quoted_status.user.id_str` |
| timestamp | `created_at` ISO UTC | parse `EEE MMM dd HH:mm:ss +0000 yyyy` → UTC |
| context id | `conversation_id` | none (derive the root via the reply chain if the parents are in the set) |
| parent | `referenced_tweets[replied_to].id` | `in_reply_to_status_id_str` |
| visibility | public (protected tweets aren't returned) | public |
| text | `note_tweet.text` ?? `text` | `extended_tweet.full_text` ?? `full_text` ?? `text`. RT: use `retweeted_status` text |
| node attrs | `includes.users[]`: username, name, public_metrics, verified, created_at | embedded `user` |

- **Declared ties:** none in tweet datasets. Separate `twarc2 followers/following` outputs are user-object JSONL (one user per line), and the ego is implied by the filename/command (not in the records, so the importer must ask the user).
- **Interaction events:** reply, mention, retweet, quote. Don't count the auto-prepended reply @-mentions twice (v2 `display_text_range` / v1.1 `display_text_range` tell you which mentions are in the visible text).

## 5. Observation note

These are a **query-defined sample** (keyword/hashtag/user timeline/stream), not an ego view. A tie appears only if the *tweet* matched the query, and referenced users/tweets in `includes` are context, not sampled nodes. Not visible:
- follows
- likes (except via separate `liking-users`)
- deleted/protected content
- content outside the query window

Filtered stream and `sample` endpoints are rate- and volume-limited, so missingness is non-random. Record the query (`__twarc.url`) as dataset provenance.

## 6. Auto-detection signature

Sniff the first non-empty line (JSONL) or the first value (JSON):

| test | format |
|---|---|
| object has `data` (array/object) and `includes` or `meta` | v2 response page (twarc2 raw) |
| object has `author_id` and `id` and (`text` or `edit_history_tweet_ids`), no `user` | v2 tweet (flattened if it also has `author` object or `__twarc`) |
| object has `id_str` and `user.screen_name` and (`text` or `full_text`) | v1.1 tweet |
| object has `verb` and `actor` and `object` and `postedTime` | GNIP Activity Streams (unsupported, report) |
| every line matches `^\d{6,20}$` (or single-column CSV `id`/`tweet_id`) | **dehydrated IDs**: show message, don't import |
| CSV header contains `referenced_tweets.retweeted.id` and `__twarc.version` | twarc-csv |
| CSV header contains `retweet_or_quote_user_id` and `tweet_url` | twarc v1 json2csv |
| `window.YTD.` prefix | not this format: personal archive (see x-archive.md) |

## 7. Quirks and pitfalls

- **Ids as strings**: v1.1 `id` is a 64-bit integer that loses precision in JS. Always use `id_str`. In CSVs, Excel may have already mangled ids to `1.8E+18`: detect this and warn.
- **Duplicates**: twarc2 pages overlap when a run is resumed, and the same tweet appears in `data` and in another page's `includes.tweets`. Deduplicate by id. Only `data` items are "sampled"; `includes` are referenced context.
- **RT text truncation**: v1.1 top-level `text` of RTs is truncated and entities may be missing. Read from `retweeted_status`.
- **Edits** (2022+): multiple versions share `edit_history_tweet_ids`. Keep the latest id per edit chain.
- Encoding is UTF-8. Mention offsets are code-point based (don't rely on them; use ids/usernames).
- Size: v2 raw pages are about 3–6 KB per tweet with expansions, so 1M tweets ≈ 3–6 GB of JSONL. Typical shared research files run 10 MB–5 GB.

## 8. Browser feasibility

- JSONL streams well: `file.stream().pipeThrough(new TextDecoderStream())` + a line splitter, then `JSON.parse` per line in a Worker. Memory stays bounded if the importer only keeps edges and node attrs, not text.
- Gzipped files (`.jsonl.gz`) are common: use `DecompressionStream('gzip')` (native) or `fflate`.
- CSV: `papaparse` with `worker:true` and `step` streaming. Watch for multiline quoted `text` fields.
- **Infeasible in-browser:** hydrating ID-only datasets (needs authenticated paid X API and CORS isn't available; out of scope for a no-server tool).

## Sources

Official:
- X API v2 data dictionary (fields, defaults, expansions): https://docs.x.com/x-api/fundamentals/data-dictionary (and `.md` variant)
- X API v2 example payloads (Retweet / Quote / Reply): https://docs.x.com/x-api/fundamentals/data-dictionary/reference.md
- Enterprise data dictionary (v1.1 Native Enriched: retweeted_status, quoted_status, extended_tweet, user_mentions; Activity Streams note): https://docs.x.com/x-api/enterprise-gnip-2.0/fundamentals/data-dictionary.md
- X docs index: https://docs.x.com/llms.txt
- X Developer Policy (redistribution limits, via search summary, not opened in full): https://docs.x.com/developer-terms/policy

Community (source read):
- twarc2 `flatten` and `__twarc` metadata: https://github.com/DocNow/twarc/blob/main/src/twarc/expansions.py , https://github.com/DocNow/twarc/blob/main/src/twarc/client2.py
- twarc v1 json2csv columns: https://github.com/DocNow/twarc/blob/main/src/twarc/json2csv.py
- twarc2 CLI docs: https://github.com/DocNow/twarc/blob/main/docs/twarc2_en_us.md
- twarc-csv default columns and options: https://github.com/DocNow/twarc-csv/blob/main/dataframe_converter.py , https://github.com/DocNow/twarc-csv/blob/main/twarc_csv.py , fixtures https://github.com/DocNow/twarc-csv/tree/main/test-data
