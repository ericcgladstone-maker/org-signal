# iMessage / SMS (Apple Messages)

Status: researched 2026-10-02. **Apple provides no user-facing export.** Two realistic inputs are covered below:
(A) the raw macOS `chat.db` SQLite database. Confidence on the schema is **high**, from imessage-exporter's table docs, which track current macOS.
(B) text output of **imessage-exporter** (ReagentX). Confidence **high**, read from its templates and source.
Feasibility: **(A) is feasible in the browser with caveats (size, WAL, `attributedBody`). (B) is easy but lossy.**

---

## 1. How it's obtained

### Path A: copy `chat.db` (macOS)
1. Messages must be synced to the Mac (Messages in iCloud on, or the Mac has been receiving messages).
2. The DB lives at `~/Library/Messages/chat.db` with sidecars `chat.db-wal` and `chat.db-shm`. Attachments are in `~/Library/Messages/Attachments/`.
3. Reading it requires **Full Disk Access** for the app doing the copy (Terminal/Finder) since macOS Mojave.
4. **Recommended user instruction** (produces a single consistent file that includes WAL content):
   ```sh
   sqlite3 ~/Library/Messages/chat.db ".backup '$HOME/Desktop/chat-copy.db'"
   ```
   Copying `chat.db` alone in Finder **omits recent messages still in `chat.db-wal`**, and a browser can't apply a separate WAL file.
5. iPhone-only users: an unencrypted Finder/iTunes backup contains the same schema as `sms.db`, at backup path `3d/3d0d7e5fb2ce288813306e4d4636395e047a3d28`. Encrypted backups need decryption first, which imessage-exporter can do; not feasible in-browser.

### Path B: imessage-exporter (Rust CLI, `brew install imessage-exporter`)
```sh
imessage-exporter -f txt -o ~/imessage_export          # or -f html; default copy-method 'disabled'
```
Output: one file per conversation in the export dir, plus `orphaned.txt` for messages with no chat.
File name = chat display name + ` - <chat rowid>` (named group chats), or a comma-joined participant list (`Contact 1, Contact 2, … and 4 others`), or the `chat_identifier`. Truncated to ~235 chars and sanitized, extension `.txt`/`.html`.

---

## 2. `chat.db` schema (relevant subset)

```
handle(ROWID, id TEXT /* +15555550123 or name@example.com */, service /* iMessage|SMS|RCS */,
       country, uncanonicalized_id, person_centric_id)

chat(ROWID, guid, style, chat_identifier, service_name, room_name, display_name /* group name */,
     group_id, is_archived, …)

message(ROWID, guid, text, attributedBody BLOB, handle_id → handle.ROWID, other_handle,
        service, date, date_read, date_delivered, date_edited, date_retracted,
        is_from_me, is_read, is_sent, is_delivered, is_system_message, is_service_message,
        item_type, group_action_type, group_title, cache_has_attachments,
        associated_message_guid, associated_message_type /* tapbacks */, associated_message_emoji,
        reply_to_guid, thread_originator_guid /* inline replies */, thread_originator_part,
        balloon_bundle_id, destination_caller_id, …)        -- 90+ columns on current macOS

chat_handle_join(chat_id → chat.ROWID, handle_id → handle.ROWID)       -- membership
chat_message_join(chat_id → chat.ROWID, message_id → message.ROWID, message_date)
message_attachment_join(message_id, attachment_id); attachment(ROWID, filename, mime_type, …)
chat_recoverable_message_join                                         -- "Recently Deleted"
```

### Key semantics

| Field | Meaning |
|---|---|
| `message.date` | **Apple epoch: 2001-01-01T00:00:00Z.** Nanoseconds on modern DBs (High Sierra+), seconds on older ones. imessage-exporter rule: `secs = date >= 1e12 ? date/1e9 : date`. Unix ms = `(secs + 978307200) * 1000`. **True UTC instant**, the only source in this group with an unambiguous timestamp |
| `is_from_me` | 1 = sent by ego. Then `handle_id` is the 1:1 counterparty, or **0 in groups** |
| `handle_id` | sender handle for incoming messages (0 for some system rows) |
| `destination_caller_id` | which of ego's own numbers/emails was used: helps identify ego |
| `text` vs `attributedBody` | On recent macOS `text` is often **NULL** while the body lives only in `attributedBody`, a **typedstream** (NSArchiver, *not* a plist) serializing an NSAttributedString. One report measured ~26% of incoming messages affected |
| `associated_message_type` | `0` normal. `2000–2007` tapback added (2000 = loved, …). `3000–3007` tapback removed. `1000` sticker. `associated_message_guid` targets the parent. Prefixes like `p:0/<guid>` / `bp:<guid>` are commonly seen (unverified here), so strip everything up to the last `/` or `:` before matching `message.guid` |
| `thread_originator_guid` | inline-reply parent message guid (reply threading) |
| `item_type` / `group_action_type` / `other_handle` / `group_title` | (verified in imessage-exporter `group_action.rs`) `(1,0)` participant **added** (`other_handle` = who), `(1,1)` participant **removed**, `(2,_)` rename (`group_title`), `(3,0)` participant **left**, `(3,1)`/`(3,2)` group icon changed/removed, `(3,4)`/`(3,6)` background changed/removed |
| `chat.style` | commonly cited as 43 = group, 45 = 1:1. **Not verified**. Instead, count `chat_handle_join` rows (> 1 = group) |
| `chat.chat_identifier` | 1:1: the handle (`+15555550123`). Group: `chat<digits>` |

