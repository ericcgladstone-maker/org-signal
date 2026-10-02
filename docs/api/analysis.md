# Analysis engine API

Owner: analysis. Code: `src/analysis/**`, `src/workers/analysis.worker.js`. Tests: `test/analysis/`. References: `tools/analysis/make-references.py` writes `test/fixtures/analysis/*.json`.

Everything in `src/analysis` is plain ES modules that run in Node 24 and in a module Web Worker without a DOM. Pure functions are exported from `src/analysis/index.js`; `src/analysis/engine.js` runs them in a worker and keeps the dataset and the current network there.

## Conventions (read first)

**Index spaces.** There are two:

- **Dataset node index** `0 .. ds.nodes.count-1`. This is what the UI selection, `ds.nodes.labels[i]` and `ds.nodes.keys[i]` use.
- **Network node index** `0 .. net.n-1`. Only people included in the network have one. `net.nodeIds[v]` gives the dataset index of network node `v`. `net.index[i]` gives the network index of dataset node `i` (or `-1`).

| Where | Index space |
|---|---|
| `computeNodeMetrics()` arrays, `detectCommunities().membership`, `nullModel().nodes.*`, `Network.edges.src/dst` | network |
| `egoMetrics(net, node)` argument; its `node` and `alters` outputs | dataset |
| `edgeEvidence(ds, net, a, b)` arguments; `from`, `to` and `actor` in its output | dataset |
| `resampleRanks()[].node` | dataset |
| `timeSeries().node[metric][w]` and `.activity.node[w]` (length `ds.nodes.count`) | dataset |
| `compareBeforeAfter().node[m].topIncreases[].node`, `diffusion().terms[].adoptions[].node` / `.from` | dataset |
| `graphForRender()`: `nodes.ids` / `nodeIds` (dataset), `nodes.netIndex` (network); `edges.src/dst` index the render node arrays | as stated |
| `affect` / `keywords` / `topics` with `by: 'node'`: `key` | dataset |

**Missing values.** `NaN` means undefined (for example constraint for an isolate, or reciprocity on an undirected network). Over JSON it becomes `null`.

**Determinism.** Every stochastic step takes a `seed` (default 1): Louvain, null models, bootstrap, pivot sampling, LDA, layout and permutation tests. The same inputs and seed give identical output.

**Directed networks.** One network has one `directed` flag. Symmetric evidence (co-attendance, and every tie from a source with `source.directed === false`) is entered in both directions in a directed network. Clustering, k-core, eigenvector, constraint, effective size, communities, modularity and transitivity use the *symmetrised* network: a tie where either direction exists, with weight `w(a,b) + w(b,a)`.

**Weights.** `edges.raw` is the evidence total after rule weights. `edges.w` is `raw` after the weighting transform (`count`: raw; `log`: ln(1 + raw); `binary`: 1). Every weighted metric uses `w`. Weighted path measures use distance `1 / w`.

## Engine (`createEngine`)

```js
import { createEngine } from './src/analysis/engine.js';
const engine = createEngine({ worker: true });  // worker: false runs inline (Node, fallback)
await engine.load(dataset);                     // copies; { transfer: true } moves typed arrays (caller's copy detached)
const info = await engine.build(settings);      // { n, directed, nodeIds, summary, settings }
const m = await engine.nodeMetrics({ which: ['betweenness'] }, { onProgress: (fraction, message) => {}, signal });
engine.cancel();                                // terminate the worker; every pending call rejects with AbortError
engine.terminate();
```

Every method returns a Promise. Positional arguments follow the pure function, minus `ds` and `net` (which live in the worker). An optional trailing control object `{ onProgress, signal }` may follow; `onProgress` and `signal` are also accepted inside an options argument. If no network has been built, the first method that needs one builds it with `defaultSettings`.

| Method | Pure function | Notes |
|---|---|---|
| `load(ds, { transfer })` | | returns `{ nodes, events, contexts }` |
| `defaultSettings()` | `defaultSettings(ds)` | |
| `rules()` | | `{ rules: RULES, info: RULE_INFO }` |
| `glossary()` | | `GLOSSARY` |
| `build(settings)` | `buildNetwork(ds, settings)` | `{ n, directed, nodeIds, summary, settings }` |
| `network({ edges })` | | as `build`, plus the edge arrays if asked |
| `info()` | | `{ n, directed, edges: { count }, settings, summary }` |
| `nodeIds()` | | `Int32Array` network -> dataset |
| `nodeMetrics(opts)` | `computeNodeMetrics(net, opts)` | |
| `networkMetrics(opts)` | `computeNetworkMetrics(net, opts)` | |
| `communities({ resolution, seed })` | `detectCommunities` | also kept as the default partition for `nullModel` |
| `groups(attr, opts)` / `groupMetrics(attr, opts)` | `groupMetrics(net, ds, attr, opts)` | |
| `ego(node, { attr })` / `egoMetrics(node, { attr })` | `egoMetrics(net, node, { ds, attr })` | `node` = dataset index |
| `nullModel(opts)` | `nullModel(net, { ds, membership, ...opts })` | |
| `resampleRanks(opts)` | `resampleRanks(ds, currentSettings, opts)` | array |
| `applicability()` | `applicability(ds, net)` | |
| `timeSeries(opts)` | `timeSeries(ds, currentSettings, opts)` | |
| `detectShifts(series, opts)` | `detectShifts(series, { labels, ...opts })` | |
| `compareBeforeAfter(date, opts)` | `compareBeforeAfter(ds, currentSettings, date, opts)` | |
| `affect(opts)`, `keywords(opts)`, `topics(opts)` | same with `ds` | |
| `diffusion(opts)` | `diffusion(ds, net, opts)` | |
| `edgeEvidence(a, b, opts)` | `edgeEvidence(ds, net, a, b, opts)` | array |
| `graphForRender(opts)` | `graphForRender(net, opts)` | positions cached per network |
| `resetLayout()` | | forgets cached positions |

