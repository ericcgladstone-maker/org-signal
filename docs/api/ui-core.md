# ui-core: application shell and analysis views

Owner: ui-core. Code: `index.html`, `assets/app.css`, `src/ui/**` except `src/ui/build/**` and `src/ui/generate/**`. Tests: `test/ui-core/`.

## Running

Serve `app/` as static files (`python3 -m http.server 8787` from `app/`) and open `index.html`.

| URL flag | Effect |
|---|---|
| none | Real modules: import pipeline worker, analysis engine worker, LLM layer, exporters. |
| `?demo` | Real modules, plus a small synthetic organisation loaded at start (fake names, generated messages). `&n=5000` sets its size. |
| `?mock` | Development only. The demo engine and fake pipeline in `src/ui/services/mock.js` stand in for the engine and pipeline; the Ask view defaults to an offline demo provider whose `chat()` follows the provider contract, so the real analyst, citation check, reports and coding run without a network. |
| `&empty` | With `?mock` or `?demo`: start with nothing loaded (empty states). |

The Data view's empty state also offers "Load a small synthetic organisation", which loads the same demo data into the real engine.

## Shell and store

`src/ui/app.js` mounts the shell: masthead and primary navigation (Data, Network, People, Groups, Content, Time, Generate, Build, Ask, Methods & Export), the active view (lazy-loaded, so a failing module only breaks its own view), the construction settings drawer, notices, and the job status bar. The URL hash holds the view (`#network`).

`store.actions` (registered in `src/ui/actions.js`):

| Action | Behaviour |
|---|---|
| `loadDataset(ds, { mode: 'replace' \| 'add', name })` | With `add`, merges with the current dataset through `mergeDatasets`. Loads into the engine, builds with `defaultSettings`, computes node and network metrics, communities (ordered by size), applicability and the import report. Resolves when done; throws on failure. |
| `rebuild(settings)` | Rebuild the network and every metric with new construction settings. |
| `replaceDataset(ds)` | Load a derived dataset (identity merges, profile joins) and keep the list of loaded sources. |
| `setView(view)` | Switch view, update the hash, move focus to the view heading. |
| `select(nodes)` | Shared selection, dataset node indices. |
| `notify(level, text)` / `dismiss(id)` | Notices: `info`, `warn`, `error`. |
| `runJob(label, fn(signal, progress))` | Status-bar entry with progress and a Cancel button that aborts `signal`. |
| `openDrawer()` / `closeDrawer()` | Construction settings drawer. |

Store keys written by ui-core besides those in `store.js`: `report` (import report), `communities` (`{ membership (network order), modularity, count, sizes, ... }`, renumbered by size so colour slot 1 is the largest group), `applicability`, `metrics = { node: { metric: Float64Array (network order) }, network: {...}, meta }`, `network = { n, edgeCount, directed, nodeIds, summary, settings, version }`, `notices`, and `ui = { drawer, menuOpen, profile, profileFile }`. `store.llm` holds `provider`, `model` and `remember` only; API keys live in `src/llm/keys.js` `createKeyStore()` and never in the store.

## Services layer (`src/ui/services/`)

Every call into another owner's module goes through these adapters, so an API change touches one file.

**`engine.js`**: over `src/analysis/engine.js` `createEngine({ worker: true })`. Calls `load(ds)`, `build(settings, { signal, onProgress })`, `nodeMetrics({ which })`, `networkMetrics()`, `communities({ resolution, seed })`, `applicability()`, `graphForRender({ maxNodes: 6000, maxEdges: 60000 })`, `groups(attr, { membership })`, `ego(dsNode, { attr })`, `nullModel({ stats, reps, seed, attr, membership })`, `resampleRanks({ metric, reps, top, seed })`, `timeSeries({ window, metrics, attr })`, `detectShifts(series, { labels })`, `compareBeforeAfter(date, { metrics })`, `affect({ by, attr, window })`, `keywords({ by, attr, k })`, `topics({ k, seed })`, `diffusion({ terms } | { auto })`, `edgeEvidence(dsA, dsB, { limit, bothDirections })`, `glossary()`. `defaultSettings(ds)` comes from `src/analysis/index.js`. Views speak dataset node indices; the adapter keeps `nodeIds` and its inverse. `normaliseRender()` turns the render result into typed arrays with `nodeIds` (dataset) and `netIndex` (render index to network index, needed because the engine reorders and truncates).

