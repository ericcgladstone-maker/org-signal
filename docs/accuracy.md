# Accuracy of the analysis engine

What was verified, against what, how often, how tightly, and what was found. The campaign was run on 2026-10-03 (Node 24.19, networkx 3.2.1, numpy 2.0.2, Apple silicon). Everything here can be rerun; see the last section.

**Rerun 2026-10-06** (seed 1, full scale) before and after the generator and recovery-check fixes of that day (section 7). The reference, closed-form, invariance, statistics, construction, round-trip, content and two-mode checks gave identical results before and after, with 0 failures; consistency differs only in the seed spread of Louvain modularity on its generated datasets, and approx only in timings. Section 7 has the new recovery numbers.

## Summary

| Check | What | Cases (seed 1) | Comparisons | Failures |
|---|---|---|---|---|
| reference | every node, network, group and ego measure against networkx / exact linear algebra / hand-written formulas | 3,000 graphs | 3,968,211 | 0 |
| closedforms | textbook values on 10 families, n = 1..60, 100, 250, 500 | 625 graphs | 188,571 | 0 |
| invariance | relabeling, edge order, isolates, weight scale, unit weights, symmetric directed | 1,500 graphs | 4,410,273 | 0 (7 before the fix below) |
| consistency | inline and worker engine vs pure functions, determinism, one time window, window additivity | 20 generated datasets | 17,787 | 0 |
| approx | pivot betweenness and closeness, sampled path length | 40 graphs, n = 800-5,000 | 120 runs | see below |
| stats | null-model degrees, p calibration, power, bootstrap coverage, shift detection, before/after | 1,275 trials (4,000 null replicates, 600 null draws, 300 bootstrap datasets, 27,000 simulated series, 300 before/after datasets) | 4,218 | 0 |
| construction | buildNetwork vs a naive reimplementation of every rule | 2,000 datasets x 3 settings | 38,394 | 0 unexplained (2 doc readings; 3 bugs reported then fixed) |
| roundtrip | export, re-import, recompute: GraphML, GEXF, GML, Pajek, UCINET DL (2 layouts), Gephi CSV, edge CSV | 500 graphs x 8 formats | 4,000 round trips | 0 |
| twomode | two-mode degree, betweenness, closeness, clustering, density, Robins-Alexander, projections (count, Newman, binary, minimum shared), Barber modularity, Davis Southern Women, against networkx.algorithms.bipartite | 1,000 datasets + Davis | 2,052,529 | 0 |
| content | VADER per message and aggregated, keyword counts and TF-IDF, tokenizer | 300 datasets | 414,205 | 0 |
| recovery | generator + recoveryCheck over every context, medium and preset; shift false alarms and power | 1,858 generator runs | | see below |

About 13 million comparisons in all, in 13 minutes. A second seed (`--seed 2`, after the fixes) of reference, invariance, construction, stats and consistency added 3,000 + 1,500 graphs, 6,000 construction settings, 1,275 statistical trials and 20 datasets: 8.35 million comparisons, 0 failures. Seed 1's reference, invariance and closed-form checks were rerun after the last fix: 0 failures. Seeds are part of every recorded case (`spec.seed`), so any failure replays exactly. After the modularity-null change (section 5), the stats calibration and power parts at full size (600 + 60 graphs, seed 1) and a quick campaign of every check (`--scale 0.1`) gave 0 failures.

## Graph cases

`tools/accuracy/lib.mjs` generates 15 families, chosen to hit edge cases: empty (n = 0..5), single node, isolates, two components, star, path, ring, complete, bipartite, random tree, Erdos-Renyi (p from 0.02 to 0.7), Barabasi-Albert (m = 1..3), stochastic block models (2-5 blocks), small-world rings, and "multi" graphs with repeated evidence and self-ties as the construction layer produces them. Each is drawn directed or undirected, with one of five weight schemes:

- `unit`
- `int`: 1-5
- `tied`: {0.5, 1, 2, 4}, so equal-length weighted paths really occur
- `float`: uniform 0.1-10
- `skewed`: e^U(-7,7), six orders of magnitude

Sizes run from 0 to 120, with 4% between 200 and 600. Categorical (1-5 levels) and numeric attributes are drawn with about 10% missing.

## 1. Reference agreement

`tools/accuracy/reference.py` computes, for each graph, the following:

- **networkx 3.2:**
  - betweenness (`normalized=True`), unweighted and weighted
  - harmonic closeness / (n-1), unweighted and weighted
  - clustering, core number, node and overall reciprocity
  - density, transitivity, average clustering, weak and strong components, degree assortativity
  - modularity of the detected partition at resolution 0.5, 1 or 2
  - attribute and numeric assortativity
  - constraint and effective size, wherever networkx is affordable (2,386 of 3,000 graphs)
- **numpy, exact linear algebra:**
  - eigenvector: the uniform vector projected on the leading eigenspace of the symmetrised weighted adjacency, which is the limit of power iteration on A + I
  - PageRank: solving (I - 0.85 P^T) x = 0.15/n
  - Burt's constraint and effective size in matrix form on dense graphs
- **Hand-written:**
  - contacts, ego density
  - average path length and diameter over reachable ordered pairs
  - Freeman degree centralization, strength Gini
  - E-I index (unweighted and weighted), weighted attribute assortativity
  - per-group sizes, internal and external ties, densities, E-I
  - ego diversity (Blau and normalised), homophily (count and weighted), ego E-I

Weighted path measures use exact `Fraction` distances 1/w for the integer and tied schemes, so equal-length paths are recognised. The engine's ego measures and the People view's `contacts` (`src/ui/lib/measures.js`) are checked against the same references.

**Tolerance.** 1e-9, relative above 1 and absolute below, for everything closed-form or combinatorial. Eigenvector and PageRank use 1e-6; the engine iterates, the reference solves exactly. **Largest error observed over 3,000 graphs:**

| Error | Measures |
|---|---|
| 0 | degree, strength (all six), betweenness, closeness, clustering, core number, reciprocity, ego density |
| about 1e-15 | weighted betweenness 8e-17, weighted closeness 6e-15, constraint 1e-15, effective size 2e-15 |
| iterative | eigenvector 4.3e-9, PageRank 2.7e-10 |

**Conventions that differ from networkx** (the engine is right by its documented definition; the reference follows the engine):

- **Weighted path ties.** networkx compares float path lengths exactly, so with distances 1/w it drops paths that are equal in exact arithmetic (1/3 + 1/6 != 1/2 in floats). The engine uses a relative tolerance of 1e-10, and the reference uses exact fractions.
- **Constraint and effective size of a directed node with only incoming ties.** networkx 3.2 returns NaN, because it tests `len(G[v])`, the successors. That happened 14,092 times over the campaign. The engine computes the value, since the node has contacts.
- **Correlation with a constant end.** Directed trees (every target has in-degree 1) and stars on a numeric attribute have one constant end. networkx returns rounding noise (about 1e-8); the correlation is undefined and the engine returns NaN. The reference tests constancy exactly.
- **People without an attribute value** are left out of attribute assortativity, where networkx would raise. The reference runs networkx on the subgraph of people with a value.
- **Harmonic closeness** is divided by n - 1; networkx does not normalise it.

## 2. Closed forms

All asserted to 1e-12; eigenvector and PageRank to 1e-9; effective size to n x 1e-12, because on K250 it sums 249 nearly cancelling terms and comes out at 1 - 1.4e-12.

- **Star:**
  - centre betweenness 1, closeness 1, eigenvector 1/sqrt 2 (leaves 1/sqrt(2(n-1)))
  - exact PageRank pair
  - constraint 1/(n-1) (leaves 1), effective size n-1
  - degree centralization 1, assortativity -1
  - average path 2(n-1)/n, Gini (n-2)/(2n)
- **Path:**
  - betweenness 2i(n-1-i)/((n-1)(n-2)), closeness (H_i + H_{n-1-i})/(n-1)
  - eigenvector sin(pi(i+1)/(n+1)) normalised
  - average path (n+1)/3, diameter n-1, degree centralization 2/((n-1)(n-2))
  - constraint 1/2 inside, effective size 2
- **Ring:**
  - betweenness (S - (n-1))/((n-1)(n-2)) with S = sum of ring distances
  - closeness, eigenvector 1/sqrt n, PageRank 1/n
  - triangle constraint 1.125
- **Complete:**
  - clustering 1, transitivity 1, density 1
  - constraint (2n-3)^2/(n-1)^3, effective size 1
  - eigenvector 1/sqrt n
- **K(a,b):** betweenness, eigenvector 1/sqrt(2a) and 1/sqrt(2b), core min(a,b), closeness.
- **Empty and single node:** zeros, NaN where undefined, PageRank 1/n.
- **Directed path, ring, complete and in-star:**
  - betweenness i(n-1-i)/((n-1)(n-2)) on the path and 1/2 on the ring
  - closeness H_i/(n-1)
  - reciprocity 0 or 1, strong components, average path n/2 on the ring

