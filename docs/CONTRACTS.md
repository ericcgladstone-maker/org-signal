# Org Signal v2 — architecture and contracts

Org Signal turns raw relational traces (exports, surveys, hand-drawn networks, synthetic worlds) into a network you can defend, then measures and explains it. It is a working research instrument, not a demo. Everything here is binding for anyone writing code in `app/`.

## Principles

1. **Local by default.** Everything runs in the browser. Data leaves the machine only for LLM calls the user turns on.
2. **Full capability without an API key.** Import, building, measurement, content measures, generation, visualization and export never need an LLM.
3. **One internal format** (`src/core/model.js`). Every source writes it through `DatasetBuilder`; every analysis reads it.
4. **Construction is a visible choice.** Edge rules, weighting, direction and time windows are settings; any tie can be traced to its events.
5. **Know what kind of network this is.** Each source records its view (full / ego / chat / sample / authored) and context. Measures that don't apply are hidden or flagged.
6. **Say how sure.** Null models and resampling beside findings. Nothing fires just because something ranks first.
7. **Graystone aesthetic** (`assets/theme.css`, tokens from graystoneindustries.co).
8. **Scale target:** ~5,000 nodes and a few million events in the browser without freezing the tab. Heavy work runs in Web Workers; large files are streamed; beyond the target, warn and use labeled approximations.

## Technical rules

- Plain JavaScript ES modules, no framework build step. The app runs by serving `app/` as static files.
- Third-party code only from `vendor/` (prebuilt ESM bundles, see `vendor/VERSIONS.txt`): `preact.js` (exports `h, render, html` (htm), hooks), `graphology.js` (Graph, betweenness, closeness, eigenvector, pagerank, louvain, forceAtlas2, layout, shortestPath, modularity, degreeCentrality, edgeBetweenness, hits), `sigma.js` (WebGL graph renderer), `fflate.js` (zip write, inflate), `papaparse.js` (CSV), `postal-mime.js` (email parsing), `ical.js`, `atcute.js` (Bluesky CAR/CBOR/repo), `vader.js` (sentiment), `d3.js`, `sql-wasm-browser.js` + `.wasm` (SQLite). Import with relative paths, e.g. `import Papa from '../../vendor/papaparse.js'`. Do not add dependencies; if one is truly needed, say so in your report.
- **Everything outside `src/ui/` must run in Node 24 without a DOM** (no `document`, `window`), so it can be tested and run in workers. Browser-only APIs available in both: Blob, streams, TextDecoder, DecompressionStream, structuredClone, crypto.
- Workers are module workers: `new Worker(new URL('./x.worker.js', import.meta.url), { type: 'module' })`.
- Tests: `node:test` + `node:assert/strict`, files `test/<area>/*.test.js`, fixtures under `test/fixtures/<area>/`. Fixtures are synthetic (fake names) and small. No network access in tests. Run with `node --test 'test/<area>/**/*.test.js'`.
- Comments: explain *why*, at the density of `src/core/*.js`. No emoji anywhere (code, UI, output).
- Large ids (X, Discord, Gmail thread ids, Telegram) stay strings. Timestamps are ms since epoch UTC; unknown time is `NaN`.
- Never invent field names for a real format: the specs in `docs/formats/*.md` are the source of truth, including their UNVERIFIED notes. Where a spec says unverified, code defensively and say so in a comment.

## Data model (summary; `src/core/model.js` is authoritative)

- Nodes: namespaced key (`slack:U012`, `email:ann@x.org`, `x:12345`), label, attrs (any key/values), isBot, platformIds.
- Contexts: channel / dm / group_dm / thread / email_thread / meeting / chat / server / subreddit / survey / canvas …, with visibility (`public | private | direct | group | unknown`), medium and optional members.
- Events (columnar): `type` (`message | copresence | declared | reaction | repost | like | follow | join | leave`), `t`, `actor`, targets as `[node, role]` (`to | cc | bcc | mention | reply | dm | attendee | member | declared | subject`), `context`, `parent` (event index), `weight`, `text`, `source`.
- Importers put *who an event is directed at* into targets whenever the source says so: DM partners as `dm`, email recipients as `to/cc/bcc`, a reply's parent author as `reply` (even when the parent message itself is absent), meeting attendees as `attendee`, survey ties as `declared`, follows as `follow` event with the followed account as `subject` target.
- Sources: `{ format, family, medium, view, context, tz, fileNames, egoKey, counts, warnings }`. `view` is one of `VIEWS`. Set `egoKey` (the node key of the person whose export it is) for ego views when known.

## Module ownership

| Area | Path | Owner |
|---|---|---|
| Core model, zip, FileSet, registry, theme | `src/core/{model,zip,fileset}.js`, `src/importers/registry.js`, `assets/theme.css` | lead |
| Import pipeline, identity matching, merge, import report, tabular CSV mapper, profile (HR) join, workplace importers, network-file importers, all exporters | `src/core/{identity,merge,report,pipeline}.js`, `src/workers/import.worker.js`, `src/importers/{slack,teams,email,calendar,tabular,profile,network-files,network-canvas,survey}.js`, `src/importers/index.workplace.js`, `src/exporters/*` | importers-A |
| Online, personal, professional, community importers | `src/importers/{x-archive,x-research,bluesky,mastodon,threads,linkedin,whatsapp,imessage,telegram,meta,discord,reddit}.js`, `src/importers/index.personal.js` | importers-B |
| Analysis engine | `src/analysis/**`, `src/workers/analysis.worker.js` | analysis |
| Synthetic generator | `src/generator/**` | generator |
| LLM layer | `src/llm/**` | llm |
| UI and hand builders | `index.html`, `assets/app.css`, `src/ui/**`, `src/builders/**` | ui |

