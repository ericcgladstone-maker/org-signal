# Microsoft Teams export formats

Status: researched 2026-10-02; **fixtures rebuilt from Microsoft's published example responses and from open-source exporters' output layouts on 2026-10-04** (see "Real structure" at the end). Confidence: **high** for the Graph `chatMessage` JSON schema and for which Purview export options exist (official docs). **Medium** for the Teams Free `messages.json` (inferred from the Skype export format, which shares a viewer). **Low/unverified** for Purview HTML transcript markup and the internal PST item layout.

**Bottom line for a browser tool:**

| Path | Who | Realistic for us? |
|---|---|---|
| **A. Graph `chatMessage` JSON** (saved API responses, our own MSAL.js fetch, or third-party tools that dump Graph JSON) | any work/school user (delegated, own chats) or admin (Export APIs) | **Best target.** Structured, documented, has `replyToId`, `mentions`, `reactions`, `chatId`/`channelIdentity`. |
| **B. Teams Free (personal) export** `.tar` → `messages.json` | the person, for their own consumer account | **Feasible** (tar is easy to read). Ego view only. Schema from the Skype lineage, not officially documented. |
| **C. Purview eDiscovery export** (PST or MSG + HTML transcripts + Items.csv) | compliance admins with eDiscovery roles, E3/E5 | **Partially feasible.** The `Items.csv` metadata (Participants, ConversationId…) can be parsed. HTML transcripts' markup is undocumented. PSTs are large and need a PST parser (see email.md). |
| D. Teams client "export chat" | — | No first-party per-chat export exists for work accounts (Q&A answers point to Purview). |

---

## A. Microsoft Graph chatMessage JSON

### Obtained

- Delegated (signed-in user): `GET /me/chats` then `GET /me/chats/{chat-id}/messages` (permission `Chat.Read`, work/school only, **not supported for personal accounts**). Channels: `GET /teams/{id}/channels/{id}/messages` + `/replies`.
- Admin/app-only **Teams Export APIs** (protected APIs): `GET /users/{id}/chats/getAllMessages`, `GET /teams/{id}/channels/getAllMessages`, plus `getAllRetainedMessages`. Needs `Chat.Read.All`, `ChannelMessage.Read.All`, `User.Read.All` with admin consent, and a Teams license on the exported users. Without a model declaration you get "evaluation mode" with limited usage.
- A browser tool *could* call Graph directly with MSAL.js (delegated `Chat.Read`). That needs an Entra app registration, and possibly tenant admin consent depending on tenant policy. Out of scope for "import a file", but a viable v3 connector.

### Container

There's no official file format. Expect one of:
```
graph-dump/
├── chats.json                 # [{id, chatType, topic, createdDateTime, ...}] (optional)
├── members/<chatId>.json      # conversationMember lists (optional)
└── messages/<chatId>.json     # either raw paged responses {"@odata.context", "@odata.nextLink", "value":[...]}
                               # or a flat array of chatMessage objects
```
The importer should accept: (a) a single page `{ "value": [chatMessage…] }`, (b) an array of pages, (c) a flat array, (d) NDJSON, (e) one message object per file, and (f) PowerShell SDK output (PascalCase). Third-party dumpers vary; the layouts found are listed under "Real structure" below.