### Minimal extraction query

```sql
SELECT m.ROWID, m.guid, cmj.chat_id, c.display_name, c.chat_identifier,
       m.is_from_me, h.id AS sender_handle, m.date, m.text, m.attributedBody,
       m.associated_message_type, m.associated_message_guid, m.thread_originator_guid,
       m.item_type, m.group_action_type, m.other_handle, m.service
FROM message m
JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
JOIN chat c               ON c.ROWID = cmj.chat_id
LEFT JOIN handle h        ON h.ROWID = m.handle_id
ORDER BY m.date;

-- membership
SELECT chj.chat_id, h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id;
```

### Decoding `attributedBody` in JS (heuristic, fine for plain text)

Layout as described in community decoders: the blob begins `\x04\x0bstreamtyped`. Find the first `NSString` class marker. A few bytes later comes `0x2B` (`+`), then a length: one byte if `< 0x81`, `0x81` → uint16 LE follows, `0x82` → uint32 LE follows. Then UTF-8 bytes of that length. The first NSString is the message body.
```js
function bodyFromAttributedBody(u8) {
  const marker = new TextEncoder().encode('NSString');
  let i = indexOfSub(u8, marker); if (i < 0) return null;
  i += marker.length;
  while (i < u8.length && u8[i] !== 0x2b) i++;      // find '+'
  i++;
  let len = u8[i++];
  if (len === 0x81) { len = u8[i] | (u8[i+1] << 8); i += 2; }
  else if (len === 0x82) { len = new DataView(u8.buffer, u8.byteOffset + i, 4).getUint32(0, true); i += 4; }
  return new TextDecoder().decode(u8.subarray(i, i + len));
}
```
This ignores formatting, mentions and multi-part ranges. For fidelity, port `crabstep` (the Rust typedstream parser imessage-exporter uses), but text alone is enough for our purposes.

---

## 3. imessage-exporter TXT format

Each message is a block: timestamp line, sender line, body lines, blank line. Template (`templates/message.txt`) and tests:

