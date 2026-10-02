# LinkedIn data export ("Download your data")

Status: researched 2026-10-02. Confidence: **high** for the column headers of `Connections.csv`, `messages.csv` and `Invitations.csv` and for the 3-line preamble (from a Rust crate that deserializes real exports with `deny_unknown_fields`, corroborated by 3+ other parsers). **Medium** for `Positions`, `Education`, `Profile` and `Endorsement_*` columns (several community parsers agree). **Low/unverified** for some date formats and for multi-recipient delimiters in `messages.csv` (see §7).

---

## 1. How it's obtained

Me → Settings & Privacy → Data privacy → *Download your data* (also labelled "Get a copy of your data") → choose an option → Request archive. A download link is emailed. Per the official help page, data "will be available for download for 72 hours".

Two options (official wording): "If you select a specific type of data, we'll email you within minutes. If you select the larger download, you'll receive an email within 24 hours."

| | "Fast file" (specific categories / first email) | Full archive ("Download larger data archive…") |
|---|---|---|
| Typical zip name | `Basic_LinkedInDataExport_MM-DD-YYYY.zip` | `Complete_LinkedInDataExport_MM-DD-YYYY.zip` |
| When | minutes (help page lists Profile, Positions, Education, Endorsements, Invitations, Skills… as "within 10 minutes") | ≤ 24 h (help page lists **Connections, Messages**, Contacts, Comments, Reactions… as "within 48 hours") |
| Notes | If the user requests the large archive they get **two emails**: a partial archive first, then the complete one (espirian.co.uk) | Contains everything in Basic plus the slow categories |

> ⚠️ The help page currently places **Connections and Messages in the slow group**, but many users report getting `Connections.csv` and `messages.csv` quickly by selecting them individually. Treat either zip as valid input and detect by file contents.

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

Older exports may lack the last 3–4 columns, and very old ones lack `RECIPIENT PROFILE URLS`. Map headers by name (case-insensitive, trimmed), not by position.

### 2.3 `Invitations.csv`

```csv
From,To,Sent At,Message,Direction,inviterProfileUrl,inviteeProfileUrl
Jordan Pike,Ines Okafor-Lindqvist,"1/29/26, 2:37 PM",,OUTGOING,https://www.linkedin.com/in/jordanpike,https://www.linkedin.com/in/ines-okafor-l-3b2a91
```
| Column | Notes |
|---|---|
| From / To | display names |
| Sent At | `M/D/YY, h:mm AM` (US-style, 12h, **no tz**; assume UTC or local, unverified) |
| Message | optional note, mostly empty |
| Direction | `INCOMING` \| `OUTGOING` |
| inviterProfileUrl / inviteeProfileUrl | camelCase headers (sic) |

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

Endorsement Date format: not verified (one source suggests `YYYY/MM/DD HH:MM:SS UTC`, the same style as `SearchQueries.csv`).

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

Ego identification: ego = the `Profile.csv` name. Ego's own URL usually does not appear in Profile.csv, so infer it as the URL that occurs as sender or recipient in nearly every conversation in messages.csv.

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
- **Multiple recipients**: the delimiter inside `TO` / `RECIPIENT PROFILE URLS` is **unverified** (likely comma-separated inside a quoted cell). Split URLs with a regex on `https://www.linkedin.com/in/[^,\s]+` rather than on a delimiter.
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