### chatMessage schema (v1.0)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | message ID (looks like epoch ms, e.g. `"1616964509832"`). Unique only **within a chat/channel/reply-to thread**. |
| `replyToId` | string\|null | parent/root message ID. **Channels only** (chats are flat). |
| `etag` | string | version |
| `messageType` | enum | `message`, `chatEvent`, `typing`, `systemEventMessage` (only with `Prefer: include-unknown-enum-members`, otherwise `unknownFutureValue`) |
| `createdDateTime` | ISO 8601 UTC | send time |
| `lastModifiedDateTime` | ISO UTC | changes on edits **and reactions** |
| `lastEditedDateTime` | ISO UTC\|null | edit time |
| `deletedDateTime` | ISO UTC\|null | soft delete |
| `chatId` | string\|null | set for chat messages: group `19:<hex32>@thread.v2`, 1:1 `19:<userId>_<userId>@unq.gbl.spaces` (both members' Entra ids, verified in the docs' examples), meeting `19:meeting_<base64>@thread.v2`. |
| `channelIdentity` | `{teamId, channelId}`\|null | set for channel messages |
| `from` | `{application, device, user}` | `user` = `{id (Entra object GUID), displayName, userIdentityType ("aadUser", "federatedUser", "anonymousGuest", …), tenantId?}`. `application` = `{id, displayName, applicationIdentityType}` for bots. `null` for system events. |
| `body` | `{contentType: "text"\|"html", content}` | **always HTML if mentions are present** |
| `subject` | string\|null | channel post subject |
| `summary` | string\|null | channel only |
| `importance` | enum | `normal`, `high`, `urgent` |
| `locale` | string | always `en-us` |
| `webUrl` | string\|null | |
| `mentions` | `[{id:int, mentionText, mentioned:{user\|application\|conversation\|tag}}]` | `id` matches `<at id="N">` in `body.content`. Can target user, bot, team, channel, chat, tag. |
| `reactions` | `[{reactionType, displayName, createdDateTime, reactionContentUrl, user:{user:{id,displayName,userIdentityType}}}]` | `reactionType` is a Unicode emoji or `like`/`heart`/`laugh`/`surprised`/`sad`/`angry`/`custom` |
| `attachments` | array | files, cards, meeting refs, quoted replies |
| `messageHistory` | array | reaction add/remove history |
| `eventDetail` | object | for `systemEventMessage`: `@odata.type` e.g. `#microsoft.graph.chatRenamedEventMessageDetail`, `membersAddedEventMessageDetail` **[name per docs list, not opened]**, with `initiator`, `members`… |
| `policyViolation` | object | DLP |

chat resource (for context type): `id`, `chatType` (`oneOnOne` \| `group` \| `meeting`), `topic` (group only), `createdDateTime`, `lastUpdatedDateTime`, `tenantId`, `onlineMeetingInfo`, `webUrl`. Members via `/chats/{id}/members` (conversationMember: `displayName`, `userId`, `email`, `roles`, `visibleHistoryStartDateTime`).

### Synthetic example

```json
{
  "id": "1709551234567",
  "replyToId": null,
  "etag": "1709551234567",
  "messageType": "message",
  "createdDateTime": "2024-03-04T11:20:34.567Z",
  "lastModifiedDateTime": "2024-03-04T11:25:02.100Z",
  "lastEditedDateTime": null,
  "deletedDateTime": null,
  "subject": null,
  "chatId": "19:aaaabbbbccccdddd0000111122223333@thread.v2",
  "channelIdentity": null,
  "importance": "normal",
  "locale": "en-us",
  "from": { "application": null, "device": null,
            "user": { "id": "11111111-2222-3333-4444-555555555555", "displayName": "Ana Ruiz", "userIdentityType": "aadUser" } },
  "body": { "contentType": "html",
            "content": "<div>Thanks <at id=\"0\">Ben Okafor</at>, merging now.</div>" },
  "mentions": [ { "id": 0, "mentionText": "Ben Okafor",
                  "mentioned": { "application": null, "device": null, "conversation": null,
                                 "user": { "id": "66666666-7777-8888-9999-000000000000", "displayName": "Ben Okafor", "userIdentityType": "aadUser" } } } ],
  "reactions": [ { "reactionType": "like", "displayName": "Like", "createdDateTime": "2024-03-04T11:25:02.100Z",
                   "user": { "application": null, "device": null,
                             "user": { "id": "66666666-7777-8888-9999-000000000000", "displayName": null, "userIdentityType": "aadUser" } } } ],
  "attachments": [], "messageHistory": [], "eventDetail": null, "policyViolation": null
}
```

### Mapping

| Internal | Source |
|---|---|
| sender | `from.user.id` (Entra GUID), else `from.application.id` (bot). Skip `systemEventMessage` / `from == null`. |
| recipients | chat: the other chat members (from `members`, or from distinct senders seen if members are unavailable, flagged as inferred). channel: none intrinsic. |
| timestamp | `createdDateTime` (UTC, ms precision) |
| conversation id | `chatId`, or `channelIdentity.teamId + "/" + channelIdentity.channelId` |
| context type | `chat.chatType`: `oneOnOne`→direct, `group`→group, `meeting`→group (meeting chat), channel→public/private **[channel membershipType (standard/private/shared) needs the channel resource]** |
| thread | channels: `replyToId` (root ID). Chats: none; a reply is a quote: an attachment with `contentType: "messageReference"` whose `content` is a JSON **string** `{messageId, messagePreview, messageSender:{user:{id,displayName,…}}}` (verified, chatmessage-replywithquote), with `<attachment id="<messageId>"></attachment>` in the body. |
| text | strip HTML from `body.content`. Replace `<at id>` with `mentionText`. |
| node attrs | `displayName`, `userIdentityType` (federated = external), `tenantId` |