Each owner writes only inside their paths plus `test/<area>/` and `test/fixtures/<area>/`, and documents their public API in `docs/api/<area>.md`. If you need a change in someone else's file, describe it in your final report instead of editing it.

## Importer contract

See `src/importers/registry.js`. `detect(fs)` must be cheap (file names, `peek()` of a few KB). `import(fs, { builder, options, progress, signal })` must stream anything that can be large, call `builder.beginSource({ format, family, medium, view, context, tz, fileNames, egoKey })`, count what it read with `builder.stat()`, and record every skipped or suspicious thing with `builder.warn(code, message, count)`. Bots: set `isBot`. Each importer has tests against synthetic fixtures that follow its spec, including the quirks the spec lists.

## Analysis contract (implemented by analysis; consumed by ui, llm, generator)

Pure functions in `src/analysis/index.js`, plus `src/analysis/engine.js` which runs them in a worker and keeps the dataset and current network there.

```
defaultSettings(ds) -> ConstructionSettings
buildNetwork(ds, settings) -> Network
  settings = {
    rules: { reply, mention, dm, to, cc, bcc, adjacency, copresence, declared, repost, like, follow, reaction }  // each { on, weight } (+ adjacency.windowMin, copresence.normalize)
    directed, weighting: 'count'|'log'|'binary', minWeight, maxRecipients,
    time: { start, end }, visibility: [...], media: [...]|null, excludeBots, includeIsolates
  }
  Network = { n, nodeIds Int32Array (dataset node index per network node), directed,
              edges: { count, src, dst, w, byRule {rule: Float64Array}, layerMask Uint8Array }, settings, summary }
computeNodeMetrics(net, { which, approx }) -> { [metric]: Float64Array }
   degree, inDegree, outDegree, strength, inStrength, outStrength, betweenness, closeness (harmonic),
   eigenvector, pagerank, clustering, coreNumber, reciprocity, constraint, effectiveSize, egoDensity
computeNetworkMetrics(net) -> { density, reciprocity, transitivity, avgClustering, components, largestComponentShare,
                                avgPathLength, degreeCentralization, strengthGini, ... }
detectCommunities(net, { resolution, seed }) -> { membership Int32Array, modularity, count }
groupMetrics(net, ds, attrKey) -> { groups[], mixing, assortativity, eiIndex }
egoMetrics(net, node) -> { size, density, effectiveSize, constraint, diversity, homophily }
nullModel(net, { stats, reps, seed }) -> { [stat]: { observed, mean, sd, z, p } }
resampleRanks(ds, settings, { metric, reps, top, seed }) -> [{ node, rank, lo, hi, topShare }]
applicability(ds, net) -> { [metric]: { level: 'ok'|'caution'|'na', reason } }
timeSeries(ds, settings, { window, metrics }) -> { windows[], node{}, network{}, ties{ formed[], dissolved[] } }
detectShifts(series, opts) / compareBeforeAfter(ds, settings, date)
affect(ds, { by }) / keywords(ds, { by, k }) / topics(ds, { k, seed }) / diffusion(ds, net, { terms })
edgeEvidence(ds, net, a, b, { limit }) -> [event summaries]
```

Every metric is documented in `docs/api/analysis.md` with a one-line plain-language meaning and a reliability note (shown in the UI). Validation: values match networkx (python3 + networkx 3.2 are installed) on reference graphs, recorded as fixtures.

## Generator contract

```
listContexts() -> [{ id, label, media[], params schema, defaults }]
generate(spec) -> { dataset, groundTruth, files? }
  spec = { context, medium, size, seed, structure, timespan, observation: 'full'|'ego'|..., content: 'none'|'light'|'full', output: 'dataset'|'native', ...context params }
recoveryCheck(groundTruth, ds, net, results) -> report
```

`output: 'native'` writes real-layout export files (Slack zip, mbox, .ics, X archive, WhatsApp txt, LinkedIn CSVs, Telegram JSON, GraphML, ...) matching `docs/formats`, which must import cleanly through the importers. Ground truth records planted communities, bridges, hierarchy, affect and topic shifts, diffusion seeds, and the true network before observation.

## LLM contract

`src/llm/providers/{anthropic,openai,gemini}.js` share one interface: `{ id, label, defaultModel, listModels(key), chat({ key, model, system, messages, tools, onText, signal }) }`. `src/llm/analyst.js` answers questions by calling analysis-engine tools; it may only cite numbers the tools returned. `src/llm/reports.js` writes on-demand network, group and node reports. `src/llm/methods.js` builds the methods appendix deterministically (no LLM).

## UI

Single page (`index.html` → `src/ui/app.js`). Views: Data (sources, import report, identity review, profile join), Network, People, Groups, Content, Time, Generate, Build (ego, roster, perceived, draw), Ask (LLM), Methods and Export. Settings drawer for construction rules. All heavy work through the analysis engine and import worker with progress and cancel. Must work at phone width (no horizontal page scroll) though the primary target is a laptop.
