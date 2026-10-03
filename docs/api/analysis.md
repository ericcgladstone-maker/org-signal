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

**Directed networks.** One network has one `directed` flag. Symmetric evidence (co-attendance, and every tie from a source with `source.directed === false`, except turn-taking ties, which keep their direction) is entered in both directions in a directed network. Clustering, k-core, eigenvector, constraint, effective size, communities, modularity and transitivity use the *symmetrised* network: a tie where either direction exists, with weight `w(a,b) + w(b,a)`.

**Weights.** `edges.raw` is the evidence total after rule weights. `edges.w` is `raw` after the weighting transform (`count`: raw; `log`: ln(1 + raw); `binary`: 1). Every weighted metric uses `w`. Weighted path measures use distance `1 / w`. Event weights are stored as 32-bit floats (`DatasetBuilder`), so a tie weight of 0.1 from an event becomes 0.10000000149 (relative error below 6e-8).

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
| `nullModel(opts)` | `nullModel(net, { ds, membership, ...opts })` | results cached per network (see Uncertainty); `{ cachedOnly: true }` reads them without a run |
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
  tieFields: { weight: null, filters: [] },  // tie fields (events.attrs), see below
  twoMode: null | { view: 'two-mode' | 'mode0' | 'mode1', projection: 'count' | 'newman' | 'binary', minShared: 1 },
                                      // two-mode data only (twoModeOf(ds)); see "Two-mode networks"
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
| `declared` | role `declared`, or `subject` on a declared event, or (with neither) the author of the resolved parent; amount = event weight. Role `member` on a declared event is an affiliation (two-mode data, `addAffiliation`): the same rule, symmetric (both directions in a directed network). |
| `repost`, `like`, `follow`, `reaction` | event of that type: the `subject` target, or the author of the resolved parent |

The amount per piece of evidence is `event.weight` times the bootstrap multiplicity, and `raw = sum(rule.weight * amount)`. The same target and rule within one event counts once.

**Broadcast cutoff:** if an event addresses more than `maxRecipients` distinct people via `to`, `cc`, `bcc`, `dm` or `mention`, those roles create no ties for that event. `reply` still counts. `maxRecipients: 0` disables the cutoff.

**Bots:** bot actors' events are dropped and bot targets ignored.

### Tie fields (`settings.tieFields`, `tieFieldPlan(ds, tieFields)`)

Events may carry tie fields (`events.attrs`: tie type, strength, how often, reported as ...; see CONTRACTS.md).

- `weight: key`: an event that has the field contributes its value instead of `event.weight`: a number as is, an ordered choice its position in the declared options (first = 1), several values their highest. Events from sources that carry the field but leave it blank keep `event.weight` (counted in `summary.tieFields.weightMissing`); events from other sources are untouched.
- `filters: [{ key, values?, min?, max?, keepMissing? }]`: each applies only to events from sources that carry the field (declared in `source.tieFields` or seen on one of their events), so filtering a survey's tie type leaves a Slack export alongside it alone. Such an event passes when one of its values is in `values` and within `[min, max]`; a blank value fails unless `keepMissing`. All filters must pass. Dropped events are counted in `summary.events.dropped.tieField` and `summary.tieFields.filtered`.
- Applied in `forEachEvidence`, so bootstrap, time windows and `edgeEvidence` agree with `buildNetwork`.

`edgeTieAttributes(ds, net)` replays the evidence and returns the tie fields behind each network edge: numbers averaged, choices and text as distinct values joined by `; ` (used by the exporters and available to tie panels).

### `buildNetwork(ds, settings) -> Network`

```js
{ n, directed, nodeIds: Int32Array(n), index: Int32Array(ds.nodes.count),
  edges: { count, src, dst,              // network indices; undirected: src < dst, one entry per tie
           w: Float64Array, raw: Float64Array,
           byRule: { [activeRule]: Float64Array },  // evidence amount per rule
           layerMask: Uint8Array },      // bit i = VISIBILITY[i]: public 1, private 2, direct 4, group 8, unknown 16
  settings,                              // normalised
  summary: { nodes, edges, isolates, directed, weighting,
             events: { considered, used, dropped: { bots, excluded, time, undated, visibility, media, broadcast, largeMeetings, tieField } },
             tieFields: { weight, filters, filtered, weightMissing },
             tiesBelowMinWeight, byRule: { [rule]: { ties, evidence } }, layers: { [visibility]: ties }, weight: { min, max, mean } } }
```

Edges are sorted by (src, dst). With `includeIsolates`, every eligible person is a node. Undated events count unless a time window is set.

### `edgeEvidence(ds, net, a, b, { limit = 50, bothDirections = false })`

