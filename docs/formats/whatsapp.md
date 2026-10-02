# WhatsApp chat export (`Export chat`)

Status: researched 2026-10-02. Confidence: **high** for line grammar and invisible characters (verified against parser source code and test fixtures). **Medium** for file names, system-message wording and the edit/delete markers. These depend on version and locale, and nothing in this area is officially specified.

> There is no published spec. WhatsApp's help center describes only how to export. Everything below comes from open-source parsers, their fixtures and their issue trackers. Expect drift between app versions.

---

## 1. How it's obtained

| Platform | Steps | Output |
|---|---|---|
| Android | Open chat → ⋮ → More → Export chat → *Without media* / *Include media* → share sheet | `.txt` (without media) or `.zip` with the `.txt` plus media. File name usually `WhatsApp Chat with <Name>.txt` (community-reported, not verified) |
| iOS | Open chat → tap contact/group name → scroll down → Export Chat → *Without Media* / *Attach Media* → share sheet / Save to Files | `.zip` named like `WhatsApp Chat - <Name>.zip` containing **`_chat.txt`** (+ media). iOS seems to zip even text-only exports (whatstk docs call `_chat.zip` "e.g. iOS export"). Not verified for every version |

- **One export = one chat.** There is no bulk export. A user wanting a network must export many chats and drop them all in.
- **Limits (official FAQ, quoted via search snippet):** up to **40,000** most recent messages without media and **10,000** with media, "due to maximum email sizes". Truncation always drops the *oldest* messages. Export *without media* for analysis.
- The export can't be re-imported into WhatsApp. It is a plain-text rendering.

### Container tree

```
WhatsApp Chat - Project Falcon.zip        (iOS)
├── _chat.txt
├── 00000012-PHOTO-2025-03-04-10-15-22.jpg
├── 00000013-AUDIO-2025-03-04-10-16-01.opus
└── __MACOSX/…                            (if re-zipped on a Mac — ignore)

WhatsApp Chat with Project Falcon.zip     (Android, with media)
├── WhatsApp Chat with Project Falcon.txt
├── IMG-20250304-WA0003.jpg
└── PTT-20250304-WA0004.opus
```

How to locate the chat file inside a zip (this is the approach of whatsapp-chat-parser-website): first look for `_chat.txt`. Otherwise take the shortest name matching `/.*(?:chat|whatsapp).*\.txt$/i`. Ignore `__MACOSX/`.

---

## 2. Line grammar

A message begins with a **header**: optional invisible marks, timestamp, separator, author, `": "`. Any line that does not start with a header is a **continuation** of the previous message (multi-line text).

```
LINE      := HEADER BODY | CONTINUATION
HEADER    := MARKS? ( "[" DATE ","? " " TIME "]" " "      ← iOS style
                    | DATE ","? " " TIME " - " )          ← Android style
             ( AUTHOR ": " )?                              ← absent = system msg (Android, old iOS)
MARKS     := (U+200E | U+200F | U+FEFF)*
DATE      := d{1,4} SEP d{1,4} SEP d{1,4}  (SEP = "/" | "." | "-", optionally followed by a space)
TIME      := h{1,2} (":"|".") mm ( (":"|".") ss )? ( WS AMPM )?
WS        := " " | U+00A0 (NBSP) | U+202F (NARROW NBSP)
AMPM      := AM | PM | a.m. | p.m. | a. m. | p. m. | (other locale words, see below)
```

### Variants (synthetic examples)

