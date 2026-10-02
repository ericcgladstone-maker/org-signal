# Calendar formats: iCalendar (.ics), Google Calendar, Outlook

Status: researched 2026-10-02. Confidence: **high** for RFC 5545 structure, attendee parameters and Google export mechanics. **Medium** for Takeout paths (consistent across open-source test fixtures). **Low/unverified** for Outlook-specific X- properties and whether Outlook exports attendees. Unverified items are tagged.

A personal calendar export is an **ego view**. It contains the events on *this* person's calendar, with whatever attendee lists the organizer shared. Co-presence edges between two other people are only visible when the ego was also invited (or for events the ego organized). There's no information about meetings the ego wasn't on.

---

## 1. How it's obtained

| Source | Who | Output |
|---|---|---|
| Google Calendar → Settings → Import & export → **Export** | user, desktop web only. Needs "Make changes and manage sharing" on each calendar. Admins can restrict it. | `.zip` of `.ics` files, one per calendar (`<account>@gmail.com.ical.zip` **[UNVERIFIED exact name]**) |
| Google Calendar → calendar *Settings and sharing* → **Export calendar** | same | single `.ics` |
| Google **Takeout** → Calendar | account owner | `Takeout/Calendar/<Calendar name>.ics` (one per calendar) |
| Google "Secret address in iCal format" | user | live `basic.ics` URL. Not a file drop, and fetching it from a browser hits CORS. |
| Outlook desktop (Windows): File → Save Calendar (Save as iCalendar), with **More Options**: date range + detail level | user | single `.ics` |
| Outlook on the web / Outlook.com: Publish calendar → ICS link | user | URL (same CORS issue) |
| Apple Calendar: File → Export | user | `.ics` |

Outlook detail levels (`OlCalendarDetail`): `olFreeBusyOnly` (0) = availability only, `olFreeBusyAndSubject` (1) = limited details, `olFullDetails` (2) = full details. Only **Full details** can carry attendees. Free/busy-only exports have no subjects and no people **[UNVERIFIED: exact property set per level]**. Users report that private items stay redacted even with "include private" checked.

## 2. Container / file tree

```
Google export zip            Takeout zip                           Outlook
<account>.ical.zip           takeout-…-001.zip                     Calendar.ics
├── alice@example.org.ics    └── Takeout/
├── Team rota_abc…@group…ics     └── Calendar/
└── Holidays in …ics                 ├── Ana Ruiz.ics
                                     ├── Team rota.ics
                                     └── Holidays in United States.ics
```
**[UNVERIFIED]**: the file names inside Google's direct-export zip (reported as calendar IDs/addresses). Takeout names are calendar display names (seen in fixtures: `Takeout/Calendar/Weekly.ics`).

One `.ics` structure (RFC 5545):
```
BEGIN:VCALENDAR
PRODID:…            VERSION:2.0      CALSCALE:GREGORIAN   METHOD:PUBLISH (optional)
X-WR-CALNAME:…      X-WR-TIMEZONE:…   (non-standard, Google/Apple)
BEGIN:VTIMEZONE … END:VTIMEZONE        (0..n)
BEGIN:VEVENT … [BEGIN:VALARM … END:VALARM] … END:VEVENT   (0..n)
END:VCALENDAR
```

## 3. Record schema: VEVENT properties for networks

