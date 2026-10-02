# importers-A public API

Owner: importers-A. Workplace importers (Slack, Teams, email, calendar), network files, Network Canvas and survey importers, the spreadsheet column mapper, the profile (HR) join, identity matching, dataset merging, the import report, the import pipeline and worker, and all exporters.

Tests: `node --test 'test/importers-a/**/*.test.js'` (110 tests). Fixtures: `test/fixtures/importers-a/<format>/`, all synthetic.

## Import pipeline (`src/core/pipeline.js`)

```js
runImport(input, { choices, options, progress, signal, name, importers }) -> Promise<{ dataset, report, detections, plan, unclaimed }>
importInWorker(files, { choices, options, name, progress, signal, detectOnly }) -> Promise<same>  (has .cancel())
detectImports(fs, { importers, signal }) -> Promise<[{ id, label, family, score, reason, root, files|null, options[] }]>
planImports(detections, choices, allRels) -> { plan: [{ id, root, files|null }], unclaimed: [rel] }
toFileSet(input) / subsetFileSet(fs, rels) / rootedFileSet(fs, root)
```

- `input`: a `FileSet`, `File[]`/`FileList`, or `[{ blob, path }]`. `importInWorker` needs File objects or `{ blob, path }` items (structured-cloneable), not a FileSet.
- `choices`: omit for automatic. Otherwise `['slack', ...]`, `[{ id, files }]`, or `{ slack: true }`.
- `options`: `{ [importerId]: { ...option values } }`. Defaults come from each importer's `options[].default`.
- `progress(fraction 0..1, message)`. Within one import it never goes backwards and ends at 1.
- Cancel: abort `signal`, or call `.cancel()` on the worker promise. Both terminate the worker and reject with an `AbortError`.
- **File claiming.** Each file goes to the highest-scoring importer that lists it in `detect().files`. An importer with no `files` list gets every file nobody else claimed. Scores below 0.5 are used only when nothing else matched; the spreadsheet mapper is the fallback.
  - Example: a Takeout zip is split between `email` (Mail) and `calendar` (Calendar).
  - Example: an HR CSV dropped next to a Slack export stays in `unclaimed`, ready for the profile join.