| # | Variant | Example line |
|---|---|---|
| A | iOS, d/m/y, 24h, seconds | `[04/03/25, 14:05:09] Priya Nandakumar: Draft is in the shared folder` |
| B | iOS, m/d/y, 12h, U+202F before AM/PM | `[3/4/25, 2:05:09␣PM] Priya Nandakumar: Draft is in the shared folder` (␣ = U+202F) |
| C | iOS, dotted date (DE/NL/…) | `[04.03.25, 14:05:09] Priya Nandakumar: Draft ist im Ordner` |
| D | Android, d/m/yyyy, 24h | `04/03/2025, 14:05 - Priya Nandakumar: Draft is in the shared folder` |
| E | Android, m/d/yy, 12h (U+202F since ~2023) | `3/4/25, 2:05␣PM - Priya Nandakumar: Draft is in the shared folder` |
| F | Android, Spanish 12h | `04/03/2025, 2:05 p. m. - Priya Nandakumar: Listo` (NBSP between `p.` and `m.` has been seen) |
| G | Year-first (some locales / ISO setting) | `[2025/03/04, 14:05:09] Priya Nandakumar: …` or `2025-03-04, 14:05 - …` |
| H | Finnish | `4.3.2025 klo 14.05 - Priya Nandakumar: …` (dot as time separator, `klo` word) |
| I | Croatian/Serbian style | `4. 3. 2025. 14:05:09 Priya Nandakumar: …` |
| J | Old dash variant | `[04-03-25 14:05:09] Priya Nandakumar: …` |
| K | Media line (iOS, recent) | `‎[04/03/25, 14:06:11] Priya Nandakumar: ‎Image omitted` (U+200E before `[` **and** before body) |
| L | Attachment, iOS + media | `[04/03/25, 14:06:11] Priya Nandakumar: ‎<attached: 00000012-PHOTO-2025-03-04-14-06-11.jpg>` |
| M | Attachment, Android + media | `04/03/2025, 14:06 - Priya Nandakumar: ‎IMG-20250304-WA0003.jpg (file attached)` (localized: `(Datei angehängt)`) |
| N | Media omitted, Android | `04/03/2025, 14:06 - Priya Nandakumar: <Media omitted>` (DE: `<Medien ausgeschlossen>`) |
| O | Multi-line | `[04/03/25, 14:07:30] Marcus Oyelaran: Agenda:` ⏎ `1. budget` ⏎ `2. hiring` |
| P | Edited (iOS 2025) | `[04/03/25, 14:08:00] Marcus Oyelaran: Moved to 3pm ‎<This message was edited.>` |
| Q | Mention | `[04/03/25, 14:09:00] Marcus Oyelaran: @⁨Priya Nandakumar⁩ can you check?` (U+2068 … U+2069 isolates) |
| R | Non-contact sender (iOS) | `[04/03/25, 14:10:00] ~␣Dana: hi all` (`~` + U+202F + WhatsApp push name) |

The 12 format fixtures in whatsapp-chat-parser's tests (all parse to 2018-06-03 13:55 or 2018-06-13 21:25:15):
`3/6/18, 1:55 p.m. - a: m` · `03-06-2018, 01.55 PM - a: m` · `13.06.18 21.25.15: a: m` · `[06.13.18 21:25:15] a: m` · `13.6.2018 klo 21.25.15 - a: m` · `13. 6. 2018. 21:25:15 a: m` · `[3/6/18 1:55:00 p. m.] a: m` · `‎[3/6/18 1:55:00 p. m.] a: m` · `[2018/06/13, 21:25:15] a: m` · `[06/2018/13, 21:25:15] a: m` · `3/6/2018 1:55 p. m. - a: m` · `3/6/18, 1:55 PM - a: m` (narrow NBSP).

### Reference regex (whatsapp-chat-parser v4, MIT, `src/parser.ts`)

```js
const sharedRegex =
  /^(?:‎|‏)*\[?(\d{1,4}[-/.]\s?\d{1,4}[-/.]\s?\d{1,4})[,.]?\s\D*?(\d{1,2}[.:]\d{1,2}(?:[.:]\d{1,2})?)(?:\s([ap]\.?\s?m\.?))?\]?(?:\s-|:)?\s/;
const authorAndMessageRegex = /(.+?):\s([^]*)/;   // author = lazy up to first ": "
const messageRegex = /([^]+)/;                    // system message (no author)
// user msg:   new RegExp(sharedRegex.source + authorAndMessageRegex.source, 'i')
// system msg: new RegExp(sharedRegex.source + messageRegex.source, 'i')
const regexAttachment = /^(?:‎|‏)*(?:<.+:(.+)>|([\w-]+\.\w+)\s[(<].+[)>])/;
```