Returns an array, oldest first: `{ event, t, type, rule, amount, from, to, actor, actorLabel, context, visibility, text (280 chars max), attrs }` (`attrs`: the event's tie fields or `null`). In a directed network only a -> b is returned unless `bothDirections`. On a projection (two-mode data) a tie has no events of its own: the result is the evidence of the affiliations a and b share, each with `via` (the shared node, dataset index) and `viaLabel`.

### `networkFromEdges(n, [[a, b, w]], { directed, nodeIds })`

Builds a Network from an edge list. Duplicate ties are summed.

## Two-mode networks

Representation (`src/core/model.js`, CONTRACTS.md): node attribute `bipartite` 0 / 1, `source.twoMode = { labels }`, affiliations as declared events with a `member` target (`addAffiliation`). `twoModeOf(ds)` says whether a dataset is two-mode (declared, or every non-bot node has `bipartite` 0/1 and both occur, as in a networkx file).

**Construction** (`settings.twoMode`, filled by `defaultSettings` for two-mode data; `null` for one-mode data, and `twoMode: null` given explicitly builds the ordinary one-mode network of every node and tie):

- `view: 'two-mode'` (default): actors and events, ties only between the modes, always undirected (`directed` is forced false). Ties within a mode (a survey tie between two people) and nodes with no mode are left out and counted in `summary.twoMode.sameModeEvidence` / `unknownModeEvidence`. Rule weights, tie fields, time windows, bots, `minWeight` and the weighting apply to the affiliation ties as usual.
- `view: 'mode0'` / `'mode1'`: the one-mode projection onto that mode. Two nodes are tied when they share at least `minShared` (default 1) affiliations that survive the filters above; every node of the mode stays (isolates with `includeIsolates`), the other mode leaves. Weight (`edges.raw`, then the weighting transform gives `w`): `projection: 'count'` = shared affiliations (Breiger 1974; networkx `weighted_projected_graph`), `'newman'` = sum over shared nodes y of 1 / (deg(y) - 1) (Newman 2001; `collaboration_weighted_projected_graph`), `'binary'` = 1 (`projected_graph`). An affiliation counts once however heavy (as networkx). `edges.shared` holds the shared count; `byRule` is empty; `layerMask` is the union of the two affiliations' layers. Pairs below `minShared` are counted in `summary.twoMode.belowMinShared`.
- The Network gains `twoMode = { view, labels, mode: Uint8Array(n), counts: [n0, n1], basis (-1, 0 or 1), projection, minShared, affiliations, sameModeEvidence, unknownModeEvidence, belowMinShared }` (and `summary.twoMode` without `mode`); `engine.build()` / `info()` return it.

**Measures on the two-mode view** (`src/analysis/twomode.js`, `TWO_MODE_METRICS`; computed by `computeNodeMetrics` by default on two-mode views and never on other networks). All unweighted, matching networkx.algorithms.bipartite (`docs/accuracy.md`, section 8):

| Key | Definition |
|---|---|
| `twoModeDegree` | degree / number of nodes of the other mode |
| `twoModeBetweenness` | Brandes betweenness over unordered pairs / the Borgatti-Everett (1997) maximum for the node's mode, (1/2)[m^2(s+1)^2 + m(s+1)(2t-s-1) - t(2s-t+3)], s, t = divmod(n - 1, m) (n = own mode size, m = other); NaN when that maximum is 0. Pivot-sampled above `approxThreshold`, like betweenness. |
| `twoModeCloseness` | (m + 2(n - 1)) / (sum of distances to reachable nodes) x (reachable - 1) / (N - 1); 0 for isolates. Classic, not harmonic, closeness. |
| `twoModeClustering` | Latapy, Magnien and Del Vecchio (2008), "dot": mean over nodes v two steps away of \|N(u) and N(v)\| / \|N(u) or N(v)\|; 0 with nobody two steps away |

`computeNetworkMetrics` adds on two-mode views: `twoModeDensity` = ties / (n0 n1), `robinsAlexander` = 4 x four-cycles / three-paths (Robins and Alexander 2004; 0 below 4 nodes or 3 ties), `twoModeAvgClustering` (mean Latapy), `twoModeAvgClusteringByMode`, `modeCounts`, `modeLabels`, `fourCycles`, `threePaths`. One-mode measures are still computed; applicability marks which ones mean nothing there.

**Applicability on the two-mode view:** clustering, transitivity, average clustering, ego density (always 0: no triangles), constraint and effective size (contacts are never tied to each other), one-mode density, degree centralization and degree assortativity are `na` with reasons naming the modes; betweenness, closeness, eigenvector, PageRank and core number are `caution` (the two modes are not comparable on one scale); the null model is `na` (one-mode rewiring would create ties within a mode, and `nullModel` returns no statistics there); communities carry a caution saying how they were found. The two-mode measures are `na` everywhere else. On a projection, clustering, transitivity, constraint, effective size and ego density are `caution` (each shared node becomes a clique) and so is the null model.

**Communities** on the two-mode view (`detectCommunities`): Louvain on the mode-0 projection (shared-affiliation counts), the usual practice (Borgatti and Halgin 2011); each mode-1 node joins the community most of its members are in (ties: lower id), and mode-1 nodes nobody shares get their own. Ids are renumbered by first member. `modularity` is the projection's Newman modularity; `barberModularity` is Barber's (2007) bipartite modularity of the joint partition, sum_c [W_c/W - (K_c/W)(D_c/W)] over unweighted ties; `method` says so. `{ twoMode: 'bipartite' }` runs plain Louvain on the two-mode ties instead. `barberModularity(net, membership)` is exported for any partition. On projections communities are ordinary one-mode communities.

**Rendering:** `graphForRender` adds `nodes.mode`, `modeLabels` and `twoModeView` for two-mode data; `arrange: 'columns' | 'rows'` places each mode on its own side, ordered by eight barycenter sweeps to reduce crossings (two-mode view only; otherwise ForceAtlas2).

**Other functions:** `projectNetwork(net, basis, how)` (projection of a two-mode Network, used by communities), `twoModeBetweennessMax(n, m)`, `isTwoModeView(net)`, `twoModeNodeMetrics`, `twoModeNetworkMetrics`. Time series, resampling, before/after and edge evidence run on two-mode data through `buildNetwork`, so every window or replicate is built with the same view and projection.

## Node metrics

`computeNodeMetrics(net, { which, approx = 'auto', approxThreshold = 3000, pivots, seed, onProgress })` -> `{ [metric]: Float64Array(n), meta }`. The metrics are:

`degree, inDegree, outDegree, strength, inStrength, outStrength, betweenness, betweennessWeighted, closeness, closenessWeighted, eigenvector, pagerank, clustering, coreNumber, reciprocity, constraint, effectiveSize, egoDensity`

- **Betweenness** is Brandes, normalised as `raw / ((n-1)(n-2))` for both directed and undirected networks (networkx `normalized=True`). The weighted version uses Dijkstra with distance 1/w and a relative tie tolerance of 1e-10.
- **Approximation.** For `n > approxThreshold`, betweenness and closeness are computed from `pivots` sampled sources (default `max(256, 10 sqrt n)`), scaled by n/k, and `meta.betweenness = { approximate: true, pivots, method, seed }`. Pass `approx: false` for exact values. The estimate is unbiased; measured on 40 graphs of 800-5,000 people (`docs/accuracy.md`): betweenness Spearman 0.90-0.99 with the exact values, closeness 0.95-0.998, but where values are close (random and block graphs) only 40-80% of the top 10 by betweenness are the same people and the largest error is up to half the largest value. On directed networks where few people can reach each other (tree-like) it is unreliable (Spearman ~0.5). Use exact values to name brokers.
- **Closeness** is harmonic: `sum 1/d(u -> v) / (n-1)`, toward the node in directed networks.
- **Eigenvector** uses the symmetrised weighted network, unit norm, and power iteration on A + I (at most 1,000 iterations). When the two leading eigenvalues are nearly equal (two separate heavy ties or two similar components, common with count weights) power iteration stalls, and restarted Lanczos from the last iterate finishes it; the limit is the same vector (the uniform start projected on the leading eigenspace). People without ties get exactly 0. `meta.eigenvector = { converged, iterations, method: 'power' | 'power, then Lanczos', variant }`.
- **PageRank**: alpha 0.85, weighted, dangling mass spread uniformly.
- **Directed degree** = in + out.
- **Reciprocity** is NaN when undirected or for isolates.
- **Constraint and effective size** follow Burt with mutual weights, as networkx. Both are NaN for isolates. networkx 3.2 also returns NaN for a directed node with only incoming ties (it tests `len(G[v])`, the successors); the engine computes them.
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

`nullModel(net, { stats, reps = NULL_REPS (200), seed = 1, swapsPerEdge = 10, ds, attr, membership, nodeStats, cachedOnly })`

- Stats come from `NULL_STATS`: `reciprocity`, `transitivity`, `avgClustering`, `degreeAssortativity`, `attrAssortativity`, `eiIndex` and `modularity`. The attribute-based stats need `ds` + `attr`. Stats that do not apply are skipped.
- The model is degree-preserving rewiring of the binary graph: in/out-preserving target swaps when directed, double edge swaps when undirected. Simple graphs are kept, with `swapsPerEdge * m` attempts per replicate.
- **Modularity re-runs community detection on every replicate** (since 2026-10-03, N2). Each rewired network goes through Louvain (seed `modularity|<seed>|<replicate>`) and the best modularity found is recorded; the observed value is what the same search finds on the observed ties. Weights are ignored on both sides, like every null statistic. With `membership` (the partition the views show, found on weighted ties), `modularity.partition` gives that partition's modularity on the unweighted ties, for reference only. The old null kept the observed partition fixed on the rewired networks; its mean is near 0 for any degree sequence, so every partition looked significant (on 300 networks drawn from the null itself, 100% had p <= 0.05; now 4-5%, `docs/accuracy.md`). Louvain finds modularity of 0.2-0.4 in sparse random networks, which is what the new null mean shows.
- Output: `{ [stat]: { observed, mean, sd, z, p, pUpper, pLower, lo, hi, replicates }, meta, nodes? }`.
  - `z = (observed - mean) / sd`.
  - `p` = two-sided empirical `(count(|null - mean| >= |observed - mean|) + 1) / (reps + 1)`; its floor is `meta.pFloor = 1 / (reps + 1)` (1/201 at the default). Say "none of the 200 random networks came this close (p <= 1/201)" at the floor, never "p = 0.005".
  - `pUpper = (count(null >= obs) + 1) / (reps + 1)`.
  - `lo` / `hi` are the 2.5% / 97.5% null quantiles.
  - `eiIndex.groups = [{ value, observed, mean, sd, z, p, lo, hi, replicates }]`: each group's E-I against its rewired expectation, in `attrCodes` value order (the Groups table's "E-I if random").
  - `modularity.partition` (with `membership`).
