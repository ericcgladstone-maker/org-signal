# importers-B: online, personal, professional and community importers

Owner: importers-B. All modules follow the importer contract in `src/importers/registry.js` and `docs/CONTRACTS.md`. `src/importers/index.personal.js` exports the array of all twelve importers.

Tests: `node --test 'test/importers-b/**/*.test.js'` (102 tests). Fixtures are synthetic, under `test/fixtures/importers-b/<id>/`, each with the generator script that wrote it (`make_fixtures.py`, `make_fixture.py`, `make_car.mjs`).

## Shared conventions

| Item | Rule |
|---|---|
| Node keys | `<ns>:<stable id>`, ns = `x`, `bsky`, `mastodon`, `threads`, `linkedin`, `whatsapp`, `imessage`, `telegram`, `messenger`, `instagram`, `discord`, `reddit`. Ids are always strings. Name-only keys use `nameKey()` and raise `identity-by-name`. |
| Context keys | `<ns>:<kind>:<id>`. 1:1 conversation `dm` (direct), group conversation `group_dm` (group), public thread `thread`, Discord `channel`, Reddit `subreddit`. Chat contexts carry `members`. |
| Targets | 1:1 DM: other party as `dm`. Group chats: no broadcast targets, only `reply` / `mention` where the source says so. Posts: `reply` to the parent author (even when the parent is absent) and `mention`. follow / like / repost / reaction: other account as `subject`. Declared ties: `declared`. |
| Quotes | Modelled everywhere (X, Bluesky, Mastodon) as an extra `repost` event (key `<ns>:quote:<id>`) with the quoted author as `subject`, since the model has no quote type. |
| parentKey | Set only when the parent could be in the same data. Likes/reposts/bookmarks of others' content carry no parentKey, so `unresolved-parent` counts only real gaps. |
| Unknown time | `NaN`, with a warning (`undated-likes`, `undated-follows`, ...). |
| family / context | x-archive, x-research, bluesky, mastodon, threads: `online`; linkedin: `professional`; whatsapp, imessage, telegram, meta: `personal`; discord, reddit: `community`. `medium` = platform name. |

## Shared helpers (`src/importers/lib/`)

- `json.js`: `quoteBigInts(text)` (16+ digit integer literals become strings, outside strings only), `parseJSON(text, { bigInts = true })` (strips BOM), `parseYTD(text)` (X `window.YTD...` / `__THAR_CONFIG` wrappers), `streamJSON(streamOrString, patterns, { bigInts })` (async generator of `{ path, pattern, value }` for values at dotted paths with `*` wildcards; never builds the whole document; tested across 1-byte chunk boundaries), `readJSON(entry)`.
- `text.js`: `fixMojibake(s)` (Meta byte-escaped UTF-8; idempotent; genuine Latin-1 left alone), `fixMojibakeDeep(v)`, `decodeEntities(s)`, `stripHtml(html)`, `nameKey(name)`.
- `time.js`: `isoMs` (requires Z/offset, else NaN), `isoUtcMs` (no offset read as UTC), `twitterDateMs`, `snowflakeMs(id, epoch)`, `X_EPOCH`, `DISCORD_EPOCH`, `unixSecMs`, `tzOffsetMs(utcMs, tz)`, `zonedToUtc(y, mo, d, h, mi, s, ms, tz)` (DST gap shifts forward, overlap takes the earlier instant; tz `unknown`/`UTC` reads the wall clock as UTC), `isValidTimeZone`.
- `csv.js`: `parseCSV(text, { header })` returning `{ rows, fields, errors }`, `firstLine`, `Papa`.
- `x-common.js`: `RT_RE`, `STATUS_URL_RE`, `statusUrl(url)`, `idStr(v)`, `handleKey(h)`, `EXCEL_ID_RE`.
- `whatsapp-grammar.js`: line grammar and date-order inference (see whatsapp).
- `typedstream.js`: `decodeAttributedBody(u8)` (see imessage).

---

## x-archive: X / Twitter personal archive