- `\s` in JS matches U+00A0 and U+202F, so this handles NNBSP. Older versions did not (issue #248).
- The `\D*?` between date and time absorbs words like `klo`.
- Lines are split on `/\r\n|\r|\n/`. A line that matches neither regex is appended to the previous message.
- **Date-order inference** (`daysBeforeMonths`): (1) if any first component is > 12, days come first. If any second component is > 12, months come first. (2) Within one year, a decrease in the first component means it is the day. (3) Otherwise, whichever component changes more often is the day. The year is the longest component, and 2-digit years map to 20xx. Provide a manual override in the UI, because short chats can be ambiguous.
- 12h → 24h: `12` becomes `00`, then add 12 for PM. Normalize `a.m.`/`p. m.` by stripping everything except `apm`.
- WhatsR (R, GESIS) adds German day-period words `morgens|vorm.|mittags|nachm.|abends|nachts` to its AM/PM alternatives. Expect other locales to have equivalents. This is unverified beyond DE.

### Invisible / special characters

| Char | Where it appears | Handling |
|---|---|---|
| U+200E LRM | iOS: before `[` on media/system lines, at start of body for system and "omitted" text, before `<attached:`, before `<This message was edited.>` | Strip from header area. Strip from body for classification but keep it in raw text if you like |
| U+200F RLM | RTL locales | strip like LRM |
| U+202F NNBSP | between time and AM/PM (Android and iOS since ~2023). Also after `~` for non-contact names | treat as whitespace in the header. Keep it in names, or normalize to a space consistently |
| U+00A0 NBSP | inside `p. m.` (Spanish) and similar | whitespace |
| U+FEFF BOM | file start. WhatsR fixtures also show stray BOMs mid-file at line starts | strip anywhere at line start |
| U+2068 / U+2069 | wrap mentioned names: `@⁨Name⁩` | can be used to extract mention edges |
| U+200B–U+200D | occasionally (whatstk strips them) | strip |

Line endings: one contributor reports that iOS uses `\r\n` between messages and bare `\n` inside a message (whatsapp-chat-parser issue #266). Other samples are LF-only. **Do not rely on this.** Use header detection.

---

## 3. Body classification (English strings; all localized)

| Kind | Android (no media) | iOS | Notes |
|---|---|---|---|
| Media omitted | `<Media omitted>`, `<Video message omitted>`, `<Video note omitted>` | `image omitted`, `video omitted`, `audio omitted`, `GIF omitted`, `sticker omitted`, `Contact card omitted`, `<file>.pdf • 3 pages document omitted`. **Capitalized since ~2025** (`Image omitted`, `Sticker omitted`, `Video omitted`) and prefixed by U+200E | match case-insensitively, after stripping LRM |
| Attachment (with media) | `<file> (file attached)` | `<attached: <file>>` | media file names: iOS `00000012-PHOTO-YYYY-MM-DD-HH-MM-SS.jpg`. Android `IMG-YYYYMMDD-WA####.jpg`, `PTT-…opus` (voice), `VID-…mp4`, `DOC-…` |
| Caption | Android: caption text on following line(s) | iOS: caption dropped (issue #267 comment) | community-reported |
| Deleted | `This message was deleted` / `You deleted this message` / `Message deleted` | same with trailing `.` | still an interaction event (sender known), text lost |
| Edited | `<This message was edited>` (Android, reported) | `‎<This message was edited.>` appended to body (verified in 2025 iOS sample) | strip suffix and set `edited=true` |
| Location | `location: https://maps.google.com/?q=LAT,LON` | `Location: https://maps.google.com/?q=…` | |
| Live location | `live location shared` | same | |
| Poll | `POLL:` ⏎ `<question>` ⏎ `OPTION: <text> (<n> votes)` … | same (from whatsapp-chat-parser-website poll parser) | |
| Calls (iOS) | — | `Missed voice call. Tap to call back`, `Voice call. 12 min`, `Video call. No answer` | call events; sender is the caller |
| Disappearing msg | `:.` empty body seen (chat-miner skips `":."`) | empty body | ignore content, keep event |

### System messages

| Event | Android (no author) | iOS ≥ 2024 (author = group name, contact name, or the *affected* person) |
|---|---|---|
| E2E notice | `Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.` (also newer: `…Only people in this chat can read, listen to, or share them. Learn more.`) | `[d] Group Name: ‎Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.` |
| Create | `You created group "X"` / `Alex created group "X"` | `[d] Group Name: ‎You created the group "X".` or `[d] Boris: Boris created group "X"` |
| Add | `You added Priya` / `Alex added Priya` / `Priya, Sam were added` | `[d] Priya: ‎You added Priya.` (**author = the added person**) |
| Remove / leave | `You removed Priya` / `Priya left the group` (WhatsR regex `^(.)*? left the group$`) | iOS form not seen in an opened fixture. Assume `[d] <someone>: ‎Priya left` and match on body |
| Join via link | `Priya joined using this group's invite link` (**wording unverified**, not in any fixture opened) | similar |
| Rename | `You changed the group name from "A" to "B"` | `You changed the group name to "B"` |
| Admin | `You're now an admin` | `[d] Group Name: ‎You're now an admin` |
| Number change | `Priya changed their phone number to a new number. Tap to message or add the new number.` / `+1 555 0100 changed to +1 555 0199` | |
| Security code | `Your security code with Priya changed. Tap to learn more.` | |

**Big pitfall:** on newer iOS exports, system messages look like ordinary authored messages. whatsapp-chat-parser issue #258 shows `[14.08.2024, 21:00:10] My Group Name: ‎Messages and calls are end-to-end encrypted…` and `[…] Boris: Boris created group "My Group Name"`. Detection heuristics:
1. The author equals the chat title (zip/file name minus `WhatsApp Chat - ` / `WhatsApp Chat with `). Also, the author of the first E2E notice is the group/contact name, so record it as `chatTitle`.
2. The body starts with U+200E **and** matches a known system pattern (`You added`, `added`, `left`, `removed`, `changed the group`, `created group`, `end-to-end encrypted`, `security code`, `now an admin`, `joined using`).
3. whatsapp-chat-parser-website forces `author=null` for messages among the first 10 that contain `end-to-end`.
WhatsR ships a CSV of ~50 regex indicators per (language × OS) for EN and DE (`inst/Languages.csv`). That is the best existing catalogue to port.

---

## 4. Mapping to the Org Signal model

| Internal field | Source | Notes |
|---|---|---|
| `conversation_id` | hash of (file name or chat title + first message timestamp) | the export has no ID |
| `conversation_type` | `group` if any group system message appears (`created group`, `added`, `left`, `changed the group`), or > 2 distinct authors. Otherwise `direct` | a 1:1 chat has exactly 2 authors (ego + other). A group with 2 active speakers is still a group. Prefer the system-message evidence |
| `sender` | AUTHOR (after trimming marks; keep a `~ ` prefix flag as `is_saved_contact=false`) | ego appears under their own display name. Ask the user "which of these is you?" (default: the author present in every imported chat) |
| `recipients` | direct: the other author. group: **all members present at that time** minus sender | infer the member set from authors ∪ added/joined names, minus removed/left names after that time. Unknown silent members are invisible |
| `timestamp` | DATE+TIME | **local wall-clock time of the exporting phone, no offset, no seconds on Android**. Store as naive local time plus a user-supplied tz (default: browser tz). Android minute resolution gives many ties, so keep file order as a tiebreak |
| `reply/parent` | not available | quoted replies are not rendered in exports |
| `text` | BODY after stripping edit suffix and LRM | |
| `kind` | message / media / deleted / call / system / poll / location | |
| `mentions` | `@⁨Name⁩` spans | optional directed sub-edges |
| node attrs | `display_name`, `is_phone_number` (`^\+?[\d\s()-]+$`), `is_saved_contact` (no `~`), `first_seen`, `last_seen` | |

**Edge semantics:** a group chat is a broadcast. Model each message as sender → every current member (a **clique / hyperedge**) and down-weight it, e.g. 1/(n−1), so large groups don't dominate. Keep the "shared group membership" tie type separate from the "direct message" tie type.

---

## 5. Observation note (ego view)

- You see only chats **you exported**, one at a time. Messages from before your join date, or older than the 40k/10k cap, are missing.
- Ties among your contacts are invisible except through **co-membership in groups you're in**, and that means co-presence, not interaction. Within a group you do see who speaks when, but not who reads, and replies aren't linked.
- Membership is partial. Members who never post and whose add/join predates the export window never appear.
- Deleted-for-everyone messages leave a stub. Disappearing messages and view-once media leave nothing or an empty body.

## 6. Identity matching

- The author is **whatever the exporting phone displays**: the saved contact name, else the phone number (`+44 7700 900123`), else `~ PushName` (iOS, recent). The same person can appear differently in exports from different people, and even in different chats from the same person if they renamed the contact between exports.
- No phone numbers or IDs appear for saved contacts. Cross-chat merging is name-based. Offer a manual merge UI, and fuzzy-match on case, diacritics and LRM/NNBSP-normalized strings.
- Number-change system messages link an old number to a new one. Use them to merge.
- The ego's own label varies: own display name in message lines, `You` in system lines.

## 7. Auto-detection signature

- `.zip` containing `_chat.txt`, **or** `.txt` whose name starts with `WhatsApp Chat`.
- Content check: ≥ 60% of the first 50 non-empty lines match `sharedRegex`. Bonus signals: the first lines contain `end-to-end encrypted`, `<Media omitted>`, `omitted`, `<attached:`.
- iOS vs Android: lines start with `[` (after LRM/BOM) → iOS. ` - ` after the time → Android. WhatsR counts both regex hits and picks the larger.

## 8. Quirks and size

- UTF-8, possible BOM, emoji everywhere (ZWJ sequences: avoid naive char slicing).
- Names can contain `: ` (rare). The author regex takes up to the **first** `": "`. A message body containing `: ` is fine.
- Message bodies can contain things that look like a datetime on a continuation line. The regex requires the full header shape, so `2016-04-29 10:30:00` alone is not matched.
- Timestamps can go backwards (out-of-order lines are visible in fixtures). Don't assume monotonic order.
- Typical size: 40k messages ≈ 2–5 MB of text. Zips with media can be hundreds of MB, so read only the `.txt` entry.

## 9. Browser feasibility

Fully feasible. Use `JSZip` or `fflate` (to unzip, streaming only the chat entry) plus a port of the regexes above. `whatsapp-chat-parser` ships `dist/index.global.js` and `index.js` (ESM) with no dependencies and can be used directly (MIT). Wrap it with: (a) system-message reclassification for new iOS exports, (b) LRM/BOM cleanup, (c) date-order override, (d) edit/deleted/omitted classification.

## 10. Sources (opened)

| URL | Type |
|---|---|
| https://faq.whatsapp.com/1180414079177245 (content only via search snippet: 10k/40k limits, "due to maximum email sizes") | official (partial) |
| https://github.com/Pustur/whatsapp-chat-parser — `src/parser.ts`, `src/date.ts`, `src/time.ts`, `tests/parser.test.ts`, `CHANGELOG.md` | community, maintained |
| Issues #224, #243, #248, #257, #258, #260, #261, #264, #266, #267 on that repo | community |
| https://github.com/Pustur/whatsapp-chat-parser-website — `src/utils/utils.ts`, `src/utils/poll-parser.ts`, `src/assets/whatsapp-chat-parser-example.zip` | community |
| https://github.com/gesiscss/WhatsR — `inst/english{ios,android}{24h,ampm}.txt`, `inst/german*.txt`, `inst/Languages.csv`, `R/parse_chat.R` | academic (GESIS) |
| https://github.com/JBGruber/rwhatsapp — `ExampleChat.txt` (2025–26 iOS-style sample) | community |
| https://github.com/lucasrodes/whatstk — `whatstk/whatsapp/parser.py`, `assets/header_format_support.json`, `chats/whatsapp/pokemon.txt` | community |
| https://github.com/joweich/chat-miner — `chatminer/chatparsers.py`, `test/whatsapp/*.txt` | community |
| https://chattopdf.app/blog/export-chat-whatsapp, https://www.threadrecap.com/en/blog/anatomy-whatsapp-chat-export | vendor blogs (low weight) |
