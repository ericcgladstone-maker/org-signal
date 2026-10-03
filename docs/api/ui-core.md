# ui-core: application shell and analysis views

Owner: ui-core. Code: `index.html`, `assets/app.css`, `src/ui/**` except `src/ui/build/**` and `src/ui/generate/**`. Tests: `test/ui-core/`.

## Running

Serve `app/` as static files (`python3 -m http.server 8787` from `app/`) and open `index.html`.

| URL flag | Effect |
|---|---|
| none | Real modules: import pipeline worker, analysis engine worker, LLM layer, exporters. |
| `?demo` | Real modules, plus a small synthetic organization loaded at start (fake names, generated messages). `&n=5000` sets its size. |
| `?mock` | Development only. The demo engine and fake pipeline in `src/ui/services/mock.js` stand in for the engine and pipeline; the Ask view defaults to an offline demo provider whose `chat()` follows the provider contract, so the real analyst, citation check, reports and coding run without a network. |
| `&empty` | With `?mock` or `?demo`: start with nothing loaded (empty states). |

The Data view's empty state also offers "Load a small synthetic organization", which loads the same demo data into the real engine.

## Design system (UX pass 2026-10-02)

Tokens live in `assets/theme.css` (type, frame, site colors) and the data palette in `assets/app.css`; the shared classes below are in `assets/app.css`. View stylesheets (`views-*.css`, `build.css`) use these and keep no tokens or control styles of their own. Names are stable; ask F4 before adding a look-alike.

**Tokens.** Type: `--fs-h1` (view title, clamp 1.9-2.4rem), `--fs-h2` (section heading 1.125rem), `--fs-body` 1rem, `--fs-lead` 1.0625rem, `--fs-small` .875rem, `--fs-foot` .8125rem, `--fs-mono` .75rem with `--ls-mono` .12em, `--fs-mono-th` .6875rem with `--ls-mono-th` .08em (table headers), `--lh-body` 1.6. Frame: `--w-frame` 90rem, `--w-col` 62rem, `--measure` 66ch, `--pad-app`, `--header-h`, `--status-h`, `--target` 24px (minimum hit size). Colors: the site tokens (`--bg`, `--bg-deep`, `--text`, `--text-2`, `--text-muted`, `--rule`, `--rule-strong`, `--accent`, `--accent-dim`, `--edge`, `--node`) plus `--panel`, `--warn`, `--critical`.

**Frame.**
- `.view`: every view's root. The same 90rem centered wrap as the masthead, with `--pad-app` gutters. Never full-bleed.
- `.view--col`: a reading view (Data, Ask, Methods). Children cap at 62rem, left-aligned in the frame (same left edge as every other view).
- `.col` (one block capped at 62rem inside a full-width view), `.measure` (prose at 66ch), `.frame` (the wrap on its own).
- `html` has `scroll-padding-top` for the sticky header, so `scrollIntoView({ block: 'start' })` lands below it.

**View head.** `ViewHead` (components/common.js) renders `header.view__head > .grow > h1.view__title + p.view__intro`, then `.view__actions`. The title names the view exactly as the nav does. `.view__actions` holds a row of `.tlink`s and at most one `.btn--primary`.

**Actions** (design rule 4: at most one boxed primary per view; square corners everywhere).
- `.btn.btn--primary`: the one boxed primary action of a view (mint text, accent border).
- `.btn`: neutral boxed button, only for controls that are not actions in prose (dialog footers, Cancel in the status bar, zoom buttons). `.btn--sm`, `.btn--quiet` (icon buttons), `.btn--danger`.
- `.tlink`: every secondary action, on `<a>` or `<button>` (resets button chrome): weight 600, `--fs-small`, mint, `--accent-dim` underline. Modifiers: `.tlink--arrow` (→, when it navigates), `.tlink--down` (↓, downloads), `.tlink--quiet` (ink instead of mint), `.tlink--danger`. Disabled via `disabled` or `aria-disabled="true"`. `.tlinks` lays several out in a wrapping row.
- Buttons need `type="button"` unless they submit a form (A26).

