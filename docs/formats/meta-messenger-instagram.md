# Facebook Messenger and Instagram DMs (Meta "Download/Export your information", JSON)

Status: researched 2026-10-02. Confidence: **high** for the core DYI thread schema (`participants[].name`, `messages[].sender_name/timestamp_ms/content`) and the mojibake bug (consistent across 5+ independent parsers). **Medium** for folder-layout changes by year and for the E2EE "secure storage" export schema (2 independent parsers agree; Meta does not document it). **Unverified** items are flagged inline.

---

## 1. How it's obtained

### 1a. Standard export (non-E2EE history; Facebook and Instagram)
Accounts Center → *Your information and permissions* → *Export your information* (older UI: *Download your information*) → Create export → choose profile (Facebook or Instagram) → *Export to device* → **Customize**: select only **Messages**, Date range *All time*, **Format: JSON** (default is HTML!), Media quality *Low* → Start export. Meta emails when it's ready (minutes to days). The download stays available for **4 days** (official). Large exports are split into several zips (`facebook-<user>-<date>-<random>.zip`, part 1..n), whose contents merge into one tree. The zip name pattern is community-observed.

### 1b. Messenger end-to-end-encrypted chats (2024+)
Since Messenger made E2EE the default (rolled out from Dec 2023 / spring 2024), **newer 1:1 and group chats are not in the standard export**. They must be downloaded separately, on a computer only:
- Official (facebook.com/help/messenger-app/677912386869109): Messenger → *Options* next to Chats → *Chat history* → *Last backup* → **Download chat backup**.
- Equivalent older path: messenger.com → profile → Privacy & safety → End-to-end encrypted chats → Message storage → **Download secure storage data** (requires secure storage / PIN).
- Result: a zip usually named `messages.zip` (deciphertools).

A complete Messenger history therefore needs **both** zips. They overlap at the cutover point (folder `e2ee_cutover`).

Instagram DMs are exported only through 1a. Whether Instagram's newer E2EE chats appear in it is not verified.

---

## 2. Container trees

Paths vary by export vintage. Search for any `**/messages/{inbox,archived_threads,filtered_threads,message_requests,e2ee_cutover}/<thread>/message_<N>.json`.

```
# Facebook, pre-2024
messages/inbox/janedoe_10158xxxxxxxx/message_1.json
messages/inbox/janedoe_10158xxxxxxxx/photos/…
messages/archived_threads/…  messages/filtered_threads/…  messages/message_requests/…
messages/stickers_used/…

# Facebook, 2024 (one layout seen)
your_activity_across_facebook/messages/inbox/<thread>/message_1.json
your_activity_across_facebook/messages/e2ee_cutover/<thread>/message_1.json

# Facebook, 2024/2025 (other layout)
your_facebook_activity/messages/inbox/<thread>/message_1.json

# Instagram, 2025+
your_instagram_activity/messages/inbox/<username>_<id>/message_1.json
# Instagram, older
messages/inbox/<username>_<id>/message_1.json

# Messenger E2EE secure-storage zip (flat, no section folders)
messages.zip
├── Jane Doe_1.json            # one file per thread: "<Thread name>_<N>.json"
├── Field Ops crew_2.json
└── media/…
```

- Thread folder = `<sanitized title>_<numeric or alnum id>`. **Use the folder name as the conversation ID.** Also see `thread_path` inside the JSON.
- Long threads are split: `message_1.json` **holds the newest messages**, and `message_2.json`… go back in time (per-file cap of ~10k messages per community reports, not verified). Merge all files, then sort by `timestamp_ms` ascending.

---

## 3. Schemas

### 3.1 Standard export thread (`message_N.json`), Facebook and Instagram alike

```jsonc
{
  "participants": [ { "name": "Ana Kova\u00c4\u008d" /* = "Ana Kovač" after the §6 fix */ }, { "name": "Jordan Pike" } ],
  "messages": [                                   // NEWEST FIRST
    {
      "sender_name": "Jordan Pike",
      "timestamp_ms": 1717321402123,              // epoch ms, UTC
      "content": "See you at 3",
      "type": "Generic",                          // Generic | Share | Call | Subscribe | Unsubscribe | …
      "reactions": [ { "reaction": "\u00e2\u009d\u00a4", "actor": "Ana Kova\u00c4\u008d" } ],   // raw file text; = ❤ / "Ana Kovač" after fix
      "is_geoblocked_for_viewer": false
    },
    { "sender_name": "Ana Kova\u00c4\u008d", "timestamp_ms": 1717321300000, "type": "Generic",
      "photos": [ { "uri": "messages/inbox/jordanpike_ABC123/photos/123.jpg", "creation_timestamp": 1717321300 } ] },
    { "sender_name": "Jordan Pike", "timestamp_ms": 1717320000000, "type": "Call", "call_duration": 192 },
    { "sender_name": "Ana Kova\u00c4\u008d", "timestamp_ms": 1717310000000, "type": "Call", "call_duration": 0, "missed": true },
    { "sender_name": "Jordan Pike", "timestamp_ms": 1717300000000, "type": "Share",
      "share": { "link": "https://example.com/article", "share_text": "…" } },
    { "sender_name": "Sam Rivera", "timestamp_ms": 1717200000000, "content": "Sam left the chat", "type": "Unsubscribe" }
  ],
  "title": "Jordan Pike",                         // group name or other party's name
  "is_still_participant": true,
  "thread_path": "inbox/jordanpike_ABC123",
  "magic_words": [],
  "thread_type": "Regular"                        // older exports only; values Regular | RegularGroup from memory, UNVERIFIED
}
```