## 3. Invariances and consistency

**Invariances** (1,500 graphs, 4.4 million comparisons, 0 failures after the fixes below):

| Property | What is checked |
|---|---|
| Permutation | Relabeling nodes moves every node measure with its node; network measures are unchanged (1e-12). |
| Edge order | Shuffling the edge list gives bit-identical arrays. Splitting evidence into pieces matches to 1e-12. |
| Isolates | Adding 1-3 isolates leaves local measures unchanged. Betweenness rescales by (n-1)(n-2)/((N-1)(N-2)), closeness by (n-1)/(N-1). Density, average clustering, mean degree and largest-component share rescale exactly. Components and isolates increase by k. Isolates get 0 or NaN. |
| Weight scale | Multiplying every weight by 2, 0.37 or 1000 leaves weighted betweenness, eigenvector, PageRank, constraint, effective size and modularity unchanged, and scales strength and weighted closeness. |
| Unit weights | Weighted path measures equal the unweighted ones. |
| Symmetric directed | A directed network with every tie in both directions gives the undirected values, with degree doubled and reciprocity 1. |

Louvain is seeded but visits nodes in index order, so relabeling changed the partition it found in 41% of graphs. That is documented behaviour; the modularity of a fixed partition is invariant and checked. Across 10 seeds on the same network, Louvain's modularity varies by a median of 0.012 (95th percentile 0.033).

**Engine.** `createEngine({ worker: false })` and the worker path (the real worker code behind structured clone) return exactly what the pure functions return. This was checked for 18 methods on 20 generated datasets (workplace Slack and email, WhatsApp, X, classroom survey):

- build, node and network metrics, communities, groups, ego
- null model, resampling, time series, shifts, before/after
- applicability, edge evidence, render layout
- affect, keywords, topics, diffusion

**Determinism.** The same seed gives identical output for communities, null model, resampling, layout, pivot sampling, before/after, topics and diffusion. A different seed changed the output in every case for the first seven; before/after changed in 16 of 20, because p is sometimes identical.

**Time series.** A single window spanning the data equals `buildNetwork` with `includeIsolates: false` and `time` set to the data span, for every node measure and every network measure. Undated events are left out of windows. With count weighting and no turn-taking, weekly strength sums to the whole-period strength, and weekly activity sums to the dated events.

**Exports.** All 4,000 round trips through the real exporters and importers preserve nodes, ties, weights (event weights are float64 throughout; drift 0 in the 2026-10-06 rerun), 14 node measures, every network measure, and attribute, weighted, E-I and numeric assortativity. These format losses are expected and counted, not failures:

| Format | Loss | Cases of 500 |
|---|---|---|
| GML | an extra `key` attribute | 493 |
| GML, Pajek | label whitespace normalised | 374 |
| UCINET DL | a symmetric directed graph reads back undirected | 42 |
| edge CSV | isolates dropped | 119 |
| Gephi CSV | direction unknown when there are no ties | 39 |

**Content.**

- **Sentiment:** the per-message compound equals `Math.fround` of the vendor VADER score, computed on the documented input: the cleaned text, or the raw text if cleaning leaves nothing, cut at 5,000 characters. Every aggregate (n, mean, sd, se, pos, neg, neu, positive and negative shares) matches a naive recomputation for all seven `by` units.
- **Keywords:** counts, token totals, TF-IDF, top-k order and overall counts match a naive recount.
- **Tokenizer:** 13 targeted cases, one per documented rule.

## 4. Approximations

Measured on 40 graphs of 800, 1,500, 3,000 and 5,000 people (ER, BA, block model, small-world, random tree; both directions; 3 pivot seeds each), with the default pivots max(256, 10 sqrt n):

| | Betweenness | Closeness |
|---|---|---|
| Spearman with exact, median (5th-95th percentile) | 0.958 (0.884-0.986) | 0.985 (0.20-0.996) |
| Top 10 the same people, median (5th-95th) | 75% (39%-97%) | 73% |
| Top 1% the same, median | 80% | |
| Largest error / largest exact value, median (95th) | 0.22 (1.06) | 0.05 (2.1) |
| Mean signed error over pivot seeds, median | +0.07% (unbiased) | -0.13% |
| Speed-up, median | 4x | |

Where it works and where it does not:

