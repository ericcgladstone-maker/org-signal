# X / Twitter personal data archive

Status: **high confidence** for file tree, wrapper, tweets/follow/like/DM field names. These were checked against X's own `data/README.txt` and `manifest.js` in real 2020, 2022 and 2025 archives that are public on GitHub, and against the source of maintained parsers. Items marked **UNVERIFIED** could not be confirmed.

## 1. How it's obtained

| Item | Value |
|---|---|
| Who | The account holder only (logged in). Settings and privacy → Your account → Download an archive of your data → verify identity → Request archive |
| Delay | X says roughly 24 h (can be longer for big accounts). Notified by email or push |
| Link validity | About 7 days (third-party reports. **UNVERIFIED** on help.x.com, which blocks automated fetch) |
| Delivered as | One `.zip`. Name pattern seen in the wild: `twitter-YYYY-MM-DD-<hex>.zip` (**UNVERIFIED** as a fixed rule) |
| Large accounts | `manifest.js` has `archiveInfo.isPartialArchive` and `maxPartSizeBytes` (`"53687091200"` = 50 GB in 2020–2025 samples). Inside one archive, big data types split into `-partN.js` files (see §6). How a multi-zip delivery is split is **UNVERIFIED** |

## 2. Container / file tree (2025 archive, abridged)

```
<archive root>/
├── Your archive.html            # offline viewer (only works < 50 GB)
├── assets/                      # viewer JS/CSS/fonts/images (ignore)
└── data/
    ├── README.txt               # X's own field documentation (authoritative)
    ├── manifest.js              # window.__THAR_CONFIG = {...}  ← use for detection + file list
    ├── account.js
    ├── profile.js
    ├── tweets.js                # (2019–~2022: tweet.js)
    ├── tweets-part1.js          # only when large; part0 is tweets.js
    ├── tweet-headers.js         # tweetId/userId/createdAt only
    ├── note-tweet.js            # long-form (>280 char) post bodies
    ├── community-tweet.js
    ├── deleted-tweets.js / deleted-tweet-headers.js
    ├── like.js  (like-part1.js …)
    ├── follower.js
    ├── following.js
    ├── block.js / mute.js
    ├── direct-messages.js
    ├── direct-messages-group.js
    ├── direct-message-headers.js / direct-message-group-headers.js
    ├── lists-created.js / lists-member.js / lists-subscribed.js
    ├── screen-name-change.js / account-timezone.js
    ├── … (~80 more: ads, ip-audit, periscope-*, grok-chat-item, …)
    ├── tweets_media/            # (2020: tweet_media/)
    ├── direct_messages_media/
    ├── direct_messages_group_media/
    ├── community_tweet_media/ / deleted_tweets_media/
    └── profile_media/
```

### JS-assignment wrapper

Every `data/*.js` file is one JS assignment of a JSON array:

```js
window.YTD.tweets.part0 = [ { "tweet" : { ... } }, ... ]
```

- The global name uses **underscores** and the file name uses **hyphens**: `direct-messages-group.js` → `window.YTD.direct_messages_group.part0`, `note-tweet.js` → `YTD.note_tweet.part0`.
- `manifest.js` uses a different prefix: `window.__THAR_CONFIG = {...}`.
- Empty types come through as `window.YTD.follower.part0 = [ ]` or `[]`.
- Robust parse: `JSON.parse(text.slice(text.indexOf('=') + 1))`. Don't match on the global name, which changes between versions. Older archives started the array on the first line (`= [ {`), so line-dropping hacks break.

## 3. Record schemas

### manifest.js (`window.__THAR_CONFIG`)

```json
{
  "userInfo": { "accountId": "1400000000000000001", "userName": "example_org", "displayName": "Example Org" },
  "archiveInfo": { "sizeBytes": "4563235", "generationDate": "2025-01-22T05:46:38.082Z",
                   "isPartialArchive": false, "maxPartSizeBytes": "53687091200" },
  "readmeInfo": { "fileName": "data/README.txt", "directory": "data/", "name": "README.txt" },
  "dataTypes": {
    "tweets": { "mediaDirectory": "data/tweets_media",
                "files": [ { "fileName": "data/tweets.js", "globalName": "YTD.tweets.part0", "count": "310" } ] },
    "like":   { "files": [ { "fileName": "data/like.js", "globalName": "YTD.like.part0", "count": "0" } ] }
  }
}
```

Read `dataTypes.<type>.files[]` to enumerate every part. Don't glob. Data-type keys are camelCase (`directMessagesGroup`, `noteTweet`, `tweetHeaders`).

### account.js → `[{ "account": {...} }]`