**Cancel.** `cancel()` terminates the worker and rejects every pending call with `name === 'AbortError'`. A call issued before `cancel()` but not yet posted also rejects. The next call starts a fresh worker and restores the dataset and the last settings first. An aborted `signal` calls `cancel()` if its call is in flight. A worker crash rejects pending calls, and the next call restores the same way. With `transfer: true` there is nothing to restore from, so call `load` again after a cancel.

**Progress.** Callbacks receive `(fraction 0..1, message)`. The worker forwards at most one progress message per 50 ms, plus the final 1. Progress comes from node metrics (each 1% of path sources), null-model and bootstrap replicates, time windows, sentiment, and LDA iterations.

**Worker protocol** (`src/analysis/host.js`, `attachWorker(scope)`): in `{ id, method, args }`; out `{ id, type: 'progress', fraction, message }`, `{ id, type: 'result', result }` or `{ id, type: 'error', error: { name, message, stack } }`. Results are structured-cloned.

## Construction

### `defaultSettings(ds)`

```js
{
  rules: { [rule]: { on, weight, evidence } },  // evidence = count found in this dataset
  //   rules.adjacency.windowMin (10), rules.copresence.normalize (true), rules.copresence.maxSize (default maxRecipients)
  directed, weighting: 'count' | 'log' | 'binary', minWeight: 0, maxRecipients: 25,
  time: { start: null, end: null },   // ms, [start, end)
  visibility: [...],                  // context visibilities to include; no context = 'unknown'
  media: null | [...],                // context medium, or source medium without a context
  excludeBots: true, excludeNodes: [] /* dataset indices */, includeIsolates: true,
}
```

Only rules whose evidence exists are on. Default weights are 1, except adjacency, which is 0.5 (an inferred tie). `buildNetwork` fills partial settings from the defaults.

**Directed default:** the network is undirected when non-directional evidence is half or more of all evidence. Non-directional evidence is copresence events plus targets from `directed: false` sources. Otherwise it is directed.

**Adjacency default:** adjacency is on when any `group_dm` or `chat` context has untargeted messages, or when at least 30% of messages in shared contexts name nobody.

### Rules

| Rule | Evidence (A -> B) |
|---|---|
| `reply` | role `reply`; or a message whose resolved `parent` is by B, when no `reply` target is given |
| `mention`, `dm`, `to`, `cc`, `bcc` | that role |
| `adjacency` | same context (not `email_thread`, `meeting`, `survey`, `canvas`), time order: an untargeted message by A directly after a message by B != A, within `windowMin`. Runs by one speaker count once. Addressed messages sit in the sequence but create no adjacency tie. There is no carry-over across time windows. |
| `copresence` | `copresence` events: all pairs among the actor plus `attendee`/`member` targets. Amount per pair is weight/(k-1) when `normalize`. Symmetric. Meetings above `maxSize` are dropped. |
| `declared` | role `declared`, or `subject` on a declared event; amount = event weight |
| `repost`, `like`, `follow`, `reaction` | event of that type: the `subject` target, or the author of the resolved parent |

The amount per piece of evidence is `event.weight` times the bootstrap multiplicity, and `raw = sum(rule.weight * amount)`. The same target and rule within one event counts once.

**Broadcast cutoff:** if an event addresses more than `maxRecipients` distinct people via `to`, `cc`, `bcc`, `dm` or `mention`, those roles create no ties for that event. `reply` still counts. `maxRecipients: 0` disables the cutoff.

**Bots:** bot actors' events are dropped and bot targets ignored.

### `buildNetwork(ds, settings) -> Network`

```js
{ n, directed, nodeIds: Int32Array(n), index: Int32Array(ds.nodes.count),
  edges: { count, src, dst,              // network indices; undirected: src < dst, one entry per tie
           w: Float64Array, raw: Float64Array,
           byRule: { [activeRule]: Float64Array },  // evidence amount per rule
           layerMask: Uint8Array },      // bit i = VISIBILITY[i]: public 1, private 2, direct 4, group 8, unknown 16
  settings,                              // normalised
  summary: { nodes, edges, isolates, directed, weighting,
             events: { considered, used, dropped: { bots, excluded, time, undated, visibility, media, broadcast, largeMeetings } },
             tiesBelowMinWeight, byRule: { [rule]: { ties, evidence } }, layers: { [visibility]: ties }, weight: { min, max, mean } } }
```

