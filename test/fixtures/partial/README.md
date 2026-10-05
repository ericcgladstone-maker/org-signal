# Incomplete and wrong uploads: fixtures

Written by `make_fixtures.mjs` (run `node test/fixtures/partial/make_fixtures.mjs [case ...]` to regenerate). Content is fictional; structure follows the real exports, mostly by reusing the per-importer fixtures in `../importers-a` and `../importers-b` and cutting them the way real uploads arrive. Each case folder holds what a person would drop on the Data view. Tests: `test/importers-partial/*.test.js`, through the real pipeline. The standard every case is held to is in `docs/CONTRACTS.md`, "Incomplete and wrong uploads".

| Case | Files | What it reproduces | Real-world source |
|---|---|---|---|
| `takeout-split` | `takeout-20261004T101500Z-001.zip` (Mail), `-002.zip` (Calendar) | Google Takeout's numbered parts; each part has its own `archive_browser.html` | Takeout splits an export at the chosen size into `takeout-<timestamp>-NNN.zip`; docs/formats/email.md, calendar.md |
| `linkedin-parts` | `Basic_LinkedInDataExport_10-04-2026.zip`, `Complete_LinkedInDataExport_10-05-2026.zip` | The two emails of one requested export: profile files first, everything (profile files again) a day later | Seen in a real export, 2026-10-04; docs/formats/linkedin.md ("two emails") |
| `x-parts` | `twitter-2026-10-04-5e1c0a-part1.zip`, `-part2.zip` | A large X archive delivered as two zips; both carry `manifest.js` with `isPartialArchive: true`, the data files are spread over them | docs/formats/x-archive.md (`isPartialArchive`, `maxPartSizeBytes`; multi-zip naming unverified) |
| `meta-parts` | `facebook-adaexample-2026-10-04-Ab12Cd.zip`, `-Ef34Gh.zip` | One Facebook export in two zips; a long thread cut across them (`message_1.json` in one, `message_2.json` in the other) | docs/formats/meta-messenger-instagram.md 1a (part 1..n, contents merge into one tree) |
| `slack-split` | `Acme Slack export Mar 4 2024 - part 1.zip`, `- part 2.zip` | An export split by hand to get under an upload limit: metadata and #general in one, the other channels in the other | Common practice; Slack itself delivers one zip |
| `discord-package` | `package.zip`, `package-no-messages.zip` | The whole data package, and one without `Messages/` | docs/formats/discord.md (a); packages can be requested without messages |
| `meta-html` | Facebook and Instagram zips with `message_1.html` | Export made with Format: HTML (Meta's default) | docs/formats/meta-messenger-instagram.md ("users often pick HTML by mistake") |
| `meta-mixed` | a JSON Facebook zip and an older HTML one | Two exports of one account in different formats | As above |
| `telegram-html` | `ChatExport_2026-10-04/` (messages.html, messages2.html, css, js, images) and `DataExport_2026-10-04/` (export_results.html, lists/, chats/) | Telegram Desktop's HTML export, single chat and full | docs/formats/telegram.md (HTML is the exporter's other format; `lists/` only in HTML mode) |
| `whatsapp-variants` | iOS zip with media, Android `.txt` without media, three per-chat zips | "Attach Media" / "Without media", and one zip per exported chat | docs/formats/whatsapp.md |
| `imessage-no-attachments` | `chat.db` alone | The database copied from ~/Library/Messages without `Attachments/` | docs/formats/imessage.md |
| `slack-free` | zip with `users.json`, `channels.json`, #general, #random | The standard export (public channels only) of Free and Pro plans | docs/formats/slack.md section 1 |
| `teams-partial` | `graph-chats-only/chats.json`; `purview-summary-only/.../Summary_<ts>.csv` | A Graph dump without its messages folder; an eDiscovery process report without `Items.csv` | docs/formats/teams.md (Graph dumps, Purview export) |
| `calendar-csv` | `Calendar.CSV` | Outlook (classic) Export to a file > CSV of a calendar folder: attendees by display name only | Outlook's CSV export columns |
| `email-variants` | `mbox/Inbox.mbox`; unzipped `Takeout/` | A bare mbox and the Takeout folder after unzipping | docs/formats/email.md |
| `network-variants` | `hyperedges.graphml`, `two-networks.paj` / `.net`, `dynamic-spells.gexf` | GraphML hyperedges; a Pajek project with two `*Network` sections; GEXF 1.3 dynamic spells | docs/formats/network-files.md |
| `x-missing` | X zips without tweets, without DMs, with account files only | Archives trimmed before upload, or one part of several | docs/formats/x-archive.md |
| `slack-no-users` | zip without `users.json`; zip with channel folders only | Files picked out of an export | docs/formats/slack.md section 2 |
| `instagram-no-inbox` | Instagram zip with followers and personal information only | An export requested without Messages | docs/formats/meta-messenger-instagram.md 1a |
| `nc-no-edges` | `networkCanvasExport/` with ego and attribute list only | A Network Canvas CSV export without edge lists | docs/formats/network-canvas-and-surveys.md |
| `empty` | 0-byte `result.json`, `messages.csv`, `empty.zip`, WhatsApp `.txt`; header-only edge list and LinkedIn `Connections.csv`; a calendar with no events | Downloads that never finished, exports with nothing in them | |
| `damaged` | `truncated/` (zip cut at 60%), `renamed/` (`.zip.zip`, `(1).zip`, `.zip (1)`), `crdownload/` (cut at 40%), `not-a-zip/` (a sign-in page saved as `.zip`), `tgz/` (Takeout as .tgz), `encrypted/` (entries flagged password-protected) | What browsers and download pages do to files | Browser behaviour; Takeout's "File type: .tgz"; password-protected eDiscovery packages |
| `junk-folder` | `Acme Slack export/` plus a photo, a PDF, a .docx and `.DS_Store` | An export folder people keep other files in | |
| `zip-and-folder` | the zip beside the folder of the same name (`same/`), and with a stray PDF added (`extra/`) | Double-clicking a zip on a Mac unzips it next to itself; both get dropped | macOS Archive Utility |
| `two-platforms` | a Slack zip and a WhatsApp `.txt` | Two different platforms in one drop | |
| `duplicate` | `Acme Slack export.zip` and `(1).zip`; a WhatsApp `.txt` and its `(1)` copy | The same download made twice | Browser naming of repeated downloads |
| `encodings` | `edges-utf16.txt` (Excel "Unicode Text": UTF-16LE, BOM, tabs, CRLF), `edges-bom-crlf.csv` (Excel "CSV UTF-8"), a WhatsApp chat with BOM and CRLF | Files saved through Excel or Windows | |
| `pst` | `archive.pst` | An Outlook data file | docs/formats/email.md |

The encrypted fixture sets the zip "encrypted" flag on every entry without real ciphertext: the app never decrypts, it only has to recognise the flag.