### Edges

- Reply: channel reply author → root author (resolve root by `replyToId` within the same channel).
- Mention: author → `mentions[].mentioned.user.id`. Mentions of team, channel or tag are broadcasts.
- Reaction: `reactions[].user.user.id` → author.
- 1:1 chat: dyadic. Group/meeting chat: sender → other members.
- Display names can be `null` in reactions and events. Join to a user table by `id`.

### Detection

JSON with objects having `messageType` + `createdDateTime` + (`chatId` or `channelIdentity`) + `from`. Pages: top-level `"@odata.context"` containing `/messages` or `getAllMessages`.

### Quirks

- Default ordering is by `lastModifiedDateTime` desc. Export APIs give no ordering guarantee, so sort by `createdDateTime`.
- Export APIs pull from each user's mailbox, so dumps across several users **duplicate** chat messages. De-dupe by (`chatId`, `id`).
- `$top` max is 50 for chat list-messages. Export APIs recommend ≤250.
- One documented example has a malformed timestamp (`2021-03-1706:47:05.123Z`). Parse defensively.
- Deleted messages remain fetchable for 21 days (Export API).

---

## B. Teams Free (personal account) export

### Obtained
The user signs in at the Teams Free export page (`teams.live.com/dataexport`, also referenced as `/go/legacyExport`). They pick "Chat history" and/or "Media", wait, then download a **`.tar`**. Work/school accounts can't use this.

### Tree
```
export.tar
├── messages.json         # all conversations (official: "messages.json file containing the conversation history")
├── media/                # if requested; per-item <id>.json metadata + binary  [layout from Skype parsers]
├── skype-parser/index.html   # Microsoft-provided viewer (official)
├── *.json calendar events, *.csv contacts   # mentioned officially, names not given [UNVERIFIED]
```

### Schema (Skype export lineage, documented by Skyperious, **not by Microsoft**)

```json
{
  "userId": "8:live:.cid.0123456789abcdef",
  "exportDate": "2024-03-05T10:00",
  "conversations": [{
    "id": "19:3c1f…@thread.v2",
    "displayName": "Book club",
    "version": 1709551234567.0,
    "properties": { "conversationblocked": false, "lastimreceivedtime": "2024-03-04T11:20:34.567Z" },
    "threadProperties": { "membercount": 3, "topic": "Book club",
                          "members": "[\"8:live:.cid.aaaa\",\"8:live:.cid.bbbb\",\"8:live:.cid.cccc\"]" },
    "MessageList": [{
      "id": "1709551234567",
      "conversationid": "19:3c1f…@thread.v2",
      "from": "8:live:.cid.aaaa",
      "displayName": "Ana R",
      "originalarrivaltime": "2024-03-04T11:20:34.567Z",
      "messagetype": "RichText",
      "content": "Chapter 3 by Friday?",
      "properties": null,
      "amsreferences": null,
      "version": 1709551234567.0
    }]
  }]
}
```

Notes: `threadProperties.members` is a **JSON string**, not an array. `threadProperties` is `null` for 1:1 chats **[UNVERIFIED for Teams Free]**. 1:1 conversation IDs start with `8:`. Group IDs start with `19:`. Message types: `RichText`, `Text`, `RichText/Media_*`, `RichText/UriObject`, `Event/Call`, `ThreadActivity/AddMember`, `ThreadActivity/DeleteMember`, `ThreadActivity/TopicUpdate`, … `properties` may have `edittime`/`deletetime`. The export owner's own messages often have an empty `displayName`. Times are UTC.

Mapping: sender `from`. Conversation `id`/`conversationid`. Type: `8:` prefix → direct, `19:` → group. Recipients = members − sender. Timestamp `originalarrivaltime`. No threads, no structured mentions. `content` may hold HTML-ish markup and `<URIObject>` for media.

Detection: tar entry `messages.json` whose root has `userId`, `exportDate`, `conversations[].MessageList`.

Browser: tar has no compression (unless gz). Read it with a minimal tar reader, or `js-untar`/`tarts`. `messages.json` can be 100s of MB, so a streaming JSON parser (e.g. `@streamparser/json`) is advisable.

---

## C. Purview eDiscovery export (admin)