**`pipeline.js`**: over `src/core/pipeline.js` `importInWorker(files, { choices, options, name, progress, signal, detectOnly })`, `src/core/report.js` `importReport`, `src/core/identity.js` `suggestMatches`, `src/core/merge.js` `mergeDatasets` / `applyMerges`, `src/importers/tabular.js` `suggestMapping` / `parseCSV`, `src/importers/profile.js` `joinProfiles`, `src/core/fileset.js` (to recover files the import left unclaimed, including inside zips, for the profile join). Each input (file, zip or folder) is detected and imported separately; several inputs are merged.

**`llm.js`**: over `src/llm/` (providers registry, `createKeyStore`, `createAnalyst`, `writeReport`, `coding.js`, `estimate.js`, `methods.js` `buildMethodsAppendix`). `analystEngine()` builds the tools engine interface from the UI engine adapter and translates two differences: tools pass network indices to `egoMetrics` (the engine takes dataset indices), and tools expect `edgeEvidence` to return an array.

**`exporters.js`**: over `src/exporters/{graphml,gexf,gml,pajek,ucinet,csv}.js`, each `exportX(ds, net, { nodeMetrics, communities })`. The full Network comes from the engine's `network()` if it returns edge arrays, otherwise from `buildNetwork(ds, settings)` on the main thread (deterministic, so it matches the views).

**`glossary.js`**: `gloss(key)` returns `{ label, meaning, reliability }` from the engine glossary, with fallbacks so no metric is shown without a meaning.

**`mock.js`**: the `?mock` stand-ins. `test/ui-core/services.test.js` checks on one dataset that every field the views read exists in both the mock and the real analysis results.

## Views

`src/ui/views/`: `data.js`, `drawer.js` (construction settings), `network.js`, `people.js`, `groups.js`, `content.js`, `time.js`, `ask.js`, `methods.js`, `external.js` (mounts `BuildView` from `src/ui/build/index.js` and `GenerateView` from `src/ui/generate/index.js`, lazily, with a "not available yet" state if either fails to load).

Shared pieces in `src/ui/components/`: `common.js` (tooltips, `MetricName` with glossary and applicability, flags, `useEngine` results cached per network version), `charts.js` (line, bar, histogram, heatmap, sparkline), `vtable.js` (virtualised table). `src/ui/lib/`: formatting, palette, dataset readers, Markdown rendering (to Preact nodes, never `innerHTML`), and the shared layout cache.

Rules the views follow: a measure with applicability `na` is hidden by default (People table toggle) or labelled; `caution` carries its reason; nothing is called a finding without a null-model or resampling basis shown beside it; colours never carry meaning alone (legends, labels, icon + text flags).

## Palette

`assets/app.css` overrides theme.css's provisional data palette with tokens validated against the site ground `#071A2B` (dataviz validator, OKLab, Machado 2009):

- **Categorical** `--cat-1..8`: `#13aa89 #bb881a #9470cd #d36757 #21a3bc #6ba04b #528ed9 #c96598`. Slot 1 is the mint accent family. Adjacent CVD dE 10.6, normal-vision dE 15.5, all inside the dark lightness band, at least 3:1 on the ground. The first three slots pass all-pairs. More than eight groups fold into "Other" (`--cat-other`).
- **Sequential** `--seq-0..5`: one hue (mint), lightness monotone, darkest step 2.15:1 on the ground.
- **Diverging** `--div-*`: blue to coral through a slate midpoint.

## QA

`node --test test/ui-core/` runs the unit tests. `test/ui-core/qa.mjs` drives Chromium (paths via `CHROME` and `PUPPETEER`): every view at 1440 and 390 px with `?mock`, the real engine with `?demo`, and a real import of the Slack fixture plus an HR table zipped together (pipeline worker, review, profile join of the unclaimed table). It fails on console errors, failed requests or horizontal overflow. `QA_BIG=1` adds a 5,000-person network through the real engine.