- **Detect:** 0.98 for `data/manifest.js` starting `window.__THAR_CONFIG`; 0.9 for any `.js` matching `window.YTD.<type>.partN =` (files under `assets/` ignored).
- **Options:** none.
- **Source:** view `ego`, medium `x`, tz `UTC`, `egoKey` `x:<accountId>` (from `account.js`, else `manifest.userInfo`). `account.email` is never read.
- **Reading:** parts enumerated from `manifest.dataTypes.<type>.files[]` (sniffed when no manifest); each file streamed with `streamJSON` after the `=`. `tweets.js` and legacy `tweet.js`, with or without the `{tweet}` wrapper.
- **Nodes:** `x:<id>` (label from mention names, else `@handle`; `platformIds { x, handle }`); `x:@<handle>` when only a handle is known (`handle-only-node`).
- **Contexts:** `x:thread:<rootId>` (public; root via own reply chains); `x:dm:<conversationId>` (direct); `x:group_dm:<conversationId>` (group; members = senders, snapshot, joiners, initiators).
- **Events:** tweets `message` (`x:tweet:<id>`; `reply` target + parentKey; `mention` targets, skipping the auto-prepended reply mention before `display_text_range[0]` and id `-1`); `RT @h:` as `repost` with the original author as `subject`; quotes via status URL as `repost` (`x:quote:<id>`); likes `like` with NaN time and no target unless a handle is in the URL; following = `follow` ego -> X, follower = `follow` Y -> ego, NaN time; DMs re-sorted ascending, 1:1 `dm` targets, group none; `joinConversation` / `participantsJoin` -> `join`, `participantsLeave` -> `leave`; DM reactions read defensively; note-tweet text replaces truncated text when matched.
- **Warnings:** `bad-manifest`, `missing-part`, `ego-unknown`, `handle-only-node`, `unresolved-mention`, `tweet-without-id`, `bad-time`, `circle-tweets-skipped`, `protected-account`, `like-author-unknown`, `undated-likes`, `undated-follows`, `dm-without-sender`, `dm-unknown-item`.

## x-research: X research datasets

- **Detect:** 0.95 v2 pages (twarc2 raw), twarc-csv, json2csv; 0.9 v2 tweets (plain or flattened); 0.85 v1.1; 0.6 ID-only and GNIP Activity Streams (both refused on import); never claims `window.YTD`. `.jsonl/.ndjson/.json/.csv/.tsv/.txt`, optionally `.gz` (native DecompressionStream).
- **Options:** none.
- **Source:** view `sample`, medium `x`, tz `UTC`, no ego; `source.queries` holds up to 50 distinct `__twarc.url` values.
- **Errors:** `ID_ONLY_MESSAGE` (rehydration needs the paid API and a server; suggests `twarc2 hydrate`), `GNIP_MESSAGE`.
- **Two passes:** maps (username -> id, tweet -> author, reply and edit chains), then events deduplicated by tweet id; latest version of each edit chain kept; `includes`-only tweets produce no events.
- **Events:** `message` in `x:thread:<conversation_id or v1.1 chain root>`; `reply` and `mention` targets; retweets and quotes as `repost` with `subject`. v1.1 reads `extended_tweet` and `retweeted_status` / `quoted_status`.
- **Warnings:** `ids-only-skipped`, `gnip-unsupported`, `user-list-skipped`, `api-errors`, `unknown-record`, `excel-mangled-ids`, `row-without-author`, `bad-json-line`, `tweet-without-author`, `duplicate-tweets`, `edit-superseded`, `handle-only-node`, `retweet-author-unknown`, `quote-author-unknown`, `mention-unresolved`, `bad-time`.
- **Extra exports:** `sniff(entry)`, `classifyObject(o)`, `ID_ONLY_MESSAGE`, `GNIP_MESSAGE`.

## bluesky: repository CAR

