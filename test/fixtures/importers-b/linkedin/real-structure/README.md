# LinkedIn export fixtures: real structure, fictional content

Written by `make_fixtures.mjs` (run it to regenerate). Every name, URL, message and date is invented. What is real is the **structure**: file names, header lines, column order, preamble, quoting, line breaks, date formats, delimiters and trailing newlines, as observed in LinkedIn exports from 2020 to 2026. Tests: `test/importers-b/linkedin-real.test.js`.

No personal content was copied. Some public repositories contain people's own exports; from those only shapes were measured (header lines, byte patterns such as `99 Mon 9999`, delimiters, column counts). Their values were never kept.

| Folder | Era | What it reproduces |
|---|---|---|
| `Basic_LinkedInDataExport_05-14-2021/` | 2020 to mid-2021 | `Connections.csv` with **no preamble** and **no URL column** (`First Name,Last Name,Email Address,Company,Position,Connected On`), no newline after the last row. 9-column `messages.csv` (no `RECIPIENT PROFILE URLS`). `TO` joins several names with `", "`. 5-column `Invitations.csv` (no profile URLs). A `LinkedIn Member` sender with an empty URL. |
| `Complete_LinkedInDataExport_09-18-2022/` | mid-2021 to mid-2023 | The 3-line `Notes:` preamble (byte-identical text), still no URL column. Date-only rows `,,,,,07 Jun 2022` for hidden or closed profiles. Names containing `", "` (`Jane Doe, Ph.D.`) inside a comma-joined `TO`. `ARCHIVE` folder. `Endorsement_Received_Info.csv` without the `Endorser Public Url` column. |
| `Basic_LinkedInDataExport_10-21-2023/` | Jul 2023 onward | URL column added to Connections. 10-column messages. 7-column Invitations (`inviterProfileUrl`, `inviteeProfileUrl`). `RECIPIENT PROFILE URLS` comma-joined with no space. `SPAM` folder. A sponsored row (content starting `<p class="spinmail-quill-editor__spin-break">`, empty sender URL, `%FIRSTNAME%` left in, title set). Endorsement URL without a scheme (`www.linkedin.com/in/...`). A header-only `guide_messages.csv`. |
| `Basic_LinkedInDataExport_08-15-2025/` | 2025 | Messages with `ATTACHMENTS` (comma-joined `dms/prv/image` URLs) and `IS MESSAGE DRAFT` but **no** `IS CONVERSATION DRAFT` (12 columns). One `Yes` draft. Header-only `learning_coach_messages.csv`, `learning_role_play_messages.csv`, `coach_messages.csv`. |
| `Complete_LinkedInDataExport_03-09-2026/` | Mar 2026 onward | `messages.csv` with **every field quoted, header included** (`"CONVERSATION ID",...`), empty fields as `""`. Real line breaks inside `CONTENT` (LF and one CRLF). Numbered Complete-only files (`Comments_34875879.csv`), `LearningCoachMessages.csv` containing `No conversations found`, `Notes.csv`, `Articles/Articles/*.html`. A percent-encoded profile slug (`zo%C3%AB-brandt`). |

The older fixture `../Complete_LinkedInDataExport_10-02-2026/` has a 13-column header (ATTACHMENTS plus both draft columns), a union of the observed variants. A Dec 2024 export had `...,FOLDER,IS MESSAGE DRAFT,IS CONVERSATION DRAFT` (12 columns, no ATTACHMENTS); mid-2025 exports had `...,FOLDER,ATTACHMENTS` or `...,FOLDER,ATTACHMENTS,IS MESSAGE DRAFT`.

Common to all eras: UTF-8 without BOM and LF line ends. Files sit at the zip root (the test zips the 2023 folder as `Basic_LinkedInDataExport_10-21-2023.zip`). Dates are `DD Mon YYYY` (Connections, always a two-digit day), `YYYY-MM-DD HH:MM:SS UTC` (messages), `M/D/YY, h:mm AM` with a plain space (Invitations) and `YYYY/MM/DD HH:MM:SS UTC` (Endorsements). `FOLDER` is `INBOX`, `ARCHIVE`, `SPAM` or empty; sent messages are in `INBOX`.

## Sources

Parsers, issues and write-ups (structure documented or hard-coded):

- https://github.com/szabgab/linkedin-csv.rs (`src/lib.rs`): serde structs with `deny_unknown_fields`, the 12-column messages header of a Dec 2024 export, and the preamble skip.
- https://github.com/ssuvorin/theblock (`parse.py`): draft flags, the Notes preamble, `Sent At` formats.
- https://github.com/saberistic-team/agent-web/issues/268: the exact 2026 preamble.
- https://github.com/Sohum-Kapoor/cirql/pull/137: the Notes, disclaimer and blank-line preamble before the header.
- https://jennyqueenofswords.github.io/linkedin-exposed/: date formats per file, and the 12-column messages header.
- https://espirian.co.uk/linkedin-data-archive/: Basic and Complete archive names and sizes.
- https://www.linkedin.com/help/linkedin/answer/a1339364/downloading-your-account-data: the official description of the two archives.

Public repositories holding real exports. Only **structure** was measured (header line, column count, date pattern, delimiter, quoting, BOM, line ends, trailing newline); no values were copied:

- 2020 and 2021 (no preamble, no URL column): rodolfopardo/linkedin-network, DoctorDatah/Linkedin-Network-Analysis, harshitkd/linkedin-analysis.
- 2021 to 2023 (preamble without a URL column, 9-column messages): anuhyabs/SocialMediaTracker, Sajiah/mylinkedindata, ahmedalbabily/Plotly_Dash_Dashboard_Linkedin_Analytics.
- 2023 and 2024 (URL column, 10-column messages, 7-column Invitations): mrityu98/powerBi-LinkedIN_Analytics, sanathchalla/My_Linkedin_analytics_PowerBI_Dashboard, apk0703/linkdin_profile_analysis, AnamAhmed03/linkedin_app, Shreeyashj/SOcial-Media-Parseing.
- 2025 (ATTACHMENTS, draft-column variants): predator-911/Portfolio2, fabioc-aloha/executive-coach, mgjslearn/linklens-app, mylo-james/job-materials-builder, harikiran138/chepuri-hari-kiran-portfolio.
- 2026 (fully quoted messages, multi-line CONTENT, numbered files, Notes.csv): Unigalactix/RESUME-GEN, derricksobrien/nexetra-people-standalone, Eshwarpawanpeddi/Portfolio-website, noahgoo/human-to-human.

Files that had been opened and re-saved in Excel were excluded: a BOM, CRLF only in the header, `4-Apr-21` dates, or dropped columns.