### Obtained
A compliance admin with eDiscovery permissions (E3/E5) creates a case, then a search, then **Export**. Packages download as `.zip` (2–40 GB parts) and expire after 14 days.

Options that matter:
- **Export type:** "Export items report only" (CSV only: summary + `Items.csv`, string fields truncated to 255 chars) **or** "Export items with items report".
- **Export format:** *Create PSTs for messages* (default package 5 GB per PST, configurable 1/2/5/10) **or** *Create .msg files for messages*.
- **Organize conversation into HTML transcript:** Teams chats are threaded into HTML transcripts. 1:1/group chats can have several transcripts per conversation (time windows). Each channel post + replies = one transcript.
- **Include Teams and Viva Engage conversations:** ±12 h context.
- Separate PST per mailbox, keep folder paths, friendly names.

### Tree (approximate. The exact names are **[UNVERIFIED]**. Only "Conversations folder in the root" and `Items.csv` are documented.)
```
<export name>.zip
├── Items.csv / Items_0_<date>.csv     # per-item metadata (see below)
├── Summary.csv, settings.csv, …       # process report
├── Conversations/                     # HTML transcripts (Teams)
│   └── <guid or friendly name>.html
├── Exchange/ <mailbox>.pst            # if PST format chosen
└── SharePoint/ …                      # cloud attachments
```

### Teams metadata in Items.csv (official property names)

| Property | Meaning |
|---|---|
| `ConversationId` | GUID per conversation (shared across transcripts and custodian copies) |
| `Conversation name` | 1:1/group: concatenated `Name <upn>` list. Channel: `<Team name>,<Channel name>` |
| `ConversationType` | `Group` (1:1 and group chats) or `Channel` |
| `Participants` | everyone in the transcript (senders + recipients) |
| `Recipients` | users who received messages in the transcript |
| `Date` | first message time in the transcript (UTC) |
| `FamilyId`, `ThreadId`/`GroupId` | grouping |
| `FileClass` | `Conversation` for Teams |
| `MessageKind` | `microsoftteams , im` |
| `TeamsChannelName`, `ContainsEditedMessage`, `ContainsDeletedMessage` | |

Network use: `Items.csv` alone gives **transcript-level co-participation** (Participants × ConversationId × Date). That's coarse but parseable with no binary formats. Per-message sender and timing need parsing the HTML transcripts (undocumented markup), or the PST items.

**PST internals:** Teams compliance records live in the hidden `TeamsMessagesData` folder of user mailboxes (chats) and group mailboxes (channels). Before October 2020 they were under `Conversation History/Team Chat`. They're commonly identified by message class `IPM.SkypeTeams.Message` **[UNVERIFIED in official docs. Calls/meetings are `IPM.AppointmentSnapshot.SkypeTeams.Call/.Meeting` per office365itpros]**. Each item has the HTML body (`PR_HTML`) plus sender/recipient properties. Parse with a PST library (see email.md).

### Quirks
- Every participant's mailbox holds a copy, so multi-custodian exports duplicate conversations. De-dupe on `ConversationId` + message time + sender.
- All times are UTC.
- Exports > 7 days auto-cancel. Big exports are split.

---

## Browser feasibility summary

| Format | Feasible | Libraries | Notes |
|---|---|---|---|
| Graph JSON | yes | native `JSON.parse`, DOMParser to strip HTML | best fidelity |
| Teams Free tar | yes | tar reader + streaming JSON | ego network only |
| Purview Items.csv | yes | PapaParse (streaming) | coarse, transcript-level |
| Purview HTML transcripts | maybe | DOMParser | markup undocumented, so build from samples |
| Purview PST | limited | `@hiraokahypertools/pst-extractor` (random access via `File.slice`) | multi-GB files. Alpha library. |

## Sources