| Message field | Type | Notes |
|---|---|---|
| `sender_name` | string | **display name only, no ID**. Mojibake-encoded |
| `timestamp_ms` | int | epoch milliseconds, **UTC**: unambiguous |
| `content` | string? | absent for media/sticker/call. Also holds system text ("X left the chat", "X added Y to the group", "X named the group …", "Reacted ❤ to your message" on Instagram) |
| `type` | string | `Generic` (normal), `Share`, `Call`, `Subscribe` (joined/added), `Unsubscribe` (left/removed). Others may appear. Keep raw |
| `photos` / `videos` / `audio_files` / `files` / `gifs` | [{uri, creation_timestamp}] | relative paths |
| `sticker` | {uri} | |
| `share` | {link, share_text} | |
| `call_duration` (s), `missed` | int, bool | on `Call` |
| `reactions` | [{reaction, actor}] | **actor = display name** → reaction edge |
| `is_unsent` | bool | unsent message (usually no content) |
| `users` | [{name}] | on Subscribe/Unsubscribe in some exports (**unverified**) |

Not exported: message IDs, reply-to/quoted parent, read receipts, edits.

### 3.2 Messenger E2EE secure-storage export (`<Name>_<N>.json`)

camelCase, **participants are plain strings**, text in `text`:
```jsonc
{
  "participants": ["Ana Kovač", "Jordan Pike", "Sam Rivera"],
  "threadName": "Field Ops crew",
  "messages": [
    { "senderName": "Jordan Pike", "text": "Plans?", "timestamp": 1717321402123,
      "type": "Generic", "isUnsent": false, "media": [], "reactions": [] },
    { "senderName": "Sam Rivera", "text": "", "timestamp": 1717321462000,
      "type": "Generic", "isUnsent": false, "media": [ { "uri": "./media/photo.jpg" } ],
      "reactions": [ { "actor": "Ana Kovač", "reaction": "👍" } ] }
  ]
}
```
- `timestamp` = epoch **ms**. `media` is one untyped array.
- Two parsers (msgvault, CounterForMessenger) report this file as **correct UTF-8 (no mojibake)**. Running the mojibake fixer is still safe (§6).
- Sort order is not guaranteed, so sort ascending.

---

## 4. Mapping to the Org Signal model

| Internal | Standard (snake_case) | E2EE (camelCase) |
|---|---|---|
| conversation_id | thread folder name / `thread_path` | file name minus `.json` |
| conversation_type | `participants.length > 2` → group (or `thread_type == "RegularGroup"`) | `participants.length > 2` → group |
| sender | `fix(sender_name)` | `senderName` |
| recipients | `participants − sender` (current participants only: people who left may be missing from `participants` while their messages remain, so add every observed `sender_name` to the member set) | `participants − sender` |
| timestamp | `timestamp_ms` (UTC) | `timestamp` (UTC ms) |
| reply/parent | none | none |
| text | `fix(content)`. Treat `Subscribe`/`Unsubscribe` and system phrases as membership events | `text` |
| reactions | `reactions[].actor` → reactor → sender edge | same |
| node attrs | name. `is_still_participant` (for ego) | — |

Ego = the participant present in **every** thread (or read `personal_information/profile_information/profile_information.json` from a fuller export; that path is unverified for the 2025 layout).

Dedup across the two Messenger sources: the same thread may appear in the standard export's `e2ee_cutover` and in the E2EE zip. Dedupe on (sender, timestamp_ms, text hash).

## 5. Observation note (ego view)

- Only ego's threads. Groups give co-membership and in-group speaking. Alter-alter ties are otherwise invisible.
- Since 2024, **missing the E2EE zip silently truncates recent Messenger history**. Warn when the max timestamp in a standard export is far older than the export date.
- Instagram: message requests and filtered threads are separate sections, so let the user include or exclude them.
- Meta deletes nothing on export, but unsent messages appear as stubs (`is_unsent`), and deactivated users appear as "Facebook user" / "Instagram User" (exact labels unverified).