- `meta = { reps, seed, swapsPerEdge, acceptedSwapShare, pFloor, model, binary, modularity?, attr?, cached? }`.
- `nodeStats: ['constraint', 'effectiveSize', 'betweenness' (n <= 1500)]` adds `nodes[stat] = { observed, mean, sd, z, pUpper }`, as Float64Arrays in network order. Node statistics are not cached.

**One run, shared by every view (N3).** `NULL_REPS = 200` is the one replicate count for every null-model comparison (Network panel, Groups reading, reports, Ask). Results are cached per Network object and statistic, keyed by `reps`, `seed`, `swapsPerEdge` and, for the attribute statistics, the attribute and its values. The replicate chain depends only on the seed, so a statistic computed in a later call has exactly the values it would have had in a joint call, and a call returns the same object whether or not another view ran it first. A rebuild makes a new Network and so a fresh cache. Through the engine the cache lives in the worker with the network, so:

```js
// Network view: its four statistics (200 replicates by default)
const nm = await engine.nullModel({ stats: ['reciprocity', 'transitivity', 'avgClustering', 'modularity'], membership });
// Groups: modularity comes back from the same run, at once
const q = await engine.nullModel({ stats: ['modularity'], membership });
// Show what is already there without starting a run (no rewiring at all):
const peek = await engine.nullModel({ stats: ['modularity', 'transitivity'], cachedOnly: true });
peek.meta.cached;   // ['modularity', 'transitivity'] or a subset; absent stats are simply missing
```

Pass the same `reps` and `seed` (or leave both out) to share a run; a different `reps` is a different test.

**Runtime** (Node 24.19, Apple silicon, 200 replicates; rewiring dominates, Louvain adds the rest):

| Network | modularity alone | transitivity + clustering | |
|---|---|---|---|
| 150 people, 3.6k directed ties | 1.8 s | 1.6 s | |
| 400 people, 4k ties | 2.5 s | 1.8 s | the generated online network (392 people, 8.2k ties) takes 2.5 s in the browser worker |
| 1,000 people, 7.5k ties | 5.4 s | 3.6 s | |
| 2,000 people, 24k directed ties | 17 s | 11 s | |
| 5,000 people, 25k ties | 24 s | 12 s | |

A second view asking for a cached statistic gets it in a few milliseconds.

`resampleRanks(ds, settings, { metric = 'betweenness', reps = 50, top = 10, seed = 1, approx, limit })` ->
`[{ node (dataset), label, value, rank, lo, hi, median, topShare, approximate? }]`, ordered by observed rank.

- It bootstraps events with replacement, rebuilds the network and recomputes the metric.
- `rank` is a competition rank (1 = highest).
- `lo` / `hi` are the 2.5% / 97.5% quantiles of the resampled rank.
- `topShare` is the share of resamples with rank <= `top`.

## Default grouping

`groups.js`: `defaultGrouping(ds)` -> attribute key or `null` (use detected communities). It takes an attribute with 3 to 15 values, known for at least half the people, named like a department, team or group (best first: dept/department, team, group, division/unit/section/class); hand-drawn groups (`group` from a `draw` source) win with two or more values. `isBookkeepingAttr(a)` marks fields that describe the record, not a group (booleans, `is_*`/`has_*`, responded, deleted, admin, tz...), which are never defaults.

## Applicability

`applicability(ds, net)` -> `{ [key]: { level: 'ok' | 'caution' | 'na', reason, reasons[] }, _context }` for every node metric, plus `density, reciprocityNetwork, transitivity, avgClustering, avgPathLength, degreeCentralization, strengthGini, degreeAssortativity, communities, groups, ego, nullModel, resampleRanks, timeSeries, detectShifts, compareBeforeAfter, affect, keywords, topics, diffusion, hierarchy`. The worst level wins. It checks:

- source view (ego views make path measures `na`; chat, sample and authored views have their own rules; several personal chat sources (one person's WhatsApp, Telegram or iMessage export: `family` or `context` personal, chat or ego views, more than one source) make path measures `na` because the owner is in every chat and connects them by construction, and caution constraint and effective size (the owner's are low and high largely by construction) as well as density, clustering, communities, groups and the null model (C3); a single chat keeps the single-conversation wording; ego-network interviews (`format: 'ego-interview'`) get interview wording: direction, in-degree and reciprocity are `na` because the respondent reports every tie, and ties among the people named are flagged as perceived; ego sources also caution `groups` and `nullModel`);
- direction and weighting;
- copresence-only rules, adjacency, and undirected sources inside a directed network;
- size, components and isolates;
- attributes and their coverage;
- a manager attribute;
- timestamps and span;
- text coverage (sentiment always carries a caution).

`_context = { egoKeys, egoNodes (dataset), views, directed, weighting, components, isolates, nodes, timedShare, span, textShare }`. For ego views, lead with `egoMetrics` on `_context.egoNodes`.

## Time

`timeSeries(ds, settings, { window = 'week', step, start, end, metrics = ['degree', 'strength'], network = true, attr, maxWindows = 520, approx })`. `window` is `'auto' | 'day' | 'week' | 'month'` (UTC; weeks start Monday), a number of ms, or `{ size, step }` for rolling windows. Each window rebuilds the network from its events with the same settings, except that a window holds only the people with a tie in it (`includeIsolates` off) and undated events are left out (`meta.undatedExcluded`), so a single window spanning the data equals `buildNetwork` with `includeIsolates: false` and `time` set to the data's span. Network metrics per window take path lengths from 200 sampled sources above 200 people; `meta.pathLengthSampledWindows` and `meta.approximateWindows` (pivot-sampled node metrics) list the windows concerned. A calendar unit that would exceed `maxWindows` is coarsened (week to month, then fixed-length windows) instead of throwing; `meta.windowReason` says so.

Helpers in `time.js`:
- `chooseWindow(tMin, tMax, { window = 'auto', maxWindows })` -> `{ window, count, requested, reason }`. Auto: days under 12 weeks, weeks up to 260, months beyond.
- `suggestTimeRange(ds, { share = 0.95, maxSpanShare = 0.5 })` -> `{ start, end, share, outsideBefore, outsideAfter, fullStart, fullEnd } | null`: the shortest whole-day interval holding 95% of dated events, offered only when it is at most half the full span (a few very old dates in a personal export).
- `sourceCoverage(ds, { start, end, minShare = 0.05 })` -> `[{ id, format, label, start, end, events, eventsInRange, share, material }]`: first and last event per source; `material` = at least 5% of events in the range.
- `nodeSources(ds, { minShare = 0.25 })` -> per dataset node, the source ids carrying at least 25% of what that person did or received.

