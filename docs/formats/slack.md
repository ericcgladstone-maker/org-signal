# Slack export formats

Status: researched 2026-10-02. Confidence: **high** on the zip tree, metadata files and core message fields (official docs and three independent open-source parsers agree). **Medium** on Enterprise Grid layout (community sources only, no official tree). Unverified items are tagged **[UNVERIFIED]**.

---

## 1. How it's obtained

| Variant | Who can export | Plan | Contents | Notes |
|---|---|---|---|---|
| Standard export ("public only") | Workspace Owners/Admins | Free, Pro, Business+ | Public channels only (messages + file *links*) | Free: file links only for the last 90 days. |
| All channels & DMs ("full") | Workspace **Owners only**, after an application is approved by the Workspace Primary Owner | Business+ | Public + private channels + DMs + group DMs (Slackbot DMs included) | Can be scheduled as recurring. |
| Org export | Org Owners/Admins, or the Export Admin role | Enterprise Grid | Custom: by conversation type, member, or workspace; all channels and conversations | Self-serve tools may need enabling via Slack Support. |
| Single-user export | — | — | JSON or **TXT** (TXT has `channels/`, `dms/`, `files/`, `Canvases/` subfolders) | The help article mentions it. Treat TXT as unsupported. |
| Third-party: slackdump `-type standard` | Any member, using their own token | any | Whatever that user can see | Same layout as a Slack export. Default `-type mattermost` puts files in `__uploads/`. |

Typical file name: `<Workspace Name> Slack export <Mon D YYYY> - <Mon D YYYY>.zip` **[UNVERIFIED: exact naming pattern]**. Don't rely on the file name; detect by content.

## 2. Container / file tree

### Workspace export (Free/Pro/Business+)

```
export.zip
├── users.json              # array of user objects (all workspace members, incl. deactivated + bots)
├── channels.json           # public channels (array)
├── groups.json             # private channels (only in full export)
├── dms.json                # 1:1 DMs (only in full export)
├── mpims.json              # group DMs (only in full export)
├── integration_logs.json   # app/integration add/remove log (array)
├── canvases.json           # canvas URLs + download links (newer exports)
├── file_conversations.json # canvas-comment associations (newer exports)
├── huddle_transcripts.json # seen in eDiscovery-vendor docs; contents not documented [UNVERIFIED]
├── lists.json              # same as above [UNVERIFIED]
├── general/                # PUBLIC channel  -> folder = channel "name"
│   ├── 2024-03-04.json     # array of message objects for that day
│   └── 2024-03-05.json
├── proj-apollo/            # PRIVATE channel -> folder = channel "name" (from groups.json)
│   └── 2024-03-04.json
├── D07ABCDEF12/            # 1:1 DM          -> folder = DM "id" (DMs have no name)
│   └── 2024-03-04.json
├── mpdm-ana.ruiz--ben.okafor--chen.li-1/   # GROUP DM -> folder = mpim "name"
│   └── 2024-03-04.json
└── FC:F07XYZ.../           # canvas comment threads ("FC:" prefix) – ignore for networks
```

A folder exists only if the conversation has ≥1 message in the date range. A daily file exists only for days with messages.

### Enterprise Grid org export ([community-verified via mmetl + Relativity docs])

```
org-export.zip
├── org_users.json          # org-wide users (replaces/augments users.json)
├── channels.json / groups.json / dms.json / mpims.json   # org-level (e.g. org-shared) conversations
├── <conversation folders>/YYYY-MM-DD.json                # org-level conversations
├── content_flags.json      # Enterprise only, if flagging enabled
└── teams/
    ├── <Workspace A name>/ # a nested, complete workspace export
    │   ├── users.json
    │   ├── channels.json, groups.json, dms.json, mpims.json
    │   └── <conversation folders>/YYYY-MM-DD.json
    └── <Workspace B name>/ ...
```

