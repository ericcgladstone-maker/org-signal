# LinkedIn data export ("Download your data")

Status: researched 2026-10-02; **checked against the structure of about 30 real exports from 2020 to 2026 on 2026-10-04** (§10). Confidence: **high** for the headers of every era of `Connections.csv`, `messages.csv`, `Invitations.csv` and `Endorsement_*`, the preamble, the date formats and the multi-recipient delimiters. **Medium** for `Positions`, `Education` and `Profile` columns, and for when exactly the optional draft and attachment columns appear. Nothing here was taken from a real person's content: only header lines and value shapes were measured.

---

## 1. How it's obtained

Me → Settings & Privacy → Data privacy → *Download your data* (also labelled "Get a copy of your data") → choose an option → Request archive. A download link is emailed. Per the official help page, data "will be available for download for 72 hours".

Two options (official wording): "If you select a specific type of data, we'll email you within minutes. If you select the larger download, you'll receive an email within 24 hours."

| | "Fast file" (specific categories / first email) | Full archive ("Download larger data archive…") |
|---|---|---|
| Typical zip name | `Basic_LinkedInDataExport_MM-DD-YYYY.zip` | `Complete_LinkedInDataExport_MM-DD-YYYY.zip` |
| When | minutes (help page lists Profile, Positions, Education, Endorsements, Invitations, Skills… as "within 10 minutes") | ≤ 24 h (help page lists **Connections, Messages**, Contacts, Comments, Reactions… as "within 48 hours") |
| Notes | If the user requests the large archive they get **two emails**: a partial archive first, then the complete one (espirian.co.uk) | Contains everything in Basic plus the slow categories |

> ⚠️ The help page currently places **Connections and Messages in the slow group**, but real Basic archives from 2021 to 2026 contain `Connections.csv`, `messages.csv` and `Invitations.csv` (§10). Treat either zip as valid input and detect by file contents.

### Container tree (full archive, subset relevant to us)

```
Complete_LinkedInDataExport_10-02-2026.zip
├── Connections.csv             ← 1st-degree network (has 3-line "Notes:" preamble)
├── messages.csv                ← all DMs / InMail
├── Invitations.csv             ← connection requests in/out
├── Profile.csv                 ← ego (1 row)
├── Positions.csv               ← ego's jobs
├── Education.csv
├── Endorsement_Received_Info.csv
├── Endorsement_Given_Info.csv
├── Recommendations_Received.csv / Recommendations_Given.csv
├── Skills.csv, Email Addresses.csv, PhoneNumbers.csv, Registration.csv
├── Contacts.csv / ImportedContacts.csv   ← address-book uploads (not LinkedIn ties)
├── Company Follows.csv, Member_Follows.csv
├── Comments.csv, Reactions.csv, Shares.csv, Votes.csv, SearchQueries.csv …
├── Rich_Media.csv, Ad_Targeting.csv, Inferences_about_you.csv, Logins.csv …
├── Jobs/…                       ← subfolder
└── Articles/…                   ← subfolder (long-form posts)
```
File names vary slightly across years (`Company Follows.csv` vs `Company_Follows.csv` have both been reported). Match case-insensitively and ignore spaces and underscores.

---

## 2. Record schemas

### 2.1 `Connections.csv`

The first **3 lines** are a preamble: `Notes:`, one quoted sentence, and a blank line. The header comes after them. Text as captured in szabgab/linkedin-csv.rs:

```csv
Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ines,Okafor-Lindqvist,https://www.linkedin.com/in/ines-okafor-l-3b2a91,,"Northwind Analytics, Inc.",Director of People Ops,08 Feb 2026
Tomás,Reyes,https://www.linkedin.com/in/tomasreyes,tomas.reyes@example.org,Contoso,"Engineer, Platform",14 Nov 2019
```