Edges are sorted by (src, dst). With `includeIsolates`, every eligible person is a node. Undated events count unless a time window is set.

### `edgeEvidence(ds, net, a, b, { limit = 50, bothDirections = false })`

Returns an array, oldest first: `{ event, t, type, rule, amount, from, to, actor, actorLabel, context, visibility, text (280 chars max) }`. In a directed network only a -> b is returned unless `bothDirections`.

### `networkFromEdges(n, [[a, b, w]], { directed, nodeIds })`

Builds a Network from an edge list. Duplicate ties are summed.

## Node metrics

`computeNodeMetrics(net, { which, approx = 'auto', approxThreshold = 3000, pivots, seed, onProgress })` -> `{ [metric]: Float64Array(n), meta }`. The metrics are:

`degree, inDegree, outDegree, strength, inStrength, outStrength, betweenness, betweennessWeighted, closeness, closenessWeighted, eigenvector, pagerank, clustering, coreNumber, reciprocity, constraint, effectiveSize, egoDensity`

- **Betweenness** is Brandes, normalised as `raw / ((n-1)(n-2))` for both directed and undirected networks (networkx `normalized=True`). The weighted version uses Dijkstra with distance 1/w and a relative tie tolerance of 1e-10.
- **Approximation.** For `n > approxThreshold`, betweenness and closeness are computed from `pivots` sampled sources (default `max(256, 10 sqrt n)`), scaled by n/k, and `meta.betweenness = { approximate: true, pivots, method, seed }`. Pass `approx: false` for exact values.
- **Closeness** is harmonic: `sum 1/d(u -> v) / (n-1)`, toward the node in directed networks.
- **Eigenvector** uses the symmetrised weighted network, unit norm, and power iteration on A + I. `meta.eigenvector = { converged, iterations, variant }`.
- **PageRank**: alpha 0.85, weighted, dangling mass spread uniformly.
- **Directed degree** = in + out.
- **Reciprocity** is NaN when undirected or for isolates.
- **Constraint and effective size** follow Burt with mutual weights, as networkx. Both are NaN for isolates.
- **egoDensity** equals clustering when undirected; on directed networks it is directed ties among alters / k(k-1).

## Network metrics

`computeNetworkMetrics(net, { pathSources, pathSampleThreshold = 2000, seed })` -> `{ nodes, ties, directed, density, reciprocity, transitivity, avgClustering, isolates, components, strongComponents (directed), largestComponentShare, avgPathLength, diameter, pathLengthSampled, degreeCentralization, strengthGini, meanDegree, degreeAssortativity }`.
`avgPathLength` is the mean over reachable ordered pairs: exact up to 2,000 nodes, 500 sampled sources above that.

## Communities

`detectCommunities(net, { resolution = 1, seed = 1 })` -> `{ membership: Int32Array(n), modularity, count, nontrivial, sizes[], resolution, seed }`. Louvain runs on the symmetrised weighted network. Ids are renumbered by first member. Modularity follows Newman 2004.

## Groups and ego

`groupMetrics(net, ds, attrKey, { maxGroups = 60 })` ->
`{ attr, type, coverage, nodesWithValue, values[], groups: [{ value, size, internalTies, externalTies, internalWeight, externalWeight, density, externalDensity, eiIndex }], mixing: { values, counts[g][h], weights[g][h], density[g][h] }, assortativity, assortativityWeighted, eiIndex, eiIndexWeighted, withinTies, betweenTies, numericAssortativity?, note? }`.

- Group labels (`values`, `groups[].value`) are the attribute's values as strings, sorted (numerically for numeric attributes).
- People without a value are excluded from every group statistic.
- The mixing matrix runs g -> h for directed networks and is symmetric for undirected ones.

`egoMetrics(net, node /* dataset */, { ds, attr })` -> `{ node, inNetwork, size, strength, tiesAmongAlters, density, effectiveSize, efficiency, constraint, alters[] (dataset) }`. With `attr` it adds `diversity` (Blau), `diversityNormalized`, `egoValue`, `homophily`, `homophilyWeighted`, `egoEI`, `composition[]` and `altersWithValue`.

## Uncertainty

`nullModel(net, { stats, reps = 100, seed = 1, swapsPerEdge = 10, ds, attr, membership, nodeStats })`

- Stats come from `NULL_STATS`: `reciprocity`, `transitivity`, `avgClustering`, `degreeAssortativity`, `attrAssortativity`, `eiIndex` and `modularity`. The attribute-based stats need `ds` + `attr`. Modularity uses the given `membership` or one Louvain run. Stats that do not apply are skipped.
- The model is degree-preserving rewiring of the binary graph: in/out-preserving target swaps when directed, double edge swaps when undirected. Simple graphs are kept, with `swapsPerEdge * m` attempts per replicate.
- Output: `{ [stat]: { observed, mean, sd, z, p, pUpper, pLower, lo, hi }, meta, nodes? }`.
  - `z = (observed - mean) / sd`.
  - `p` = two-sided empirical `(count(|null - mean| >= |observed - mean|) + 1) / (reps + 1)`.
  - `pUpper = (count(null >= obs) + 1) / (reps + 1)`.
  - `lo` / `hi` are the 2.5% / 97.5% null quantiles.