| URL | Type |
|---|---|
| https://learn.microsoft.com/en-us/graph/api/resources/chatmessage?view=graph-rest-1.0 | official |
| https://learn.microsoft.com/en-us/graph/api/resources/chatmessagemention?view=graph-rest-1.0 | official |
| https://learn.microsoft.com/en-us/graph/api/resources/chatmessagereaction?view=graph-rest-1.0 | official |
| https://learn.microsoft.com/en-us/graph/api/resources/channelidentity?view=graph-rest-1.0 | official |
| https://learn.microsoft.com/en-us/graph/api/resources/chat?view=graph-rest-1.0 | official |
| https://learn.microsoft.com/en-us/graph/api/chat-list-messages?view=graph-rest-1.0 | official (example payloads, $top=50) |
| https://learn.microsoft.com/en-us/microsoftteams/export-teams-content | official (Export APIs, permissions, licensing) |
| https://learn.microsoft.com/en-us/purview/edisc-search-export | official (export options) |
| https://learn.microsoft.com/en-us/purview/edisc-review-set-teams-data | official (transcripts, Teams metadata fields) |
| https://support.microsoft.com/en-us/office/export-or-delete-your-data-in-microsoft-teams-free-1ed6ac68-5fb4-41be-9861-1a4127fecf68 | official (Teams Free .tar / messages.json) |
| https://raw.githubusercontent.com/suurjaak/Skyperious/master/src/skyperious/live.py | community (Skype export schema) |
| https://github.com/v-bulynkin/skype-export-parser | community |
| https://office365itpros.com/2020/05/19/teams-compliance-records/ | reputable community (TeamsMessagesData, item classes) |
| WebSearch result snippets on TeamsMessagesData (Veritas, office365itpros 2020/10) | community, snippet only |

---

## Real structure (checked 2026-10-04)

Fixtures in `test/fixtures/importers-a/teams/real-structure/` reproduce each shape below with fictional content. Their README lists the sources per folder.

### Graph, from Microsoft's own examples (microsoft-graph-docs-contrib, v1.0)
- Page envelope: `@odata.context`, optional `@odata.count`, and `@odata.nextLink` or (delta) `@odata.deltaLink`. Contexts:
  - `#chats('<urlencoded id>')/messages`
  - `#teams('<team>')/channels('<urlencoded id>')/messages`, and `.../messages('<id>')/replies`
  - `#Collection(chatMessage)` (getAllMessages; there is no "getAllMessages" in the context string)
  - `#Collection(microsoft.graph.chatMessage)` (delta)
  - `#chats(members())`
- Channel lists (`GET /teams/{id}/channels`) have **no** `@odata.context` in the examples. `membershipType` is `standard`, `private` or `shared`.
- `$expand=replies` nests replies in the root: `replies@odata.count`, `replies: [...]`.
- System events: `from: null`, body `<systemEventMessage/>`. `messageType` is `systemEventMessage` only with `Prefer: include-unknown-enum-members`; otherwise it is `unknownFutureValue`.
- `eventDetail` types include `membersAdded`, `membersDeleted`, `membersJoined`, `membersLeft`, `chatRenamed`, `callStarted`, `callEnded` (with `callParticipants`), `callRecording`, `callTranscript`, `messagePinned`, `teamsAppInstalled`, and channel/team events.
- `from.user` may carry `@odata.type: #microsoft.graph.teamworkUserIdentity` and `tenantId`. `userIdentityType` also takes `anonymousGuest` (32-hex id), `personalMicrosoftAccountUser`, `emailUser` and others, so ids are not always GUIDs. `displayName` is often `null` in reactions and eventDetail.
- Bots: `from.application` with `applicationIdentityType` `bot`, `tenantBot`, `office365Connector`, `outgoingWebhook` or `aadApplication`.
- Mentions: `mentioned.conversation` with `conversationIdentityType` `chat` (everyone), `channel` or `team`, and (beta) `mentioned.tag`.
- Reactions: `reactionType` is a Unicode emoji or a legacy name (`like`, `heart`, …), or `custom` with a `reactionContentUrl`.
- Body markup: `<emoji id alt title>`, `<customemoji>`, `<codeblock>`, hosted-content `<img>`, and `<attachment id>` placeholders.
- Attachment types: `reference` (file), `messageReference` (quote), `forwardedMessageReference` (content JSON with `originalSentDateTime` in `+00:00` form), `meetingReference`, `tabReference`, adaptive cards and Loop cards.
- Deleted messages: `deletedDateTime` set, body `{contentType:"text", content:""}` (from a test checked against live Graph in osodevops/ms-teams-cli; the docs show no example). DLP-blocked messages: empty body and `policyViolation`.
- Message `id` and `etag` are epoch-millisecond strings; `etag` changes on edit.

