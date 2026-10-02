# Reddit

| | (a) Official data request (GDPR/CCPA) | (b) Research dumps (Pushshift / Arctic Shift) |
|---|---|---|
| Producer | reddit.com/settings/data-request | Pushshift (≤2023-03), Arctic Shift (2023-04+) monthly dumps; per-subreddit extracts by u/Watchful1; Arctic Shift web download tool |
| Container | `.zip` of flat CSVs | `.zst`-compressed NDJSON (one JSON object per line) |
| Scope | Your own posts/comments/PMs/chats | Every public post/comment (whole site or one subreddit) |
| Network value | Ego only; comment parents are ids, not authors | Full reply networks (with parent-author lookup) |
| Confidence | Medium: official help pages 403'd to our fetcher; column lists from 4 independent open-source parsers that agree | High: maintainers' scripts + auto-generated schemas |

---

## (a) Official data request export

### How obtained
User submits form at `https://www.reddit.com/settings/data-request`; Reddit emails a link to a ZIP of CSV files "within 30 days (usually much faster)" (search-snippet paraphrase of Reddit Help; pages at support.reddithelp.com returned 403 to our fetcher).

### File tree (flat zip, no folders)

```
export_<username>_<date>.zip      (zip name not verified)
├── posts.csv                 your submissions
├── comments.csv              your comments
├── messages.csv              legacy private messages sent AND received
├── messages_archive.csv      (seen in some exports)
├── chat_history.csv          Reddit Chat (sent and received in your chats)
├── subscribed_subreddits.csv | moderated_subreddits.csv | approved_submitter_subreddits.csv
├── friends.csv               username,note
├── post_votes.csv / comment_votes.csv   id,permalink,direction (up/down/none/removed)
├── saved_posts.csv / saved_comments.csv / hidden_posts.csv   id,permalink
├── gilded_content.csv, gold_received.csv, poll_votes.csv, drafts.csv, multireddits.csv,
│   ip_logs.csv, statistics.csv, user_preferences.csv, purchases.csv, ... (ignore)
```

Large tables may be split as `<name>_1.csv`, `<name>_2.csv` (Epicenter importer spec; each with its own header). Some files carry a UTF-8 BOM.

### Record schemas (header order as written by Reddit, per RLEAPP index access + potluck fixture)

`posts.csv`: `id,permalink,date,ip,subreddit,gildings,title,url,body`
`comments.csv`: `id,permalink,date,ip,subreddit,gildings,link,parent,body,media`
`messages.csv`: `id,permalink,thread_id,date,ip,from,to,subject,body`
`chat_history.csv` (names verified, **order uncertain** — parse by header): `message_id, created_at, updated_at, username, message, thread_parent_message_id, channel_url, subreddit, channel_name, conversation_type`
`subscribed_subreddits.csv`: `subreddit`

| Field | Meaning / format |
|---|---|
| `id` | base-36 id **without** prefix (e.g. `k3x9q2a`) |
| `date`, `created_at` | `YYYY-MM-DD HH:MM:SS UTC` (literal ` UTC`; strip before `Date` parse) |
| `ip` | usually empty in modern exports; never retain |
| `link` (comments) | URL of the submission commented on |
| `parent` (comments) | fullname of parent: `t3_<post>` (top-level) or `t1_<comment>`; may be empty (from synthetic fixture modelled on real shape — treat as probable) |
| `from` / `to` (messages) | usernames (no `u/`) — the only CSV with real counterpart identities |
| `thread_id` | PM conversation thread |
| `username` (chat) | sender of each chat line (both you and others) |
| `channel_url` | chat channel identifier (`sendbird`-style URL/ID; unverified) |
| `conversation_type` | DM vs group/subreddit channel (exact values unverified) |

Synthetic examples:
```csv
id,permalink,date,ip,subreddit,gildings,link,parent,body,media
lq7a2b9,https://www.reddit.com/r/urbanplanning/comments/1abcd2/bike_lanes/lq7a2b9/,2024-05-02 18:11:04 UTC,,urbanplanning,0,https://www.reddit.com/r/urbanplanning/comments/1abcd2/bike_lanes/,t1_lq79zz1,"Agree with this, mostly.",
id,permalink,thread_id,date,ip,from,to,subject,body
2bq9x1,https://www.reddit.com/message/messages/2bq9x1,,2023-11-08 09:30:00 UTC,,river_otter_77,maple_owl,re: meetup,"See you there"
```

