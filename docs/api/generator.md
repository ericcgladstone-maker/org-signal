# Generator API (`src/generator/`)

Synthetic social worlds with planted ground truth, observed through realistic media, written as a Dataset or as real export files. Pure ES modules, no DOM; runs in Node 24 and in a worker. Every random draw comes from a seeded stream (`rng.js`), so the same spec and seed give byte-identical output (dataset content, ground truth and native files; only `dataset.meta.createdAt`, stamped by `DatasetBuilder`, differs).

```js
import { listContexts, generate, recoveryCheck, MEDIUM_INFO } from './src/generator/index.js';
```

## Three levels

1. **Social context** (`contexts/*.js`) decides who exists, their attributes, the true ties (with strength, kind and an active window), planted structure and planted events.
2. **Medium** (`sim/*.js`) turns true ties into interactions over the timespan, with medium-typical forms and rhythms (work hours and weekdays per person's zone; evenings and weekends; bursty news days).
3. **Observation** (`observe.js`) decides what slice an export shows: `full`, `ego`, `authored`, `chat` or `sample`. Native exports force the view the real format has (Slack admin export = full; mailbox, calendar, X archive, LinkedIn = ego; WhatsApp = one export per chat; Discord/Reddit dumps = full or sample).

## `listContexts()`

Returns `[{ id, label, description, media, mediaIds, params, defaults, presets, timespan, observations, nativeMedia }]`.

- `media`: `[{ id, label, observations[], nativeView, files, importer, native }]`. `observations` are the realistic views for that medium; `files` describes the native output (null = dataset only); `importer` is the registry id that reads it back.
- `params`: schema `[{ key, label, type: 'int'|'number'|'enum'|'text', min?, max?, values?, default }]`. Values outside the bounds are clamped; unrealistic combinations are adjusted and recorded in `groundTruth.notes`.
- `presets`: `[{ id, label, params }]` (preset params are defaults the spec can still override).

| Context | Media (native in bold) | Presets |
|---|---|---|
| workplace | **slack**, **email**, **calendar**, **network** | distributed, bridge-dependent, siloed, consolidating, declining, reorg-midpoint |
| online | **x**, bluesky, mastodon, **network** | interest-communities, polarized, influencer-hub, bot-amplified |
| professional | **linkedin**, **network** | cohort-clusters, job-hopping, layoff-wave |
| personal | **whatsapp**, **telegram**, imessage, **network** | close-knit, drifting-apart, group-conflict |
| community | **reddit**, **discord**, **network** | core-periphery, flame-war, core-exodus |
| survey | **survey**, **network** | classroom (roster matrix), team-interviews (ego interviews), perceived-network (cognitive social structure) |

## `generate(spec) -> { dataset, groundTruth, files? }`

```js
spec = {
  context: 'workplace',            // see listContexts()
  medium: 'slack',                 // must be one of the context's media
  seed: 1,                         // number or string
  size: 120,                       // people (any context param can also be given at top level or in spec.params)
  structure: 'bridge-dependent',   // preset id (alias: preset)
  timespan: { start: '2025-01-06', days: 90 },   // or { start, end }; ISO dates or ms
  observation: 'full' | 'ego' | 'authored' | 'chat' | 'sample'
             | { view, ego?: index|label|key|email|handle, chat?: spaceKey|name, chatWith?: person, rate?: 0.3 },
  content: 'none' | 'light' | 'full',            // text volume (default light)
  output: 'dataset' | 'native',
  diffusion: { terms: 2, p0, meanDelayDays: 4, startAt: 0.15, seeds: [personIndex] } | false,
  onProgress: (fraction, message) => {},         // optional; called during generation, ends at 1
  // writer options: platform: 'ios'|'android', locale: 'en-US'|'en-GB'|'de-DE'|'es-ES'|'fi-FI', tzOffsetHours (WhatsApp)
  // survey: variant: 'ego-interview'|'roster-matrix'|'perceived'
}
```

- `dataset`: a built Dataset (`src/core/model.js`) with one source `{ format: 'synthetic', family, medium, view, context, egoKey, generator: { context, medium, preset, seed } }`. Node keys follow the importers' key rules where known (`slack:<U id>`, `email:<address>`, `x:<id>`, `whatsapp:<lower-cased name or +digits>`, `telegram:user<N>`, `discord:<snowflake>`, `reddit:<username>`, `linkedin:<slug>`, `survey:R001`, `net:n<i>`), so native round trips land on the same keys. Roles follow the contract: `dm` for direct and group DMs, `to/cc/bcc` for email, `reply`, `mention`, `member` for group-chat audience, `attendee` for meetings (copresence weight = hours), `declared` for survey answers, LinkedIn connections and network files, `subject` for follows, reactions, likes and reposts.
- `files` (native only): `[{ path, bytes: Uint8Array }]`, usually one zip in the real layout (WhatsApp: one file per chat; Discord: one JSON per channel; Reddit: two NDJSON per subreddit). Writers follow `docs/formats/*.md`; see each writer's header comment.
- `groundTruth` (structured-cloneable):
  - `people { count, keys, labels, attrs, isBot, leftAt, platformIds }` (person index = position)
  - `communities { attr, membership Int32Array, names, kinds }` (planted groups: departments, communities, clusters, employers, spaces, friend groups; -1 = none)
  - `ties { directed, count, a, b, w, kind, kinds, from, until }` (the true network before observation; NaN window ends = whole span)
  - `hierarchy { root, manager, managerAfter }` (workplace; `managerAfter` after a reorg)
  - `bridges { brokers, brokerKeys, ties }`
  - `events [{ type, t, person?, personKey?, group?, description, ... }]`: departure, reorg, silo, quiet, consolidation, decline, affect-shift, bot-campaign, job-change, layoff
  - `affect { plan, observed, expectations }`: the plan (base valence per group, time/visibility rules), the planted valence actually emitted per group x public/private x period, and plain expectations (group difference, public-private gap, shifts)
  - `topics { byGroup: [{ group, name, words }], bySpace }`
  - `diffusion { cascades: [{ term, seed, seedKey, t0, adopters: [{ node, key, t, from }], users: [{ node, key, firstUse }] }], params }` (adopters = planted cascade; users = who actually wrote the term)
  - `recall` (survey): variant, params, per-respondent named alters with truth flags, stats (by tie strength, false positives, boundary names, capped names, non-response), perceived reports per informant
  - `observation { view, ego, egoKey, egoLabel, chat, rate, sampled, keptEvents, totalRecords }`, `rhythm { kind, bursts }`, `counts`, `spaces`, `notes`, `params`, `spec`, `files`

## `recoveryCheck(groundTruth, ds, [net,] results) -> report`

`results` (all optional): `membership`, `nodeMetrics { betweenness, ... }`, `affect`, `shifts`, `diffusion` (shapes in `recovery.js` header). Arrays are indexed by network node when `net` (with `nodeIds`) is given, else by dataset node. Dataset nodes are matched to people by key, then platform id, then unique label, so imported datasets work too.

Report: `{ summary, checks: [{ id, name, area, planted, recovered, metric, value, baseline, verdict, says }], details, mapping }`, verdict `recovered | partly | missed | not checked`, `says` = plain-language reading. Checks:

| id | What | Metric |
|---|---|---|
| tie-coverage | how much of the true network the observed data shows | share of true ties seen (verdict only for full views) |
| communities | detected communities vs planted groups | NMI (ARI in text) |
| bridges | planted brokers in the betweenness ranking | precision@k (k = brokers), chance baseline |
| affect-groups / affect-visibility / affect-shift | planted affect differences | mean VADER compound difference with Welch test; measured here from the text unless `results.affect` is given |
| shift-<type> | planted events near a detected shift | days to nearest detected shift (tolerance max(7 days, 10% of span)) |
| diffusion-<term> | cascade recovery | users found vs planted adopters, seed early, share of later users with an earlier-using true neighbour vs a shuffled-time baseline, adoption-time rank correlation |
| survey-recall / survey-perceived | reported vs true ties | recall by strength and precision; informant and majority-consensus accuracy |

## Scale (measured, Node 24, Apple Silicon laptop)

| Spec | Events | Time | Peak RSS |
|---|---|---|---|
| workplace, slack, 50,000 people, 14 days, content none | 2.66 M | 3.7 s | 1.3 GB |
| same, content light / full | 2.66 M | 5.5 s / 5.5 s | 1.5 / 1.6 GB |
| workplace, slack, 50,000 people, 30 days, content none / light | 5.83 M | 8.1 s / 10.9 s | 2.3 / 2.4 GB |

Event volume is proportional to true ties x weeks x `activity`; lower `activity` or the span for browser use. Native output is meant for up to a few thousand people (it holds all records in memory and writes zips in one piece).

## What is approximate

- Time zones are fixed offsets (no daylight saving). Slack day files are bucketed in the workspace's offset.
- Interaction timing comes from per-medium rhythms, not from conversation-level dynamics beyond simple turn-taking.
- Diffusion is an independent cascade with random delays along true ties; adoption is not caused by exposure to a specific message. The first message after adoption almost always uses the term.
- Affect is planted as the chance of a VADER-scored phrase; neutral templates carry a small constant VADER offset, the same for every group.
- Bluesky, Mastodon and iMessage are dataset-only. Bot nodes are keyed `<prefix>:bot-<name>` in the dataset; importers key bots by their platform ids, so bots do not line up after a round trip (people do).
- The X native dataset is the generator's ego view, which also includes others' replies and likes aimed at the ego that a real archive never shows.
- Community structure in forums is only weakly recoverable from reply networks by design (core members span spaces).

## Tests

`node --test 'test/generator/**/*.test.js'`: determinism, 50k scale, structure sanity per context, content (affect measurable with VADER, terms spread along ties), observation slices, recoveryCheck, progress, writer conformance (independent parsers), and native round trips through the real importers (`writers-a.test.js`, `writers-b.test.js`). `test/generator/helpers.js` has a small graphology-based stand-in for analysis results used by the tests.