- `nodeStats: ['constraint', 'effectiveSize', 'betweenness' (n <= 1500)]` adds `nodes[stat] = { observed, mean, sd, z, pUpper }`, as Float64Arrays in network order.

`resampleRanks(ds, settings, { metric = 'betweenness', reps = 50, top = 10, seed = 1, approx, limit })` ->
`[{ node (dataset), label, value, rank, lo, hi, median, topShare, approximate? }]`, ordered by observed rank.

- It bootstraps events with replacement, rebuilds the network and recomputes the metric.
- `rank` is a competition rank (1 = highest).
- `lo` / `hi` are the 2.5% / 97.5% quantiles of the resampled rank.
- `topShare` is the share of resamples with rank <= `top`.

## Applicability

`applicability(ds, net)` -> `{ [key]: { level: 'ok' | 'caution' | 'na', reason, reasons[] }, _context }` for every node metric, plus `density, reciprocityNetwork, transitivity, avgClustering, avgPathLength, degreeCentralization, strengthGini, degreeAssortativity, communities, groups, ego, nullModel, resampleRanks, timeSeries, detectShifts, compareBeforeAfter, affect, keywords, topics, diffusion, hierarchy`. The worst level wins. It checks:

- source view (ego views make path measures `na`; chat, sample and authored views have their own rules);
- direction and weighting;
- copresence-only rules, adjacency, and undirected sources inside a directed network;
- size, components and isolates;
- attributes and their coverage;
- a manager attribute;
- timestamps and span;
- text coverage (sentiment always carries a caution).

`_context = { egoKeys, egoNodes (dataset), views, directed, weighting, components, isolates, nodes, timedShare, span, textShare }`. For ego views, lead with `egoMetrics` on `_context.egoNodes`.

## Time

`timeSeries(ds, settings, { window = 'week', step, start, end, metrics = ['degree', 'strength'], network = true, attr, maxWindows = 520, approx })`. `window` is `'day' | 'week' | 'month'` (UTC; weeks start Monday), a number of ms, or `{ size, step }` for rolling windows. Each window rebuilds the network from its events with the same settings.

```js
{ windows: [{ start, end, label, events, nodes, ties, coverage }],    // coverage = share of the window inside the data span
  node: { [metric]: [Float64Array(ds.nodes.count) per window] },     // DATASET index; absent: 0 for degree/strength types, NaN otherwise
  network: { [key]: number[] per window },                           // every numeric key of computeNetworkMetrics
  ties: { formed[], dissolved[], persisted[], jaccard[] },           // vs the previous window
  activity: { node: [Float64Array(ds.nodes.count) per window], total[], group?: { attr, values[], sizes[], counts[value][window] } },
  meta: { window, metrics, eventsInRange, undatedExcluded } }
```

`detectShifts(series, { method = 'robust' | 'cusum', threshold, nodeThreshold, baseline = 8, minBaseline = 4, minCoverage = 0.6, nodeMetric, topNodes = 200, networkMetrics, labels })` ->
`{ shifts: [{ target: 'network'|'group'|'node', id, label, metric, window, end, length, value, baseline, z | statistic, direction, start, windowLabel }], meta: { method, threshold, nodeThreshold, baseline, windows, seriesScanned, partialWindowsSkipped } }`.

- **Robust z** (default): compares each window with the median and MAD of the previous 8 windows, with threshold 3.5 (5 for node series). The scale has floors: 5% of the median, sqrt(median) for count series, and binomial noise for shares from the window's tie count (reciprocity uses m/2, transitivity m/3; density uses density/sqrt(m)).
- **CUSUM**: two-sided, k = 0.5, h = 6 (12 for node series), with the same floors.
- Partial windows (coverage < 0.6) are skipped.
- Series scanned by default: network `ties, density, reciprocity, transitivity, nodes`, `crossGroupShare` (when `timeSeries` got an `attr`: the share of ties between different values of it), tie retention (Jaccard with the previous window), ties formed, ties dissolved, total activity, activity per group, and the top node series. A reorg or a silo changes who talks to whom more than how much, so it shows up in cross-group share and tie retention.
- Group series use a stricter threshold, `groupThreshold` (4.5 robust, 9 CUSUM), because every group is scanned separately. Measured on 10 flat synthetic workplaces (2026-10-02): 0.1 false alarms per dataset; planted departure, silo, quiet team and consolidation found within 4 days, a planted reorg only partly.

`compareBeforeAfter(ds, settings, date, { span, metrics = ['degree', 'strength', 'betweenness', 'constraint'], attr, reps = 2000, seed })` ->
`{ date, span, before: { start, end, nodes, ties }, after, node: { [m]: { n, meanBefore, meanAfter, meanDiff, sdDiff, dz, p, topIncreases[], topDecreases[] } }, network: { [k]: { before, after, diff } }, ties: { formed, dissolved, persisted, jaccard }, groups?: [{ value, before, after, ratio }], meta }`.
`p` comes from a paired sign-flip permutation test; `dz` = mean difference / sd of differences.

## Content

These functions read message events with text; bots are skipped.