```js
{ windows: [{ start, end, label, events, nodes, ties, coverage }],    // coverage = share of the window inside the data span
  node: { [metric]: [Float64Array(ds.nodes.count) per window] },     // DATASET index; absent: 0 for degree/strength types, NaN otherwise
  network: { [key]: number[] per window },                           // every numeric key of computeNetworkMetrics
  ties: { formed[], dissolved[], persisted[], jaccard[] },           // vs the previous window
  activity: { node: [Float64Array(ds.nodes.count) per window], total[], group?: { attr, values[], sizes[], counts[value][window] } },
  sources: sourceCoverage(...) for the range, nodeSources: { [node]: [sourceId] },
  meta: { window, windowRequested, windowReason, start, end, metrics, eventsInRange, undatedExcluded } }
```

`detectShifts(series, { method = 'robust' | 'cusum', threshold, nodeThreshold, baseline = 8, minBaseline = 4, minCoverage = 0.6, nodeMetric, topNodes = 200, networkMetrics, labels })` ->
`{ shifts: [{ target: 'network'|'group'|'node', id, label, metric, window, end, length, value, baseline, z | statistic, direction, start, windowLabel, level, held, span, heldToEnd, lastHeld }], meta: { method, window, threshold, nodeThreshold, baseline, windows, seriesScanned, partialWindowsSkipped, weekendsSkipped } }`. Option `skipWeekends` (default true).

- **Persistence** (J3). `length` / `end` describe the run of flagged windows, which ends as soon as the rolling baseline has absorbed a new level (a permanent step is flagged for 2-4 windows). `persistence(x, first, last, baseline, direction)` judges the shift against the baseline before it instead: `level` is the mean of the flagged windows, and each later tested window is assigned to whichever is nearer, the pre-shift `baseline` or `level`. `held` of `span` windows (from the first flagged one to the end of the series or of its segment between source edges) sit nearer the new level; `heldToEnd` when all do; `lastHeld` is the last window of the unbroken run. Report "stayed at the new level to the end" from `heldToEnd`, never "lasted `length` windows".
- `meta.window` is the window unit of the series the shifts were computed from; a view shows it, and must recompute shifts when the series changes (J4).

- **Robust z** (default): compares each window with the median and MAD of the previous 8 windows, with threshold 3.5 (5 for node series). The scale has floors: 5% of the median, sqrt(median) for count series, and binomial noise for shares from the window's tie count (reciprocity uses m/2, transitivity m/3; density uses density/sqrt(m)).
- **CUSUM**: two-sided, k = 0.5, h = 6 (12 for node series), with the same floors.
- Partial windows (coverage < 0.6) are skipped.
- Daily windows with a working week (`weekendQuiet(windows, activity.total)`: Saturdays and Sundays, UTC, average under 40% of weekday activity) skip weekend days in testing and in the baselines, and Mondays in the tie-turnover series (`meta.weekendsSkipped`), so a weekday is compared with weekdays.
- Source edges: the window holding a source's first or last event and the windows either side are not tested, and the series is cut there so the baseline restarts (an export starting is not a rise). Whole-network and group series use material sources; a person's series uses the sources in `series.nodeSources`. Reported in `meta.sourceEdges` and `meta.sourceEdgeWindowsSkipped`.
- Series scanned by default: network `ties, density, reciprocity, transitivity, nodes`, `crossGroupShare` (when `timeSeries` got an `attr`: the share of ties between different values of it), tie retention (Jaccard with the previous window), ties formed, ties dissolved, total activity, activity per group, and the top node series. A reorg or a silo changes who talks to whom more than how much, so it shows up in cross-group share and tie retention.
- Group series use a stricter threshold, `groupThreshold` (4.5 robust, 9 CUSUM), because every group is scanned separately.
- Measured (2026-10-03, `docs/accuracy.md`): on 200 flat synthetic Slack workplaces 0.085 false alarms per dataset with the robust method (0.025 CUSUM), 0.18 on email workplaces; on chat (WhatsApp, 2.6 per dataset) and forum data most alarms come from person-level series of small, bursty counts. Over 100 seeds per preset the robust method found a planted silo (100%), quiet team (98%), departure (94%), reorg (92%) and consolidation (74%) within 4 days. On one flat count series of 26 windows the robust method gives 0.03 false alarms at a mean of 30 per window but 0.1 at a mean of 5 (Poisson skew). CUSUM detects changes but dates them by where its run started, a median 6.5-20 days from the planted event, and tests nothing when the series is no longer than its 8-window baseline.

`compareBeforeAfter(ds, settings, date, { span, start, end, metrics = ['degree', 'strength', 'betweenness', 'constraint'], attr, reps = 2000, metricReps = 199, seed })` ->
`{ date, span, before: { start, end, nodes, ties }, after, node: { [m]: { n, meanBefore, meanAfter, meanDiff, sdDiff, dz, p, topIncreases[], topDecreases[] } }, network: { [k]: { before, after, diff } }, ties: { formed, dissolved, persisted, jaccard }, groups?: [{ value, before, after, ratio }], mixing?, meta }`.
Before is `[date - span, date)` and after `[date, date + span)`: events on the date itself count as after (`meta.boundary`), so a person who leaves that day still appears after it (J16). `metrics: []` is allowed (only the network, ties and mixing). With `attr`, `mixing = { attr, before: { within, across, coded, eiIndex, crossShare }, after, diff (E-I after - before), p, reps, test, snapshot: true }`: the E-I index and the share of ties crossing groups in each period, over ties whose two ends have a value, with an event-relabelling p for the change in E-I (two-sided, `reps` relabellings, no rebuild; `p: null` with turn-taking ties on). `snapshot` is a reminder that the attribute is one value per person: if people moved groups at the date, their ties inside the new group count as crossing (J1).
`p` comes from a randomization test on the events: each event of the two periods is relabeled before or after with probability 1/2 and the mean per-person difference recomputed (`node[m].test`, `node[m].reps`). For degree and strength (and their in/out parts) this needs no rebuild, because summed over people their change is the change in ties or tie weight, so `reps` relabellings are cheap; other metrics rebuild both networks `min(reps, metricReps)` times, and so do all metrics when turn-taking ties are on. Flipping the sign of each person's difference, as before, treats people as independent although every tie moves two of them: on stationary data it gave p <= 0.05 in 14% of datasets; the event test gives 4.5-5.5% (`docs/accuracy.md`). Bursty activity still makes it somewhat liberal. `meta.approximate` lists metrics computed with pivots. `dz` = mean difference / sd of differences. `cautions: [{ source, label, kind: 'starts'|'ends', t, period: 'before'|'after' }]` lists material sources that start or end inside either period; people mostly seen in such a source carry `sourceEdge` (its label) in `topIncreases` / `topDecreases`.

## Content

These functions read message events with text; bots are skipped.