mmetl's grid transformer works out each folder's workspace from the `team` field on its posts, or the majority `team_id` in that workspace's `users.json`. A conversation shared across workspaces can show up at the root, and its folder location may not match its owning workspace.

## 3. Record schemas

### users.json / org_users.json (array)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `U…` or `W…` (Grid global IDs can start with either; the prefix means nothing). `USLACKBOT` for Slackbot. |
| `team_id` | string | `T…` workspace ID |
| `name` | string | handle (legacy username) |
| `real_name` | string | full name (also in `profile`) |
| `deleted` | bool | deactivated |
| `is_bot`, `is_app_user` | bool | bot accounts |
| `is_admin`, `is_owner`, `is_primary_owner` | bool | roles |
| `is_restricted` | bool | multi-channel guest |
| `is_ultra_restricted` | bool | single-channel guest (sets both flags) |
| `tz`, `tz_label`, `tz_offset` | string, string, int (sec) | user's time zone (useful node attribute) |
| `updated` | int | epoch seconds |
| `profile` | object | `real_name`, `display_name`, `first_name`, `last_name`, `title`, `email` (may be absent), `phone`, `image_*`, `status_text`, `status_emoji`, `team`, `fields`, `bot_id` (bots) |
| `enterprise_user` (Grid) | object | `id`, `enterprise_id`, `enterprise_name`, `is_admin`, `is_owner`, `teams` (array of workspace IDs) |

### channels.json / groups.json (array)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `C…`. Private channels made before March 2021 are `G…`; newer ones are `C…`. A `G` ID becomes `C` when a channel share starts. |
| `name` | string | channel name = folder name |
| `created` | int **or string** | epoch seconds. Old exports have this as a string (`"1452837318"`). Coerce it. |
| `creator` | string | user ID |
| `is_archived`, `is_general` | bool | |
| `members` | string[] | user IDs at export time (current roster, not history) |
| `topic`, `purpose` | `{value, creator, last_set}` | |
| `pins` | array | optional |

### dms.json (array)

```json
[{ "id": "D07ABCDEF12", "created": 1709550000, "members": ["U01ANARUIZ0", "U01BENOKAF0"] }]
```

### mpims.json (array)

Has the same shape as a conversation object: `id`, `name` (`mpdm-<handle>--<handle>--<handle>-1`), `created`, `creator`, `is_archived`, `members`, `topic`, `purpose`. slackdump-produced files also have `is_mpim`, `is_private`, `num_members`, `name_normalized`, but real Slack mpims.json may not.

### Message object (each `YYYY-MM-DD.json` is a JSON **array** of these)

| Field | Type | Meaning / notes |
|---|---|---|
| `type` | string | always `"message"` |
| `subtype` | string? | absent for normal user messages. See the subtype table. |
| `user` | string? | sender user ID. Absent on some `bot_message`s. |
| `bot_id` | string? | `B…` for bot/app/integration posts |
| `username` | string? | bot display name (bot_message) |
| `text` | string | Slack mrkdwn, with entities encoded (see below). `&`,`<`,`>` are HTML-escaped. |
| `ts` | string | `"1709551234.001200"`: epoch seconds.microseconds, **unique per conversation**. It is the message ID. |
| `thread_ts` | string? | the parent's `ts`. Parent: `thread_ts == ts`. Reply: `thread_ts != ts`. |
| `parent_user_id` | string? | on replies: the thread starter's user ID |
| `reply_count`, `reply_users_count` | int? | on parents |
| `reply_users` | string[]? | on parents (max 5 listed) |
| `latest_reply` | string? | ts |
| `replies` | `[{user, ts}]`? | **deprecated**, but still in older exports, on parents |
| `subscribed`, `last_read` | | per-viewer UI state. Ignore. |
| `reply_broadcast` / subtype `thread_broadcast` | | reply also posted to the channel |
| `reactions` | `[{name, users[], count}]` | `users` may be truncated relative to `count` **[UNVERIFIED cap]** |
| `files` | array | modern uploads: `{id, name, title, mimetype, filetype, user, size, url_private, url_private_download, …}`. Links need auth, so files aren't really in the zip. |
| `file` | object | **legacy** single file (pre-2019 `file_share` / `file_comment`) |
| `upload` | bool | |
| `attachments` | array | legacy attachments / link unfurls / bot rich content |
| `blocks` | array | Block Kit. `rich_text` → `rich_text_section` elements: `{type:"user", user_id}`, `{type:"usergroup", usergroup_id}`, `{type:"channel", channel_id}`, `{type:"broadcast", range:"here"/"channel"/"everyone"}`, `{type:"text", text}` |
| `user_profile` | object? | snapshot of the sender: `avatar_hash`, `image_72`, `first_name`, `real_name`, `display_name`, `team`, `name`, `is_restricted`, `is_ultra_restricted` |
| `team`, `user_team`, `source_team` | string? | workspace IDs (Grid / Slack Connect) |
| `client_msg_id` | string? | UUID set by the client |
| `edited` | `{user, ts}`? | message was edited |
| `inviter` | string? | on `channel_join` when invited |
| `pinned_to` | string[]? | |
| `is_starred` | bool? | exporter-specific. Ignore. |