| Column | Type | Meaning / notes |
|---|---|---|
| First Name / Last Name | string | as the connection set them (may be empty or emoji, or use "Last Name" for credentials, e.g. `Smith, PhD`) |
| URL | string | `https://www.linkedin.com/in/<slug>`. **Best stable key** in the export (the slug can be changed by the user, but rarely is) |
| Email Address | string | usually empty. Present only if the connection allows email export (off by default) |
| Company / Position | string | their **current** headline employer/title at export time, not at connection time |
| Connected On | date | observed `DD Mon YYYY` (`08 Feb 2026`). Parse defensively (also accept ISO and `MM/DD/YYYY`). The English month abbreviation is presumably locale-dependent (unverified) |

**History (verified, §10):** the preamble appeared between mid-2021 and Sep 2022, and its text has been byte-identical since then. The `URL` column was added in mid-2023; before that the header is `First Name,Last Name,Email Address,Company,Position,Connected On`. Rows for members who hid or closed their profile carry only the date (`,,,,,,07 Jun 2026`, from 4 to 181 per file). The file usually has no newline after the last row.

**Robust parsing:** don't hard-skip 3 lines. Scan for the first row whose cells include `First Name` and `Connected On` (several parsers do this). Older exports may lack the preamble, and some tools put the preamble into a `Notes:` column. Use an RFC-4180 CSV parser (quoted commas and newlines occur in Company/Position). Strip a UTF-8 BOM. The official note says CSV "doesn't support all characters", so non-Latin names may be degraded.

### 2.2 `messages.csv`

```csv
CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER,ATTACHMENTS,IS MESSAGE DRAFT,IS CONVERSATION DRAFT
2-YmQ3ZTk4ZjAtZmFrZS1pZA==,,Ines Okafor-Lindqvist,https://www.linkedin.com/in/ines-okafor-l-3b2a91,Jordan Pike,https://www.linkedin.com/in/jordanpike,2025-06-01 14:03:22 UTC,,"Thanks for the intro — free Thursday?",INBOX,,No,No
```

| Column | Type | Meaning / notes |
|---|---|---|
| CONVERSATION ID | string | opaque thread ID (base64-ish). Use it as `conversation_id` |
| CONVERSATION TITLE | string | often empty. Set for named group chats or sponsored messages |
| FROM | string | sender display name |
| SENDER PROFILE URL | string | sender profile URL. **Join key to Connections.URL** |
| TO | string | recipient display name(s) |
| RECIPIENT PROFILE URLS | string | recipient URL(s) |
| DATE | string | `YYYY-MM-DD HH:MM:SS UTC` (confirmed in a script that filters `>= "2023-06-01 00:00:00 UTC"`). **Explicit UTC, the only file here with a clear tz** |
| SUBJECT | string | InMail subject, usually empty |
| CONTENT | string | message body. Can contain HTML fragments and newlines (quoted) |
| FOLDER | string | `INBOX` confirmed. Other values (e.g. sent/archive/spam) **not verified**. Keep the raw value |
| ATTACHMENTS | string | attachment URLs/names (format unverified) |
| IS MESSAGE DRAFT / IS CONVERSATION DRAFT | string | Yes/No-like flag (exact literal unverified). **Drop drafts** |

The header changed often (§10): 9 columns up to early 2023 (no `RECIPIENT PROFILE URLS`), 10 from mid-2023, then `ATTACHMENTS`, `IS MESSAGE DRAFT` and `IS CONVERSATION DRAFT` come and go in 2024–2025. Since Mar 2026 **every field is quoted, the header too**, and `CONTENT` holds real line breaks. Map headers by name (case-insensitive, trimmed, quotes removed), not by position.

Verified values: `FOLDER` is `INBOX`, `ARCHIVE`, `SPAM` or empty, and sent messages are in `INBOX`. Draft flags are `Yes`/`No`. `RECIPIENT PROFILE URLS` and `ATTACHMENTS` are comma-joined with no space. `TO` is joined with `", "`, and names themselves may contain `", "` (`Jane Doe, Ph.D.`). Sponsored messages and InMail campaigns have an empty sender URL and `CONTENT` starting `<p class="spinmail-quill-editor__spin-break">`, often with an unfilled `%FIRSTNAME%`. `LinkedIn Member` senders never have a URL.

### 2.3 `Invitations.csv`

