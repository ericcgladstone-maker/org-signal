# Email formats: mbox, Gmail Takeout, .eml, Outlook PST/OST

Status: researched 2026-10-02. Confidence: **high** for RFC 5322/2047/4155 semantics and mbox variants. **High** for Takeout paths and the `X-Gmail-Labels`/`X-GM-THRID` headers (several independent parsers agree). **Medium** for PST-in-browser (a library exists, but it's alpha).

---

## 1. How it's obtained

| Source | Who | Output |
|---|---|---|
| **Gmail via Google Takeout** (takeout.google.com → Mail) | the account owner (Workspace admins can disable Takeout) | zip or tgz, split into parts (`takeout-<YYYYMMDDThhmmssZ>-001.zip`, `-002.zip`…) **[UNVERIFIED exact part naming]**, containing mbox |
| Thunderbird (local folders, or ImportExportTools NG) | the user | mbox files (no extension, e.g. `Inbox`, `Sent`) or exported `.mbox`/`.eml` |
| Apple Mail "Export Mailbox" | the user | `Name.mbox/` **directory** holding an `mbox` file (+ `Info.plist`) **[UNVERIFIED layout]** |
| Any client "Save as" / drag-out | the user | single `.eml` (RFC 5322 message) |
| Outlook desktop (Windows) File → Open & Export → Export to .pst | the user | `.pst` (Unicode PST, often GBs) |
| Outlook OST | local cache, can't be "exported" | `.ost`, tied to the profile |
| Purview eDiscovery | compliance admin | PST or `.msg` per item (see teams.md §C) |

An email export is an **ego view**: only messages that reached or left this mailbox. Bcc is visible only on the sender's copy.

## 2. Container / file tree

### Google Takeout (Mail)
```
takeout-…-001.zip
└── Takeout/
    ├── archive_browser.html
    └── Mail/
        ├── All mail Including Spam and Trash.mbox   # default: everything, once per message
        └── <Label>.mbox                              # only if the user picked specific labels
```
Casing differs between sources (`All mail …` vs `All Mail …`). Match case-insensitively on `*.mbox` under `Takeout/Mail/`. Folder names may be localized for non-English accounts **[UNVERIFIED for folder names. Label values inside headers *are* localized]**. Takeout may also include `Takeout/Calendar/*.ics` (see calendar.md).

### mbox (any producer)
```
<file>.mbox  (or no extension)
From <envelope-sender> <asctime-date>\n      <- separator ("From_ line")
<RFC 5322 headers>\n
\n
<body, with ">From " escaping>\n
\n
From <envelope-sender> <date>\n
…
```

### .eml
A single RFC 5322 message: headers, blank line, body. CRLF or LF.

### PST/OST
Binary MS-PST (NDB/LTP/Messaging layers). It's a folder tree (`Top of Outlook data file/Inbox/…`). Items have MAPI properties. There is no zip container.

## 3. Record schemas

### mbox From_ line and variants

RFC 4155: `From` + space + sender address + space + UTC timestamp in asctime form. LF line endings. It **does not prescribe** escaping. Variants:

| Variant | Body lines matching | Written as | Reversible | Typical producers |
|---|---|---|---|---|
| mboxo | `^From ` | `>From ` | **no** (`>From` stays `>From`) | Python `mailbox.mbox`, old Unix |
| mboxrd | `^>*From ` | add one `>` | yes (strip one `>`) | Thunderbird (variant rules), many modern tools |
| mboxcl | as mboxrd + `Content-Length:` | | yes | Solaris/SysV |
| mboxcl2 | no quoting, relies on `Content-Length:` | | yes | |

Producers can't be told apart reliably. Recommended rule: **split only on `\nFrom ` lines that follow a blank line (or BOF) and look like `^From \S+ +\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d`**, and ignore `Content-Length`. For network building, unescaping `>From` in bodies doesn't matter.

Gmail Takeout From_ line (observed in parsers and test fixtures, not documented by Google):
```
From 1790123456789012345@xxx Mon Mar 04 11:20:34 +0000 2024
```
Field 2 = Gmail message ID in decimal + `@xxx`. Date carries a numeric zone (`+0000`) before the year, which differs from classic asctime. Whether Takeout uses mboxo or mboxrd quoting is **[UNVERIFIED]**.

### Headers relevant to networks (RFC 5322 unless noted)

| Header | Cardinality | Meaning / use |
|---|---|---|
| `From` | 1 (may list several mailboxes, in which case `Sender` is required) | author(s): edge source |
| `Sender` | 0–1 | actual submitter (assistants, lists) |
| `Reply-To` | 0–1 | |
| `To`, `Cc` | 0–1 each, address-list | visible recipients: edge targets |
| `Bcc` | 0–1 | blind recipients: typically present only in the **sender's** stored copy. Often stripped. |
| `Date` | 1 | origination time, with local offset |
| `Message-ID` | 0–1 (SHOULD) | unique ID `<…@…>` |
| `In-Reply-To` | 0–1 | parent's Message-ID(s) |
| `References` | 0–1 | parent's References + parent's Message-ID (ancestor chain) |
| `Subject` | 0–1 | fallback threading (strip `Re:`/`Fwd:`/`AW:`/`SV:`…) |
| `Delivered-To` | 0–n (non-standard, MTA-added) | the mailbox owner's address(es) for this copy, so it identifies the ego and alias addresses |
| `List-Id` (RFC 2919) | 0–1 | mailing list: treat To = list, not people |
| `List-Post`, `List-Unsubscribe`, `Precedence: bulk/list`, `Auto-Submitted` (RFC 3834) | | bulk/automated filters |
| `Received` | n | hop chain, server-side times. Ignore for edges. |
| `X-Gmail-Labels` (Takeout) | 0–1 | comma-separated labels, e.g. `Inbox,Important,Opened,Category Updates,Work/Clients`. **Localized** system labels (`Ouverts`, `Archivés`…). Labels themselves may be RFC 2047-encoded. |
| `X-GM-THRID` (Takeout) | 0–1 | Gmail thread ID in **decimal** (the web UI uses hex) |
| `Content-Type` | | `multipart/*` with `boundary`, `charset` |

Address syntax: `"Display Name" <local@domain>`, bare `local@domain`, groups `Team: a@x, b@x;`, and obsolete forms (`local@domain (Comment Name)`, route addrs). Use a real address-list parser, not a split on `,` (display names contain commas).

### Synthetic message (Takeout style)

```
From 1790123456789012345@xxx Mon Mar 04 11:20:34 +0000 2024
X-GM-THRID: 1790120000000000001
X-Gmail-Labels: Sent,Opened,Projects/Apollo
Delivered-To: ana.ruiz@example.org
MIME-Version: 1.0
Date: Mon, 4 Mar 2024 12:20:34 +0100
From: Ana Ruiz <ana.ruiz@example.org>
To: "Okafor, Ben" <ben.okafor@example.org>, chen.li@example.org
Cc: =?UTF-8?Q?Jos=C3=A9_P=C3=A9rez?= <jose.perez@example.com>
Subject: Re: Apollo draft
Message-ID: <CAF1x+abc123@mail.example.org>
In-Reply-To: <CAF1x+zzz999@mail.example.org>
References: <CAF1x+root000@mail.example.org> <CAF1x+zzz999@mail.example.org>
Content-Type: multipart/alternative; boundary="b1"

--b1
Content-Type: text/plain; charset="UTF-8"

Looks good, merging.
>From now on, use the new template.
--b1--
```

## 4. Mapping to the internal model

| Internal | Source |
|---|---|
| sender | `From` (first mailbox). Normalize: lowercase the domain, trim, maybe lowercase local part (practically safe). Keep the display name as an attribute. |
| recipients | `To` ∪ `Cc` ∪ `Bcc`, with role tags (`to`/`cc`/`bcc`). Expand groups. Drop the sender if self-addressed (keep a flag). |
| timestamp | `Date` → UTC epoch. Keep the original offset as an attribute (sender's local hour). Fallbacks: the From_ line date, then the first `Received` date. |
| conversation id | Takeout: `X-GM-THRID`. Otherwise the root of `References` (first ID), else `In-Reply-To`, else `Message-ID`. Optional JWZ threading. |
| context type | `List-Id` present → `group` (mailing list, visible to members). Exactly 1 recipient → `direct`. More than 1 → `group`. All email is "private" visibility. |
| thread / parent | `In-Reply-To` (first ID), else the last ID of `References` |
| text | `text/plain` part, else HTML→text. Strip quoted replies (`^>` lines, "On … wrote:") for content analysis. |
| node attributes | display names (most frequent), domain (internal vs external), `is_ego` (address in `Delivered-To` or `From` of messages labeled `Sent`), `is_list` |

## 5. Edge construction notes

- Directed sender → each recipient (weight by role: To > Cc > Bcc). This is the standard email network.
- Reply edges: when the parent is present, replier → parent's sender. That's a stronger tie than plain sending.
- Co-recipient ties (optional, projected): recipients of the same message. These explode with large lists, so cap or down-weight by 1/(n−1).
- Mailing lists: if `List-Id` is present, model sender → list node. Don't fan out to `To`, which is the list address.
- Filter: `Auto-Submitted` ≠ `no`, `Precedence: bulk|list|junk`, `noreply@`-style senders, and Gmail labels Spam/Trash (from `X-Gmail-Labels`) unless the user opts in.
- Deduplicate by `Message-ID` (Takeout's "All mail" has each message once, but merged sources or per-label mboxes overlap). Messages without a Message-ID: hash (From, Date, Subject).
- Alias merging: one person, many addresses. Offer a merge UI, seeded by display-name equality and `Delivered-To` aliases.
- Not recoverable: Bcc on received copies, forwards outside the mailbox, read status (Takeout labels `Opened`/`Unread` are mailbox state, not recipient behaviour).

## 6. Auto-detection signature

| Format | Signature |
|---|---|
| Takeout | zip with entries `Takeout/Mail/*.mbox` (case-insensitive). Possibly multiple zip parts. |
| mbox | first bytes `From ` (0x46 0x72 0x6F 0x6D 0x20), then a header line `^[A-Za-z0-9-]+:` within the next ~1 KB. Extension `.mbox`/`.mbx`/none. Gmail: `X-GM-THRID:` among the first headers. |
| .eml | first non-blank line is a header (`^[!-9;-~]+:\s`). Typical headers present (`Received:`, `From:`, `Date:`, `Message-ID:`, `MIME-Version:`). No `From ` line. |
| PST/OST | magic `!BDN` (0x21 0x42 0x44 0x4E) at offset 0. Next, client magic `SM` = PST, `SO` = OST **[from MS-PST spec: wVer/wMagicClient. Not re-verified here]**. |
| .msg | OLE2 compound file magic `D0 CF 11 E0 A1 B1 1A E1` |

## 7. Pitfalls

- **Encoded words (RFC 2047):** `=?charset?B|Q?…?=` in `From`/`To`/`Subject` display names. Q-encoding uses `_` for space. Adjacent encoded words separated only by whitespace concatenate without the space. Each encoded word is at most 75 characters. Encoded words are not allowed inside an addr-spec or a quoted-string, but real-world mail violates this (e.g. quoted `"=?UTF-8?…?="` display names), so decode leniently. Charsets seen in the wild include `iso-8859-1`, `windows-1252`, `gb2312`, `ks_c_5601-1987`, so `TextDecoder` (WHATWG labels) covers most. Unknown charset: fall back to latin1.
- **Raw 8-bit headers** (non-RFC but common): try UTF-8 then windows-1252.
- **Header folding:** unfold by removing CRLF before WSP. Header names are case-insensitive. Duplicates exist (take the first for single-valued fields).
- **Dates:** RFC 5322 `[Day, ]DD Mon YYYY HH:MM[:SS] ±HHMM`. Obsolete forms in the wild: 2-digit years (00–49→20xx, 50–99→19xx), named zones (`GMT`, `UT`, `EST`/`EDT`, `CST`/`CDT`, `MST`/`MDT`, `PST`/`PDT`), military letters (treat as `-0000` per RFC), `-0000` = unknown zone, missing seconds, extra comments `(PDT)`, localized day names, and garbage. `Date.parse` is implementation-defined, so write an explicit parser. Sanity-bound dates (e.g. 1990 to now+1 day), else use Received/From_ line.
- **Multipart:** `multipart/mixed|alternative|related|signed`, nested `message/rfc822` (forwards, bounces, whose inner headers are *not* this message's). Use a hardened MIME parser with nesting limits.
- **Line endings:** mbox should be LF but CRLF files exist. Handle both.
- **Takeout specifics:** labels are comma-separated and localized. A label containing a comma gets quoted **[UNVERIFIED]**. `X-GM-THRID` is decimal (handle it as a string, since it's beyond 2^53). Chats ("Chats" label) may appear as pseudo-messages **[UNVERIFIED in current Takeout]**. Sent messages typically keep `Bcc` **[UNVERIFIED]**.
- **Size:** Takeout mboxes run 1–50+ GB. Parts split near the user-chosen size (2/10/50 GB). Thunderbird folders are often 1–10 GB.

## 8. Browser feasibility

- **mbox / Takeout: feasible with streaming.** Read `File.stream()` (or zip.js entry streams for Takeout zips, with ZIP64 support) as bytes. Scan for `\n\nFrom ` boundaries with a carry-over buffer. Hand each message's headers (body can be skipped or truncated for network-only mode) to a parser in a Web Worker. For headers-only mode, stop at the first blank line and skip the body: about 10× faster, low memory.
- MIME parser: **`postal-mime`** (v4, browser/Web Worker, TypeScript, nesting limits). It exposes `from`, `sender`, `to`, `cc`, `bcc`, `replyTo`, `deliveredTo`, `returnPath`, `subject`, `messageId`, `inReplyTo`, `references`, `date` (ISO, else original string), `headers[]` (raw, *not* RFC 2047-decoded), `text`, `html`, `attachments`. It also exports `addressParser` and `decodeWords` for headers-only mode.
- **PST/OST:**
  - `pst-extractor` (npm 1.12.0, Jan 2026, port of java-libpst). Node-centric: `fs.openSync`, or a whole-file `Buffer`. In a browser it would need a Buffer polyfill and the **entire file in memory**, which isn't viable for multi-GB PSTs.
  - **`@hiraokahypertools/pst-extractor`** (fork, 0.5.0-alpha.2, Mar 2026) has an explicit **browser API**: `openPst({readFile(buffer, offset, length, position), close})` backed by `File.slice()`, so it does random access without loading the whole file. It claims `.PST (.OST)` support. **Feasible but alpha.** Needs evaluation on real Unicode PSTs and on OST 2013+ (4K pages/compression, support unknown).
  - Fields available per message (pst-extractor getters): `senderName`, `senderEmailAddress`, `displayTo`, `displayCc`, `displayBcc`, recipients table (`numberOfRecipients`), `clientSubmitTime`, `messageDeliveryTime`, `internetMessageId`, `inReplyToId`, `conversationTopic`, `transportMessageHeaders` (raw RFC 5322 headers, often the best source), `messageClass` (`IPM.Note`, `IPM.Schedule.Meeting.*`, `IPM.SkypeTeams.Message`…).
  - Exchange-internal senders may appear as `EX` address type (`/o=ExchangeLabs/ou=…/cn=…`) instead of SMTP. Prefer `PR_SENDER_SMTP_ADDRESS`, or parse `transportMessageHeaders` **[UNVERIFIED which getters expose the SMTP form]**.
  - Recommendation: v2 supports mbox/eml/Takeout. PST is experimental behind a flag. Advise users to convert PST→mbox elsewhere if it fails.

## 9. Sources

| URL | Type |
|---|---|
| https://www.rfc-editor.org/rfc/rfc5322.html | official (IETF) |
| https://www.rfc-editor.org/rfc/rfc4155.html | official (IETF) |
| https://www.rfc-editor.org/rfc/rfc2047.html | official (IETF) |
| https://docs.python.org/3/library/mailbox.html | official (Python docs: mboxo behaviour) |
| https://en.wikipedia.org/wiki/Mbox | reputable reference (variants) |
| https://github.com/rustmailer/bichon `crates/cli/src/mbox/gmail.rs` | community (localized Takeout labels, RFC 2047 labels) |
| https://github.com/suitenumerique/messages `docs/mbox.md` | community (X-Gmail-Labels, mboxrd, Mozilla status headers) |
| https://github.com/timelinize/timelinize `datasources/email/email.go` | community (From_ line parsing, X-Gmail-Labels split on `,`) |
| https://github.com/stalwartlabs/vandelay `tests/sync_takeout.rs` | community (Takeout/Mail and Takeout/Calendar paths, From_ line format) |
| https://www.metaspike.com/gmail-forensic-preservation-overlapping-labels/ | reputable forensics vendor |
| WebSearch snippets (xerj.org, others) re: X-GM-THRID decimal vs hex | community, snippet only |
| https://github.com/epfromer/pst-extractor (README, `src/PSTFile.class.ts`, `src/PSTMessage.class.ts`), npm registry metadata | community |
| https://github.com/HiraokaHyperTools/pst-extractor README, npm metadata | community |
| https://github.com/postalsys/postal-mime README, npm metadata | community (well-maintained) |
| https://github.com/gildas-lormeau/zip.js README | community |

Not opened (cited from knowledge, so verify before relying on them): RFC 2919 (List-Id), RFC 3834 (Auto-Submitted), and the MS-PST spec header magic values.