**Tokenizer** (`tokenize(text, { stopwords, minLength = 2, keepEmoji })`):
- applies NFKC and lowercases;
- drops Slack markup, URLs, emails, @mentions, `:emoji_codes:` and emoji;
- keeps hashtag words and drops possessive 's;
- removes English stopwords, minimal es/fr/de/pt/it/nl lists, chat filler, weekdays, months and mail furniture ("wrote", "fwd");
- `extraStop` (a Set) removes more words.

**Cleaning** (`content/corpus.js`): `cleanText(text)` -> `{ text, quoted, signature }` keeps only what the sender wrote: it drops `>` quoted lines and everything after an "On ... wrote:" line (also split over two lines, and the fr/de/es/it/nl/pt forms), Outlook "Original Message" and "From:/Sent:" blocks, forwarded-message markers, the "-- " signature and "Sent from my ..." lines. `nameStopwords(ds)` is the set of words that name people in the data (label parts, email local parts and non-generic mail domains). The corpus (keywords, topics, diffusion) uses both, and `keywords().meta.cleaning` / `topics().meta.cleaning` = `{ messages, quoted, signatures, nameWords }`. Sentiment scores the cleaned text and reports `coverage.quotedRemoved`.

**`by` units:**
- `'overall'`
- `'node'`: key = dataset index
- `'group'`: needs `attr`; key = the value
- `'context'`: key = context index, label = context name
- `'source'`: key = label of the source's format (Email, WhatsApp, X ...), all sources of one kind together
- `'visibility'`
- `'window'`: with `window`; key = window start in ms

`affect(ds, { by | [by...], attr, window, minMessages, maxMessages, perMessage })` ->
`{ coverage: { messages, withText, scored, likelyNonEnglish, sampled }, note, thresholds, by: { [by]: rows }, groups: rows (single by), perMessage? }`.
Each row is `{ key, label, n, mean (VADER compound), sd, se, pos, neg, neu, posShare, negShare }`. Scores are cached per dataset.

`keywords(ds, { by = 'node', attr, window, k = 10, minCount = 2, minTokens = 20, maxUnits = 300 })` ->
`{ by, units: [{ key, label, tokens, terms: [{ term, count, tfidf }] }], overall: [{ term, count, messages }], meta }`.
It uses TF-IDF over each unit's pooled text, with smooth idf `ln((1+U)/(1+df)) + 1`. `overall` counts terms (`count`) and the messages using them (`messages`) over the same messages: those by non-bots that fall in a unit of `by` (so `by: 'window'` leaves out undated messages, `by: 'group'` people without a value).

`topics(ds, { k = 10, seed, iterations = 150, alpha = 0.1, beta = 0.01, pool = 'none' | 'author-day', minTokens = 3, minDf, maxDfShare = 0.25, maxVocab = 5000, maxDocs = 150000, topTerms = 10, attr, window })` ->
`{ topics: [{ id, share, terms: [{ term, weight }], distinctive: [term] }], byNode: [{ key, label, n, shares[k] }], byGroup?, byWindow?, meta }`.
It is collapsed Gibbs LDA; `distinctive` ranks by relevance with lambda 0.6.

`diffusion(ds, net, { terms, auto = 8, minAdopters = 5, window, reps = 200, seed })` ->
`{ terms: [{ term, adopters, outsideNetwork, first, last, exposedShare, exposed, eligible, null: { mean, sd, z, pUpper, pAdjusted, reps, room, zMax, ceiling }, cascade: { roots, maxDepth, largest }, adoptions: [{ node, label, t, exposed, from, dt }] }], meta }`.

