# Telegram Desktop export (JSON, `result.json`)

Status: researched 2026-10-02. Confidence: **high**. Everything structural below was read directly from the exporter's source code (`telegramdesktop/tdesktop`, branch `dev`, `Telegram/SourceFiles/export/output/export_output_json.cpp`), which is the authoritative definition. Field presence varies by message type. The writer omits empty values.

---

## 1. How it's obtained

Only **Telegram Desktop** (Windows/macOS/Linux; not mobile, and not the Mac App Store "Telegram for macOS" app, which as far as I know lacks the JSON export, unverified) can export.

| Mode | Steps | Output folder | Root JSON |
|---|---|---|---|
| **Full export** | Settings → Advanced → *Export Telegram data* → tick chat types (Personal chats, Bot chats, Private groups, Public groups, Private/Public channels) + Contacts etc. → Format: **Machine-readable JSON** | `DataExport_YYYY-MM-DD/` (suffix ` (1)`, ` (2)` if it exists) | object with `about`, `personal_information`, `contacts`, `frequent_contacts`, `chats`, `left_chats`, … |
| **Single chat** | Open chat → ⋮ → *Export chat history* → Format JSON | `ChatExport_YYYY-MM-DD/` | **the chat object itself**: `{name, type, id, messages}` |

Main file name is always `result.json`. Media (if selected) sits beside it in `photos/`, `files/`, `video_files/`, `voice_messages/`, `stickers/`, etc. Users usually zip the folder before handing it over, so accept a folder drop, a zip, or a bare `result.json`. A "HTML and JSON" format option also exists and writes both.

Settings allow a date range. Messages outside it are skipped (`SkipMessageByDate`).

### Tree (full export)

```
DataExport_2026-10-02/
├── result.json
├── chats/chat_001/photos/…            (media, if selected)
├── profile_pictures/…
└── lists/…                             (only in HTML mode)
```

---

## 2. Schema

### 2.1 Top level (full export)

```jsonc
{
  "about": "Here is the data you requested…",          // localized blurb
  "personal_information": {
    "user_id": 100000001, "first_name": "Ana", "last_name": "Kovač",
    "phone_number": "+386 40 000 000", "username": "@ana_k", "bio": "…"
  },
  "profile_pictures": [ … ],
  "contacts":          { "about": "…", "list": [ /* Contact */ ] },
  "frequent_contacts": { "about": "…", "list": [ /* TopPeer */ ] },
  "sessions": { … }, "web_sessions": { … }, "other_data": { … },
  "chats":      { "about": "…", "list": [ /* Chat */ ] },
  "left_chats": { "about": "…", "list": [ /* Chat (channels/supergroups you left) */ ] }
}
```
Sections appear only if they were selected. Write the importer to tolerate any subset.

**Contact**: `{ "user_id": 100000002, "first_name": "Ben", "last_name": "Ito", "phone_number": "+81 90 0000 0000", "date": "2024-01-03T10:00:00", "date_unixtime": "1704276000" }` (the entry may be only `{date, date_unixtime}` if names and phone are empty). `user_id` can be missing for phone-only contacts.

**TopPeer** (`frequent_contacts`): `{ "id": 100000002, "category": "people"|"inline_bots"|"calls", "type": "user"|"private_group"|"private_supergroup"|"public_supergroup"|"private_channel"|"public_channel", "name": "Ben Ito", "rating": 0.83 }`. This is Telegram's own top-correspondent score, useful as a node attribute.

### 2.2 Chat object

```jsonc
{ "name": "Field Ops", "type": "private_supergroup", "id": 1234567890, "messages": [ … ] }
```
`name` is omitted for `saved_messages`, `replies` and `verification_codes`. `id` is the **bare** numeric peer ID (no prefix).

| `type` value | Meaning | Our `conversation_type` |
|---|---|---|
| `personal_chat` | 1:1 with a user | direct |
| `bot_chat` | 1:1 with a bot | direct (flag bot. Usually exclude) |
| `saved_messages` | chat with self | exclude |
| `replies` | the "Replies" service chat | exclude |
| `verification_codes` | login-codes service chat | exclude |
| `private_group` | legacy basic group | group |
| `private_supergroup` / `public_supergroup` | supergroup | group |
| `private_channel` / `public_channel` | broadcast channel | broadcast (one-to-many, usually exclude or weight ≈ 0) |

