# Input format specs

One spec per source family, researched 2026-10-02 from official docs, exporter source code and parser test fixtures. Anything not confirmed is marked **UNVERIFIED** inside each file. Importers and the synthetic generator's native-format writers are built against these.

| Spec | Formats | View | Confidence | Main caveats |
|---|---|---|---|---|
| [slack.md](slack.md) | Standard, Business+, Enterprise Grid exports | Full group (admin) | High; Grid medium | Channel type comes from `channels/groups/dms/mpims.json` membership, not folder name or ID prefix; user IDs `U…` or `W…`; use `ts`, not file dates |
| [teams.md](teams.md) | Graph `chatMessage` JSON, Teams Free export, Purview | Full or one person | Graph high; others medium to low | No per-chat export for work accounts; Purview CSV gives participants only |
| [email.md](email.md) | mbox, Gmail Takeout, .eml, Outlook PST | One person | High; PST medium | Takeout label header is `X-Gmail-Labels`; thread ids exceed JS numbers; PST browser reader is alpha |
| [calendar.md](calendar.md) | .ics (Google, Outlook) | One person | High; Outlook low | Recurrence expansion needs `ical.js` plus a time zone database |
| [x-archive.md](x-archive.md) | X personal archive | One person | High | Follows are bare ids; likes undated; retweets only via `RT @` |
| [x-research-datasets.md](x-research-datasets.md) | API v1.1, v2, twarc JSONL/CSV | Sample | High | ID-only datasets cannot be rehydrated in the browser |
| [bluesky.md](bluesky.md) | Repository CAR export, public repo fetch | One account (several fetchable) | High | Repo holds only what the account wrote; no followers |
| [mastodon.md](mastodon.md) | Account archive, CSV exports | One person | High (Mastodon only) | No followers export; other fediverse servers differ |
| [threads.md](threads.md) | Threads data in Instagram export | One person | Medium | No reply parent; Meta text encoding bug |
| [linkedin.md](linkedin.md) | Basic and Complete archives | One person | High core; medium rest | 3-line preamble in Connections.csv; date formats differ per file |
| [whatsapp.md](whatsapp.md) | Chat .txt (iOS, Android, locales) | One chat | High grammar; medium wording | Locale variants; iOS system messages look like user messages |
| [imessage.md](imessage.md) | macOS `chat.db`, imessage-exporter TXT | One person | High schema | Must copy with `.backup`; ~1–2 GB practical limit; no names |
| [telegram.md](telegram.md) | Desktop export `result.json` | One person | High | Use `date_unixtime` and `text_entities`; large files need streaming |
| [meta-messenger-instagram.md](meta-messenger-instagram.md) | Messenger, Instagram DMs, E2EE backup | One person | High core; medium layout | Folder layout varies by year; names only, no ids; text encoding bug |
| [discord.md](discord.md) | Official data package, DiscordChatExporter | One person / one channel | Medium / high | Package holds only your messages; snowflake ids exceed JS numbers |
| [reddit.md](reddit.md) | GDPR export CSVs, Pushshift / Arctic Shift NDJSON | One person / sample | Medium / high | zstd long-window dumps must be decompressed outside the browser |
| [network-files.md](network-files.md) | GraphML, GEXF, GML, Pajek, UCINET DL, Gephi CSV | As authored | High | Export to the GEXF 1.2 subset for networkx compatibility |
| [network-canvas-and-surveys.md](network-canvas-and-surveys.md) | Network Canvas CSV/GraphML, egor, Qualtrics, Google Forms | Ego networks or roster | High; some survey tools lower | Real column names differ from Network Canvas's own docs page |

## Cross-cutting rules for importers

- **Large ids stay strings.** X, Discord, Gmail thread and Telegram ids exceed `Number.MAX_SAFE_INTEGER`.
- **Timestamps:** prefer an explicit UTC epoch field; when only local time exists (WhatsApp, some exporters), record that the time zone is unknown and let the user set it.
- **Meta text encoding fix** applies to Messenger, Instagram and Threads.
- **Every import records its view type** (full group, one person, one chat, sample) so measures can be checked for applicability.
- **Stream anything that can be large** (Slack, mbox, Telegram, X archives, NDJSON) inside a Web Worker.
- **Remaining gaps** are best closed with a few real, anonymized sample exports.