| Property | Card. | Value | Meaning / notes |
|---|---|---|---|
| `UID` | 1 | text | stable event ID, **shared by the master and its overrides** |
| `DTSTAMP` | 1 | UTC date-time | object creation/export time. Not the meeting time. |
| `DTSTART` | 1 | DATE or DATE-TIME | start. See the time forms below. |
| `DTEND` / `DURATION` | 0–1 | | end. If both are absent: DATE start = a one-day event. DATE-TIME start = zero duration (RFC 5545 §3.6.1). |
| `SUMMARY`, `DESCRIPTION`, `LOCATION` | 0–1 | TEXT (escaped) | title / body / room. Descriptions often hold video-call links. |
| `ORGANIZER` | 0–1 | cal-address `mailto:` | params `CN`, `SENT-BY`, `DIR`. Absent on non-meeting personal events. |
| `ATTENDEE` | 0–n | cal-address `mailto:` | params below. The organizer usually also appears as an ATTENDEE. |
| `STATUS` | 0–1 | `TENTATIVE`\|`CONFIRMED`\|`CANCELLED` | drop `CANCELLED` |
| `TRANSP` | 0–1 | `OPAQUE`\|`TRANSPARENT` | transparent = doesn't block time (often FYI/holds) |
| `CLASS` | 0–1 | `PUBLIC`\|`PRIVATE`\|`CONFIDENTIAL` | visibility |
| `RRULE` | 0–1 | recur | recurrence rule (`FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=…` / `COUNT=`) |
| `RDATE`, `EXDATE` | 0–n | date(-time) lists | added / removed occurrences |
| `RECURRENCE-ID` | 0–1 | date(-time) | marks an **override VEVENT** for one instance of the series with the same UID (`RANGE=THISANDFUTURE` possible) |
| `SEQUENCE` | 0–1 | int | revision. Keep the highest per (UID, RECURRENCE-ID). |
| `CREATED`, `LAST-MODIFIED` | 0–1 | UTC | |
| `ATTACH`, `CATEGORIES`, `CONFERENCE` (RFC 7986) | | | ignore |

ATTENDEE parameters (VEVENT):

| Param | Values (default first) | Use |
|---|---|---|
| `CN` | text (may be quoted) | display name |
| `CUTYPE` | `INDIVIDUAL`, `GROUP`, `RESOURCE`, `ROOM`, `UNKNOWN` | drop `ROOM`/`RESOURCE` from person networks (but keep them as a location attribute). `GROUP` = distribution list (unexpanded). |
| `ROLE` | `REQ-PARTICIPANT`, `CHAIR`, `OPT-PARTICIPANT`, `NON-PARTICIPANT` | weight required > optional. Exclude `NON-PARTICIPANT`. |
| `PARTSTAT` | `NEEDS-ACTION`, `ACCEPTED`, `DECLINED`, `TENTATIVE`, `DELEGATED` | **co-presence requires not DECLINED**. Treat `NEEDS-ACTION` as invited-only. |
| `RSVP` | `FALSE`, `TRUE` | |
| `DELEGATED-TO` / `DELEGATED-FROM` | cal-addresses | delegation chains |
| `SENT-BY` | cal-address | assistant acting for the attendee |
| `MEMBER` | cal-address | group membership of this attendee |
| `X-NUM-GUESTS` (Google) | int | non-standard |

Date-time forms:
1. `DTSTART:20240304T150000Z`: UTC.
2. `DTSTART;TZID=America/New_York:20240304T100000`: local time in the referenced `VTIMEZONE` (Google uses IANA names).
3. `DTSTART:20240304T100000`: **floating** (no zone. Interpret it in the ego's or calendar's zone, e.g. `X-WR-TIMEZONE`, and flag it).
4. `DTSTART;VALUE=DATE:20240304`: all-day. Usually exclude from co-presence or treat separately (OOO, holidays).

### Synthetic example (lines already unfolded)

```
BEGIN:VEVENT
DTSTART;TZID=Europe/Berlin:20240304T100000
DTEND;TZID=Europe/Berlin:20240304T103000
RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20240624T080000Z
EXDATE;TZID=Europe/Berlin:20240401T100000
DTSTAMP:20240901T120000Z
ORGANIZER;CN=Ana Ruiz:mailto:ana.ruiz@example.org
UID:7kq2p1example@google.com
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Ana Ruiz;X-NUM-GUESTS=0:mailto:ana.ruiz@example.org
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN="Okafor, Ben":mailto:ben.okafor@example.org
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=OPT-PARTICIPANT;PARTSTAT=DECLINED;CN=Chen Li:mailto:chen.li@example.org
ATTENDEE;CUTYPE=RESOURCE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Room 4.12:mailto:c_1882example@resource.calendar.google.com
SUMMARY:Apollo weekly sync
DESCRIPTION:Agenda:\n1. Status\, risks\n2. Next steps
STATUS:CONFIRMED
SEQUENCE:2
TRANSP:OPAQUE
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Europe/Berlin:20240311T110000
DTEND;TZID=Europe/Berlin:20240311T113000
RECURRENCE-ID;TZID=Europe/Berlin:20240311T100000
UID:7kq2p1example@google.com
SUMMARY:Apollo weekly sync (moved)
…
END:VEVENT
```