**Labels and text.**
- `.label`: mono section label (uppercase, .75rem, .12em, muted). Section labels, metadata and captions only; never a form label.
- `.meta`: mono metadata in the same spec.
- `.section` + `.section__title` (or `.section > h2`): section heading, 1.125rem/600.
- `.field > span` or `.field__label`: form field labels, sans .8125rem muted, sentence case.
- `.prose`, `.small`, `.basis` and `.foot` (footnotes, muted .8125rem), `.reading` (plain-language reading with a mint rule). All cap at `--measure`.

**Inputs** (design rule 5).
- `.input`, `.select`, `textarea.input`: `--panel` fill, 1px `--rule-strong` border, radius 0, .875rem. `.select` draws its own chevron; use it on every `<select>` (the `Select` component does).
- `.check`: label wrapping a checkbox or radio plus text.
- All `input[type=checkbox]` and `input[type=radio]` are drawn by the theme (1rem square or round, accent fill when checked, no OS grey). No class needed.
- `.radios` (a `fieldset`, with `legend`) holding `.radio` rows (`label.radio > input + span` with an optional `.radio__desc`; `.radio--disabled` with the reason in the description): for more than five choices or choices that need a description.
- `.seg`: up to five choices. Buttons with `aria-pressed`; it sizes to its content (`width:auto`), never stretches. The `Seg` component renders it.

**Tabs.** `.tabs` with `button[role=tab][aria-selected]` (or `a[aria-current=page]`): .875rem `--text-2`; the active tab is `--text`, 600, with a 2px mint underline.

**Dialogs.** `.dialog-backdrop > .dialog` (with `.dialog__head`): modal dialogs sit above the masthead and the drawer and scroll inside the viewport, so a title and Close are never under the header.