### Mapping
- Ego = the account (infer username: most frequent `from` in messages.csv / `username` in chat_history, or ask).
- `messages.csv` → event `sender=from`, `targets=[to]`, `timestamp=date`, `visibility=private`, `context=thread_id`. Both directions present.
- `chat_history.csv` → event `sender=username`, `context=channel_url`, `timestamp=created_at`; targets = other participants seen in same `channel_url` (approximation), `parent=thread_parent_message_id`.
- `comments.csv` → event `sender=ego`, `context=subreddit`/`link`, `parent=parent`, `visibility=public`; **target author unknown** (needs external lookup — not possible offline). Use as ego→subreddit affiliation.
- `posts.csv` → ego→subreddit events. `subscribed_subreddits.csv` → declared ego–subreddit ties. `friends.csv` → declared ego–user ties.

### Observation note
Ego view. Only PMs and chats give person-to-person edges; public comments give ego→thread/subreddit only.

### Auto-detection
Zip containing any of `comments.csv`, `posts.csv`, `subscribed_subreddits.csv`, `post_votes.csv`, with `comments.csv` header containing `permalink`,`subreddit`,`link`,`parent`. Match `^(.*/)?<name>(_\d+)?\.csv$`.

### Quirks
Strip BOM; multi-line quoted bodies; split files; date literal `UTC`; ids lack `t1_`/`t3_` prefix while `parent` has it. Size small (MBs; votes files can be 100k+ rows).

### Browser feasibility
Trivial: fflate/zip.js + PapaParse.

---

## (b) Pushshift / Arctic Shift research dumps

### How obtained
- Monthly whole-site files `RC_YYYY-MM.zst` (comments) and `RS_YYYY-MM.zst` (submissions) via Academic Torrents (links in arctic_shift `download_links.md`; full 2005-06–2025-12 set ≈ 3.8 TB compressed per magnet `xl`).
- Per-subreddit extracts `<subreddit>_comments.zst` / `<subreddit>_submissions.zst` (Watchful1 "top 40k subreddits" torrent; filenames as used in PushshiftDumps scripts).
- Arctic Shift API/web download tool for single users/small subreddits (output format of the web tool **not verified**; assume `.jsonl`/`.json`).

### Grammar
`zstd( line* )`, each line = one UTF-8 JSON object, `\n`-separated. Since 2023-04: objects sorted by (`created_utc`, `id`), keys sorted, `body_html` removed, `retrieved_on` added. Since 2023-11: `_meta` object (`retrieved_2nd_on`, `was_deleted_later`, `was_initially_deleted`, `removal_type`, `is_edited`, `note`).

### Key fields (from arctic_shift `schemas/RC.ts`, `RS.ts`; Watchful1 `filter_file.py` comments)

Comment (RC):

| Field | Type | Meaning |
|---|---|---|
| `id` | string | base-36, no prefix |
| `name` | string? | fullname `t1_<id>` (not always present) |
| `author` | string | username; `"[deleted]"` when removed; `AutoModerator` bot |
| `author_fullname` | string? | `t2_<id>` (stable even if renamed; absent in old data) |
| `subreddit`, `subreddit_id` | string | name, `t5_<id>` |
| `link_id` | string | `t3_<submission id>` |
| `parent_id` | string | `t1_<comment id>` (reply to comment) or `t3_<submission id>` (top-level) |
| `created_utc` | **number or string** | Unix seconds; older Pushshift data stores it as a string → `Number()` |
| `body` | string | `"[deleted]"` / `"[removed]"` possible |
| `score`, `edited` (bool or epoch), `distinguished`, `permalink?`, `retrieved_on?` | | |

Submission (RS): `id`, `name?`, `author`, `author_fullname?`, `subreddit`, `subreddit_id`, `created_utc`, `title`, `selftext`, `url`, `is_self`, `num_comments`, `score`, `permalink`, `over_18`, `distinguished`.

Prefixes (PRAW `praw.ini`): `t1` comment, `t2` account, `t3` submission, `t4` message, `t5` subreddit, `t6` trophy.

```json
{"author":"maple_owl","body":"Source?","created_utc":1714670000,"id":"lq7b001","link_id":"t3_1abcd2","parent_id":"t1_lq7a2b9","score":3,"subreddit":"urbanplanning","subreddit_id":"t5_2qhxe"}
```