## 4. Mapping to the internal model

| Internal | Source |
|---|---|
| sender | `ORGANIZER` address (inviter). If absent, use the calendar owner (ego). |
| recipients / targets | `ATTENDEE`s with `CUTYPE` ∉ {ROOM, RESOURCE}, minus the organizer. Attach `PARTSTAT`/`ROLE` per edge. |
| timestamp | each **expanded occurrence** start → UTC. Duration = end − start (used as edge weight in minutes). |
| timezone | resolve `TZID` via the embedded `VTIMEZONE` (authoritative for that file), falling back to the IANA database. Floating: ego zone. |
| conversation / context id | `UID` (series). Occurrence ID = `UID + RECURRENCE-ID/occurrence start`. |
| context type | `meeting`. Size class: 2 people = direct (1:1), more = group. `CLASS:PRIVATE/CONFIDENTIAL` → private. |
| thread / parent | series master (`UID`) ↔ occurrences |
| text | `SUMMARY` (+ optional `DESCRIPTION`) |
| node attributes | `CN` (name), email domain (internal/external), is_ego, resource flag, calendar name (`X-WR-CALNAME`) |

## 5. Edge construction notes

- **Co-presence (undirected):** for each occurrence, each pair of non-declined human participants (organizer + attendees with `PARTSTAT` ≠ `DECLINED`). Weight by duration, or 1/(n−1) to tame big meetings. Cap or skip events over N attendees (all-hands) and all-day events.
- **Invitation (directed):** organizer → each attendee. Also captures declines.
- **Response behaviour:** `PARTSTAT` per attendee is an edge attribute (accept rate). But it's only accurate as of export, and other attendees' statuses can be stale or hidden in a personal export.
- **Recurrence:** expand `RRULE` + `RDATE` − `EXDATE` within a user-chosen window (unbounded rules need a horizon, default e.g. export date). Replace instances that have a matching `RECURRENCE-ID` override (which may change time, attendees or status). Overrides can be in a different file order than the master.
- **Ego bias:** every edge involves events on the ego's calendar. Network metrics such as centrality are biased toward the ego. Show this in the UI. Merging several people's exports (dedupe by `UID` + occurrence) reduces the bias.
- **Not recoverable:** actual attendance, meetings the ego wasn't invited to, distribution-list membership (`CUTYPE=GROUP` is unexpanded).

## 6. Auto-detection signature

- First non-BOM line `BEGIN:VCALENDAR` (case-insensitive), with `VERSION:2.0` nearby, and ≥1 `BEGIN:VEVENT`. Extensions `.ics`/`.ical`/`.ifb`.
- Google: `PRODID:-//Google Inc//Google Calendar 70.9054//EN` and `X-WR-CALNAME` **[PRODID string from memory. Match `/Google Inc\/\/Google Calendar/`]**. UIDs ending `@google.com`.
- Outlook: `PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN` **[UNVERIFIED exact]**. Windows zone names in `TZID` (e.g. `W. Europe Standard Time`). `X-MICROSOFT-CDO-*` / `X-MS-OLK-*` properties **[UNVERIFIED]**.
- Takeout zip: entries `Takeout/Calendar/*.ics`.

## 7. Quirks and pitfalls

