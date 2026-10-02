# Discord

Two unrelated sources share the name "Discord export":

| | (a) Official Data Package | (b) DiscordChatExporter (DCE) |
|---|---|---|
| Producer | Discord, via *User Settings > Privacy & Safety (Data & Privacy) > Request all of my data* | Tyrrrz/DiscordChatExporter (GUI/CLI, open source, C#) |
| Scope | Only messages **you sent**, across all channels/DMs | **All** messages in one channel/thread/DM (everyone's) |
| Network value | Ego-only, no reply/mention structure | Full channel: authors, mentions, replies, reactions |
| Container | `.zip` (folder tree of JSON/CSV) | One file per channel: `.json`, `.csv`, `.html`, `.txt` |
| Confidence | Medium (no public official schema; derived from 4 open-source parsers that agree) | High (read writer source code) |

---

## (a) Official Discord Data Package

### How obtained
User requests in app; Discord emails a download link (hours to ~30 days). The official help article (support.discord.com/hc/en-us/articles/360004957991) returned HTTP 403 to our fetcher; its content as quoted by search snippets: "The messages folder contains all the messages that you have sent on Discord, not messages you received", one folder per channel named by channel ID, containing `channel.json` and `messages.json`, plus a JSON index mapping Channel ID to Channel name.

### File tree (current, 2024+; folder names capitalised since ~2025)

```
package.zip
├── README.txt
├── Account/                (older: account/   — may be localised, e.g. "Compte/")
│   ├── user.json           (profile, relationships[], notes{}, payments[], settings ...)
│   └── applications/<appId>/application.json
├── Activity/               (older: activity/)  NDJSON analytics, can be GBs
│   ├── reporting/events-YYYY-00000-of-00001.json
│   ├── tns/events-...json
│   └── modeling/events-...json   (older packages)
├── Messages/               (older: messages/)
│   ├── index.json          { "<channelId>": "<display name>" | null }
│   └── c<channelId>/       (packages before ~2021-12-06: no "c" prefix)
│       ├── channel.json
│       └── messages.json   (packages before ~2024-03-01: messages.csv)
├── Servers/                (older: servers/)
│   ├── index.json          { "<guildId>": "Guild Name" }
│   └── <guildId>/guild.json, audit-log.json, [channels.json, bans.json, emoji.json, webhooks.json — admin-only]
├── Ads/, Activities/, Support_Tickets/ ... (ignore)
```

Date cut-overs come from comments in `Androz2091/discord-data-package-explorer` (`// Packages before 06-12-2021 does not have the leading "c"`, `// Packages before 01-03-2024 does not have json files for messages but csv files`) and its README ("On June 14th, 2025, Discord updated their package format once again"). Treat dates as approximate; **detect by structure, never by date**.

### Record schemas

`Messages/index.json` — channel id → human label. Observed value patterns (community docs):

| Pattern | Meaning |
|---|---|
| `"general in Synthwave Club"` | guild channel `<channel> in <guild>` |
| `"Direct Message with nova_fox#0"` / `"... with nova#1234"` | 1:1 DM (new usernames show `#0`; older `#0000`) |
| `"Unknown channel in Synthwave Club"` / `"Unknown channel"` | channel no longer accessible |
| `null` or `"None"` | unnamed / group DM / system |

`c<id>/channel.json`

| Field | Type | Notes |
|---|---|---|
| `id` | string | channel snowflake |
| `type` | **int OR string** | 2022 packages: int (`0` text, `1` DM, `3` group DM, `11` public thread…); 2025 packages: string (`"GUILD_TEXT"`, `"DM"`, `"GROUP_DM"`, `"PUBLIC_THREAD"`, `"PRIVATE_THREAD"`…). Map both via the Discord channel-type enum below. |
| `name` | string? | guild channels/threads only |
| `guild` | `{id, name}`? | guild channels only; absent when you left the server |
| `recipients` | string[]? | DMs: two user ids (yours + other). Group DMs often **lack** this. May contain literal `"Deleted User"` |

Channel-type enum (matches Discord API; from Data-Package-Tool `ChannelType`): `GUILD_TEXT=0, DM=1, GUILD_VOICE=2, GROUP_DM=3, GUILD_CATEGORY=4, GUILD_ANNOUNCEMENT=5, ANNOUNCEMENT_THREAD=10, PUBLIC_THREAD=11, PRIVATE_THREAD=12, GUILD_STAGE_VOICE=13, GUILD_FORUM=15, GUILD_MEDIA=16`.

```json
{"id":"1100000000000000001","type":"DM","recipients":["900000000000000001","900000000000000002"]}
{"id":"1100000000000000002","type":0,"name":"general","guild":{"id":"1000000000000000009","name":"Synthwave Club"}}
```

`c<id>/messages.json` (2024+) — array; `c<id>/messages.csv` (older) — header `ID,Timestamp,Contents,Attachments`.

| Field | Type | Notes |
|---|---|---|
| `ID` | **JSON number** (snowflake) | > 2^53 — `JSON.parse` silently loses precision. Parse with a regex pre-pass to quote it, or derive only the timestamp. |
| `Timestamp` | string | JSON: `"2023-12-11 02:01:09"` (no zone; treat as UTC). CSV: `"2022-08-02 00:59:59.753000+00:00"`. |
| `Contents` | string | may contain `<@123…>` user mentions, `<#id>` channel mentions, `<@&id>` role mentions — the **only** recoverable targets |
| `Attachments` | string | space-separated CDN URLs (signed, expire) |

```json
[{"ID":1180000000000000001,"Timestamp":"2023-12-11 02:01:09","Contents":"thanks <@900000000000000003>!","Attachments":""}]
```

```csv
ID,Timestamp,Contents,Attachments
950000000000000001,2022-03-01 18:22:10.120000+00:00,"multi-line
message","https://cdn.discordapp.com/attachments/1/2/a.png"
```

`Account/user.json` — useful keys: `id`, `username`, `discriminator`, `global_name`/`display_name` (not always), `relationships[]` (`{id, type, user:{id, username, discriminator, avatar}}`; type 1 = friend per Discord API), `notes{}` (keyed by user id). Contains email/IP/payments — **never retain**.

### Mapping to internal model
- Ego node = `user.json.id` (label `username`). Alter nodes: DM `recipients` other id; `<@id>` mentions in `Contents`; `relationships[].user` (gives names for ids).
- Event per message: `sender=ego`, `timestamp=Timestamp`, `context=channel id` (+ guild), `visibility` = `dm` (type DM), `group` (GROUP_DM), `channel` (guild). `targets`: DM → other recipient; guild → mentioned user ids only (otherwise unknown audience). `parent`: not available.
- Declared ties (optional): `relationships` type=1 → friendship tie ego→alter.

### Observation note
**Ego view, outgoing only.** No incoming messages, no other people's interactions, no reply links. Guild channel audiences are unknown. Present as "your outgoing activity", not a network.

### Auto-detection
Zip containing a path matching `/(^|\/)[mM]essages\/c?\d{16,20}\/channel\.json$/` (+ `[mM]essages/index.json`). Locate the messages root by that regex, not by folder name (localised folders exist). Messages file = sibling `messages.json` else `messages.csv`.

### Quirks
- Folder-name casing and localisation vary; `c` prefix varies; CSV vs JSON varies.
- CSV: quoted multi-line fields; use a real CSV parser (PapaParse). One parser uses `newline: ',\r'` hint — line endings may be CRLF.
- Snowflake precision loss in JS (see above). Timestamp can be recovered from ID: `(BigInt(id) >> 22n) + 1420070400000n` ms (official Discord docs).
- Sizes: heavy users have tens of thousands of channel folders and 100k–1M messages (one community repo: 7,289 channels, ~675k rows, 2.9 GB total but most bulk is `Activity/`). **Skip Activity/** — stream-unzip only `Messages/` and `Account/user.json`.
- PII: email, IPs, payment info in `user.json`/Activity — read selectively.

### Browser feasibility
Good. Use a streaming unzip (fflate `Unzip`, or zip.js) to read only needed entries; avoid inflating multi-GB Activity files. PapaParse for CSV. BigInt for snowflakes.

---

## (b) DiscordChatExporter (Tyrrrz)

### How obtained
User runs DCE with a user or bot token and exports channels. Formats (`ExportFormat` enum): `PlainText` (.txt), `HtmlDark`/`HtmlLight` (.html), `Csv`, `Json`. Default filename: `<Guild> - <Category/Parent> - <Channel> [<channelId>].json`, optionally ` (after … before …)`; partitioned exports append ` [part N]`. DMs use guild `{"id":"0","name":"Direct Messages"}`.

ToS: DCE's own docs state "Automating user accounts violates Discord's terms of service … may result in account termination"; bot tokens are permitted. We only import files the user already has; show a one-line note, don't block.

### JSON grammar (from `JsonMessageWriter.cs`)

```json
{
  "guild":   {"id":"1000000000000000009","name":"Synthwave Club","iconUrl":"…"},
  "channel": {"id":"1100000000000000002","type":"GuildTextChat","categoryId":"1100000000000000000",
              "category":"Text Channels","name":"general","topic":null},
  "dateRange": {"after":null,"before":null},
  "exportedAt": "2026-09-30T12:00:00.000+00:00",
  "messages": [
    {
      "id":"1200000000000000001","type":"Reply",
      "timestamp":"2026-09-01T14:02:11.512+00:00","timestampEdited":null,"callEndedTimestamp":null,
      "isPinned":false,"content":"agreed, @Rio",
      "author":{"id":"900000000000000001","name":"nova_fox","discriminator":"0000","nickname":"Nova",
                "color":"#1F8B4C","isBot":false,"roles":[{"id":"…","name":"Mods","color":"#1F8B4C","position":3}],
                "avatarUrl":"…"},
      "attachments":[], "embeds":[], "stickers":[],
      "reactions":[{"emoji":{"id":"","name":"👍","code":"thumbsup","isAnimated":false,"imageUrl":"…"},
                    "count":2,
                    "users":[{"id":"900000000000000003","name":"rio.m","discriminator":"0000","nickname":"Rio","isBot":false,"avatarUrl":"…"}]}],
      "mentions":[{"id":"900000000000000003","name":"rio.m","discriminator":"0000","nickname":"Rio","isBot":false,"roles":[],"avatarUrl":"…"}],
      "reference":{"type":"Default","messageId":"1199999999999999999","channelId":"1100000000000000002","guildId":"1000000000000000009"},
      "inlineEmojis":[]
    }
  ],
  "messageCount": 1
}
```

| Path | Notes |
|---|---|
| `channel.type` | `ChannelKind` name: `GuildTextChat, DirectTextChat, GuildVoiceChat, DirectGroupTextChat, GuildNews, GuildNewsThread, GuildPublicThread, GuildPrivateThread, GuildStageVoice, GuildForum` |
| `channel.categoryId/category` | for threads this is the **parent channel**, not a category (source comment) |
| `messages[].id` | string (safe) |
| `messages[].type` | `MessageKind` name: `Default, RecipientAdd, RecipientRemove, Call, ChannelNameChange, ChannelIconChange, ChannelPinnedMessage, GuildMemberJoin, ThreadCreated, Reply, ThreadStarterMessage, PollResult`; unknown kinds serialise as the **number string** (C# enum ToString) |
| `timestamp` | ISO-8601 with offset; **local time zone of the exporter** unless `--utc` was used. Always parse offset. |
| `author` | `id, name, discriminator ("0000" for new usernames), nickname (guild display name), color, isBot, roles[], avatarUrl` |
| `reactions[].users[]` | reactors, fetched with extra API calls per reaction at export time; older DCE versions may lack `users` (unverified) — compare `users.length` with `count` |
| `mentions[]` | users mentioned (does not include role/@everyone) |
| `reference` | present on replies, forwards, crossposts, pins, thread starters. `type`: `Default` or `Forward`. Only `messageId` — reply-to **author** requires lookup in same file; may point outside the export window/channel |
| `forwardedMessage` | present on forwards (snapshot content, no author) |
| `interaction` | `{id, name, user}` for slash-command responses (bot is author; `interaction.user` is the human) |

### CSV
Header `AuthorID,Author,Date,Content,Attachments,Reactions`. All fields quoted. `Author` = `name#discriminator` or `name`; `Date` ISO-8601 round-trip (`"o"`); `Attachments` comma-joined URLs; `Reactions` like `👍 (2),🎉 (1)`. **No message id, no mentions (except in content text), no replies** — sender/time only.

### HTML / TXT
HTML: `div.chatlog__message-container` with `data-message-id`, author spans with `data-user-id` and `title="name#0000"`, replies in `.chatlog__reply-author` + `scrollToMessage(event,'<id>')`. Timestamps are culture-formatted display strings (title attr, format "f") — unreliable to parse. Support only as best-effort; recommend JSON.

### Mapping
- Nodes: `author`, `mentions[]`, `reactions[].users[]`, `interaction.user` keyed by `id`; attrs `name`, `nickname`, `isBot`, `roles[].name`.
- Event per message: `sender=author.id`, `timestamp`, `context=channel.id` (thread → also parent via `categoryId`), `visibility` = `public-channel` / `dm` / `group-dm` from `channel.type`, `targets=mentions[].id` ∪ reply-parent author, `parent=reference.messageId` (when `reference.type=="Default"` and message `type=="Reply"`).
- Reactions: secondary events `reactor → message author` (timestamp unknown; use message timestamp, flag as approximate).
- Drop system kinds (`GuildMemberJoin`, `ChannelPinnedMessage`, …) or keep as non-communication events; filter `isBot` optionally.

### Observation note
Full record of **one channel** within the exported date range (as visible to the token holder). Multi-file import = union of channels. Not an ego view; still a sample of the guild.

### Auto-detection
JSON object with top-level `guild`, `channel`, `messages` (array) and usually `exportedAt`, `messageCount`; message objects with `author.id` and `timestamp`. CSV header exactly `AuthorID,Author,Date,Content,Attachments,Reactions`. HTML containing `chatlog__message-container`.

### Quirks / size
- Files can be hundreds of MB for busy channels (single JSON root; not NDJSON). For >~200 MB consider a streaming JSON parser (e.g. `@streamparser/json`) in a Worker.
- Bots have `isBot:true`; filter optionally. Webhook/deleted-user representation not verified.
- A reply with ping enabled typically also lists the parent author in `mentions` (Discord API behaviour; not verified in DCE source) — dedupe targets.

### Browser feasibility
Excellent for JSON/CSV. HTML parse via `DOMParser` feasible but lossy.

---

## Sources
Official
- https://docs.discord.com/developers/reference (snowflake epoch formula) — opened
- https://support.discord.com/hc/en-us/articles/360004957991-Your-Discord-Data-Package — **403 to fetcher**; content seen only via search snippet
Community (source code read)
- https://github.com/Androz2091/discord-data-package-explorer (`src/app/extractor.js`)
- https://github.com/dumpus-app/dumpus-api (`src/tasks.py`)
- https://github.com/aamiaa/Data-Package-Tool (`src/Classes/DataPackage.cs`, `Parsing/DChannel.cs`)
- https://github.com/benz206/discord-viewer/blob/HEAD/docs/DATA-FORMAT.md (2022 package)
- https://github.com/ethanriverpage/memoria/blob/HEAD/docs/Discord-Schema.md (2025 package)
- https://github.com/Tyrrrz/DiscordChatExporter (`DiscordChatExporter.Core/Exporting/JsonMessageWriter.cs`, `CsvMessageWriter.cs`, `MessageGroupTemplate.cshtml`, `ExportFormat.cs`, `ExportRequest.cs`, `Discord/Data/*Kind.cs`, `.docs/Token-and-IDs.md`, `.docs/Troubleshooting.md`)