```csv
From,To,Sent At,Message,Direction,inviterProfileUrl,inviteeProfileUrl
Jordan Pike,Ines Okafor-Lindqvist,"1/29/26, 2:37 PM",,OUTGOING,https://www.linkedin.com/in/jordanpike,https://www.linkedin.com/in/ines-okafor-l-3b2a91
```
| Column | Notes |
|---|---|
| From / To | display names |
| Sent At | `M/D/YY, h:mm AM` (US-style, 12h, **no tz**). The space before AM/PM is a plain space in every export checked through Oct 2026 (no U+202F) |
| Message | optional note, mostly empty |
| Direction | `INCOMING` \| `OUTGOING` |
| inviterProfileUrl / inviteeProfileUrl | camelCase headers (sic). **Added in late 2023**; before that the header is `From,To,Sent At,Message,Direction` |

Usefulness: OUTGOING with invitee in Connections means an accepted invite. INCOMING with inviter not in Connections means pending or ignored. Usually only recent or pending invitations are present (community observation).

### 2.4 Ego / attribute files

| File | Columns (as used by ≥ 2 parsers) |
|---|---|
| `Profile.csv` (1 row) | `First Name, Last Name, Maiden Name, Address, Birth Date, Headline, Summary, Industry, Zip Code, Geo Location, Twitter Handles, Websites, Instant Messengers` |
| `Positions.csv` | `Company Name, Title, Description, Location, Started On, Finished On` (dates like `Jan 2024`, empty Finished On = current. Format medium-confidence) |
| `Education.csv` | `School Name, Start Date, End Date, Notes, Degree Name, Activities` (some parsers also read `Field of Study`, `Grade`, unverified) |
| `Endorsement_Received_Info.csv` | `Endorsement Date, Skill Name, Endorser First Name, Endorser Last Name, Endorser Public Url, Endorsement Status` |
| `Endorsement_Given_Info.csv` | `Endorsement Date, Skill Name, Endorsee First Name, Endorsee Last Name, Endorsee Public Url, Endorsement Status` |
| `Recommendations_Received.csv` | `First Name, Last Name, Company, Job Title, Text, Creation Date, Status` |
| `Skills.csv` | `Name` |
| `Contacts.csv` | `Source, FirstName, LastName, Companies, Title, Emails, PhoneNumbers, CreatedAt, Addresses, Sites, InstantMessageHandles, FullName, Birthday, Location, BookmarkedAt, Profiles` |

Endorsement Date is `YYYY/MM/DD HH:MM:SS UTC` (verified). `Endor*er Public Url` has no scheme (`www.linkedin.com/in/<slug>`) and was added in mid-2023; 2022 exports lack it. Endorsement Status is `ACCEPTED`, `PENDING` or `HIDDEN`.

---

## 3. Mapping to the Org Signal model

| Internal | messages.csv | Connections.csv | Invitations / Endorsements |
|---|---|---|---|
| event kind | `message` | `connection` (tie, no timestamped interaction) | `invitation`, `endorsement` (directed weak ties) |
| sender | SENDER PROFILE URL (fallback FROM) | ego | inviter / endorser URL |
| recipients | RECIPIENT PROFILE URLS (fallback TO) | the connection URL | invitee / ego |
| timestamp | DATE (UTC) | Connected On (date only) | Sent At / Endorsement Date |
| conversation_id | CONVERSATION ID | — | — |
| conversation_type | `group` if > 1 distinct recipient URL or > 2 distinct participants across the thread, else `direct` | — | — |
| reply/parent | none (infer by order within the conversation) | — | — |
| text | CONTENT (strip HTML) | — | Message / Skill Name |
| node attrs | name, profile URL | Company, Position, Email, Connected On | Profile/Positions/Education → **ego node only** |

Ego identification: ego = the `Profile.csv` name. Ego's own URL is not in Profile.csv. Take it from Invitations.csv (OUTGOING inviter, INCOMING invitee) when it has URL columns. Otherwise use messages.csv: the URL that sends under the Profile.csv name, or the URL present in nearly every conversation. Before mid-2023 recipients have no URLs, so the owner's URL appears only where they wrote, and the coverage rule alone fails.

## 4. Observation note (ego view)