- **Line folding:** lines SHOULD be ≤ 75 **octets**. Continuation = CRLF + one space or tab, so unfold by deleting CRLF+WSP **before** parsing. Folds can split a UTF-8 multi-byte character, so unfold at the byte level, or decode after unfolding. Accept bare LF.
- **Escaping in TEXT:** `\\` → `\`, `\;` → `;`, `\,` → `,`, `\n`/`\N` → newline. Parameter values containing `:;,` are double-quoted (`CN="Okafor, Ben"`). The `mailto:` scheme is case-insensitive (`MAILTO:` occurs). Strip it and lowercase the address.
- **Multi-valued:** `EXDATE`/`RDATE` can be comma lists or repeated lines. `CATEGORIES` too.
- **Time zones:** Outlook uses Windows zone IDs with custom `VTIMEZONE` blocks. Some producers emit `TZID` without a `VTIMEZONE`, or a `TZID` like `"(UTC+01:00) Amsterdam, Berlin…"`. Strategy: (1) the embedded VTIMEZONE, (2) the IANA name, (3) the CLDR Windows→IANA map, (4) treat it as floating and flag it. DST and recurrence: expand in local time, then convert each instance (a weekly 10:00 meeting stays 10:00 local across DST).
- **RRULE edge cases:** `UNTIL` in UTC vs local (and DATE vs DATE-TIME mismatch with DTSTART), `BYSETPOS`, `WKST`, monthly on the 31st, `COUNT` with EXDATE (EXDATE doesn't extend COUNT).
- **Duplicates:** the same meeting appears in multiple calendars of one export (e.g. the primary + a shared team calendar). Dedupe by `UID` + occurrence.
- **Cancelled instances** may appear as overrides with `STATUS:CANCELLED`, or as EXDATE.
- **Privacy:** private events may lack `SUMMARY`/attendees.
- **Google:** attendee emails for rooms are `…@resource.calendar.google.com`. Group calendar IDs are `…@group.calendar.google.com`. Holiday calendars are useless for networks, so skip `#holiday@group.v.calendar.google.com`-style files **[pattern from memory]**.
- **Size:** personal exports are KBs to tens of MB (years of recurring meetings). Expansion is the expensive part, so bound the time window.

## 8. Browser feasibility

**Fully feasible.**
- **`ical.js`** (kewisch, Mozilla's calendar parser, ~1.2k stars, active Sept 2026): zero dependencies, ES module + ES5 build, also on cdnjs. Handles parsing (folding, escaping, params), `ICAL.Event` with `iterator()` for RRULE/EXDATE/RDATE expansion and `RECURRENCE-ID` exceptions via `relateException`, and `VTIMEZONE` conversion. It ships **no IANA zones by default**: add `ical.timezones.js` or register zones yourself. Windows→IANA mapping is not built in **[UNVERIFIED. Plan to include a CLDR windowsZones table]**.
- Alternatives: `ical-expander` (wraps ical.js with expansion helpers), `rrule` (RRULE only).
- Zip handling (Google/Takeout): `@zip.js/zip.js` or `fflate`. Files are small, so you can read whole entries.
- Run expansion in a Web Worker, with an occurrence cap per series.

## 9. Sources

| URL | Type |
|---|---|
| https://www.rfc-editor.org/rfc/rfc5545.html | official (IETF) |
| https://support.google.com/calendar/answer/37111 | official (Google export) |
| https://learn.microsoft.com/nb-no/office/vba/api/outlook.olcalendardetail (canonical: en-us/office/vba/api/outlook.olcalendardetail) | official (Outlook detail levels) |
| https://github.com/stalwartlabs/vandelay `tests/sync_takeout.rs` | community (Takeout/Calendar/*.ics layout) |
| https://github.com/kewisch/ical.js README | community (well-maintained, Mozilla lineage) |
| npm registry search: ical.js 2.2.1, ical-expander 3.2.0 | registry metadata |
| WebSearch snippets: Outlook "Save as iCalendar" detail options and private-item redaction (Microsoft Q&A, third-party guides); Google Takeout calendar zip of one .ics per calendar | community, snippet only |