Subtypes and what to do with them:

| subtype | Treat as |
|---|---|
| *(none)*, `thread_broadcast`, `file_share`, `me_message` | **communication event** |
| `bot_message` (or any message with `bot_id`) | bot event. Make it a separate node class, or drop it. |
| `channel_join`, `channel_leave`, `group_join`, `group_leave` | membership event (timeline of rosters). Not communication. |
| `channel_topic`, `channel_purpose`, `channel_name`, `channel_archive`, `channel_unarchive`, `pinned_item`, `bot_add`, `bot_remove` | metadata events. Skip for edges. |
| `file_comment` (legacy) | communication. Author is in `comment.user`. |
| `message_changed` / `message_deleted` | per the help docs these can appear with `previous`/`original_ts`, depending on retention. Don't double-count. |
| `huddle_thread` | huddle (call). The `room` object has `participants`, `participant_history`, `date_start`, `date_end`, `created_by`, `channels`, `is_dm_call` (per mmetl). These are co-presence edges. |

### Synthetic examples

```json
[
  {"type":"message","user":"U01ANARUIZ0","text":"Draft is up, <@U01BENOKAF0> can you review?",
   "ts":"1709551234.001200","thread_ts":"1709551234.001200","reply_count":2,
   "reply_users":["U01BENOKAF0","U01CHENLI00"],"reply_users_count":2,"latest_reply":"1709553000.004500",
   "client_msg_id":"3f6a1c2e-0000-4000-8000-000000000001","team":"T01EXAMPLE0",
   "user_profile":{"real_name":"Ana Ruiz","display_name":"ana","name":"ana.ruiz","team":"T01EXAMPLE0",
                   "first_name":"Ana","avatar_hash":"abc123","image_72":"https://…","is_restricted":false,"is_ultra_restricted":false},
   "blocks":[{"type":"rich_text","block_id":"x1","elements":[{"type":"rich_text_section","elements":[
     {"type":"text","text":"Draft is up, "},{"type":"user","user_id":"U01BENOKAF0"},{"type":"text","text":" can you review?"}]}]}],
   "reactions":[{"name":"eyes","users":["U01CHENLI00"],"count":1}]},
  {"type":"message","user":"U01BENOKAF0","text":"On it","ts":"1709552100.002300",
   "thread_ts":"1709551234.001200","parent_user_id":"U01ANARUIZ0"},
  {"type":"message","subtype":"channel_join","user":"U01DANAPARK","text":"<@U01DANAPARK> has joined the channel","ts":"1709554000.000100"},
  {"type":"message","subtype":"bot_message","bot_id":"B01DEPLOYBOT","username":"deploybot","text":"Deploy #42 succeeded","ts":"1709555000.000200"}
]
```