**Tokenizer** (`tokenize(text, { stopwords, minLength = 2, keepEmoji })`):
- applies NFKC and lowercases;
- drops Slack markup, URLs, emails, @mentions, `:emoji_codes:` and emoji;
- keeps hashtag words and drops possessive 's;
- removes English stopwords, minimal es/fr/de/pt/it/nl lists, and chat filler.

**`by` units:**
- `'overall'`
- `'node'`: key = dataset index
- `'group'`: needs `attr`; key = the value
- `'context'`: key = context index, label = context name
- `'visibility'`
- `'window'`: with `window`; key = window start in ms

`affect(ds, { by | [by...], attr, window, minMessages, maxMessages, perMessage })` ->
`{ coverage: { messages, withText, scored, likelyNonEnglish, sampled }, note, thresholds, by: { [by]: rows }, groups: rows (single by), perMessage? }`.
Each row is `{ key, label, n, mean (VADER compound), sd, se, pos, neg, neu, posShare, negShare }`. Scores are cached per dataset.

`keywords(ds, { by = 'node', attr, window, k = 10, minCount = 2, minTokens = 20, maxUnits = 300 })` ->
`{ by, units: [{ key, label, tokens, terms: [{ term, count, tfidf }] }], overall: [{ term, count, messages }], meta }`.
It uses TF-IDF over each unit's pooled text, with smooth idf `ln((1+U)/(1+df)) + 1`.

`topics(ds, { k = 10, seed, iterations = 150, alpha = 0.1, beta = 0.01, pool = 'none' | 'author-day', minTokens = 3, minDf, maxDfShare = 0.25, maxVocab = 5000, maxDocs = 150000, topTerms = 10, attr, window })` ->
`{ topics: [{ id, share, terms: [{ term, weight }], distinctive: [term] }], byNode: [{ key, label, n, shares[k] }], byGroup?, byWindow?, meta }`.
It is collapsed Gibbs LDA; `distinctive` ranks by relevance with lambda 0.6.

`diffusion(ds, net, { terms, auto = 8, minAdopters = 5, window, reps = 200, seed })` ->
`{ terms: [{ term, adopters, outsideNetwork, first, last, exposedShare, exposed, eligible, null: { mean, sd, z, pUpper, reps }, cascade: { roots, maxDepth, largest }, adoptions: [{ node, label, t, exposed, from, dt }] }], meta }`.

- A person adopts a term with their first message using it.
- An adoption is exposed if a neighbour in either direction used the term earlier (within `window` if set).
- The null shuffles adoption times among the same adopters.
- Automatic selection picks words new after the first 10% of the period that reach `minAdopters` people.

## Rendering

`graphForRender(net, { maxNodes = 3000, maxEdges = 30000, layout = true, iterations = 150, seed = 1, previous, labels })` ->
`{ directed, nodes: { count, ids (dataset), netIndex, strength, labels, x, y }, edges: { count, src, dst (render indices), w, layerMask, byRule }, truncated: { nodes, edges } }`, plus flat aliases `nodeIds, x, y, src, dst, w, byRule, layerMask`.

- Over budget, the strongest people and heaviest ties are kept.
- The layout is seeded ForceAtlas2 with fixed iterations (Barnes-Hut above 1,000 nodes).
- The engine caches positions: the same network and options give an identical result, and rebuilds warm-start from the previous positions.

## Changes from CONTRACTS.md

- Node metrics add `betweennessWeighted`, `closenessWeighted` and a `meta` key.
- `nullModel` results add `pUpper`, `pLower`, `lo`, `hi`, `meta` and an optional `nodes` key.
- `egoMetrics` takes a dataset index plus `{ ds, attr }`.
- `resampleRanks` and `edgeEvidence` return arrays; `edgeEvidence` has a `bothDirections` option.
- The Network adds `index`, `edges.raw` and `summary`. Settings add `excludeNodes` and `copresence.maxSize`.
- `groupMetrics` returns the richer shape above.
- Extra exports: `networkFromEdges`, `graphForRender`, `GLOSSARY`, `NODE_METRICS`, `NULL_STATS`, `RULES`, `RULE_INFO`, `makeWindows`, `tokenize`, `createRng`.
- **For llm:** pass dataset indices to `egoMetrics` (`nodeIds[ni]`).

## Validation

`python3 tools/analysis/make-references.py` builds seven reference graphs with networkx 3.2:
- karate club (weighted);
- directed weighted G(30, 0.12);
- K5 + C6 + P4;
- isolates;
- bipartite plus one edge;
- star;
- directed ego network.

It writes networkx's values for the weighted graph and its binary version. `test/analysis/reference.test.js` matches them to 1e-9 (1e-7 for eigenvector and pagerank), covering:
- degree, in/out degree and strength;
- betweenness, unweighted and weighted;
- harmonic closeness, unweighted and weighted;
- eigenvector, pagerank, clustering, core number and reciprocity;
- constraint and effective size;
- density, transitivity, average clustering, components, overall reciprocity, degree assortativity and average path length;
- modularity of a given partition, attribute assortativity and numeric assortativity.

All 28 checks pass.

**Intentional difference:** networkx compares float path lengths exactly. With distance 1/w, `1/3 + 1/6 != 1/2` in floating point, so it drops tied paths (karate node 0: 0.39489 instead of 0.39583). The engine uses a tolerance, and the reference script runs networkx with exact `Fraction` distances, which the engine matches.