## 6. The latin-1 mojibake bug (standard export)

Meta writes each **UTF-8 byte as a separate `\u00XX` escape**. E.g. `č` (UTF-8 `C4 8D`) is written `"Ä\u008d"`, so `JSON.parse` yields the 2-char string `"Ä\u008d"`. Emoji become 4 garbage chars.

Fix: re-interpret every code unit (all ≤ 0xFF) as a byte and decode as UTF-8.

```js
const td = new TextDecoder('utf-8', { fatal: true });
function fixMeta(s) {
  if (typeof s !== 'string') return s;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xFF) return s; // already proper Unicode → leave
  try { return td.decode(Uint8Array.from(s, c => c.charCodeAt(0))); }
  catch { return s; }                                                     // not valid UTF-8 bytes → leave
}
// Apply recursively to every string (names, content, title, reactions, share_text) after JSON.parse,
// or more efficiently with a JSON.parse reviver: JSON.parse(text, (k, v) => fixMeta(v)).
```
This mirrors Python's `s.encode('latin-1').decode('utf-8')` used by chat-miner and CounterForMessenger. It is idempotent on correct text: a codepoint > 255 short-circuits, and pure ASCII is unchanged. timelinize's Go version drops runes > 255 instead of bailing, which is less safe.

## 7. Identity matching

- **Names only**, no stable IDs, no usernames (Instagram threads' folder names include the counterpart's username in 1:1 threads, e.g. `janedoe_1234567890`, which helps label nodes; group folder names are derived from the title).
- Name collisions (two "Alex Kim"s) cannot be resolved inside a thread. Across threads, merge by exact fixed name and offer a manual split/merge.
- People who rename themselves appear under the **current** name throughout (the export is rendered at export time; believed but not verified).
- Cross-platform: Facebook names ≈ real names, Instagram may be handles or display names, so matching to WhatsApp/LinkedIn is fuzzy only.

## 8. Auto-detection signature

- Any JSON with `participants` (array) and `messages` (array) where messages have `sender_name` + `timestamp_ms` → standard Meta thread.
- `participants` array of strings + `threadName` + messages with `senderName` + `timestamp` → Messenger E2EE.
- Facebook vs Instagram: path prefix (`your_instagram_activity/` vs `your_facebook_activity/` / `your_activity_across_facebook/`), or other top-level folders in the zip. Ambiguous for the bare old `messages/inbox` layout, so ask the user.
- Ignore non-thread JSON in messages roots (e.g. `autofill_information.json`, `secret_conversations.json`, `your_chat_settings…`). Require both keys.

## 9. Quirks and size

- **Format: users often pick HTML by mistake** (`message_1.html`). Detect it and ask them to re-export as JSON (msgvault does parse HTML, but its layout changes often).
- Messages are newest-first. Multiple `message_N.json` per thread. Multi-part zips.
- Text exports are small (a heavy user has ~100–500 MB of JSON across thousands of threads). With media, many GB, so read only `*.json` entries from zips.
- `content` may contain system-generated English phrases for reactions/calls/joins that are localized to the account language.

## 10. Browser feasibility

Easy. Use `fflate`/`JSZip` (iterate zip entries, read only `message_*.json` and E2EE `*.json`; multiple zips at once), `JSON.parse` with the `fixMeta` reviver per file (each file is small, ≤ a few MB), then a merge/sort per thread. Everything runs in a Web Worker.

## 11. Sources (opened)

| URL | Type |
|---|---|
| https://www.facebook.com/help/212802592074644 (Accounts Center export steps, HTML vs JSON, 4-day availability) | **official** |
| https://www.facebook.com/help/messenger-app/677912386869109 (download E2EE chat backup, computer only) | **official** |
| https://help.instagram.com/181231772500920 (page fetched, content mostly not retrievable) | official (thin) |
| https://github.com/kenn-io/msgvault — `internal/fbmessenger/{discover.go,types.go,e2ee_parser.go,json_parser.go}`, `testdata/**` (layouts by year, section names incl. `e2ee_cutover`, E2EE camelCase schema) | community |
| https://github.com/timelinize/timelinize — `datasources/facebook/{messages.go,models.go,archive.go,facebook.go}`, `datasources/instagram/instagram.go` (path constants by year, thread model, FixString) | community, maintained |
| https://github.com/Kubis10/CounterForMessenger — `README.md`, `Main.py` (old vs new schema, mojibake fix, E2EE download steps) | community |
| https://github.com/joweich/chat-miner — `chatminer/chatparsers.py` (Messenger + Instagram parsers, latin-1 fix), `test/instagram/test_export.json` | community |
| https://deciphertools.com/support/knowledge-base/missing-newer-facebook-messages/ (E2EE split, `messages.zip`) | vendor KB |
