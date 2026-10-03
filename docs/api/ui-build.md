# ui-build: hand builders and the generator UI

Owner: ui-build. Paths: `src/builders/**` (pure, runs in Node), `src/ui/build/**`, `src/ui/generate/**`, `assets/build.css`, `test/ui-build/`.

Every builder ends the same way: it makes a Dataset with `DatasetBuilder` and hands it to the app through `store.actions.loadDataset(ds, { mode })` (via `src/ui/build/service.js` `handOff`). Nothing here touches the analysis engine directly. The only exception is the recovery check, which runs the pure analysis functions in the generator worker (see below).

## Mounting (for ui-core)

```js
import { BuildView } from './build/index.js';      // <BuildView tab?="draw|ego|roster|perceived|paste" />
import { GenerateView } from './generate/index.js'; // <GenerateView />
```

- Neither component needs props. They load `assets/build.css` themselves: `ensureBuildCss()` adds one `<link data-owner="ui-build">`. Controls, labels, tabs, `.seg`, tables, dialogs, the view head (`ViewHead`, re-exported as `ViewHeader` from `build/shared.js`) and the `--cat-*` palette are the shared ones from `assets/app.css`; `build.css` holds only builder-specific layout (canvas, matrix, ego canvas, recovery list), scoped under `.ob`.
- Each view renders its own visible `h1` view head ("Build", "Generate"); each builder's title is a section heading under the tabs.
- They use `store.actions.loadDataset(ds, { mode: 'replace' | 'add' })`, then `store.actions.setView('network')` if it exists, then `store.actions.notify(level, text)`. With data already loaded, the hand-off bar says the main action replaces it and offers "Add to the data already loaded".
- Generate writes `store.generated = { datasetName, spec, groundTruth, recovery, runId, people, events }` after "Generate and analyze" (`datasetName === dataset.meta.name`), then runs the recovery check and stores its report in `generated.recovery` (`{ summary, checks[] }`). The full panel (`#ob-recovery`) lives in Generate and survives navigation.
- If `loadDataset` is not registered, the views say so through `notify` and do not crash.
- **Worked-example links.** `#build?example=<id>` opens Build on that example (the Learn view emits it; it works with the shell's router as is). `#build/example/<id>` is accepted too, for a router that passes `#build/...` to Build. Drawings open in Draw, the ego interview in Ego network (asking first when it would replace work; Undo restores a drawing), and the address goes back to `#build`. Ids: `two-cliques-broker`, `path` (alias `path-and-star`), `star`, `ring` (alias `ring-small-world`), `small-world`, `class-friendships`, `ego-10`. `exampleFromHash(hash)` (`src/ui/build/hash.js`) parses it.
- The perceived builder reads `store.get().dataset` and uses it as an optional reference network.
- Local storage keys are all wrapped in try/catch, and the views work without storage:
  - `orgsignal.build.tab`
  - `orgsignal.build.draw.draft`, `orgsignal.build.draw.settings`
  - `orgsignal.build.ego.session`
  - `orgsignal.build.roster`, `orgsignal.build.perceived`, `orgsignal.build.paste.text`
  - `orgsignal.build.ego.share`, `orgsignal.respond.<surveyId>` (respondent drafts)
  - `orgsignal.generate.form`

## Dataset conventions (all builders)

| Builder | source.format | view | context | node keys | contexts (kind) |
|---|---|---|---|---|---|
| Draw | `draw` | full | custom | `draw:<id>` | one per tie type, `draw:type:<slug>` (canvas) |
| Ego | `ego-interview` | ego (`egoKey` = `ego:<egoId>`) | survey | `ego:<egoId>`, `alter:<egoId>:<uuid>` | one per name generator `ego:<egoId>:gen:<slug>` (survey), plus a "perceived ties" context |
| Roster | `roster` | full | survey | `roster:<slug>` | one per relation `roster:rel:<slug>` (survey) |
| Shared survey (roster) | `shared-survey` | full | survey | `roster:<slug>` | one per relation (as Roster) |
| Shared survey (ego, against a roster) | `shared-survey` (two sources: own ties directed, perceived ties undirected) | full | survey | `roster:<slug>`; off-list names `alter:<surveyId>:<respondent>:<name>` | one per name generator `survey:<id>:gen:<slug>`; one per respondent `survey:<id>:perceived:<slug>` |
| Shared survey (ego, no roster) | `shared-survey`, one source per respondent | ego | survey | as Ego, with a stable `egoId` per respondent | as Ego |
| Perceived | `css` | full | survey | `cs:<slug>` | one for the relation (survey) |
| Paste | `paste` | full | custom | `paste:<slug>` | `paste:ties` (canvas) |

- Every tie is a `declared` event: actor = sender, target role `declared`, `weight` = tie value.
- `source.directed` is set. It is an extra field that `beginSource` keeps. When it is `false`, each undirected tie is stored once and the analysis should symmetrise.
- Draw: in a drawing that mixes directed and undirected ties, undirected ties are written in both directions.
- Draw also writes `ds.meta.positions[nodeIndex] = [x, y]`, the hand layout. It is an addition beyond the contract; the Network view may use it as a starting layout, and other readers can ignore it.
- Ego: alter attributes are the interpreter answers, plus `kind` and `generators` (names joined with `;`). There is one ego→alter event for each generator that elicited the alter, placed in that generator's context; the tie's weight (1, or the "Weight ego's ties by" answer) is shared out among them, so a person named under two questions is one tie of weight 1 and the ego measures match Burt's binary formulas (C4). Alter–alter ties are one event per pair, as perceived by the ego. Event time is the session start.
- Roster in multi-respondent mode: each node gets a `responded` attribute, and non-respondents are recorded as a warning. With Union or Reciprocated only, each tie is written as the nominations behind it (one event per person who named the other, actor = that person, with their own tie-field answers), sharing the tie's weight (C5).
- Roster tie weight (C1): a relation's 1..N rating field (the first scale field, or `relation.weightField`; `''` = every tie counts 1) is the tie's weight, combined by the merge rule like the value; ties without an answer count 1. An info note (`roster-tie-weight`) says so; `source.weightFields` lists the field per relation.
- Perceived: a mutual relation is undirected (`source.directed = false`, one event per pair); in the consensus view the weight is the share of informants who reported the tie, explained in an info note (`css-consensus-weight`).

## src/builders/common.js

- `uid(prefix)`, `uuid()`, `rng(seed)`: ids, and a deterministic PRNG (mulberry32).
- `slug`, `normName`: key slugs, and name matching that ignores case, spacing and accents.
- `csvCell`, `toCSV(rows)`: RFC 4180 output. Like Network Canvas, cells starting with `= + - @` or a tab get a leading `'`.
- `coerce(value, type)`: typed field values. Blank becomes `undefined`.
- `ATTR_TYPES`, `uniqueLabel`.

## Draw: src/builders/draw.js, draw-snap.js, draw-layout.js; UI src/ui/build/draw/

**Document.** `{ version, name, nodes[{id,label,x,y,group,attrs}], edges[{id,source,target,type,weight,directed}], groups[{id,name}], attrColumns[{key,type}], edgeTypes[], groupKey?, example? }`. `groupKey` names the attribute the groups become (default `group`; the class example uses `major`); `example` is the worked example the drawing started from, and `toDataset` then adds `ds.meta.example = { id, title, lookFor[] }`. Every operation is pure (doc in, new doc out).

**Worked examples** (`src/builders/examples.js`, re-exported by `draw/example.js`): `EXAMPLES` `[{ id, kind: 'draw'|'ego', title, summary, lookFor[] }]`, `exampleById(id)` (aliases included), `exampleDoc(id)`, `exampleSession(id)`. Two teams and a broker (undirected; the broker is the only route and has the highest betweenness), a path and a star of six (A2), a ring and the same ring with two shortcuts, class friendships with majors, and a 10-person ego interview (A3). Every number in `lookFor` is asserted in `test/ui-build/examples.test.js` (reference values from networkx). The File menu lists them under "Start from an example"; the empty canvas offers the first three; a loaded example shows "Worked example: what to look for" above the canvas. New drawing and examples ask before replacing a drawing (M12). `?` opens "How to draw" (four steps) and the shortcuts (L20). A drawing that mixes one-way and two-way ties says that Network will count each two-way tie twice (L1).

- Create and look up: `emptyDoc(name)`, `nodeById`, `edgeById`, `groupById`, `nextLabel`, `bounds(nodes)`, `freeSpot(nodes, p, { r, clearX, clearY })` (a place for a new person clear of others and their labels).
- History (undo/redo keeps earlier versions of the drawing, which share unchanged parts):
  - `createHistory(doc)`, `commit(h, doc, label)`
  - `undo`, `redo`, `canUndo`, `canRedo`, `undoLabel`, `redoLabel`
- Nodes: `addNode`, `updateNode`, `moveNodes`, `removeNodes` (also removes the ties touching them).
- Ties:
  - `addEdge` refuses self-loops and duplicates.
  - `updateEdge`, `reverseEdge`, `removeEdges`, `findEdge`, `connectPath`, `addEdgeType`.
- Groups and attributes: `addGroup`, `renameGroup`, `removeGroup`, `setGroup`, `addAttrColumn`, `setAttrColumnType`, `removeAttrColumn`, `setNodeAttr`.
- Copy and paste: `copySelection(doc, ids)` keeps only ties inside the selection; `paste(doc, clip, { offset })` returns `{ doc, ids }` with new ids.
- Arranging: `align(doc, ids, 'left|center|right|top|middle|bottom')`, `distribute(doc, ids, 'h|v')`.
- JSON: `exportJSON(doc)`; `importJSON(text)` and `validateDoc(obj)` return `{ doc, errors[], warnings[] }`.
- `toDataset(doc, { name })`.
- Snapping (`draw-snap.js`):
  - `snapToGrid(v, size)`, `snapPointToGrid(p, size)`
  - `findGuides(p, others, threshold)`: snaps to centre alignment with other nodes and to equal spacing.
  - `snapPoint(p, others, { grid, gridSize, guides, threshold })`
- Layouts (`draw-layout.js`):
  - `LAYOUTS`, `runLayout(doc, id, ids, { all, root, key, seed, box })`, which returns positions.
  - `circleLayout`, `gridLayout`, `treeLayout` (breadth-first from a root), `forceLayout` (seeded and deterministic), `concentricLayout` (rings by degree, group or an attribute).
  - `layoutBox` (a selection is laid out inside its own bounding box), `fitInto`, `concentricKeys`.
- UI: `DrawEditor()`. One toolbar (mode `.seg`, undo/redo, Canvas | Table, File menu, shortcuts, the primary "Analyze this network"); layout and snapping live in the panel beside the canvas. The canvas fills the window height below it. New people open for naming. Tie types are drawn with dashes, plus a key, only when more than one is used. Undo history, zoom and panels survive leaving the view (module memory).
  - SVG canvas with pan and zoom, grid snap, alignment guides, group outlines, marquee and shift-click selection, and inline renaming.
  - Inspector, an equivalent table view for screen readers, and autosave.
  - Layout changes animate, except under `prefers-reduced-motion`.
  - Every action has a keyboard path; `?` opens the shortcut list.

## Ego network: src/builders/ego.js; UI src/ui/build/ego/

**Presets**
- `GENERATOR_PRESETS`: GSS "important matters" (cap 5), advice, socializing, support, work.
- `INTERPRETER_PRESETS`: relationship, closeness 1–5, contact frequency, how met, years known, age band, location.
- `CONTEXT_PRESETS`, `STEPS`, `SESSION_VERSION`.

**Session and questions** (every mutator returns a new session)
- `newSession({ caseId, egoLabel, protocolName })`
- Generators: `addGenerator`, `updateGenerator`, `removeGenerator`
- Interpreters: `addInterpreter`, `updateInterpreter`, `removeInterpreter`, `varName`

**Alters**
- `addAlter(s, name, genId)` returns `{ session, alter, status }`, where status is one of:
  - `added`
  - `duplicate-other`: the same person was already named under another generator. They are not added again; the extra generator is recorded on them.
  - `duplicate-same`, `cap`, `empty`
- `removeAlter`, `renameAlter`, `setInterpreter`, `generatorCount`

**Alter–alter ties**
- Contexts: `addContext`, `renameContext`, `removeContext`, `assignContext`.
- People who share a context are assumed to know each other: `impliedTies(s)`.
- `tie(s, a, b)` returns the user's override if there is one, else the implied value. `toggleTie` and `setTie` store overrides; an override that matches what the contexts imply is dropped.
- `tieList(s)` returns pairs with their source: `context`, `added`, `removed` or `none`.

**Progress, output and files**
- `progress(s)` returns completeness per step and overall; `todo(s)` lists what is left in words (the UI shows "Step n of 6", not a percentage).
- `addContext(s, name, { fromAnswers = true })` starts a setting with the people whose categorical answers name it (`suggestedMembers(s, name)`; How met "School", relationship "Coworker" for Work, ...). `placeLabels(items, { lineH, midY })` keeps setting labels on the who-knows-whom canvas from overlapping.
- `toDataset(s)`
- Save and resume: `sessionToJSON`, `sessionFromJSON` (validated).
- Network Canvas export: `toNetworkCanvasCSV(s)` returns `[{ name, text }]`:
  - `<case>_<session>_ego.csv`: `networkCanvasEgoUUID, networkCanvasCaseID, networkCanvasSessionID, networkCanvasProtocolName, sessionStart, sessionFinish, sessionExported, APP_VERSION, COMMIT_HASH, name, ...` (`name` = the respondent; `sessionFinish` is the export time for an unfinished session)
  - `_attributeList_Person.csv`: `nodeID, networkCanvasEgoUUID, networkCanvasUUID, name, ...`. Multi-select answers become `<name>_<option>` columns with true/false, a `gen_<generator>` column per generator records which question elicited each person, and a `setting_<name>` column per who-knows-whom setting records its members. `fromNetworkCanvasCSV` restores the respondent's name, the settings, and the hand-made exceptions.
  - `_edgeList_knows.csv`: `edgeID, from, to, networkCanvasEgoUUID, networkCanvasUUID, networkCanvasSourceUUID, networkCanvasTargetUUID`
- Network Canvas import: `fromNetworkCanvasCSV(files, { template })` reads those files back into a session.
- Helpers: `NC`, `ncPrefix`, `generatorColumn`.
- Checked: the exported CSVs import through `src/importers/network-canvas.js` (detection score 0.95; ego plus alters, every tie, no warnings).

`egoMeasures(s)`: `{ size, ties, possible, density, effectiveSize, efficiency, constraint, constraintMin, constraintMax }` with every tie counting 1 (Burt's binary formulas, as networkx computes them unweighted); `constraintMin` = 1/n, `constraintMax` = (2n − 1)²/n³.

**UI:** `EgoBuilder({ example })` has six steps (titles plain first, terms in parentheses; `STEPS[].short` in the step bar):
1. Who comes to mind (name generators): a short explanation of ego and alters, each question's name limit, a link to the example interview; a full question offers "Allow up to N + 5" (not to respondents)
2. About each person (name interpreters): the standard questions in one sentence; the instrument editor (variables, answer types, options, tie fields, weighting) behind "Edit questions"
3. Collect names (duplicates across questions are flagged)
4. Describe (fast table entry)
5. Who knows whom: sort people into settings, then fix exceptions on a canvas or in a filterable pair list
6. Review and export: "This ego network" first, a verdict (brokering, closed or in between, from efficiency = effective size / size) and size, density, effective size and constraint, each with its meaning, the hand formula and constraint's possible range for this size, plus How to read this

## Roster: src/builders/roster.js, matrix.js; UI src/ui/build/roster/

**Model:** `{ people[{id,label,attrs}], attrColumns, relations[{id,name,question,scale:'binary'|'valued',max}], mode:'single'|'multi', ties{relId:{'from|to':v}}, responses, mergeRule }`

**Setting up**
- `newRoster()`, `makeRelation(preset)`
- `RELATION_PRESETS`: knows, works with, advice, trust, friendship.
- `MERGE_RULES`: `union`, `intersection`, `respondent`.
- `parseRosterText(text, { nameColumn })` reads one name per line, or a CSV with a name column plus attribute columns. Duplicate names are reported. A survey responses export returns `{ survey: true }`; a table without a name column returns `{ needsColumn: true, headers, sample }` and is read again with the column the user picks (`''` = each whole line is a name).
- `rosterFromResponses(text, { file })`: a Google Forms or Qualtrics responses export -> a whole roster model (people from the grid rows plus respondents, one relation per question, survey mode, responses parsed, default rule Union), or null. Roster step 1 offers "Import survey responses"; a responses file pasted or imported as names goes the same way.

**Survey forms (multi-respondent)**
- `formTemplate(model)` returns `{ googleCsv, qualtricsCsv, instructions }`.
  - Google Forms shape: `Timestamp, Your name, <Question> [<Name>]...`, with one row per member.
  - Qualtrics shape: three header rows. Ids `StartDate, EndDate, ResponseId, Q1, Q2_1...`, then the question text ending in `- <Name>`, then `{"ImportId":...}`.
  - `instructions` is a plain-text walkthrough for building the form in Google Forms (checkbox or multiple-choice grid) and Qualtrics (matrix table).
- `parseRosterResponses(text, model, { labels })` reads either export shape. It returns `{ respondents[{ personId, ties }], unmatchedNames, unmatchedQuestions, warnings, format }`.
  - The `- Name` joiner in Qualtrics is UNVERIFIED in the spec; any ` - ` suffix is accepted.
- `responsesFromDataset(ds, model)` turns the survey importer's Dataset into the same respondents. The UI tries `src/importers/survey.js` first and falls back to the built-in parser. Both give identical ties on the test file.

**Merging self-reports**
- `mergeResponses(respondents, relId, rule, people)`:
  - `union`: undirected, a tie if either person reports it; a valued tie takes the larger answer.
  - `intersection` (reciprocated only): undirected, a tie only if both report it; a valued tie takes the smaller answer.
  - `respondent`: directed, exactly as reported.
- `coverage(model)`, `tiesFor(model, relId)`, `toDataset(model, { relationIds })`

**Matrix helpers** (`matrix.js`): `pairKey`, `splitKey`, `orderedPairs`, `setTie`, `nameIndex`, `cellValue(cell, labels)`, `parseAdjacencyCSV(text, people)`, `adjacencyCSV(people, ties)`.

**UI**
- `RosterBuilder()`
- `Matrix`: a grid with headers that stay in place while the grid scrolls inside its own frame. One cell is in the tab order at a time.
  - Arrow keys, Home and End, PageUp and PageDown move.
  - Space or Enter toggles a tie; digits set a value; Delete clears.
- `PairEntry`: the same ties entered as a form and a list.
- `PeopleEditor`

## Perceived networks (Krackhardt CSS): src/builders/perceived.js; UI src/ui/build/perceived/

**Model:** `{ people, relation{name,question}, informants[{id, personId|null, label, ties{'i|j':1}}] }`

- `newCSS()`, `addInformant(css, personId)`
- `agreement(css)`: the share of informants who report each ordered pair.
- `consensus(css, threshold = 0.5)`: a tie is present when the share is at least the threshold.
- `las(css, 'union' | 'intersection')`: the locally aggregated structure. The tie i→j is decided by informants i and j only. `.missing` lists people without their own report.
- Direction (M1, M2): `relation.undirected` (default on for friendship-like names, `isMutualRelation(name)`; `undirectedOf(css)`); `CSS_RELATIONS` presets; `setUndirected(css, on)` (on mirrors every informant's ticks), `setReportTie(css, ties, from, to, v)` (mirrors in a mutual relation), `symmetrize(ties)`. In a mutual relation every count, the consensus, LAS and accuracy are over unordered pairs, so ticking one cell or both gives the same score. `setInformantTie(css, inf, from, to, v)` and `toggleInformantTie(css, inf, from, to)` return the informant with `mirrored` (cells ticked only as a mirror); clicking a mirror cell keeps the pair (a further click, a click on the cell first ticked, Delete or 0 clears it). The Matrix takes `onToggle` and `mutual` (counts pairs once). `symmetryCheck(css)` (directed relations) sets `mixed` when informants' shares of two-way ticks differ by 0.3 or more (`twoWay`/`oneWay` split at the midpoint) and `allTwoWay` when every informant ticked at least 90% both ways. `consensus(css, t, { without })` leaves one informant out; `perInformantAccuracy` adds `vsOthers`; `bestPerceiver(rows, key)` names who perceives best (ties at two decimals named together); `reportedCount`.
- `accuracy(perceived, criterion, people, { undirected })` returns `{ hits, misses, falseAlarms, correctRejections, hitRate, falseAlarmRate, jaccard }` over all ordered pairs with i ≠ j.
- `perInformantAccuracy(css, { threshold, reference })`: each informant scored against the consensus (`vsConsensus`, includes their own report: circular, not shown), the consensus of the others (`vsOthers`, leave-one-out, two or more informants; what Compare shows when no reference is loaded), and a reference network if one is given.
- `disagreement(css)`: ties ranked by 4p(1−p).
- `referenceFromDataset(ds, people)`: the loaded network as a criterion, matched by name; a network built from perceived reports (format `css`) returns `{ fromStudy: true }` and is never used (circular).
- `viewTies`, `viewLabel`
- `toDataset(css, { view: 'consensus' | 'las-union' | 'las-intersection' | <informantId>, threshold })`
- UI: `PerceivedBuilder()`, in four steps: people, informants (relation with presets and the Mutual relation checkbox), each informant's matrix (CSV import and export; a warning when informants filled it in differently), and compare: a verdict ("Priya perceives the network best", Jaccard), the threshold slider, the accuracy table with hits, false alarms, hit rate and Jaccard defined in words and a "vs others only" column, the most-disagreed pairs, the view to analyze (plain names for LAS), its direction, the consensus weight explained, a warning when a directed view has no two-way tie, and hand-off. "New perceived study" replaces Start over (L15).

## Paste ties: src/builders/paste.js; UI src/ui/build/paste/

- `parseLine(line)` and `parseTies(text)` return `{ ties[{from,to,directed,weight,line}], errors[{line,message}], nodes, lines, directed }`.
- Accepted forms:
  - `A - B`, `A -- B`, `A, B`, `A<TAB>B`, `A;B` (undirected)
  - `A -> B`, `A <- B` (directed), `A <-> B` (both directions)
  - a trailing numeric weight
  - quoted names that contain commas
  - `#` comments
- Self-ties and bad weights are reported as errors on their line.
- `toDataset(parsed, { name })`
- UI: `PasteTies()` shows a live preview with unreadable lines highlighted.

## Generate view: src/builders/generate-spec.js; UI src/ui/generate/

**Form logic** (`generate-spec.js`, pure)
- `normalizeContexts(listContexts())` accepts media as strings or objects, params as an array or keyed object, and presets as an array or object.
- `validObservations(ctx, medium)`
- `options(contexts, form)`: every choice, marked enabled or not, with the reason.
- `defaultForm`
- `applyChange(contexts, form, patch)` returns `{ form, notes }`. It resets downstream choices that became invalid and says why.
- `toSpec(form, { output })`, `describe(contexts, form)`, `sizeNote(n)`
- Constants: `CONTENT_LEVELS`, `OBSERVATIONS`, `MEDIUM_INFO`, `COMFORT`.
- `FALLBACK_CONTEXTS` is for development only. It is used only when the generator cannot be imported, and the generate buttons are disabled while it is in use.

Also `defaultObservation(ctx, medium)` (Everyone whenever the medium allows it), `describe()` returning `caution` / `nativeCaution` when the chosen view or the native format cannot show the planted structure, `friendlyError(message, { size })` (out-of-memory failures become a plain message with a way forward), `fmtDay(iso)`.

**Services**
- `src/ui/generate/service.js`:
  - `loadContexts()`
  - `startGenerate(spec, { onProgress })` returns `{ promise, cancel, runId }`. It uses a module worker, falling back to the main thread; a failed run restarts the worker.
  - `startRecovery({ seed, runId, groundTruth, dataset, settings })`: `settings` are the construction settings to build with (the view passes the current ones when the generated world is what is loaded, N24): the worker answers from its copy of run `runId`, or from the ground truth and dataset sent along.
- `src/ui/generate/run.js`: `runGenerate(spec, progress)` (native runs return `download`), `runRecovery(groundTruth, ds, { seed })` (passes `membership`, `nodeMetrics` and detected `shifts` to `recoveryCheck`).
- `src/ui/generate/pack.js`: `packNative(files, { name })` hands one file over as it is (the Slack, Takeout or X zip itself) and puts several files in one zip with any inner zip unpacked into a folder, so the download loads in Data as it is; `groundTruthJSON(gt)`, `readmeText(...)` for the README and ground-truth downloads offered after a native download.
- `src/ui/generate/generate.worker.js`: takes `{ type: 'generate' | 'recovery', id, ... }` and posts `progress`, `done`, `recovery` and `error` messages. It keeps the last "Generate and analyze" run for the recovery check.

**What the UI offers**
- Setting, medium, scenario (the generator's presets), size (number plus a logarithmic slider, with a note on what the browser handles comfortably), message text, what the export shows, days, start, seed, and advanced parameters taken from the generator's own schema.
- Choices that don't fit stay visible but disabled, with the reason as accessible text.
- **Generate and analyze**: generates with `output: 'dataset'` and hands the result off.
- **Download as native export files**: generates with `output: 'native'`, zips `files[{ path, bytes }]` and names the importer that reads them back.
- Progress bar and Cancel (Cancel terminates the worker).
- A recovery check panel after analysis: titled with the world ("Bridge-dependent workplace (Slack), 120 people, seed 1"), accounts and bots ("121 accounts, 1 bot left out of the network"), the construction settings it used in words, a warning with "Run it again" when they changed since, the verdict rule, How to read this, and per check the verdict, the reading, the numbers (three decimals) and, for brokers, every planted broker with its measured rank (decision 9). When the loaded world differs from the form (for example the sample from Data), the form says "Loaded now: ..." and offers to show its settings (L13). The seed is called the random seed (L14).

## Tests and QA

- `node --test 'test/ui-build/**/*.test.js'` runs the unit tests for draw, ego, roster, perceived, paste and generate, plus `examples.test.js` (worked examples against the analysis; Priyanka's A3 interview against networkx) and `class-survey.test.js` (the class's A4 response files in `fixtures/a4-roster` and `fixtures/a4-ego`: weights, nominations, perceived ties left out, readable response text, fuzzy names). The perceived tests check LAS, consensus, accuracy and disagreement against hand-computed numbers.
- `node test/ui-build/qa.mjs [--only=draw,ego,...] [--port=8791]` runs browser QA.
  - It serves the app, mounts `test/ui-build/harness.html` (BuildView and GenerateView standalone inside the shell's `.view.view--bare` frame with theme.css and app.css, and stubbed `store.actions`) in the cached Chromium through puppeteer-core, and runs `test/ui-build/qa/*.mjs` at 1440px and 390px.
  - A run fails on console errors, page errors, failed requests or horizontal overflow.
  - Screenshots are saved to the session scratchpad (`QA_OUT` overrides the location).


## Tie fields: src/builders/tiefields.js; UI src/ui/build/tiefields.js

Optional qualities recorded on a tie, beyond present and its value. A definition is `{ id, key, label, type: 'choice'|'scale'|'number'|'text', options?, ordered?, multiple?, max? }`.

- `TIE_FIELD_PRESETS`: tie type (choice, several allowed), strength (scale 1..5), how often (ordered choice, lowest first), years known (number), notes (text). `TIE_FIELD_TYPES`.
- `makeTieField(def, takenKeys)`, `updateTieField`, `coerceTieValue(f, raw)`, `cleanTieValues(fields, values)` (typed, blanks dropped, null when empty), `declareTieFields(fields)` (for `source.tieFields`), `unionTieFields`, `describeTieValues`, `combineTieValues(fields, a, b, rule)` (two reports of one undirected tie: numbers by the merge rule, choices unioned, text kept both).
- Datasets: values go on the tie's event as `attrs`; each source declares its definitions in `source.tieFields`. The construction settings take a weight from a numeric or ordered field and filter by any field (docs/api/analysis.md, Tie fields).
- UI: `TieFieldsEditor({ fields, onChange })` (presets, custom fields, type, options, scale top) and `TieFieldInputs({ fields, values, onChange, idPrefix, compact })`.

**Roster.** `relation.fields`; single-informant values in `model.tieAttrs[relationId]['from|to']`; `setTieAttrs(model, relId, from, to, values)` (a detail on a pair with no tie records the tie), `pruneTieAttrs(model)` (cleared ties lose their details). Multi-respondent values are `respondent.attrs[relId]['from|to']`; `mergeResponses(..., fields)` returns `attrs` beside `ties`. With more than one relation every roster event also carries `relation: <name>` (declared as a choice field), so construction can keep some relations. The grid edits details for the focused cell in one panel under the grid (F2 or Shift+Enter moves into it, Escape returns to the cell; cells with details carry a corner mark), so the grid itself stays one character per cell at 100 people. Pair entry picks people with type-ahead and lists each tie's details.

**Typed attribute columns.** `renameAttrColumn(model, key, next)`, `removeAttrColumn(model, key)`, `badAttrValues(model, key)`. The people table edits each column's name and type (text, number, choice, ordered, yes/no, date) in its header, cells take input of their type (choice columns suggest the values already used), and values that do not fit the type are counted in the header. The add-column form takes a type.

**Ego.** `session.tieFields` and per-alter values `alter.tie`; `addTieField`, `updateTieField`, `removeTieField`, `setTieValue`. They are asked in the Describe step beside the interpreters ("your tie") and written as event attrs on ego's ties. `writeEgoSession(builder, session, { source })` writes one interview into a builder (used by `toDataset` and the response importer). Alter-alter ties have no tie fields.

## Names carry over: src/builders/names.js; UI src/ui/build/pick.js

- `matchNames(query, list, { limit })`: type-ahead order (whole name, start of name, start of a word, inside, near spelling).
- `duplicateReason(a, b)`: `same`, `spelling` (edit distance up to 2), `initial` ("J. Reyes"), `short` ("Jon" for "Jonathan Reyes"), `first-name` (same first name, other surname), or null. `likelyDuplicates(name, list)`, `REASON_TEXT`, `editDistance`.
- `Combobox` (ARIA 1.2 combobox with a listbox: arrows, Enter, Escape; optional free text) and `PersonSelect` (a select replacement).
- Ego names step: every question offers the people already named as one-click toggles ("Also name someone you already mentioned"), typing suggests them, and a typed name that looks like someone already named (or on the roster) waits for "Same person: X" or "No, add X as someone new" instead of creating a second person. Pairs among everyone named that look like one person are listed with a merge (`mergeAlters(s, keepId, dropId)`) or "Different people" (remembered in `s.distinct`). `addAlter(s, name, genId, { personId, alterId })`: by roster id or existing alter id.
- Against a roster (respondent mode), names are only picked from the roster with type-ahead; "Someone not on the list" opens free typing when the survey allows it.

## Shared surveys: src/builders/share.js; UI src/ui/build/sharing.js, src/ui/build/respond/

No server: nothing a respondent enters is uploaded. The organizer makes a link that carries the survey in its fragment; the respondent's answers leave their device only as a file they send.

**Link.** `<app>/#survey=1.<base64url(deflate-raw(JSON definition))>` (fflate, level 9). The fragment is never sent to a server. `surveyLink(def, base) -> { url, length, tooLong }`; `LINK_LIMIT = 8000` characters, beyond which the survey file is offered instead (`<name>.survey.json`, opened at `<app>/#respond`). `encodeSurvey`, `decodeSurvey`, `surveyFromHash`, `surveyFileText`, `parseSurveyFile`, `validateSurvey`. A 12-person roster with two tie fields is about 850 characters; 100 people fit.

**Definition** (`format: 'orgsignal-survey'`, `version: 1`): `{ id, kind: 'roster'|'ego', title, intro, createdAt, people: [{ id, label }], relations: [{ id, name, question, scale, max, fields }], combine, ego: { generators, interpreters, tieFields, askTies, allowOthers } }`. People carry names only: the organizer's attribute columns are never in a link, survey file or response. `surveyFromRoster(model, { title, intro })`, `surveyFromEgo(session, { roster, askTies, allowOthers })`, `surveyHash(def)` (crc32 of the canonical JSON).

**Response file** (`format: 'orgsignal-response'`, `version: 1`), named `<survey>-response-<respondent>-<yyyymmdd-hhmmss>.json`:
```
{ format, version, survey: { id, kind, title, hash }, respondent: { personId|null, label }, created,
  answers: roster -> { [relationId]: { [personId]: { value, fields? } } }
           ego    -> { alters: [{ id, label, personId?, generators[], attrs{}, tie{} }], contexts: [{ name, members[] }], ties: { 'a|b': bool } },
  definition, checksum: 'crc32:<8 hex>' }
```
The checksum is CRC-32 over the canonical JSON of everything else: it catches corruption and hand edits, it is not a signature. `makeResponse(def, respondent, answers)` (answers cleaned: self, unknown people, values off the scale and invalid fields dropped), `verifyResponse`, `responseFileText`, `responseFileName`. The same response as text for email: `responseToText(r)` starts with the answers in words (`responseSummary(r)`, outside the block, ignored when read back; C17), then a block between `-----BEGIN ORG SIGNAL RESPONSE-----` and `-----END ORG SIGNAL RESPONSE-----` (Survey and Respondent header lines, then the packed response wrapped at 64); `parseResponses(text, { file })` reads JSON files, survey files and any number of blocks, tolerating email quoting (`> `) and wrapping.

**Recombining.** `recombine(items, { survey, surveys })` with the organizer's definition (or a survey file, or else the survey most responses answered) as the reference: `{ survey, accepted, duplicates, rejected, invalid, earlier, responded, missing }`. Respondents are matched by roster id, else name; the latest response per person wins and the rest are reported; responses to another survey (different id) are rejected by name; responses to an earlier version of the same survey still count (matched by person and question). `recombineNotes(result)` gives the lines shown in the builder and the import report (times in the reader's own time zone). `writeRecombined(builder, result, { mergeRule, people })` / `recombinedDataset(result, opts)`:
- roster surveys go through `writeRoster` with the merge rules (union, reciprocated only, as reported), tie fields combined by `combineTieValues`; `people` adds the organizer's attributes back.
- ego interviews against a roster are stitched into one bounded network (own ties share their weight among questions, as above): roster people are the nodes (the roster builder's keys, so it merges with a roster survey); each respondent's ties run from them to the people named, one event per question, with tie fields, interpreter answers and `report: 'own'`; the pairs a respondent says know each other are perceived ties in a context of their own ("Perceived by X"), undirected, with `report: 'perceived'` and `perceived_by`. They are a separate relation, **left out by default** (C2): both sources carry `defaultTieFilters: [{ key: 'report', values: ['own'] }]`, which `defaultSettings` (src/analysis/construct.js) turns into the default tie-field filter; ticking "perceived" under Reported as in the construction drawer brings them in.
- plain ego interviews (no roster) become one ego network per respondent.
- `rosterRespondents(result)`, `sessionFromResponse(def, r)`, `respondentSession(def, who)`, `egoAnswers(session)`.

**Builder UI.** Roster, Collect ties, "Each member answers a survey": "Make a share link" (title, message, link with its length, Copy link, Open it as a respondent, Survey file), then "Import response files" (several at once, more later; `model.shared.items` keeps every usable response so each import recombines the whole set) or paste response text; the notes say who responded, who did not, duplicates and rejected files. The Google Forms and Qualtrics templates remain under "Or use Google Forms or Qualtrics". `model.share = { id, createdAt, title, intro }` keeps the survey id stable while the roster is edited. Ego: "Send as a survey to many" switches the steps to the questions plus "Share and collect" (`orgsignal.build.ego.share`: options to pick people from the Roster tab's list, allow names not on the list, ask who knows whom), and "Analyze the responses" hands the recombined dataset over.

**Organizer side**: the responses box warns that response files show who named whom and should not be shared with participants; survey titles use `DraftInput` (shared.js), so clearing the field does not bring the default back while typing (C7); a tie field's name is edited the same way, selected on focus (C6). Presets include Closeness (1 to 5).

**Respondent mode** (`src/ui/build/respond/index.js`, mounted by `src/ui/app.js` when the address is `#survey=...` or `#respond`): no analysis navigation, the survey title and message, a privacy statement, then: who are you (type-ahead over the roster, or a name), one page per roster question (find-a-name filter, tick or rate each person, optional tie details inline under each person chosen), or for ego surveys the interview's names, describe and who-knows-whom steps; finally "Download my response" (then "Saved <file> to your downloads folder") and "Copy it as text instead". Name lookup tolerates a slip per word ("Deigo" finds Diego) and says when nobody matches (C11). The step count is fixed from the start (C16); "Clear my answers" replaces Start over (L15). Keyboard-only hints are hidden on phones and touch screens (`.ob-kbdonly`, `.ob-touchonly`), and matrix cells grow for fingers (C14, M16). A draft is kept in this browser (`orgsignal.respond.<surveyId>`, best effort); Start over deletes it. Works at phone width (the describe table becomes one block per person).

Data, Import also reads response files (importer `shared-survey`, docs/api/importers-a.md); loose response files dropped together become one input.