**Notices and focus** (store.actions, see below). `notify()` stacks at the bottom right, above the status bar and above any bar a view keeps stuck to the bottom of the window: mark such a bar with `data-sticky-bottom` (the Data view's `.dv-actions` is recognized as is).

**Virtualized table.** The shared `.vt` rules (keyboard row cursor tint, first-cell padding, `.vt--more-left/right` side fades, header info buttons, wrapping header labels) live in `app.css`.

**Data color** (design rule 9). Every group in every view uses `--cat-1..8` in fixed order and `--cat-other` for the rest (read them with `tokens()` / `categoricalScale()` in `src/ui/lib/palette.js`). A single series uses `--cat-1`. Text never takes a series color. See "Palette" below for validation and the all-pairs limit.

**Many groups** (`src/ui/lib/grouping.js`). `groupColoring(groups, { missing })` takes the groups in their fixed order (by size over the whole dataset, then name; communities by number) and is used by the Network map, its legend and SVG/PNG export, and the Groups table; `communityScale` (People swatches) folds the same way. The eight largest take the eight hues. Past eight the map is in highlight mode: the rest share `--cat-other` as "Other groups (N groups, M people)", the legend lists every group with its count (scrolling, the folded ones indented under the Other row), and choosing a row (hover, keyboard focus, click or Enter to pin, arrow keys between rows) lights that group, or all of Other, in the accent while everything else dims. Attribute groups of at least 1% of the people (`groupLabelMin`) are named on the map where most of their members sit (`groupAnchors` in `lib/labels.js`), with a halo and collision culling; communities keep their number badges. "Not recorded" (no value) is never folded into Other: it has its own darker gray (`tokens().missing`, `--cat-missing` if defined, else `#243039`: OKLab dE >= 10.7 from Other and >= 18.8 from every slot under every simulation), a ringed swatch, its own legend row and its own words.

**Default grouping.** `defaultGroupAttr(ds, { communities })` in `src/ui/lib/dsutil.js` decides what Network colors by, what Groups opens on, and (through `preferredAttributes`, which lists it first) which attribute columns People shows: a department-, division- or team-like attribute with 2-8 values; else a 3-15 value one (`defaultGrouping` in `src/analysis/groups.js`) unless the communities are coarser; else the communities. The generator's `planted_group` is never the default.

**Mint budget.** Mint (`--accent`) marks the current location, the one primary action, links and focus. Not headings, not data, not decoration.

**Words.** American spelling, sentence case, "person/people" and "tie(s)", dates `6 Jan 2025`, weeks "week of 6 Jan 2025".

## Shell and store

`src/ui/app.js` mounts the shell: masthead and primary navigation in workflow order (decision 2: **Get a network** Data · Build · Generate | **Explore** Network · People · Groups · Content · Time | **Report** Methods & Export · Ask | **Learn**), the Explanations switch, the active view (lazy-loaded, so a failing module only breaks its own view), the construction settings drawer, notices, and the job status bar. The URL hash holds the view (`#network`).

`store.actions` (registered in `src/ui/actions.js`):

| Action | Behaviour |
|---|---|
| `loadDataset(ds, { mode: 'replace' \| 'add', name })` | With `add`, merges with the current dataset through `mergeDatasets`. Loads into the engine, builds with `defaultSettings`, computes node and network metrics, communities (ordered by size), applicability and the import report. Resolves when done; throws on failure. |
| `rebuild(settings, { quiet })` | Rebuild the network and every metric with new construction settings. Communities keep their numbers by overlap with the previous partition. Unless `quiet`, a notice states the before/after counts, how many people changed community and which settings changed (also stored as `lastRebuild = { at, lines, changes }`). |
| `replaceDataset(ds)` | Load a derived dataset (identity merges, profile joins) and keep the list of loaded sources. |
| `setView(view)` | Switch view, update the hash, move focus to the view heading. `setView('learn/<key>')` opens Learn at that concept. Hash parameters after `?` are kept when the view does not change (views read them themselves). |
| `select(nodes)` | Shared selection, dataset node indices. |
| `notify(level, text, { timeout, detail, action })` / `dismiss(id)` | Notices: `info`, `warn`, `error`, at the bottom right. Errors stay until dismissed; info (6 s, 10 s with `detail`) and warnings (12 s) pause while the pointer or focus is in the stack. `detail` is a list of lines, `action` is `{ label, onClick }` shown as a text link. |
| `announce(text)` | Speak through the shell's permanent polite live region (`#announcer`). Jobs announce start, quarter marks, phase changes (at most every 2.5 s) and the end on their own. |
| `focus(target, { fallback, scroll })` | After an action, move focus to a selector or element once the view has re-rendered; falls back to the view heading. The shell also moves focus to the heading whenever the focused control is removed and focus would drop to the page body. |
| `startOver()` | Clear everything loaded in this tab (dataset, network, results, `generated`, notices), remount the views and return to Data. The masthead's "Clear loaded data" asks first. Builders say "New ..." for their own drafts. |
| `setExplain(on)` | The Explanations switch: sets `store.explain` and keeps the choice as the one localStorage preference (`orgsignal.explain`, wrapped in try/catch; default on). |
| `loadSample()` | Load the sample organization (the Data view's `SAMPLE_SPEC` through Generate's `generateAndAnalyze`, with its recovery check). Returns to the view it was called from (Generate hands off to Network). Resolves `true` when loaded. Use it for every "explore the sample" link. |
| `runJob(label, fn(signal, progress))` | Status-bar entry with progress and a Cancel button that aborts `signal`. |
| `openDrawer()` / `closeDrawer()` | Construction settings drawer. |

Respondent mode: when the address is `#survey=1.<data>` (a share link) or `#respond` (a survey file), `boot()` mounts `src/ui/build/respond/index.js` instead of the shell: no navigation, actions, engine or leave warning, only the survey (docs/api/ui-build.md, Shared surveys). A survey link pasted into a running tab reloads into that mode.

Shell behavior: the masthead shows "Analyzing: <short name>" with "Clear loaded data" whenever data is loaded (a row under the bar below 1280px, with `--header-h` growing to match); leaving or reloading the page with data loaded asks first (`beforeunload`); `document.title` is "<View> · <dataset> · Org Signal".

`VIEWS` (actions.js) entries are `{ id, label, group, desc, purpose?, shows? }`: `desc` is the one line under each link in the phone menu and the link title on desktop; `purpose` (a question) and `shows` (2-3 things) feed `NeedsData` and `ViewHead`. `parseHash(hash) -> { view, key }`. Content and Time links stay live but show a muted "no text" / "no dates" when the loaded data cannot feed them.

Store keys written by ui-core besides those in `store.js`: `methodsLog` (analyses run on the current network, recorded by `services/engine.js` and read by the methods appendix: `{ groups, nullModel, resampling, time, affect, keywords, topics, diffusion }`, each a list of the options used; cleared on load and rebuild), `lastRebuild`, `epoch` (bumped by Start over), `llm.codes` (Ask: send names as codes, default on), `report` (import report), `communities` (`{ membership (network order), modularity, count, sizes, ... }`, renumbered by size so color slot 1 is the largest group), `applicability`, `metrics = { node: { metric: Float64Array (network order) }, network: {...}, meta }`, `network = { n, edgeCount, directed, nodeIds, summary, settings, version }`, `notices`, and `ui = { drawer, menuOpen, profile, profileFile }`. `store.llm` holds `provider`, `model` and `remember` only; API keys live in `src/llm/keys.js` `createKeyStore()` and never in the store.

## Beginner support: shared components (round 2)

All in `src/ui/components/common.js`. Use these rather than local look-alikes; they respect the Explanations switch where noted and are styled in `app.css`.

**`Term({ k, children?, label? })`**: a term with a dotted underline. Click, tap, Enter or Space opens a popover with the plain meaning from the glossary (`src/analysis/glossary.js`, aliases `z`, `p`, `seed`, `community`, `distance`) and "More in Learn" linking to `#learn/<key>`. Closes on outside click and Escape. Inline anywhere, including inside sentences: ``html`Most often on the route between others (<${Term} k="betweenness" />)` `` or ``html`<${Term} k="tie">ties</${Term}>` ``. Terms always render (the switch hides explanations, not words).

**`HowToRead({ means, scale, example, mistake, title?, open?, children? })`**: a "How to read this" disclosure (closed by default; `open` to start open): what the number means, what counts as big or small, one sentence from the live data that the caller builds (`example`), and one common mistake. Each part optional. Renders nothing when Explanations is off.

**`NeedsData({ title, purpose?, shows?, view? })`**: the empty state for a view that needs a network (L4). States the view's question and what it will show (defaults from the view's `VIEWS` entry, found by `title` or `view` id), then "Explore the sample" (primary; `store.actions.loadSample()`, stays on this view), "Draw or type a small network" (Build), "Analyze your own exports" (Data), and "Learn the ideas". `<${NeedsData} title="Groups" />` is enough.