### 2.3 Message object

```jsonc
{
  "id": 5531,
  "type": "message",                    // "message" | "service" | "unsupported"
  "date": "2025-11-14T09:12:44",        // LOCAL time of the exporting machine, ISO without offset
  "date_unixtime": "1731571964",        // STRING of epoch seconds (UTC) ← use this
  "edited": "2025-11-14T09:15:02", "edited_unixtime": "1731572102",   // only if edited
  "from": "Ana Kovač",                  // display name at export time (null if deleted account)
  "from_id": "user100000001",           // "user<N>" | "channel<N>" | "chat<N>"
  "author": "Ana",                      // channel post signature (rare)
  "forwarded_from": "Ben Ito", "forwarded_from_id": "user100000002",
  "saved_from": "Ops Announcements",
  "reply_to_message_id": 5529,          // same-chat parent
  "reply_to_peer_id": "channel987",     // present when the reply targets another chat
  "via_bot": "@somebot",
  "media_type": "voice_message", "file": "voice_messages/audio_1.ogg", "duration_seconds": 7,
  "photo": "photos/photo_12@14-11-2025_09-12-44.jpg",
  "text": "plain string OR array (see below)",
  "text_entities": [ { "type": "plain", "text": "Ping " }, { "type": "mention", "text": "@ben_ito" } ],
  "reactions": [ { "type": "emoji", "count": 2, "emoji": "👍",
                   "recent": [ { "from": "Ben Ito", "from_id": "user100000002", "date": "2025-11-14T09:13:00" } ] } ]
}
```

**`text` polymorphism** (from `SerializeText`):
- empty → `""`
- a single plain run → `"Ping"` (string)
- otherwise → an **array mixing bare strings (plain runs) and objects** `{ "type": …, "text": …, <extra> }`, e.g. `["Ping ", {"type":"mention","text":"@ben_ito"}, "!"]`

`text_entities` is **always an array of objects** (plain runs become `{"type":"plain","text":…}`), so parse `text_entities` and concatenate `.text`. Entity types: `plain, mention, mention_name (+user_id), hashtag, cashtag, bot_command, link, text_link (+href), email, phone, bold, italic, underline, strikethrough, code, pre (+language), blockquote (+collapsed), spoiler, custom_emoji (+document_id), bank_card, unknown`.

> New in recent tdesktop: some messages carry `"rich_message": {…}` **instead of** `text`/`text_entities`. Treat it as text-less, or extract text blocks defensively.

`"type":"unsupported"` messages contain only `{id, type}`.

**Service messages** (`"type":"service"`) have `actor`, `actor_id` and `action`, plus action-specific fields. The ones relevant to network building:

| action | extra fields | Use |
|---|---|---|
| `create_group` | `title`, `members` [names] | initial membership |
| `invite_members` | `members` [names] | joins (actor = inviter, a directed tie) |
| `remove_members` | `members` [name] | leave/kick (actor == member means they left) |
| `join_group_by_link` | `inviter` | join |
| `join_group_by_request`, `join_group_via_community` | — | join |
| `migrate_to_supergroup` / `migrate_from_group` | `title` | **chat ID changes**: link the old group to the new supergroup |
| `phone_call` / `conference_call` / `group_call` | `duration_seconds`, `discard_reason`, … | call event between actor and peer |
| `pin_message` | `message_id` | |
| `edit_group_title`, `edit_group_photo`, `delete_group_photo`, `create_channel`, `clear_history`, `set_messages_ttl`, `topic_created`, `topic_edit`, … | various | ignore or keep as metadata |

`members` and `inviter` are **names, not IDs**. Resolve them against `from`/`from_id` pairs seen elsewhere in the chat.

### 2.4 Single-chat export

`result.json` = `{ "name", "type", "id", "messages": [...] }` with no `chats` wrapper and no contacts or personal info. Detect it by `messages` at the root (chat-miner uses this test).

---

## 3. Mapping to the Org Signal model