### Exporter layouts
| Tool | Layout |
|---|---|
| codeforkjeff/teams-chats-export | `archive/data/<chatId with : @ → _>.json` (chat, `$expand=members,lastMessagePreview`) + `archive/data/<chat>/msg_<id>.json` (one raw message per file) + images + `archive/html/` |
| edgraaff/teams-chat-backup | `out/<chat name>/messages-00000.json …` (raw `value` arrays, newest page first) + `images.json` + `index.html` |
| jbelanger/export-teams-conversations | one raw page; its sample has only `id`, `createdDateTime`, `from.user`, `body`, with the chat named only in `@odata.context` |
| kkgthb/powershell-ms-teams-chat-backup | `teamschatsYYYYMMDD.json` / `mychatsYYYYMMDD.json` via `ConvertTo-Json -Depth 100` of Microsoft Graph PowerShell objects: PascalCase, `AdditionalProperties` bag **[serialised shape inferred, not seen]**; Windows PowerShell 5.1 writes UTF-16 and `/Date(ms)/` |
| xprtyg33k/teams-chat-extract, gediz/teams-web-chat-exporter | transformed schemas (`body_text`, `author`, …), **not read** by the Teams importer |

### Teams Free / Skype `messages.json` (Skyperious source, parsers, a public structure sample)
- `exportDate` is written without seconds (`2026-07-06T20:55`).
- `messages: null` sits beside `MessageList`.
- `threadProperties` is `null` for 1:1 chats. `members` is a JSON string, sometimes `[{MemberMri}]`.
- Conversation ids:
  - `8:` 1:1, including `8:live:…` and `8:orgid:<guid>`
  - `19:…@thread.skype`, `@thread.v2`, `@p2p.thread.skype` (threads)
  - `28:` bots
  - `48:calllogs`, `48:notes`, `48:drafts` (the account's own lists)
- Message types include `RichText`, `Text`, `RichText/Html`, `RichText/Media_*`, `RichText/UriObject`, `Event/Call` (`<partlist>`), `ThreadActivity/*` (XML, or JSON for MemberJoined/Left), `Poll`, `Notice` and `PopCard`.
- `properties.edittime` and `deletetime` are epoch-ms strings; a deleted message has empty content. `properties.emotions` is an array (or a JSON string) of `{key, users:[{mri,time,value}]}`.
- Quotes use `<quote author authorname timestamp messageid><legacyquote>…</legacyquote>…</quote>`. Mentions use `<at id="8:…">`.

### Purview
The field names come from the docs: `Conversation ID`, `Conversation type`, `Conversation name`, `Participants`, `Item class`, `Message kind`, `File class`, `Channel Name`, and others. The review-set page spells some in CamelCase (`ConversationId`, `FileClass`, `TeamsChannelName`). The **exact header row and column order of `Items_<timestamp>.csv` are not published**, and no public sample was found.

Value formats: `Name <smtp>`; `Conversation name` joins participants with a comma and no space (1:1/group) or reads `<Team>,<Channel>`; `Conversation type` is `Group` or `Channel`; Teams `Item class` is `IPM.SkypeTeams.Message`.

### Importer changes from this check (`src/importers/teams.js`)
- Detection:
  - More than 400 JSON files are no longer silently left out. Past the cap, one file is peeked per new folder, and folders holding Graph messages are claimed whole (one-file-per-message dumps).
  - Channel lists without `@odata.context` are claimed.
  - PascalCase PowerShell output is recognised.
  - Purview headers are matched without case or spaces; before this, the new-experience header went to the edge-list reader.
- Graph:
  - Nested `replies` are read; before this, every reply fetched with `$expand=replies` was dropped.
  - A message without `chatId`/`channelIdentity` takes its conversation from the page's `@odata.context`; before this, such pages were dropped.
  - 1:1 chat members are read from the chat id when there is no member list.
  - A `messageReference` quote gives a reply tie (outside 1:1 chats) and a parent link.
  - JSON files that hold no messages, chats, members or channels are reported (`teams-file-not-recognised`).
- Teams Free:
  - `48:` lists are left out and reported. Before this, the call log and notes were read as group chats.
  - `28:` conversations are 1:1 chats with a bot.
  - `[{MemberMri}]` member lists are read.
  - `properties.emotions` become reactions.
  - `<at id>` mentions and `<quote>` replies give ties in group chats.
  - Quoted text is not repeated in the replying message's text, and deleted messages are counted.
- Purview: `Item class` other than `IPM.SkypeTeams.*` is skipped as non-Teams.

Still unverifiable without real data:
- The exact Purview `Items_*.csv` header and date format.
- The real serialisation of Microsoft Graph PowerShell objects.
- Whether Teams Free exports differ from Skype exports in any field.
- How Graph returns deleted messages in each API.