| field | type | meaning |
|---|---|---|
| accountId | string (numeric) | stable user id, the **canonical ego node key** |
| username | string | current @handle (can change; see screen-name-change.js) |
| accountDisplayName | string | display name |
| createdAt | ISO-8601 UTC | account creation |
| createdVia | string | client used at creation |
| email | string | **PII. Drop on import** |

### profile.js → `[{ "profile": { "description": { "bio","website","location" }, "avatarMediaUrl", "headerMediaUrl" } }]`

URLs in `bio` and `website` are t.co links.

### tweets.js → `[{ "tweet": {...} }]` (v1.1-style "full_text" object, but **not** the full API object)

Fields observed in a 2025 archive (counts from 310 tweets). **All numbers are strings**, including ids, counts and entity `indices`.

| field | type | notes |
|---|---|---|
| id_str / id | string | tweet id (both strings) |
| created_at | string | `"Sun Mar 21 12:53:22 +0000 2021"`, Twitter v1.1 format, always `+0000` |
| full_text | string | HTML-entity escaped (`&amp;`, `&lt;`). Retweets start `RT @handle:` and are truncated |
| display_text_range | [string,string] | visible text span (leading @-reply prefix excluded) |
| in_reply_to_status_id_str / in_reply_to_status_id | string | parent tweet id |
| in_reply_to_user_id_str / in_reply_to_user_id | string | parent author id |
| in_reply_to_screen_name | string | **may be missing even when user_id is present** (17/158 in sample, probably deleted/suspended parents) |
| entities.user_mentions[] | {name, screen_name, id_str, id, indices} | mentions. ids can be `"-1"` (skip) |
| entities.hashtags[] / symbols[] / urls[] / media[] | | urls[]: {url, expanded_url, display_url, indices} |
| extended_entities.media[] | | full media list |
| favorite_count / retweet_count | string | counts at archive time |
| retweeted / favorited | bool | **always false in archive. Don't use** |
| truncated | bool | |
| lang, source (HTML `<a>`), possibly_sensitive | | |
| edit_info.initial {editTweetIds[], editableUntil, editsRemaining, isEditEligible} | | edited tweets: `edit_info.edit.initialTweetId` (**field name per README text; nesting UNVERIFIED**) |

**Missing compared with the API:** no `user` object, no `retweeted_status`, no `quoted_status`/`quoted_status_id_str`, no `conversation_id`, no `reply_count`/`quote_count`.

```json
{ "tweet": {
  "id_str": "1700000000000000101", "id": "1700000000000000101",
  "created_at": "Tue Mar 05 14:02:11 +0000 2024",
  "full_text": "@river_otter agreed, let's sync with @pine_marten tomorrow",
  "display_text_range": ["0", "57"],
  "in_reply_to_status_id_str": "1700000000000000055", "in_reply_to_status_id": "1700000000000000055",
  "in_reply_to_user_id_str": "222000111", "in_reply_to_user_id": "222000111",
  "in_reply_to_screen_name": "river_otter",
  "entities": {
    "user_mentions": [
      { "name": "River Otter", "screen_name": "river_otter", "indices": ["0","12"], "id_str": "222000111", "id": "222000111" },
      { "name": "Pine Marten", "screen_name": "pine_marten", "indices": ["37","49"], "id_str": "333000222", "id": "333000222" } ],
    "hashtags": [], "symbols": [], "urls": [] },
  "favorite_count": "2", "retweet_count": "0", "retweeted": false, "favorited": false,
  "truncated": false, "lang": "en", "source": "<a href=\"https://mobile.twitter.com\" rel=\"nofollow\">Twitter Web App</a>",
  "edit_info": { "initial": { "editTweetIds": ["1700000000000000101"], "editableUntil": "2024-03-05T15:02:11.000Z", "editsRemaining": "5", "isEditEligible": true } }
} }
```

### note-tweet.js → `[{ "noteTweet": {...} }]`

Observed in a real archive: `noteTweetId`, `createdAt`, `updatedAt`, `lifecycle{value,name}`, `core{text, mentions[], hashtags[], urls[], cashtags[], styletags[]}`. **There is no `tweetId` in the real sample.** One community doc shows `tweetId` and `noteTweetResults`, which conflicts with it. Linking a note to its tweet is **UNVERIFIED**. A fallback is to match on `createdAt` plus a text prefix of the truncated `full_text`.

### like.js → `[{ "like": { "tweetId", "fullText", "expandedUrl" } }]`

| field | notes |
|---|---|
| tweetId | liked tweet id |
| fullText | text if visible to you (sometimes missing) |
| expandedUrl | `https://twitter.com/i/web/status/<id>`. **No author id/handle** |