**`Verdict({ verdict, plain?, details?, level? })`**: verdict-first statistic (decision 5): the plain sentence (`.verdict__claim`), then the number in plain words (`.verdict__plain`), then the technical basis (`.basis`, always shown). `level` adds a flag before the verdict.
Helpers for the sentence:
- `pAtFloor(p, reps)`: p is the smallest value the test can give, 1/(reps+1).
- `nullInWords(p, reps, { what = 'random networks' })`: "none of the 200 random networks came this close (p ≤ 1/201)" at the floor, else "7 of the 200 random networks came this close (p = 0.040)". `what` for other nulls ("shuffled timelines").
- `pShort(p, reps)`: "p ≤ 1/201" or "p = 0.040", for tables and basis lines.
- `chanceWords(z, { more, less })`: "about what chance gives" (|z| < 2), "more than chance", "far more than chance" (|z| ≥ 4), or with `less`.

**Explanations switch.** `store.explain` (boolean, default true; `useExplain()` reads it; `store.actions.setExplain(on)` sets it). A quiet "Explanations: on/off" control in the masthead (in the phone menu, at the end) and in Learn. When off: `HowToRead` blocks and any gloss you mark as an explanation are hidden. The always-shown measure glosses (`MetricName gloss`, profile and whole-network rows) stay.

**`ViewHead({ title, intro, actions, purpose? })`**: intros lead with the view's purpose (L18). Without `purpose`, a view in `VIEWS` with a `purpose` gets it prefixed when the intro does not already ask a question; pass your own question as `purpose`, or `purpose={false}` for none.