| Internal | Source |
|---|---|
| conversation_id | `chat.id` (bare). If a migration exists, record both IDs and merge |
| conversation_type | from `chat.type` (table above) |
| sender | `from_id` (key) + `from` (label). For service: `actor_id`/`actor` |
| recipients | personal_chat: the other party (the chat `id` = the other user's bare ID, and `from_id` of non-ego messages is `user<id>`). Groups: the current member set minus sender (from service events and observed senders) |
| timestamp | `parseInt(date_unixtime)*1000` (UTC epoch). **Do not parse `date`**: it is local time of the export machine without offset |
| reply/parent | `reply_to_message_id` (+ `reply_to_peer_id` if cross-chat). **Reply edges** sender → parent's sender are high-quality directed ties |
| forwarded | `forwarded_from_id`. Not a tie to the original author; keep it as an attribute |
| text | join of `text_entities[].text` |
| mentions | `mention` (username) and `mention_name` (`user_id`) entities → directed sub-edges |
| reactions | `reactions[].recent[]` gives `from_id` + `date` → reaction edges reactor → message sender (only the "recent" subset is exported, not all reactors) |
| node attrs | contacts list (first/last/phone), `frequent_contacts.rating`, `personal_information` for ego |

Ego = `personal_information.user_id` → `"user"+id`. In a single-chat export, ego is unknown, so ask the user or infer it as the sender common to multiple imported chats.

## 4. Observation note (ego view)

- Full exports include **all** chats of the selected types, a much richer ego network than WhatsApp: direct chats plus every group's full visible history (including messages from before you joined, for supergroups with visible history).
- Ties among contacts appear only through shared groups, and groups are where Telegram is strongest: reply chains reveal **alter-alter directed interactions**, not just co-membership.
- Large public supergroups and channels dwarf personal ties. Default to excluding `*_channel`, and let the user cap group size.
- Deleted messages are gone. Deleted accounts have `from: null` (and a `from_id` still present).

## 5. Identity matching

- `from_id` (`user<N>`) is **stable and unique**: use it as the key. `from` is the display name as seen by the exporter, which can change over time but is exported once as the current value.
- Join to contacts by `user_id`. Contacts carry phone numbers, which enables matching to WhatsApp/iMessage when the user opts in (normalize to E.164).
- `members` and `inviter` in service messages are names only. Ambiguous for duplicate names, so map them via the name → id table built from the same chat.
- Prefix-typed IDs: users `user`, basic groups `chat`, supergroups and channels `channel`. A `chat.id` is bare, so compare numerically and be careful with collisions across kinds.

## 6. Auto-detection signature

- JSON root has `chats.list` (array of objects with `type` and `messages`) → full export.
- JSON root has `messages` (array) and `type` ∈ the chat type table → single chat.
- Messages have `date_unixtime` (string of digits) and `type` ∈ {`message`,`service`}.
- Folder or zip name `DataExport_YYYY-MM-DD` / `ChatExport_YYYY-MM-DD`, file `result.json`.

## 7. Quirks and size

- `date_unixtime` is a **string**. `id`, `user_id` and `rating` are numbers.
- `text` string-or-array, as described. Don't use `text` for length stats without flattening.
- JSON is pretty-printed with one-space-per-level indentation. Full exports reach **hundreds of MB to several GB** for heavy users with large groups. Without media, 1M messages ≈ 300–600 MB of JSON (estimate).
- Messages are written chronologically per chat (ascending id).

## 8. Browser feasibility

Feasible. For files under ~200–300 MB, `JSON.parse` in a Web Worker is fine. For larger ones, use a **streaming JSON parser** (e.g. `@streamparser/json` or `clarinet`/`oboe`-style) over `File.stream()` to process `chats.list[i].messages[j]` incrementally and never hold the whole tree in memory. Zips: `fflate` streaming unzip of `result.json` only.

## 9. Sources (opened)

| URL | Type |
|---|---|
| https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/export/output/export_output_json.cpp | **official source code (authoritative)** |
| https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/export/output/export_output_abstract.cpp (`ChatExport_%1` / `DataExport_%1`) | official source |
| https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/export/export_settings.h (selectable chat types) | official source |
| https://github.com/joweich/chat-miner — `chatminer/chatparsers.py` (single vs batch detection), `test/telegram/test_single_export.json` | community |