- `Connections.csv` is a **star**: ego ↔ each 1st-degree connection. Connections between your connections are **not included at all**. Company/Position is a current snapshot.
- `messages.csv` gives directed, timestamped ties for ego's conversations. Group threads expose co-membership among others, which is the only alter-alter signal.
- Sponsored InMail and recruiter messages inflate the INBOX. Consider filtering senders who are not connections or threads with a SUBJECT.
- Email addresses are mostly missing by design.

## 5. Identity matching

- **Use the profile URL slug** (`/in/<slug>`, lowercased, trailing slash and query stripped) as the person key across all files. Names collide and change (marriage, credentials, emoji).
- Some message senders have no URL: deleted accounts and "LinkedIn Member", which can show as an empty name or a generic label. Treat these as distinct unknown nodes per conversation.
- Matching to other sources (email, Slack) is only possible through `Email Address` (rare) or by name plus company. Mark such matches as low-confidence.

## 6. Auto-detection signature

- Zip name `^(Basic|Complete)_LinkedInDataExport_\d{2}-\d{2}-\d{4}\.zip$`, or a zip containing `Connections.csv` / `messages.csv` / `Profile.csv`.
- `Connections.csv`: the first line is `Notes:` **or** a header containing `First Name,Last Name,URL` and `Connected On`.
- `messages.csv`: the header starts with `CONVERSATION ID,CONVERSATION TITLE,FROM`.
- `Invitations.csv`: the header contains `Direction` and `inviterProfileUrl`.

## 7. Quirks and pitfalls

- **Mixed date formats across files**: `08 Feb 2026` (Connections), `2025-06-01 14:03:22 UTC` (messages), `1/29/26, 2:37 PM` (Invitations), `2024/02/01 15:02:55 UTC` (SearchQueries), `2026-02-09 01:21:47` (Shares). Write a per-file parser and never auto-guess.
- **Multiple recipients** (verified): `RECIPIENT PROFILE URLS` is comma-joined with no space. `TO` is joined with `", "`, but names contain `", "` too, so the TO count often differs from the URL count. Split URLs by URL shape. Split TO only into names known elsewhere in the export.
- The preamble breaks naive `header:true` CSV parsing. In PapaParse this produces a `Notes:` column and `__parsed_extra` (one community parser has a workaround for this).
- CONTENT may contain unescaped-looking HTML and very long text. Use a streaming CSV parser.
- Size: Connections usually < 1 MB (hundreds to ~30k rows). messages.csv can reach tens of MB (one reported export had 12,468 rows).

## 8. Browser feasibility

Easy. Use `fflate`/`JSZip` to read entries and **PapaParse** (`header:false`, then locate the header row manually) to parse. Everything is UTF-8 CSV. No tz problems except Invitations and Connections (date-only, or unknown tz).

## 9. Sources (opened)

| URL | Type |
|---|---|
| https://www.linkedin.com/help/linkedin/answer/a1339364/downloading-your-account-data | **official** |
| https://www.linkedin.com/help/linkedin/answer/a566336/export-connections-from-linkedin | **official** |
| https://github.com/szabgab/linkedin-csv.rs — `src/lib.rs` (serde structs with `deny_unknown_fields`, Notes preamble comment, 3-line skip) | community, high value |
| https://github.com/netspective-labs/sql-aide — `lib/fs/linkedin-archive-fs.ts` (file list, Endorsement columns) | community |
| https://github.com/lobu-ai/lobu — `examples/personal-agent/linkedin-takeout.ts` | community |
| https://github.com/juanmanueldaza/linkedin2md — `parsers/{network,professional,profile,content,base}.py` | community |
| https://github.com/vlgrn/LinkedInbox — `src/lib/parseMessages.ts` | community |
| https://github.com/pedrofuentes/kawsay — `electron/main/importers/linkedin-importer.ts` (fixture preamble text looked synthetic and was **not** used) | community |
| https://github.com/abhijayarora93/linkedin-crm-skill — `linkedin-outreach.md` | community |
| https://gist.github.com/guy4261/c55cccaac4c816d287349bfaf4d76e4b (DATE `… UTC`, FOLDER `INBOX`) | community |
| https://jennyqueenofswords.github.io/linkedin-exposed/ (file inventory and date formats from a 2026 export) | community writeup |
| https://espirian.co.uk/linkedin-data-archive/ (Basic_/Complete_ zip names, two emails) | writeup |
| https://ampliflow.in/learn/linkedin-csv-export (claims ISO `Connected On`, which **conflicts** with other evidence and was disregarded) | writeup |
| https://github.com/ssuvorin/theblock (`parse.py`: draft flags, preamble, Sent At formats) | community |
| https://github.com/saberistic-team/agent-web/issues/268 (2026 preamble text) | community |
| https://github.com/Sohum-Kapoor/cirql/pull/137 (preamble description) | community |
| ~30 public repositories with committed exports, structure only (list in `test/fixtures/importers-b/linkedin/real-structure/README.md`) | real exports, shapes only |