**Flags carry their reason (C8).** `Flag({ level, reason?, iconOnly? })`: with `reason`, the flag is a button that opens the reason on click, tap or Enter. `MetricName` and `MetricInfo` do this for applicability. `applicabilityView(ap) -> { level, reason, small }` drops "Very small network" from the flag (it applies to every measure of a tiny network) and the tooltip says it once, calmly (`SMALL_NETWORK_NOTE`, M7). Show one small-network note per view yourself if you need it.

**Context-filtered tooltips (L17).** `MetricName`/`MetricInfo` tooltips open on hover, focus, click or tap; they show the plain meaning first, then only the reliability clauses that can apply (`reliabilityFor(text, dataContext(ds, net))`: nothing about 3,000+ people or Spearman on small networks, no construction rules, broadcast cutoff or resampling for hand-entered ties, no one-person-export caveat without an ego source).

**Popovers close on outside click and Escape (M10).** `useDismiss(open, onClose(why), [refs])` for your own popovers (`why` is `'escape'` or `'outside'`; return focus on Escape), `useDetailsDismiss(ref)` for a `<details>` used as a menu (People > Columns), and `Pop({ trigger, label, className, children, wide })` for a click-to-open popover.

**Notices keep off maps (C14).** Besides `data-sticky-bottom`, mark any area notices must not cover with `data-notice-avoid` (the Network map `.net` is recognized as is). The stack moves above or below it, or collapses to one line (tap to read).

**Device hints and downloads (C14).** `useTouch()` is true on coarse-pointer screens: say "Tap" instead of "Click" and leave out keyboard-only tips there. `download(data, filename, mime, { quiet })` now confirms with a "Downloaded <filename>." notice (a phone shows no download bar); identical notices are shown once, so a view that already announces the same text is not doubled.

### Learn (`#learn`, `src/ui/views/learn.js`, `src/ui/views/learn/**`)

Concepts (every glossary entry, grouped; meaning from the glossary, plus where you see it, how to read it and the common mistake from `learn/concepts.js` `TEACH`), figures for degree, betweenness, closeness, clustering, constraint, two-mode networks and projections (`learn/diagrams.js`; two-mode figures draw events as squares, as Build and Network do), a "Two-mode (affiliation) networks" section (`twoMode`, `affiliation`, `projection`, `borgattiEverett` and the two-mode measures), "Find it in the app" (`TASKS`, mapped to assignments A1-A12) and worked examples (`EXAMPLES`). Each concept has an anchor: link to `#learn/<glossary key>` (or an alias).

**Learn links to Build examples.** Learn emits `#build?example=<id>` with these ids: `two-cliques-broker`, `path-and-star`, `ring-small-world`, `class-friendships`, `clubs-two-mode`, `ego-10`. Build reads `example` from `location.hash` (`new URLSearchParams(location.hash.split('?')[1])`) and opens that example; the shell keeps the parameter while the view is Build.

## Two-mode networks (`src/ui/lib/twomode.js`)

When the data is two-mode (`twoModeOf(ds)`, docs/CONTRACTS.md: actors tied only to the events or groups they belong to), `settings.twoMode` is set and the network in the store carries `network.twoMode = { view: 'two-mode' | 'mode0' | 'mode1', labels: [l0, l1], mode (Uint8Array per network node), counts, basis, projection, minShared }` (from `engine.build()`). Every view uses the data's own mode names (e.g. "Women", "Events"), and the kind of node is always said in words or shape, never color alone.