- **Detect:** 0.95 for `.car` (or extension-less `*repo*`) starting varint + `0xa2` with `roots` in the first 16 bytes; 0.6 for `chat.jsonl` (detected only: schema UNVERIFIED, import warns `bluesky-chat-unverified`).
- **Options:** none.
- **Source:** view `authored`, tz `UTC`, `egoKey` `bsky:<repo DID>` from the root commit. Parsed with `vendor/atcute.js`.
- **Nodes / contexts:** `bsky:<did>`; ego attrs from the profile record. `bsky:thread:<root uri or own post uri>` (public).
- **Events:** posts `message` (`reply` from `reply.parent.uri` DID with parentKey; `mention` from facets sliced by UTF-8 byte offsets); quotes as `repost`; likes / reposts with author from `subject.uri`; follows deduplicated by subject. Only `app.bsky.*` collections; createdAt with TID fallback; lists as `bsky_lists` attr; blocks counted only.
- **Warnings:** `repo-version`, `bad-subject`, `duplicate-follow`, `non-bluesky-records`, `createdat-mismatch` (over 30 days from the TID), `createdat-missing`, `quote-unresolved`, `blocks-skipped`, `bluesky-chat-unverified`.
- **Extra exports:** `fetchRepo(handleOrDid, { fetch, signal })` returns `{ did, handle, pds, bytes, fileName: 'repo.car' }` via resolveHandle (public.api.bsky.app), DID document (plc.directory or did:web `/.well-known/did.json`), `#atproto_pds`, `getRepo`. **It uses the network: call only on an explicit user action.** `fetch` is injectable. Also `parseAtUri`, `tidToMs`, `facetMentions`, `quotedUri`, `looksLikeCar`.

## mastodon: account archive and CSV exports

- **Detect:** 0.95 `actor.json` + `outbox.json`; 0.9 `outbox.json` alone or a CSV starting `Account address` with `Show boosts`; 0.7 `likes.json` / `bookmarks.json` alone.
- **Options:** `account` (user@domain) when there is no `actor.json`.
- **Source:** view `ego`, tz `UTC`, `egoKey` `mastodon:<preferredUsername>@<host>`. Outbox streamed with `streamJSON('orderedItems.*')`.
- **Nodes:** `mastodon:user@domain` when known (from Mention `name`, gathered in a first pass), else `mastodon:<actor URI>`. Usernames are never parsed from URIs when a Mention name exists. Attrs `instance`, `show_boosts`, `notify_on_new_posts`, `mastodon_lists`.
- **Contexts:** keyed by `object.context` ?? `object.conversation` ?? status id: `mastodon:thread:` (public/unlisted), `mastodon:private:` (followers-only), `mastodon:dm:` / `mastodon:group_dm:` (direct). Visibility per the spec's to/cc table (`visibilityOf`).
- **Events:** Create `message` (HTML stripped; CW as `[CW: ...]`; `reply` author via Mention / addressed actor whose URI prefixes `inReplyTo`; `mention`; direct posts `dm` to every addressee); Announce and quotes `repost`; likes / bookmarks undated `like` with heuristic author (flagged); following CSV undated `follow`.
- **Warnings:** `ego-unknown`, `reply-author-unknown`, `boost-author-heuristic`, `boost-author-unknown`, `quote-author-unknown`, `unknown-activity`, `undated-likes`, `undated-bookmarks`, `heuristic-likes-author`, `heuristic-bookmarks-author`, `unknown-likes-author`, `unknown-bookmarks-author`, `undated-follows`, `bad-account-address`.
- **Extra exports:** `visibilityOf(to, cc, followersUri)`, `acctFromMention(name, href)`.

## threads: Threads data in the Instagram export

- **Detect:** 0.95 for known files whose top-level key starts `text_post_app_`; 0.6 for the HTML export (import throws "re-export as JSON").
- **Options:** `username` when `personal_information.json` is missing.
- **Source:** view `ego`, tz `UTC`, `egoKey` `threads:<username>`. Files routed by top-level key; every string and key mojibake-fixed. Localized labels are not hard-coded: ego falls back from labels to profile href, option, then zip name.
- **Events:** posts `message` in `threads:feed:<ego>` (public, or private for a private account), mentions from `@username` in text; `is_reply` posts get **no** reply tie (`reply-parent-missing`); likes `like` with author from `title` / href; follows in both directions, timed. Saved / viewed counted only.
- **Warnings:** `ego-unknown`, `bad-json`, `archived-unreadable`, `reply-parent-missing`, `mentions-from-text`, `like-author-missing`, `follow-without-username`.
- **Extra exports:** `textMentions`, `followEntry`, `shapeEntry`, `usernameFromHref`.