- **Per-item roots.** When several items are dropped together (two zips, a folder and a CSV), detection also runs on each item's folder. Root-anchored exports such as Slack are then still recognised. `plan[].root` says which folder an importer read from.
- **Failures.** If one importer fails, the error becomes an `import-failed` warning (severity error) on its source and the rest of the import continues. If every importer fails, `runImport` rejects.
- **Worker messages** (`src/workers/import.worker.js`):
  - In: `{ type: 'run' | 'detect', files, opts }`.
  - Out: `{ type: 'progress', fraction, message }`, `{ type: 'done', result }` (the dataset's typed arrays are transferred) and `{ type: 'error', message, name, stack }`.
  - `handle(msg, post)` is exported for tests.

## Importer contract additions

- `detect(fs)` returns `{ score, reason, files }`. `files` lists the `entry.rel` paths the importer will read.
- `import()` reads only the files it recognises.
- Every importer calls `beginSource` once per input kind. Beyond the contract fields, sources may carry:

| Field | Meaning |
|---|---|
| `directed` | `false` for undirected inputs (undirected network files, Network Canvas, egor). Each undirected tie is stored as **one** event, source to target. |
| `variant` | Slack: `grid`, `full`, `public-only`. Teams: `graph`, `teams-free`, `purview`. Email: `takeout`, `mbox`, `eml`, `pst`. |
| `egoKeys` | Survey or Network Canvas sources with several respondents. `egoKey` is then null. |
| `egoInferredFrom` | Email and calendar: `option`, `delivered-to`, `sent-label` or `most-frequent-recipient`. |
| `window` | Calendar: the `{ start, end }` used for recurrence expansion. |
| `tableKind` | Spreadsheet sources: `events`, `edges` or `nodes`. |

## Shared conventions

| Thing | Convention |
|---|---|
| Node keys | `slack:<U/W id>`, `slack:bot:<bot_id>` (only when no users.json bot user has that `profile.bot_id`), `teams:<entra guid>`, `teams:app:<id>`, `teams:<mri>` (Teams Free), `teams:<upn>` (Purview), `email:<address>` (email **and** calendar, so mailbox and calendar people coincide), `email:list:<list-id>`, `net:<id>`, `nc:<egoUUID>` / `nc:<egoUUID>:<alterUUID>`, `survey:<egoID>` / `survey:<egoID>:<alterID>`, `survey:<normalised name>` (roster surveys), `csv:<value>` (spreadsheet; `mapping.namespace` changes the prefix) |
| `platformIds` | `{ slack }`, `{ teams }`, `{ email }`, `{ net: originalId }` |
| `attrs.email` | Set whenever an address is known. Identity matching uses it. |
| Reply | Target role `reply` is the parent's author, even when the parent message is absent. `parentKey` is the parent's event key. |
| DM / group DM | Every other member is a `dm` target. Mentions inside a 1:1 DM are dropped as redundant. |
| Reactions | One `reaction` event per reactor per emoji. The message author is the target with role `subject`; `parentKey` is the message. |
| Meetings, huddles, Purview transcripts | `copresence` events with `attendee` targets |
| Declared ties | Network files, surveys, Network Canvas. `declared` events with `declared` targets. Tie type or relation goes in a separate context `<ctx>#<relation>`. |
| Joins and leaves | `join` / `leave` events with a context and no targets |
| Bots | `isBot` is set. Bot posts are kept so the report can count them. |
| Time | `ms` UTC from the explicit source field (Slack `ts`, Graph `createdDateTime`, parsed `Date:`). Never file names. `NaN` when unknown. |

## Importers

| id | Formats | View | Detect score |
|---|---|---|---|
| `slack` | Workspace export (public-only or full), Enterprise Grid `teams/<ws>/` | full | 0.95 (0.3 when partial) |
| `teams` | Graph chatMessage JSON (page, pages, flat array, NDJSON), Teams Free `.tar`, Purview `Items.csv` | full or ego (Graph), ego (Free), full (Purview) | 0.9 / 0.85 / 0.8 / 0.8 |
| `email` | mbox (mboxo, mboxrd, CRLF), Gmail Takeout, Apple Mail `X.mbox/mbox`, Thunderbird, `.eml`; PST/OST/MSG detected only | ego | 0.9 / 0.8 eml / 0.6 pst |
| `calendar` | `.ics` (Google, Outlook, Apple, Takeout) | ego | 0.9 |
| `network-files` | GraphML, GEXF 1.2/1.3, GML, Pajek, UCINET DL, Gephi CSV, adjacency CSV, edge lists | full | 0.9 formats; 0.8 Gephi edges; 0.6 matrix; 0.55 edge-list CSV; 0.5 text edge list. Weak shapes drop to 0.3 when the folder holds other data files (platform exports). Network Canvas GraphML: 0.3 |
| `network-canvas` | Network Canvas CSV sets and GraphML (single and merged) | ego | 0.95 |
| `survey` | egor long (EgoWeb, openeddi), egor wide, Qualtrics, Google Forms | ego (name generators) or full (roster) | 0.85 / 0.7 / 0.85 / 0.75 |
| `tabular` | Any CSV/TSV with a column mapping; XLSX detected and explained | full (option) | 0.2 (0.5 workbook) |

### Options

| Importer | Option | Default |
|---|---|---|
| teams | `view` | `auto` (or `ego` / `full`) |
| | `egoKey` | none |
| | `purviewDateFormat` | `mdy` (or `dmy`) |
| email | `egoAddress` | none |
| | `keepText` | true |
| | `headersOnly` | false |
| | `excludeLists` | false |
| | `excludeAutomated` | false |
| | `includeSpamTrash` | false |
| | `maxRecipients` | 50 (broadcast flag only; messages are kept) |
| calendar | `egoAddress` | none |
| | `defaultTz` | `UTC` (for floating times) |
| | `windowStart`, `windowEnd` | ISO dates |
| | `maxOccurrences` | 500 per series |
| | `includeAllDay` | false |
| | `weightBy` | `count` (or `duration`, in minutes) |
| | `maxAttendees` | 50 (flag only) |
| network-files | `edgeListDirection` | `directed` |
| network-canvas | `weightColumn`, `edgeWeightColumn` | blank = auto-pick a numeric closeness/strength-like variable |
| survey | `respondentColumn`, `weightColumn` | none |
| | `aaRegex` | named groups `src`, `tgt` |
| | `timeZone` | `UTC` |
| | `noTieValues` | as listed in the option |
| tabular | `mapping` | none |
| | `kind` | `events` / `edges` / `nodes` |
| | `view` | `full` |

Extra named exports:
- **teams.js:** `tarEntries(stream, want)`, `parseGraphTime`, `parseParticipants`.
- **email.js:** `parseEmailDate` (explicit RFC 5322 parser, obsolete forms included), `parseFromLineDate`, `mboxMessages(stream)`, `classify`, `FROM_LINE`.
- **calendar.js:** `unfoldBytes`.
- **network-files.js:** `readGraphML`, `readGEXF`, `readGML`, `readPajek`, `readDL`, `readGephiNodes`, `readMatrixCSV`, `readEdgeListText`.
- **network-canvas.js:** `cleanCell`, `typedValue`, `numericValue`, `normName`, `isoMs`.

### Spreadsheet mapper (`src/importers/tabular.js`)

```js
suggestMapping(headers, sampleRows) -> { kind, mapping, columns: [{ header, role, confidence 0..1, reason }], notes[] }
importTabular(fs, { mapping, kind, builder?, files?, progress, signal, view }) -> Dataset (no builder) | null (writes into builder)
sampleRows(entry, n = 50) -> string[][]                         // header + rows for the mapper UI
mapping = { actor, targets, targetSeparator, timestamp, timeFormat, timezone, context, text, weight, type, directed,
            id, label, attrs[], namespace, role, eventType }
```

- `timeFormat`: `iso`, `mdy`, `dmy`, `epoch-s`, `epoch-ms` or `excel`.
- `timezone`: an IANA name. Times without a zone are read in it; when it is unset the source `tz` is `assumed UTC`.
- A `type` column value works in three ways:
  - If it is an event type, it becomes the event type.
  - If it is a role, it becomes the target role.
  - Otherwise it becomes a relation context.
- A `directed` column holding `Undirected` sets `source.directed = false`.

CSV helpers used by every CSV importer:
- `parseCSV(text, { delimiter })` returns `{ rows, delimiter }`. It uses PapaParse and normalises line endings first.
- `csvRecords(stream, { delimiter })` streams records; quoted newlines are safe.
- `rowsToObjects(rows)`, `uniqueHeaders(row)`, `sniffDelimiter(line)`, `entryText(entry)` (falls back to Windows-1252) and `headerRow(entry)`.

Time helpers:
- `parseTimestamp(value, format, tz)`
- `detectTimeFormat(values)` returns `{ format, confidence, zoned, note }`
- `localToUtc(y, mo, d, h, mi, s, ms, tz)` (uses Intl, so DST is handled)
- `isValidZone(tz)`

### Profile join (`src/importers/profile.js`)

```js
joinProfiles(ds, rows, { keyColumn, matchOn: 'key'|'platformId'|'email'|'name', columns?, overwrite = true })
  -> { dataset, report: { matched[], unmatchedRows[], unmatchedNodes[], ambiguous[], columnTypes, overwritten, summary } }
inferColumnType(values) -> 'boolean'|'numeric'|'date'|'id'|'categorical'|'text'|'empty'
```

- `rows`: objects, `{ headers, records }`, a header-plus-rows array, or CSV text.
- Matching is exact first, then normalised (case, diacritics, whitespace).
- Ambiguous cases are reported and never applied:
  - a row that matches several people;
  - a person matched by several rows.
- Returns a new dataset; the input dataset is unchanged. Each join is logged in `meta.profileJoins`.

## Identity and merging

```js
// src/core/identity.js
suggestMatches(ds, { maxBucket = 50 }) -> [{ a, b, keyA, keyB, labelA, labelB, confidence: 'high'|'medium'|'low', evidence[] }]
normalizeText(s), nameTokens(s), normalizePhone(v) -> { full: '+CC...'|null, digits } | null

// src/core/merge.js
mergeDatasets([ds, ...], { name }) -> Dataset
applyMerges(ds, pairs, { note }) -> Dataset
```

**High-confidence matches:**
- The same email in any of these places, compared lowercased: the key, `attrs.email`, or a `platformIds` field containing "email".
- The same phone number with a country code on both sides.
- The same id on the same global platform.
- The same handle inside one service.

**Medium-confidence matches:**
- The same full name (two or more tokens) in different namespaces.
- An email local part that spells the full name.
- Phone numbers that agree apart from a missing country code.

**Low-confidence matches:**
- Single-token names.
- Initial-plus-surname local parts (`aruiz`).
- Names shared by several people in one source.
- Any name match involving an interview alter.
- The same user name on different services.

Two rules hold for every match:
- File-local ids (`net`, `csv`, `nc`, `survey`) are never used as evidence.
- A bot and a person are never paired.
- **Low-confidence pairs must not be merged without a person confirming them.**

`mergeDatasets`:
- Nodes and contexts with the same key are unified.
- Events are appended with their indices, parents and sources remapped.

`applyMerges`:
- Takes pairs as `[a, b]` indices, `{ a, b }`, or `{ keyA, keyB }` (`suggestMatches` output works directly).
- The representative of each group is its most active node.
- Attributes are unioned; on a conflict the representative's value is kept and the conflict is logged.
- Platform ids are kept, with a second id on the same platform stored as `<platform>_2`.
- `attrs.merged_keys` lists the merged keys, and `meta.merges[]` keeps a log of each merge.
- Self targets created by the merge are dropped and counted in `meta.droppedSelfTargets`.
- Source `egoKey`s follow the merge.

## Import report (`src/core/report.js`)

```js
importReport(ds) -> { totals: { nodes, events, contexts, sources, bots, timeRange, warnings: { error, warn, info } }, sources: [...], notes[] }
warningSeverity(w) -> 'error'|'warn'|'info'
```

Each entry in `sources` has these fields:

| Field | Contents |
|---|---|
| `id`, `format`, `family`, `medium`, `view`, `context` | as recorded by the importer |
| `variant`, `directed`, `fileNames` | as recorded by the importer |
| `ego`, `egos` | `ego` is `{ key, label, inferredFrom }`; `egos` is the respondent count |
| `timeRange` | `{ start, end }` |
| `tz` | `{ value, status: exact\|assumed\|zone, note }` |
| `counts` | `nodes`, `events`, `eventsByType`, `targetsByRole`, `contexts`, `contextsByVisibility`, `contextsByKind`, `messagesWithText`, `undatedEvents`, `eventsWithoutTargets` |
| `bots` | `{ nodes, events }` |
| `selfMessages`, `unresolvedParents`, `importerCounts` | counts |
| `warnings` | `[{ code, message, count, severity }]`, sorted error, then warn, then info |
| `worst` | the most severe warning level present |
| `canShow`, `cannotShow` | plain-language lines derived from view, family and data coverage |

`runImport` also adds `report.unclaimed`.

Severity comes from `w.severity` if the importer set it. Otherwise it comes from a table of the codes these importers emit, then from patterns; unknown codes are `warn`.

## Exporters (`src/exporters/*.js`)

```js
exportGraphML(ds, net, { nodeMetrics, communities, attrs })            -> string
exportGEXF(ds, net, { nodeMetrics, communities, attrs, dynamic, timeformat: 'dateTime'|'date' }) -> string   // 1.2draft namespace and types
exportGML(ds, net, opts) / exportPajek(ds, net, opts)                  -> string
exportUCINET(ds, net, { format: 'edgelist1'|'fullmatrix' })            -> string   // fullmatrix only for n <= 500
exportCSV(ds, net, opts) -> { nodes, edges, metrics }; also exportNodesCSV, exportEdgesCSV, exportMetricsCSV
```

- **`net`:** the Network shape from CONTRACTS.md. `edges.src` and `edges.dst` are network node indices.
- **`nodeMetrics`:** `{ name: Float64Array(n) }`.
- **`communities`:** an `Int32Array` or `{ membership }`.
- **`attrs`:** node attribute keys to include. Default: all keys in `ds.attributeSchema`.
- **Node ids and labels:** node ids are the dataset keys. GML and Pajek de-duplicate labels with a suffix.
- **Encoding:** XML-illegal control characters are stripped, and `\n`, `\r` and `\t` in attributes are written as character references. Non-ASCII text survives: UTF-8 in GraphML, GEXF and Pajek; `&#N;` entities in GML.
- **Validation:** every format is read back by our importer and by networkx 3.2.1 (`read_graphml`, `read_gexf`, `read_gml`, `read_pajek`). UCINET has no networkx reader, so it is checked by round trip only.

## Native round trips (generator exports)

Every native export the generator writes is imported with automatic detection in `test/integration/digestion.test.js` and must match the generator's dataset one for one. Fixes made for it (regression tests in `test/importers-a/digestion-fixes.test.js`):

- **Slack:** root files of a real export that hold no messages (`integration_logs.json`, `canvases.json`, `file_conversations.json`, `huddle_transcripts.json`, `lists.json`, `content_flags.json`) are claimed, not read, so they are no longer `unclaimed`. A `bot_message` with only `bot_id` is attributed to the users.json bot user whose `profile.bot_id` matches, instead of a second `slack:bot:<id>` node.
- **Email:** a reply gets a `reply` target (the parent's sender) when the parent is in the mailbox, also when the parent comes later in the file (spec section 5). A reply whose parent is absent has none: the mailbox does not say who wrote it.
- **Calendar:** ical.js relates every `RECURRENCE-ID` VEVENT in a calendar to every master unless told otherwise, so an override of one series replaced the occurrence at the same wall-clock time of any other series. Masters are now built with only their own UID's overrides. The size class (2 people = direct, more = group) counts everyone invited, declines included; co-presence still needs a non-declined attendee.

Expected differences (not bugs): calendar copresence weight is 1 per meeting by default (`weightBy: 'duration'` gives minutes); the generator's dataset weights meetings in hours.

## Known limits (also in code comments)

- **PST/OST/MSG:** there is no parser for them. The importer explains this and suggests `readpst -r` or Thunderbird ImportExportTools NG to convert to mbox.
- **Teams Free:** the schema comes from the Skype export lineage and is not documented by Microsoft. `messages.json` is parsed whole.
- **Purview:** `Items.csv` gives transcript-level co-participation only.
- **Calendar:**
  - Time zones come from embedded VTIMEZONE (ical.js), then the IANA zone via Intl, then a 35-entry Windows zone map, else floating.
  - Display-name TZIDs fall back to floating.
  - Wall times inside a DST gap resolve to one instant.
- **Email:** only English Gmail system labels (Spam, Trash, Sent) are recognised.
- **GEXF:**
  - networkx 3.2.1 cannot read GEXF 1.3, or GEXF `dateTime` spells. Our export is 1.2draft; use `timeformat: 'date'` for networkx.
  - On import, interval ends are dropped (each spell becomes one event at its start).
- **Large XML files** are parsed from whole text (`XmlSax` exists for streaming).