- **Construction drawer.** A "Two-mode" section above the rules: the network to analyze ("Women and events (two-mode)", "Women tied by shared events", "Events tied by shared women"); for a projection, the tie weight (number shared, Newman 1 / (size - 1), present or absent) with a one-line explanation each, and a minimum number shared, with the resulting sentence (`projectionSentence`). Direction is disabled and explained. Terms link to `twoMode`, `affiliation`, `projection`, `borgattiEverett`.
- **Network, two-mode view.** Layout `Two columns` (default up to 150 nodes), `Two rows` or `Force-directed` (`layoutOptions`, `defaultLayout`; the render is cached per network and arrangement in `lib/render-cache.js`, `getRender(version, arrange)`); columns and rows are stretched to the frame and everyone is named up to 150 nodes. Mode-1 nodes are drawn as squares (a square variant of the bordered node program, also in SVG/PNG export). Color by "Kind of node" is the default (`nodeColoring` with `colorBy: 'mode'`); the legend reads "Women (circles)", "Events (squares)". "Who stands out" is per mode by two-mode degree, betweenness and closeness (`perModeStandouts`). The whole-network panel adds the counts per mode, two-mode density, Robins-Alexander and average Latapy clustering (per mode too) and Barber's modularity; one-mode measures that do not apply are left out, and the random-network comparison is replaced by the reason it does not apply. The fragility panel is not shown (one-mode betweenness mixes the two kinds). The selection panel shows the kind and the two-mode measures.
- **Network, projection.** The intro states what a tie means ("two women are tied when they share at least one of the events; tie weight = the number of events they share"); a projected tie's evidence lists the affiliations behind it with "Shared: E8".
- **People.** A "Show" filter (both kinds, or one), a "Kind" column, the two-mode measures as the default columns (sorted by two-mode degree), and a line saying to rank each kind among its own. The profile names the kind. The `bipartite` attribute is never listed as an attribute (`withoutModeAttr`).
- **Measure words.** `measureNote(key, { twoMode })` explains each two-mode measure with the mode names and sizes; the four are unit measures (three decimals).

## Services layer (`src/ui/services/`)

Every call into another owner's module goes through these adapters, so an API change touches one file.

**`engine.js`**: over `src/analysis/engine.js` `createEngine({ worker: true })`. Calls `load(ds)`, `build(settings, { signal, onProgress })`, `nodeMetrics({ which })`, `networkMetrics()`, `communities({ resolution, seed })`, `applicability()`, `graphForRender({ maxNodes: 6000, maxEdges: 60000 })`, `groups(attr, { membership })`, `ego(dsNode, { attr })`, `nullModel({ stats, reps, seed, attr, membership })`, `resampleRanks({ metric, reps, top, seed })`, `timeSeries({ window, metrics, attr })`, `detectShifts(series, { labels })`, `compareBeforeAfter(date, { metrics })`, `affect({ by, attr, window })`, `keywords({ by, attr, k })`, `topics({ k, seed })`, `diffusion({ terms } | { auto })`, `edgeEvidence(dsA, dsB, { limit, bothDirections })`, `glossary()`. `defaultSettings(ds)` comes from `src/analysis/index.js`. Views speak dataset node indices; the adapter keeps `nodeIds` and its inverse. `normaliseRender()` turns the render result into typed arrays with `nodeIds` (dataset) and `netIndex` (render index to network index, needed because the engine reorders and truncates).

**`pipeline.js`**: over `src/core/pipeline.js` `importInWorker(files, { choices, options, name, progress, signal, detectOnly })`, `src/core/report.js` `importReport`, `src/core/identity.js` `suggestMatches`, `src/core/merge.js` `mergeDatasets` / `applyMerges`, `src/importers/tabular.js` `suggestMapping` / `parseCSV`, `src/importers/profile.js` `joinProfiles`, `src/core/fileset.js` (to recover files the import left unclaimed, including inside zips, for the profile join). Each input (file, zip or folder) is detected and imported separately; several inputs are merged.

**`llm.js`**: `pseudonymize(ds)` and `decodeNames(text, ds)` implement the Ask view's "Replace names with codes": the analyst, reports and coding get a copy whose keys and labels are `P1..Pn`, identifying attribute columns (name, email, phone, manager, id...) and email-like values removed, and every text the engine returns (tie evidence, keywords, topics, affect) and the question with the data's names replaced and email addresses removed; answers are decoded locally. Over `src/llm/` (providers registry, `createKeyStore`, `createAnalyst`, `writeReport`, `coding.js`, `estimate.js`, `methods.js` `buildMethodsAppendix`). `analystEngine()` builds the tools engine interface from the UI engine adapter and translates two differences: tools pass network indices to `egoMetrics` (the engine takes dataset indices), and tools expect `edgeEvidence` to return an array.

