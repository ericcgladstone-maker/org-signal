# Threads (Meta) data download

Status: **medium confidence**. Meta publishes no field documentation, and its help pages could not be fetched. File names and JSON keys below come from a real public export on GitHub (inspected with values redacted) and three open-source parsers that agree with each other. The mojibake issue is **confirmed** in real Threads JSON.

## 1. How it's obtained

| Item | Value |
|---|---|
| Who | the account holder. Accounts Center → Your information and permissions → **Export your information** (formerly "Download your information") → choose the Threads profile → Export to device |
| Format choice | **JSON** or HTML: tell users to pick JSON. Date range and categories are selectable |
| Bundling | Instagram-linked Threads profiles: Threads data arrives **inside the Instagram export** under `your_instagram_activity/threads/`. Threads-only profiles (email/phone) have a separate flow (per third-party guide, **UNVERIFIED** tree) |
| Zip name | `instagram-<username>-<YYYY-MM-DD>-<random>.zip` (observed in parsers' folder checks) |
| Delay / expiry | Third-party guide quotes Meta as "up to 30 days" (often minutes to hours in practice). Link expiry is **UNVERIFIED** |

## 2. File tree (JSON export, Instagram-bundled)

```
instagram-<username>-2025-08-24-AbCdEfGh/
├── your_instagram_activity/
│   ├── threads/
│   │   ├── threads_and_replies.json        # own posts AND replies
│   │   ├── liked_threads.json
│   │   ├── saved_threads.json
│   │   ├── archived_threads.json           # sometimes
│   │   ├── threads_viewed.json             # sometimes
│   │   ├── followers.json   (followers_1.json, … numbered variants reported)
│   │   ├── following.json
│   │   ├── recent_follow_requests.json
│   │   ├── recently_unfollowed_profiles.json
│   │   ├── blocked_profiles.json
│   │   └── personal_information.json
│   └── media/ …                            # Instagram content
├── media/ (posts/YYYYMM/…, profile/…)      # media referenced by relative `uri`
└── … other Instagram folders (connections/followers_and_following/, messages/, …)
```

Parsers also accept a bare `threads/` folder (users upload a subfolder). Which files appear depends on the categories and date range chosen.

## 3. Record schemas

All Meta JSON uses the same generic "label/value" shapes (`title`, `string_list_data`, `string_map_data`, `media_map_data`). Timestamps are **Unix seconds (UTC)**. Each file is an object with **one top-level key**:

| file | top-level key |
|---|---|
| threads_and_replies.json | `text_post_app_text_posts` |
| liked_threads.json | `text_post_app_media_likes` |
| saved_threads.json | `text_post_app_text_post_app_saved_posts` |
| archived_threads.json | `text_post_app_text_app_archived_posts` |
| threads_viewed.json | `text_post_app_text_post_app_posts_seen` |
| followers.json | `text_post_app_text_post_app_followers` |
| following.json | `text_post_app_text_post_app_following` |
| recent_follow_requests.json | `text_post_app_text_post_app_permanent_follow_requests` |
| blocked_profiles.json | `text_post_app_text_post_app_blocked_users` |
| personal_information.json | `text_post_app_text_post_app_profile` |

### threads_and_replies.json

```json
{ "text_post_app_text_posts": [
  { "media": [
      { "uri": "",
        "creation_timestamp": 1754466859,
        "title": "agreed â\u0080\u0094 let's sync tomorrow",
        "media_metadata": { "camera_metadata": { "has_camera_metadata": false } },
        "cross_post_source": { "source_app": "FB" },
        "text_app_post": { "reply_control": "everyone", "geo_gated_country_list": "", "is_reply": true } } ],
    "title": "…", "creation_timestamp": 1754466859 } ] }
```

| field | meaning |
|---|---|
| media[].title | **post text** (mojibake-encoded) |
| media[].creation_timestamp | Unix seconds |
| media[].uri | relative media path or `""` for text-only |
| text_app_post.is_reply | bool: **is a reply, but the parent post and parent author are NOT included** |
| text_app_post.reply_control | `everyone`, `accounts_you_follow`, `mentioned_only`, `parent_post_author_only`, … |
| cross_post_source.source_app | e.g. `FB` |
| top-level title / creation_timestamp | sometimes present at the post level (parsers handle both) |

No post id, no URL, no mention list, no parent link. Mentions can only be recovered by regex `@[A-Za-z0-9._]+` on the decoded text.

### liked_threads.json

```json
{ "text_post_app_media_likes": [
  { "title": "river.otter", "media_list_data": [],
    "string_list_data": [ { "href": "https://www.threads.com/@river.otter/post/DAbCdEfGhIj",
                            "value": "ð\u009f\u0091\u008d", "timestamp": 1760912834 } ] } ] }
```

- `title` = **author username of the liked post**.
- `href` = post URL (contains `@author` and the post shortcode).
- `value` = the reaction (👍, mojibake-encoded).
- `timestamp` = like time.

### followers.json / following.json / blocked_profiles.json / recent_follow_requests.json

```json
{ "text_post_app_text_post_app_followers": [
  { "title": "Pine Marten Ã©cole",
    "string_list_data": [ { "href": "https://www.threads.com/pine.marten", "value": "pine.marten", "timestamp": 1730000000 } ] } ] }
```

Verified on a real export (75 followers, 155 following):
- `value` = username
- `href` = `https://www.threads.com/<username>`, with no `@` (older exports likely `threads.net`)
- `title` = display name (empty for ~15%, mojibake for non-ASCII)
- `timestamp` = follow time (a third-party guide warns it is "not guaranteed as creation date")

Instagram's equivalent files have changed shape over time (title vs value), so parse defensively: `username = value || title || lastPathSegment(href)`.

### personal_information.json

`string_map_data` keyed by **human-readable labels**: `Username`, `Name`, `Bio`, `Private Account`, `Email`, `Phone Number`, … each `{href, value, timestamp}`. Drop PII. Use `Username` and `Name` for the ego node.

### threads_viewed.json / saved / archived

`string_map_data` with label keys (`Author`, `Time`, `URL` observed). **Labels are localized to the account language**: one parser matches `作者` (Chinese for "Author") after decoding. Don't hard-code English keys: match by value shape instead (`href` present → URL, `timestamp` → time, else author).

## 4. Mapping to the internal model

| internal | posts | likes | follows |
|---|---|---|---|
| actor | ego (personal_information Username, or zip name) | ego | ego (following) / `value` (followers) |
| targets | regex @mentions in text only. **Reply target unknown** | `title` (author username) | `value` |
| timestamp | `creation_timestamp` × 1000 → UTC | `timestamp` | `timestamp` (follow time, best effort) |
| context id | none | post URL shortcode | – |
| visibility | public (or followers-only if `Private Account` = True). `reply_control` is reply policy, not visibility | – | – |
| parent | none. `is_reply` flag only | – | – |
| text | decoded `title` | – | – |
| node attrs | – | – | display name (`title`), follow timestamp |

- **Declared ties:** following, followers (both directions **with timestamps**, better than X/Bluesky), blocked, follow requests.
- **Interaction events:** likes (ego→author, timestamped) and text-regex mentions. Replies exist only as an unattributed flag. **No DMs**: Threads has none, and Instagram DMs are a separate Instagram format.

## 5. Observation note

**Ego view**, with both follow directions. Not visible:
- who the ego replied to
- replies/likes/mentions received
- ties among others

Mentions are inferred from text (ambiguous if the user later renamed). The date-range selection at request time can silently truncate history: record it as provenance if detectable from the min/max timestamps.

## 6. Auto-detection signature

- Zip/folder path contains `threads/` and a file named `threads_and_replies.json`, `liked_threads.json`, `followers.json` or `following.json`.
- Confirm via the **top-level key prefix `text_post_app_`** (unique to Threads among Meta exports).
- HTML exports (`.html` files in the same names) → reject with "please re-export as JSON".

## 7. Quirks and pitfalls

### Meta mojibake (confirmed for Threads)

Meta writes each UTF-8 byte as its own `\u00XX` escape. After `JSON.parse`, every string is "UTF-8 bytes read as Latin-1": 👍 becomes `"ð\u009f\u0091\u008d"` → `ðŸ‘` and `é` → `Ã©`. Fix per string after parsing:

```js
const dec = new TextDecoder('utf-8', { fatal: true });
const fixMeta = s => {
  if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s; // nothing to fix / already real Unicode
  try { return dec.decode(Uint8Array.from(s, c => c.charCodeAt(0))); }
  catch { return s; }                                                      // genuine Latin-1 text, not mojibake
};
```

Apply it to all string values *and* object keys (localized label keys are also mangled). Keep it idempotent with the `> 0xFF` guard.

Other pitfalls:
- `threads.net` → `threads.com` domain change in URLs. Normalize both.
- Usernames are case-insensitive. Lowercase them for node keys.
- Numbered splits (`followers_1.json`, `_2` …): merge.
- Size: small (KB–low MB) unless media is included.

## 8. Browser feasibility

Fully feasible:
- `fflate`/`zip.js` to read only `*/threads/*.json`
- `JSON.parse`
- the mojibake fix (native `TextDecoder`)

No network is needed. Small file sizes mean no streaming is required.

## Sources

Official:
- Meta Help Center pages could not be fetched (bot protection). Procedure is from third-party guides citing Meta. **No official schema exists publicly.**

Community (source and real data read):
- Real Threads export files (structure inspected, values redacted): https://github.com/taqicz/itlab/tree/HEAD/threads
- jschang19/threads-recap types and validation: https://github.com/jschang19/threads-recap/blob/HEAD/app/types/threads.ts , https://github.com/jschang19/threads-recap/blob/HEAD/app/utils/file-upload/folder-validation.ts , https://github.com/jschang19/threads-recap/blob/HEAD/app/utils/file-upload/file-validation.ts
- haunchen/threads-wrapped parser (mojibake fix, archived/likes keys): https://github.com/haunchen/threads-wrapped/blob/HEAD/js/parser.js
- laadtushar/MemryLab Threads adapter: https://github.com/laadtushar/MemryLab/blob/HEAD/src-tauri/src/pipeline/ingestion/source_adapters/threads.rs
- sonqh/threads-auto-post import design (zip tree): https://github.com/sonqh/threads-auto-post/blob/HEAD/apps/backend/scripts/IMPORT_SCRIPT_DESIGN.md
- dontfollowback guide (file list, "up to 30 days", JSON vs HTML): https://dontfollowback.com/blog/2026-07-14-how-to-download-threads-data-json-export
- Meta mojibake background: https://stackoverflow.com/questions/50008296/facebook-json-badly-encoded (via search), https://gist.github.com/kepae/c88b00d88bd4f35242827ed73c70e06a (via search)