## linkedin: LinkedIn data export (Basic / Complete)

- **Detect:** 0.95 for `Connections.csv` (preamble `Notes:` or header with `First Name,Last Name,URL` + `Connected On`), `messages.csv` header `CONVERSATION ID,CONVERSATION TITLE,FROM`, or `Invitations.csv` with `Direction` + `inviterProfileUrl`; 0.7 for `Profile.csv` + `Positions.csv` or a Basic_/Complete_ zip name.
- **Options:** none.
- **Source:** view `ego`, tz `UTC`. Ego URL from Invitations.csv, else the URL present in at least 80% of conversations (`ego-url-inferred`), else `linkedin:me`.
- **Nodes:** `linkedin:<slug>` from `/in/<slug>` (lowercased, URL-decoded); `linkedin:url:<url>`; `linkedin:name:<nameKey>` without URL; `linkedin:unknown:<convId>:<name>` for unmatched message participants. Connection attrs `company`, `position`, `connected_on`.
- **Contexts:** `linkedin:dm:<CONVERSATION ID>` / `linkedin:group_dm:<id>`.
- **Events:** connections `declared` ego -> connection timed by Connected On (UTC midnight); messages `message` (DATE `YYYY-MM-DD HH:MM:SS UTC`; drafts dropped; recipient URLs matched by shape, never by splitting names); invitations `declared` inviter -> invitee (time read as UTC, flagged); endorsements `declared`. Ego attrs from Profile / Positions / Education.
- **Warnings:** `ego-url-unknown`, `ego-url-inferred`, `connections-header-missing`, `unparsed-date`, `no-profile-url`, `connection-date-only`, `drafts-skipped`, `matched-by-name`, `unknown-member`, `ambiguous-recipients`, `possible-sponsored`, `invitation-time-zone-unknown`.
- **Extra exports:** `profileSlug`, `parseConnectedOn`, `parseUtcStamp`, `parseInvitationDate`, `parseConnections`.

## whatsapp: chat export (.txt, or zip with `_chat.txt`)

- **Detect:** chat-named file plus at least 60% of the first 50 non-empty lines matching the header grammar 0.95; content only 0.8; name with weak content 0.6; name only 0.3.
- **Options:** `timezone` (IANA, default `unknown`: wall clock read as UTC, source tz `unknown`, warning), `dateOrder` (`auto` | `day-first` | `month-first`), `egoName` (resolves "You" and sets `egoKey`).
- **Source:** one per chat file, view `chat`, medium `whatsapp`.
- **Grammar:** iOS `[date, time] Name: text` and Android `date, time - Name: text`; 12/24 h; U+202F, U+200E/U+200F, BOM, U+2068/U+2069 mention isolates; `~ Name`; multi-line continuation; media-omitted (both capitalizations) and other attachment markers; edit and deleted markers; system messages including the 2024+ iOS style where the chat name is the author, and Android authorless notices containing ": " (`authorlessSystem`). Day/month order inferred over the whole file as whatsapp-chat-parser does (its 12 formats and date tests are reproduced in the tests); year-first dates always read Y-M-D.
- **Nodes:** `whatsapp:<nameKey>` or `whatsapp:+<digits>`; attrs `is_phone_number`, `is_saved_contact`.
- **Contexts:** `whatsapp:<dm|group_dm>:<hash of title + first timestamp>`; group when a group notice appears or more than 2 authors; members include people named in join / leave notices.
- **Events (exact file order preserved):** `message` (1:1 `dm` target; `mention` targets: in a 1:1 chat when the name or phone resolves to a participant, in a group for every isolate-delimited name or phone, adding the person if needed); `join` / `leave` from added / removed / left / joined-via-link notices.
- **Warnings:** `identity-by-name`, `timezone-unknown`, `timezone-invalid`, `date-order-ambiguous`, `orphan-lines`, `system-by-heuristic`, `system-you-unresolved`, `direct-partner-unknown`, `mention-unmatched`, `bad-date`, `time-backwards`, `no-messages`.
- **Extra exports:** `analyzeChat(text, { title, dateOrder })`; grammar functions in `lib/whatsapp-grammar.js` (`HEADER_RE`, `splitMessages`, `parseHeaders`, `inferDaysFirst`, `parseAuthor`, `classifyBody`, `extractMentions`, `matchSystem`, `authorlessSystem`, `cleanInvisible`, ...).