- **Hubs.** Where a few hubs dominate betweenness (BA, small world, undirected trees), the approximation is good: Spearman 0.95-0.99 and top-10 overlap 0.7-1.0.
- **Flat betweenness.** Where values are close (ER, block models), Spearman stays above 0.90, but only 40-80% of the top 10 are the same people.
- **Sparse reachability.** On directed tree-like networks, where few people can reach each other, the estimator's variance is huge: Spearman 0.51-0.53 for betweenness, and 0.07-0.21 for closeness at 1,500 and 5,000 people.
- **Path length.** The average path length sampled from 500 sources is within 0.9% of exact (median 0.4%) except on directed trees (26-30%).

Results are labelled approximate:

- `meta.betweenness.approximate`
- `resampleRanks` rows marked `approximate`
- `pathLengthSampled`
- new in this campaign: `timeSeries().meta.approximateWindows`, `meta.pathLengthSampledWindows` and `compareBeforeAfter().meta.approximate`

The API doc and the betweenness glossary entry now say to request exact values before naming brokers.

## 5. Statistics

**Null models.**

- **Degrees.** 4,000 replicates on 200 graphs (8 families, both directions) kept every in- and out-degree, the tie count and simplicity. The chain checked is nullModel's own: its reported means are reproduced exactly.
- **Calibration.** 600 graphs were drawn from the null itself, by rewiring a base graph with 100 swaps per tie on an independent stream, and tested with 99 replicates. The share of two-sided p <= 0.05 should be about 5%:

| Statistic | p <= 0.05 | p <= 0.10 | KS distance to uniform | z mean, sd |
|---|---|---|---|---|
| transitivity | 4.3% | 10.7% | 0.073 | 0.05, 1.03 |
| average clustering | 6.0% | 10.5% | 0.043 | 0.02, 1.04 |
| degree assortativity | 6.2% | 10.5% | 0.022 | 0.05, 1.02 |
| reciprocity (300 directed) | 4.0% | 7.0% | 0.153 (discrete, conservative) | -0.07, 0.95 |
| attribute assortativity | 5.5% | 10.3% | 0.048 | 0.00, 1.06 |
| E-I index | 5.2% | 9.7% | 0.062 | 0.00, 1.06 |
| modularity (Louvain re-run per replicate, since 2026-10-03) | 5.2% | 10.3% | 0.048 | -0.02, 0.99 |
| modularity, old fixed-partition null (replaced) | 4.5% | 8.8% | 0.047 | -0.03, 1.02 |

- **Modularity null (Networks 101 round, N2).** The table's old row tested a fixed, arbitrary partition, which is calibrated for that partition but is not what the app tests: the views compare the partition Louvain found with rewired networks. Run that way, the old null (partition held fixed on rewired networks) put 300 of 300 null networks at p <= 0.05, because Louvain finds modularity 0.2-0.4 in any sparse random network while a fixed partition scores about 0 there. The replacement re-runs Louvain on every rewired network and on the observed ties (weights ignored on both sides): 5.2% at 0.05 over the 600 null draws above (unit weights, deciles of p 0.10 / 0.25 / 0.53 / 0.76 / 0.91), and 4.0% over 300 null draws with integer weights 1-5 (z mean -0.04). Scoring the weighted partition on unweighted ties instead put 84% of those weighted null networks at p <= 0.05, all below the null mean, which is why the observed side runs the same search. Power is unchanged (60 of 60 planted-block graphs). Cost: about 1.1-2x the rewiring alone (numbers in the API doc, Uncertainty). Regression tests: `test/accuracy/regressions.test.js` (random network typical of its null, old null more than 10 sd off; weighted null networks not "significantly low").
- **Power.** Planted blocks (p_in 0.3, p_out 0.02) and planted reciprocity were detected at p <= 0.05 in 60 of 60 graphs for transitivity, attribute assortativity, modularity and reciprocity.

**Bootstrap rank intervals** (`resampleRanks`, 200 replicates) on 100 simulated event datasets, where the true rates are known:

- **Strength:** the interval held the true rank for 95.2% of 3,857 people (96.4% of the true top 5). Median width 12 ranks.
- **Betweenness:** 92.8% coverage against betweenness on the true network.
- **Degree:** 87.8%. Ties never seen in the data cannot be resampled, so intervals for counts of distinct contacts are too narrow; read them as lower bounds on uncertainty.

**Shift detection on simulated series** (1,800 flat Poisson series of 26 windows per setting, and the same with a step at window 14):