**No timestamp for when the like happened.** Tweet ids are snowflakes, so `(id >> 22) + 1288834974657` gives the *liked tweet's* creation time, not the like time.

### follower.js / following.js / block.js / mute.js

```json
[ { "follower":  { "accountId": "444000333", "userLink": "https://twitter.com/intent/user?user_id=444000333" } } ]
[ { "following": { "accountId": "555000444", "userLink": "https://twitter.com/intent/user?user_id=555000444" } } ]
```

**IDs only**: no handle, no display name and no follow date. Handles can be recovered only from ids that also appear in tweets (mentions, replies).

### direct-messages.js (1:1) → `[{ "dmConversation": { "conversationId", "messages": [ {...} ] } }]`

- `conversationId` = `"<userIdA>-<userIdB>"` (two numeric ids joined by a hyphen, verified on real files).
- Message item = `{ "messageCreate": { id, senderId, recipientId, text, createdAt, mediaUrls[], urls[{url,expanded,display}], reactions[] } }`.
- `createdAt` is ISO-8601 UTC with ms: `"2022-01-27T15:58:52.744Z"`.
- Order within a conversation is **reverse chronological** (README).
- Reactions: README names `reactionSenderID`, `reactionKey`, `reactionEventID`, `reactionCreatedAt`. The real samples had empty `reactions[]`, so the **exact JSON keys inside `reactions[]` are UNVERIFIED**.

### direct-messages-group.js → same envelope

- `conversationId` is a single random id (no hyphen pair).
- Message item kinds: `messageCreate` (no `recipientId`), `joinConversation{initiatingUserId, participantsSnapshot[], createdAt}`, `participantsJoin{initiatingUserId, userIds[], createdAt}`, `participantsLeave{userIds[], createdAt}`, `conversationNameUpdate{initiatingUserId, name, createdAt}` (keys per timhutton parser).
- To get the participant set, union of all `senderId`s, `participantsSnapshot`, `participantsJoin.userIds` and `initiatingUserId`s. Joins/leaves "might not be available due to deletions" (README).

```json
{ "dmConversation": { "conversationId": "1612345678901234567", "messages": [
  { "messageCreate": { "id": "1712000000000000002", "senderId": "222000111", "text": "agenda attached",
      "createdAt": "2024-03-06T09:15:00.120Z", "mediaUrls": [], "urls": [], "reactions": [] } },
  { "participantsJoin": { "initiatingUserId": "1400000000000000001", "userIds": ["333000222"], "createdAt": "2024-03-06T09:00:00.000Z" } } ] } }
```

## 4. Mapping to the internal model

| internal | tweets.js | DMs | likes | follows |
|---|---|---|---|---|
| actor | ego (`account.accountId`) | `senderId` | ego | ego / `follower.accountId` |
| targets | `in_reply_to_user_id` (reply), `user_mentions[].id_str` (mention), RT source handle (from `RT @x:`; id from `user_mentions[0]`) | 1:1: `recipientId`. Group: all other participants | **author unknown**. Target node = tweet id only | other account |
| timestamp | parse `created_at` (`EEE MMM dd HH:mm:ss +0000 yyyy`) → UTC | `createdAt` ISO UTC | none (snowflake = tweet time) | none |
| context id | none. Use `in_reply_to_status_id` chains, and X `conversation_id` is absent | `conversationId` | – | – |
| visibility | public (or protected-account audience if the ego was protected; check `protected-history.js`) | private | public | public |
| parent / thread | `in_reply_to_status_id_str` | – | – | – |
| text | `full_text` (HTML-unescape; prefer note-tweet text if linked) | `text` | `fullText` | – |
| node attrs | screen_name/name from mentions; ego from account/profile | ids only | – | ids only |

Tie classes:
- **Declared ties**: following.js (ego→X), follower.js (X→ego), block.js and mute.js (negative, optional).
- **Interaction events**:
  - reply (ego→parent author)
  - mention (ego→each mentioned id, excluding the reply target if you want to avoid double counting)
  - retweet (`full_text` starts `RT @`, ego→retweeted author)
  - quote (no field: detect a `urls[].expanded_url` matching `(twitter|x).com/<handle>/status/<id>`, then target = handle → id via mentions/users map, else handle-only node)
  - like (ego→tweet, author unknown)
  - DM (sender→recipient(s))
- Self-replies (threads) are common (29/158 replies in sample). Keep them as context, not as ties.

## 5. Observation note

**Ego view.** You see only the ego's outgoing actions plus incoming DMs and the follower list. Not visible:
- replies/mentions *to* the ego by others (except inside DMs)
- ties among followers
- other people's likes and retweets of ego content
- deleted tweets (except the ~14-day `deleted-tweets.js` window)
- protected or deleted counterparts' handles