## imessage: macOS chat.db / iOS sms.db, and imessage-exporter TXT

- **Detect:** 0.95 SQLite with `chat_message_join` and `chat_handle_join` in the first 64 KB; 0.6 `chat.db` / `sms.db` name with SQLite magic only; 0.85 (0.9 with `orphaned.txt`) for imessage-exporter TXT.
- **Options:** `timezone` (TXT only; chat.db times are exact UTC).
- **SQLite loading:** the default loader imports `vendor/sql-wasm-browser.mjs` (sql.js re-bundled as an ES module) and passes the wasm bytes; `setSqlJsLoader(fn)` overrides it. No eval, so it works under a strict CSP.
- **Source:** view `ego`, `egoKey` `imessage:me`.
- **Nodes:** `imessage:<handle>` (phones: digits and leading `+`, no country code added; emails lowercased); `platformIds { phone | email, apple_person }`. TXT contact names: `imessage:name:<nameKey>`.
- **Contexts:** `imessage:dm:<handle>` (iMessage / SMS / RCS chats with one handle merged), `imessage:group_dm:<chat.guid>`; TXT per file.
- **Events:** `message` (`imessage:msg:<guid>`; 1:1 `dm`; inline replies `reply` + parent; text from `text` else decoded `attributedBody`); tapbacks 2000-2007 as `reaction` to the parent's author with parent link, removals 3000-3007 cancel; stickers as reactions; group actions -> `join` / `leave`. Apple epoch (2001-01-01): values >= 1e12 are ns, else s; 0 / NULL -> NaN.
- **Warnings:** `large-database`, `wal-not-applied`, `wal-mode-copy` (both give the `sqlite3 ~/Library/Messages/chat.db ".backup ..."` instruction), `contacts-not-read`, `orphaned-messages`, `missing-date`, `unknown-chat`, `unknown-sender`, `tapback-parent-missing`, `unknown-associated-type`, `attributed-body-undecoded`, `timezone-unknown`, `invalid-timezone`, `reply-parent-unknown`, `identity-by-name`, `txt-ignored`.
- **Extra exports:** `setSqlJsLoader`, `loadSqlJs`, `appleDateMs`, `normalizeHandle`, `stripAssociatedGuid`, `parseExporterTxt`; `decodeAttributedBody` in `lib/typedstream.js`.

## telegram: Telegram Desktop export (result.json)

- **Detect:** 0.95 full export (`"chats": {` or `personal_information` + `about`) or single-chat root with a known chat `type` and `messages`; 0.7 `date_unixtime` + `messages`.
- **Options:** `includeChannels` (false), `includeBotChats` (false).
- **Streaming:** `streamJSON` over `chats|left_chats.list.*.{name,type,id,messages.*}`, `personal_information`, `contacts.list.*`, `frequent_contacts.list.*`; one message in memory at a time.
- **Source:** full export view `ego`, `egoKey` `telegram:user<id>`; single chat view `chat`. tz `UTC` (`date_unixtime`).
- **Nodes:** `telegram:<from_id>` with prefix kept (`telegram:user123`, `telegram:channel9`); `telegram:username:<lower>`; `telegram:name:<nameKey>` for unresolved service-message names.
- **Contexts:** `telegram:dm:<id>` (personal / bot chats), `telegram:group_dm:<id>` (groups), `telegram:channel:<id>` (skipped by default); saved messages and similar not imported.
- **Events:** `message` (text from `text_entities`, fallback `text` / `rich_message`; 1:1 `dm`; `reply_to_message_id` -> parent + `reply`; `mention_name` by user id, `mention` by username); `reaction` per `reactions[].recent[]`; calls as `copresence`; service actions -> `join` / `leave`; frequent contacts -> `declared` with **weight = Telegram's own opaque rating** (`telegram-rating-weight` warning).
- **Warnings:** `no-unixtime`, `identity-by-name`, `mention-by-username`, `dm-ego-unknown`, `reaction-time-unknown`, `telegram-rating-weight`, `frequent-contacts-no-ego`, `rich-message`, `cross-chat-reply`, `reactions-partial`, `no-sender`, `group-migrated`, `channels-excluded`, `bot-chats-excluded`, `unknown-chat-type`, `chat-without-type`.
- **Extra exports:** `flattenText`, `detect`.