| Method (threshold) | False alarms per series: mean 5 / 30 / 200 | Step found within 1 window, mean 30: +50% / -50% / +100% |
|---|---|---|
| robust 3.5 (network) | 0.093 / 0.035 / 0.013 | 0.32 / 0.14 / 0.91 |
| robust 4.5 (group) | 0.018 / 0.003 / 0 | 0.10 / 0.00 / 0.71 |
| robust 5 (person) | 0.008 / 0 / 0.001 | 0.06 / 0.00 / 0.56 |
| CUSUM 6 (network) | 0.15 / 0.13 / about 0.1 | 0.86 / 0.87 / 0.99 |
| CUSUM 12 (person) | 0.021 / 0.013 / about 0.01 | 0.66 / 0.69 / 0.82 |

- **Low counts.** At a mean of 5 per window, the Poisson right tail and the noisy 8-window median make the robust threshold of 3.5 behave like z of about 2.8.
- **Reaction speed.** The robust method reacts to large steps immediately; at a mean of 200 it catches a 50% step in either direction 99% of the time.

**On generated worlds** (1,050 generator runs; numbers in the API doc's Time section):

- **Flat Slack workplaces (200 seeds):** 0.085 false alarms per dataset with the robust method, which supports the documented 0.1. CUSUM gives 0.025.
- **Email workplaces:** 0.18.
- **WhatsApp:** 2.6 per dataset, mostly person-level degree series of small bursty counts.
- **X and Reddit:** most alarms fall on the planted news bursts; away from bursts, 0.30 on X and 4.7 on Reddit.
- **Planted events, 100 seeds each, found within 4 days by the robust method:** silo 100%, quiet team 98%, departure 94%, reorg 92%, consolidation 74%.
- **CUSUM** dates the same changes a median 6.5-20 days away, because it reports where its run started and its baseline is fixed to the first 8 windows. On series no longer than 8 windows (online and community worlds default to 60 days), it tests nothing.

**Before/after.** On 300 stationary datasets (pair rates constant across the date), the share of p <= 0.05 is:

| Data | Degree | Strength | Betweenness |
|---|---|---|---|
| Stationary, before the fix | 13.5% | 14.0% | |
| Stationary, after | 3.5% | 5.0% | 5.5% |
| Turn-taking datasets, after | 6% | 4% | |

A 1.5x rate increase is detected 63% (degree) and 82% (strength) of the time.

## 6. Construction rules

A deliberately naive reimplementation of every documented rule, written from this doc and not from `construct.js`, was compared with `buildNetwork`:

- **Rules:** reply (target and parent fallback), mention, dm, to/cc/bcc with the broadcast cutoff, turn-taking with `windowMin`, copresence with normalisation and `maxSize`, declared, repost, like, follow and reaction.
- **Filters and settings:** bots, `excludeNodes`, time window, visibility, media, weighting, `minWeight`, isolates.
- **What was compared:** node set, edges, raw and transformed weights, per-rule amounts, layer masks and summary counts. Every `edgeEvidence` list sums to its tie; bootstrap multiplicities and event subsets match.

The comparison ran on 2,000 random datasets x 3 random settings (44,407 events, 23,242 ties) per seed, with 0 unexplained differences. A mutation probe confirms the check catches a wrong normalisation or cutoff.

Five differences between the doc and `construct.js` were found on 2026-10-03; minimal datasets are in `tools/accuracy/checks/construction.mjs` (`KNOWN`) and `test/accuracy/construction.test.js`. Items 1 and 2 are readings of the doc, now corrected in the doc; items 3 to 5 have since been fixed in `construct.js`, and the 2026-10-06 rerun counts only the first two (84 and 560 occurrences in 6,000 settings).

1. **Turn-taking ties from a `directed: false` source keep their direction** (`construct.js:346` passes `sym = false`). The doc said such sources give both directions. The doc was wrong and is corrected.
2. **A declared event with no target ties to the author of its resolved parent** (`construct.js:317-322`, `subjectRule(declared)`). The doc did not say so; it is corrected.
3. **Fixed. Bug: a declared event naming the parent's author as a target counted the tie twice** (raw 2 instead of 1; `construct.js:317-322`, where the fallback skips the de-duplication at 312). Seen in 15 of 6,000 settings.
4. **Fixed. Bug: a reply whose reply target was an excluded person (a bot) fell back to the parent's author although a target was given.** `construct.js:298` skips excluded targets before `hasReplyTarget` / `hasSubject` are set. The same happens for repost, like, follow and reaction.
5. **Fixed. Summary count: with `excludeBots: false` and a bot in `excludeNodes`, its events were counted as `bots`, not `excluded`** (`construct.js:251`). Ties are unaffected.

Conventions confirmed where the doc was silent:

- Self-ties never form.
- The broadcast cutoff counts every distinct addressee, bots included.
- Copresence k counts eligible people only.
- A message is untargeted only with no targets at all.
- Turn-taking uses gap <= `windowMin`.
- `minWeight` compares raw before the transform.
- `copresence.maxSize <= 0` means `maxRecipients`.

Also reported:

- **`networkFromEdges` accepts node indices >= n without complaint** (`construct.js:578`). The network is corrupt until Louvain throws "target node not found".
- **Event weights were stored as float32** (`src/core/model.js`, `build()`): a weight of 0.1 became 0.10000000149. They are now float64.

## 7. End to end: generator and recovery

There were 1,858 generator runs, at default sizes:

- **Matrix:** every context x medium x preset (73 combinations), 10 seeds each, without text.
- **Content:** each medium with light text and each preset, 2 seeds each.
- **Shift study:** 1,050 runs.

The analysis is that of `test/integration/representation.test.js`. Numbers below are from the 2026-10-06 rerun, after these fixes:

- **Generator.** Department heads were also tied as teammates (the CEO's reports are the heads), so the bridge-dependent preset's leadership team was dense despite its low leadership-tie chance; the leadership loop alone now decides head-to-head ties. LinkedIn conversations drew the two speakers independently, so about half were a person writing to themselves. The dataset output wrote a group chat's audience as `member` targets, which no chat export holds and which switched turn-taking off. The online follow graph written as a network file was marked undirected. A reorg's new tie to someone whose old tie had just ended was dropped.
- **Recovery check.** A planted date now counts as found only when a date picked at random would not lie as close to a detected shift as often: the baseline is the share of the period within the distance found (at least a day) of some detected shift, and it must be at most half, as the verdict rule asks of scores (at least twice chance). With hundreds of person-level series, a close match can otherwise come from chance. The survey recall check tests the planted direction (two-proportion test) and can be missed. Betweenness fidelity compares a directed network with the directed true network. The professional and community contexts say that their planted groups are a label, not what generates the ties.

Mean betweenness fidelity (Spearman, measured vs true network) by medium:

| Medium | Fidelity |
|---|---|
| network files (workplace, personal, community, survey, professional) | 1.00 |
| workplace Slack | 1.00 |
| online network | 0.99 |
| X / Bluesky / Mastodon | 0.95 |
| workplace email | 0.93 |
| LinkedIn | 0.92 (0.88 before the conversation fix) |
| workplace calendar | 0.73 |
| WhatsApp / Telegram | 0.66-0.67 |
| survey | 0.66 |
| iMessage | 0.65 |
| Discord | 0.61 |
| Reddit | 0.53 |

Across all runs: median 0.995, 5th percentile 0.54. The chat media stay near 0.66 with turn-taking available: in group chats it ties each speaker to the previous one, which over-connects (`docs/api/generator.md`).

**Communities** (NMI with planted groups):

| Context | NMI | Seeds recovered |
|---|---|---|
| workplace | 0.93-0.98 | 10/10 |
| online | 0.66-1.00 | 10/10 (influencer-hub lowest) |
| personal | 0.70-0.81 | |
| survey | 0.81-1.00 | |
| professional (LinkedIn and network) | 0.37-0.44 | 0/10 (by design: ties come from careers, cohorts and recruiters, not the current employer) |
| community (Reddit, Discord) | 0.10-0.14 | 0/10 (by design: ties form around the active core across spaces, not in each home space) |

**Brokers.** On bridge-dependent workplaces the planted brokers are recovered in 10 of 10 seeds on every medium; median precision 1.00 on Slack, calendar and network files, 0.86 on email.

**Where recovery is poor** (the check says so in each report):

- **Professional and community:** planted groups are not recovered, by design (above).
- **Calendar:** planted silo, consolidation, reorg and quiet team are missed in 60-80% of seeds, the departure in 40%.
- **Email:** the departure on bridge-dependent is missed in 8 of 10 seeds, the consolidation and reorg in 3.
- **Bot campaigns** on X, Bluesky and Mastodon are missed in 50-60% of seeds, on network files in 8 of 10.
- **Network files** carry no time for ties present all period, so planted shifts there are missed by construction.

Verdicts over the whole matrix: 2,202 recovered, 354 partly, 424 missed (2,177, 353 and 450 before the fixes).

## 8. Two-mode networks

Added 2026-10-03 with two-mode support (`src/analysis/twomode.js`, `settings.twoMode` in `construct.js`). `tools/accuracy/checks/twomode.mjs` builds random bipartite datasets through the real path: `DatasetBuilder` + `declareTwoMode` + `addAffiliation`, with interleaved node order (actors and events mixed in the dataset), affiliation weights 1-4, repeated affiliations (15%), dates, and same-mode noise ties (a survey tie between two people) in 30% of datasets, which the two-mode view must drop. Families: random G(n0, n1, p) with p 0.05-0.6, sparse, dense, complete, star (one event everyone attends and one person at every event), two components, path, tiny (1-3 x 1-3) and one-event; sizes 1-40 x 1-25 with 3% at 100-300 x 50-150. `tools/accuracy/twomode.py` computes the reference with networkx 3.2.1:

| Engine | networkx | Largest error (1,000 datasets, seed 1) |
|---|---|---|
| `twoModeDegree` | `bipartite.degree_centrality` | 1.1e-16 |
| `twoModeBetweenness` (Borgatti-Everett normalization per mode) | `bipartite.betweenness_centrality` | 2.2e-16 |
| `twoModeCloseness` (Borgatti-Everett, with networkx's reach factor) | `bipartite.closeness_centrality` | 0 |
| `twoModeClustering` (Latapy, dot) | `bipartite.clustering` | 3.3e-16 |
| `twoModeDensity` | `bipartite.density` | 0 |
| `robinsAlexander` | `bipartite.robins_alexander_clustering` | 0 |
| `twoModeAvgClustering` | `bipartite.average_clustering` | 2.2e-16 |
| projection `count`, `newman`, `binary` onto each mode | `weighted_projected_graph`, `collaboration_weighted_projected_graph`, `projected_graph` (edge sets exact) | weights 1.1e-15 |
| projection with `minShared` 2 or 3 | `weighted_projected_graph` filtered | exact |
| `barberModularity` of the detected partition | hand formula (Barber 2007; networkx has none) | within 1e-9 |

Tolerance 1e-9 (relative above 1, absolute below) for measures; projection edge sets must match exactly and weights to 1e-12. Also checked per case: every node is kept, one tie per affiliation, same-mode ties dropped, each projection keeps every node of its mode (isolates included) and no other, and two-mode communities cover every node. Seed 1: 1,001 cases, 2,052,529 comparisons, 0 failures; seed 2: 1,001 cases, 1,848,218 comparisons, 0 failures (about 45 s each, most of it networkx). `test/accuracy/twomode.test.js` runs 150 datasets plus Davis with python, and the recorded Davis values (`test/fixtures/accuracy/davis-southern-women.json`) without it.

**Round trips.** The roundtrip check (`tools/accuracy/checks/roundtrip.mjs`, `runTwoMode`) exports the two-mode view of 125 random two-mode datasets per format (GraphML, GEXF, GML, Gephi CSV, Pajek, UCINET DL), re-imports and rebuilds them: each comes back two-mode with the same mode per node, ties, weights and two-mode measures. Full scale with the one-mode cases: 4,750 round trips, 0 failures. networkx reads our GraphML with `bipartite` as an int (`test/importers-a/twomode.test.js`).

**Davis Southern Women** (`nx.davis_southern_women_graph()`, 18 women x 14 events, 89 ties) is built through `addAffiliation` and matches every measure and projection: two-mode density 0.3532, Robins-Alexander 0.4678 (networkx's documented 0.468), Evelyn Jefferson two-mode degree 0.5714 (8 of 14 events), betweenness 0.0966, closeness 0.8000; event E8 degree 0.7778 (14 of 18 women). Communities on the women's projection give 2 groups with Barber modularity 0.3159.

**Conventions** (the engine follows networkx; documented in `docs/api/analysis.md`, "Two-mode networks"):

- **Unweighted.** Every two-mode measure, the projections and Barber's modularity treat an affiliation as present or not, as networkx does; affiliation weights still give strength and the two-mode view's tie weights.
- **Where networkx divides by zero.** `bipartite.betweenness_centrality` fails for the whole graph when one mode's maximum is 0 (one actor and one event, or one node against one). The engine returns NaN for that mode only and normal values for the other; the reference then applies networkx's own per-mode formula to the mode it can (21 of 100 small cases in the first trial run).
- **Closeness** is networkx's classic closeness with the Borgatti-Everett numerator and its reach factor (reachable - 1) / (N - 1), not the harmonic closeness the one-mode view uses.
- **Construction.** A `member` target on a `declared` event is an affiliation: rule `declared`, symmetric. The naive construction model (section 6) was extended with that rule, and the first role listed decides symmetry when one event names the same person twice (as the engine's per-event de-duplication does); the construction check stays at 0 unexplained differences (6,000 settings).

## Discrepancies fixed in this campaign

Each has a regression test in `test/accuracy/`.

1. **Eigenvector power iteration stalled** when the two leading eigenvalues of A + I are close: two separate heavy ties of similar count, two similar components, or small weights.
   - **Before:** on the 2,000 graphs of one campaign seed, 216 did not converge in 5,000 iterations and 144 were off by more than 1e-6, the worst by 0.11. Two K4s with weights 1.001 and 1 left 1.2% of the mass on the lighter one, which should have 0.
   - **Fix:** after 1,000 power iterations, restarted Lanczos with full reorthogonalisation finishes from the iterate, converging to the same limit vector. It is used in 17% of campaign graphs, and the largest error is now 4.3e-9 (`src/analysis/metrics.js`, `eigenvector`, `lanczosTop`).
2. **Eigenvector of an isolate was about 1e-13, not 0.** It is now exactly 0, so isolates no longer rank above people in small components.
3. **Weighted betweenness depended on the weight scale.** The tie tolerance was `1e-10 * max(1, |d|)`: absolute below distance 1, against the documented relative tolerance. With heavy ties, genuinely different paths were merged. Multiplying weights by 1000 changed values by up to 3e-4 on one campaign graph. It is now purely relative (`metrics.js`, `brandes`).
4. **Before/after p-values were anti-conservative.** The sign-flip test treated people as independent, but every tie moves two people, which roughly doubles the variance of the mean difference: 13.5-14% of stationary datasets had p <= 0.05.
   - **Fix:** p now comes from relabelling each event before or after at random.
   - **Count metrics:** the evidence is emitted once and re-aggregated per relabelling, checked against the real networks.
   - **Other metrics, and every metric with turn-taking on:** both networks are rebuilt `metricReps` (199) times.
   - Calibration is now 3.5-6% (`src/analysis/time.js`, `compareBeforeAfter`, `permutationP`).
5. **Sampled values in time series and before/after were not labelled.** Windows above 3,000 people use pivots, and path lengths come from 200 sources above 200 people. Both are now listed in `meta`.
6. **Keyword `overall.messages` counted bot messages** while `count` did not (`src/analysis/content/keywords.js`).
7. **Modularity null (2026-10-03, Networks 101 round).** The null kept the observed partition fixed on rewired networks, a straw man: every partition looked significant (100% of null networks at p <= 0.05 when tested as the app tests). Louvain is now re-run on every replicate and on the observed ties; calibration 5.2% (unit weights) and 4.0% (weighted) at 0.05 (section 5; `src/analysis/uncertainty.js`, `nullModel`). The null-model replicate count is now one value, 200, for every view, and results are cached per network so views quote one run.
8. **Docs corrected:**
   - glossary: CUSUM h was given as 5 (it is 6; 9 for groups, 12 for people); `dz` described the old test; the eigenvector and betweenness approximation notes
   - API doc: time windows leave out isolates and undated events, approximation accuracy, shift-detection numbers, construction details above, the networkx constraint difference

## Rerunning

```sh
cd app
# fast regression slice (part of the normal suite)
node --test 'test/accuracy/*.test.js'
# full campaign: about 13 minutes, writes OUT.json and OUT.md
node tools/accuracy/campaign.mjs --out /tmp/accuracy/run --seed 1
# quick look, or selected checks, or one check at a larger count
node tools/accuracy/campaign.mjs --out /tmp/accuracy/quick --scale 0.1
node tools/accuracy/campaign.mjs --out /tmp/accuracy/ref --only reference,invariance --seed 7
node tools/accuracy/campaign.mjs --out /tmp/accuracy/ref --only reference --count reference=10000
```

Checks: `reference, closedforms, invariance, consistency, approx, stats, construction, roundtrip, content, twomode, recovery` (`tools/accuracy/checks/*.mjs`; each exports `run({ count, seed })`). The reference and twomode checks need python3 with networkx (and numpy for reference); it runs python in parallel processes. The exit code is 1 if any check failed. To replay one failing graph, use `makeCase(failure.spec)` from `tools/accuracy/lib.mjs`.
