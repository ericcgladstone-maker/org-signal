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
- The perceived builder reads `store.get().dataset` and uses it as an optional reference network.
- Local storage keys are all wrapped in try/catch, and the views work without storage:
  - `orgsignal.build.tab`
  - `orgsignal.build.draw.draft`, `orgsignal.build.draw.settings`
  - `orgsignal.build.ego.session`
  - `orgsignal.build.roster`, `orgsignal.build.perceived`, `orgsignal.build.paste.text`
  - `orgsignal.generate.form`

## Dataset conventions (all builders)

| Builder | source.format | view | context | node keys | contexts (kind) |
|---|---|---|---|---|---|
| Draw | `draw` | full | custom | `draw:<id>` | one per tie type, `draw:type:<slug>` (canvas) |
| Ego | `ego-interview` | ego (`egoKey` = `ego:<egoId>`) | survey | `ego:<egoId>`, `alter:<egoId>:<uuid>` | one per name generator `ego:<egoId>:gen:<slug>` (survey), plus a "perceived ties" context |
| Roster | `roster` | full | survey | `roster:<slug>` | one per relation `roster:rel:<slug>` (survey) |
| Perceived | `css` | full | survey | `cs:<slug>` | one for the relation (survey) |
| Paste | `paste` | full | custom | `paste:<slug>` | `paste:ties` (canvas) |

- Every tie is a `declared` event: actor = sender, target role `declared`, `weight` = tie value.
- `source.directed` is set. It is an extra field that `beginSource` keeps. When it is `false`, each undirected tie is stored once and the analysis should symmetrise.
- Draw: in a drawing that mixes directed and undirected ties, undirected ties are written in both directions.
- Draw also writes `ds.meta.positions[nodeIndex] = [x, y]`, the hand layout. It is an addition beyond the contract; the Network view may use it as a starting layout, and other readers can ignore it.
- Ego: alter attributes are the interpreter answers, plus `kind` and `generators` (names joined with `;`). There is one ego→alter event for each generator that elicited the alter, placed in that generator's context. Alter–alter ties are one event per pair, as perceived by the ego. Event time is the session start.
- Roster in multi-respondent mode: each node gets a `responded` attribute, and non-respondents are recorded as a warning.
- Perceived: in the consensus view, the weight is the share of informants who reported the tie.

## src/builders/common.js

- `uid(prefix)`, `uuid()`, `rng(seed)`: ids, and a deterministic PRNG (mulberry32).
- `slug`, `normName`: key slugs, and name matching that ignores case, spacing and accents.
- `csvCell`, `toCSV(rows)`: RFC 4180 output. Like Network Canvas, cells starting with `= + - @` or a tab get a leading `'`.
- `coerce(value, type)`: typed field values. Blank becomes `undefined`.
- `ATTR_TYPES`, `uniqueLabel`.

## Draw: src/builders/draw.js, draw-snap.js, draw-layout.js; UI src/ui/build/draw/

**Document.** `{ version, name, nodes[{id,label,x,y,group,attrs}], edges[{id,source,target,type,weight,directed}], groups[{id,name}], attrColumns[{key,type}], edgeTypes[] }`. Every operation is pure (doc in, new doc out).

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

**UI:** `EgoBuilder()` has six steps:
1. Name generators
2. Name interpreters
3. Collect names (duplicates across questions are flagged)
4. Describe (fast table entry)
5. Who knows whom: sort people into settings, then fix exceptions on a canvas or in a filterable pair list
6. Review and export

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
- `accuracy(perceived, criterion, people)` returns `{ hits, misses, falseAlarms, correctRejections, hitRate, falseAlarmRate, jaccard }` over all ordered pairs with i ≠ j.
- `perInformantAccuracy(css, { threshold, reference })`: each informant scored against the consensus, and against a reference network if one is given.
- `disagreement(css)`: ties ranked by 4p(1−p).
- `referenceFromDataset(ds, people)`: the loaded network as a criterion, matched by name.
- `viewTies`, `viewLabel`
- `toDataset(css, { view: 'consensus' | 'las-union' | 'las-intersection' | <informantId>, threshold })`
- UI: `PerceivedBuilder()`, in four steps: people, informants, each informant's matrix (CSV import and export), and compare. The compare step has a threshold slider, the accuracy table, the most-disagreed ties, a selectable view with a preview, and hand-off.

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
  - `startRecovery({ seed, runId, groundTruth, dataset })`: the worker answers from its copy of run `runId`, or from the ground truth and dataset sent along.
- `src/ui/generate/run.js`: `runGenerate(spec, progress)` (native runs return `download`), `runRecovery(groundTruth, ds, { seed })` (passes `membership`, `nodeMetrics` and detected `shifts` to `recoveryCheck`).
- `src/ui/generate/pack.js`: `packNative(files, { name })` hands one file over as it is (the Slack, Takeout or X zip itself) and puts several files in one zip with any inner zip unpacked into a folder, so the download loads in Data as it is; `groundTruthJSON(gt)`, `readmeText(...)` for the README and ground-truth downloads offered after a native download.
- `src/ui/generate/generate.worker.js`: takes `{ type: 'generate' | 'recovery', id, ... }` and posts `progress`, `done`, `recovery` and `error` messages. It keeps the last "Generate and analyze" run for the recovery check.

**What the UI offers**
- Setting, medium, scenario (the generator's presets), size (number plus a logarithmic slider, with a note on what the browser handles comfortably), message text, what the export shows, days, start, seed, and advanced parameters taken from the generator's own schema.
- Choices that don't fit stay visible but disabled, with the reason as accessible text.
- **Generate and analyze**: generates with `output: 'dataset'` and hands the result off.
- **Download as native export files**: generates with `output: 'native'`, zips `files[{ path, bytes }]` and names the importer that reads them back.
- Progress bar and Cancel (Cancel terminates the worker).
- A recovery check panel after analysis.

## Tests and QA

- `node --test 'test/ui-build/**/*.test.js'` runs the unit tests for draw, ego, roster, perceived, paste and generate. The perceived tests check LAS, consensus, accuracy and disagreement against hand-computed numbers.
- `node test/ui-build/qa.mjs [--only=draw,ego,...] [--port=8791]` runs browser QA.
  - It serves the app, mounts `test/ui-build/harness.html` (BuildView and GenerateView standalone inside the shell's `.view.view--bare` frame with theme.css and app.css, and stubbed `store.actions`) in the cached Chromium through puppeteer-core, and runs `test/ui-build/qa/*.mjs` at 1440px and 390px.
  - A run fails on console errors, page errors, failed requests or horizontal overflow.
  - Screenshots are saved to the session scratchpad (`QA_OUT` overrides the location).