## meta: Facebook Messenger and Instagram messages (JSON)

- **Detect:** 0.95 `**/messages/{inbox,archived_threads,filtered_threads,message_requests,e2ee_cutover}/<thread>/message_N.json`; 0.9 E2EE chat backup files (`threadName` + string `participants`); 0.6 HTML-only export (import throws "re-export as JSON").
- **Options:** `egoName`, `platform` (`auto` | `messenger` | `instagram`), `includeRequests` (false).
- **Source:** one per platform (medium `messenger` / `instagram`), view `ego`, tz `UTC`. Ego = the one name present in every thread (at least two threads) or `egoName`.
- **Processing:** `fixMojibakeDeep` on everything; a thread's `message_N.json` files merged and sorted ascending (stable); messages in both the standard export and the E2EE backup deduplicated on (sender, timestamp_ms, text).
- **Nodes:** `<platform>:<nameKey(name)>` with `identity-by-name`; deactivated accounts `<platform>:deactivated:<thread>`.
- **Contexts:** `<platform>:dm:<thread folder>` / `<platform>:group_dm:<folder>`.
- **Events:** `message` (1:1 `dm`); `reaction` (NaN time, Meta does not export it); Subscribe / Unsubscribe -> `join` / `leave`; answered calls `copresence`.
- **Warnings:** `identity-by-name`, `platform-ambiguous`, `requests-excluded`, `ego-unknown`, `deactivated-users`, `undated-reactions`, `e2ee-missing`, `bad-json`, `no-sender`.

## discord: official data package and DiscordChatExporter

- **Detect:** package by structure (`c?<15-20 digit id>/channel.json`; 0.95 with `index.json`, else 0.8), so localized folder names work; DCE JSON (`"guild":{` + `"channel":{` + messages / exportedAt) 0.95; DCE CSV header 0.95; DCE HTML 0.95 (refused, `dce-html-unsupported`).
- **Options:** `friends` (true): friendships from `user.json` as declared ties.
- **Snowflakes:** parsed with `parseJSON` / `streamJSON`, so 19-digit numeric `ID`s survive exactly (tested).
- **Package (view `authored`):** ego from `user.json` (or inferred from DM recipient lists); `message` per sent message with DM partner as `dm` and `<@id>` / `<@!id>` mentions; messages.json or messages.csv; numeric or string channel types; `Activity/` never opened; only id / username / discriminator / global name kept from `user.json`.
- **DCE JSON (view `chat`, streamed):** `message` with `reply` (reference resolved within the file), `mention`, interaction user as `reply`; DMs `dm`; join / leave system kinds; one `reaction` per listed reactor (time = message time, flagged); `isBot` from `author.isBot`.
- **Nodes / contexts:** `discord:<snowflake>`; `discord:<dm|group_dm|thread|channel>:<channelId>`.
- **Warnings:** `outgoing-only`, `no-user-json`, `ego-unknown`, `bad-channel-json`, `bad-index-json`, `no-messages-file`, `deleted-user`, `dm-partner-unknown`, `time-from-id`, `reply-parent-outside-export`, `reactors-incomplete`, `reaction-time-approximate`, `system-messages-skipped`, `exporter-local-time`, `dm-many-authors`, `no-author`, `empty-export`, `dce-csv-limited`, `dce-html-unsupported`, `nothing-found`.
- **Extra exports:** `parseDiscordTime(s)`, `textMentions(text)`, `channelTypeName(t)`.

## reddit: data request CSVs and Pushshift / Arctic Shift NDJSON