## 4. Mapping to the internal model

| Internal field | Source |
|---|---|
| sender | `user`. If missing and `bot_id` is set, use `bot:<bot_id>`. For `file_comment`, use `comment.user`. |
| recipients / targets | depends on context type (see §5). Never infer recipients from `members` alone without flagging it as "audience". |
| timestamp | `parseFloat(ts)` × 1000 → epoch ms, **UTC**. Keep the raw `ts` string as the message ID (float loses µs). |
| timezone | ts is absolute UTC. The daily file name is **not** UTC (see quirks). Use `users[].tz` as a node attribute for local-hour analyses. |
| conversation id | channel/DM/MPIM `id` from the metadata files. Map folder → id by `name` (channels, groups, mpims) or `id` (dms). |
| context type | which metadata file lists the folder: `channels.json`→`public`, `groups.json`→`private`, `mpims.json`→`group_dm`, `dms.json`→`dm`. Grid: same rule within each `teams/<ws>/`. |
| visibility | public / private / direct / group (the same four) |
| thread / parent | `thread_ts` (thread ID = `conversationId + thread_ts`). Parent author = `parent_user_id`. |
| text | `text`, decoded (resolve `<@U…>`, `<#C…|name>`, unescape `&amp;` etc.) |
| node attributes | from users.json: `real_name`, `profile.title`, `tz`, `is_bot`, `deleted`, `is_restricted`/`is_ultra_restricted` (guest), `team_id`, `is_admin`/`is_owner`. Grid: `enterprise_user.teams`. |

## 5. Edge construction notes

- **Reply edges (strongest signal):** reply author → `parent_user_id`, or → the thread root's `user`. Old exports may lack `parent_user_id`. Fall back to looking up the root by `thread_ts` in the same conversation, then the legacy `replies[]` array.
- **Thread co-participation:** everyone who posted in a thread (root + replies) → clique or bipartite person–thread.
- **Mentions:** regex `<@([UW][A-Z0-9]+)(?:\|[^>]*)?>` on `text` (the old form `<@U…|name>` includes a pipe). Also scan `attachments[].text` and the `blocks` `user` elements. Use `<!subteam^S…>` for user-group mentions (expanding them needs group membership, which is not in the export). Use `<!here>`, `<!channel>`, `<!everyone>` for broadcast mentions: treat as audience-wide, not as dyadic edges.
- **Reactions:** reactor → message author (a weak tie). `users` lists the reactors.
- **DMs:** dyadic. sender → the other member in `dms.json[].members`. A DM to oneself has a single member. Mentions inside DMs are redundant.
- **Group DMs:** sender → every other `members` entry (the roster is fixed by definition).
- **Channels:** without replies or mentions there's no addressee. Options: sender→channel bipartite, or temporal adjacency (reply-within-N-minutes heuristic). Label these as inferred.
- **Membership:** `members` is the roster at export time. `channel_join`/`channel_leave` give a partial history.
- **Huddles:** `room.participants` / `participant_history` → co-presence.
- **Not recoverable:** read receipts, views, deleted message content (depends on retention), private conversations in a public-only export, and Slack Connect partner users' profiles (they may not appear in users.json **[UNVERIFIED]**. Fall back to `user_profile` on their messages).

## 6. Auto-detection signature

Zip (or folder drop) where:
1. The root has `users.json` **or** `org_users.json`, **and**
2. the root has ≥1 of `channels.json`, `groups.json`, `dms.json`, `mpims.json`, **and**
3. ≥1 path matches `^(teams/[^/]+/)?[^/]+/\d{4}-\d{2}-\d{2}\.json$`.

Grid if `org_users.json` exists or any `teams/<x>/users.json` exists. "Full" vs "public-only": `groups.json`/`dms.json`/`mpims.json` present and non-empty. First bytes of a day file: `[` then `{"…` (whitespace and key order vary). Expect objects with `"ts":"\d+\.\d{6}"` and `"type":"message"`. The zip may have one extra top-level directory (user re-zipped an extracted folder), so normalize by stripping a common prefix.