```text
May 17, 2022  5:29:42 PM (Read by them after 1 hour, 49 seconds)
Me
Can you send the Q3 deck?

May 17, 2022  6:02:10 PM
Lena Whitford
Sent! Check your email
This message responded to an earlier message.

May 17, 2022  6:03:00 PM Lena Whitford added Raj Patel to the conversation.

```
- Timestamp: `%b %d, %Y %l:%M:%S %p` (`%l` space-pads the hour, hence the **double space** in `2022  5:29`). Rendered in the **exporting machine's local tz, no offset**. An optional `(Read by … after …)` suffix.
- Sender: `Me` (or `--custom-name` / caller ID), the contact name if the Contacts DB resolved, else the raw handle (`+15555550123`, `name@example.com`).
- Tapbacks under a message: `Loved by Lena Whitford` (`{tapback} by {who}`). Stickers: `{payload} from {who}`.
- Replies: `This message responded to an earlier message.` and threaded replies are printed under the parent (and also in place), so **the TXT duplicates thread replies**. Dedupe by (timestamp, sender, text).
- Announcements (one line): `{timestamp} {who} added|removed X to|from the conversation.` / `named the conversation X` / `left the conversation.` / `unsent a message!` …
- Edited: an edit history with `Edited N seconds later: …` lines.
- Attachments: a file path line.
- There is **no conversation ID inside the file** (it's in the filename) and no participant list. Group membership must be inferred from senders and announcements.

The HTML format carries the same data in markup and is harder to parse. Prefer TXT if users go this route.

---

## 4. Mapping to the Org Signal model

| Internal | chat.db | imessage-exporter TXT |
|---|---|---|
| conversation_id | `chat.guid` (or `chat.ROWID`). Note the same person can have separate iMessage and SMS chats: merge on the participant set | file name |
| conversation_type | `count(chat_handle_join) > 1` → group | > 2 distinct senders or any announcement → group |
| sender | `is_from_me ? EGO : handle.id` | sender line (`Me` → ego) |
| recipients | 1:1 → the other handle. Group → `chat_handle_join` members (current membership; historical membership via group actions) minus sender, plus ego if the sender ≠ ego | inferred |
| timestamp | `date` (Apple epoch, UTC). Exact | local time string, no tz, so ask the user |
| reply/parent | `thread_originator_guid` (inline replies). Tapbacks via `associated_message_guid` | "responded to an earlier message" marker only (parent not identified in TXT) |
| text | `text ?? decode(attributedBody)` | body lines |
| node attrs | `handle.id` (phone/email), `service` (iMessage/SMS/RCS), `person_centric_id` | name or handle |

Exclude tapback rows (`associated_message_type` 2000–3007) from message counts but keep them as **reaction edges** (reactor → parent sender).

## 5. Observation note (ego view)

- You see every thread the Mac has synced (iMessage, plus SMS/RCS relayed from the iPhone if Text Message Forwarding is on). History can go back years. Users who don't use Messages in iCloud may have only partial history on the Mac.
- Alter-alter ties are visible only through group chats (membership via `chat_handle_join`, and sender-level interaction).
- Deleted messages vanish, except the recently-deleted join table (≤ 30 days).

## 6. Identity matching

- Handles are **phone numbers (E.164-ish) or Apple ID emails**. One person often has several (phone + email, or 2 phones), and nothing in `chat.db` links them, except `person_centric_id` on newer DBs, which may group handles of the same contact (behaviour not verified).
- **No names in `chat.db`.** Names come from the macOS Contacts DB (`~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb`, also SQLite). We could accept it as an optional second file to label nodes; feasible with the same sql.js approach. Otherwise show handles, which also makes cross-source matching (WhatsApp/Telegram phone numbers) possible after E.164 normalization.
- Ego's own handles: `destination_caller_id` values and `message.account` / `chat.account_login`.

## 7. Auto-detection signature

- SQLite magic `SQLite format 3\0` in the first 16 bytes, plus tables `message`, `handle`, `chat`, `chat_message_join`, `chat_handle_join` (`SELECT name FROM sqlite_master WHERE type='table'`).
- iOS `sms.db` has the same signature.
- imessage-exporter TXT: blocks whose first line matches `^[A-Z][a-z]{2} \d{2}, \d{4} [ \d]\d:\d{2}:\d{2} [AP]M` and second line is the sender. Files named `orphaned.txt` sit alongside.

## 8. Quirks and size

- `chat.db` size: tens of MB to **several GB** for heavy users with long history. The bulk is message rows. Attachments are separate files.
- Seconds-vs-nanoseconds dates in older DBs. 0 or NULL dates on some system rows.
- Duplicate chats per person (iMessage vs SMS vs RCS. Also chats split when a number changes).
- `text` contains U+FFFC (object replacement char) placeholders for inline attachments. Strip them.
- Schema drift: Apple adds columns every macOS release. Select only the columns you need and check they exist via `PRAGMA table_info(message)`.

## 9. Browser feasibility

| Aspect | Verdict |
|---|---|
| Reading SQLite | **sql.js** (SQLite compiled to WASM) loads a DB from a `Uint8Array` (via `FileReader`/`file.arrayBuffer()`). It keeps the **whole DB in memory** (the sql.js README says native bindings avoid "having to load the entire database in memory, avoiding out of memory errors"). Practical ceiling is roughly **1–2 GB** (WASM 32-bit heap ≤ 4 GB, plus tab memory) |
| Large DBs | Ask users to make a slimmed copy first: `sqlite3 chat.db ".backup x.db"` then `VACUUM`. Or pre-filter with a date range: `sqlite3 x.db "DELETE FROM message WHERE date < …"` (power users only). Alternatives: the official SQLite WASM build with OPFS, or `wa-sqlite` with a File-backed VFS, which can read from a `File` lazily (more complex but no RAM ceiling). Not prototyped here |
| WAL | sql.js reads one file image, so WAL frames are lost unless the user uses `.backup` (instructions above) |
| `attributedBody` | Heuristic decoder above (pure JS) |
| Contacts names | Second optional SQLite file (AddressBook) via sql.js |
| Path B (TXT) | Trivial to parse, but lossy (no IDs, local tz, duplicated thread replies) |

**Recommendation:** support Path A (chat.db/sms.db via sql.js, with a clear "make a backup copy" instruction and a size warning above ~1 GB) as primary, and Path B as a fallback.

## 10. Sources (opened)

| URL | Type |
|---|---|
| https://github.com/ReagentX/imessage-exporter — `docs/tables/messages.md`, `docs/tables/chat.md`, `docs/tables/handle.md` | community, actively maintained (de-facto reference) |
| …/`imessage-exporter/README.md` (CLI flags, iOS backup path, contacts DB names) | community |
| …/`imessage-database/src/util/dates.rs` (Apple epoch, ns vs s rule, TXT timestamp format) | community |
| …/`imessage-database/src/tables/table.rs` (table names, iOS backup hash path) | community |
| …/`imessage-database/src/tables/messages/message.rs` (tapback codes, thread_originator, item_type) | community |
| …/`imessage-exporter/src/app/runtime.rs` (export file naming) | community |
| …/`imessage-exporter/src/exporters/txt/templates/*.txt`, `txt/mod.rs` tests | community |
| …/`docs/features.md` | community |
| https://github.com/sql-js/sql.js README (in-memory model, loading from Uint8Array) | library docs |
| https://fatbobman.com/en/posts/deep-dive-into-imessage/ (Full Disk Access, WAL lag, chat_identifier forms. Its claim that attributedBody is a binary plist is **wrong**: it is typedstream) | writeup |
| https://github.com/danielmiessler/LifeOS/issues/2206 (attributedBody byte layout, ~26% NULL `text`) | community |
| https://github.com/matrix-hacks/matrix-puppet-imessage/issues/46 (schema dump. No style semantics) | community |