Hand-computed checks are in `metrics.test.js`.

Run `node --test 'test/analysis/**/*.test.js'` (77 tests). Set `ORG_SIGNAL_SKIP_PERF=1` to skip the 12 s performance test.

## Performance (Node 24.19, Apple silicon, one thread)

| Task | Size | Time |
|---|---|---|
| buildNetwork | 100k events -> 95k directed ties | 47 ms |
| node metrics, exact, all (perf test) | 5,000 nodes, 56.5k undirected ties | 12.1 s, 205 progress calls, longest gap 95 ms |
| node metrics, exact, all | 5,000 nodes, 95k directed ties | 11.5 s |
| same, approx auto (632 pivots) | same | 1.7 s |
| network metrics / communities | same | 0.12 s / 0.13 s |
| nullModel, 100 reps, 4 stats | same | 26 s |
| resampleRanks degree, 50 reps / betweenness (approx), 20 reps | 100k events | 2.0 s / 7.9 s |
| affect (VADER) | 100k messages | 4.8 s, then cached |
| topics k = 10, 100 iterations | 100k docs, 800k tokens | 2.9 s |
| graphForRender FA2, 150 iterations | 3,000 nodes | 1.8 s |

## Known limits

- One `directed` flag per network; undirected-source ties are doubled when directed.
- Clustering is undirected and unweighted only.
- Nulls rewire the binary graph; directed swaps cannot reverse a triangle; connectivity is not preserved.
- The bootstrap treats events as independent.
- Adjacency reads order only.
- VADER is English-only; topics are exploratory; exposure is not influence.
- The dataset is copied to the worker by default.

## Metric glossary

These strings are shown in the UI verbatim, from `GLOSSARY` in `src/analysis/glossary.js`. Regenerate with `node tools/analysis/make-glossary.mjs`.

<!-- glossary:start -->
<!-- Generated by tools/analysis/make-glossary.mjs from src/analysis/glossary.js. Do not edit by hand. -->

### Node measures

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `degree` | Degree | How many people this person has a tie with. | Number of ties. Directed networks: in-degree + out-degree (a two-way tie counts twice), as networkx. | Any network. | Robust. Depends directly on the construction rules and the broadcast cutoff. |
| `inDegree` | In-degree | How many people direct messages, replies or nominations at this person. | Number of incoming ties. | Directed network. | Robust in full views; in one person's export only the owner's incoming ties are complete. |
| `outDegree` | Out-degree | How many people this person reaches out to. | Number of outgoing ties. | Directed network. | Robust in full views. |
| `strength` | Strength | Total volume of this person's ties: how much interaction, not just with how many people. | Sum of tie weights (in + out for directed networks). | Weighted network (count or log weighting). | Heavily skewed by a few very active ties; compare with degree. Log weighting dampens this. |
| `inStrength` | In-strength | Total volume of interaction directed at this person. | Sum of incoming tie weights. | Directed, weighted network. | As strength. |
| `outStrength` | Out-strength | Total volume of interaction this person initiates. | Sum of outgoing tie weights. | Directed, weighted network. | As strength. |
| `betweenness` | Betweenness | How often this person sits on the shortest route between two others: a potential bridge or bottleneck. | Brandes (2001). Share of ordered pairs (s, t) whose shortest paths pass through the node, split across tied paths: raw / ((n-1)(n-2)). Ties are not weighted. | A full view of the group; not meaningful for one person's export. | Sensitive to missing ties and to the construction rules; check the rank interval from resampling before calling someone a broker. Approximate (sampled sources) above 3,000 people unless exact is requested. |
| `betweennessWeighted` | Betweenness (weighted) | As betweenness, but routes prefer strong ties: a strong tie counts as a short step. | Brandes with Dijkstra, distance = 1 / weight; same normalisation. Equal-length paths are detected with a relative tolerance of 1e-10. | Weighted network; full view. | More sensitive than unweighted betweenness to the weighting choice (count vs log). |
| `closeness` | Closeness (harmonic) | How easily others can reach this person in few steps. | Harmonic closeness: sum over others of 1 / d(other, node), divided by n-1 (Marchiori and Latora 2000; Boldi and Vigna 2014). Unreachable people add 0. Directed: distances toward the node. | Full view. | Defined on disconnected networks, but people in small components score low partly because they cannot reach the rest. |
| `closenessWeighted` | Closeness (weighted) | As closeness, with strong ties counting as short steps. | Harmonic closeness with distance = 1 / weight, divided by n-1. | Weighted network; full view. | Scale depends on the weighting; compare people within one network only. |
| `eigenvector` | Eigenvector centrality | Connected to people who are themselves well connected. | Leading eigenvector of the symmetrised weighted adjacency matrix (w(a,b) + w(b,a)), unit Euclidean norm; power iteration on A + I so bipartite networks converge (as networkx). | A connected full view. Directed networks are symmetrised; use PageRank for a directional version. | Not comparable across components: scores outside the largest component shrink toward zero. Scores from different networks are on different scales; compare ranks, not values. |
| `pagerank` | PageRank | Receives attention from people who themselves receive attention (directional status). | Brin and Page (1998), damping 0.85, weighted, dangling nodes redistribute uniformly (as networkx). Sums to 1. | Directed network gives the directional reading; undirected gives a smoothed degree. | Values shrink as the network grows (they sum to 1); compare ranks across networks. |
| `clustering` | Clustering | How many of this person's contacts also know each other. | Local clustering coefficient on the symmetrised, unweighted network: ties among neighbours / (k(k-1)/2) (Watts and Strogatz 1998). | Full view (in one person's export, ties among their contacts are mostly invisible). | Undefined (0) for people with fewer than two contacts; meetings inflate it. |
| `coreNumber` | Core number | How deep in the densely connected core this person sits. | Largest k such that the person belongs to a subgraph where everyone has at least k ties (Batagelj and Zaversnik 2003), symmetrised network. | Full view. | Robust; coarse (integer). |
| `reciprocity` | Reciprocity | Share of this person's ties that go both ways. | 2 x \|in-neighbours AND out-neighbours\| / (in-degree + out-degree), as networkx. | Directed network. | Inflated when turn-taking (adjacency) ties are on. |
| `constraint` | Constraint | How much this person's contacts are tied to each other: high = embedded in one closed group; low = spans separate groups (Burt's structural holes). | Burt (1992): sum over contacts j of (p_ij + sum_q p_iq p_qj)^2, p = share of i's total mutual tie weight w(i,j) + w(j,i), as networkx. | Full view; weighted. | People with one contact always score 1. Use with effective size; check the per-person null model before calling someone a broker. |
| `effectiveSize` | Effective size | Number of non-redundant contacts: contacts who do not already know each other. | Burt (1992): sum over contacts j of (1 - sum_q p_iq m_jq), m = tie weight / j's strongest tie (as networkx). Unweighted undirected equals n - 2t/n (Borgatti 1997). | Full view; weighted. | Grows with degree; efficiency = effective size / degree compares people with different numbers of contacts. |
| `egoDensity` | Ego density | Share of possible ties among this person's contacts that exist. | Ties among alters / possible ties. Undirected: equals clustering. Directed: directed ties among alters / k(k-1). | Full view, or an ego-network survey with alter-alter ties. | Undefined with fewer than two contacts. |