- A person adopts a term with their first message using it.
- An adoption is exposed if a neighbour in either direction used the term earlier (within `window` if set).
- The null shuffles adoption times among the same adopters.
- `null.room = 1 - mean`; `null.zMax` = the z a 100% exposed share would get; `null.ceiling` when the shuffled baseline is at least `CEILING` (0.85). With a ceiling the test has little room either way (the generated online network's terms sit at 90-95%), and views say so (N8).
- Automatic selection picks words not used in the first 10% of the period, that are not stopwords or everyday English (`isCommonWord` in `content/stopwords.js`, which also strips regular endings), and that reach `minAdopters` people, ranked by adopters.
- Several terms tested at once: `null.pAdjusted` is Holm's step-down adjustment of `pUpper` over the terms tested (`meta.correction: 'holm'`, `meta.tested`; `holm(ps)` is exported). Views read "follows ties" only when the adjusted p is below 0.05 and there is no ceiling; with a ceiling the result is inconclusive.

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
- Two-mode (2026-10-03): `settings.twoMode`, `net.twoMode`, `TWO_MODE_METRICS`, the two-mode network keys, `barberModularity` on two-mode communities, `graphForRender({ arrange })`, `TWO_MODE_VIEWS`, `PROJECTIONS`, `twoModeDefaults` (see "Two-mode networks").
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

**Accuracy campaign.** `tools/accuracy/campaign.mjs` checks every measure against networkx, exact linear algebra, closed forms, invariances, a naive reimplementation of the construction rules, file round trips and the generator's ground truth on thousands of seeded cases; `test/accuracy/` runs a fixed slice of it in about 15 s. Method, numbers and conventions that differ from networkx are in `docs/accuracy.md`.

Two-mode measures and projections are validated against networkx.algorithms.bipartite (`tools/accuracy/checks/twomode.mjs`, `test/accuracy/twomode.test.js`, `test/analysis/twomode.test.js`).

Run `node --test 'test/analysis/**/*.test.js'`. Set `ORG_SIGNAL_SKIP_PERF=1` to skip the 12 s performance test.

## Performance (Node 24.19, Apple silicon, one thread)

| Task | Size | Time |
|---|---|---|
| buildNetwork | 100k events -> 95k directed ties | 47 ms |
| node metrics, exact, all (perf test) | 5,000 nodes, 56.5k undirected ties | 12.1 s, 205 progress calls, longest gap 95 ms |
| node metrics, exact, all | 5,000 nodes, 95k directed ties | 11.5 s |
| same, approx auto (632 pivots) | same | 1.7 s |
| network metrics / communities | same | 0.12 s / 0.13 s |
| nullModel, 100 reps, 4 stats (fixed-partition modularity, before 2026-10-03) | same | 26 s |
| nullModel, 200 reps, modularity re-detected | 5,000 nodes, 25k ties | 24 s (see Uncertainty) |
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

### Concepts (beginner terms)

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `tie` | Tie | A connection between two people: they talked, replied, met, or one named the other in a survey. Also called an edge or a link. | One tie per pair (per direction when directed), built from events by the construction rules; several events between the same pair make one stronger tie, not several ties. | Any network. | What counts as a tie is a choice: change the construction settings and the ties change. |
| `directed` | Directed and undirected | Directed ties have a direction (Ana emails Ben); undirected ties are simply shared (Ana and Ben are friends). | Directed: (a, b) and (b, a) are separate ties. Undirected: one tie per pair. A directed network counts a two-way tie as two ties. | Any network. | Mixing the two doubles the tie count of the undirected ones; choose one in the construction settings. |
| `weight` | Tie weight | How strong a tie is: how many messages, how many meetings, or a closeness rating from a survey. | Count of evidence, log of the count, or present/absent (1), set in the construction settings; survey ratings use the chosen tie field. | Any network. | Betweenness and closeness ignore weights; strength and the weighted versions use them. |
| `ego` | Ego | The person at the center of a personal network: you, in your own ego interview or your own export. | The focal node of an ego network; the source records it as egoKey. | Ego interview or a personal export. | In one person's data the ego is on every route by construction, so betweenness says nothing; use ego measures. |
| `alter` | Alter | A person in ego's network: someone ego named or talked with. | A neighbor of the ego. | Ego interview or a personal export. | Ties among alters are known only if ego reported them (who knows whom). |
| `nameGenerator` | Name generator | A survey question that asks for names: "Who do you discuss important matters with?" | Each answer names alters; several generators are combined into one list (Burt 1984; McCallister and Fischer 1978). | Ego interview or roster survey. | The wording and the cap on names shape the network you get. |
| `nameInterpreter` | Name interpreter | A follow-up question about each person named: how you know them, how close you are. | One answer per alter, stored as a person attribute or a tie field. | Ego interview. | Answers are ego's view of each alter, not the alter's own. |
| `roster` | Roster survey | A survey that lists everyone in a group and asks each person to tick who they are tied to. | Each respondent's ticks are directed nominations; combine as reported, union (either named) or reciprocated (both named). | A known group of people. | People who do not respond leave holes; reciprocated ties need both people to answer. |
| `plantedGroup` | Community vs planted group | A community is found from the ties alone; a planted group (or department) is a label the data came with. They often match, but not always. | Communities: Louvain on the ties. Planted groups: the generator's ground truth or an attribute such as department. | Communities: any full view. Planted groups: generated or attribute data. | A community that does not match a department is a finding, not an error. |
| `path` | Path and distance | A path is a chain of ties from one person to another; the distance is the fewest steps it takes. | Shortest-path length in ties (unweighted unless stated). | Any network. | A missing tie can make a distance look much longer than it is. |
| `nullModel` | Null model (random networks) | Many random networks that keep something fixed (usually everyone's number of ties) so we can see what chance alone would give. | Degree-preserving rewiring (double edge swaps), or shuffled timings for diffusion; the observed value is compared with the spread of the random ones. | Enough ties to rewire. | Answers only "is this more than chance, given these degrees?", not why. |
| `randomSeed` | Random seed | A number that fixes the random choices, so the same seed gives exactly the same result again. | Seed for the pseudo-random generator used by the generator, community detection, null models and resampling. | Anything random. | A result that changes a lot with the seed is not settled. Not the same as the first user of a word (diffusion). |
| `informant` | Informant | Someone who reports the whole network as they see it, not just their own ties (perceived networks). | Each informant fills in who is tied to whom among everyone on the roster. | Perceived networks (Build). | Informants remember strong and nearby ties better than weak or distant ones. |
| `consensus` | Consensus network | The ties enough informants agree on: a tie is in it when at least the chosen share of informants reported it. | Tie (i, j) is kept when the share of informants reporting it reaches the threshold; its weight is that share. | Perceived networks with several informants. | Each informant is scored against a consensus that includes their own report, which flatters everyone a little. |
| `hitRate` | Hit rate | Of the ties that are really there, the share an informant reported. | Ties reported and in the reference / ties in the reference. | Perceived networks. | Ignores false alarms: someone who ticks every box gets 100%. Read it with Jaccard. |
| `jaccard` | Jaccard similarity | How much two sets of ties overlap: 1 means identical, 0 means nothing in common. Used to score how accurately an informant sees the network. | \|A and B\| / \|A or B\| over the ties of the two networks. | Two networks on the same people. | Penalizes both missed ties and invented ones, so it is the fairest single accuracy score here. |
| `cognitiveSocialStructure` | Cognitive social structure | The network as each person in a group perceives it (Krackhardt 1987); comparing the perceptions shows who sees the group accurately. | One full roster matrix per informant; aggregated by union, intersection or consensus. | Perceived networks (Build). | Perception is not behavior: an accurate perceiver need not be central. |
| `twoMode` | Two-mode network | A network with two kinds of node, such as people and the events they attend, where ties run only between the kinds: a person attends an event, never another person directly. Also called an affiliation or bipartite network. | Nodes split into mode 0 (actors) and mode 1 (events, groups); ties only between modes. Davis, Gardner and Gardner (1941): 18 women x 14 social events; Breiger (1974), Borgatti and Everett (1997). | Data recording who belongs to or attended what (an incidence list or matrix). | One-mode measures (clustering, density, Burt's constraint) mislead here; use the two-mode versions or a projection. |
| `affiliation` | Affiliation | A tie between a person and something they belong to or take part in: a club, a board, a meeting, a course. | One tie per (actor, event) pair; optionally weighted (hours, role) and dated. Stored as a declared event with a member target. | Two-mode data. | Membership says people had the chance to meet, not that they did. |
| `projection` | Projection | Turning a two-mode network into a one-mode one: two people are tied when they share an event (or two events when they share a person). The tie weight says how much they share. | Count: number of shared affiliations (Breiger 1974). Newman (2001): each shared event adds 1 / (its size - 1), so a big event ties people weakly. Binary: 1 for any overlap. A minimum shared count can drop thin ties. | Two-mode data. | Every event becomes a clique, so clustering and constraint are inflated by construction, and information about which events made a tie is lost; check the two-mode view too. |
| `borgattiEverett` | Borgatti-Everett normalization | Scaling two-mode centralities by what is possible for a node of that mode, so a person and an event can each be read from 0 to 1. | Borgatti and Everett (1997): degree / size of the other mode; betweenness / the maximum for that mode given both mode sizes; closeness = (m + 2(n - 1)) / sum of distances for a node in a mode of n with m in the other. | A two-mode network. | Compare values within a mode; across modes the scales are made comparable but the meanings differ (a busy person vs a well-attended event). |

### Node measures

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `contacts` | Contacts | How many different people this person has a tie with, in either direction. | Distinct neighbors. Directed networks: in-degree + out-degree minus the two-way ties counted twice (degree x (1 - reciprocity / 2)); undirected networks: degree. | Any network. | Robust. Depends directly on the construction rules and the broadcast cutoff; a one-time contact counts the same as a daily one. |
| `degree` | Degree | Number of ties. On a directed network, ties in plus ties out, so a two-way tie counts twice; Contacts counts each person once. | Number of ties. Directed networks: in-degree + out-degree (a two-way tie counts twice), as networkx. | Any network. | Robust. Depends directly on the construction rules and the broadcast cutoff. |
| `inDegree` | In-degree | How many people direct messages, replies or nominations at this person. | Number of incoming ties. | Directed network. | Robust in full views; in one person's export only the owner's incoming ties are complete. |
| `outDegree` | Out-degree | How many people this person reaches out to. | Number of outgoing ties. | Directed network. | Robust in full views. |
| `strength` | Strength | Total volume of this person's ties: how much interaction, not just with how many people. | Sum of tie weights (in + out for directed networks). | Weighted network (count or log weighting). | Heavily skewed by a few very active ties; compare with degree. Log weighting dampens this. |
| `inStrength` | In-strength | Total volume of interaction directed at this person. | Sum of incoming tie weights. | Directed, weighted network. | As strength. |
| `outStrength` | Out-strength | Total volume of interaction this person initiates. | Sum of outgoing tie weights. | Directed, weighted network. | As strength. |
| `betweenness` | Betweenness | How often this person sits on the shortest route between two others: a potential bridge or bottleneck. | Brandes (2001). Share of ordered pairs (s, t) whose shortest paths pass through the node, split across tied paths: raw / ((n-1)(n-2)). Ties are not weighted. | A full view of the group; not meaningful for one person's export. | Ignores tie weights: the weighting setting (count, log, binary) does not change it. Sensitive to missing ties and to the construction rules; check the rank interval from resampling before calling someone a broker. Approximate (sampled sources) above 3,000 people unless exact is requested: the overall ranking holds (Spearman 0.90-0.99 in tests) but the top 10 can change by a third or more where values are close, so request exact values before naming brokers. |
| `betweennessWeighted` | Betweenness (weighted) | As betweenness, but routes prefer strong ties: a strong tie counts as a short step. | Brandes with Dijkstra, distance = 1 / weight; same normalization. Equal-length paths are detected with a relative tolerance of 1e-10. | Weighted network; full view. | More sensitive than unweighted betweenness to the weighting choice (count vs log). |
| `closeness` | Closeness (harmonic) | How easily others can reach this person in few steps. | Harmonic closeness: sum over others of 1 / d(other, node), divided by n-1 (Marchiori and Latora 2000; Boldi and Vigna 2014). Unreachable people add 0. Directed: distances toward the node. | Full view. | Ignores tie weights. Defined on disconnected networks, but people in small components score low partly because they cannot reach the rest. |
| `closenessWeighted` | Closeness (weighted) | As closeness, with strong ties counting as short steps. | Harmonic closeness with distance = 1 / weight, divided by n-1. | Weighted network; full view. | Scale depends on the weighting; compare people within one network only. |
| `eigenvector` | Eigenvector centrality | Connected to people who are themselves well connected. | Leading eigenvector of the symmetrized weighted adjacency matrix (w(a,b) + w(b,a)), unit Euclidean norm; power iteration on A + I so bipartite networks converge (as networkx), finished by Lanczos when two leading eigenvalues are nearly equal. People without ties score 0. | A connected full view. Directed networks are symmetrized; use PageRank for a directional version. | Not comparable across components: scores outside the largest component shrink toward zero. Scores from different networks are on different scales; compare ranks, not values. |
| `pagerank` | PageRank | Receives attention from people who themselves receive attention (directional status). | Brin and Page (1998), damping 0.85, weighted, dangling nodes redistribute uniformly (as networkx). Sums to 1. | Directed network gives the directional reading; undirected gives a smoothed degree. | Values shrink as the network grows (they sum to 1); compare ranks across networks. |
| `clustering` | Clustering | How many of this person's contacts also know each other. | Local clustering coefficient on the symmetrized, unweighted network: ties among neighbors / (k(k-1)/2) (Watts and Strogatz 1998). | Full view (in one person's export, ties among their contacts are mostly invisible). | Undefined (0) for people with fewer than two contacts; meetings inflate it. |
| `coreNumber` | Core number | How deep in the densely connected core this person sits. | Largest k such that the person belongs to a subgraph where everyone has at least k ties (Batagelj and Zaversnik 2003), symmetrized network. | Full view. | Robust; coarse (integer). |
| `reciprocity` | Reciprocity | Share of this person's ties that go both ways. | 2 x \|in-neighbors AND out-neighbors\| / (in-degree + out-degree), as networkx. | Directed network. | Inflated when turn-taking (adjacency) ties are on. |
| `constraint` | Constraint | How much this person's contacts are tied to each other: high = embedded in one closed group; low = spans separate groups (Burt's structural holes). | Burt (1992): sum over contacts j of (p_ij + sum_q p_iq p_qj)^2, p = share of i's total mutual tie weight w(i,j) + w(j,i), as networkx. | Full view; weighted. | People with one contact always score 1. Use with effective size; check the per-person null model before calling someone a broker. |
| `effectiveSize` | Effective size | Number of non-redundant contacts: contacts who do not already know each other. | Burt (1992): sum over contacts j of (1 - sum_q p_iq m_jq), m = tie weight / j's strongest tie (as networkx). Unweighted undirected equals n - 2t/n (Borgatti 1997). | Full view; weighted. | Grows with degree; efficiency = effective size / degree compares people with different numbers of contacts. |
| `egoDensity` | Ego density | Share of possible ties among this person's contacts that exist. | Ties among alters / possible ties. Undirected: equals clustering. Directed: directed ties among alters / k(k-1). | Full view, or an ego-network survey with alter-alter ties. | Undefined with fewer than two contacts. |
| `twoModeDegree` | Two-mode degree | Share of the other kind of node this one is tied to: the share of events a person attended, or the share of people at an event. | Degree / number of nodes of the other mode (Borgatti and Everett 1997; networkx bipartite.degree_centrality). | Two-mode network. | Robust; compare within a mode. |
| `twoModeBetweenness` | Two-mode betweenness | How often this person or event sits on the shortest routes between others, scaled by the most a node of its kind could have. | Brandes betweenness (unordered pairs, unweighted) / the Borgatti-Everett (1997) maximum for its mode: (1/2)[m^2(s+1)^2 + m(s+1)(2t-s-1) - t(2s-t+3)], s, t = divmod(n-1, m) (networkx bipartite.betweenness_centrality). | Two-mode network. | Sensitive to missing affiliations; an event shared by two otherwise separate groups scores high. |
| `twoModeCloseness` | Two-mode closeness | How few steps this person or event needs to reach everyone, against the fewest possible for its kind. | Borgatti and Everett (1997): (m + 2(n - 1)) / sum of distances for a node in a mode of n nodes (m in the other), times (reachable - 1) / (N - 1) when not everyone is reachable (networkx bipartite.closeness_centrality). | Two-mode network. | Classic, not harmonic, closeness: in disconnected networks the reach factor dominates. |
| `twoModeClustering` | Two-mode clustering | How much this node shares its contacts with the nodes two steps away: people who attend the same events as each other, events with the same crowd. | Latapy, Magnien and Del Vecchio (2008), dot mode: mean over nodes v two steps away of \|N(u) and N(v)\| / \|N(u) or N(v)\| (networkx bipartite.clustering). | Two-mode network. | Unweighted; 0 for nodes with nobody two steps away. |

### Network measures

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `density` | Density | Share of all possible ties that exist. | m / (n(n-1)) directed; 2m / (n(n-1)) undirected. | Full view. | Falls with network size by construction; compare networks of similar size only. |
| `reciprocityNetwork` | Reciprocity | Share of ties that are returned. | Reciprocated directed ties / all directed ties (networkx overall_reciprocity). | Directed network. | Compare with the null model: degree sequences alone produce some reciprocity. |
| `transitivity` | Transitivity | How often a friend of a friend is also a friend. | 3 x triangles / connected triples, symmetrized unweighted network. | Full view. | Meetings create cliques and inflate it; check the null model. |
| `avgClustering` | Average clustering | Average of each person's clustering. | Mean local clustering, people with fewer than two contacts counted as 0 (networkx). | Full view. | Dominated by low-degree people; transitivity weights by triples instead. |
| `components` | Components | Number of separate pieces: groups with no tie path between them. | Weakly connected components (isolates each count as one). | Any. | Very sensitive to the time window and filters. |
| `largestComponentShare` | Largest component | Share of people in the biggest connected piece. | Size of the largest weak component / n. | Any. | Robust. |
| `avgPathLength` | Average path length | Typical number of steps between two people who can reach each other. | Mean shortest-path length over reachable ordered pairs (unweighted). Exact up to 2,000 people, sampled from 500 sources above. | Full view. | Ignores unreachable pairs, so a fragmented network can look short. |
| `diameter` | Diameter | The longest shortest route between any two connected people. | Maximum finite shortest-path length (lower bound when sampled). | Full view. | Driven by a single path; fragile. |
| `degreeCentralization` | Degree centralization | How much ties concentrate on one person (1 = a star, 0 = everyone equal). | Freeman (1979): sum (max degree - degree_i) / ((n-1)(n-2)), symmetrized. | Full view. | Driven by the single most connected person; check who that is. |
| `strengthGini` | Strength inequality (Gini) | How unequally interaction volume is spread across people (0 = equal, 1 = one person has it all). | Gini coefficient of node strength. | Weighted network. | Isolates count as zeros and raise it. |
| `degreeAssortativity` | Degree assortativity | Whether well-connected people connect with each other (positive) or with the less connected (negative). | Newman (2002) Pearson correlation of degree across tie ends; directed: source out-degree vs target in-degree (networkx). | Full view. | Compare with the null model; hubs in small networks force negative values. |
| `modularity` | Modularity | How cleanly the network splits into groups with many ties inside and few between. | Newman (2004): sum_c [W_c/W - resolution (S_c/2W)^2], symmetrized weighted network. | Full view. | Louvain finds high modularity even in random networks; compare with the null model and other seeds. |
| `communities` | Communities | Groups of people more tied to each other than to the rest, found from the ties alone. | Louvain (Blondel et al. 2008) on the symmetrized weighted network, seeded; ids ordered by first member. | Full view. | Different seeds and resolutions give different splits; small communities are unstable. |
| `twoModeDensity` | Two-mode density | Share of all possible person-event ties that exist. | Ties / (n0 x n1) (networkx bipartite.density). | Two-mode network. | Falls as either mode grows; compare networks of similar size. |
| `robinsAlexander` | Two-mode clustering (Robins-Alexander) | How often two people who share one event also share another: the two-mode version of "a friend of a friend is a friend". | Robins and Alexander (2004): 4 x four-cycles / three-paths (networkx bipartite.robins_alexander_clustering). | Two-mode network with at least 4 nodes and 3 ties. | Big events create many four-cycles; read it with the event sizes. |
| `barberModularity` | Bipartite modularity (Barber) | How cleanly people and events split into groups that keep to themselves, judged against random mixing that respects the two modes. | Barber (2007): sum_c [W_c / W - (K_c / W)(D_c / W)], K_c and D_c the tie totals of the mode-0 and mode-1 nodes in c. | Two-mode network and a partition of both modes. | Here it scores the communities found on the projection; it is not maximized directly. |

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
| `egoSize` | Network size | Number of distinct contacts. | Neighbors in the symmetrized network. | Any. | Robust. |
| `efficiency` | Efficiency | Share of contacts that are non-redundant. | Effective size / size. | Ties among contacts. | Undefined without contacts. |
| `diversity` | Contact diversity | How varied this person's contacts are on an attribute (0 = all alike). | Blau index 1 - sum p_k^2 over attribute values; normalized version divides by 1 - 1/K. | An attribute for contacts. | Depends on how many values the attribute has. |
| `homophily` | Same-group share | Share of this person's contacts who share their attribute value. | Contacts with the same value / contacts with a value. egoEI = (different - same) / total. | Attribute for ego and contacts. | Compare with the group's share of the population. |

### Uncertainty

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `nullZ` | z vs random | How far the observed value is from networks with the same degrees but random wiring, in standard deviations. | (observed - mean of randomized) / sd of randomized. Directed: in/out-degree-preserving edge swaps; undirected: double edge swaps (10 swaps per tie per replicate). | Enough ties to rewire. | Read together with p; with few replicates p cannot go below 1/(reps+1). |
| `nullP` | p vs random | Share of randomized networks at least as extreme as the observed one. | Empirical two-sided p = (count of \|null - mean\| >= \|obs - mean\| + 1) / (reps + 1). | As z. | Smallest possible value is 1/(reps+1). |
| `rankInterval` | Rank interval | Range of ranks this person gets when the events are resampled: a narrow range near the top is a finding; a wide one is not. | Bootstrap over events (resample with replacement, rebuild, recompute), 2.5th-97.5th percentile of rank. | Event data (not hand-drawn ties). | Measures sampling noise in the events, not missing data or construction choices. |
| `topShare` | Top-k share | Share of resamples in which this person is in the top k. | Count of resamples with rank <= k / reps. | As rank interval. | As rank interval. |

### Time

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `tieTurnover` | Tie turnover | Ties formed and dropped between consecutive windows, and the overlap. | Formed = new ties; dissolved = ties not seen again; Jaccard = kept / union. | Timestamps. | Short windows show churn that is just sampling; prefer weeks or months. |
| `shiftZ` | Shift (robust z) | How unusual a window is compared with the preceding windows. | (value - median of previous 8 windows) / (1.4826 x MAD), floored at 5% of the median; \|z\| >= 3.5 flags (4.5 for groups, 5 for people). CUSUM alternative: two-sided, k = 0.5, h = 6 (9 for groups, 12 for people), baseline = the first 8 windows. | At least 4-8 windows of baseline. | Holidays and reporting gaps also produce shifts; check the events. |
| `dz` | Effect size (d_z) | Size of the average per-person change before vs after a date, in standard deviations of the changes. | Mean of paired differences / sd of differences; p from a randomisation test that relabels each event of the two periods before or after at random (people are not independent: one tie moves two of them). | Timestamps on both sides of the date. | Not causal: anything else that changed at the date counts too. |

### Content

| Key | Name | Meaning | Formula / reference | Needs | Reliability |
|---|---|---|---|---|---|
| `sentiment` | Sentiment (compound) | Average tone of messages, from -1 (negative) to +1 (positive). | VADER compound score (Hutto and Gilbert 2014), averaged; positive >= 0.05, negative <= -0.05. | English message text. | Approximate: misses sarcasm, jargon and non-English text. Compare averages over many messages. |
| `tfidf` | Distinctive words (TF-IDF) | Words a person or group uses more than others. | tf (share of the unit's words) x smooth idf ln((1+U)/(1+df))+1 over units. | Message text. | Units with little text produce noisy lists. |
| `topics` | Topics (LDA) | Recurring clusters of words, and how much each person or period talks about each. | Latent Dirichlet allocation, collapsed Gibbs sampling (Griffiths and Steyvers 2004), seeded; alpha 0.1, beta 0.01. | Several hundred messages with text. | Exploratory: change k or the seed and topics change. |
| `exposedShare` | Exposed adoption | Share of people who started using a word after someone they are tied to had used it. | Adopters (after the first) with an earlier-adopting neighbor / adopters; compared with adoption times shuffled among the same adopters. | Timestamps, text and a full view. | Exposure is not influence: tied people share meetings and news. Trust only a clear excess over the shuffle null. |

<!-- glossary:end -->