**`exporters.js`**: `fileBase(ds)` gives the short file-name stem used for every download (D17). Also over `src/exporters/{graphml,gexf,gml,pajek,ucinet,csv}.js`, each `exportX(ds, net, { nodeMetrics, communities })`. The full Network comes from the engine's `network()` if it returns edge arrays, otherwise from `buildNetwork(ds, settings)` on the main thread (deterministic, so it matches the views).

**`glossary.js`**: `gloss(key)` returns `{ label, meaning, reliability }` from the engine glossary, with fallbacks so no metric is shown without a meaning.

**`mock.js`**: the `?mock` stand-ins. `test/ui-core/services.test.js` checks on one dataset that every field the views read exists in both the mock and the real analysis results.

## Views

`src/ui/views/`: `data.js`, `learn.js`, `drawer.js` (construction settings), `network.js`, `people.js`, `groups.js`, `content.js`, `time.js`, `ask.js`, `methods.js`, `external.js` (mounts `BuildView` from `src/ui/build/index.js` and `GenerateView` from `src/ui/generate/index.js`, lazily, with a "not available yet" state if either fails to load).

Shared pieces in `src/ui/components/`: `common.js` (tooltips, `MetricName` with glossary and applicability, flags, `useEngine` results cached per network version), `charts.js` (line, bar, histogram, heatmap, sparkline), `vtable.js` (virtualised table). `src/ui/lib/`: formatting, palette, dataset readers, Markdown rendering (to Preact nodes, never `innerHTML`), and the shared layout cache.

Rules the views follow: a measure with applicability `na` is hidden by default (People table toggle) or labelled; `caution` carries its reason; nothing is called a finding without a null-model or resampling basis shown beside it; colors never carry meaning alone (legends, labels, icon + text flags).

## Palette

`assets/app.css` holds the data palette, validated against the site ground `#071A2B` and `--bg-deep` `#051521` with the dataviz validator (OKLab, Machado 2009, all pairs):

- **Categorical** `--cat-1..8`: `#228f61 #9f74f8 #dd5d94 #b48d17 #4a9ec6 #5055d3 #8c5485 #bc4001`. All 28 pairs pass: worst protan/deutan dE 8.3, tritan 8.7, normal vision 15.5, all inside the dark lightness band and at least 3:1 on the ground. Any slot may touch any other, so the network map uses all eight before folding. Slot 1 is the accent's green-mint family. More than eight groups fold into "Other groups" (`--cat-other` `#444c52`, a quiet gray at least dE 9.7 from every slot under every simulation; always labeled). "Not recorded" is `#243039` (see Many groups above).
- **Sequential** `--seq-0..5`: one hue (mint), lightness monotone, darkest step 2.15:1 on the ground. `--seq-zero` `#0d2a35` is a near-ground step for "none" (matrices).
- **Diverging** `--div-cool-2, --div-cool-1, --div-mid, --div-warm-1, --div-warm-2`: blue to coral through a slate midpoint. The old `--div-neg-*` (cool) and `--div-pos-*` (warm) names remain as aliases until the views move over.
- Search and validation scripts: `SCRATCH/ux/fix-f4/search.mjs`, `report.mjs`.

## QA

`node --test test/ui-core/` runs the unit tests. `test/ui-core/qa.mjs` drives Chromium (paths via `CHROME` and `PUPPETEER`): every view at 1440 and 390 px with `?mock`, the real engine with `?demo`, and a real import of the Slack fixture plus an HR table zipped together (pipeline worker, review, profile join of the unclaimed table). It fails on console errors, failed requests or horizontal overflow. It also loads Davis's Southern Women (two-mode, built from `test/fixtures/accuracy/davis-southern-women.json`) into the real engine at 1440 and 390 px and checks the two-mode intro, the mode legend, the per-mode standouts, the column layout, People's mode filter and the drawer's switch to a projection. `QA_BIG=1` adds a 5,000-person network through the real engine.