### Building the reply network
1. Pass 1: index `id → author` for every comment (`t1_`+id) and submission (`t3_`+id).
2. Pass 2: for each comment, `target = index[parent_id]`; if `parent_id` starts `t3_`, target = submission author (reply-to-OP).
3. Unresolvable parents (outside the time/subreddit window) → keep event with `parent` but no target; report count.
4. Drop/flag `[deleted]` authors (they collapse into one fake node), optionally `AutoModerator` and self-replies.

Event mapping: `sender=author`, `targets=[parent author]`, `timestamp=created_utc*1000`, `context=link_id` (thread) + `subreddit`, `visibility=public`, `parent=parent_id`. Submissions: `sender=author`, `context=subreddit`, no target.

### Observation note
Near-complete public record **as captured** (Pushshift captured near-real-time, so later deletions persist; Arctic Shift 2023-11+ re-fetches at 36 h). Private/quarantined subreddits excluded. A subreddit extract is a full network of that community but a sample of users' total activity.

### Auto-detection
File name `^R[CS]_\d{4}-\d{2}(\.zst)?$` or `_comments.zst` / `_submissions.zst`; zstd magic bytes `28 B5 2F FD`; first decoded line is JSON with `parent_id` & `link_id` (comments) or `title` & `num_comments` (submissions).

### Size expectations
Single months of RC are tens of GB compressed (hundreds decompressed) — **not browser-sized**. Per-subreddit files range KB–tens of GB. Target: per-subreddit or Arctic-Shift-tool extracts up to a few hundred MB decompressed.

### Browser feasibility (zstd)
- Native `DecompressionStream('zstd')`: not shipped by default in major browsers as of 2026 (caniuse/MDN; Firefox behind flag). Don't rely on it.
- `fzstd` (pure JS, streaming, 8 kB): README: "only supports a maximum backreference distance of 2^25 bytes" — files made with ultra levels and long windows "may fail". The reference Python readers use `ZstdDecompressor(max_window_size=2**31)`, i.e. dumps can use windows up to 2 GB (`--long=31`). **Expect fzstd to fail on many dump files.**
- WASM zstd (compiled libzstd with `ZSTD_d_windowLogMax=31`) can work but needs up to 2 GB of WASM memory — risky on laptops, fails on mobile. No specific package verified.
- Recommendation: accept `.zst` with a WASM streaming decoder behind a try/catch; on window-size error, instruct user to run `zstd -d --long=31 file.zst` and upload the `.ndjson`. Always line-stream (TextDecoder streaming + split on `\n`), two passes or single pass with deferred parent resolution.

---

## Sources
Official
- https://support.reddithelp.com/hc/en-us/articles/360043048352 and https://support.reddithelp.com/hc/en-us/p/what_is_in_my_reddit_data_copy — **403 to fetcher**, content only via search snippets
- https://www.reddit.com/dev/api/ — blocked; prefixes taken from PRAW instead
Community (code read)
- https://github.com/EpicenterHQ/epicenter (`apps/reddit/src/lib/workspace/ingest/reddit/csv-schemas.ts`, `transforms.ts`, `specs/20260311T150607-reddit-ingest-hardening.md`)
- https://github.com/abrignoni/RLEAPP (`scripts/artifacts/reddit.py`)
- https://github.com/DoubleGremlin181/potluck (`src/potluck/testing/reddit.py`, `src/potluck/ingest/sources/reddit.py`)
- https://github.com/humandataincome/hudi-packages-connectors (`src/source/reddit/enum.reddit.ts`)
- https://github.com/d4data-official/archive-lib (`.../Reddit/getters/getChatMessages.ts`)
- https://github.com/ArthurHeitmann/arctic_shift (`file_content_explanations.md`, `download_links.md`, `schemas/RC.ts`, `schemas/RS.ts`, `scripts/fileStreams.py`)
- https://github.com/Watchful1/PushshiftDumps (`scripts/single_file.py`, `filter_file.py`, `combine_folder_multiprocess.py`)
- https://github.com/praw-dev/praw (`praw/praw.ini`)
- https://github.com/101arrowz/fzstd (README)
- https://caniuse.com/mdn-api_decompressionstream_decompressionstream_zstd (via search summary)