## 7. Versions, quirks, pitfalls

- **Daily file boundaries are not UTC.** In the slack-export-viewer test archive (a real 2016 export), every message matched its file date in `America/Los_Angeles`. 94/158 did **not** match in UTC. The bucketing zone is probably the workspace's or exporter's zone **[UNVERIFIED which]**. Always use `ts`, never the file name, for time. Merge all files per conversation and sort by `ts`.
- Thread replies sit inline in the daily files of the day they were *posted*, not grouped under the parent (Slack: "thread messages don't differentiate from channel flow").
- `created` is an int in modern exports and a string in old ones. `topic.last_set` likewise.
- Channel renames: the folder uses the name at export time. Old messages may reference the old name.
- Private channel IDs: `G…` (legacy) vs `C…` (since March 2021). Don't infer privacy from the ID prefix. Use the file it's listed in.
- Grid user IDs: `U…` or `W…` with no meaning to the prefix. The regex must accept both. IDs are not fixed at 9 characters (they can be 11+).
- `user` can be absent (bot_message, some system subtypes). `USLACKBOT` is Slackbot.
- Guests: `is_restricted`/`is_ultra_restricted`. External (Slack Connect) senders carry a foreign `user_team`/`team`.
- Edited/deleted: `edited` is present on edited messages. `message_changed`/`message_deleted` records may appear depending on retention. De-duplicate by `ts`.
- Text escaping: `&amp; &lt; &gt;` in `text`. Emoji appear as `:name:`.
- Files: only links. Downloads need auth and expire, so never fetch them.
- Size: small workspaces are KBs to MBs. Large Business+/Grid exports run to many GB, with tens of thousands of day files (one vendor caps ingestion at 10 GB). Expect ZIP64.

## 8. Browser feasibility

- **Feasible.** Use `@zip.js/zip.js` (`BlobReader` over the `File`, ZIP64, random access to entries, so you never load the whole zip) or `fflate` (streaming). Parse each day file with `JSON.parse` (files are small), in a Web Worker.
- Process metadata files first (users, then channels/groups/dms/mpims) to build lookups, then stream the day files.
- Memory: store messages compactly (interned IDs, numeric ts). Drop `blocks`, `attachments` and `files` after you've extracted mentions.
- No network calls needed. Don't follow `url_private` links.

## 9. Sources

| URL | Type |
|---|---|
| https://slack.com/help/articles/220556107-How-to-read-Slack-data-exports | official |
| https://slack.com/help/articles/201658943-Export-your-workspace-data | official |
| https://docs.slack.dev/messaging/retrieving-messages | official (thread fields) |
| https://docs.slack.dev/messaging/formatting-message-text | official (mention encoding) |
| https://docs.slack.dev/enterprise-grid/developing-for-enterprise-grid | official (U/W IDs, `enterprise_user`, team fields) |
| https://docs.slack.dev/changelog/2016/08/11/user-id-format-changes/ | official |
| docs.slack.dev search results re: private-channel ID C/G change (2021 changelog, conversations API) | official (snippet only) |
| https://github.com/mattermost/mmetl `services/slack/models.go`, `parse.go`, `services/slack_grid/parse.go`, `discover.go`, `fixtures/exports.go` | community (well-maintained, Mattermost) |
| https://github.com/hfaran/slack-export-viewer `slackviewer/reader.py`, `tests/testarchive.zip` (inspected locally) | community |
| https://github.com/rusq/slackdump `doc/usage-export.md`, `export/message.go`, `internal/fixtures/assets/export/*.json` | community |
| https://github.com/slack-go/slack `messages.go`, `block_rich_text.go` | community |
| https://help.relativity.com/RelativityOne/Content/Relativity/Processing/SupportedFileTypes-Slack.htm | vendor (Grid `teams/` folder, file list) |