## 10. Real structure by era (checked 2026-10-04)

We checked about 30 real exports that people committed to public GitHub repositories (Nov 2021 to Oct 2026, plus three raw 2020–2021 files). Only header lines, column counts, value shapes (`99 Mon 9999`), delimiters, quoting, BOMs, line ends and trailing newlines were measured. No values were kept. Files that had been opened and re-saved in Excel were left out: a BOM, CRLF in the header only, `4-Apr-21` dates, or dropped columns. The fixtures in `test/fixtures/importers-b/linkedin/real-structure/` reproduce each era with fictional content. Their README lists every repository.

| File | Up to mid-2021 | mid-2021 – mid-2023 | mid-2023 – 2025 | 2026 |
|---|---|---|---|---|
| Connections.csv | no preamble; `First Name,Last Name,Email Address,Company,Position,Connected On` | + 3-line `Notes:` preamble | + `URL` after Last Name | same (no trailing newline) |
| messages.csv | 9 columns, ends at `FOLDER` | 9 columns | + `RECIPIENT PROFILE URLS` (10); later + `ATTACHMENTS` / draft columns in varying combinations | 11 columns, **every field quoted**, multi-line `CONTENT` |
| Invitations.csv | `From,To,Sent At,Message,Direction` | same | + `inviterProfileUrl,inviteeProfileUrl` (late 2023) | same |
| Endorsement_*_Info.csv | — | no `Public Url` | + `Endor*er Public Url` (no scheme) | same |

Also observed:
- Zip names `Basic_LinkedInDataExport_MM-DD-YYYY.zip` / `Complete_...`, files at the zip root, UTF-8 without BOM, LF line ends.
- Header-only `guide_messages.csv`, `learning_coach_messages.csv`, `learning_role_play_messages.csv` and `coach_messages.csv`. `LearningCoachMessages.csv` contains `No conversations found`.
- In 2026 Complete archives, numbered names such as `Comments_<n>.csv`.
- `Notes.csv` (2026): `Connection First Name,Connection Last Name,Connection Profile URL,Note,Created On,Edited On`.

What the importer does with this (`src/importers/linkedin.js`):
- Detection accepts every era's header: with or without preamble or URL, with quoted headers, and Invitations without URL columns. A 2026 `messages.csv` dropped alone was previously taken by the edge-list reader.
- Names are joined to profile URLs from every file before anything is keyed. A pre-2023 connection gets the URL its messages, invitations or endorsements give for the same full name (warning `connection-url-by-name`), so one person is one node. Before this fix, one person could appear as up to four nodes and the owner was never identified.
- The owner's URL is accepted when it sends under the Profile.csv name, even in few conversations.
- `TO` without URLs is split into known names, keeping `", Ph.D."`-style suffixes with their name.
- Date-only rows for hidden profiles are counted (`hidden-connections`), not turned into people.
- `SPAM` folder messages are left out by default (`spam-excluded`, with an option to keep them).
- Campaign-editor (spinmail) messages from non-connections are flagged `possible-sponsored`.
- CRLF inside `CONTENT` becomes LF.

Still unverified without a real export in hand: non-English month names in `Connected On`, `IS CONVERSATION DRAFT` values (never seen as `Yes`), exports before 2020, and the UTF-16, tab-separated `Endorsement Received Info.csv` seen once in 2022 (possibly an Excel re-save).