Follow lists are a current snapshot with no dates.

## 6. Auto-detection signature

1. A zip containing `data/manifest.js` whose text starts with `window.__THAR_CONFIG` → X archive. Strongest signal.
2. Otherwise, any `data/*.js` (or a lone dropped `.js`) matching `/^\s*window\.YTD\.([a-z_]+)\.part(\d+)\s*=/`. Group 1 = data type, group 2 = part index.
3. Legacy (≤2018) "Grailbird" archive: root `tweets.csv` (columns `tweet_id, in_reply_to_status_id, in_reply_to_user_id, retweeted_status_id, retweeted_status_user_id, timestamp, source, text, expanded_urls`) plus `data/js/tweets/YYYY_MM.js` starting `Grailbird.data.tweets_YYYY_MM =`. Community-reported only. Treat as a separate optional importer.

Part files: `tweets.js` = part0, `tweets-part1.js` = part1, … (same for `like-partN.js`). Concatenate the arrays.

## 7. Versions, quirks, pitfalls

| Era | Differences |
|---|---|
| ≤2018 | Grailbird CSV/JS format (above) |
| ~2019–2022 | `tweet.js`, `window.YTD.tweet.part0`, `tweet_media/`. Some early archives lack the `{ "tweet": … }` wrapper (parsers check `'tweet' in obj`) |
| late 2022+ | `tweets.js`, `window.YTD.tweets.part0`, `tweets_media/`, `edit_info`, `note-tweet.js`, `community-tweet.js` |
| 2023+ | X rebrand in README/text. URLs and hosts still `twitter.com` in `userLink`/`expandedUrl`. Expect `x.com` in newer URLs too |
| 2022 era | `twitter-circle-tweet.js` (Circle-only tweets, audience restricted). Exclude or mark as limited visibility |

Other pitfalls:
- Treat every id as a **string** (snowflakes exceed 2^53). Never `Number()`.
- `full_text` is HTML-escaped. Indices count UTF-16 code units in some eras and code points in others. Don't slice by indices: use `screen_name`/`id`.
- Encoding is UTF-8 with no BOM issues observed.
- Size: the tweets.js text is roughly 2 KB per tweet (639 KB for 310 tweets), so a 100k-tweet account gives about 200 MB of tweets.js. Media dominates zip size (GBs).

## 8. Browser feasibility

- Unzip: `fflate` (streaming `Unzip`, can skip media entries) or `@zip.js/zip.js` (random access via central directory). Only inflate `data/*.js`. Never load `*_media/`.
- Parse: strip the prefix and `JSON.parse`. For a single >200 MB part, `JSON.parse` on one string may hit memory limits. A streaming JSON parser (e.g. `@streamparser/json`) over the inflated stream avoids it. Run in a Web Worker.
- Everything is local: no network needed.

## Sources

Official (X-generated or X docs):
- `data/README.txt` and `data/manifest.js` of a real 2025 archive: https://github.com/msys2/twitter-export/tree/HEAD/twitter-2025-01-22-archive/data (README text authored by X)
- 2020 archive (`tweet.js`, manifest): https://github.com/hotoo/twitter/tree/HEAD/2020/data
- 2022 archive manifest: https://github.com/JackLance/jacklance.github.io/tree/HEAD/data
- help.x.com archive page (blocked by Cloudflare to automated fetch, so content came via search snippets only): https://help.x.com/en/managing-your-account/how-to-download-your-x-archive

Community (source/fixtures read):
- timhutton/twitter-archive-parser `parser.py`: https://github.com/timhutton/twitter-archive-parser (file globs `tweet.js`/`tweets.js`/`tweets-part*.js`, DM/group DM keys)
- TheExGenesis/community-archive docs: https://github.com/TheExGenesis/community-archive/blob/HEAD/docs/archive_data.md
- note-tweet real sample: https://github.com/alrocar/x/blob/HEAD/data/note-tweet.js
- steipete/birdclaw tests: https://github.com/steipete/birdclaw/blob/HEAD/src/lib/archive-import.test.ts
- DM samples: https://github.com/extratone/iowa/tree/HEAD/twitter/data
- Part-file naming: https://github.com/trpfrog/gpt-tweet-dataset-generator/blob/HEAD/tweet-data-paths.txt , https://github.com/tenkao/twidb/blob/HEAD/SPEC.md
- tweetback README: https://github.com/tweetback/tweetback
- Grailbird summary (search result, not opened in full): http://fileformats.archiveteam.org/wiki/Twitter