- **Detect:** 0.9 data-request CSVs by header names (split files like `comments_2.csv` included); 0.9 dumps (`RC_/RS_YYYY-MM`, `*_comments`, `*_submissions`, `.ndjson/.jsonl/.json` whose first record has the comment or submission fields); 0.8 `.zst` (reason includes `zstd -d --long=31`).
- **Options:** `username` (data request export).
- **Nodes / contexts:** `reddit:<lowercased username>` (AutoModerator `isBot`); `reddit:subreddit:<name>`, `reddit:dm:<thread>`, `reddit:dm|group_dm:<channel_url>`. Event keys `reddit:t1_<id>`, `reddit:t3_<id>`, `reddit:t4_<id>`, `reddit:chat:<id>`.
- **Data request (view `ego`):** posts / comments in subreddit contexts (comments have parent links, no reply target because the export lacks the parent author); private messages `dm`; chats with `reply` targets; friends `declared` undated; subscriptions as ego attr.
- **Dumps:** pass 1 indexes `t1_` / `t3_` ids to authors, pass 2 adds `reply` targets from `parent_id`; `[deleted]` authors dropped; `created_utc` number or string; view `authored` (one author), `full` (one subreddit) or `sample`.
- **`.zst`:** alone, import throws `ZSTD_HELP` (`zstd -d --long=31 FILE.zst`); next to readable data, skipped with `zst-skipped`.
- **Warnings:** `ego-unknown`, `ego-inferred`, `reply-author-unknown`, `message-to-subreddit`, `chat-parent-missing`, `chat-one-sided`, `friends-undated`, `unparsed-date`, `captured-record`, `deleted-author`, `reply-to-deleted`, `parent-outside-data`, `bad-time`, `bad-line`, `zst-skipped`.
- **Extra exports:** `classifyCsvHeader`, `parseExportDate`, `createdMs`, `ZSTD_HELP`.

---

## Native round trips (generator exports)

`test/integration/digestion.test.js` imports every native export the generator writes with automatic detection and compares it one for one with the generator's dataset. Fixes made for it (regression tests in `test/importers-b/digestion-fixes.test.js`):

- **whatsapp:** in a group chat, an `@⁨Name⁩` mention (isolate-delimited, so its extent is exact) or `@+digits` mention links the person even if they never wrote; they become a node keyed like any author (spec section 4: mention spans "can be used to extract mention edges"). In a 1:1 chat a mention of a third person stays unlinked (`mention-unmatched`), since a participant there would become a `dm` recipient.
- **linkedin:** with a single conversation in which only the other person wrote, the owner's URL is found by elimination (the URL in every conversation that never sent under someone else's name), instead of keying the owner `linkedin:me` beside their own URL node.

Expected differences, by format (the test computes each rather than allowing slack):

| Importer | Difference | Why |
|---|---|---|
| whatsapp | Day and month may be swapped in a chat whose dates all read either way. | Each chat file is inferred alone, as whatsapp-chat-parser does; with no day above 12 the order is a guess (`date-order-ambiguous`, or the parser's change-frequency heuristic). Set `dateOrder`. |
| whatsapp | Times are off by the phone's UTC offset. | The export has wall-clock times and no zone; without the `timezone` option they are read as UTC (`timezone-unknown`). Android keeps minutes only. |
| whatsapp | A 1:1 chat where only the other person wrote has no `dm` targets. | Nothing in the file names the owner (`direct-partner-unknown`); set `egoName`. |
| telegram | Someone seen only in a service message (e.g. invited, never wrote) is keyed `telegram:name:<name>`. | Service messages name people, not ids. |
| linkedin | The owner is `linkedin:me` when no invitation and no message names their URL. | Profile.csv carries no URL. |
| x-archive | Likes and follows are undated; likes have no target (`/i/web/status/<id>` URLs). | The archive does not record them. |
| discord | Reactions are dated at their message (`reaction-time-approximate`). | DCE lists reactors without a time. |
| network-canvas | Alters are per interview (`nc:<ego>:<alter>`): nodes = respondents + all their alters. | Spec: the same name in two interviews is not the same person; identity review can merge. |