### Network measures

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `density` | Density | Share of all possible ties that exist. | m / (n(n-1)) directed; 2m / (n(n-1)) undirected. | Full view. | Falls with network size by construction; compare networks of similar size only. |
| `reciprocityNetwork` | Reciprocity | Share of ties that are returned. | Reciprocated directed ties / all directed ties (networkx overall_reciprocity). | Directed network. | Compare with the null model: degree sequences alone produce some reciprocity. |
| `transitivity` | Transitivity | How often a friend of a friend is also a friend. | 3 x triangles / connected triples, symmetrised unweighted network. | Full view. | Meetings create cliques and inflate it; check the null model. |
| `avgClustering` | Average clustering | Average of each person's clustering. | Mean local clustering, people with fewer than two contacts counted as 0 (networkx). | Full view. | Dominated by low-degree people; transitivity weights by triples instead. |
| `components` | Components | Number of separate pieces: groups with no tie path between them. | Weakly connected components (isolates each count as one). | Any. | Very sensitive to the time window and filters. |
| `largestComponentShare` | Largest component | Share of people in the biggest connected piece. | Size of the largest weak component / n. | Any. | Robust. |
| `avgPathLength` | Average path length | Typical number of steps between two people who can reach each other. | Mean shortest-path length over reachable ordered pairs (unweighted). Exact up to 2,000 people, sampled from 500 sources above. | Full view. | Ignores unreachable pairs, so a fragmented network can look short. |
| `diameter` | Diameter | The longest shortest route between any two connected people. | Maximum finite shortest-path length (lower bound when sampled). | Full view. | Driven by a single path; fragile. |
| `degreeCentralization` | Degree centralization | How much ties concentrate on one person (1 = a star, 0 = everyone equal). | Freeman (1979): sum (max degree - degree_i) / ((n-1)(n-2)), symmetrised. | Full view. | Driven by the single most connected person; check who that is. |
| `strengthGini` | Strength inequality (Gini) | How unequally interaction volume is spread across people (0 = equal, 1 = one person has it all). | Gini coefficient of node strength. | Weighted network. | Isolates count as zeros and raise it. |
| `degreeAssortativity` | Degree assortativity | Whether well-connected people connect with each other (positive) or with the less connected (negative). | Newman (2002) Pearson correlation of degree across tie ends; directed: source out-degree vs target in-degree (networkx). | Full view. | Compare with the null model; hubs in small networks force negative values. |
| `modularity` | Modularity | How cleanly the network splits into groups with many ties inside and few between. | Newman (2004): sum_c [W_c/W - resolution (S_c/2W)^2], symmetrised weighted network. | Full view. | Louvain finds high modularity even in random networks; compare with the null model and other seeds. |
| `communities` | Communities | Groups of people more tied to each other than to the rest, found from the ties alone. | Louvain (Blondel et al. 2008) on the symmetrised weighted network, seeded; ids ordered by first member. | Full view. | Different seeds and resolutions give different splits; small communities are unstable. |

