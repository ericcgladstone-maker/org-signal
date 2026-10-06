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

- `dataset`: a built Dataset (`src/core/model.js`) with one source `{ format: 'synthetic', family, medium, view, context, egoKey, generator: { context, medium, preset, seed } }`. Node keys follow the importers' key rules where known (`slack:<U id>`, `email:<address>`, `x:<id>`, `whatsapp:<lower-cased name or +digits>`, `telegram:user<N>`, `discord:<snowflake>`, `reddit:<username>`, `linkedin:<slug>`, `survey:R001` (`survey:<normalised name>` for the roster form, as the survey importer keys it), `email:list:<list-id>` for mailing lists, `net:n<i>`), so native round trips land on the same keys. Roles follow the contract: `dm` for direct and group DMs, `to/cc/bcc` for email, `reply`, `mention`, `member` for group-chat audience, `attendee` for meetings (copresence weight = hours), `declared` for survey answers, LinkedIn connections and network files, `subject` for follows, reactions, likes and reposts.
- `files` (native only): `[{ path, bytes: Uint8Array }]`, usually one zip in the real layout (WhatsApp: one file per chat; Discord: one JSON per channel; Reddit: two NDJSON per subreddit). Writers follow `docs/formats/*.md`; see each writer's header comment.
- `groundTruth` (structured-cloneable):
  - `people { count, keys, labels, attrs, isBot, leftAt, platformIds }` (person index = position)
  - `communities { attr, membership Int32Array, names, kinds }` (planted groups: departments, communities, clusters, employers, spaces, friend groups; -1 = none). `attr` is always `planted_group`: every person carries the group's name in `attrs.planted_group`, and `dataset.meta.attrLabels.planted_group = 'Planted group (ground truth)'` (`PLANTED_GROUP_ATTR`, `PLANTED_GROUP_LABEL`) so views never show it as "Community". Keys a real export or HR file would carry stay beside it (workplace `division` and `department`, professional `company`); keys that only carried the planted group (online `community`, personal `cluster`, community `home_space`, survey `friend_group`) are gone.
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

Report: `{ summary, rule, checks: [{ id, name, area, planted, recovered, metric, value, baseline, verdict, says, brokers? }], details, mapping }`. `says` is the plain-language reading with technical terms in parentheses ("agreement 0.95 out of 1; normalized mutual information (NMI) 0.946, adjusted Rand index (ARI) 0.944"); dates read "24 Feb 2025". `value` and `baseline` are in the same unit. `mapping` adds `networkPeople` (people in `net`) and `bots` (accounts flagged as bots) so a view can say "121 accounts, 1 bot left out of the network".

**One verdict rule** (`RULE`, `scoreVerdict(score, chance)`, exported from `recovery.js`; also `report.rule`): Recovered when the score (0 to 1, 1 = what was planted) is at least 0.6, or a difference is in the planted direction with p < 0.05, or a date falls within the tolerance; Partly when the score is at least 0.25 and at least twice the chance level, or the direction is right but not clear, or the date is within twice the tolerance; Missed otherwise. Checks:

| id | What | Score |
|---|---|---|
| tie-coverage | how much of the true network the data shows: with `net`, the ties of the network as built with the construction settings used (so it matches the Network view); without it, every pair with an event | share of true ties seen (verdict only for full views) |
| communities | detected communities vs planted groups ("Planted departments vs detected communities"); `planted` also names grouping-column values that are not planted groups ("the department column also has Executive: 1 person, planted with Engineering") | NMI |
| bridges | planted brokers in the betweenness ranking; `brokers: [{ name, key, rank }]` lists every planted broker with its measured rank (also in `says`) | share of the planted brokers in the top k (k = number of brokers), chance = k / people ranked |
| betweenness-fidelity | measured betweenness vs betweenness on the true ties | Spearman rho |
| affect-groups / affect-visibility / affect-shift | planted tone differences | difference in mean VADER compound with a Welch test; measured here from the text unless `results.affect` is given |
| shift-<type> | planted events near a detected shift | days to the nearest detected shift (tolerance max(7 days, 10% of span), stated in the metric) |
| diffusion-<term> | spread of a planted term from its first user | users found vs planted adopters (precision, recall), first user early, share of later users with an earlier-using **true** neighbor vs a shuffled-time baseline; `says` explains why this can differ from the Diffusion view (observed ties) and warns when the shuffled baseline is 85% or more (little room) |
| survey-recall / survey-perceived | reported vs true ties | recall by strength and precision; informant and majority-consensus accuracy |

"seed" in readings means only the random seed; the first adopter of a term is "first user".

## Scale (measured, Node 24, Apple Silicon laptop)

| Spec | Events | Time | Peak RSS |
|---|---|---|---|
| workplace, slack, 50,000 people, 14 days, content none | 2.66 M | 3.7 s | 1.3 GB |
| same, content light / full | 2.66 M | 5.5 s / 5.5 s | 1.5 / 1.6 GB |
| workplace, slack, 50,000 people, 30 days, content none / light | 5.83 M | 8.1 s / 10.9 s | 2.3 / 2.4 GB |

Event volume is proportional to true ties x weeks x `activity`; lower `activity` or the span for browser use. Native output is meant for up to a few thousand people (it holds all records in memory and writes zips in one piece).

## Native datasets: what the export can show

With `output: 'native'` the `dataset` is what the written files contain, not the simulation behind them, so importing `files` with automatic detection gives the same nodes and events (`test/integration/digestion.test.js` checks every native medium one for one). The writer runs first and reports values it draws (bot ids, invitation times, follow lists, frequent contacts); `src/generator/native.js` then turns the simulated records into the records the export holds, per `docs/formats/*.md`:

| Medium | What the native dataset leaves out or changes, and why |
|---|---|
| slack | Reactions are dated at their message (the export lists reactors without a time) and counted once per reactor and emoji. |
| email | The mailbox only: Bcc only on the owner's own sent copies; a `reply` tie only when the parent is in the mailbox; thread visibility by the spec's size rule over the copies present; mailing lists keyed `email:list:<List-Id>`. |
| calendar | An ad-hoc meeting that every invitee declined is on the calendar but brings nobody together, so it has no event (as for series). |
| x | The archive only: the owner's tweets (public thread contexts), retweets, likes (undated, no author), both sides of the owner's DMs, and the follower/following snapshot (undated). Others' replies, likes, reposts and follow events are not in an archive. Bot status is not marked. |
| linkedin | Connections ego -> connection at the UTC date of Connected On; one more declared tie per Invitations.csv row (inviter -> invitee, minute resolution). |
| whatsapp | No reply links and no audience lists in group chats (the text export has neither); mentions only as written (`@⁨Name⁩`); in a 1:1 chat only mentions of the two people in it. |
| telegram | Deleted messages are not exported; a reply only to a message present in the same chat; no audience lists; a join by invitation names the inviter as `subject`; frequent contacts as declared ties weighted by Telegram's rating (undated). |
| discord | Reactions at message time, once per reactor and emoji glyph; a reply only to a message in the same file; a reply's ping is folded into the reply. Only accounts that appear in the files are nodes. |
| reddit | Only authors that appear are nodes; in a sample, a reply target only when the parent is in the sample. |
| survey | Roster form: people keyed `survey:<normalised name>` like the survey importer, nodes = roster. |
| network | Ties present for the whole span carry no time (the GraphML has no `first_contact` for them); bot status is only the `is_bot` attribute. |

Differences that remain are properties of the formats and are documented with the importers (`docs/api/importers-b.md`, "Native round trips"): WhatsApp date order and zone, WhatsApp 1:1 chats where only the other person wrote, Telegram people seen only in service messages, LinkedIn exports that never name the owner's URL, Network Canvas alters per interview, and calendar weights (count, not hours). The survey `perceived` variant does not round-trip yet: it lists the whole roster as each informant's alters, which the Network Canvas importer (following the spec, every alter is a named alter) reads as ego -> alter ties.

## What is approximate

- Time zones are fixed offsets (no daylight saving). Slack day files are bucketed in the workspace's offset.
- Interaction timing comes from per-medium rhythms, not from conversation-level dynamics beyond simple turn-taking.
- Diffusion is an independent cascade with random delays along true ties; adoption is not caused by exposure to a specific message. The first message after adoption almost always uses the term.
- Affect is planted as the chance of a VADER-scored phrase; neutral templates carry a small constant VADER offset, the same for every group.
- Bluesky, Mastodon and iMessage are dataset-only. With `output: 'dataset'` bot nodes are keyed `<prefix>:bot-<name>`; with `output: 'native'` they take the key the importer gives them (Slack users.json id, Discord snowflake, Reddit user name), so native round trips line up bots too.
- Community structure in forums is only weakly recoverable from reply networks by design (core members span spaces).

## Tests

`node --test 'test/generator/**/*.test.js'`: determinism, 50k scale, structure sanity per context, content (affect measurable with VADER, terms spread along ties), observation slices, recoveryCheck, progress, writer conformance (independent parsers), and native round trips through the real importers (`writers-a.test.js`, `writers-b.test.js`; the strict one-for-one check is `test/integration/digestion.test.js`, `DIGEST_SEED=<n>` shifts its seeds). `test/generator/helpers.js` has a small graphology-based stand-in for analysis results used by the tests.

## Betweenness fidelity check

`recoveryCheck` also reports `betweenness-fidelity`: Spearman's rho (average ranks for ties) between the measured betweenness and betweenness on the true ties, computed with its own Brandes implementation so it stays independent of the engine. It separates "the measurement is faithful to the world" from "the planted brokers dominate the world". When the network was built directed and the true network is directed (a follow graph), it is compared directed; otherwise true ties count both ways. Typical means (2026-10-06, `docs/accuracy.md` section 7): workplace Slack 1.0, workplace email 0.93, X 0.95, LinkedIn 0.92, survey 0.66 (recall error), WhatsApp 0.66 (turn-taking in group chats over-connects), Reddit 0.53 (replies to strangers are not ties). Skipped above 3,000 people.

A planted shift date counts as found only when at most half the period lies as close to a detected shift as the planted date does (`baseline` is that share, taken at the distance found, at least a day), so a date picked at random would not match as often. The survey recall check tests the planted direction (weak ties forgotten more often, or the reverse) with a two-proportion test; it is `not checked` when no direction was planted, or when a fixed-choice cap works against a planted "strong forgotten more".

Workplace people carry two levels, as an HR export does: `department` (the planted group; past the 15 bases, regional names like "Sales Americas"; the HR department is "People Operations", so it never reads like the People view) and `division`, the function the department rolls up to (`DEPT_BASES[].division` in `vocab.js`): Engineering (engineering, data, IT), Product (product, design, research), Sales (sales, partnerships), Marketing, Customer Support, Finance (finance, legal), Operations (operations, people operations, facilities), and Executive for the CEO. So a world of any size has at most eight divisions; it is derived from the department, so generation stays deterministic. GraphML writes it with every other attribute; the Slack, email and calendar writers have no HR field to carry it.

The `bridge-dependent` workplace preset makes heads rarely talk directly (10% leadership ties) and gives each broker ties to 4-7 people in 3-4 other departments, so the planted brokers really are the top brokers of the true network.