### Group measures

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `eiIndex` | E-I index | Whether ties mostly stay inside groups (toward -1) or cross them (toward +1). | Krackhardt and Stern (1988): (external - internal) / (external + internal) ties, people with a value only. | A categorical attribute with good coverage. | Depends on group sizes: big groups have more internal options. Compare with the null model. |
| `assortativity` | Attribute assortativity | Whether people tie to others in their own group more than chance mixing would give (1 = only within, 0 = random, negative = across). | Newman (2003) categorical assortativity from the tie-end mixing matrix (networkx attribute_assortativity_coefficient). | Categorical attribute. | Corrects for group size, unlike E-I; check the null model. |
| `numericAssortativity` | Numeric assortativity | Whether people tie to others with similar values (tenure, level). | Pearson correlation of the attribute across tie ends (networkx numeric_assortativity_coefficient). | Numeric attribute. | Linear only. |
| `groupDensity` | Within / between density | Share of possible ties that exist inside a group, or between two groups. | Ties / possible ties for that block of the mixing matrix. | Categorical attribute; full view. | Noisy for groups of a few people. |

### Ego measures

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `egoSize` | Network size | Number of distinct contacts. | Neighbours in the symmetrised network. | Any. | Robust. |
| `efficiency` | Efficiency | Share of contacts that are non-redundant. | Effective size / size. | Ties among contacts. | Undefined without contacts. |
| `diversity` | Contact diversity | How varied this person's contacts are on an attribute (0 = all alike). | Blau index 1 - sum p_k^2 over attribute values; normalised version divides by 1 - 1/K. | An attribute for contacts. | Depends on how many values the attribute has. |
| `homophily` | Same-group share | Share of this person's contacts who share their attribute value. | Contacts with the same value / contacts with a value. egoEI = (different - same) / total. | Attribute for ego and contacts. | Compare with the group's share of the population. |

### Uncertainty

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `nullZ` | z vs random | How far the observed value is from networks with the same degrees but random wiring, in standard deviations. | (observed - mean of randomised) / sd of randomised. Directed: in/out-degree-preserving edge swaps; undirected: double edge swaps (10 swaps per tie per replicate). | Enough ties to rewire. | Read together with p; with few replicates p cannot go below 1/(reps+1). |
| `nullP` | p vs random | Share of randomised networks at least as extreme as the observed one. | Empirical two-sided p = (count of \|null - mean\| >= \|obs - mean\| + 1) / (reps + 1). | As z. | Smallest possible value is 1/(reps+1). |
| `rankInterval` | Rank interval | Range of ranks this person gets when the events are resampled: a narrow range near the top is a finding; a wide one is not. | Bootstrap over events (resample with replacement, rebuild, recompute), 2.5th-97.5th percentile of rank. | Event data (not hand-drawn ties). | Measures sampling noise in the events, not missing data or construction choices. |
| `topShare` | Top-k share | Share of resamples in which this person is in the top k. | Count of resamples with rank <= k / reps. | As rank interval. | As rank interval. |

### Time

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `tieTurnover` | Tie turnover | Ties formed and dropped between consecutive windows, and the overlap. | Formed = new ties; dissolved = ties not seen again; Jaccard = kept / union. | Timestamps. | Short windows show churn that is just sampling; prefer weeks or months. |
| `shiftZ` | Shift (robust z) | How unusual a window is compared with the preceding windows. | (value - median of previous 8 windows) / (1.4826 x MAD), floored at 5% of the median; \|z\| >= 3.5 flags. CUSUM alternative: two-sided, k = 0.5, h = 5. | At least 4-8 windows of baseline. | Holidays and reporting gaps also produce shifts; check the events. |
| `dz` | Effect size (d_z) | Size of the average per-person change before vs after a date, in standard deviations of the changes. | Mean of paired differences / sd of differences; p from a sign-flip permutation test. | Timestamps on both sides of the date. | Not causal: anything else that changed at the date counts too. |

### Content

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `sentiment` | Sentiment (compound) | Average tone of messages from -1 (negative) to +1 (positive). | VADER compound score (Hutto and Gilbert 2014), averaged; positive >= 0.05, negative <= -0.05. | English message text. | Approximate: misses sarcasm, jargon and non-English text. Compare averages over many messages. |
| `tfidf` | Distinctive words (TF-IDF) | Words a person or group uses more than others. | tf (share of the unit's words) x smooth idf ln((1+U)/(1+df))+1 over units. | Message text. | Units with little text produce noisy lists. |
| `topics` | Topics (LDA) | Recurring clusters of words, and how much each person or period talks about each. | Latent Dirichlet allocation, collapsed Gibbs sampling (Griffiths and Steyvers 2004), seeded; alpha 0.1, beta 0.01. | Several hundred messages with text. | Exploratory: change k or the seed and topics change. |
| `exposedShare` | Exposed adoption | Share of people who started using a word after someone they are tied to had used it. | Adopters (after the first) with an earlier-adopting neighbour / adopters; compared with adoption times shuffled among the same adopters. | Timestamps, text and a full view. | Exposure is not influence: tied people share meetings and news. Trust only a clear excess over the shuffle null. |

<!-- glossary:end -->
